CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','cashier')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz NULL
);
CREATE UNIQUE INDEX staff_users_merchant_email_uq ON staff_users(merchant_id, email);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active','blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_devices_merchant_device_uq ON customer_devices(merchant_id, device_id);
CREATE INDEX customer_devices_merchant_device_idx ON customer_devices(merchant_id, device_id);

CREATE TABLE customer_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('qr','barcode','nfc','apple_wallet','google_wallet','samsung_wallet')),
  public_token text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);
CREATE UNIQUE INDEX customer_tokens_merchant_public_token_uq ON customer_tokens(merchant_id, public_token);
CREATE INDEX customer_tokens_merchant_public_token_idx ON customer_tokens(merchant_id, public_token);

CREATE TABLE loyalty_rules_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  version int NOT NULL,
  points_per_dollar numeric NOT NULL,
  rounding text NOT NULL CHECK (rounding IN ('floor','nearest')),
  promo_multiplier numeric NOT NULL DEFAULT 1,
  active_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_rules_versions_merchant_version_uq ON loyalty_rules_versions(merchant_id, version);

CREATE TABLE rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  points_cost int NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('earn','redeem','adjust','reversal','expire')),
  points_delta int NOT NULL,
  source text NOT NULL CHECK (source IN ('terminal','pos','admin')),
  external_id text NULL,
  rules_version_id uuid NULL REFERENCES loyalty_rules_versions(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_merchant_idempotency_uq UNIQUE (merchant_id, idempotency_key)
);
CREATE INDEX ledger_entries_merchant_customer_created_idx ON ledger_entries(merchant_id, customer_id, created_at);

CREATE TABLE redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES rewards(id),
  points_cost int NOT NULL,
  status text NOT NULL CHECK (status IN ('approved','reversed')),
  one_time_token text NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX redemptions_merchant_customer_created_idx ON redemptions(merchant_id, customer_id, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  staff_user_id uuid NULL REFERENCES staff_users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update
BEFORE UPDATE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TRIGGER ledger_no_delete
BEFORE DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
