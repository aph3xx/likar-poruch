#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET="/home/sgdt1a/.local/share/likar-poruch-site"
SITE_URL="https://sur.kyiv.ua"
LIVE_URL="https://sur.kyiv.ua:10443/likar-poruch/"

cd "$REPO_ROOT"

fail() {
  printf 'deploy:sur: %s\n' "$*" >&2
  exit 1
}

[[ $(git branch --show-current) == "main" ]] || fail "deploy only from main"
[[ -z $(git status --porcelain) ]] || fail "worktree must be clean before deployment"

git fetch origin main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)
[[ "$LOCAL_SHA" == "$REMOTE_SHA" ]] || fail "HEAD must equal origin/main before deployment"

export PUBLIC_SITE_URL="$SITE_URL"
npm run check
npm test
npm audit --omit=dev
git diff --check

PARENT=$(dirname "$TARGET")
mkdir -p "$PARENT"
NEXT=$(mktemp -d "$PARENT/.likar-poruch-site.next.XXXXXX")
PREVIOUS="$PARENT/.likar-poruch-site.previous"
LIVE_BODY=$(mktemp)
SMOKE_BODY=""
BACKEND_INSTALL_DIR="${BOOKING_INSTALL_DIR:-/home/sgdt1a/.local/share/likar-poruch-booking}"
BACKEND_UNIT_PATH="${SYSTEMD_DIR:-/home/sgdt1a/.config/systemd/user}/likar-poruch-booking.service"
BACKEND_SNAPSHOT=$(mktemp -d)
BACKEND_CADDYFILE="${CADDYFILE:-/home/sgdt1a/infrastructure/sur-hub/Caddyfile}"
BACKEND_ENV_FILE="${BOOKING_ENV_FILE:-/home/sgdt1a/.config/likar-poruch-booking/environment}"
BACKEND_STATE_DIR="$BACKEND_INSTALL_DIR/state"
BACKEND_SYSTEMD_DIR="$(dirname "$BACKEND_UNIT_PATH")"
BACKEND_SYSTEMD_WANTS_DIR="$BACKEND_SYSTEMD_DIR/default.target.wants"
BACKEND_ENV_DIR="$(dirname "$BACKEND_ENV_FILE")"
BACKEND_ACTIVE_BEFORE=$(systemctl --user is-active likar-poruch-booking.service 2>/dev/null || true)
BACKEND_ENABLED_BEFORE=$(systemctl --user is-enabled likar-poruch-booking.service 2>/dev/null || true)
PROMOTED=0
BACKEND_CADDY_BEFORE=0
BACKEND_INSTALL_DIR_BEFORE=0
BACKEND_STATE_DIR_BEFORE=0
BACKEND_SYSTEMD_DIR_BEFORE=0
BACKEND_SYSTEMD_WANTS_DIR_BEFORE=0
BACKEND_ENV_DIR_BEFORE=0
[[ -d "$BACKEND_INSTALL_DIR" ]] && BACKEND_INSTALL_DIR_BEFORE=1
[[ -d "$BACKEND_STATE_DIR" ]] && BACKEND_STATE_DIR_BEFORE=1
[[ -d "$BACKEND_SYSTEMD_DIR" ]] && BACKEND_SYSTEMD_DIR_BEFORE=1
[[ -d "$BACKEND_SYSTEMD_WANTS_DIR" ]] && BACKEND_SYSTEMD_WANTS_DIR_BEFORE=1
[[ -d "$BACKEND_ENV_DIR" ]] && BACKEND_ENV_DIR_BEFORE=1
[[ -f "$BACKEND_CADDYFILE" ]] && BACKEND_CADDY_BEFORE=1
[[ -f "$BACKEND_INSTALL_DIR/booking_service.py" ]] && cp "$BACKEND_INSTALL_DIR/booking_service.py" "$BACKEND_SNAPSHOT/booking_service.py"
[[ -f "$BACKEND_UNIT_PATH" ]] && cp "$BACKEND_UNIT_PATH" "$BACKEND_SNAPSHOT/unit"
[[ -f "$BACKEND_CADDYFILE" ]] && cp "$BACKEND_CADDYFILE" "$BACKEND_SNAPSHOT/Caddyfile"
[[ -f "$BACKEND_ENV_FILE" ]] && cp "$BACKEND_ENV_FILE" "$BACKEND_SNAPSHOT/environment"
cleanup() {
  rm -rf "$NEXT"
  rm -f "$LIVE_BODY" "$SMOKE_BODY"
  rm -rf "$BACKEND_SNAPSHOT"
}
trap cleanup EXIT

cp -a dist/. "$NEXT/"
printf '{"commit":"%s","deployed_at":"%s","origin":"%s"}\n' \
  "$LOCAL_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SITE_URL" > "$NEXT/release.json"

EXPECTED_HASH=$(sha256sum "$NEXT/index.html" | cut -d' ' -f1)

