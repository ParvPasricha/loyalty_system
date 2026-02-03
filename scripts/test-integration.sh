#!/usr/bin/env bash
set -euo pipefail

compose_file="infra/docker-compose.test.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run integration tests." >&2
  exit 1
fi

docker compose -f "$compose_file" up -d
trap 'docker compose -f "$compose_file" down -v' EXIT

until docker compose -f "$compose_file" exec -T postgres pg_isready -U loyalty >/dev/null 2>&1; do
  sleep 1
done

export DATABASE_URL="postgres://loyalty:loyalty@localhost:5432/loyalty_test"
export JWT_ACCESS_SECRET="test_secret"

pnpm --filter @loyalty/api test:integration
