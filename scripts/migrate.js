const { createRequire } = require("node:module");
const path = require("path");
const dbRequire = createRequire(path.resolve(__dirname, "../lib/db/package.json"));
const { Client } = dbRequire("pg");

for (const f of [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
]) {
  try {
    process.loadEnvFile(f);
  } catch (_) {}
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log("Connected to PostgreSQL successfully!");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_meta_connections (
      owner_id TEXT NOT NULL UNIQUE,
      page_id TEXT NOT NULL,
      page_name TEXT NOT NULL,
      encrypted_page_access_token TEXT NOT NULL,
      instagram_user_id TEXT,
      instagram_username TEXT,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("mena_meta_connections table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_oauth_states (
      state_hash TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  console.log("mena_oauth_states table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_whatsapp_connections (
      owner_id TEXT NOT NULL UNIQUE,
      instance_name TEXT NOT NULL,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      config_id TEXT,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("mena_whatsapp_connections table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_whatsapp_group_selections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES mena_whatsapp_connections(owner_id) ON DELETE CASCADE,
      instance_name TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      group_name TEXT NOT NULL,
      selected BOOLEAN NOT NULL DEFAULT TRUE,
      can_publish BOOLEAN NOT NULL,
      participant_role TEXT NOT NULL,
      announcement_only BOOLEAN NOT NULL,
      participant_count INTEGER,
      verified_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, group_jid)
    );
  `);
  console.log("mena_whatsapp_group_selections table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_posts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_message_id TEXT,
      source_group_jid TEXT,
      source_message_date TIMESTAMPTZ,
      source_text TEXT,
      media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
      auto_publish_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE mena_posts
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS source_message_id TEXT,
      ADD COLUMN IF NOT EXISTS source_group_jid TEXT,
      ADD COLUMN IF NOT EXISTS source_message_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS source_text TEXT,
      ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS auto_publish_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS publish_results JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS error TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  console.log("mena_posts table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_content_settings (
      owner_id TEXT PRIMARY KEY,
      auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      auto_publish_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      enabled_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("mena_content_settings table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_content_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS mena_content_jobs_pending_idx
      ON mena_content_jobs (status, next_run_at);
  `);
  console.log("mena_content_jobs table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_whatsapp_sync_states (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      instance_name TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      last_cursor TEXT,
      last_message_id TEXT,
      last_synced_at TIMESTAMPTZ,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, instance_name, group_jid)
    );
  `);
  console.log("mena_whatsapp_sync_states table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_whatsapp_messages (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      instance_name TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      remote_message_id TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      message_type TEXT NOT NULL,
      text_body TEXT,
      caption TEXT,
      media_available BOOLEAN NOT NULL DEFAULT FALSE,
      media_group_id TEXT,
      media_group_is_album BOOLEAN NOT NULL DEFAULT FALSE,
      media_group_expected_count INTEGER,
      media_group_index INTEGER,
      media_download_status TEXT NOT NULL DEFAULT 'not_required',
      media_download_error TEXT,
      source_media_payload JSONB,
      message_status TEXT NOT NULL DEFAULT 'received',
      source TEXT NOT NULL DEFAULT 'import',
      message_timestamp TIMESTAMPTZ,
      reply_to_remote_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, instance_name, group_jid, remote_message_id)
    );
  `);
  console.log("mena_whatsapp_messages table ready.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_whatsapp_message_media (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      instance_name TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      media_index INTEGER NOT NULL DEFAULT 0,
      media_type TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      storage_key TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sha256 TEXT,
      download_status TEXT NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, instance_name, group_jid, message_id, media_index, media_type)
    );
  `);
  await client.query(`
    ALTER TABLE mena_whatsapp_messages
      ADD COLUMN IF NOT EXISTS media_group_id TEXT,
      ADD COLUMN IF NOT EXISTS media_group_is_album BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS media_group_expected_count INTEGER,
      ADD COLUMN IF NOT EXISTS media_group_index INTEGER,
      ADD COLUMN IF NOT EXISTS media_download_status TEXT NOT NULL DEFAULT 'not_required',
      ADD COLUMN IF NOT EXISTS media_download_error TEXT,
      ADD COLUMN IF NOT EXISTS source_media_payload JSONB
  `);
  await client.query(`
    UPDATE mena_whatsapp_messages AS message
    SET media_group_is_album = TRUE
    WHERE message.media_group_expected_count IS NOT NULL
      OR lower(message.message_type) LIKE '%album%'
      OR message.media_group_id IN (
        SELECT media_group_id
        FROM mena_whatsapp_messages
        WHERE media_group_id IS NOT NULL
        GROUP BY media_group_id
        HAVING count(*) > 1
      )
  `);
  await client.query(`
    ALTER TABLE mena_whatsapp_message_media
      ADD COLUMN IF NOT EXISTS media_index INTEGER NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE mena_whatsapp_message_media
      DROP CONSTRAINT IF EXISTS mena_whatsapp_message_media_owner_id_instance_name_group_jid_message_id_media_type_key
  `);
  await client.query(`
    ALTER TABLE mena_whatsapp_message_media
      DROP CONSTRAINT IF EXISTS mena_whatsapp_message_media_owner_id_instance_name_group_ji_key
  `);
  await client.query(`
    DROP INDEX IF EXISTS mena_whatsapp_message_media_unique_key
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS mena_whatsapp_message_media_unique_key
      ON mena_whatsapp_message_media (
        owner_id, instance_name, group_jid, message_id, media_index, media_type
      )
  `);
  console.log("mena_whatsapp_message_media table ready.");

  // Seed Facebook page if available
  try {
    const fpRes = await client.query(
      "SELECT * FROM facebook_pages WHERE status='active' LIMIT 1"
    );
    if (fpRes.rows.length > 0) {
      const page = fpRes.rows[0];
      await client.query(
        `
        INSERT INTO mena_meta_connections (
          owner_id, page_id, page_name, encrypted_page_access_token, instagram_user_id, instagram_username, connected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (owner_id) DO UPDATE SET
          page_id = EXCLUDED.page_id,
          page_name = EXCLUDED.page_name,
          encrypted_page_access_token = EXCLUDED.encrypted_page_access_token;
      `,
        [
          "local-development-owner",
          page.page_id,
          page.page_name,
          page.page_access_token_encrypted,
          null,
          null,
        ]
      );
      console.log("Synced Facebook Page:", page.page_name);
    }
  } catch (err) {
    console.warn("Notice checking facebook_pages:", err.message);
  }

  // WhatsApp instances are created dynamically per owner in the app runtime.
  // Do not seed a shared, tenant-wide instance here because multi-tenant isolation
  // requires each user to have their own Evolution API instance and credentials.

  await client.end();
  console.log("Migration and sync completed successfully.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
