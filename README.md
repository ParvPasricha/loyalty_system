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

## Local testing workflow

1. Start infra services:
   - `docker compose -f infra/docker/docker-compose.yml up`
2. Apply migrations + seed:
   - `psql "$DATABASE_URL" -f packages/db/migrations/001_init.sql`
   - `psql "$DATABASE_URL" -f packages/db/seed/001_seed.sql`
3. Start the API:
   - `pnpm --filter @loyalty/api dev`
4. Start the web apps:
   - `pnpm --filter @loyalty/web dev`
   - `pnpm --filter @loyalty/terminal dev`
5. Issue a staff JWT for testing staff endpoints:
   - Set `MERCHANT_ID` + `STAFF_USER_ID` from the seeded demo merchant/user.
   - Run `pnpm --filter @loyalty/api exec tsx scripts/issue-token.ts`
6. Use the JWT as `Authorization: Bearer <token>` on staff endpoints.

## Delivery status

### Done (dev scaffolding)

- Monorepo layout with apps/packages structure in place.
- PostgreSQL schema migrations + seed scripts for core domain tables.
- Local Docker Compose for Postgres + Redis.
- Fastify API scaffold with JWT/RBAC, Zod validation, and core route stubs.
- Next.js web apps for customer doorway/card/claim, portal, and terminal screens.

### To reach testing readiness

- Wire real auth flows (staff login, JWT rotation, RBAC guards with real users).
- Replace in-memory claim verification with durable OTP/email workflow + storage.
- Implement ledger balance guards, idempotency handling, and redemption atomicity checks with consistent error codes.
- Add rate limiting + denylist + anomaly logging based on persistent stores.
- Implement wallet pass generation and job queue processing (BullMQ).
- Add request/response OpenAPI coverage and centralized error response format.
- Add comprehensive unit/integration tests + fixtures, and CI pipelines (lint/typecheck/test/build).
- Add CSP/security headers and production HTTPS configuration for web apps.

### To reach ship readiness

- Complete staff terminal workflows (scan → resolve → earn/redeem → success).
- Complete merchant portal onboarding wizard and staff/reward management.
- Finish customer claim/restore flows with wallet re-issue.
- Build production logging/metrics + alerting dashboards.
- Run acceptance tests and load testing for idempotency/redeem concurrency.
- Complete deployment manifests (Fly/Render) and production secrets management.
