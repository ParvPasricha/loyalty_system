# API Surface (V1)

## Public/customer

- `POST /public/session/init`
  - Returns existing or newly issued `public_token`.
  - Uses device cookies/localStorage `device_id` to restore customers.

- `GET /public/card/:publicToken`
  - Returns points balance, rewards, and merchant branding.

- `POST /public/claim/start`
  - Begins OTP/email claim flow.

- `POST /public/claim/verify`
  - Verifies claim, attaches identity to customer.

## Tokens

- `POST /tokens/resolve`
  - Resolves presented token to customer.

- `POST /tokens/revoke`
  - Revokes a token (admin-only).

- `POST /tokens/bind-nfc`
  - Binds an NFC UID to a customer.

## Loyalty

- `POST /earn`
  - Server-calculated points, idempotent, rate limited.

- `POST /redeem`
  - Atomic redemption (transaction + locking).

- `GET /customers/:id/balance`
  - Returns computed balance.

- `GET /customers/:id/ledger`
  - Returns ledger entries.

## Merchant portal

- `GET /merchant/settings`
- `POST /merchant/settings`
- `GET /merchant/rewards`
- `POST /merchant/rewards`
- `GET /merchant/qr`
  - Returns QR payload + PNG.

## Wallet

- `GET /wallet/apple/:publicToken` (pkpass)
- `GET /wallet/google/:publicToken` (add link)
- `GET /wallet/samsung/:publicToken` (stub for later)
