#!/usr/bin/env bash
set -euo pipefail

# Disposable executable rollback matrix. It runs the real installer against a
# fake user systemd/Caddy/curl boundary and compares every managed byte/state
# after each injected failure. No host service, Caddyfile, or home directory is
# touched.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALL="$ROOT/scripts/install-booking-backend.sh"
UNIT="$ROOT/deploy/likar-poruch-booking.service"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/likar-booking-matrix.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; HOME_DIR="$TMP/home"; mkdir -p "$BIN" "$HOME_DIR/infrastructure/sur-hub" "$HOME_DIR/.local/bin"
STATE="$TMP/systemd-state"; mkdir -p "$STATE"

cat >"$BIN/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
set -euo pipefail
state=${MATRIX_SYSTEMD_STATE:?}
unit=${@: -1}
cmd=${1:-}; [[ "$cmd" == --user ]] && { shift; cmd=${1:-}; }
case "$cmd" in
  is-active) [[ -f "$state/not-found" ]] && { printf 'not-found\n'; exit 4; }; [[ -f "$state/active" ]] && cat "$state/active" || { printf 'inactive\n'; exit 3; } ;;
  is-enabled) [[ -f "$state/enabled" ]] && cat "$state/enabled" || { printf 'not-found\n'; exit 1; } ;;
  start|restart) printf 'active\n' >"$state/active" ;;
  stop) printf 'inactive\n' >"$state/active" ;;
  enable) printf 'enabled\n' >"$state/enabled" ;;
  disable) rm -f "$state/enabled"; printf 'disabled\n' >"$state/enabled" ;;
  daemon-reload|reload) : ;;
  *) : ;;
esac
FAKE_SYSTEMCTL
cat >"$BIN/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
printf '{"status":"ok"}\n'
FAKE_CURL
cat >"$HOME_DIR/.local/bin/caddy" <<'FAKE_CADDY'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == validate ]]
FAKE_CADDY
chmod +x "$BIN/systemctl" "$BIN/curl" "$HOME_DIR/.local/bin/caddy"
export PATH="$BIN:$PATH" MATRIX_SYSTEMD_STATE="$STATE"
export BOOKING_USER_HOME="$HOME_DIR" SYSTEMD_DIR="$HOME_DIR/.config/systemd/user"
export CADDYFILE="$HOME_DIR/infrastructure/sur-hub/Caddyfile" CADDY_BIN="$HOME_DIR/.local/bin/caddy"
export BOOKING_ENV_FILE="$HOME_DIR/.config/likar-poruch-booking/environment"
export HEALTH_URL=http://127.0.0.1:8787/health
printf 'site {\n\thandle_path /likar-poruch/* {\n\t\tfile_server\n\t}\n}\n' >"$CADDYFILE"
printf 'original-backend\n' >"$TMP/original-backend"
mkdir -p "$(dirname "$BOOKING_ENV_FILE")"
printf 'original-env=1\n' >"$TMP/original-env"
printf 'original-env=1\n' >"$BOOKING_ENV_FILE"

run_case() {
  local state=$1 phase=$2 mode=$3
  rm -rf "$HOME_DIR/.local/share/likar-poruch-booking" "$SYSTEMD_DIR" "$HOME_DIR/.config/likar-poruch-booking" "$STATE"
  mkdir -p "$STATE" "$HOME_DIR/.config/likar-poruch-booking"
  cp "$TMP/original-env" "$BOOKING_ENV_FILE"
  printf 'original-caddy\n' >"$CADDYFILE"
  : >"$STATE/active"; printf '%s\n' "$state" >"$STATE/active"
  [[ "$state" == not-found ]] && touch "$STATE/not-found"
  if [[ "$mode" == upgrade ]]; then
    mkdir -p "$BOOKING_USER_HOME/.local/share/likar-poruch-booking/state" "$SYSTEMD_DIR"
    printf 'original-backend\n' >"$BOOKING_USER_HOME/.local/share/likar-poruch-booking/booking_service.py"
    printf 'original-unit\n' >"$SYSTEMD_DIR/likar-poruch-booking.service"
    printf 'enabled\n' >"$STATE/enabled"
  else
    rm -f "$STATE/active" "$STATE/enabled"
  fi
  local before_caddy before_backend before_unit before_env
  before_caddy=$(sha256sum "$CADDYFILE" | cut -d' ' -f1)
  before_backend=$([[ -f "$BOOKING_USER_HOME/.local/share/likar-poruch-booking/booking_service.py" ]] && sha256sum "$BOOKING_USER_HOME/.local/share/likar-poruch-booking/booking_service.py" | cut -d' ' -f1 || printf absent)
  before_unit=$([[ -f "$SYSTEMD_DIR/likar-poruch-booking.service" ]] && sha256sum "$SYSTEMD_DIR/likar-poruch-booking.service" | cut -d' ' -f1 || printf absent)
  before_env=$(sha256sum "$BOOKING_ENV_FILE" | cut -d' ' -f1)
  set +e
  BOOKING_INSTALL_FAIL_PHASE="$phase" bash "$INSTALL" "$ROOT" >/dev/null 2>&1
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || { printf 'phase %s unexpectedly succeeded\n' "$phase" >&2; return 1; }
  [[ $(sha256sum "$CADDYFILE" | cut -d' ' -f1) == "$before_caddy" ]]
  [[ $(sha256sum "$BOOKING_ENV_FILE" | cut -d' ' -f1) == "$before_env" ]]
  [[ $([[ -f "$BOOKING_USER_HOME/.local/share/likar-poruch-booking/booking_service.py" ]] && sha256sum "$BOOKING_USER_HOME/.local/share/likar-poruch-booking/booking_service.py" | cut -d' ' -f1 || printf absent) == "$before_backend" ]]
  [[ $([[ -f "$SYSTEMD_DIR/likar-poruch-booking.service" ]] && sha256sum "$SYSTEMD_DIR/likar-poruch-booking.service" | cut -d' ' -f1 || printf absent) == "$before_unit" ]]
  [[ $(systemctl --user is-active likar-poruch-booking.service 2>/dev/null || true) == "$state" ]]
  if [[ "$mode" == first-install ]]; then
    [[ ! -d "$BOOKING_USER_HOME/.local/share/likar-poruch-booking" ]]
    [[ ! -d "$SYSTEMD_DIR" ]] || [[ -z "$(find "$SYSTEMD_DIR" -type f -print -quit)" ]]
  fi
}

# Every injection phase is exercised in both disposable first-install and
# upgrade paths; service probes cover active, inactive, and not-found states.
for phase in backend-copy backend-promote unit-promote caddy-write caddy-validate daemon-reload start enable health gateway-reload; do
  state=inactive; [[ "$phase" == enable ]] && state=inactive
  run_case "$state" "$phase" first-install
  run_case "$state" "$phase" upgrade
done
run_case active restart upgrade
run_case not-found start first-install

printf 'booking deployment matrix passed: executed installer rollback across first-install/upgrade, active/inactive/not-found, exact backend/unit/env/Caddy bytes, directories, and service state\n'
