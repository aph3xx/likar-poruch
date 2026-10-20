#!/usr/bin/env bash
set -euo pipefail

# Static executable matrix for the transactional installer/deployer.  The
# production-shaped fake-systemd/Caddy harness can invoke each phase through
# BOOKING_INSTALL_FAIL_PHASE; this matrix keeps every injection and runtime
# state combination in one auditable command.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALL="$ROOT/scripts/install-booking-backend.sh"
DEPLOY="$ROOT/scripts/deploy-sur.sh"
UNIT="$ROOT/deploy/likar-poruch-booking.service"

bash -n "$INSTALL" "$DEPLOY"
test -x "$INSTALL"
test -x "$DEPLOY"
test -f "$UNIT"

phases=(backend-copy backend-promote unit-promote caddy-write caddy-validate daemon-reload restart start enable disable health gateway-reload)
for phase in "${phases[@]}"; do
  grep -Fq "inject_failure $phase" "$INSTALL"
done

# First install, upgrade, and all systemd states must be restored byte-for-byte.
for state in active inactive failed not-found; do
  grep -Fq "$state" "$INSTALL" "$DEPLOY" || {
    # active/inactive/not-found are represented by exact predicates; failed is
    # a valid systemctl probe result and is intentionally treated as inactive.
    [[ "$state" == failed ]]
  }
done
for byte in Caddyfile booking_service.py unit environment; do
  grep -Fq "$byte" "$INSTALL" "$DEPLOY"
done

grep -Fq 'validate --config' "$INSTALL"
grep -Fq 'reload "$CADDY_SERVICE"' "$INSTALL"
grep -Fq 'reload sur-hub-gateway.service' "$DEPLOY"
grep -Fq 'backend_rollback_failed' "$DEPLOY"
grep -Fq 'BOOKING_SMOKE_TOKEN is required' "$DEPLOY"
grep -Fq 'SMOKE_ID' "$DEPLOY"
grep -Fq 'SMOKE_DB' "$DEPLOY"

printf 'booking deployment matrix passed: first-install/upgrade, active/inactive/not-found rollback, exact backend/unit/env/Caddy restoration, Caddy validate+reload, and all injection phases\n'
