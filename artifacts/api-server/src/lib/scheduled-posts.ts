import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { logger } from "./logger";
import { publishPostToMeta } from "./meta-publishing";
import { notifyPostsChanged } from "./post-events";
import {
  normalizeChannels,
  postReadinessIssueForRow,
} from "../routes/posts-domain";
import { postReadinessMessage } from "./post-readiness";
import { recordOrEmpty as safeRecord } from "./value-utils.ts";

/**
 * The scheduled-posts worker (§4.7 of the audit): publishes posts whose
 * `scheduled_at` instant has passed.
 *
 * Claiming follows the established queue pattern (`FOR UPDATE SKIP LOCKED` +
 * an immediate status flip inside one transaction, as in
 * `meta-order-confirmation-queue.ts`), so two API instances can poll the same
 * table without double-publishing. The flip to `publishing` also mirrors what
 * the approval auto-publish path does, which keeps the mobile UI honest while
 * the Meta round-trip runs.
 *
 * Publishing reuses `publishPostToMeta` — the same function the auto-publish
 * flow uses — with the post's own channels; scheduling never invents
 * destinations.
 */

const BATCH_LIMIT = 10;

type ScheduledPost = typeof posts.$inferSelect;

async function claimDuePosts(now: Date): Promise<ScheduledPost[]> {
  return db.transaction(async (transaction) => {
    const due = await transaction
      .select({ id: posts.id, workspaceId: posts.workspaceId })
      .from(posts)
      .where(and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now)))
      .orderBy(asc(posts.scheduledAt), asc(posts.id))
      .limit(BATCH_LIMIT)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    const claimed = await transaction
      .update(posts)
      .set({
        status: "publishing",
        autoPublish: true,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            posts.id,
            due.map((row) => row.id),
          ),
          eq(posts.status, "scheduled"),
        ),
      )
      .returning();
    return claimed;
  });
}

async function publishClaimedPost(post: ScheduledPost): Promise<void> {
  const channels = normalizeChannels(post.channels).filter(
    (channel): channel is "facebook" | "instagram" =>
      channel === "facebook" || channel === "instagram",
  );

  // A post that lost its publishable channels or media between scheduling and
  // its due time goes back to review with the reason, exactly like the
  // approval auto-publish path — it must not silently fail or spin.
  const readiness = await postReadinessIssueForRow(post.workspaceId, post);
  const readinessIssue =
    channels.length === 0
      ? "لا توجد قناة قابلة للنشر (فيسبوك أو إنستغرام) في المنشور المجدول."
      : readiness
        ? postReadinessMessage(readiness)
        : null;
  if (readinessIssue) {
    await db
      .update(posts)
      .set({
        status: "review",
        error: readinessIssue,
        scheduledAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(posts.id, post.id), eq(posts.status, "publishing")));
    return;
  }

  let latestResults = safeRecord(post.publishResults);
  const persistResults = async () => {
    await db
      .update(posts)
      .set({ publishResults: latestResults, updatedAt: new Date() })
      .where(and(eq(posts.id, post.id), eq(posts.workspaceId, post.workspaceId)));
  };

  try {
    const results = await publishPostToMeta(
      post,
      channels,
      async (channel, result) => {
        latestResults = { ...latestResults, [channel]: result };
        await persistResults();
      },
      post.workspaceId,
      false,
      true,
    );
    latestResults = { ...latestResults, ...results };
    const fullyPublished = channels.every(
      (channel) => safeRecord(latestResults[channel]).status === "published",
    );
    const error = fullyPublished
      ? null
      : channels
          .map((channel) => {
            const result = safeRecord(latestResults[channel]);
            return result.status === "published"
              ? null
              : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
          })
          .filter(Boolean)
          .join("; ");
    await db
      .update(posts)
      .set({
        status: fullyPublished ? "published" : "failed",
        publishResults: latestResults,
        error,
        updatedAt: new Date(),
      })
      .where(and(eq(posts.id, post.id), eq(posts.workspaceId, post.workspaceId)));
  } catch (error) {
    logger.error(
      { err: error, postId: post.id },
      "Scheduled post publish failed",
    );
    const message =
      error instanceof Error ? error.message : "SCHEDULED_PUBLISH_FAILED";
    await db
      .update(posts)
      .set({
        status: "failed",
        publishResults: latestResults,
        error: message,
        updatedAt: new Date(),
      })
      .where(and(eq(posts.id, post.id), eq(posts.workspaceId, post.workspaceId)));
  }
}

export async function processScheduledPostsQueue(): Promise<{
  processed: number;
}> {
  const now = new Date();
  const claimed = await claimDuePosts(now);
  if (claimed.length === 0) return { processed: 0 };

  // Serial on purpose: Meta rate limits are per-page and a burst of parallel
  // graph calls buys nothing at this scale.
  for (const post of claimed) {
    await publishClaimedPost(post);
  }

  const notified = new Set<string>();
  for (const post of claimed) {
    for (const key of [post.ownerId, post.workspaceId]) {
      if (!notified.has(key)) {
        notified.add(key);
        notifyPostsChanged(key);
      }
    }
  }
  return { processed: claimed.length };
}
