#!/bin/bash
# Installs dependencies if needed, then runs this repository's verification.
# Usage: ./init.sh [--full]
#   --full  also runs the Chromium and WebKit browser suite.
set -euo pipefail

cd "$(dirname "$0")"

full=false
case "${1:-}" in
  "") ;;
  --full) full=true ;;
  *)
    echo "Usage: ./init.sh [--full]" >&2
    exit 2
    ;;
esac

echo "=== Harness Initialization ==="

required_node="$(cat .nvmrc)"
current_node="$(node --version | sed 's/^v//; s/\..*//')"
if [ "$current_node" != "$required_node" ]; then
  echo "Node.js $required_node is required, found $(node --version). Run: nvm use" >&2
  exit 1
fi

# npm ci deletes node_modules, so run it only when the lockfile has changed.
install_if_needed() {
  if [ "$1/node_modules/.package-lock.json" -nt "$1/package-lock.json" ]; then
    echo "=== Dependencies up to date ($1) ==="
  else
    echo "=== npm ci ($1) ==="
    (cd "$1" && npm ci)
  fi
}
install_if_needed .
install_if_needed dashboard

echo "=== npm run check ==="
npm run check

echo "=== dashboard checks ==="
(cd dashboard && npm run typecheck && npm run lint && npm test)

if [ "$full" = true ]; then
  echo "=== npm run test:e2e (chromium, webkit) ==="
  npm run test:e2e -- --project=chromium --project=webkit

  echo "=== dashboard build ==="
  (cd dashboard && npm run build)

  if supabase status >/dev/null 2>&1; then
    echo "=== dashboard e2e (chromium, webkit) ==="
    (cd dashboard && npm run test:e2e)
  else
    echo "=== dashboard e2e SKIPPED: local Supabase is not running (supabase start) ==="
  fi
fi

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on"
echo "3. Implement only that feature"
echo "4. Re-run verification before claiming done"
