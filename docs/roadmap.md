# Roadmap & Build Order

## V1 build order (fast demo)

1. DB schema + migrations.
2. `/public/session/init` (merchant QR doorway logic).
3. Token issuance + `/c/:publicToken` page.
4. `/tokens/resolve` + minimal terminal UI.
5. Ledger + earn flow.
6. Rewards + redeem flow.
7. Wallet pass generation (Apple or Google first).
8. Claim/login flow (OTP/email).

## Must-build V1 checklist

- Merchant QR doorway (`/m/:slug`).
- QR generator in dashboard.
- Program setup (points + rewards).
- Device session handling.
- Token issuance + resolution.
- Customer card page + wallet add buttons.
- Rules engine (points).
- Ledger with idempotency + rate limits.
- Staff terminal mode + RBAC.

## Deferred (do not block launch)

- Rotating QR (V1.5).
- Wallet auto-updates + push notifications.
- Offline terminal queue.
- Fraud scoring.
- POS integrations (V2).
- Crypto NFC tags (NTAG424/DESFire).
- NFC Wallet tap (Apple VAS / Google Smart Tap).
- Multi-location enterprise tools.
