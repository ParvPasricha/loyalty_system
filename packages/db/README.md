# Database Package

SQL migrations and seed data for the loyalty platform.

## Structure

- `migrations/`: schema migrations (PostgreSQL).
- `seed/`: seed scripts for local/dev environments.

## Usage

Run migrations with your preferred migration tool (e.g. `psql` or a migration runner).

```
psql "$DATABASE_URL" -f migrations/001_init.sql
psql "$DATABASE_URL" -f seed/001_seed.sql
```

Seed data includes a demo merchant and an owner staff user (`owner@demo.local`, password hash placeholder `dev-only`) for local testing.
