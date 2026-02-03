import crypto from "node:crypto";
import fastify, { type FastifyRequest } from "fastify";
import requestId from "@fastify/request-id";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import jwt from "jsonwebtoken";
import { z, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  EarnSchema,
  PublicCardParamsSchema,
  PublicSessionInitSchema,
  RedeemSchema,
  StaffResolveSchema
} from "@loyalty/shared";
import { pool } from "@loyalty/db";

type Role = "owner" | "manager" | "cashier";

type StaffContext = {
  staffUserId: string;
  merchantId: string;
  role: Role;
};

declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffContext;
  }
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

const accessSecret = process.env.JWT_ACCESS_SECRET;

if (!accessSecret) {
  throw new Error("JWT_ACCESS_SECRET is required");
}

const app = fastify({
  logger: {
    level: "info"
  }
});

await app.register(requestId, {
  header: "x-request-id"
});

await app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute"
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "Loyalty API",
      version: "0.1.0"
    }
  }
});

await app.register(swaggerUi, {
  routePrefix: "/docs"
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    const validationDetails = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    reply.status(400).send({
      request_id: request.id,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: validationDetails
      }
    });
    return;
  }

  if (error instanceof ApiError) {
    reply.status(error.status).send({
      request_id: request.id,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null
      }
    });
    return;
  }

  request.log.error({ err: error }, "Unhandled error");
  reply.status(500).send({
    request_id: request.id,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
      details: null
    }
  });
});

const staffAuth = async (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header) {
    throw new ApiError(401, "UNAUTHENTICATED", "Missing authorization header");
  }

  const token = header.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, accessSecret) as jwt.JwtPayload;
    const staffUserId = payload.sub;
    const merchantId = payload.merchant_id as string | undefined;
    const role = payload.role as Role | undefined;
    if (!staffUserId || !merchantId || !role) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid token payload");
    }
    request.staff = {
      staffUserId,
      merchantId,
      role
    };
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(401, "UNAUTHENTICATED", "Invalid token");
  }
};

const requireRole = (allowed: Role[]) => {
  return async (request: FastifyRequest) => {
    const role = request.staff?.role;
    if (!role || !allowed.includes(role)) {
      throw new ApiError(403, "FORBIDDEN", "Insufficient permissions");
    }
  };
};

const toSchema = (schema: z.ZodTypeAny, name: string) =>
  zodToJsonSchema(schema, {
    name
  });

const generatePublicToken = () => crypto.randomBytes(32).toString("base64url");

