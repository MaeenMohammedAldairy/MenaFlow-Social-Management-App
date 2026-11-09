# Supabase database setup

This guide prepares a Supabase PostgreSQL database for the existing MenaFlow API. It does not create a Supabase project, move data, or deploy the API. The app uses Clerk for authentication and connects to PostgreSQL from the API server with `pg` and Drizzle; the database client rejects non-Supabase hosts. Do not put database credentials or Supabase service-role keys in the Expo app.

## 1. Create a free Supabase project

1. Create a project in the Supabase dashboard and choose a region near the API host and expected users.
2. Save the database password in a password manager. Do not put it in Git, a chat, or an Expo `EXPO_PUBLIC_*` variable.
3. Open **Project Settings → Database → Connection string**. For a long-running Node API, choose the **Session pooler** connection string when the API host uses IPv4. Use the direct connection only when the API host supports the project's IPv6 endpoint. Do not use the transaction pooler for this app's persistent `pg` pool.
4. Use the dashboard-provided URI and SSL settings. Supabase database connections require TLS; do not remove `sslmode=require` from the connection URI.

The free database can pause after inactivity and has plan limits. It is suitable for development/staging, but check current Supabase plan limits and backup/restore capabilities before using it for production data.

## 2. Create the schema on a new, empty project

The initial SQL is generated from the current Drizzle schema and is tracked as Supabase migrations:

- `supabase/migrations/20261019000000_initial_schema.sql`
- `supabase/migrations/20261019001000_lock_down_app_tables.sql`
- `supabase/migrations/20261020000000_workspace_onboarding.sql`
- `supabase/migrations/20261020002000_social_accounts_setup.sql`
- `supabase/migrations/20261110001000_inventory_delivery.sql`

The onboarding migration adds a progress table keyed by both user and
workspace. Accounts without a progress row (including existing accounts) are
treated as completed; a new account's workspace and first-slide progress row
are created together. The social-accounts migration adds a separate setup
completion flag, preserving existing accounts as complete while new workspaces
start with both the tour and social-account setup incomplete. Skipping the tour
does not mark social-account setup complete; that flag is saved only when the
user chooses to continue from the social accounts page.
Review and apply this migration through the normal Supabase migration workflow
before deploying an API version that serves the onboarding endpoints.

The second script enables Row Level Security and removes table privileges from Supabase's `anon` and `authenticated` API roles. This app authenticates with Clerk and accesses its tables only through the server, so no Supabase client policies are intended. The API must use a server-only database connection with the required table permissions.

