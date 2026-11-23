---
name: MenaFlow database schema source of truth
description: Which artifact defines the database schema, what may be applied to a database, and how the CI drift gate works.
---

**`supabase/migrations/*.sql` is the only DDL that is applied to a database.** It
is the reviewed baseline, evolved as incremental migrations, and pushed with the
Supabase CLI (`supabase link` → `db push --dry-run --linked` → `db push
--linked`). This was already the documented decision —
`docs/SUPABASE_DATABASE_SETUP.md:54` — and was confirmed on 2026-11-22 when the
competing artifacts were removed.

**Why:** three artifacts claimed to define the schema, and two of them were
stale. A wrong choice here does not fail loudly: the dead scripts used `CREATE
TABLE IF NOT EXISTS`, so running one against a fresh database silently produced
old-structure tables.

**How to apply:**

- **`lib/db/src/schema/*.ts` (Drizzle) is the app's TypeScript view of that same
  schema, not a second source.** Keep it in step with the SQL. After editing it,
  run `pnpm --filter @workspace/db run generate` and commit the regenerated
  `lib/db/schema-snapshot/`, then write the matching `supabase/migrations/*.sql`.
- **`lib/db/schema-snapshot/` is generated and is NEVER applied to any
  database.** It exists only so CI can prove the Drizzle schema has not moved
  without a matching migration. It is named `schema-snapshot` rather than
  drizzle's default `drizzle` to stop it being mistaken for a migrations folder.
  The CI step `Schema drift gate` fails when regenerating produces any diff.
- **Never run `drizzle-kit push` or `push-force` against a shared, linked, or
  production database.** Those scripts stay in `lib/db/package.json` for local
  development only; the docs already prohibit them against real databases.
  `push` diffs live and can drop columns.
- **Do not add a `schema_migrations` table.** Supabase records applied migration
  versions itself, which is why no such table exists in `supabase/migrations/`.
- **Do not reinstate `scripts/migrate.js` or `scripts/migrate.cjs`** (deleted
  2026-11-22). Both defined `mena_meta_connections` with `owner_id TEXT NOT NULL
  UNIQUE` and no `workspace_id` — a single-connection-per-owner table in a
  multi-workspace app. Nothing referenced them.
- **`scripts/migrate-*.mjs` and `scripts/migrate-whatsapp-albums.js` are a
  different category and must stay.** They are one-off *data* backfills wired to
  the `db:migrate:*` scripts in the root `package.json`, not schema sources.
- **`drizzle-kit generate` needs no database connection.** It only reads
  `src/schema/*` and writes SQL, so `lib/db/drizzle.config.ts` no longer throws
  on a missing `DATABASE_URL` for that command (`push` still fails fast). This is
  what makes the drift gate runnable in CI.

**Measured state (2026-11-22) — the two live sources agree.** Drizzle generates
37 foreign keys to `mena_workspaces` (20 `CASCADE`, 17 `RESTRICT`); simulating
the 35 migration files in order, including the drops, yields exactly the same 37
with the same split. When measuring this, **simulate the drops or the number is
wrong**: a raw count over all files gives 43, because 6 belong to tables that
later migrations removed (`20261022001000_remove_customer_messaging.sql` drops
4, `20261112001000_remove_whatsapp_cloud.sql` drops 9). An earlier analysis
reported drift here; that was a measurement error, not a real divergence.

One intentional difference remains: `mena_whatsapp_group_identity_migration_issues`
exists in the SQL but not in Drizzle. It is an operational scratch table used
only by `scripts/migrate-whatsapp-group-identities.mjs` to record data-migration
problems, so the app never queries it.

**Limit of the gate:** it is one-directional. It catches a Drizzle schema change
with no committed snapshot — the direction that produces "column does not exist"
failures in production. It does not compare against a live database, so it cannot
catch SQL written without a matching Drizzle change. The two-directional gate
needs a Postgres service in CI with the migrations applied to it, which is item 1
of §4.4 in `docs/audit/menaflow-recommendations-2026-11-22.md`. Do not treat this
gate as a substitute for that work.
