import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(apiRoot, "..", "..");
const mediaRoot = path.resolve(apiRoot, "storage", "whatsapp");
const batchSize = 25;

for (const envPath of [
  path.resolve(repositoryRoot, ".env"),
  path.resolve(repositoryRoot, ".env2"),
  path.resolve(apiRoot, ".env"),
]) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "whatsapp-media";
const dryRun = process.argv.includes("--dry-run");

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
if (!dryRun) {
  const parsedSupabaseUrl = new URL(supabaseUrl);
  if (
    parsedSupabaseUrl.protocol !== "https:" ||
    parsedSupabaseUrl.username ||
    parsedSupabaseUrl.password ||
    !/^[A-Za-z0-9._-]+$/.test(bucket)
  ) {
    throw new Error("SUPABASE_STORAGE_CONFIGURATION_INVALID");
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function objectPathFor(row, buffer) {
  const extension = path.extname(row.storage_path);
  const safeExtension = /^\.[a-zA-Z0-9]{1,12}$/.test(extension) ? extension : ".bin";
  const contentHash = hash(buffer);
  return [
    hash(row.workspace_id),
    "objects",
    `${contentHash}${safeExtension}`,
  ].join("/");
}

function storageObjectUrl(objectPath) {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${new URL(supabaseUrl).origin}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function assertInsideMediaRoot(filePath, mediaId) {
  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(mediaRoot, resolvedPath);
  if (
    !relativePath ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`MEDIA_PATH_OUTSIDE_STORAGE_ROOT:${mediaId}`);
  }
  return resolvedPath;
}

async function upload(objectPath, buffer, contentType) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(storageObjectUrl(objectPath), {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": contentType,
          "x-upsert": "true",
          "cache-control": "31536000",
        },
        body: buffer,
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return;
      if (
        response.status !== 408 &&
        response.status !== 429 &&
        response.status < 500
      ) {
        throw new Error(`SUPABASE_STORAGE_UPLOAD_HTTP_${response.status}`);
      }
      if (attempt === 4) {
        throw new Error(`SUPABASE_STORAGE_UPLOAD_HTTP_${response.status}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("SUPABASE_STORAGE_UPLOAD_HTTP_")
      ) {
        throw error;
      }
      if (attempt === 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
  }
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  if (dryRun) {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM public.mena_whatsapp_message_media WHERE storage_provider = 'local' AND download_status = 'stored'",
    );
    console.log(`Dry run: ${result.rows[0].count} local media records are eligible for migration.`);
  } else {
    let migrated = 0;
    while (true) {
      const { rows } = await pool.query(
        `SELECT id, owner_id, workspace_id, instance_name, group_jid, file_name,
                mime_type, sha256, storage_path, thumbnail_path
         FROM public.mena_whatsapp_message_media
         WHERE storage_provider = 'local' AND download_status = 'stored'
         ORDER BY created_at, id
         LIMIT $1`,
        [batchSize],
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        const resolvedPath = assertInsideMediaRoot(row.storage_path, row.id);
        const buffer = await readFile(resolvedPath);
        const objectPath = objectPathFor(row, buffer);
        await upload(objectPath, buffer, row.mime_type || "application/octet-stream");
        let thumbnailPath = null;
        if (row.thumbnail_path) {
          const resolvedThumbnailPath = assertInsideMediaRoot(row.thumbnail_path, row.id);
          try {
            const thumbnail = await readFile(resolvedThumbnailPath);
            thumbnailPath = `${objectPath.slice(0, -path.extname(objectPath).length)}.thumb.webp`;
            await upload(thumbnailPath, thumbnail, "image/webp");
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
              throw error;
            }
          }
        }
        const update = await pool.query(
          `UPDATE public.mena_whatsapp_message_media
           SET storage_key = $1, storage_path = $1, storage_provider = 'supabase',
               thumbnail_path = $2,
               updated_at = NOW()
           WHERE id = $3 AND workspace_id = $4 AND storage_provider = 'local'
             AND storage_path = $5`,
          [objectPath, thumbnailPath, row.id, row.workspace_id, row.storage_path],
        );
        if (update.rowCount === 1) {
          migrated += 1;
          console.log(`Migrated media record ${row.id}.`);
        } else {
          console.log(`Skipped media record ${row.id}; its storage record changed during migration.`);
        }
      }
    }
    console.log(`Migration complete: ${migrated} records moved; local files were retained.`);
  }
} finally {
  await pool.end();
}
