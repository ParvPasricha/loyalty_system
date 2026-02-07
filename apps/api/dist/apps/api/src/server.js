import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { query, withTransaction } from "@loyalty/db";
import { EarnSchema, PublicClaimStartSchema, PublicClaimVerifySchema, PublicSessionInitSchema, RedeemSchema, TokenBindNfcSchema, TokenResolveSchema, TokenRevokeSchema, } from "@loyalty/shared";
import Fastify from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
const app = Fastify({
    logger: true,
    requestIdHeader: "x-request-id",
});
const inMemoryClaims = new Map();
app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, "request_error");
    reply.status(error.statusCode ?? 500).send({
        error: {
            message: error.message,
            code: error.code ?? "INTERNAL_ERROR",
            request_id: request.id,
        },
    });
});
await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret",
});
await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
});
await app.register(swagger, {
    openapi: {
        info: {
            title: "Loyalty API",
            version: "0.1.0",
        },
    },
});
await app.register(swaggerUi, {
    routePrefix: "/docs",
});
function getPublicToken() {
    return crypto.randomBytes(16).toString("base64url");
}
function requireRole(roles) {
    return async (request, reply) => {
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
            return reply.status(401).send({ error: { message: "Unauthorized", request_id: request.id } });
        }
        const token = auth.slice("Bearer ".length);
        const payload = app.jwt.verify(token);
        if (!roles.includes(payload.role)) {
            return reply.status(403).send({ error: { message: "Forbidden", request_id: request.id } });
        }
        request.staff = payload;
    };
}
async function getPointsBalance(merchantId, customerId) {
    const result = await query("SELECT COALESCE(SUM(points_delta), 0)::text AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2", [merchantId, customerId]);
    return Number(result.rows[0]?.balance ?? 0);
}
app.post("/public/session/init", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = PublicSessionInitSchema.parse(request.body);
    const merchantResult = await query("SELECT id FROM merchants WHERE slug = $1", [body.merchant_slug]);
    const merchantId = merchantResult.rows[0]?.id;
    if (!merchantId) {
        return reply.status(404).send({ error: { message: "Merchant not found", request_id: request.id } });
    }
    const existingDevice = await query("SELECT customer_id FROM customer_devices WHERE merchant_id = $1 AND device_id = $2", [merchantId, body.device_id]);
    if (existingDevice.rows[0]) {
        const token = await query("SELECT public_token FROM customer_tokens WHERE merchant_id = $1 AND customer_id = $2 AND status = 'active' ORDER BY issued_at DESC LIMIT 1", [merchantId, existingDevice.rows[0].customer_id]);
        return reply.send({ public_token: token.rows[0]?.public_token });
    }
    const publicToken = getPublicToken();
    await withTransaction(async (client) => {
        const customerResult = await client.query("INSERT INTO customers (merchant_id, status) VALUES ($1, 'active') RETURNING id", [merchantId]);
        const customerRow = customerResult.rows[0];
        if (!customerRow) {
            throw new Error("Failed to create customer");
        }
        const customerId = customerRow.id;
        await client.query("INSERT INTO customer_tokens (merchant_id, customer_id, type, public_token, status) VALUES ($1, $2, 'qr', $3, 'active')", [merchantId, customerId, publicToken]);
        await client.query("INSERT INTO customer_devices (merchant_id, customer_id, device_id) VALUES ($1, $2, $3)", [merchantId, customerId, body.device_id]);
    });
    return reply.send({ public_token: publicToken });
});
app.get("/public/card/:publicToken", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = z.object({ publicToken: z.string().min(16) }).parse(request.params);
    const tokenResult = await query("SELECT merchant_id, customer_id FROM customer_tokens WHERE public_token = $1 AND status = 'active'", [params.publicToken]);
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
        return reply.status(404).send({ error: { message: "Token not found", request_id: request.id } });
    }
    const merchantResult = await query("SELECT name, slug FROM merchants WHERE id = $1", [tokenRow.merchant_id]);
    const rewards = await query("SELECT id, name, points_cost FROM rewards WHERE merchant_id = $1 AND active = true", [tokenRow.merchant_id]);
    const balance = await getPointsBalance(tokenRow.merchant_id, tokenRow.customer_id);
    return reply.send({
        merchant: merchantResult.rows[0],
        points_balance: balance,
        rewards: rewards.rows,
    });
});
app.post("/public/claim/start", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = PublicClaimStartSchema.parse(request.body);
    const challenge = crypto.randomBytes(16).toString("hex");
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    inMemoryClaims.set(challenge, { publicToken: body.public_token, code, expiresAt: Date.now() + 10 * 60_000 });
    return reply.send({ challenge });
});
app.post("/public/claim/verify", async (request, reply) => {
    const body = PublicClaimVerifySchema.parse(request.body);
    const entry = inMemoryClaims.get(body.challenge);
    if (!entry || entry.expiresAt < Date.now() || entry.code !== body.code) {
        return reply.status(400).send({ error: { message: "Invalid challenge", request_id: request.id } });
    }
    inMemoryClaims.delete(body.challenge);
    const sessionToken = app.jwt.sign({ public_token: entry.publicToken });
    return reply.send({ session_token: sessionToken });
});
app.post("/tokens/resolve", { preHandler: requireRole(["cashier", "manager", "owner"]) }, async (request, reply) => {
    const body = TokenResolveSchema.parse(request.body);
    const tokenResult = await query("SELECT id, merchant_id, customer_id FROM customer_tokens WHERE public_token = $1 AND status = 'active'", [body.public_token]);
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
        return reply.status(404).send({ error: { message: "Token not found", request_id: request.id } });
    }
    const rewards = await query("SELECT id, name, points_cost FROM rewards WHERE merchant_id = $1 AND active = true", [tokenRow.merchant_id]);
    const balance = await getPointsBalance(tokenRow.merchant_id, tokenRow.customer_id);
    return reply.send({
        customer: { customer_id: tokenRow.customer_id, token_id: tokenRow.id },
        points_balance: balance,
        rewards: rewards.rows,
    });
});
app.post("/tokens/revoke", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const body = TokenRevokeSchema.parse(request.body);
    const tokenResult = await query("UPDATE customer_tokens SET status = 'revoked', revoked_at = now() WHERE (id = $1 OR public_token = $2) RETURNING id", [body.token_id ?? null, body.public_token ?? null]);
    if (!tokenResult.rows[0]) {
        return reply.status(404).send({ error: { message: "Token not found", request_id: request.id } });
    }
    return reply.send({ success: true });
});
app.post("/tokens/bind-nfc", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const body = TokenBindNfcSchema.parse(request.body);
    await query("UPDATE customer_tokens SET metadata = jsonb_set(metadata, '{nfc_uid}', to_jsonb($1::text), true) WHERE public_token = $2", [body.nfc_uid, body.public_token]);
    return reply.send({ success: true });
});
app.post("/earn", { preHandler: requireRole(["cashier", "manager", "owner"]) }, async (request, reply) => {
    const body = EarnSchema.parse(request.body);
    const tokenResult = await query("SELECT merchant_id, customer_id FROM customer_tokens WHERE public_token = $1 AND status = 'active'", [body.public_token]);
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
        return reply.status(404).send({ error: { message: "Token not found", request_id: request.id } });
    }
    const rulesResult = await query("SELECT id, points_per_dollar, rounding, promo_multiplier FROM loyalty_rules_versions WHERE merchant_id = $1 AND active_from <= now() ORDER BY version DESC LIMIT 1", [tokenRow.merchant_id]);
    const rules = rulesResult.rows[0];
    if (!rules) {
        return reply.status(400).send({ error: { message: "No active rules", request_id: request.id } });
    }
    const rawPoints = Number(rules.points_per_dollar) * body.amount * Number(rules.promo_multiplier);
    const points = rules.rounding === "nearest" ? Math.round(rawPoints) : Math.floor(rawPoints);
    await withTransaction(async (client) => {
        const insertResult = await client.query("INSERT INTO ledger_entries (merchant_id, customer_id, type, points_delta, source, rules_version_id, idempotency_key) VALUES ($1, $2, 'earn', $3, 'terminal', $4, $5) ON CONFLICT (merchant_id, idempotency_key) DO NOTHING", [tokenRow.merchant_id, tokenRow.customer_id, points, rules.id, body.idempotency_key]);
        if (insertResult.rowCount === 0) {
            return;
        }
    });
    const balance = await getPointsBalance(tokenRow.merchant_id, tokenRow.customer_id);
    return reply.send({ points_balance: balance });
});
app.post("/redeem", { preHandler: requireRole(["cashier", "manager", "owner"]) }, async (request, reply) => {
    const body = RedeemSchema.parse(request.body);
    const tokenResult = await query("SELECT merchant_id, customer_id FROM customer_tokens WHERE public_token = $1 AND status = 'active'", [body.public_token]);
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
        return reply.status(404).send({ error: { message: "Token not found", request_id: request.id } });
    }
    await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM ledger_entries WHERE merchant_id = $1 AND idempotency_key = $2", [tokenRow.merchant_id, body.idempotency_key]);
        if (existing.rows[0]) {
            return;
        }
        await client.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [tokenRow.customer_id]);
        const rewardResult = await client.query("SELECT id, points_cost FROM rewards WHERE id = $1 AND merchant_id = $2 AND active = true", [body.reward_id, tokenRow.merchant_id]);
        const reward = rewardResult.rows[0];
        if (!reward) {
            throw new Error("Reward not found");
        }
        const balanceResult = await client.query("SELECT COALESCE(SUM(points_delta), 0)::text AS balance FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2", [tokenRow.merchant_id, tokenRow.customer_id]);
        const balance = Number(balanceResult.rows[0]?.balance ?? 0);
        if (balance < reward.points_cost) {
            throw new Error("Insufficient points");
        }
        await client.query("INSERT INTO ledger_entries (merchant_id, customer_id, type, points_delta, source, idempotency_key) VALUES ($1, $2, 'redeem', $3, 'terminal', $4)", [tokenRow.merchant_id, tokenRow.customer_id, -reward.points_cost, body.idempotency_key]);
        await client.query("INSERT INTO redemptions (merchant_id, customer_id, reward_id, points_cost) VALUES ($1, $2, $3, $4)", [tokenRow.merchant_id, tokenRow.customer_id, reward.id, reward.points_cost]);
        await client.query("INSERT INTO audit_logs (merchant_id, staff_user_id, action, target_type, target_id, meta) VALUES ($1, $2, 'redeem', 'reward', $3, $4)", [tokenRow.merchant_id, request.staff?.staff_user_id ?? null, reward.id, { idempotency_key: body.idempotency_key }]);
    });
    const balance = await getPointsBalance(tokenRow.merchant_id, tokenRow.customer_id);
    return reply.send({ points_balance: balance });
});
app.get("/customers/:id/ledger", { preHandler: requireRole(["cashier", "manager", "owner"]) }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const merchantId = request.staff?.merchant_id ?? "";
    const entries = await query("SELECT id, type, points_delta, source, external_id, created_at FROM ledger_entries WHERE merchant_id = $1 AND customer_id = $2 ORDER BY created_at DESC", [merchantId, params.id]);
    return reply.send({ entries: entries.rows });
});
app.get("/customers/:id/balance", { preHandler: requireRole(["cashier", "manager", "owner"]) }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const merchantId = request.staff?.merchant_id ?? "";
    const balance = await getPointsBalance(merchantId, params.id);
    return reply.send({ points_balance: balance });
});
app.get("/merchant/settings", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const merchantId = request.staff?.merchant_id;
    const merchant = await query("SELECT id, slug, name FROM merchants WHERE id = $1", [merchantId]);
    const rules = await query("SELECT version, points_per_dollar, rounding, promo_multiplier, active_from FROM loyalty_rules_versions WHERE merchant_id = $1 ORDER BY version DESC LIMIT 1", [merchantId]);
    return reply.send({ merchant: merchant.rows[0], active_rules: rules.rows[0] });
});
app.post("/merchant/settings", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const body = z
        .object({
        points_per_dollar: z.number().positive(),
        rounding: z.enum(["floor", "nearest"]),
        promo_multiplier: z.number().positive().default(1),
    })
        .parse(request.body);
    const merchantId = request.staff?.merchant_id;
    const latest = await query("SELECT COALESCE(MAX(version), 0)::int AS version FROM loyalty_rules_versions WHERE merchant_id = $1", [merchantId]);
    const nextVersion = (latest.rows[0]?.version ?? 0) + 1;
    await query("INSERT INTO loyalty_rules_versions (merchant_id, version, points_per_dollar, rounding, promo_multiplier, active_from) VALUES ($1, $2, $3, $4, $5, now())", [merchantId, nextVersion, body.points_per_dollar, body.rounding, body.promo_multiplier]);
    return reply.send({ success: true, version: nextVersion });
});
app.get("/merchant/rewards", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const merchantId = request.staff?.merchant_id;
    const rewards = await query("SELECT id, name, points_cost, active FROM rewards WHERE merchant_id = $1 ORDER BY created_at DESC", [merchantId]);
    return reply.send({ rewards: rewards.rows });
});
app.post("/merchant/rewards", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const body = z
        .object({
        name: z.string().min(1),
        points_cost: z.number().int().positive(),
        active: z.boolean().default(true),
    })
        .parse(request.body);
    const merchantId = request.staff?.merchant_id;
    const reward = await query("INSERT INTO rewards (merchant_id, name, points_cost, active) VALUES ($1, $2, $3, $4) RETURNING id", [merchantId, body.name, body.points_cost, body.active]);
    return reply.send({ id: reward.rows[0]?.id });
});
app.get("/merchant/qr", { preHandler: requireRole(["manager", "owner"]) }, async (request, reply) => {
    const merchantId = request.staff?.merchant_id;
    const merchant = await query("SELECT slug FROM merchants WHERE id = $1", [merchantId]);
    const slug = merchant.rows[0]?.slug;
    return reply.send({ qr_payload: `/m/${slug}` });
});
app.get("/wallet/apple/:publicToken", async (request, reply) => {
    const params = z.object({ publicToken: z.string().min(16) }).parse(request.params);
    return reply
        .type("application/vnd.apple.pkpass")
        .send({ message: "Pass generation not implemented", token: params.publicToken });
});
app.get("/wallet/google/:publicToken", async (request, reply) => {
    const params = z.object({ publicToken: z.string().min(16) }).parse(request.params);
    return reply.send({ add_link: `/wallet/google/${params.publicToken}/add` });
});
app.get("/wallet/samsung/:publicToken", async (_request, reply) => {
    return reply.send({ message: "coming soon" });
});
const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
    app.log.error(error);
    process.exit(1);
});