rollback() {
  local backend_rollback_failed=0
  trap - ERR
  if [[ "$BACKEND_ACTIVE_BEFORE" == active || ( ! -f "$BACKEND_SNAPSHOT/unit" && -e "$BACKEND_UNIT_PATH" ) ]]; then systemctl --user stop likar-poruch-booking.service >/dev/null 2>&1 || backend_rollback_failed=1; fi
  if [[ -f "$BACKEND_SNAPSHOT/booking_service.py" ]]; then cp "$BACKEND_SNAPSHOT/booking_service.py" "$BACKEND_INSTALL_DIR/booking_service.py" || backend_rollback_failed=1; else rm -f "$BACKEND_INSTALL_DIR/booking_service.py" || backend_rollback_failed=1; fi
  if [[ -f "$BACKEND_SNAPSHOT/unit" ]]; then
    cp "$BACKEND_SNAPSHOT/unit" "$BACKEND_UNIT_PATH" || backend_rollback_failed=1
  fi
  if [[ -f "$BACKEND_SNAPSHOT/Caddyfile" ]]; then cp "$BACKEND_SNAPSHOT/Caddyfile" "$BACKEND_CADDYFILE" || backend_rollback_failed=1; else rm -f "$BACKEND_CADDYFILE" || backend_rollback_failed=1; fi
  if [[ -f "$BACKEND_SNAPSHOT/environment" ]]; then cp "$BACKEND_SNAPSHOT/environment" "$BACKEND_ENV_FILE" || backend_rollback_failed=1; else rm -f "$BACKEND_ENV_FILE" || backend_rollback_failed=1; fi
  systemctl --user daemon-reload >/dev/null 2>&1 || backend_rollback_failed=1
  if [[ -f "$BACKEND_SNAPSHOT/unit" ]]; then
    if [[ "$BACKEND_ENABLED_BEFORE" == enabled ]]; then systemctl --user enable likar-poruch-booking.service >/dev/null 2>&1 || backend_rollback_failed=1; else systemctl --user disable likar-poruch-booking.service >/dev/null 2>&1 || backend_rollback_failed=1; fi
    if [[ "$BACKEND_ACTIVE_BEFORE" == active ]]; then systemctl --user start likar-poruch-booking.service >/dev/null 2>&1 || backend_rollback_failed=1; fi
  else
    # Clear systemd enablement while the newly installed unit still exists;
    # removing it first leaves a dangling wants symlink behind.
    if [[ -e "$BACKEND_UNIT_PATH" ]]; then systemctl --user disable likar-poruch-booking.service >/dev/null 2>&1 || backend_rollback_failed=1; fi
    rm -f "$BACKEND_UNIT_PATH" || backend_rollback_failed=1
  fi
  [[ "$(systemctl --user is-active likar-poruch-booking.service 2>/dev/null || true)" == "$BACKEND_ACTIVE_BEFORE" ]] || backend_rollback_failed=1
  [[ "$(systemctl --user is-enabled likar-poruch-booking.service 2>/dev/null || true)" == "$BACKEND_ENABLED_BEFORE" ]] || backend_rollback_failed=1
  if [[ "$BACKEND_CADDY_BEFORE" == 1 ]]; then
    cmp -s "$BACKEND_SNAPSHOT/Caddyfile" "$BACKEND_CADDYFILE" || backend_rollback_failed=1
    "${CADDY_BIN:-$HOME/.local/bin/caddy}" validate --config "$BACKEND_CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || backend_rollback_failed=1
    systemctl --user reload sur-hub-gateway.service >/dev/null 2>&1 || backend_rollback_failed=1
  fi
  if [[ "$BACKEND_INSTALL_DIR_BEFORE" == 0 && -d "$BACKEND_INSTALL_DIR" ]]; then rm -rf "$BACKEND_INSTALL_DIR" || backend_rollback_failed=1; fi
  if [[ "$BACKEND_STATE_DIR_BEFORE" == 0 && -d "$BACKEND_STATE_DIR" ]]; then rm -rf "$BACKEND_STATE_DIR" || backend_rollback_failed=1; fi
  if [[ "$BACKEND_SYSTEMD_WANTS_DIR_BEFORE" == 0 && -d "$BACKEND_SYSTEMD_WANTS_DIR" ]]; then rmdir "$BACKEND_SYSTEMD_WANTS_DIR" 2>/dev/null || backend_rollback_failed=1; fi
  if [[ "$BACKEND_SYSTEMD_DIR_BEFORE" == 0 && -d "$BACKEND_SYSTEMD_DIR" ]]; then rmdir "$BACKEND_SYSTEMD_DIR" 2>/dev/null || backend_rollback_failed=1; fi
  if [[ "$BACKEND_ENV_DIR_BEFORE" == 0 && -d "$BACKEND_ENV_DIR" ]]; then rmdir "$BACKEND_ENV_DIR" 2>/dev/null || backend_rollback_failed=1; fi
  [[ "$backend_rollback_failed" == 0 ]] || fail "$1; backend rollback failed closed"
  if [[ "$PROMOTED" == "1" ]]; then
    rm -rf "$TARGET"
    if [[ -e "$PREVIOUS" ]]; then
      mv "$PREVIOUS" "$TARGET"
    fi
  fi
  if [[ "$PROMOTED" == "1" ]]; then fail "$1; previous artifact restored"; fi
  fail "$1; live artifact preserved"
}
trap 'rollback "unexpected deployment failure"' ERR

