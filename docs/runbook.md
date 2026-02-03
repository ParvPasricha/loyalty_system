# Runbook (V1)

## Service health

- **API health**: `GET /metrics` for request and error counters.
- **Database**: confirm Postgres connectivity and ledger immutability trigger.
- **Queue/Redis**: confirm Redis is reachable (future wallet queue).

## Common alerts

### Elevated 5xx rate

1. Check `/metrics` error count growth.
2. Inspect API logs for `request_id` to isolate the failing route.
3. Verify Postgres availability (`pg_isready`) and connection saturation.

### Redeem/earn failures

1. Validate staff JWT is active (not disabled).
2. Check rate limiting counters and logs for `rateLimit` rejections.
3. Confirm rules versions are present and active in `loyalty_rules_versions`.

### Token resolve failures

1. Ensure `customer_tokens.status = 'active'` for the scanned token.
2. Verify token revokes in `audit_logs` for recent changes.

## Recovery playbooks

### Postgres restart

1. Restart database and run migrations if needed.
2. Verify `ledger_entries` immutability triggers still exist.
3. Re-run integration tests for earn/redeem idempotency.

### Rate limit tuning

1. Review per-route rate limit configuration in the API.
2. Increase limits for trusted IPs if needed and monitor `audit_logs`.

## Audit checks

- **Redemptions**: `action = 'redemption_created'`.
- **Adjustments**: `action = 'adjustment_created'`.
- **Rule changes**: `action = 'rules_version_created'`.
- **Token revokes**: `action = 'token_revoked'`.
- **Staff role changes**: `action = 'staff_role_changed'`.
