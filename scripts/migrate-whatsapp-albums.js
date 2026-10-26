import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const file of [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../.env2"),
]) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to apply the WhatsApp album migration.");
}

const { Client } = createRequire(path.resolve(__dirname, "../lib/db/package.json"))("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const tables = await client.query(
      "SELECT to_regclass('mena_whatsapp_messages') AS messages, to_regclass('mena_whatsapp_message_media') AS media",
    );
    if (!tables.rows[0]?.messages || !tables.rows[0]?.media) {
      throw new Error("WhatsApp message tables do not exist; run the base database migration first.");
    }

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
      ALTER TABLE mena_whatsapp_message_media
        ADD COLUMN IF NOT EXISTS media_index INTEGER NOT NULL DEFAULT 0
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
        DROP CONSTRAINT IF EXISTS mena_whatsapp_message_media_owner_id_instance_name_group_jid_message_id_media_type_key
    `);
    await client.query(`
      ALTER TABLE mena_whatsapp_message_media
        DROP CONSTRAINT IF EXISTS mena_whatsapp_message_media_owner_id_instance_name_group_ji_key
    `);
    await client.query("DROP INDEX IF EXISTS mena_whatsapp_message_media_unique_key");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS mena_whatsapp_message_media_unique_key
        ON mena_whatsapp_message_media (
          owner_id, instance_name, group_jid, message_id, media_index, media_type
        )
    `);
    await client.query("COMMIT");
    console.log("WhatsApp album schema migration completed without modifying existing rows.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("WhatsApp album schema migration failed:", error.message);
  process.exitCode = 1;
});
