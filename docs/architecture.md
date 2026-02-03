# Architecture Overview

## Product model

The platform provides a universal loyalty identity that can be presented as QR, barcode,
NFC, or wallet passes. All presentations resolve to the same `customer_id` and the same
ledger for a given merchant.

## High-level flow

1. **Identify**
   - Resolve a token to a customer.
2. **Authorize**
   - Validate token status + rate limits + RBAC.
3. **Apply**
   - Calculate points and rewards server-side.
4. **Ledger**
   - Write immutable ledger entry and enqueue wallet updates.

## Core modules

### Multi-tenant core

- Every request has a `merchant_context`.
- Staff users belong to a merchant.
- Tokens are issued per merchant.

### Identity & token system

Token types:
`qr`, `barcode`, `nfc`, `apple_wallet`, `google_wallet`, `samsung_wallet`.

Core functions:

- `issueToken(customer_id, merchant_id, type)`
- `resolveToken(merchant_id, presented_token) -> customer_id`
- `revokeToken(token_id)`
- `bindNfc(merchant_id, nfc_uid, customer_id)`

### Merchant QR doorway

Static QR for each merchant:

`/m/:merchantSlug`

Flow:

1. Client calls `POST /public/session/init`.
2. API checks device cookie/localStorage `device_id`.
3. If known, return existing customer token.
4. Else create anonymous customer + new token and bind device.
5. Redirect to `/c/:publicToken`.

### Ledger

All balance changes are immutable ledger entries:
`earn`, `redeem`, `adjust`, `reversal`, `expire`.

Balance = sum of ledger entries (or cached safely with source of truth in ledger).

### Rules engine

V1 rules:

- `points_per_dollar`
- `rounding` (`floor` or `nearest`)
- optional `promo_multiplier`

Rules are versioned so historical transactions remain accurate.

### Staff terminal

UI is a thin layer over:

- `POST /tokens/resolve`
- `POST /earn`
- `POST /redeem`

Optimized for scanner + keyboard-only flow.

### Wallet passes

V1 wallet passes are static QR/barcodes that contain `public_token`.
Wallet updates are queued on ledger changes.

## Operating modes

- **Mode A (POS-agnostic)**: merchant uses staff terminal web app.
- **Mode B (POS-integrated)**: POS sends webhooks mapped to canonical events.