app.post(
  "/public/session/init",
  {
    schema: {
      body: toSchema(PublicSessionInitSchema, "PublicSessionInitBody"),
      response: {
        200: toSchema(
          z.object({
            public_token: z.string()
          }),
          "PublicSessionInitResponse"
        )
      }
    }
  },
  async (request) => {
    const input = PublicSessionInitSchema.parse(request.body);
    const merchantResult = await pool.query<{ id: string; name: string; slug: string }>(
      "SELECT id, name, slug FROM merchants WHERE slug = $1 LIMIT 1",
      [input.merchant_slug]
    );
    const merchant = merchantResult.rows[0];
    if (!merchant) {
      throw new ApiError(404, "NOT_FOUND", "Merchant not found");
    }

    const deviceResult = await pool.query<{ customer_id: string }>(
      "SELECT customer_id FROM customer_devices WHERE merchant_id = $1 AND device_id = $2 LIMIT 1",
      [merchant.id, input.device_id]
    );
    const device = deviceResult.rows[0];
    if (device) {
      await pool.query(
        "UPDATE customer_devices SET last_seen_at = now() WHERE merchant_id = $1 AND device_id = $2",
        [merchant.id, input.device_id]
      );
      const tokenResult = await pool.query<{ public_token: string }>(
        "SELECT public_token FROM customer_tokens WHERE merchant_id = $1 AND customer_id = $2 AND status = 'active' ORDER BY issued_at DESC LIMIT 1",
        [merchant.id, device.customer_id]
      );
      const token = tokenResult.rows[0];
      if (!token) {
        throw new ApiError(404, "NOT_FOUND", "Active token not found");
      }
      return {
        public_token: token.public_token
      };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const customerResult = await client.query<{ id: string }>(
        "INSERT INTO customers (merchant_id, status) VALUES ($1, 'active') RETURNING id",
        [merchant.id]
      );
      const customerId = customerResult.rows[0]?.id;
      if (!customerId) {
        throw new ApiError(500, "INTERNAL_SERVER_ERROR", "Failed to create customer");
      }
      const publicToken = generatePublicToken();
      await client.query(
        "INSERT INTO customer_tokens (merchant_id, customer_id, type, public_token, status) VALUES ($1, $2, 'qr', $3, 'active')",
        [merchant.id, customerId, publicToken]
      );
      await client.query(
        "INSERT INTO customer_devices (merchant_id, customer_id, device_id) VALUES ($1, $2, $3)",
        [merchant.id, customerId, input.device_id]
      );
      await client.query("COMMIT");
      return {
        public_token: publicToken
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.get(
  "/public/card/:publicToken",
  {
    schema: {
      params: toSchema(PublicCardParamsSchema, "PublicCardParams"),
      response: {
        200: toSchema(
          z.object({
            merchant: z.object({
              name: z.string(),
              slug: z.string()
            }),
            balance: z.number().int(),
            rewards: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                points_cost: z.number().int()
              })
            )
          }),
          "PublicCardResponse"
        )
      }
    }
  },
  async (request) => {
    const { publicToken } = PublicCardParamsSchema.parse(request.params);
    const tokenResult = await pool.query<{
      customer_id: string;
      merchant_id: string;
      name: string;
      slug: string;
    }>(
      `SELECT ct.customer_id, ct.merchant_id, m.name, m.slug
       FROM customer_tokens ct
       JOIN merchants m ON m.id = ct.merchant_id
       WHERE ct.public_token = $1 AND ct.status = 'active'
       LIMIT 1`,
      [publicToken]
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(404, "NOT_FOUND", "Token not found");
    }
    const balanceResult = await pool.query<{ balance: number }>(
      "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
      [token.merchant_id, token.customer_id]
    );
    const balance = balanceResult.rows[0]?.balance ?? 0;
    const rewardsResult = await pool.query<{
      id: string;
      name: string;
      points_cost: number;
    }>(
      "SELECT id, name, points_cost FROM rewards WHERE merchant_id = $1 AND active = true AND points_cost <= $2 ORDER BY points_cost ASC",
      [token.merchant_id, balance]
    );
    return {
      merchant: {
        name: token.name,
        slug: token.slug
      },
      balance,
      rewards: rewardsResult.rows
    };
  }
);

app.post(
  "/tokens/resolve",
  {
    preHandler: [staffAuth, requireRole(["owner", "manager", "cashier"])],
    schema: {
      body: toSchema(StaffResolveSchema, "StaffResolveBody"),
      response: {
        200: toSchema(
          z.object({
            customer_id: z.string().uuid(),
            merchant_id: z.string().uuid(),
            balance: z.number().int(),
            rewards: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                points_cost: z.number().int()
              })
            )
          }),
          "StaffResolveResponse"
        )
      }
    }
  },
  async (request) => {
    const input = StaffResolveSchema.parse(request.body);
    const tokenResult = await pool.query<{ customer_id: string; merchant_id: string }>(
      "SELECT customer_id, merchant_id FROM customer_tokens WHERE public_token = $1 AND status = 'active' LIMIT 1",
      [input.public_token]
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(404, "NOT_FOUND", "Token not found");
    }
    const balanceResult = await pool.query<{ balance: number }>(
      "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
      [token.merchant_id, token.customer_id]
    );
    const balance = balanceResult.rows[0]?.balance ?? 0;
    const rewardsResult = await pool.query<{
      id: string;
      name: string;
      points_cost: number;
    }>(
      "SELECT id, name, points_cost FROM rewards WHERE merchant_id = $1 AND active = true ORDER BY points_cost ASC",
      [token.merchant_id]
    );
    return {
      customer_id: token.customer_id,
      merchant_id: token.merchant_id,
      balance,
      rewards: rewardsResult.rows.filter((reward) => reward.points_cost <= balance)
    };
  }
);

