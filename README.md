# Loyalty Platform Monorepo

Universal, POS-agnostic loyalty system built with TypeScript across backend and frontend.

## Stack

- **Backend**: Node.js (NestJS or Fastify), TypeScript
- **Web apps**: Next.js (merchant portal, staff terminal, customer card)
- **Database**: PostgreSQL
- **Queue/Jobs**: Redis + BullMQ
- **Auth**: Auth.js or custom JWT sessions with RBAC
- **Infra**: Docker for local/dev, deploy to Fly.io / Render / AWS later

## Repository structure

```
loyalty-platform/
  apps/
    api/       # Node backend (NestJS or Fastify)
    web/       # Next.js merchant portal + customer pages
    terminal/  # Next.js staff terminal (or /terminal route in web)
  packages/
    shared/    # shared types, validation schemas, utilities
    db/        # migrations + SQL helpers
    sdk/       # optional POS adapter SDK (future)
  infra/
    docker/
    nginx/
  docs/
```

## Core principles

- **Multi-tenant**: every entity is scoped by `merchant_id`.
- **One customer identity**: tokens resolve to a single customer and ledger.
- **Ledger is truth**: all balance changes are immutable ledger entries.
- **Token privacy**: public tokens never expose `customer_id`.

## Key documents

- [Architecture overview](docs/architecture.md)
- [API surface](docs/api.md)
- [Data model](docs/data-model.md)
- [Security & abuse prevention](docs/security.md)
- [Roadmap & build order](docs/roadmap.md)

## Initial build sequence

1. Database schema + migrations.
2. `/public/session/init` (merchant QR doorway logic).
3. Customer token issuance + `/c/:publicToken` page.
4. `/tokens/resolve` + minimal terminal UI.
5. Ledger + earn/redeem.
6. Wallet pass generation (Apple/Google).
7. Claim/login flow (OTP/email).

## Development

- `pnpm dev` for web/terminal
- `pnpm dev` for api

(Exact scripts will be defined per-app as they are scaffolded.)

## Testing

- `pnpm test` runs integration tests against Postgres/Redis via Docker Compose.
