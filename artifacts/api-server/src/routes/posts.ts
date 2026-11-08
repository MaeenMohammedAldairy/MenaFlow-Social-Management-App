import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import {
  db,
  menaContentSettings,
  menaMetaConnections,
  menaPostActivityEvents,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  menaWhatsAppGroupSelections,
  posts,
} from "@workspace/db";
import {
  CreatePostBody,
  DeletePostParams,
  UpdatePostBody,
  UpdatePostParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { recordOrEmpty as safeRecord } from "../lib/value-utils.ts";
import {
  publishPostToMeta,
  signedProductMediaUrl,
  signedWhatsAppMediaUrl,
  verifyFacebookPublishStatus,
} from "../lib/meta-publishing";
import {
  productMediaIdFromUrl,
  productMediaInfo,
} from "../lib/product-utils.ts";
import { unconnectedMetaChannels } from "../lib/meta-channel-routing";
import { parsePublishRequestBody } from "../lib/publish-retry";
import {
  postReadinessIssue,
  postReadinessMessage,
} from "../lib/post-readiness";
import {
  processWhatsAppBacklog,
  processWhatsAppMessage,
} from "../lib/whatsapp-marketing";
import { notifyPostsChanged, subscribeToPostChanges } from "../lib/post-events";
import { logger } from "../lib/logger";
import {
  makePostActivityEvent,
  type PostActivityEventType,
} from "../lib/post-activity";

const router: IRouter = Router();

type InitialReviewPublishSummary = {
  processed: number;
  published: number;
  failed: number;
};

function normalizeChannels(value: unknown): string[] {
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

function sendPostQuotaError(
  res: import("express").Response,
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : "";
  if (!message.includes("SUBSCRIPTION_LIMIT_REACHED:posts")) return false;
  res.status(403).json({
    error: "بلغت الحد الشهري للمنشورات في خطتك الحالية. تظهر خيارات الترقية قريبًا.",
    code: "SUBSCRIPTION_LIMIT_REACHED",
  });
  return true;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function normalizePostMediaUrls(value: unknown): string[] {
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

async function publishApprovedPosts(
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

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function normalizeStatus(value: unknown): string {
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

function normalizeClientSettableStatus(
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

function postActivityEvents(
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

async function workspaceMediaIds(
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

async function postReadinessIssueForRow(
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

async function responseForRow(
  row: typeof posts.$inferSelect,
  workspaceId: string,
  groupName?: string,
  authorizedMediaIds?: Set<string>,
  requestOrigin?: string,
) {
  const metadata = safeRecord(row.metadata);
  const mediaIds = normalizePostMediaUrls(row.mediaUrls);
  const authorizedIds = authorizedMediaIds ??
    await workspaceMediaIds(workspaceId, mediaIds);
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
          previewUrl: index < 3 ? thumbnailUrl ?? url : url,
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

router.get("/posts", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const requestHost = req.get("host");
    const requestOrigin = requestHost
      ? `${req.protocol}://${requestHost}`
      : undefined;
    const [list, groupSelections] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(eq(posts.workspaceId, workspaceId))
        .orderBy(desc(posts.createdAt)),
      db
        .select({
          groupJid: menaWhatsAppGroupSelections.groupJid,
          groupName: menaWhatsAppGroupSelections.groupName,
        })
        .from(menaWhatsAppGroupSelections)
        .where(eq(menaWhatsAppGroupSelections.workspaceId, workspaceId)),
    ]);
    const groupNames = new Map(
      groupSelections.map(({ groupJid, groupName }) => [groupJid, groupName]),
    );
    const allMediaIds = list.flatMap((row) =>
      normalizePostMediaUrls(row.mediaUrls),
    );
    const authorizedMediaIds = await workspaceMediaIds(
      workspaceId,
      allMediaIds,
    );

    res.json(
      await Promise.all(
        list.map((row) =>
          responseForRow(
            row,
            workspaceId,
            row.sourceGroupJid ? groupNames.get(row.sourceGroupJid) : undefined,
            authorizedMediaIds,
            requestOrigin,
          ),
        ),
      ),
    );
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "تعذر تحميل المنشورات." });
  }
});

router.post("/posts/known-ids", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  if (
    !Array.isArray(body.ids) ||
    body.ids.length > 1000 ||
    body.ids.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 150,
    )
  ) {
    res.status(400).json({ error: "قائمة معرّفات المنشورات غير صالحة." });
    return;
  }
  const ids = [...new Set(body.ids as string[])];
  if (ids.length === 0) {
    res.json({ ids: [] });
    return;
  }
  try {
    const rows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.workspaceId, workspaceId), inArray(posts.id, ids)));
    res.json({ ids: rows.map((row) => row.id) });
  } catch (error) {
    console.error("Error checking cached post IDs:", error);
    res.status(500).json({ error: "تعذر التحقق من المنشورات المحفوظة." });
  }
});

