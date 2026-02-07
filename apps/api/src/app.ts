import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { pool } from "@loyalty/db";
import {
  EarnSchema,
  PublicCardParamsSchema,
  PublicSessionInitSchema,
  RedeemSchema,
  StaffResolveSchema
} from "@loyalty/shared";
import fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";
import requestId from "fastify-request-id";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type Role = "owner" | "manager" | "cashier";

type StaffContext = {
  staffUserId: string;
  merchantId: string;
  role: Role;
};

type BuildAppOptions = Pick<FastifyServerOptions, "logger">;

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

const toSchema = (schema: z.ZodTypeAny, name: string) =>
  (zodToJsonSchema as unknown as (schema: z.ZodTypeAny, options: { name: string }) => object)(schema, {
    name
  });

const generatePublicToken = () => crypto.randomBytes(32).toString("base64url");

const metrics = {
  requests: 0,
  errors: 0,
  routes: new Map<string, number>()
};

const recordRoute = (method: string, path: string) => {
  const key = `${method}:${path}`;
  metrics.routes.set(key, (metrics.routes.get(key) ?? 0) + 1);
};

const staffAuth = async (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header) {
    throw new ApiError(401, "UNAUTHENTICATED", "Missing authorization header");
  }

  const token = header.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, accessSecret) as jwt.JwtPayload;
    const staffUserId = payload.sub as string | undefined;
    const merchantId = payload.merchant_id as string | undefined;
    if (!staffUserId || !merchantId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid token payload");
    }
    const staffResult = await pool.query<{ role: Role; disabled_at: string | null }>(
      "SELECT role, disabled_at FROM staff_users WHERE id = $1 AND merchant_id = $2",
      [staffUserId, merchantId]
    );
    const staff = staffResult.rows[0];
    if (!staff || staff.disabled_at) {
      throw new ApiError(403, "FORBIDDEN", "Staff access disabled");
    }
    request.staff = {
      staffUserId,
      merchantId,
      role: staff.role
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

const logAudit = async (
  input: {
    merchantId: string;
    staffUserId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  },
  client: Pool | PoolClient = pool
) => {
  await client.query(
    `INSERT INTO audit_logs (merchant_id, staff_user_id, action, target_type, target_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.merchantId, input.staffUserId, input.action, input.targetType, input.targetId, input.meta ?? {}]
  );
};

const resolvePublicSession = async (merchantSlug: string, deviceId: string) => {
  const merchantResult = await pool.query<{ id: string; name: string; slug: string }>(
    "SELECT id, name, slug FROM merchants WHERE slug = $1 LIMIT 1",
    [merchantSlug]
  );
  const merchant = merchantResult.rows[0];
  if (!merchant) {
    throw new ApiError(404, "NOT_FOUND", "Merchant not found");
  }

  const deviceResult = await pool.query<{ customer_id: string }>(
    "SELECT customer_id FROM customer_devices WHERE merchant_id = $1 AND device_id = $2 LIMIT 1",
    [merchant.id, deviceId]
  );
  const device = deviceResult.rows[0];
  if (device) {
    await pool.query(
      "UPDATE customer_devices SET last_seen_at = now() WHERE merchant_id = $1 AND device_id = $2",
      [merchant.id, deviceId]
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
      publicToken: token.public_token,
      merchant
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
      [merchant.id, customerId, deviceId]
    );
    await client.query("COMMIT");
    return {
      publicToken,
      merchant
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const resolveRateLimitKey = (request: FastifyRequest, suffix: string) => {
  const staffId = request.staff?.staffUserId ?? "anonymous";
  return `${request.ip}:${staffId}:${suffix}`;
};

const secureCookie = process.env.NODE_ENV === "production";

const publicCardHtml = (publicToken: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Loyalty Card</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 32px; background: #f7f7fb; color: #1f2933; }
      .card { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 12px 24px rgba(0,0,0,0.08); }
      .badge { display: inline-block; padding: 4px 12px; background: #eef2ff; color: #4338ca; border-radius: 999px; font-size: 12px; }
      h1 { margin-top: 12px; }
      .balance { font-size: 48px; margin: 16px 0; }
      ul { list-style: none; padding: 0; }
      li { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge">Loyalty Card</span>
      <h1 id="merchant">Loading...</h1>
      <div class="balance" id="balance">--</div>
      <h2>Available rewards</h2>
      <ul id="rewards"></ul>
    </div>
    <script>
      const rewardsList = document.getElementById("rewards");
      fetch(\`/public/card/${publicToken}\`)
        .then((res) => res.json())
        .then((data) => {
          document.getElementById("merchant").textContent = data.merchant.name;
          document.getElementById("balance").textContent = \`\${data.balance} pts\`;
          rewardsList.innerHTML = "";
          data.rewards.forEach((reward) => {
            const item = document.createElement("li");
            item.textContent = \`\${reward.name} • \${reward.points_cost} pts\`;
            rewardsList.appendChild(item);
          });
        })
        .catch(() => {
          document.getElementById("merchant").textContent = "Unable to load card";
        });
    </script>
  </body>
</html>`;

export const buildApp = ({ logger = { level: "info" } }: BuildAppOptions = {}): FastifyInstance => {
  const app = fastify({ logger });


  app.addHook("onRequest", async (_request, _reply) => {
    metrics.requests += 1;
  });

  app.addHook("onResponse", async (request, _reply) => {
    const routePath = request.routeOptions?.url;
    if (routePath) {
      recordRoute(request.method, routePath);
    }
  });

  app.addHook("onError", async (_request, _reply, _error) => {
    metrics.errors += 1;
  });

  app.register(requestId, {
    header: "x-request-id"
  });

  app.register(cookie, {
    hook: "onRequest"
  });

  app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "Loyalty API",
        version: "0.1.0"
      }
    }
  });

  app.register(swaggerUi, {
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

    if (process.env.LOG_LEVEL) {
      console.error(error);
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

  app.get("/metrics", async () => {
    return {
      requests: metrics.requests,
      errors: metrics.errors,
      routes: Object.fromEntries(metrics.routes)
    };
  });

  app.get(
    "/m/:slug",
    {
      schema: {
        params: toSchema(z.object({ slug: z.string().min(1) }), "MerchantSlugParams")
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            `${request.ip}:${(request.params as { slug: string }).slug}`
        }
      }
    },
    async (request, reply) => {
      const params = z.object({ slug: z.string().min(1) }).parse(request.params);
      const deviceId = request.cookies.device_id ?? crypto.randomUUID();
      reply.setCookie("device_id", deviceId, {
        path: "/",
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365
      });
      const session = await resolvePublicSession(params.slug, deviceId);
      return reply.redirect(`/c/${session.publicToken}`);
    }
  );

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
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (request) => `${request.ip}:${(request.body as { merchant_slug: string }).merchant_slug}`
        }
      }
    },
    async (request) => {
      const input = PublicSessionInitSchema.parse(request.body);
      const session = await resolvePublicSession(input.merchant_slug, input.device_id);
      return {
        public_token: session.publicToken
      };
    }
  );

  app.get(
    "/c/:publicToken",
    {
      schema: {
        params: toSchema(PublicCardParamsSchema, "PublicCardParams")
      }
    },
    async (request, reply) => {
      const { publicToken } = PublicCardParamsSchema.parse(request.params);
      reply.header("content-type", "text/html; charset=utf-8");
      return reply.send(publicCardHtml(publicToken));
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
        name: string;
        points_cost: number;
      }>(
        "SELECT name, points_cost FROM rewards WHERE merchant_id = $1 AND active = true AND points_cost <= $2 ORDER BY points_cost ASC",
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
      },
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            resolveRateLimitKey(request, (request.body as { public_token: string }).public_token)
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
    "/tokens/revoke",
    {
      preHandler: [staffAuth, requireRole(["owner"])],
      schema: {
        body: toSchema(
          z.object({
            public_token: z.string(),
            reason: z.string().min(1).optional()
          }),
          "TokenRevokeBody"
        ),
        response: {
          200: toSchema(
            z.object({
              revoked: z.boolean()
            }),
            "TokenRevokeResponse"
          )
        }
      }
    },
    async (request) => {
      const input = z
        .object({
          public_token: z.string(),
          reason: z.string().min(1).optional()
        })
        .parse(request.body);
      const tokenResult = await pool.query<{ id: string; merchant_id: string }>(
        "SELECT id, merchant_id FROM customer_tokens WHERE public_token = $1 LIMIT 1",
        [input.public_token]
      );
      const token = tokenResult.rows[0];
      if (!token) {
        throw new ApiError(404, "NOT_FOUND", "Token not found");
      }
      await pool.query(
        "UPDATE customer_tokens SET status = 'revoked', revoked_at = now() WHERE id = $1",
        [token.id]
      );
      await logAudit({
        merchantId: token.merchant_id,
        staffUserId: request.staff!.staffUserId,
        action: "token_revoked",
        targetType: "customer_token",
        targetId: token.id,
        meta: {
          public_token: input.public_token,
          reason: input.reason ?? null
        }
      });
      return {
        revoked: true
      };
    }
  );

  app.post(
    "/rules",
    {
      preHandler: [staffAuth, requireRole(["owner", "manager"])],
      schema: {
        body: toSchema(
          z.object({
            points_per_dollar: z.number().positive(),
            rounding: z.enum(["floor", "nearest"]),
            promo_multiplier: z.number().positive().default(1),
            active_from: z.string().datetime()
          }),
          "RulesCreateBody"
        ),
        response: {
          200: toSchema(
            z.object({
              id: z.string().uuid(),
              version: z.number().int()
            }),
            "RulesCreateResponse"
          )
        }
      }
    },
    async (request) => {
      const input = z
        .object({
          points_per_dollar: z.number().positive(),
          rounding: z.enum(["floor", "nearest"]),
          promo_multiplier: z.number().positive().default(1),
          active_from: z.string().datetime()
        })
        .parse(request.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const versionResult = await client.query<{ version: number }>(
          "SELECT COALESCE(MAX(version), 0) AS version FROM loyalty_rules_versions WHERE merchant_id = $1",
          [request.staff!.merchantId]
        );
        const nextVersion = (versionResult.rows[0]?.version ?? 0) + 1;
        const insertResult = await client.query<{ id: string }>(
          `INSERT INTO loyalty_rules_versions
            (merchant_id, version, points_per_dollar, rounding, promo_multiplier, active_from)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            request.staff!.merchantId,
            nextVersion,
            input.points_per_dollar,
            input.rounding,
            input.promo_multiplier,
            input.active_from
          ]
        );
        const ruleId = insertResult.rows[0]?.id;
        if (!ruleId) {
          throw new ApiError(500, "INTERNAL_SERVER_ERROR", "Failed to create rules");
        }
        await logAudit(
          {
            merchantId: request.staff!.merchantId,
            staffUserId: request.staff!.staffUserId,
            action: "rules_version_created",
            targetType: "loyalty_rules_versions",
            targetId: ruleId,
            meta: {
              version: nextVersion,
              ...input
            }
          },
          client
        );
        await client.query("COMMIT");
        return {
          id: ruleId,
          version: nextVersion
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
    "/adjust",
    {
      preHandler: [staffAuth, requireRole(["owner"])],
      schema: {
        body: toSchema(
          z.object({
            public_token: z.string(),
            points_delta: z.number().int(),
            idempotency_key: z.string().min(8),
            reason: z.string().min(1)
          }),
          "AdjustBody"
        ),
        response: {
          200: toSchema(
            z.object({
              ledger_entry_id: z.string().uuid(),
              balance: z.number().int(),
              idempotent: z.boolean()
            }),
            "AdjustResponse"
          )
        }
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            resolveRateLimitKey(request, (request.body as { public_token: string }).public_token)
        }
      }
    },
    async (request) => {
      const input = z
        .object({
          public_token: z.string(),
          points_delta: z.number().int(),
          idempotency_key: z.string().min(8),
          reason: z.string().min(1)
        })
        .parse(request.body);
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
        const insertResult = await client.query<{ id: string }>(
          `INSERT INTO ledger_entries
            (merchant_id, customer_id, type, points_delta, source, idempotency_key)
           VALUES ($1, $2, 'adjust', $3, 'admin', $4)
           ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
           RETURNING id`,
          [token.merchant_id, token.customer_id, input.points_delta, input.idempotency_key]
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
        await logAudit(
          {
            merchantId: token.merchant_id,
            staffUserId: request.staff!.staffUserId,
            action: "adjustment_created",
            targetType: "ledger_entry",
            targetId: ledgerEntryId,
            meta: {
              points_delta: input.points_delta,
              reason: input.reason,
              idempotency_key: input.idempotency_key
            }
          },
          client
        );
        const balanceResult = await client.query<{ balance: number }>(
          "SELECT COALESCE(SUM(points_delta), 0)::int AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2",
          [token.merchant_id, token.customer_id]
        );
        await client.query("COMMIT");
        return {
          ledger_entry_id: ledgerEntryId,
          balance: balanceResult.rows[0]?.balance ?? 0,
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
    "/staff/:id/role",
    {
      preHandler: [staffAuth, requireRole(["owner"])],
      schema: {
        params: toSchema(z.object({ id: z.string().uuid() }), "StaffRoleParams"),
        body: toSchema(z.object({ role: z.enum(["owner", "manager", "cashier"]) }), "StaffRoleBody"),
        response: {
          200: toSchema(
            z.object({
              updated: z.boolean()
            }),
            "StaffRoleResponse"
          )
        }
      }
    },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = z.object({ role: z.enum(["owner", "manager", "cashier"]) }).parse(request.body);
      const updateResult = await pool.query<{ id: string }>(
        "UPDATE staff_users SET role = $1 WHERE id = $2 AND merchant_id = $3 RETURNING id",
        [input.role, params.id, request.staff!.merchantId]
      );
      const updated = updateResult.rows[0];
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "Staff user not found");
      }
      await logAudit({
        merchantId: request.staff!.merchantId,
        staffUserId: request.staff!.staffUserId,
        action: "staff_role_changed",
        targetType: "staff_user",
        targetId: params.id,
        meta: {
          role: input.role
        }
      });
      return {
        updated: true
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
      },
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            resolveRateLimitKey(request, (request.body as { public_token: string }).public_token)
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
        Number(rules.points_per_dollar) * Number(rules.promo_multiplier) * input.amount;
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
      },
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            resolveRateLimitKey(request, (request.body as { public_token: string }).public_token)
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
        let resolvedRedemptionId: string = redemptionId;
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
          await logAudit(
            {
              merchantId: token.merchant_id,
              staffUserId: request.staff!.staffUserId,
              action: "redemption_created",
              targetType: "redemption",
              targetId: redemptionId,
              meta: {
                reward_id: reward.id,
                points_cost: reward.points_cost
              }
            },
            client
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
app.ready().then(() => {
  // prints all routes
  console.log(app.printRoutes());
});
  return app;
};
