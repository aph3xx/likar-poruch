#!/usr/bin/env bash
set -euo pipefail

# Exercise the outer deploy-sur rollback function against a disposable,
# production-shaped systemd boundary. This deliberately extracts the function
# from the script so the test cannot pass by testing a duplicate implementation.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/likar-deploy-rollback.XXXXXX")
trap 'if [[ "${KEEP_TMP:-0}" != 1 ]]; then rm -rf "$TMP"; else printf "kept %s\n" "$TMP" >&2; fi' EXIT
BIN="$TMP/bin"; HOME_DIR="$TMP/home"; STATE="$TMP/systemd-state"
mkdir -p "$BIN" "$HOME_DIR" "$STATE"

cat >"$BIN/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
set -euo pipefail
state=${MATRIX_SYSTEMD_STATE:?}
cmd=${1:-}; [[ "$cmd" == --user ]] && { shift; cmd=${1:-}; }
unit_path=${BACKEND_UNIT_PATH:?}
wants="${BACKEND_SYSTEMD_WANTS_DIR:?}/likar-poruch-booking.service"
printf '%s\n' "$cmd" >>"${SYSTEMCTL_LOG:?}"
case "$cmd" in
  is-active)
    if [[ -e "$unit_path" ]]; then cat "$state/active"; else printf 'not-found\n'; exit 4; fi ;;
  is-enabled)
    if [[ ! -e "$unit_path" ]]; then printf 'not-found\n'; exit 4; fi
    if [[ -L "$wants" ]]; then printf 'enabled\n'; else cat "$state/enabled"; fi ;;
  stop)
    [[ -e "$unit_path" ]] || exit 5
    printf 'inactive\n' >"$state/active" ;;
  start) printf 'active\n' >"$state/active" ;;
  enable) mkdir -p "$BACKEND_SYSTEMD_WANTS_DIR"; ln -sfn ../likar-poruch-booking.service "$wants" ;;
  disable)
    [[ -e "$unit_path" ]] || exit 6
    rm -f "$wants"; printf 'disabled\n' >"$state/enabled" ;;
  daemon-reload|reload) : ;;
  *) : ;;
esac
FAKE_SYSTEMCTL
cat >"$HOME_DIR/caddy" <<'FAKE_CADDY'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == validate ]]
FAKE_CADDY
chmod +x "$BIN/systemctl" "$HOME_DIR/caddy"
export PATH="$BIN:$PATH" MATRIX_SYSTEMD_STATE="$STATE" SYSTEMCTL_LOG="$TMP/systemctl.log"
export BACKEND_INSTALL_DIR="$HOME_DIR/install" BACKEND_UNIT_PATH="$HOME_DIR/systemd/likar-poruch-booking.service"
export BACKEND_SYSTEMD_DIR="$HOME_DIR/systemd" BACKEND_SYSTEMD_WANTS_DIR="$HOME_DIR/systemd/default.target.wants"
export BACKEND_STATE_DIR="$BACKEND_INSTALL_DIR/state" BACKEND_ENV_DIR="$HOME_DIR/env" BACKEND_ENV_FILE="$HOME_DIR/env/environment"
export BACKEND_CADDYFILE="$HOME_DIR/Caddyfile" CADDY_BIN="$HOME_DIR/caddy"
mkdir -p "$BACKEND_INSTALL_DIR/state" "$BACKEND_SYSTEMD_DIR" "$BACKEND_ENV_DIR"
printf 'old backend\n' >"$BACKEND_INSTALL_DIR/booking_service.py"
printf 'old unit\n' >"$BACKEND_UNIT_PATH"
printf 'old caddy\n' >"$BACKEND_CADDYFILE"
printf 'old env\n' >"$HOME_DIR/env/environment"
printf 'inactive\n' >"$STATE/active"
printf 'disabled\n' >"$STATE/enabled"

# The real function uses fail() to terminate deploy-sur. Keep it observable
# without terminating this matrix process.
fail() { printf '%s\n' "$*" >>"$TMP/failure"; }
rollback_source=$(awk '/^rollback\(\) \{/{capture=1} capture{print} capture && /^\}/{exit}' "$ROOT/scripts/deploy-sur.sh")
eval "$rollback_source"