app.post(
  "/earn",
  {
    preHandler: [staffAuth, requireRole(["owner", "manager", "cashier"])],
    schema: {
      body: toSchema(EarnSchema, "EarnBody"),
      response: {
        200: toSchema(
          z.object({
            ledger_entry_id: z.string().uuid(),
            balance: z.number().int(),
            points_delta: z.number().int(),
            idempotent: z.boolean()
          }),
          "EarnResponse"
        )
      }
    }
  },
  async (request) => {
    const input = EarnSchema.parse(request.body);
    const tokenResult = await pool.query<{ customer_id: string; merchant_id: string }>(
      "SELECT customer_id, merchant_id FROM customer_tokens WHERE public_token = $1 AND status = 'active' LIMIT 1",
      [input.public_token]
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(404, "NOT_FOUND", "Token not found");
    }

    const rulesResult = await pool.query<{
      id: string;
      points_per_dollar: string;
      rounding: "floor" | "nearest";
      promo_multiplier: string;
    }>(
      `SELECT id, points_per_dollar, rounding, promo_multiplier
       FROM loyalty_rules_versions
       WHERE merchant_id = $1 AND active_from <= now()
       ORDER BY version DESC
       LIMIT 1`,
      [token.merchant_id]
    );
    const rules = rulesResult.rows[0];
    if (!rules) {
      throw new ApiError(409, "RULES_MISSING", "No active rules available");
    }

    const rawPoints =
      Number(rules.points_per_dollar) *
      Number(rules.promo_multiplier) *
      input.amount;
    const points =
      rules.rounding === "nearest" ? Math.round(rawPoints) : Math.floor(rawPoints);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO ledger_entries
          (merchant_id, customer_id, type, points_delta, source, rules_version_id, idempotency_key)
         VALUES ($1, $2, 'earn', $3, 'terminal', $4, $5)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [token.merchant_id, token.customer_id, points, rules.id, input.idempotency_key]
      );
      const inserted = insertResult.rows[0];
      let ledgerEntryId = inserted?.id;
      let idempotent = false;
      if (!ledgerEntryId) {
        idempotent = true;
        const existingResult = await client.query<{ id: string }>(
          "SELECT id FROM ledger_entries WHERE merchant_id = $1 AND idempotency_key = $2 LIMIT 1",
          [token.merchant_id, input.idempotency_key]
        );
        ledgerEntryId = existingResult.rows[0]?.id;
        if (!ledgerEntryId) {
          throw new ApiError(409, "IDEMPOTENT_REPLAY", "Idempotency conflict");
        }
      }
      const balanceResult = await client.query<{ balance: number }>(
        "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
        [token.merchant_id, token.customer_id]
      );
      await client.query("COMMIT");
      return {
        ledger_entry_id: ledgerEntryId,
        balance: balanceResult.rows[0]?.balance ?? 0,
        points_delta: points,
        idempotent
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.post(
  "/redeem",
  {
    preHandler: [staffAuth, requireRole(["owner", "manager", "cashier"])],
    schema: {
      body: toSchema(RedeemSchema, "RedeemBody"),
      response: {
        200: toSchema(
          z.object({
            redemption_id: z.string().uuid(),
            balance: z.number().int(),
            idempotent: z.boolean()
          }),
          "RedeemResponse"
        )
      }
    }
  },
  async (request) => {
    const input = RedeemSchema.parse(request.body);
    const tokenResult = await pool.query<{ customer_id: string; merchant_id: string }>(
      "SELECT customer_id, merchant_id FROM customer_tokens WHERE public_token = $1 AND status = 'active' LIMIT 1",
      [input.public_token]
    );
    const token = tokenResult.rows[0];
    if (!token) {
      throw new ApiError(404, "NOT_FOUND", "Token not found");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM customers WHERE id = $1 AND merchant_id = $2 FOR UPDATE",
        [token.customer_id, token.merchant_id]
      );
      const rewardResult = await client.query<{
        id: string;
        points_cost: number;
      }>(
        "SELECT id, points_cost FROM rewards WHERE id = $1 AND merchant_id = $2 AND active = true LIMIT 1",
        [input.reward_id, token.merchant_id]
      );
      const reward = rewardResult.rows[0];
      if (!reward) {
        throw new ApiError(404, "NOT_FOUND", "Reward not found");
      }
      const balanceResult = await client.query<{ balance: number }>(
        "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
        [token.merchant_id, token.customer_id]
      );
      const balance = balanceResult.rows[0]?.balance ?? 0;
      if (balance < reward.points_cost) {
        throw new ApiError(409, "INSUFFICIENT_POINTS", "Not enough points");
      }
      const redemptionId = crypto.randomUUID();
      const insertLedger = await client.query<{ id: string }>(
        `INSERT INTO ledger_entries
          (merchant_id, customer_id, type, points_delta, source, external_id, idempotency_key)
         VALUES ($1, $2, 'redeem', $3, 'terminal', $4, $5)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          token.merchant_id,
          token.customer_id,
          -reward.points_cost,
          redemptionId,
          input.idempotency_key
        ]
      );
      const inserted = insertLedger.rows[0];
      let ledgerEntryId = inserted?.id;
      let idempotent = false;
      let resolvedRedemptionId = redemptionId;
      if (!ledgerEntryId) {
        idempotent = true;
        const existingLedger = await client.query<{ id: string; external_id: string | null }>(
          "SELECT id, external_id FROM ledger_entries WHERE merchant_id = $1 AND idempotency_key = $2 LIMIT 1",
          [token.merchant_id, input.idempotency_key]
        );
        ledgerEntryId = existingLedger.rows[0]?.id;
        resolvedRedemptionId = existingLedger.rows[0]?.external_id ?? redemptionId;
        if (!ledgerEntryId) {
          throw new ApiError(409, "IDEMPOTENT_REPLAY", "Idempotency conflict");
        }
      }
      if (!idempotent) {
        await client.query(
          `INSERT INTO redemptions (id, merchant_id, customer_id, reward_id, points_cost, status)
           VALUES ($1, $2, $3, $4, $5, 'approved')`,
          [redemptionId, token.merchant_id, token.customer_id, reward.id, reward.points_cost]
        );
      }
      const newBalanceResult = await client.query<{ balance: number }>(
        "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
        [token.merchant_id, token.customer_id]
      );
      await client.query("COMMIT");
      return {
        redemption_id: resolvedRedemptionId,
        balance: newBalanceResult.rows[0]?.balance ?? 0,
        idempotent
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.get(
  "/customers/:id/ledger",
  {
    preHandler: [staffAuth, requireRole(["owner", "manager", "cashier"])],
    schema: {
      params: toSchema(z.object({ id: z.string().uuid() }), "CustomerLedgerParams"),
      response: {
        200: toSchema(
          z.object({
            entries: z.array(
              z.object({
                id: z.string().uuid(),
                type: z.string(),
                points_delta: z.number().int(),
                source: z.string(),
                created_at: z.string()
              })
            )
          }),
          "CustomerLedgerResponse"
        )
      }
    }
  },
  async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const entries = await pool.query<{
      id: string;
      type: string;
      points_delta: number;
      source: string;
      created_at: string;
    }>(
      `SELECT id, type, points_delta, source, created_at
       FROM ledger_entries
       WHERE merchant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [request.staff!.merchantId, params.id]
    );
    return {
      entries: entries.rows
    };
  }
);

app.get(
  "/customers/:id/balance",
  {
    preHandler: [staffAuth, requireRole(["owner", "manager", "cashier"])],
    schema: {
      params: toSchema(z.object({ id: z.string().uuid() }), "CustomerBalanceParams"),
      response: {
        200: toSchema(
          z.object({
            balance: z.number().int()
          }),
          "CustomerBalanceResponse"
        )
      }
    }
  },
  async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const balanceResult = await pool.query<{ balance: number }>(
      "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
      [request.staff!.merchantId, params.id]
    );
    return {
      balance: balanceResult.rows[0]?.balance ?? 0
    };
  }
);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
