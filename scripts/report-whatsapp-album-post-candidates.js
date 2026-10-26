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
  throw new Error("DATABASE_URL is required to report WhatsApp album candidates.");
}

const { Client } = createRequire(path.resolve(__dirname, "../lib/db/package.json"))("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(`
      WITH linked_posts AS (
        SELECT
          message.owner_id,
          message.instance_name,
          message.group_jid,
          message.sender_id,
          message.message_timestamp,
          post.id AS post_id,
          post.status AS post_status,
          post.created_at AS post_created_at,
          jsonb_array_length(post.media_urls) AS post_media_count
        FROM mena_whatsapp_messages AS message
        JOIN mena_posts AS post
          ON post.owner_id = message.owner_id
          AND post.source_type = 'whatsapp'
          AND post.source_message_id = message.id
        WHERE message.media_available = TRUE
          AND message.sender_id IS NOT NULL
          AND message.message_timestamp >= NOW() - INTERVAL '180 days'
      )
      SELECT
        first.post_id AS first_post_id,
        second.post_id AS second_post_id,
        first.message_timestamp AS first_message_at,
        second.message_timestamp AS second_message_at,
        EXTRACT(EPOCH FROM (second.message_timestamp - first.message_timestamp))::integer AS seconds_apart,
        first.post_status AS first_post_status,
        second.post_status AS second_post_status,
        first.post_media_count AS first_post_media_count,
        second.post_media_count AS second_post_media_count
      FROM linked_posts AS first
      JOIN linked_posts AS second
        ON second.owner_id = first.owner_id
        AND second.instance_name = first.instance_name
        AND second.group_jid = first.group_jid
        AND second.sender_id = first.sender_id
        AND second.post_id > first.post_id
        AND second.message_timestamp >= first.message_timestamp
        AND second.message_timestamp - first.message_timestamp <= INTERVAL '30 seconds'
      ORDER BY first.message_timestamp DESC
      LIMIT 1000
    `);
    console.log(JSON.stringify({
      readOnly: true,
      candidatesRequireManualReview: true,
      warning: "Proximity and sender are clues only; candidates are not proof of an album and must not be merged or deleted automatically.",
      candidatePairs: rows.rows.map((row) => ({
        postIds: [row.first_post_id, row.second_post_id],
        postStatuses: [row.first_post_status, row.second_post_status],
        messageTimes: [row.first_message_at, row.second_message_at],
        secondsApart: row.seconds_apart,
        mediaCounts: [row.first_post_media_count, row.second_post_media_count],
      })),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("WhatsApp album candidate report failed:", error.message);
  process.exitCode = 1;
});