assert_equal() { [[ "$1" == "$2" ]] || { printf 'expected %s, got %s\n' "$2" "$1" >&2; return 1; }; }
assert_topology() {
  local mode=$1
  [[ -d "$BACKEND_ENV_DIR" && -f "$BACKEND_ENV_FILE" && -f "$BACKEND_CADDYFILE" ]] || return 1
  if [[ "$mode" == upgrade ]]; then
    [[ -d "$BACKEND_INSTALL_DIR" && -d "$BACKEND_STATE_DIR" && -d "$BACKEND_SYSTEMD_DIR" && -f "$BACKEND_UNIT_PATH" ]] || return 1
    [[ ! -e "$BACKEND_SYSTEMD_WANTS_DIR" ]] || return 1
  else
    [[ ! -e "$BACKEND_INSTALL_DIR" && ! -e "$BACKEND_STATE_DIR" && ! -e "$BACKEND_SYSTEMD_DIR" && ! -e "$BACKEND_UNIT_PATH" ]] || return 1
  fi
}
run_case() {
  local mode=$1
  rm -f "$SYSTEMCTL_LOG" "$TMP/failure"
  rm -rf "$BACKEND_INSTALL_DIR" "$BACKEND_SYSTEMD_DIR" "$BACKEND_ENV_DIR"
  mkdir -p "$BACKEND_INSTALL_DIR/state" "$BACKEND_SYSTEMD_DIR" "$BACKEND_ENV_DIR"
  printf 'old backend\n' >"$BACKEND_INSTALL_DIR/booking_service.py"
  printf 'old caddy\n' >"$BACKEND_CADDYFILE"
  printf 'old env\n' >"$BACKEND_ENV_DIR/environment"
  printf 'inactive\n' >"$STATE/active"; printf 'disabled\n' >"$STATE/enabled"
  BACKEND_ACTIVE_BEFORE=inactive BACKEND_ENABLED_BEFORE=disabled
  BACKEND_INSTALL_DIR_BEFORE=1 BACKEND_STATE_DIR_BEFORE=1 BACKEND_SYSTEMD_DIR_BEFORE=1
  BACKEND_SYSTEMD_WANTS_DIR_BEFORE=0 BACKEND_ENV_DIR_BEFORE=1 BACKEND_CADDY_BEFORE=1
  BACKEND_SNAPSHOT="$TMP/snapshot"; rm -rf "$BACKEND_SNAPSHOT"; mkdir -p "$BACKEND_SNAPSHOT"
  printf 'old backend\n' >"$BACKEND_SNAPSHOT/booking_service.py"
  printf 'old unit\n' >"$BACKEND_SNAPSHOT/unit"
  printf 'old caddy\n' >"$BACKEND_SNAPSHOT/Caddyfile"
  printf 'old env\n' >"$BACKEND_SNAPSHOT/environment"
  # Model the installer having changed every restorable byte. Keeping the
  # post-install values distinct from the snapshot makes each cmp assertion
  # independently meaningful and catches a no-op restore mutant.
  printf 'new caddy\n' >"$BACKEND_CADDYFILE"
  printf 'new env\n' >"$BACKEND_ENV_DIR/environment"
  if [[ "$mode" == upgrade ]]; then
    printf 'new backend\n' >"$BACKEND_INSTALL_DIR/booking_service.py"
    printf 'new unit\n' >"$BACKEND_UNIT_PATH"
    printf 'active\n' >"$STATE/active"
  elif [[ "$mode" == first-install ]]; then
    # First install: the installer created and enabled a new unit, but there
    # was no unit in the snapshot. Rollback must stop it, disable it while it
    # still exists, then remove it.
    printf 'new unit\n' >"$BACKEND_UNIT_PATH"
    mkdir -p "$BACKEND_SYSTEMD_WANTS_DIR"
    ln -s ../likar-poruch-booking.service "$BACKEND_SYSTEMD_WANTS_DIR/likar-poruch-booking.service"
    printf 'active\n' >"$STATE/active"
    BACKEND_ACTIVE_BEFORE=not-found BACKEND_ENABLED_BEFORE=not-found
    rm -f "$BACKEND_SNAPSHOT/booking_service.py" "$BACKEND_SNAPSHOT/unit"
    BACKEND_INSTALL_DIR_BEFORE=0 BACKEND_STATE_DIR_BEFORE=0 BACKEND_SYSTEMD_DIR_BEFORE=0
  else
    # A failed first install can reach rollback before a unit is created.
    # The fake stop returns systemd's rc=5 for this genuinely absent unit;
    # rollback must not invoke it.
    BACKEND_ACTIVE_BEFORE=not-found BACKEND_ENABLED_BEFORE=not-found
    rm -rf "$BACKEND_INSTALL_DIR" "$BACKEND_SYSTEMD_DIR"
    BACKEND_INSTALL_DIR_BEFORE=0 BACKEND_STATE_DIR_BEFORE=0 BACKEND_SYSTEMD_DIR_BEFORE=0
    rm -f "$BACKEND_SNAPSHOT/booking_service.py" "$BACKEND_SNAPSHOT/unit"
  fi
  PROMOTED=0
  rollback "matrix $mode" >/dev/null 2>&1 || true
  [[ -s "$TMP/failure" ]] || { printf '%s rollback did not finish\n' "$mode" >&2; return 1; }
  grep -Fq 'backend rollback failed' "$TMP/failure" && { cat "$TMP/failure" >&2; return 1; }
  if [[ "$mode" == upgrade ]]; then
    cmp -s "$BACKEND_INSTALL_DIR/booking_service.py" "$BACKEND_SNAPSHOT/booking_service.py"
    cmp -s "$BACKEND_UNIT_PATH" "$BACKEND_SNAPSHOT/unit"
    cmp -s "$BACKEND_ENV_FILE" "$BACKEND_SNAPSHOT/environment"
    cmp -s "$BACKEND_CADDYFILE" "$BACKEND_SNAPSHOT/Caddyfile"
    assert_equal "$(cat "$STATE/active")" inactive
    assert_equal "$(cat "$STATE/enabled")" disabled
    [[ ! -e "$BACKEND_SYSTEMD_WANTS_DIR/likar-poruch-booking.service" ]]
    [[ "$(grep -m1 '^stop$' "$SYSTEMCTL_LOG")" == stop ]]
    assert_topology upgrade
  elif [[ "$mode" == first-install ]]; then
    [[ ! -e "$BACKEND_UNIT_PATH" && ! -L "$BACKEND_SYSTEMD_WANTS_DIR/likar-poruch-booking.service" ]]
    [[ "$(grep -m1 '^stop$' "$SYSTEMCTL_LOG")" == stop ]]
    [[ "$(grep -m1 '^disable$' "$SYSTEMCTL_LOG")" == disable ]]
    cmp -s "$BACKEND_ENV_FILE" "$BACKEND_SNAPSHOT/environment"
    cmp -s "$BACKEND_CADDYFILE" "$BACKEND_SNAPSHOT/Caddyfile"
    assert_equal "$(systemctl --user is-active likar-poruch-booking.service 2>/dev/null || true)" not-found
    assert_equal "$(systemctl --user is-enabled likar-poruch-booking.service 2>/dev/null || true)" not-found
    assert_topology first-install
  else
    [[ ! -e "$BACKEND_UNIT_PATH" && ! -e "$BACKEND_SYSTEMD_DIR" ]]
    ! grep -q '^stop$' "$SYSTEMCTL_LOG"
    ! grep -q '^disable$' "$SYSTEMCTL_LOG"
    cmp -s "$BACKEND_ENV_FILE" "$BACKEND_SNAPSHOT/environment"
    cmp -s "$BACKEND_CADDYFILE" "$BACKEND_SNAPSHOT/Caddyfile"
    assert_equal "$(systemctl --user is-active likar-poruch-booking.service 2>/dev/null || true)" not-found
    assert_equal "$(systemctl --user is-enabled likar-poruch-booking.service 2>/dev/null || true)" not-found
    assert_topology first-install-absent
  fi
}
run_case upgrade
run_case first-install
run_case first-install-absent
printf 'outer deploy rollback matrix passed: inactive upgrade, first-install present and absent units, stop rc=5 avoidance, disable-before-remove, dangling symlink semantics, bytes, state, and topology\n'