For a new project, link the repository root and review the pending migration list before applying:

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run --linked
npx supabase db push --linked
npx supabase db push --dry-run --linked
```

The initial schema and access-control migrations were already applied to the linked project. The onboarding migration was reviewed with a dry run and then applied to the confirmed development database. Review and dry-run the social-accounts migration before applying it to any deployed database. Do not paste or re-run the initial SQL in the SQL Editor for this linked project. The initial migration creates all application tables; never apply it to a database that already contains these tables unless you have reviewed the migration state and schema.

The inventory and delivery migration adds optional per-product stock tracking,
order reservations and shipment deductions, inventory movement history, and
manual delivery/collection tracking. Review and apply it before deploying the
API and mobile changes that read or write these fields.

Do not use `drizzle-kit push --force` against either database. The checked-in SQL files are the reviewed baseline for a new Supabase database and should be evolved as incremental migrations.

## 3. Moving data from an existing PostgreSQL database

Schema creation and data transfer are separate operations. Do not copy the local `.env` or upload it to Supabase. Before transferring anything:

1. Establish the exact source database identity and environment. A `localhost` connection string may be a local proxy to another database; verify the actual server/database using a read-only query before assuming it is disposable or development data.
2. Stop API workers and writes to the source for the backup/cutover window.
3. Make and verify a restorable backup. Store it outside the repository, restrict access, and do not commit it.
4. Restore to a dedicated, empty Supabase project/database. Never restore into a database containing data unless a reviewed merge plan exists.
5. Apply the access-control migration after restore, then compare table names and row counts and run application smoke tests before switching API traffic.
6. Keep the original database and backup unchanged until the new deployment is verified and a rollback window has passed.

For a complete logical migration, use PostgreSQL's `pg_dump`/`pg_restore` tools with custom format, `--no-owner`, and `--no-acl`. Use a verified source URL and the Supabase destination URL from your secret manager or a protected shell session; never paste either URL into a checked-in file. Exclude database ownership/ACLs, restore into an empty target, and review role/grant/extension warnings rather than silently retrying with destructive flags. If the source is already on Supabase, use the dashboard's supported backup/restore or migration workflow where available.

MenaFlow also stores WhatsApp media files on the API server's filesystem. Copying PostgreSQL rows does **not** copy those files; the `storage_path` values will not resolve on another host unless the corresponding media files are migrated to persistent storage and the API is updated to use it. Do not remove the source media directory during a database migration.

## 4. Configure the API server

Set `DATABASE_URL` only in the API host's server-side secrets. Use the Supabase URI selected above, with TLS enabled. Keep the current `ENCRYPTION_KEY` available to the API when restoring existing Meta connections: encrypted access tokens cannot be decrypted with a newly generated key. If a documented previous key is available, use the controlled `ENCRYPTION_KEY_PREVIOUS` rotation procedure; do not replace or discard keys during a database move.

Keep these values server-side and separate from mobile build variables:

- `DATABASE_URL`
- `ENCRYPTION_KEY` and, temporarily when needed, `ENCRYPTION_KEY_PREVIOUS`
- Clerk server secret and Meta, Evolution, and AI provider secrets

Only a Clerk **publishable** key and the public HTTPS API origin may be embedded into an Expo build. The mobile app must call the deployed API; it must never connect directly to Supabase.

## 5. Verification and cutover

Before pointing the API at Supabase:

1. Confirm the API host can establish a TLS connection using the chosen connection URI.
2. Confirm all expected `mena_*` tables and foreign keys exist and the app roles cannot read them through Supabase's Data API.
3. Verify row counts and representative workspace relationships against the source backup without logging token values or personal message contents.
4. Start one API instance with the Supabase `DATABASE_URL`, run readiness (`/api/readyz`), and exercise authenticated read/write flows in a staging workspace.
5. Verify a backup can be restored before switching production traffic. Keep a rollback path to the unchanged source.

Creating the Supabase database does not deploy the API or make it publicly reachable. Deploy the API separately on a host with persistent media storage and configure its HTTPS URL, CORS, Clerk, Meta callback, and webhook settings before building the Android app.

## 6. WhatsApp media in Supabase Storage

WhatsApp media is uploaded by the API to a **private** Supabase Storage bucket.
Migration `20261022002000_whatsapp_media_storage_provider.sql` creates the
`whatsapp-media` bucket and ensures it remains private. Do not add public read
policies. The API uses the server-only
`SUPABASE_SERVICE_ROLE_KEY`; it verifies the signed media ID or authenticated
workspace membership before returning a file. Never add the service-role key
to the mobile app or an `EXPO_PUBLIC_*` variable.

Configure these secrets on the API host:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key.
- `SUPABASE_STORAGE_BUCKET`: optional; defaults to `whatsapp-media`.

If you set a custom bucket name, create a private bucket with that name before
deploying; the migration creates only the default bucket.

Apply `supabase/migrations/20261022002000_whatsapp_media_storage_provider.sql`
before deploying the API code. New uploads are saved in the private bucket;
the database keeps the durable object path and `storage_provider`, not a
temporary signed URL. Existing local files continue to work during rollout.

To migrate existing local WhatsApp media, first take a restorable backup of
the API media directory and database, then run a dry run:

```powershell
pnpm --filter @workspace/api-server exec node ./scripts/migrate-whatsapp-media-to-supabase.mjs --dry-run
```

After confirming the eligible record count and configuring the server secrets,
run the same command without `--dry-run`. The script uploads each object and
updates its database record only after the upload succeeds. It never deletes
the local source files; remove those only after verifying media access and
publishing behavior. The thumbnail worker creates small WebP previews
separately and retries records that have not yet received a thumbnail.
When WhatsApp supplies a valid SHA-256 media digest, the API reuses a
previously stored copy within the same workspace instead of downloading it
again; newly downloaded bytes are checked against that digest.

Image preview URLs are signed capabilities with a limited lifetime, generated
only when posts are fetched or a link needs refreshing. The mobile client
caches previews on disk and refreshes both variants shortly before expiry.
Original files remain available for publishing; thumbnail transformations do
not replace or reduce the original. Content listing uses 20-record keyset
pages, and it requests subsequent pages as the user scrolls.
