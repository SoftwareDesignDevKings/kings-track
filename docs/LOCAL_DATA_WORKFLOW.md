# Local Dev Data: Snapshots & Copying Prod → Local

This explains how the local dev database (`app-db-1`) is populated with a copy of
production data, and how to **save / restore** that data so a test run (which
wipes the DB) doesn't cost you the dataset.

> ⚠️ **This data is real student PII.** Keep it on your machine. The
> `data-snapshots/` directory is gitignored — never commit dumps. (Production
> also has **RLS disabled on every table**, a separate security issue worth
> fixing with proper policies.)

---

## TL;DR

```bash
# Save the current local DB to a durable file (do this whenever the data is good)
scripts/db-snapshot.sh

# Restore it later — e.g. after running the test suite wiped the DB
scripts/db-restore.sh
```

Snapshots live in `data-snapshots/` (gitignored). `latest.dump` always points at
the most recent one; timestamped copies are kept too.

---

## Why this exists

The dashboard + AI chatbot read from the **local** Postgres. Rather than wait for
a slow Canvas sync, we copy a snapshot of the production database into local.

Two hard constraints shaped the workflow:

1. **Direct Postgres to Supabase is unreachable from this dev environment.** The
   pooler (`…pooler.supabase.com:5432/:6543`) accepts TCP but never answers the
   Postgres protocol, and the direct host `db.<ref>.supabase.co` doesn't resolve.
   So `pg_dump` against prod is **not** possible here. Only HTTPS works.
2. So we pull data through the **read-only Supabase MCP** (HTTPS) instead.

---

## ⚠️ What WIPES the local DB (and how to recover)

| Cause | Effect | Recovery |
|---|---|---|
| Running the backend **pytest** suite inside `app-backend-1` | `tests/conftest.py` DROPs & recreates **all** tables on import, and the container's `DATABASE_URL` points at the real `db:5432` DB | `scripts/db-restore.sh` |
| Clicking **Sync** in the app UI | A Canvas `full_sync` rebuilds the core tables from Canvas, overwriting the copied snapshot | `scripts/db-restore.sh` |

To run the test suite **without** wiping this data, point the tests at a throwaway
database first, e.g. `DATABASE_URL=postgresql+asyncpg://kings:kings@db:5432/kings_test`.

---

## Snapshot / Restore

### `scripts/db-snapshot.sh`
`pg_dump -Fc` (compressed, full schema + data) of `kings_analytics` → a file in
`data-snapshots/`. Updates `latest.dump`. Run it any time the data is in a good
state.

### `scripts/db-restore.sh [path]`
`pg_restore --clean --if-exists` — DROPs and recreates everything from the dump,
so it fully reverts the current DB to the snapshot. Defaults to `latest.dump`;
pass a specific file to restore an older snapshot. Prints row counts at the end.

Both scripts honour `DB_CONTAINER` / `DB_NAME` / `DB_USER` env overrides
(defaults: `app-db-1` / `kings_analytics` / `kings`).

---

## Re-pulling fresh data from prod (Supabase MCP)

Only needed if you want newer prod data than the snapshot. Requires the read-only
Supabase MCP server (configured in `.mcp.json`) to be authenticated
(`claude /mcp` → supabase → Authenticate).

The technique that avoids routing megabytes through the model context:

1. Query each table as a single JSON blob via the MCP:
   ```sql
   SELECT json_build_object('<table>', (SELECT coalesce(json_agg(t),'[]') FROM public.<table> t))::text;
   ```
   Large results are **auto-saved to a file** under `…/tool-results/…txt` by the
   harness instead of being returned inline — so the data never enters context.
2. Parse that file on disk → per-table JSON (see `/tmp/etl/extract.py`).
3. Load into local with FK checks disabled:
   ```sql
   SET session_replication_role = replica;
   INSERT INTO public.<table>
   SELECT * FROM json_populate_recordset(NULL::public.<table>, pg_read_file('/tmp/<table>.json')::json);
   ```
   (`json_populate_recordset` casts every column type natively.) See
   `/tmp/etl/load.sh`.
4. Reset identity sequences afterward (truncate + explicit-id inserts leave them
   at 1):
   ```sql
   DO $$ DECLARE r record; s text; m bigint; BEGIN
     FOR r IN SELECT table_name FROM information_schema.columns
              WHERE table_schema='public' AND column_name='id' LOOP
       s := pg_get_serial_sequence('public.'||quote_ident(r.table_name),'id');
       IF s IS NOT NULL THEN
         EXECUTE format('SELECT coalesce(max(id),0) FROM public.%I', r.table_name) INTO m;
         PERFORM setval(s, GREATEST(m,1));
       END IF;
     END LOOP; END $$;
   ```
5. Very large tables (e.g. `gradeo_assignment_question_results`, ~33k rows) must
   be pulled in batches via `... ORDER BY id LIMIT 9000 OFFSET N`, loading each
   batch before fetching the next.

Notes:
- The `/tmp/etl/*` helper scripts are ephemeral (cleared on reboot). The durable
  artifact is the snapshot — re-snapshot after a fresh pull.
- The Supabase MCP session can expire mid-job ("session expired"); a small
  follow-up query or `claude mcp list` re-establishes it.

### Tables copied
All current Canvas + Gradeo + EdStem tables with data (~46k rows). Empty prod
tables (attendance, reminders, schools, etc.) are left empty. The full set and
row counts are reproducible from the snapshot.