# Install backend and gateway before any user-facing smoke. The installer is
# transactional, so failures cannot leave a mixed gateway.
if [[ "${SKIP_BOOKING_BACKEND:-0}" != "1" ]]; then
  bash "$REPO_ROOT/scripts/install-booking-backend.sh" "$REPO_ROOT" || rollback "booking backend install failed"
  SMOKE_DB="${BOOKING_DB:-/home/sgdt1a/.local/share/likar-poruch-booking/state/booking.sqlite3}"
  SMOKE_TOKEN="${BOOKING_SMOKE_TOKEN:-}"
  [[ -n "$SMOKE_TOKEN" ]] || rollback "BOOKING_SMOKE_TOKEN is required for smoke cleanup"
  SMOKE_BODY=$(mktemp)
  SMOKE_DATE=$(TZ=Europe/Kyiv date -d 'tomorrow' +%F)
  SMOKE_NAME="SUR smoke $(date +%s)"
  SMOKE_PHONE="+380671234567"
  SMOKE_STATUS=$(curl --silent --show-error --output "$SMOKE_BODY" --write-out '%{http_code}' \
    --resolve sur.kyiv.ua:10443:127.0.0.1 \
    -H 'Content-Type: application/json' \
    -H "X-Booking-Smoke-Token: $SMOKE_TOKEN" \
    --data "{\"name\":\"$SMOKE_NAME\",\"phone\":\"$SMOKE_PHONE\",\"date\":\"$SMOKE_DATE\"}" \
    "$LIVE_URL/api/booking-requests")
  [[ "$SMOKE_STATUS" == 201 ]] || rollback "SUR booking smoke returned HTTP $SMOKE_STATUS"
  if ! SMOKE_ID=$(python3 - "$SMOKE_BODY" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
assert set(payload) == {"id", "status"} and payload["status"] == "pending"
print(payload["id"])
PY
  ); then rollback "SUR booking smoke returned an invalid response"; fi
  if ! python3 - "$SMOKE_DB" "$SMOKE_ID" "$SMOKE_NAME" "$SMOKE_PHONE" "$SMOKE_DATE" <<'PY'
import sqlite3, sys
db, request_id, name, phone, requested_date = sys.argv[1:]
with sqlite3.connect(db) as connection:
    row = connection.execute("SELECT id, name, phone, requested_date, status, is_smoke FROM booking_requests WHERE id = ?", (request_id,)).fetchone()
    assert row == (request_id, name, phone, requested_date, "pending", 1), row
PY
  then rollback "SUR booking smoke row verification failed"; fi
  curl --fail --silent --show-error -X DELETE \
    --resolve sur.kyiv.ua:10443:127.0.0.1 \
    -H "X-Booking-Maintenance-Token: $SMOKE_TOKEN" \
    "$LIVE_URL/api/booking-requests/$SMOKE_ID" >/dev/null || rollback "SUR booking smoke cleanup failed"
  if ! python3 - "$SMOKE_DB" "$SMOKE_ID" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as connection:
    assert connection.execute("SELECT 1 FROM booking_requests WHERE id = ?", (sys.argv[2],)).fetchone() is None
PY
  then rollback "SUR booking smoke cleanup row remained"; fi
fi

# Promote the static artifact only after the backend is installed and healthy.
rm -rf "$PREVIOUS"
if [[ -e "$TARGET" ]]; then mv "$TARGET" "$PREVIOUS"; fi
mv "$NEXT" "$TARGET"
PROMOTED=1
DEPLOYED_HASH=$(sha256sum "$TARGET/index.html" | cut -d' ' -f1)
[[ "$DEPLOYED_HASH" == "$EXPECTED_HASH" ]] || rollback "deployed artifact hash mismatch"
if ! curl --fail --silent --show-error --resolve sur.kyiv.ua:10443:127.0.0.1 "$LIVE_URL" -o "$LIVE_BODY"; then
  rollback "live gateway request failed"
fi
LIVE_HASH=$(sha256sum "$LIVE_BODY" | cut -d' ' -f1)
[[ "$LIVE_HASH" == "$EXPECTED_HASH" ]] || rollback "live gateway does not serve the new artifact"

if ! QA_BASE_URL="https://sur.kyiv.ua:10443/likar-poruch" \
  QA_HOST_RESOLVER_RULES="MAP sur.kyiv.ua 127.0.0.1" \
  QA_MOCK_BOOKING=0 \
  QA_BOOKING_SMOKE_TOKEN="${BOOKING_SMOKE_TOKEN:-}" \
  npm run qa:browser; then
  rollback "live gateway browser QA failed"
fi

rm -rf "$PREVIOUS"
printf 'Deployed commit %s to %s\n' "$LOCAL_SHA" "https://sur.kyiv.ua/likar-poruch/"
printf 'Verified index SHA-256: %s\n' "$LIVE_HASH"
