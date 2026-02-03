WITH new_merchant AS (
  INSERT INTO merchants (slug, name)
  VALUES ('demo-merchant', 'Demo Merchant')
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