router.get("/posts/page", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const requestedLimit = Number(req.query.limit ?? 20);
  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 50
  ) {
    res.status(400).json({ error: "حجم الصفحة يجب أن يكون بين 1 و50." });
    return;
  }

  let cursor: { createdAt: Date; id: string } | null = null;
  if (typeof req.query.cursor === "string") {
    try {
      const value = JSON.parse(
        Buffer.from(req.query.cursor, "base64url").toString("utf8"),
      );
      if (
        !value ||
        typeof value.createdAt !== "string" ||
        typeof value.id !== "string" ||
        !value.id
      )
        throw new Error("INVALID_POST_CURSOR");
      const createdAt = new Date(value.createdAt);
      if (Number.isNaN(createdAt.getTime()))
        throw new Error("INVALID_POST_CURSOR");
      cursor = { createdAt, id: value.id };
    } catch {
      res.status(400).json({ error: "مؤشر الصفحة غير صالح." });
      return;
    }
  }

  try {
    const requestHost = req.get("host");
    const requestOrigin = requestHost
      ? `${req.protocol}://${requestHost}`
      : undefined;
    const filters = [eq(posts.workspaceId, workspaceId)];
    if (cursor) {
      const cursorFilter = or(
        lt(posts.createdAt, cursor.createdAt),
        and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id)),
      );
      if (cursorFilter) filters.push(cursorFilter);
    }
    const [rows, groupSelections] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(and(...filters))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(requestedLimit + 1),
      db
        .select({
          groupJid: menaWhatsAppGroupSelections.groupJid,
          groupName: menaWhatsAppGroupSelections.groupName,
        })
        .from(menaWhatsAppGroupSelections)
        .where(eq(menaWhatsAppGroupSelections.workspaceId, workspaceId)),
    ]);
    const hasMore = rows.length > requestedLimit;
    const pageRows = rows.slice(0, requestedLimit);
    const groupNames = new Map(
      groupSelections.map(({ groupJid, groupName }) => [groupJid, groupName]),
    );
    const mediaIds = pageRows.flatMap((row) =>
      normalizePostMediaUrls(row.mediaUrls),
    );
    const authorizedMediaIds = await workspaceMediaIds(workspaceId, mediaIds);
    const items = await Promise.all(
      pageRows.map((row) =>
        responseForRow(
          row,
          workspaceId,
          row.sourceGroupJid ? groupNames.get(row.sourceGroupJid) : undefined,
          authorizedMediaIds,
          requestOrigin,
        ),
      ),
    );
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? Buffer.from(
            JSON.stringify({
              createdAt: toIso(lastRow.createdAt),
              id: lastRow.id,
            }),
          ).toString("base64url")
        : null;
    res.json({ items, nextCursor });
  } catch (error) {
    console.error("Error fetching posts page:", error);
    res.status(500).json({ error: "تعذر تحميل المنشورات." });
  }
});

