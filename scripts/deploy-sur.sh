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
cleanup() {
  rm -rf "$NEXT"
  rm -f "$LIVE_BODY"
}
trap cleanup EXIT

cp -a dist/. "$NEXT/"
printf '{"commit":"%s","deployed_at":"%s","origin":"%s"}\n' \
  "$LOCAL_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SITE_URL" > "$NEXT/release.json"

EXPECTED_HASH=$(sha256sum "$NEXT/index.html" | cut -d' ' -f1)
rm -rf "$PREVIOUS"
if [[ -e "$TARGET" ]]; then
  mv "$TARGET" "$PREVIOUS"
fi
mv "$NEXT" "$TARGET"

rollback() {
  rm -rf "$TARGET"
  if [[ -e "$PREVIOUS" ]]; then
    mv "$PREVIOUS" "$TARGET"
  fi
  fail "$1; previous artifact restored"
}

DEPLOYED_HASH=$(sha256sum "$TARGET/index.html" | cut -d' ' -f1)
[[ "$DEPLOYED_HASH" == "$EXPECTED_HASH" ]] || rollback "deployed artifact hash mismatch"

if ! curl --fail --silent --show-error \
  --resolve sur.kyiv.ua:10443:127.0.0.1 \
  "$LIVE_URL" -o "$LIVE_BODY"; then
  rollback "live gateway request failed"
fi

LIVE_HASH=$(sha256sum "$LIVE_BODY" | cut -d' ' -f1)
[[ "$LIVE_HASH" == "$EXPECTED_HASH" ]] || rollback "live gateway does not serve the new artifact"

if ! QA_BASE_URL="https://sur.kyiv.ua:10443/likar-poruch" \
  QA_HOST_RESOLVER_RULES="MAP sur.kyiv.ua 127.0.0.1" \
  npm run qa:browser; then
  rollback "live gateway browser QA failed"
fi

rm -rf "$PREVIOUS"
printf 'Deployed commit %s to %s\n' "$LOCAL_SHA" "https://sur.kyiv.ua/likar-poruch/"
printf 'Verified index SHA-256: %s\n' "$LIVE_HASH"
