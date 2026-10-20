#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
INSTALL_DIR=${BOOKING_INSTALL_DIR:-"$HOME/.local/share/likar-poruch-booking"}
STATE_DIR="$INSTALL_DIR/state"
SYSTEMD_DIR="$HOME/.config/systemd/user"
UNIT_NAME=likar-poruch-booking.service
CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
CADDY_VALIDATE=${CADDY_VALIDATE:-caddy validate --config}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8787/health}
MARKER_START='# BEGIN LIKAR-PORUCH BOOKING API (managed)'
MARKER_END='# END LIKAR-PORUCH BOOKING API (managed)'

fail() { printf 'booking install: %s\n' "$*" >&2; exit 1; }
[[ -f "$REPO_ROOT/backend/booking_service.py" ]] || fail "backend source not found"
command -v systemctl >/dev/null || fail "systemctl is required"
command -v curl >/dev/null || fail "curl is required"

mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$SYSTEMD_DIR"
chmod 700 "$INSTALL_DIR" "$STATE_DIR"
cp "$REPO_ROOT/backend/booking_service.py" "$INSTALL_DIR/booking_service.py.new"
chmod 700 "$INSTALL_DIR/booking_service.py.new"
if [[ -f "$INSTALL_DIR/booking_service.py" ]]; then cp "$INSTALL_DIR/booking_service.py" "$INSTALL_DIR/booking_service.py.previous"; fi
mv "$INSTALL_DIR/booking_service.py.new" "$INSTALL_DIR/booking_service.py"

UNIT_PATH="$SYSTEMD_DIR/$UNIT_NAME"
if [[ -f "$UNIT_PATH" ]]; then cp "$UNIT_PATH" "$UNIT_PATH.previous"; fi
sed "s|%h/.local/share/likar-poruch-booking|$INSTALL_DIR|g" "$REPO_ROOT/deploy/likar-poruch-booking.service" > "$UNIT_PATH"
chmod 600 "$UNIT_PATH"

rollback() {
  systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
  [[ -f "$INSTALL_DIR/booking_service.py.previous" ]] && mv "$INSTALL_DIR/booking_service.py.previous" "$INSTALL_DIR/booking_service.py"
  [[ -f "$UNIT_PATH.previous" ]] && mv "$UNIT_PATH.previous" "$UNIT_PATH"
  if [[ -n "${CADDY_BACKUP:-}" && -f "$CADDY_BACKUP" && -f "$CADDYFILE" ]]; then cp "$CADDY_BACKUP" "$CADDYFILE"; fi
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user start "$UNIT_NAME" >/dev/null 2>&1 || true
  fail "$1; previous backend/config restored"
}

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
for _ in {1..20}; do curl --fail --silent "$HEALTH_URL" >/dev/null && break; sleep 1; done
curl --fail --silent "$HEALTH_URL" >/dev/null || rollback "backend health check failed"

if [[ -f "$CADDYFILE" ]]; then
  CADDY_BACKUP=$(mktemp "$CADDYFILE.booking-backup.XXXXXX")
  cp "$CADDYFILE" "$CADDY_BACKUP"
  python3 - "$CADDYFILE" "$MARKER_START" "$MARKER_END" <<'PY'
from pathlib import Path
import sys
path, start, end = sys.argv[1:]
text = Path(path).read_text()
block = f'''{start}
handle_path /likar-poruch/api/* {{
    reverse_proxy 127.0.0.1:8787
}}
{end}'''
if start in text and end not in text:
    raise SystemExit('managed Caddy block has no closing marker')
if start in text:
    before = text.split(start, 1)[0]
    after = text.split(end, 1)[1]
    text = before.rstrip() + '\n' + block + after
else:
    # Operators must place this block inside the site block before its static handler.
    marker = 'handle /likar-poruch/*'
    if marker not in text:
        raise SystemExit('static /likar-poruch handler not found; refusing to guess route placement')
    text = text.replace(marker, block + '\n' + marker, 1)
Path(path).write_text(text)
PY
  if ! caddy validate --config "$CADDYFILE"; then rollback "Caddy validation failed"; fi
  systemctl reload caddy || rollback "Caddy reload failed"
fi
rm -f "$INSTALL_DIR/booking_service.py.previous" "$UNIT_PATH.previous" "${CADDY_BACKUP:-}"
printf 'Booking backend installed and healthy at %s\n' "$HEALTH_URL"