router.get("/posts/events", requireWorkspace, (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  const unsubscribeOwner = subscribeToPostChanges(ownerId, () => {
    res.write("event: posts_changed\ndata: {}\n\n");
  });
  const unsubscribeWorkspace = subscribeToPostChanges(workspaceId, () => {
    res.write("event: posts_changed\ndata: {}\n\n");
  });
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeOwner();
    unsubscribeWorkspace();
  });
});

router.get(
  "/posts/auto-publish-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    try {
      const [settings] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      res.json({
        enabled: Boolean(settings?.autoPublishEnabled),
        channels: settings
          ? normalizeChannels(settings.autoPublishChannels)
          : [],
        enabledAt: settings?.enabledAt
          ? settings.enabledAt.toISOString()
          : null,
      });
    } catch (error) {
      console.error("Error loading auto-publish settings:", error);
      res.status(500).json({ error: "تعذر تحميل إعدادات النشر التلقائي." });
    }
  },
);

router.put(
  "/posts/auto-publish-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const enabled = req.body?.enabled;
    const requestedChannels = normalizeChannels(req.body?.channels);
    const channels = requestedChannels.filter(
      (channel): channel is "facebook" | "instagram" =>
        channel === "facebook" || channel === "instagram",
    );
    if (
      typeof enabled !== "boolean" ||
      channels.length !== requestedChannels.length ||
      (enabled && channels.length === 0)
    ) {
      res
        .status(400)
        .json({ error: "اختر منصة واحدة على الأقل لتفعيل النشر التلقائي." });
      return;
    }
    try {
      const [metaConnection] = await db
        .select({
          pageId: menaMetaConnections.pageId,
          instagramUserId: menaMetaConnections.instagramUserId,
        })
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const unconnectedChannels = enabled
        ? unconnectedMetaChannels(channels, metaConnection)
        : [];
      if (unconnectedChannels.length > 0) {
        res.status(400).json({
          error: `اربط ${unconnectedChannels.map((channel) => (channel === "facebook" ? "فيسبوك" : "إنستغرام")).join(" و")} قبل تفعيل النشر التلقائي عليها.`,
        });
        return;
      }
      const [current] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      const enabledAt = enabled
        ? current?.autoPublishEnabled
          ? current.enabledAt
          : new Date()
        : null;
      const [saved] = await db
        .insert(menaContentSettings)
        .values({
          ownerId,
          workspaceId,
          autoPublishEnabled: enabled,
          autoPublishChannels: channels,
          enabledAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: menaContentSettings.workspaceId,
          setWhere: eq(menaContentSettings.workspaceId, workspaceId),
          set: {
            autoPublishEnabled: enabled,
            autoPublishChannels: channels,
            enabledAt,
            updatedAt: new Date(),
          },
        })
        .returning();
      const initialPublish =
        enabled && !current?.autoPublishEnabled
          ? await publishApprovedPosts(ownerId, workspaceId, channels)
          : undefined;
      res.json({
        enabled: saved.autoPublishEnabled,
        channels: normalizeChannels(saved.autoPublishChannels),
        enabledAt: saved.enabledAt?.toISOString() ?? null,
        ...(initialPublish ? { initialPublish } : {}),
      });
    } catch (error) {
      console.error("Error saving auto-publish settings:", error);
      res.status(500).json({ error: "تعذر حفظ إعدادات النشر التلقائي." });
    }
  },
);

router.post(
  "/posts/process-whatsapp-backlog",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const requestedLimit = Number(req.body?.limit ?? 50);
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      res
        .status(400)
        .json({ error: "الحد الأقصى للتحليل هو 100 رسالة في الطلب." });
      return;
    }
    try {
      const result = await processWhatsAppBacklog(workspaceId, requestedLimit);
      res.json(result);
    } catch (error) {
      console.error("Error processing WhatsApp backlog:", error);
      res.status(500).json({ error: "تعذر تحليل الرسائل القديمة." });
    }
  },
);

