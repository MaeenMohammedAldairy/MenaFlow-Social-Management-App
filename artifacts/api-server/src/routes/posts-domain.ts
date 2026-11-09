import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
} from "@workspace/db";

import { recordOrEmpty as safeRecord } from "../lib/value-utils.ts";
import {
  publishPostToMeta,
  signedProductMediaUrl,
  signedWhatsAppMediaUrl,
} from "../lib/meta-publishing";
import {
  productMediaIdFromUrl,
  productMediaInfo,
} from "../lib/product-utils.ts";

import { postReadinessIssue } from "../lib/post-readiness";

import { notifyPostsChanged } from "../lib/post-events";

import {
  makePostActivityEvent,
  type PostActivityEventType,
} from "../lib/post-activity";

type InitialReviewPublishSummary = {
  processed: number;
  published: number;
  failed: number;
};

export function normalizeChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item): item is string => Boolean(item));
  return [
    ...new Set(
      list.filter((item) =>
        ["instagram", "facebook", "whatsapp"].includes(item),
      ),
    ),
  ];
}

export function sendPostQuotaError(
  res: import("express").Response,
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : "";
  if (!message.includes("SUBSCRIPTION_LIMIT_REACHED:posts")) return false;
  res.status(403).json({
    error:
      "بلغت الحد الشهري للمنشورات في خطتك الحالية. تظهر خيارات الترقية قريبًا.",
    code: "SUBSCRIPTION_LIMIT_REACHED",
  });
  return true;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

export function normalizePostMediaUrls(value: unknown): string[] {
  return normalizeStringArray(value).map((item) => {
    const productMediaId = productMediaIdFromUrl(item);
    if (productMediaId) return productMediaId;
    try {
      const mediaUrl = new URL(item);
      const match = mediaUrl.pathname.match(
        /^\/api\/social\/whatsapp\/public-media\/([^/]+)$/,
      );
      return match ? decodeURIComponent(match[1]) : item;
    } catch {
      return item;
    }
  });
}

export async function publishApprovedPosts(
  ownerId: string,
  workspaceId: string,
  channels: Array<"facebook" | "instagram">,
): Promise<InitialReviewPublishSummary> {
  const summary: InitialReviewPublishSummary = {
    processed: 0,
    published: 0,
    failed: 0,
  };

  while (true) {
    const candidates = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(eq(posts.workspaceId, workspaceId), eq(posts.status, "approved")),
      )
      .orderBy(asc(posts.createdAt), asc(posts.id))
      .limit(25);
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      const [post] = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, candidate.id),
            eq(posts.workspaceId, workspaceId),
            eq(posts.status, "approved"),
          ),
        )
        .limit(1);
      if (!post) continue;
      const readinessIssue = await postReadinessIssueForRow(workspaceId, post);
      if (readinessIssue) {
        await db
          .update(posts)
          .set({
            status: "review",
            error: readinessIssue,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, candidate.id),
              eq(posts.workspaceId, workspaceId),
              eq(posts.status, "approved"),
            ),
          );
        summary.processed += 1;
        summary.failed += 1;
        continue;
      }
      const [claimed] = await db
        .update(posts)
        .set({
          status: "publishing",
          channels,
          autoPublish: true,
          autoPublishChannels: channels,
          error: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posts.id, candidate.id),
            eq(posts.workspaceId, workspaceId),
            eq(posts.status, "approved"),
          ),
        )
        .returning();
      if (!claimed) continue;

      summary.processed += 1;
      let latestResults = safeRecord(claimed.publishResults);
      try {
        const results = await publishPostToMeta(
          claimed,
          channels,
          async (channel, result) => {
            latestResults = { ...latestResults, [channel]: result };
            await db
              .update(posts)
              .set({ publishResults: latestResults, updatedAt: new Date() })
              .where(
                and(
                  eq(posts.id, claimed.id),
                  eq(posts.workspaceId, workspaceId),
                ),
              );
          },
          workspaceId,
          false,
          true,
        );
        latestResults = { ...latestResults, ...results };
        const fullyPublished = channels.every(
          (channel) =>
            safeRecord(latestResults[channel]).status === "published",
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
          .where(
            and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
          );
        if (fullyPublished) summary.published += 1;
        else summary.failed += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AUTO_PUBLISH_FAILED";
        await db
          .update(posts)
          .set({
            status: "failed",
            publishResults: latestResults,
            error: message,
            updatedAt: new Date(),
          })
          .where(
            and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
          );
        summary.failed += 1;
      }
    }
  }

  if (summary.processed > 0) notifyPostsChanged(ownerId);
  return summary;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function normalizeStatus(value: unknown): string {
  return typeof value === "string" &&
    [
      "draft",
      "review",
      "approved",
      "scheduled",
      "publishing",
      "published",
      "failed",
    ].includes(value)
    ? value
    : "draft";
}

export function normalizeClientSettableStatus(
  value: unknown,
  fallback = "draft",
  allowApproved = false,
): string {
  if (fallback === "published" || fallback === "publishing") return fallback;
  if (value === "review" || value === "scheduled") return value;
  if (value === "approved" && allowApproved) return value;
  if (value === "draft") return "draft";
  return fallback;
}

