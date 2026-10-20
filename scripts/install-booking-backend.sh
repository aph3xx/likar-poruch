#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
USER_HOME=${BOOKING_USER_HOME:-/home/sgdt1a}
INSTALL_DIR=${BOOKING_INSTALL_DIR:-"$USER_HOME/.local/share/likar-poruch-booking"}
STATE_DIR="$INSTALL_DIR/state"
SYSTEMD_DIR=${SYSTEMD_DIR:-"$USER_HOME/.config/systemd/user"}
BOOKING_ENV_FILE=${BOOKING_ENV_FILE:-"$USER_HOME/.config/likar-poruch-booking/environment"}
BOOKING_ENV_DIR=$(dirname "$BOOKING_ENV_FILE")
UNIT_NAME=likar-poruch-booking.service
CADDYFILE=${CADDYFILE:-"$USER_HOME/infrastructure/sur-hub/Caddyfile"}
CADDY_BIN=${CADDY_BIN:-"$USER_HOME/.local/bin/caddy"}
CADDY_SERVICE=${CADDY_SERVICE:-sur-hub-gateway.service}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8787/health}
MARKER_START='# BEGIN LIKAR-PORUCH BOOKING API (managed)'
MARKER_END='# END LIKAR-PORUCH BOOKING API (managed)'
UNIT_PATH="$SYSTEMD_DIR/$UNIT_NAME"
BACKUP_DIR=$(mktemp -d)
ROLLBACK_ACTIVE=0
INSTALL_DIR_BEFORE=0
STATE_DIR_BEFORE=0
SYSTEMD_DIR_BEFORE=0
BOOKING_ENV_DIR_BEFORE=0
[[ -d "$INSTALL_DIR" ]] && INSTALL_DIR_BEFORE=1
[[ -d "$STATE_DIR" ]] && STATE_DIR_BEFORE=1
[[ -d "$SYSTEMD_DIR" ]] && SYSTEMD_DIR_BEFORE=1
[[ -d "$BOOKING_ENV_DIR" ]] && BOOKING_ENV_DIR_BEFORE=1
ACTIVE_BEFORE=$(systemctl --user is-active "$UNIT_NAME" 2>/dev/null || true)
ENABLED_BEFORE=$(systemctl --user is-enabled "$UNIT_NAME" 2>/dev/null || true)

fail() { printf 'booking install: %s\n' "$*" >&2; exit 1; }
inject_failure() {
  [[ "${BOOKING_INSTALL_FAIL_PHASE:-}" != "$1" ]] && return 0
  if [[ "$ROLLBACK_ACTIVE" == "1" ]]; then
    rollback "injected failure at $1"
  fi
  fail "injected failure at $1"
}
cleanup() { rm -rf "$BACKUP_DIR"; }
trap cleanup EXIT
trap 'if [[ "$ROLLBACK_ACTIVE" == "1" ]]; then rollback "unexpected installation failure"; fi' ERR
[[ -f "$REPO_ROOT/backend/booking_service.py" ]] || fail "backend source not found"
command -v systemctl >/dev/null || fail "systemctl is required"
command -v curl >/dev/null || fail "curl is required"
[[ -x "$CADDY_BIN" ]] || fail "Caddy binary not found: $CADDY_BIN"
[[ -f "$CADDYFILE" ]] || fail "Caddyfile not found: $CADDYFILE"

mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$SYSTEMD_DIR"
mkdir -p "$(dirname "$BOOKING_ENV_FILE")"
chmod 755 "$INSTALL_DIR"
chmod 700 "$STATE_DIR"
cp "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
[[ -f "$INSTALL_DIR/booking_service.py" ]] && cp "$INSTALL_DIR/booking_service.py" "$BACKUP_DIR/booking_service.py"
[[ -f "$UNIT_PATH" ]] && cp "$UNIT_PATH" "$BACKUP_DIR/unit"
[[ -f "$BOOKING_ENV_FILE" ]] && cp "$BOOKING_ENV_FILE" "$BACKUP_DIR/environment"
rollback() {
  local reason=$1
  ROLLBACK_ACTIVE=0
  trap - ERR
  set +e
  local rollback_failed=0
  rm -f "$INSTALL_DIR/booking_service.py.new" "$UNIT_PATH.new"
  if [[ "$ACTIVE_BEFORE" == active || ! -f "$BACKUP_DIR/unit" ]]; then systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; fi
  if [[ -f "$BACKUP_DIR/booking_service.py" ]]; then cp "$BACKUP_DIR/booking_service.py" "$INSTALL_DIR/booking_service.py" || rollback_failed=1; else rm -f "$INSTALL_DIR/booking_service.py" || rollback_failed=1; fi
  if [[ -f "$BACKUP_DIR/unit" ]]; then
    cp "$BACKUP_DIR/unit" "$UNIT_PATH" || rollback_failed=1
  else
    # systemd must clear enablement while the newly installed unit still
    # exists; removing it first leaves a stale enabled state behind.
    if [[ -e "$UNIT_PATH" ]]; then systemctl --user disable "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; fi
    rm -f "$UNIT_PATH" || rollback_failed=1
  fi
  if [[ -f "$BACKUP_DIR/environment" ]]; then cp "$BACKUP_DIR/environment" "$BOOKING_ENV_FILE" || rollback_failed=1; else rm -f "$BOOKING_ENV_FILE" || rollback_failed=1; fi
  cp "$BACKUP_DIR/Caddyfile" "$CADDYFILE" || rollback_failed=1
  systemctl --user daemon-reload >/dev/null 2>&1 || rollback_failed=1
  if [[ -f "$BACKUP_DIR/unit" ]]; then
    if [[ "$ENABLED_BEFORE" == enabled ]]; then systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; else systemctl --user disable "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; fi
    if [[ "$ACTIVE_BEFORE" == active ]]; then systemctl --user start "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; elif [[ "$ACTIVE_BEFORE" == inactive ]]; then systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || rollback_failed=1; fi
  else
    # An absent first-install unit has no enablement to disable.  Calling
    # systemctl disable here turns a correctly restored not-found state into
    # a reported rollback failure on fake and real systemd alike.
    :
  fi
  cmp -s "$BACKUP_DIR/Caddyfile" "$CADDYFILE" || rollback_failed=1
  if [[ -f "$BACKUP_DIR/booking_service.py" ]]; then cmp -s "$BACKUP_DIR/booking_service.py" "$INSTALL_DIR/booking_service.py" || rollback_failed=1; elif [[ -e "$INSTALL_DIR/booking_service.py" ]]; then rollback_failed=1; fi
  if [[ -f "$BACKUP_DIR/unit" ]]; then cmp -s "$BACKUP_DIR/unit" "$UNIT_PATH" || rollback_failed=1; elif [[ -e "$UNIT_PATH" ]]; then rollback_failed=1; fi
  if [[ -f "$BACKUP_DIR/environment" ]]; then cmp -s "$BACKUP_DIR/environment" "$BOOKING_ENV_FILE" || rollback_failed=1; elif [[ -e "$BOOKING_ENV_FILE" ]]; then rollback_failed=1; fi
  "$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || rollback_failed=1
  systemctl --user reload "$CADDY_SERVICE" >/dev/null 2>&1 || rollback_failed=1
  [[ "$(systemctl --user is-active "$UNIT_NAME" 2>/dev/null || true)" == "$ACTIVE_BEFORE" ]] || rollback_failed=1
  [[ "$(systemctl --user is-enabled "$UNIT_NAME" 2>/dev/null || true)" == "$ENABLED_BEFORE" ]] || rollback_failed=1
  [[ "$INSTALL_DIR_BEFORE" == 1 || ! -d "$INSTALL_DIR" ]] || rm -rf "$INSTALL_DIR"
  [[ "$STATE_DIR_BEFORE" == 1 || ! -d "$STATE_DIR" ]] || rm -rf "$STATE_DIR"
  if [[ "$SYSTEMD_DIR_BEFORE" == 0 && -d "$SYSTEMD_DIR" ]]; then rmdir "$SYSTEMD_DIR" 2>/dev/null || rollback_failed=1; fi
  if [[ "$BOOKING_ENV_DIR_BEFORE" == 0 && -d "$BOOKING_ENV_DIR" ]]; then rmdir "$BOOKING_ENV_DIR" 2>/dev/null || rollback_failed=1; fi
  [[ "$rollback_failed" == 0 ]] || fail "$reason; rollback failed closed and requires operator repair"
  fail "$reason; previous backend/config/service state restored"
}