router.post("/posts", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const payload = req.body ?? {};
  const parseResult = CreatePostBody.safeParse(payload);
  if (!parseResult.success) {
    res.status(400).json({ error: "البيانات المدخلة غير صالحة." });
    return;
  }

  const data = parseResult.data;
  const postId =
    String(
      (payload as Record<string, unknown>).id ?? data.id ?? randomUUID(),
    ).trim() || randomUUID();

  try {
    const [existing] = await db
      .select({ ownerId: posts.ownerId })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);
    if (existing && existing.ownerId !== ownerId) {
      res.status(409).json({ error: "معرّف المنشور مستخدم بالفعل." });
      return;
    }
    const mediaUrls = normalizePostMediaUrls(
      (payload as Record<string, unknown>).mediaUrls,
    );
    if (
      (await workspaceMediaIds(workspaceId, mediaUrls)).size !==
      mediaUrls.filter((id) => !/^https?:\/\//i.test(id)).length
    ) {
      res
        .status(422)
        .json({ error: "تحتوي الوسائط على ملفات غير متاحة في مساحة العمل." });
      return;
    }
    const postValues = {
      title: data.title ?? "",
      body: data.body ?? "",
      channels: normalizeChannels(data.channels),
      status: normalizeClientSettableStatus(data.status, "draft"),
      sourceType:
        typeof payload.sourceType === "string" ? payload.sourceType : "manual",
      sourceMessageId:
        typeof payload.sourceMessageId === "string"
          ? payload.sourceMessageId
          : null,
      sourceGroupJid:
        typeof payload.sourceGroupJid === "string"
          ? payload.sourceGroupJid
          : null,
      sourceMessageDate: payload.sourceMessageDate
        ? new Date(String(payload.sourceMessageDate))
        : null,
      sourceText:
        typeof payload.sourceText === "string" ? payload.sourceText : null,
      mediaUrls,
      metadata: safeRecord((payload as Record<string, unknown>).metadata),
      autoPublish: Boolean((payload as Record<string, unknown>).autoPublish),
      autoPublishChannels: normalizeChannels(
        (payload as Record<string, unknown>).autoPublishChannels,
      ),
      publishResults: {},
      error: null,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await db
          .update(posts)
          .set(postValues)
          .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
          .returning()
      : await db
          .insert(posts)
          .values({
            id: postId,
            ownerId,
            workspaceId,
            ...postValues,
            createdAt: new Date(),
          })
          .onConflictDoNothing()
          .returning();
    if (!saved) {
      res
        .status(409)
        .json({ error: "تعذّر حفظ المنشور بسبب تعارض في المعرّف." });
      return;
    }
    if (!existing) {
      const [metaConnection] = await db
        .select()
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const eventTypes: PostActivityEventType[] = ["post_created"];
      if (saved.status === "review")
        eventTypes.push("post_submitted_for_review");
      if (saved.status === "scheduled") eventTypes.push("post_scheduled");
      const events = postActivityEvents(
        ownerId,
        workspaceId,
        {
          id: saved.id,
          title: saved.title,
          channels: normalizeChannels(saved.channels),
        },
        eventTypes,
        metaConnection,
      );
      if (events.length > 0)
        await db.insert(menaPostActivityEvents).values(events);
    }
    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res
      .status(201)
      .json(
        await responseForRow(
          saved,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      );
  } catch (error) {
    if (sendPostQuotaError(res, error)) return;
    console.error("Error creating post:", error);
    res.status(500).json({ error: "تعذر حفظ المنشور في الخادم." });
  }
});

router.patch("/posts/:id", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const paramResult = UpdatePostParams.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: "معرّف المنشور غير صالح." });
    return;
  }

  const bodyResult = UpdatePostBody.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: "البيانات المدخلة غير صالحة." });
    return;
  }

  const postId = paramResult.data.id;
  const updates = bodyResult.data;
  const rawBody = req.body ?? {};

  try {
    const [current] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }
    if (
      current.status === "publishing" &&
      (updates.title !== undefined ||
        updates.body !== undefined ||
        updates.channels !== undefined ||
        Array.isArray(rawBody.mediaUrls))
    ) {
      res
        .status(409)
        .json({ error: "لا يمكن تعديل محتوى المنشور أثناء إرساله." });
      return;
    }
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (updates.title !== undefined) updateValues.title = updates.title;
    if (updates.body !== undefined) updateValues.body = updates.body;
    if (updates.channels !== undefined)
      updateValues.channels = normalizeChannels(updates.channels);
    if (updates.status !== undefined) {
      const nextStatus = normalizeClientSettableStatus(
        updates.status,
        current.status,
        true,
      );
      if (nextStatus === "approved") {
        const readinessIssue = await postReadinessIssueForRow(workspaceId, {
          ...current,
          ...updates,
          sourceType:
            typeof rawBody.sourceType === "string"
              ? rawBody.sourceType
              : current.sourceType,
          mediaUrls: Array.isArray(rawBody.mediaUrls)
            ? normalizePostMediaUrls(rawBody.mediaUrls)
            : current.mediaUrls,
        });
        if (readinessIssue) {
          res.status(422).json({ error: postReadinessMessage(readinessIssue) });
          return;
        }
      }
      updateValues.status = nextStatus;
      if (
        nextStatus === "draft" ||
        nextStatus === "review" ||
        nextStatus === "approved"
      ) {
        updateValues.error = null;
      }
    }
    if (typeof rawBody.sourceType === "string")
      updateValues.sourceType = rawBody.sourceType;
    if (typeof rawBody.sourceMessageId === "string")
      updateValues.sourceMessageId = rawBody.sourceMessageId;
    if (typeof rawBody.sourceGroupJid === "string")
      updateValues.sourceGroupJid = rawBody.sourceGroupJid;
    if (rawBody.sourceMessageDate)
      updateValues.sourceMessageDate = new Date(
        String(rawBody.sourceMessageDate),
      );
    if (typeof rawBody.sourceText === "string")
      updateValues.sourceText = rawBody.sourceText;
    const currentMetadata = safeRecord(current.metadata);
    if (Array.isArray(rawBody.mediaUrls)) {
      const mediaUrls = normalizePostMediaUrls(rawBody.mediaUrls);
      if (
        (await workspaceMediaIds(workspaceId, mediaUrls)).size !==
        mediaUrls.filter((id) => !/^https?:\/\//i.test(id)).length
      ) {
        res
          .status(422)
          .json({ error: "تحتوي الوسائط على ملفات غير متاحة في مساحة العمل." });
        return;
      }
      updateValues.mediaUrls = mediaUrls;
      if (
        current.sourceType === "whatsapp" &&
        Array.isArray(currentMetadata.sourceMedia)
      ) {
        const sourceMediaIds = currentMetadata.sourceMedia
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string");
        const selectedMediaIds = new Set(mediaUrls);
        updateValues.metadata = {
          ...currentMetadata,
          removedSourceMediaIds: sourceMediaIds.filter(
            (id) => !selectedMediaIds.has(id),
          ),
        };
      }
    }
    if (rawBody.metadata !== undefined) {
      updateValues.metadata = {
        ...safeRecord(updateValues.metadata ?? currentMetadata),
        ...safeRecord(rawBody.metadata),
      };
    } else if (
      updates.body !== undefined &&
      current.sourceType === "whatsapp" &&
      typeof currentMetadata.instagramBody === "string"
    ) {
      updateValues.metadata = {
        ...currentMetadata,
        instagramBody: updates.body,
      };
    }
    if (rawBody.autoPublish !== undefined)
      updateValues.autoPublish = Boolean(rawBody.autoPublish);
    if (Array.isArray(rawBody.autoPublishChannels))
      updateValues.autoPublishChannels = normalizeChannels(
        rawBody.autoPublishChannels,
      );

    const [updated] = await db
      .update(posts)
      .set(updateValues)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    const eventTypes: PostActivityEventType[] = [];
    const contentChanged =
      updates.title !== undefined ||
      updates.body !== undefined ||
      updates.channels !== undefined ||
      Array.isArray(rawBody.mediaUrls) ||
      rawBody.metadata !== undefined;
    if (contentChanged) eventTypes.push("post_edited");
    if (updates.status !== undefined && updates.status !== current.status) {
      const nextStatus = normalizeClientSettableStatus(
        updates.status,
        current.status,
        true,
      );
      if (nextStatus === "review") eventTypes.push("post_submitted_for_review");
      if (nextStatus === "approved") eventTypes.push("post_approved");
      if (nextStatus === "scheduled") {
        eventTypes.push("post_scheduled");
      }
      if (current.status === "review" && nextStatus === "published") {
        eventTypes.push("post_approved");
      }
    }
    if (eventTypes.length > 0) {
      const [metaConnection] = await db
        .select()
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const events = postActivityEvents(
        ownerId,
        workspaceId,
        {
          id: updated.id,
          title: updated.title,
          channels: normalizeChannels(updated.channels),
        },
        eventTypes,
        metaConnection,
      );
      if (events.length > 0)
        await db.insert(menaPostActivityEvents).values(events);
    }

    let responsePost = updated;
    if (current.status !== "approved" && updated.status === "approved") {
      const [settings] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      const autoPublishChannels = normalizeChannels(
        settings?.autoPublishChannels,
      );
      if (settings?.autoPublishEnabled && autoPublishChannels.length > 0) {
        await publishApprovedPosts(
          ownerId,
          workspaceId,
          autoPublishChannels as Array<"facebook" | "instagram">,
        );
        const [latest] = await db
          .select()
          .from(posts)
          .where(
            and(eq(posts.id, updated.id), eq(posts.workspaceId, workspaceId)),
          )
          .limit(1);
        if (latest) responsePost = latest;
      }
    }

    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.json(
      await responseForRow(
        responsePost,
        workspaceId,
        undefined,
        undefined,
        req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
      ),
    );
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "تعذر تحديث المنشور." });
  }
});

