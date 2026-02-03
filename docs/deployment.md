# Deployment guide (V1)

## Prerequisites

- Node.js 20+
- Postgres 16+
- Redis 7+

## Environment variables

- `DATABASE_URL` (Postgres connection string)
- `JWT_ACCESS_SECRET` (JWT signing secret)
- `PORT` (API port, default `3001`)
- `NODE_ENV` (`production` enables secure cookies)

## Build and run

```bash
pnpm install
pnpm build
pnpm --filter @loyalty/api start
```

## Production checklist

- Run migrations from `packages/db/migrations/001_init.sql`.
- Ensure `audit_logs` retention meets compliance.
- Confirm rate limits align with expected traffic.
- Validate `/metrics` endpoint visibility in staging.
