import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  posts,
  productPublicationJobs,
  products,
} from "@workspace/db";
import { publishPostToMeta } from "./meta-publishing.ts";
import { notifyPostsChanged } from "./post-events.ts";
import {
  composeProductPostBody,
  isProductPublicationActionRequired,
} from "./product-publishing-logic.ts";

type PublicationJob = typeof productPublicationJobs.$inferSelect;

async function updateJob(
  job: PublicationJob,
  values: Partial<typeof productPublicationJobs.$inferInsert>,
): Promise<void> {
  await db
    .update(productPublicationJobs)
    .set({ ...values, updatedAt: new Date() })
    .where(and(
      eq(productPublicationJobs.id, job.id),
      eq(productPublicationJobs.workspaceId, job.workspaceId),
    ));
}

async function markActionRequired(
  job: PublicationJob,
  reason: string,
): Promise<void> {
  await updateJob(job, {
    status: "action_required",
    lastError: reason,
    completedAt: new Date(),
  });
}

async function preparePost(job: PublicationJob) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(
      eq(products.id, job.productId),
      eq(products.workspaceId, job.workspaceId),
    ))
    .limit(1);
  if (!product || product.status === "archived") {
    await markActionRequired(job, "PRODUCT_NOT_AVAILABLE");
    return null;
  }
  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, job.workspaceId))
    .limit(1);
  const accountId = job.channel === "facebook"
    ? connection?.pageId
    : connection?.instagramUserId;
  if (!connection || accountId !== job.accountId) {
    await markActionRequired(job, "META_ACCOUNT_NOT_CONNECTED");
    return null;
  }
  if (job.channel === "instagram" && !product.mediaUrls.length) {
    await markActionRequired(job, "INSTAGRAM_MEDIA_REQUIRED");
    return null;
  }
  const body = composeProductPostBody(product);
  if (!body.trim()) {
    await markActionRequired(job, "PRODUCT_POST_CONTENT_REQUIRED");
    return null;
  }

  const postId = job.postId ?? randomUUID();
  const [post] = await db.transaction(async (transaction) => {
    if (!job.postId) {
      await transaction.insert(posts).values({
        id: postId,
        ownerId: job.ownerId,
        workspaceId: job.workspaceId,
        title: product.name,
        body,
        channels: [job.channel],
        status: "publishing",
        sourceType: "product",
        sourceMessageId: product.id,
        sourceText: body,
        mediaUrls: product.mediaUrls,
        metadata: {
          productId: product.id,
          publicationJobId: job.id,
          accountId: job.accountId,
        },
        autoPublish: false,
        autoPublishChannels: [],
        publishResults: {},
        updatedAt: new Date(),
      });
    }
    const [updatedJob] = await transaction
      .update(productPublicationJobs)
      .set({
        postId,
        status: "processing",
        lastError: null,
        startedAt: job.startedAt ?? new Date(),
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(productPublicationJobs.id, job.id),
        eq(productPublicationJobs.workspaceId, job.workspaceId),
      ))
      .returning();
    const [createdPost] = await transaction
      .select()
      .from(posts)
      .where(and(
        eq(posts.id, postId),
        eq(posts.workspaceId, job.workspaceId),
      ))
      .limit(1);
    if (!updatedJob || !createdPost) {
      throw new Error("PRODUCT_POST_PREPARATION_FAILED");
    }
    return [createdPost];
  });
  return post;
}

async function processPublicationJob(job: PublicationJob): Promise<void> {
  const post = await preparePost(job);
  if (!post) return;
  let latestResults = post.publishResults ?? {};
  try {
    const results = await publishPostToMeta(
      post,
      [job.channel],
      async (channel, result) => {
        latestResults = { ...latestResults, [channel]: result };
        await db
          .update(posts)
          .set({ publishResults: latestResults, updatedAt: new Date() })
          .where(and(
            eq(posts.id, post.id),
            eq(posts.workspaceId, job.workspaceId),
          ));
      },
      job.workspaceId,
      false,
      false,
    );
    latestResults = { ...latestResults, ...results };
    const result = results[job.channel];
    if (!result) throw new Error("META_PUBLISH_RESULT_MISSING");
    const status = result.status === "published"
      ? "published"
      : result.status === "unknown" || isProductPublicationActionRequired(result.reason ?? "")
        ? "action_required"
        : "failed";
    const reason = result.reason ?? null;
    await db
      .update(posts)
      .set({
        status: status === "published" ? "published" : "failed",
        publishResults: latestResults,
        error: reason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(posts.id, post.id),
        eq(posts.workspaceId, job.workspaceId),
      ));
    await updateJob(job, {
      status,
      permalink: result.url ?? null,
      lastError: status === "published" ? null : reason ?? result.status,
      completedAt: new Date(),
    });
    notifyPostsChanged(job.ownerId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "META_PUBLISH_FAILED";
    await db
      .update(posts)
      .set({
        status: "failed",
        publishResults: latestResults,
        error: reason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(posts.id, post.id),
        eq(posts.workspaceId, job.workspaceId),
      ));
    await updateJob(job, {
      status: isProductPublicationActionRequired(reason) ? "action_required" : "failed",
      lastError: reason,
      completedAt: new Date(),
    });
    notifyPostsChanged(job.ownerId);
  }
}

let publicationQueueRunning = false;

export async function processProductPublicationQueue(): Promise<void> {
  if (publicationQueueRunning) return;
  publicationQueueRunning = true;
  try {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const stale = await db
      .update(productPublicationJobs)
      .set({
        status: "action_required",
        lastError: "PUBLISH_RESULT_UNCERTAIN",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(productPublicationJobs.status, "processing"),
        lt(productPublicationJobs.updatedAt, staleBefore),
      ))
      .returning();
    for (const job of stale) {
      if (job.postId) {
        await db
          .update(posts)
          .set({ status: "failed", error: "PUBLISH_RESULT_UNCERTAIN", updatedAt: new Date() })
          .where(and(eq(posts.id, job.postId), eq(posts.workspaceId, job.workspaceId)));
      }
    }

    const jobs = await db.transaction(async (transaction) => {
      const queued = await transaction
        .select()
        .from(productPublicationJobs)
        .where(and(
          eq(productPublicationJobs.status, "queued"),
          lte(productPublicationJobs.nextRunAt, new Date()),
        ))
        .orderBy(asc(productPublicationJobs.createdAt))
        .limit(2)
        .for("update", { skipLocked: true });
      if (queued.length === 0) return [];
      return transaction
        .update(productPublicationJobs)
        .set({
          status: "processing",
          attempts: sql`${productPublicationJobs.attempts} + 1`,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(
          productPublicationJobs.id,
          queued.map((job) => job.id),
        ))
        .returning();
    });
    for (const job of jobs) {
      try {
        await processPublicationJob(job);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "PRODUCT_PUBLISH_FAILED";
        await updateJob(job, {
          status: "failed",
          lastError: reason,
          completedAt: new Date(),
        });
        console.error("Product publication job failed", {
          jobId: job.id,
          workspaceId: job.workspaceId,
          productId: job.productId,
          channel: job.channel,
          reason,
        });
      }
    }
  } finally {
    publicationQueueRunning = false;
  }
}