router.post(
  "/posts/:id/verify-facebook",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    const paramResult = UpdatePostParams.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: "معرّف المنشور غير صالح." });
      return;
    }

    try {
      const [row] = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, paramResult.data.id),
            eq(posts.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "المنشور غير موجود." });
        return;
      }

      const currentResults = safeRecord(row.publishResults);
      const facebookResult = safeRecord(currentResults.facebook);
      if (facebookResult.status !== "unknown" || row.status !== "failed") {
        res
          .status(409)
          .json({ error: "لا توجد نتيجة نشر غير مؤكدة لفيسبوك للتحقق منها." });
        return;
      }

      const verification = await verifyFacebookPublishStatus(row, workspaceId);
      let updated = row;
      if (verification.status === "found") {
        const publishResults: Record<string, unknown> = {
          ...currentResults,
          facebook: verification.result,
        };
        const channels = normalizeChannels(row.channels);
        const fullyPublished =
          channels.length > 0 &&
          channels.every(
            (channel) =>
              safeRecord(publishResults[channel]).status === "published",
          );
        const error = fullyPublished
          ? null
          : channels
              .map((channel) => {
                const result = safeRecord(publishResults[channel]);
                return result.status === "published"
                  ? null
                  : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
              })
              .filter(Boolean)
              .join("; ");
        [updated] = await db
          .update(posts)
          .set({
            publishResults,
            status: fullyPublished ? "published" : "failed",
            error,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, row.id),
              eq(posts.workspaceId, workspaceId),
              eq(posts.status, "failed"),
            ),
          )
          .returning();
        if (!updated) {
          res
            .status(409)
            .json({
              error:
                "تغيّرت حالة المنشور أثناء التحقق؛ حدّث الصفحة وحاول مجدداً.",
            });
          return;
        }
        if (verification.result.status === "published") {
          const [metaConnection] = await db
            .select({ pageId: menaMetaConnections.pageId })
            .from(menaMetaConnections)
            .where(eq(menaMetaConnections.workspaceId, workspaceId))
            .limit(1);
          if (metaConnection) {
            await db.insert(menaPostActivityEvents).values(
              makePostActivityEvent({
                ownerId,
                workspaceId,
                postId: row.id,
                accountId: metaConnection.pageId,
                channel: "facebook",
                eventType: "publish_verified",
                actorId: ownerId,
                details: {
                  status: "published",
                  externalPostId: verification.result.postId,
                  url: verification.result.url,
                },
              }),
            );
          }
        }
      } else if (verification.status === "not-found") {
        const channels = normalizeChannels(row.channels);
        const publishResults: Record<string, unknown> = {
          ...currentResults,
          facebook: {
            ...facebookResult,
            status: "failed",
            reason: "FACEBOOK_POST_NOT_FOUND_AFTER_VERIFICATION",
          },
        };
        const error = channels
          .map((channel) => {
            const result = safeRecord(publishResults[channel]);
            return result.status === "published"
              ? null
              : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
          })
          .filter(Boolean)
          .join("; ");
        [updated] = await db
          .update(posts)
          .set({
            publishResults,
            error,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, row.id),
              eq(posts.workspaceId, workspaceId),
              eq(posts.status, "failed"),
              eq(posts.updatedAt, row.updatedAt),
            ),
          )
          .returning();
        if (!updated) {
          res
            .status(409)
            .json({
              error:
                "تغيّرت حالة المنشور أثناء التحقق؛ حدّث الصفحة وحاول مجدداً.",
            });
          return;
        }
      }

      if (verification.status !== "unavailable") notifyPostsChanged(ownerId);
      res.json({
        status: verification.status,
        reason:
          verification.status === "unavailable"
            ? (verification.reason ?? "FACEBOOK_RESULT_CANNOT_BE_VERIFIED")
            : verification.status === "not-found"
              ? "FACEBOOK_POST_NOT_FOUND_AFTER_VERIFICATION"
              : null,
        post: await responseForRow(
          updated,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      });
    } catch (error) {
      logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error
              ? error.message
              : "FACEBOOK_STATUS_CHECK_FAILED",
        },
        "Facebook publish status check failed",
      );
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "FACEBOOK_STATUS_CHECK_FAILED",
      });
    }
  },
);

