# Security & Abuse Prevention

## Access control

- Roles: `owner`, `manager`, `cashier`.
- Cashier permissions: resolve, earn, redeem.
- Manager/owner: rewards, rules, settings.
- Owner-only: adjustments, token revokes.

## Token security

- `public_token` is random (>= 128-bit) and never equals `customer_id`.
- Token status checked on every resolve.
- Token revoke endpoint required.
- Optional V1.5: rotating QR (30–60s TTL, HMAC + nonce).

## Transaction integrity

- Server authoritative for points calculation.
- Idempotency keys for earn/redeem.
- Atomic redemption with transaction + `SELECT ... FOR UPDATE`.
- Optional one-time redemption token (short TTL).

## Rate limits

- Token resolve: per IP, per merchant, per token.
- Earn/redeem: per token, per staff, per terminal.
- Public endpoints stricter than staff endpoints.

## Auditability

Audit logs for:
- adjustments
- redemptions
- rule changes
- token revokes
- staff role changes

## Data protection

- Never expose internal IDs.
- Hash sensitive identifiers for lookup (phone/email).
- Encrypt PII at rest (or keep PII minimal in V1).
- Secure cookies: `HttpOnly`, `Secure`, `SameSite`.

## Web app security

- Validate inputs with Zod or equivalent.
- CSRF protection for cookie sessions.
- Security headers: CSP, HSTS, frame-ancestors, X-Content-Type-Options.
- Sanitize user-generated text rendered in UI.

## Webhook protection (POS integrations)

- Verify vendor signatures (HMAC/RSA).
- Idempotent handling via unique `(merchant_id, source, external_id, event_type)`.
- Store integration secrets in a secure vault.
