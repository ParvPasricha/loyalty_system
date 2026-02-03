import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const jwtSecret = process.env.JWT_ACCESS_SECRET ?? "test_secret";
process.env.JWT_ACCESS_SECRET = jwtSecret;

const pool = new Pool({ connectionString: databaseUrl });

const migrate = async () => {
  const migrationPath = join(process.cwd(), "packages", "db", "migrations", "001_init.sql");
  const sql = await readFile(migrationPath, "utf-8");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query(sql);
};

let seedCounter = 0;

const seedMerchant = async () => {
  seedCounter += 1;
  const slug = `coffee-bar-${seedCounter}`;
  const publicToken = `public-token-${seedCounter}`;
  const email = `cashier-${seedCounter}@coffee.test`;
  const merchantResult = await pool.query<{ id: string; slug: string }>(
    "INSERT INTO merchants (slug, name) VALUES ($1, 'Coffee Bar') RETURNING id, slug",
    [slug]
  );
  const merchant = merchantResult.rows[0];
  const staffResult = await pool.query<{ id: string }>(
    "INSERT INTO staff_users (merchant_id, email, password_hash, role) VALUES ($1, $2, 'hash', 'cashier') RETURNING id",
    [merchant.id, email]
  );
  const staff = staffResult.rows[0];
  const customerResult = await pool.query<{ id: string }>(
    "INSERT INTO customers (merchant_id, status) VALUES ($1, 'active') RETURNING id",
    [merchant.id]
  );
  const customer = customerResult.rows[0];
  const tokenResult = await pool.query<{ public_token: string }>(
    "INSERT INTO customer_tokens (merchant_id, customer_id, type, public_token, status) VALUES ($1, $2, 'qr', $3, 'active') RETURNING public_token",
    [merchant.id, customer.id, publicToken]
  );
  await pool.query(
    "INSERT INTO rewards (merchant_id, name, points_cost, active) VALUES ($1, 'Free Coffee', 50, true)",
    [merchant.id]
  );
  await pool.query(
    "INSERT INTO loyalty_rules_versions (merchant_id, version, points_per_dollar, rounding, promo_multiplier, active_from) VALUES ($1, 1, 10, 'floor', 1, now() - interval '1 day')",
    [merchant.id]
  );
  const jwtToken = jwt.sign(
    { merchant_id: merchant.id, role: "cashier" },
    jwtSecret,
    { subject: staff.id }
  );
  return {
    merchant,
    staff,
    customer,
    publicToken: tokenResult.rows[0].public_token,
    jwtToken
  };
};

describe("ledger idempotency and concurrency", () => {
  let app: ReturnType<typeof buildApp>;
  let baseUrl = "";

  before(async () => {
    await migrate();
    const module = await import("../src/app.js");
    app = module.buildApp({ logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address === "string" || !address) {
      throw new Error("Failed to bind server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  it("treats earn requests with the same idempotency key as idempotent", async () => {
    const seed = await seedMerchant();
    const payload = {
      public_token: seed.publicToken,
      amount: 12,
      idempotency_key: "earn-idem-1"
    };
    const response1 = await fetch(`${baseUrl}/earn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify(payload)
    });
    assert.equal(response1.status, 200);
    const result1 = await response1.json();
    assert.equal(result1.idempotent, false);

    const response2 = await fetch(`${baseUrl}/earn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify(payload)
    });
    assert.equal(response2.status, 200);
    const result2 = await response2.json();
    assert.equal(result2.idempotent, true);

    const ledgerEntries = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::int as count FROM ledger_entries WHERE merchant_id = $1 AND idempotency_key = $2",
      [seed.merchant.id, payload.idempotency_key]
    );
    assert.equal(Number(ledgerEntries.rows[0].count), 1);
  });

  it("prevents concurrent redeems from overspending the balance", async () => {
    const seed = await seedMerchant();
    const earnResponse = await fetch(`${baseUrl}/earn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify({
        public_token: seed.publicToken,
        amount: 5,
        idempotency_key: "earn-idem-2"
      })
    });
    assert.equal(earnResponse.status, 200);

    const rewardResult = await pool.query<{ id: string }>(
      "SELECT id FROM rewards WHERE merchant_id = $1 LIMIT 1",
      [seed.merchant.id]
    );
    const rewardId = rewardResult.rows[0].id;

    const redeem = (idempotency: string) =>
      fetch(`${baseUrl}/redeem`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${seed.jwtToken}`
        },
        body: JSON.stringify({
          public_token: seed.publicToken,
          reward_id: rewardId,
          idempotency_key: idempotency
        })
      });

    const [first, second] = await Promise.all([redeem("redeem-1"), redeem("redeem-2")]);
    const statuses = [first.status, second.status];
    assert.ok(statuses.includes(200));
    assert.ok(statuses.includes(409));

    const ledgerEntries = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::int as count FROM ledger_entries WHERE merchant_id = $1 AND type = 'redeem'",
      [seed.merchant.id]
    );
    assert.equal(Number(ledgerEntries.rows[0].count), 1);
  });

  it("returns idempotent response for repeated redemption keys", async () => {
    const seed = await seedMerchant();
    const rewardResult = await pool.query<{ id: string }>(
      "SELECT id FROM rewards WHERE merchant_id = $1 LIMIT 1",
      [seed.merchant.id]
    );
    const rewardId = rewardResult.rows[0].id;

    await fetch(`${baseUrl}/earn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify({
        public_token: seed.publicToken,
        amount: 10,
        idempotency_key: "earn-idem-3"
      })
    });

    const redeemPayload = {
      public_token: seed.publicToken,
      reward_id: rewardId,
      idempotency_key: "redeem-idem"
    };

    const response1 = await fetch(`${baseUrl}/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify(redeemPayload)
    });
    assert.equal(response1.status, 200);
    const result1 = await response1.json();
    assert.equal(result1.idempotent, false);

    const response2 = await fetch(`${baseUrl}/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seed.jwtToken}`
      },
      body: JSON.stringify(redeemPayload)
    });
    assert.equal(response2.status, 200);
    const result2 = await response2.json();
    assert.equal(result2.idempotent, true);
  });
});