router.post("/posts/:id/publish", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const publishRequest = parsePublishRequestBody(req.body);
  if (!publishRequest) {
    res.status(400).json({ error: "بيانات طلب النشر غير صالحة." });
    return;
  }

  const paramResult = UpdatePostParams.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: "معرّف المنشور غير صالح." });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, paramResult.data.id),
          eq(posts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    const selectedChannels = normalizeChannels(
      publishRequest.channels ?? row.channels,
    );
    if (
      selectedChannels.some(
        (channel) => channel !== "facebook" && channel !== "instagram",
      )
    ) {
      res.status(400).json({ error: "النشر متاح لفيسبوك وإنستغرام فقط." });
      return;
    }
    const channels = selectedChannels;
    const retryUncertain = publishRequest.retryUncertain;
    logger.info(
      {
        requestId: req.id,
        retryUncertain,
        channels,
      },
      "Post publish request received",
    );
    if (channels.length === 0) {
      res.status(400).json({ error: "اختر فيسبوك أو إنستغرام قبل النشر." });
      return;
    }
    const readinessIssue = await postReadinessIssueForRow(workspaceId, row);
    if (readinessIssue) {
      res.status(422).json({ error: postReadinessMessage(readinessIssue) });
      return;
    }
    if (row.status === "publishing" || row.status === "published") {
      res
        .status(409)
        .json({
          error: "المنشور قيد الإرسال أو سبق نشره؛ لا يمكن إعادة إرساله.",
        });
      return;
    }

    const [claimed] = await db
      .update(posts)
      .set({
        channels,
        status: "publishing",
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posts.id, row.id),
          eq(posts.workspaceId, workspaceId),
          notInArray(posts.status, ["publishing", "published"]),
        ),
      )
      .returning();
    if (!claimed) {
      res
        .status(409)
        .json({ error: "هناك محاولة نشر أخرى جارية لهذا المنشور." });
      return;
    }

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
              and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
            );
        },
        workspaceId,
        retryUncertain,
        false,
      );
      latestResults = { ...latestResults, ...results };
      const fullyPublished = channels.every(
        (channel) => safeRecord(latestResults[channel]).status === "published",
      );
      const errorMessage = fullyPublished
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
      const [updated] = await db
        .update(posts)
        .set({
          status: fullyPublished ? "published" : "failed",
          publishResults: latestResults,
          error: errorMessage,
          updatedAt: new Date(),
        })
        .where(
          and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
        )
        .returning();

      logger.info(
        {
          requestId: req.id,
          retryUncertain,
          channelStatuses: Object.fromEntries(
            Object.entries(latestResults).map(([channel, result]) => [
              channel,
              safeRecord(result).status,
            ]),
          ),
        },
        "Post publish request completed",
      );
      notifyPostsChanged(ownerId);
      notifyPostsChanged(workspaceId);
      res.json({
        success: fullyPublished,
        results: latestResults,
        post: await responseForRow(
          updated,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر النشر.";
      await db
        .update(posts)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(
          and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
        );
      notifyPostsChanged(ownerId);
      notifyPostsChanged(workspaceId);
      res.status(400).json({ error: message, results: latestResults });
    }
  } catch (error) {
    console.error("Error publishing post:", error);
    const message = error instanceof Error ? error.message : "تعذر النشر.";
    await db
      .update(posts)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posts.id, paramResult.data.id),
          eq(posts.workspaceId, workspaceId),
        ),
      );
    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.status(400).json({ error: message });
  }
});

