WITH new_merchant AS (
  INSERT INTO merchants (slug, name)
  VALUES ('demo-merchant', 'Demo Merchant')
  RETURNING id
),
new_staff AS (
  INSERT INTO staff_users (merchant_id, email, password_hash, role)
  SELECT id, 'owner@demo.local', 'dev-only', 'owner'
  FROM new_merchant
  RETURNING id
)
INSERT INTO loyalty_rules_versions (
  merchant_id,
  version,
  points_per_dollar,
  rounding,
  promo_multiplier,
  active_from
)
SELECT id, 1, 1, 'floor', 1, now()
FROM new_merchant;
