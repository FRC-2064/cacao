#!/usr/bin/env bash
#
# Copy production data into the test (dev) Convex deployment.
#
#     npm run sync:test-data
#
# `npm run dev` points at your personal dev deployment, so this is how you get
# a local copy of the site running against real data without touching the real
# site. Read-only against production: it takes a snapshot and never writes
# there.
#
# Run it whenever the test data has drifted or you have made a mess of it.
# Re-running is always safe -- the test deployment is disposable by definition.

set -euo pipefail

SNAPSHOT_DIR="${TMPDIR:-/tmp}/cacao-prod-snapshot"
SNAPSHOT="$SNAPSHOT_DIR/prod.zip"

mkdir -p "$SNAPSHOT_DIR"
rm -f "$SNAPSHOT"

echo "==> Exporting a snapshot of production…"
npx convex export --prod --path "$SNAPSHOT"

echo
echo "==> Replacing the data in your dev deployment…"
# --replace-all rather than --replace so that a table which exists in dev but
# not in the snapshot is cleared too. Without it, rows deleted in production
# would linger in the test copy and quietly make it a different database.
npx convex import --deployment dev --replace-all --yes "$SNAPSHOT"

echo
echo "==> Done. Row counts in the test deployment:"
npx convex run --deployment dev seed:status

cat <<'EOF'

The test deployment now mirrors production. `npm run dev` talks to it, so
nothing you do locally can reach the real site.

To point a local build at production instead -- for read-only spot checks --
override PUBLIC_CONVEX_URL for that one command rather than editing .env.local:

    PUBLIC_CONVEX_URL=https://festive-lion-592.convex.cloud npm run dev
EOF