router.post("/posts/from-message", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const messageId =
    typeof req.body?.messageId === "string" ? req.body.messageId.trim() : null;
  if (!messageId) {
    res.status(400).json({ error: "معرّف الرسالة غير موجود." });
    return;
  }

  try {
    const processed = await processWhatsAppMessage(workspaceId, messageId, {
      allowAutoPublish: false,
      manualReview: true,
    });
    if (!processed.postId) {
      res
        .status(422)
        .json({
          error: processed.reason ?? "الرسالة غير مؤهلة للتحويل إلى منشور.",
        });
      return;
    }
    const [post] = await db
      .select()
      .from(posts)
      .where(
        and(eq(posts.id, processed.postId), eq(posts.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!post) throw new Error("CREATED_POST_NOT_FOUND");
    res
      .status(processed.outcome === "created" ? 201 : 200)
      .json(
        await responseForRow(
          post,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      );
  } catch (error) {
    if (sendPostQuotaError(res, error)) return;
    console.error("Error creating post from WhatsApp message:", error);
    res.status(500).json({ error: "تعذر إنشاء المنشور من الرسالة المختارة." });
  }
});

router.delete("/posts/:id", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const paramResult = DeletePostParams.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: "معرّف المنشور غير صالح." });
    return;
  }

  const postId = paramResult.data.id;

  try {
    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .returning();

    if (!deleted || deleted.length === 0) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "تعذر حذف المنشور." });
  }
});

export default router;
