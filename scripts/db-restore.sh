#!/usr/bin/env bash
#
# Restore the local dev database (app-db-1) from a snapshot created by
# db-snapshot.sh. This DROPS and recreates the schema + data, so it fully
# reverts whatever is currently in the DB (e.g. after a test run wiped it).
#
# Usage:
#   scripts/db-restore.sh                                  # restores latest.dump
#   scripts/db-restore.sh data-snapshots/kings_local_X.dump
#
set -euo pipefail

CONTAINER=${DB_CONTAINER:-app-db-1}
DB=${DB_NAME:-kings_analytics}
DB_USER=${DB_USER:-kings}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="${1:-$ROOT/data-snapshots/latest.dump}"

if [ ! -f "$DUMP" ]; then
  echo "ERROR: snapshot not found: $DUMP" >&2
  echo "Create one first with: scripts/db-snapshot.sh" >&2
  exit 1
fi

echo "Restoring '$DUMP' into $DB on container '$CONTAINER' ..."
# --clean --if-exists drops existing objects first; --no-owner avoids role errors.
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" --clean --if-exists --no-owner -d "$DB" < "$DUMP"

echo "Restore complete."
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -t -A -c \
  "SELECT 'courses='||count(*) FROM courses UNION ALL SELECT 'students='||count(DISTINCT user_id) FROM enrollments UNION ALL SELECT 'submissions='||count(*) FROM submissions;"
