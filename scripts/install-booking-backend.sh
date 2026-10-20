#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
USER_HOME=${BOOKING_USER_HOME:-/home/sgdt1a}
INSTALL_DIR=${BOOKING_INSTALL_DIR:-"$USER_HOME/.local/share/likar-poruch-booking"}
STATE_DIR="$INSTALL_DIR/state"
SYSTEMD_DIR=${SYSTEMD_DIR:-"$USER_HOME/.config/systemd/user"}
UNIT_NAME=likar-poruch-booking.service
CADDYFILE=${CADDYFILE:-"$USER_HOME/infrastructure/sur-hub/Caddyfile"}
CADDY_BIN=${CADDY_BIN:-"$USER_HOME/.local/bin/caddy"}
CADDY_SERVICE=${CADDY_SERVICE:-sur-hub-gateway.service}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8787/health}
MARKER_START='# BEGIN LIKAR-PORUCH BOOKING API (managed)'
MARKER_END='# END LIKAR-PORUCH BOOKING API (managed)'
UNIT_PATH="$SYSTEMD_DIR/$UNIT_NAME"
BACKUP_DIR=$(mktemp -d)

fail() { printf 'booking install: %s\n' "$*" >&2; exit 1; }
cleanup() { rm -rf "$BACKUP_DIR"; }
trap cleanup EXIT
[[ -f "$REPO_ROOT/backend/booking_service.py" ]] || fail "backend source not found"
command -v systemctl >/dev/null || fail "systemctl is required"
command -v curl >/dev/null || fail "curl is required"
[[ -x "$CADDY_BIN" ]] || fail "Caddy binary not found: $CADDY_BIN"
[[ -f "$CADDYFILE" ]] || fail "Caddyfile not found: $CADDYFILE"

mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$SYSTEMD_DIR"
chmod 755 "$INSTALL_DIR"
chmod 700 "$STATE_DIR"
cp "$REPO_ROOT/backend/booking_service.py" "$INSTALL_DIR/booking_service.py.new"
chmod 755 "$INSTALL_DIR/booking_service.py.new"
cp "$CADDYFILE" "$BACKUP_DIR/Caddyfile"
[[ -f "$INSTALL_DIR/booking_service.py" ]] && cp "$INSTALL_DIR/booking_service.py" "$BACKUP_DIR/booking_service.py"
[[ -f "$UNIT_PATH" ]] && cp "$UNIT_PATH" "$BACKUP_DIR/unit"

rollback() {
  set +e
  systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1
  if [[ -f "$BACKUP_DIR/booking_service.py" ]]; then cp "$BACKUP_DIR/booking_service.py" "$INSTALL_DIR/booking_service.py"; else rm -f "$INSTALL_DIR/booking_service.py"; fi
  if [[ -f "$BACKUP_DIR/unit" ]]; then cp "$BACKUP_DIR/unit" "$UNIT_PATH"; else rm -f "$UNIT_PATH"; fi
  cp "$BACKUP_DIR/Caddyfile" "$CADDYFILE"
  systemctl --user daemon-reload >/dev/null 2>&1
  systemctl --user start "$UNIT_NAME" >/dev/null 2>&1
  "$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1
  systemctl --user reload "$CADDY_SERVICE" >/dev/null 2>&1
  fail "$1; previous backend/config restored"
}

mv "$INSTALL_DIR/booking_service.py.new" "$INSTALL_DIR/booking_service.py"
sed "s|%h/.local/share/likar-poruch-booking|$INSTALL_DIR|g" "$REPO_ROOT/deploy/likar-poruch-booking.service" > "$UNIT_PATH.new"
chmod 600 "$UNIT_PATH.new"
mv "$UNIT_PATH.new" "$UNIT_PATH"
python3 - "$CADDYFILE" "$MARKER_START" "$MARKER_END" <<'PY'
from pathlib import Path
import sys
path, start, end = sys.argv[1:]
text = Path(path).read_text()
block = f'''{start}
handle /api/booking-requests {{
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

"$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile || rollback "Caddy validation failed"
systemctl --user daemon-reload || rollback "systemd reload failed"
systemctl --user enable --now "$UNIT_NAME" || rollback "backend start failed"
for _ in {1..20}; do curl --fail --silent "$HEALTH_URL" >/dev/null && break; sleep 1; done
curl --fail --silent "$HEALTH_URL" >/dev/null || rollback "backend health check failed"
systemctl --user reload "$CADDY_SERVICE" || rollback "gateway reload failed"
printf 'Booking backend installed and healthy at %s\n' "$HEALTH_URL"
