#!/usr/bin/env bash
#
# Save a durable snapshot of the local dev database (app-db-1) to disk.
#
# The snapshot is a compressed pg_dump (custom format) containing the FULL
# schema + data, so it can be restored even after a test run wipes/recreates
# the database. Snapshots are written to ../data-snapshots/ which is gitignored
# (the data contains real student PII — never commit it).
#
# Usage:
#   scripts/db-snapshot.sh                 # timestamped snapshot + updates latest
#   DB_CONTAINER=app-db-1 scripts/db-snapshot.sh
#
set -euo pipefail

CONTAINER=${DB_CONTAINER:-app-db-1}
DB=${DB_NAME:-kings_analytics}
DB_USER=${DB_USER:-kings}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/data-snapshots"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/kings_local_${STAMP}.dump"

echo "Dumping $DB from container '$CONTAINER' ..."
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc --no-owner --no-privileges "$DB" > "$OUT"

# Point latest.dump at this snapshot for easy restore.
cp -f "$OUT" "$OUT_DIR/latest.dump"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Snapshot saved: $OUT ($SIZE)"
echo "Also copied to:  $OUT_DIR/latest.dump"
