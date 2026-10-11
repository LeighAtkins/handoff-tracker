#!/usr/bin/env bash
# One command for a demo: fresh demo data, a production build (pages load instantly, no dev
# compile pauses), the worker loop filling in the live demo parcels, and the app on
# http://localhost:3100. Ctrl-C stops everything. See docs/demo-script.md.
#
#   pnpm demo              # reseed, build, run
#   SKIP_BUILD=1 pnpm demo # reuse the last build
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. On a Mac with Colima: colima start" >&2
  exit 1
fi

# Production mode needs a session secret; a throwaway one is fine for a local demo.
if ! grep -qE '^AUTH_SECRET=.{32,}' .env 2>/dev/null; then
  export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
fi

pnpm db:up
pnpm --filter @handoff/db migrate:deploy
pnpm db:seed
if [ "${SKIP_BUILD:-}" != 1 ]; then pnpm build; fi

# The worker fills in the DEMO-LIVE-* parcels (and keeps stuck flags current) every 5 minutes.
WORKER_INTERVAL_SECONDS="${WORKER_INTERVAL_SECONDS:-300}" pnpm worker:loop &
worker=$!
trap 'kill "$worker" 2>/dev/null || true' EXIT INT TERM

echo
echo "  Handoff Tracker demo: http://localhost:3100  (sign in with the developer login)"
echo
pnpm --filter @handoff/web start
