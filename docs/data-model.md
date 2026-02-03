# Data Model (V1)

## Tables

### merchants
- `id` (UUID)
- `slug`
- `name`
- `created_at`

### staff_users
- `id`
- `merchant_id`
- `email`
- `role` (`owner` | `manager` | `cashier`)
- `created_at`

### customers
- `id`
- `status` (`active` | `blocked`)
- `created_at`

### customer_tokens
- `id`
- `customer_id`
- `merchant_id`
- `type` (`qr` | `barcode` | `nfc` | `apple_wallet` | `google_wallet` | `samsung_wallet`)
- `public_token`
- `metadata` (json)
- `status` (`active` | `revoked`)
- `issued_at`
- `revoked_at`

### customer_devices
- `id`
- `customer_id`
- `merchant_id`
- `device_id` (UUID)
- `last_seen`

### ledger_entries
- `id`
- `customer_id`
- `merchant_id`
- `type` (`earn` | `redeem` | `adjust` | `expire` | `reversal`)
- `points_delta`
- `source` (`terminal` | `pos` | `admin`)
- `external_id` (POS order id, optional)
- `idempotency_key`
- `created_at`

### rewards
- `id`
- `merchant_id`
- `name`
- `points_cost`
- `status`
- `created_at`

### redemptions
- `id`
- `merchant_id`
- `customer_id`
- `reward_id`
- `points_cost`
- `created_at`

### audit_logs
- `id`
- `merchant_id`
- `staff_user_id`
- `action`
- `metadata` (json)
- `created_at`

## Constraints (non-negotiable)

- Idempotency: unique `(merchant_id, idempotency_key)` on ledger writes.
- Token uniqueness: unique `(merchant_id, public_token)`.
- NFC uniqueness: unique `(merchant_id, nfc_uid)` where stored.
- Ledger immutability: no deletes, only reversal entries.