ROLLBACK_ACTIVE=1
cp "$REPO_ROOT/backend/booking_service.py" "$INSTALL_DIR/booking_service.py.new"
chmod 755 "$INSTALL_DIR/booking_service.py.new"

inject_failure backend-copy

mv "$INSTALL_DIR/booking_service.py.new" "$INSTALL_DIR/booking_service.py"
inject_failure backend-promote
sed "s|%h/.local/share/likar-poruch-booking|$INSTALL_DIR|g" "$REPO_ROOT/deploy/likar-poruch-booking.service" > "$UNIT_PATH.new"
chmod 600 "$UNIT_PATH.new"
mv "$UNIT_PATH.new" "$UNIT_PATH"
inject_failure unit-promote
if [[ -n "${BOOKING_SMOKE_TOKEN:-}" ]]; then
  printf 'BOOKING_SMOKE_TOKEN=%q\n' "$BOOKING_SMOKE_TOKEN" > "$BOOKING_ENV_FILE"
  chmod 600 "$BOOKING_ENV_FILE"
fi
python3 - "$CADDYFILE" "$MARKER_START" "$MARKER_END" <<'PY'
from pathlib import Path
import sys
path, start, end = sys.argv[1:]
text = Path(path).read_text()
block = f'''{start}
handle /api/booking-requests {{
    rewrite * /booking-requests
    reverse_proxy 127.0.0.1:8787
}}
handle /api/booking-requests/* {{
    uri replace /api/booking-requests /booking-requests
    reverse_proxy 127.0.0.1:8787
}}
{end}'''

if start in text and end not in text:
    raise SystemExit('managed Caddy block has no closing marker')
if start in text:
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    text = before.rstrip() + '\n' + block + after
else:
    marker = 'handle_path /likar-poruch/* {'
    if marker not in text:
        raise SystemExit('static /likar-poruch handler not found; refusing to guess route placement')
    text = text.replace(marker, marker + '\n\t' + block.replace('\n', '\n\t'), 1)
Path(path).write_text(text)
PY
inject_failure caddy-write

"$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile || rollback "Caddy validation failed"
inject_failure caddy-validate
systemctl --user daemon-reload || rollback "systemd reload failed"
inject_failure daemon-reload
if [[ "$ACTIVE_BEFORE" == active ]]; then
  systemctl --user restart "$UNIT_NAME" || rollback "backend restart failed"
  inject_failure restart
elif [[ -z "$ACTIVE_BEFORE" || "$ACTIVE_BEFORE" == inactive ]]; then
  systemctl --user start "$UNIT_NAME" || rollback "backend start failed"
  inject_failure start
fi
if [[ "$ENABLED_BEFORE" != disabled && "$ENABLED_BEFORE" != masked ]]; then
  systemctl --user enable "$UNIT_NAME" || rollback "backend enable failed"
  inject_failure enable
else
  systemctl --user disable "$UNIT_NAME" || rollback "backend disable failed"
  inject_failure disable
fi
for _ in {1..20}; do curl --fail --silent "$HEALTH_URL" >/dev/null && break; sleep 1; done
curl --fail --silent "$HEALTH_URL" >/dev/null || rollback "backend health check failed"
inject_failure health
systemctl --user reload "$CADDY_SERVICE" || rollback "gateway reload failed"
inject_failure gateway-reload
ROLLBACK_ACTIVE=0
printf 'Booking backend installed and healthy at %s\n' "$HEALTH_URL"
