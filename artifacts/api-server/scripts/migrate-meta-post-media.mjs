import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(apiRoot, "..", "..");

for (const envPath of [
  path.resolve(repositoryRoot, ".env"),
  path.resolve(repositoryRoot, ".env2"),
  path.resolve(apiRoot, ".env"),
]) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
const dryRun = !process.argv.includes("--apply");
const { decryptMetaTokenForRotation } =
  await import("../src/lib/meta-token-crypto.ts");
const { fetchMetaPostImageFromGraph, isMetaMediaUrl } =
  await import("../src/lib/meta-post-media.ts");
const { storeProductMedia } =
  await import("../src/lib/product-media-storage.ts");

function importedPostIdentity(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const platform = metadata.externalPlatform;
  const postId = metadata.externalPostId;
  if (
    (platform !== "facebook" && platform !== "instagram") ||
    typeof postId !== "string" ||
    !postId.trim()
  ) {
    return null;
  }
  return { platform, postId };
}

function urls(value) {
  return Array.isArray(value)
    ? value.filter((url) => typeof url === "string")
    : [];
}

try {
  const result = await pool.query(
    `SELECT id, workspace_id, metadata, media_urls
     FROM public.mena_posts
     WHERE source_type = 'meta_import'`,
  );
  const candidates = result.rows.flatMap((post) => {
    const metaUrls = urls(post.media_urls).filter(isMetaMediaUrl);
    const identity = importedPostIdentity(post.metadata);
    return metaUrls.length === 1 && identity
      ? [{ post, oldUrl: metaUrls[0], identity }]
      : [];
  });

  if (dryRun) {
    console.log(
      `Dry run: ${candidates.length} imported Meta posts have one replaceable external image. Run with --apply to refresh and persist them.`,
    );
  } else {
    let repairedPosts = 0;
    let repairedProducts = 0;
    let skippedPosts = 0;

    for (const { post, oldUrl, identity } of candidates) {
      try {
        const connectionResult = await pool.query(
          `SELECT encrypted_page_access_token, instagram_user_id
           FROM public.mena_meta_connections
           WHERE workspace_id = $1
           LIMIT 1`,
          [post.workspace_id],
        );
        const connection = connectionResult.rows[0];
        if (
          !connection ||
          (identity.platform === "instagram" && !connection.instagram_user_id)
        ) {
          skippedPosts += 1;
          console.error(
            "Skipped imported post media: Meta connection is missing.",
          );
          continue;
        }

        const { accessToken } = decryptMetaTokenForRotation(
          connection.encrypted_page_access_token,
        );
        const { buffer, mimeType } = await fetchMetaPostImageFromGraph(
          accessToken,
          identity.platform,
          identity.postId,
        );
        const storedMedia = await storeProductMedia(
          post.workspace_id,
          buffer,
          mimeType,
        );

        const client = await pool.connect();
        let updated = false;
        let productCount = 0;
        try {
          await client.query("BEGIN");
          const currentResult = await client.query(
            `SELECT media_urls FROM public.mena_posts
             WHERE id = $1 AND workspace_id = $2
             FOR UPDATE`,
            [post.id, post.workspace_id],
          );
          const currentUrls = urls(currentResult.rows[0]?.media_urls);
          if (
            !currentResult.rows[0] ||
            JSON.stringify(currentUrls) !==
              JSON.stringify(urls(post.media_urls))
          ) {
            await client.query("ROLLBACK");
            skippedPosts += 1;
            continue;
          }

          await client.query(
            `UPDATE public.mena_posts
             SET media_urls = $1::jsonb, updated_at = now()
             WHERE id = $2 AND workspace_id = $3`,
            [
              JSON.stringify(
                currentUrls.map((url) =>
                  url === oldUrl ? storedMedia.id : url,
                ),
              ),
              post.id,
              post.workspace_id,
            ],
          );
          const linkedProducts = await client.query(
            `SELECT p.id, p.media_urls
             FROM public.mena_products p
             INNER JOIN public.mena_product_posts pp
               ON pp.workspace_id = p.workspace_id
              AND pp.product_id = p.id
             WHERE pp.workspace_id = $1 AND pp.post_id = $2
             FOR UPDATE OF p`,
            [post.workspace_id, post.id],
          );
          for (const product of linkedProducts.rows) {
            const productUrls = urls(product.media_urls);
            if (!productUrls.includes(oldUrl)) continue;
            await client.query(
              `UPDATE public.mena_products
               SET media_urls = $1::jsonb, updated_at = now()
               WHERE id = $2 AND workspace_id = $3`,
              [
                JSON.stringify(
                  productUrls.map((url) =>
                    url === oldUrl ? storedMedia.id : url,
                  ),
                ),
                product.id,
                post.workspace_id,
              ],
            );
            productCount += 1;
          }
          await client.query("COMMIT");
          updated = true;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        if (updated) {
          repairedPosts += 1;
          repairedProducts += productCount;
        }
      } catch (error) {
        skippedPosts += 1;
        console.error("Unable to refresh imported Meta post media:", {
          platform: identity.platform,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          cause:
            error &&
            typeof error === "object" &&
            "cause" in error &&
            error.cause &&
            typeof error.cause === "object" &&
            "code" in error.cause
              ? error.cause.code
              : undefined,
        });
      }
    }

    console.log(
      `Media repair complete: ${repairedPosts} posts and ${repairedProducts} linked products updated; ${skippedPosts} posts skipped.`,
    );
  }
} finally {
  await pool.end();
}
