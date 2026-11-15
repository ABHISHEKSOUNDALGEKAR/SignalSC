#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Restore the merged lockfile exactly, then validate and rebuild the app.
npm ci --no-audit --no-fund
npm run build

# Replit restarts running workflows after this script succeeds.
# The existing server initializes its PostgreSQL tables at startup.