export function postActivityEvents(
  ownerId: string,
  workspaceId: string,
  post: { id: string; title: string; channels: string[] },
  eventTypes: PostActivityEventType[],
  metaConnection: typeof menaMetaConnections.$inferSelect | undefined,
) {
  return post.channels.flatMap((channel) => {
    if (channel !== "facebook" && channel !== "instagram") return [];
    const accountId =
      channel === "facebook"
        ? (metaConnection?.pageId ?? null)
        : (metaConnection?.instagramUserId ?? null);
    return eventTypes.map((eventType) =>
      makePostActivityEvent({
        ownerId,
        workspaceId,
        postId: post.id,
        accountId,
        channel,
        eventType,
        actorId: ownerId,
        details: { title: post.title },
      }),
    );
  });
}

export async function workspaceMediaIds(
  workspaceId: string,
  mediaIds: string[],
): Promise<Set<string>> {
  const localIds = [
    ...new Set(mediaIds.filter((id) => !/^https?:\/\//i.test(id))),
  ];
  if (localIds.length === 0) return new Set();
  const authorizedIds = new Set(
    localIds.filter((id) => productMediaInfo(id, workspaceId) !== null),
  );
  const whatsappMediaIds = localIds.filter((id) => !authorizedIds.has(id));
  for (let offset = 0; offset < whatsappMediaIds.length; offset += 1000) {
    const rows = await db
      .select({ id: menaWhatsAppMessageMedia.id })
      .from(menaWhatsAppMessageMedia)
      .innerJoin(
        menaWhatsAppMessages,
        and(
          eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
          eq(menaWhatsAppMessages.workspaceId, workspaceId),
          eq(
            menaWhatsAppMessages.instanceName,
            menaWhatsAppMessageMedia.instanceName,
          ),
          or(
            eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
            and(
              isNull(menaWhatsAppMessages.groupId),
              isNull(menaWhatsAppMessageMedia.groupId),
              eq(
                menaWhatsAppMessages.groupJid,
                menaWhatsAppMessageMedia.groupJid,
              ),
            ),
          ),
        ),
      )
      .where(
        and(
          eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
          eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          inArray(
            menaWhatsAppMessageMedia.id,
            whatsappMediaIds.slice(offset, offset + 1000),
          ),
        ),
      );
    for (const row of rows) authorizedIds.add(row.id);
  }
  return authorizedIds;
}

export async function postReadinessIssueForRow(
  workspaceId: string,
  post: typeof posts.$inferSelect,
) {
  const mediaUrls = normalizePostMediaUrls(post.mediaUrls);
  const localMediaIds = mediaUrls.filter(
    (mediaUrl) => !/^https?:\/\//i.test(mediaUrl),
  );
  const availableMediaIds = await workspaceMediaIds(workspaceId, localMediaIds);
  const metadata = safeRecord(post.metadata);
  return postReadinessIssue({
    title: post.title,
    body: post.body,
    sourceType: post.sourceType,
    mediaUrls,
    availableMediaIds,
    sourceMediaComplete:
      typeof metadata.sourceMediaComplete === "boolean"
        ? metadata.sourceMediaComplete
        : undefined,
    expectedMediaCount:
      typeof metadata.sourceExpectedMediaCount === "number"
        ? metadata.sourceExpectedMediaCount
        : undefined,
    removedSourceMediaIds: Array.isArray(metadata.removedSourceMediaIds)
      ? metadata.removedSourceMediaIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  });
}

export async function responseForRow(
  row: typeof posts.$inferSelect,
  workspaceId: string,
  groupName?: string,
  authorizedMediaIds?: Set<string>,
  requestOrigin?: string,
) {
  const metadata = safeRecord(row.metadata);
  const mediaIds = normalizePostMediaUrls(row.mediaUrls);
  const authorizedIds =
    authorizedMediaIds ?? (await workspaceMediaIds(workspaceId, mediaIds));
  const mediaEntries = mediaIds
    .map((value, index) => {
      if (/^https?:\/\//i.test(value)) return { url: value, previewUrl: value };
      if (!authorizedIds.has(value)) return null;
      try {
        const isProductMedia = productMediaInfo(value, workspaceId) !== null;
        const url = isProductMedia
          ? signedProductMediaUrl(value, "original", requestOrigin)
          : signedWhatsAppMediaUrl(value, true, "original", requestOrigin);
        if (!url) return null;
        const thumbnailUrl = isProductMedia
          ? signedProductMediaUrl(value, "thumbnail", requestOrigin)
          : signedWhatsAppMediaUrl(value, true, "thumbnail", requestOrigin);
        return {
          url,
          previewUrl: index < 3 ? (thumbnailUrl ?? url) : url,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is { url: string; previewUrl: string } => entry !== null,
    );
  const mediaUrls = mediaEntries.map(({ url }) => url);
  const mediaPreviewUrls = mediaEntries.map(({ previewUrl }) => previewUrl);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    channels: Array.isArray(row.channels) ? row.channels : [],
    status: normalizeStatus(row.status),
    sourceType: row.sourceType ?? "manual",
    sourceMessageId: row.sourceMessageId ?? null,
    sourceGroupJid: row.sourceGroupJid ?? null,
    sourceGroupName:
      (typeof metadata.sourceGroupName === "string" &&
        metadata.sourceGroupName) ||
      groupName ||
      null,
    sourceMessageDate: toIso(row.sourceMessageDate ?? null),
    sourceText: row.sourceText ?? null,
    mediaUrls,
    mediaPreviewUrls,
    metadata,
    autoPublish: Boolean(row.autoPublish),
    autoPublishChannels: Array.isArray(row.autoPublishChannels)
      ? row.autoPublishChannels
      : [],
    publishResults: safeRecord(row.publishResults),
    error: row.error ?? null,
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? null,
  };
}
