import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppGroups,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
} from "@workspace/db";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

import {
  signedWhatsAppMediaUrl,
  verifySignedMediaRequest,
} from "../lib/meta-publishing";
import {
  assertMediaObjectPath,
  createMediaJpeg,
  hasMediaObject,
  readMediaObject,
  resolveWhatsAppMediaStorageRoot,
  streamMediaObject,
} from "../lib/whatsapp-media-storage";
import { PublicMediaUrlError } from "../lib/meta-media-url";
import { findWhatsAppAssociationSuggestions } from "../lib/whatsapp-association-suggestions";
import {
  getWhatsAppContentAssociationDecisions,
  getWhatsAppContentBundles,
  whatsappAssociationPairKey,
  type WhatsAppContentAssociationDecision,
} from "../lib/whatsapp-content-associations";
import { isConfirmedWhatsAppMediaGroupSource } from "../lib/whatsapp-album-relations";

const router: IRouter = Router();

const WHATSAPP_MEDIA_STORAGE_ROOT = resolveWhatsAppMediaStorageRoot();

function buildMediaUrl(
  mediaId: string,
  requestOrigin?: string,
  variant: "original" | "thumbnail" = "original",
): {
  url: string | null;
  accessError: string | null;
} {
  try {
    return {
      url: signedWhatsAppMediaUrl(mediaId, true, variant, requestOrigin),
      accessError: null,
    };
  } catch (error) {
    if (!(error instanceof PublicMediaUrlError)) throw error;
    return { url: null, accessError: error.reason };
  }
}

function serializeWhatsAppMessageMedia(
  media: typeof menaWhatsAppMessageMedia.$inferSelect,
  requestOrigin?: string,
) {
  const publicUrl =
    media.downloadStatus === "stored"
      ? buildMediaUrl(media.id, requestOrigin)
      : { url: null, accessError: null };
  const thumbnailUrl =
    media.downloadStatus === "stored" &&
    media.thumbnailPath &&
    !["failed", "unavailable"].includes(media.thumbnailPath)
      ? buildMediaUrl(media.id, requestOrigin, "thumbnail")
      : publicUrl;
  return {
    id: media.id,
    mediaIndex: media.mediaIndex,
    mediaType: media.mediaType,
    fileName: media.fileName,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    storageKey: media.storageKey,
    downloadStatus: media.downloadStatus,
    failureReason: media.failureReason,
    url: publicUrl.url,
    thumbnailUrl: thumbnailUrl.url,
    accessError: publicUrl.accessError,
    createdAt: media.createdAt.toISOString(),
  };
}

async function mediaResponse(
  media: typeof menaWhatsAppMessageMedia.$inferSelect,
  variant: "original" | "thumbnail" | "instagram-jpeg",
) {
  const thumbnailPath =
    variant === "thumbnail" &&
    media.thumbnailPath &&
    !["failed", "unavailable"].includes(media.thumbnailPath)
      ? media.thumbnailPath
      : null;
  const useThumbnail = Boolean(thumbnailPath);
  const storagePath = thumbnailPath ?? media.storagePath;
  if (variant === "instagram-jpeg") {
    let buffer: Buffer;
    if (media.storageProvider === "supabase") {
      buffer = await readMediaObject(storagePath);
    } else {
      const rootPath = path.resolve(WHATSAPP_MEDIA_STORAGE_ROOT);
      const resolvedPath = path.resolve(storagePath);
      if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error("INVALID_MEDIA_STORAGE_PATH");
      }
      const file = await stat(resolvedPath);
      if (!file.isFile() || file.size === 0) throw new Error("MEDIA_FILE_MISSING");
      buffer = await readFile(resolvedPath);
    }
    const jpeg = await createMediaJpeg(buffer);
    return {
      stream: Readable.from([jpeg]),
      contentLength: String(jpeg.length),
      mimeType: "image/jpeg",
      fileName: `${media.id}.jpg`,
    };
  }
  if (media.storageProvider === "supabase") {
    assertMediaObjectPath(storagePath);
    const storedObject = await streamMediaObject(storagePath);
    return {
      stream: storedObject.stream,
      contentLength: storedObject.contentLength,
      mimeType: useThumbnail
        ? "image/webp"
        : media.mimeType || "application/octet-stream",
      fileName: useThumbnail
        ? `${media.id}.webp`
        : media.fileName || "attachment",
    };
  }
  const rootPath = path.resolve(WHATSAPP_MEDIA_STORAGE_ROOT);
  const resolvedPath = path.resolve(storagePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("INVALID_MEDIA_STORAGE_PATH");
  }
  const file = await stat(resolvedPath);
  if (!file.isFile() || file.size === 0) throw new Error("MEDIA_FILE_MISSING");
  return {
    stream: createReadStream(resolvedPath),
    contentLength: String(file.size),
    mimeType: useThumbnail
      ? "image/webp"
      : media.mimeType || "application/octet-stream",
    fileName: useThumbnail
      ? `${media.id}.webp`
      : media.fileName || "attachment",
  };
}

async function sendMediaResponse(
  res: import("express").Response,
  file: Awaited<ReturnType<typeof mediaResponse>>,
) {
  res.setHeader("Content-Type", file.mimeType);
  const safeFileName = file.fileName.replace(/[\r\n"\\]/g, "_").slice(0, 200);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safeFileName || "attachment"}"`,
  );
  if (file.contentLength) res.setHeader("Content-Length", file.contentLength);
  await pipeline(file.stream, res);
}

async function storedMediaExists(
  media: typeof menaWhatsAppMessageMedia.$inferSelect,
  variant: "original" | "thumbnail",
): Promise<boolean> {
  const thumbnailPath = variant === "thumbnail" ? media.thumbnailPath : null;
  const storagePath = thumbnailPath ?? media.storagePath;
  if (media.storageProvider === "supabase") return hasMediaObject(storagePath);
  const rootPath = path.resolve(WHATSAPP_MEDIA_STORAGE_ROOT);
  const resolvedPath = path.resolve(storagePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("INVALID_MEDIA_STORAGE_PATH");
  }

  try {
    const file = await stat(resolvedPath);
    return file.isFile() && file.size > 0;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function getWhatsAppMediaRecord(mediaId: string, workspaceId?: string) {
  const predicates = [
    eq(menaWhatsAppMessageMedia.id, mediaId),
    eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
    eq(menaWhatsAppMessages.workspaceId, menaWhatsAppMessageMedia.workspaceId),
    eq(
      menaWhatsAppMessages.instanceName,
      menaWhatsAppMessageMedia.instanceName,
    ),
    eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
    eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
  ];
  if (workspaceId) {
    predicates.push(eq(menaWhatsAppMessageMedia.workspaceId, workspaceId));
  }
  const [result] = await db
    .select({ media: menaWhatsAppMessageMedia })
    .from(menaWhatsAppMessageMedia)
    .innerJoin(
      menaWhatsAppMessages,
      and(
        eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
        eq(
          menaWhatsAppMessages.workspaceId,
          menaWhatsAppMessageMedia.workspaceId,
        ),
        eq(
          menaWhatsAppMessages.instanceName,
          menaWhatsAppMessageMedia.instanceName,
        ),
        eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
      ),
    )
    .where(and(...predicates))
    .limit(1);
  return result?.media ?? null;
}

router.get(
  "/social/whatsapp/groups/:groupJid/messages",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    const groupJid = Array.isArray(req.params.groupJid)
      ? req.params.groupJid[0]
      : req.params.groupJid;
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const requestHost = req.get("host");
    const requestOrigin = requestHost
      ? `${req.protocol}://${requestHost}`
      : undefined;

    try {
      const [connection] = await db
        .select()
        .from(menaWhatsAppConnections)
        .where(and(eq(menaWhatsAppConnections.workspaceId, workspaceId)))
        .limit(1);

      if (!connection) {
        res.status(404).json({ error: "حساب واتساب غير موجود." });
        return;
      }

      const [selection] = await db
        .select()
        .from(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
            eq(
              menaWhatsAppGroupSelections.instanceName,
              connection.instanceName,
            ),
            eq(menaWhatsAppGroupSelections.groupJid, groupJid),
            eq(menaWhatsAppGroupSelections.selected, true),
          ),
        )
        .limit(1);

      if (!selection) {
        res
          .status(404)
          .json({ error: "المجموعة المحددة غير مرتبطة بهذا الحساب." });
        return;
      }
      if (!selection.groupId) {
        res.status(409).json({
          error: "هوية المجموعة تحتاج إلى مراجعة قبل عرض رسائلها.",
        });
        return;
      }
      const [selectedIdentity] = await db
        .select({
          id: menaWhatsAppGroups.id,
          kind: menaWhatsAppGroups.kind,
          name: menaWhatsAppGroups.name,
        })
        .from(menaWhatsAppGroups)
        .where(
          and(
            eq(menaWhatsAppGroups.id, selection.groupId),
            eq(menaWhatsAppGroups.workspaceId, workspaceId),
            eq(menaWhatsAppGroups.instanceName, connection.instanceName),
          ),
        )
        .limit(1);
      if (!selectedIdentity) {
        res.status(409).json({ error: "هوية المجموعة غير متاحة لهذا الاتصال." });
        return;
      }
      const childGroups = selectedIdentity.kind === "community"
        ? await db
            .select({ id: menaWhatsAppGroups.id })
            .from(menaWhatsAppGroups)
            .where(
              and(
                eq(menaWhatsAppGroups.workspaceId, workspaceId),
                eq(menaWhatsAppGroups.instanceName, connection.instanceName),
                eq(menaWhatsAppGroups.parentGroupId, selectedIdentity.id),
              ),
            )
        : [{ id: selectedIdentity.id }];
      const messageGroupIds = childGroups.map(({ id }) => id);

      const rawPage = Array.isArray(req.query.page)
        ? req.query.page[0]
        : req.query.page;
      const rawLimit = Array.isArray(req.query.limit)
        ? req.query.limit[0]
        : req.query.limit;
      const rawSort = Array.isArray(req.query.sort)
        ? req.query.sort[0]
        : req.query.sort;
      const page = Math.max(1, Number(rawPage ?? 1));
      const limit = Math.min(50, Math.max(1, Number(rawLimit ?? 25)));
      const sort = rawSort === "asc" ? "asc" : "desc";
      const offset = (page - 1) * limit;

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(menaWhatsAppMessages)
        .where(
          and(
            eq(menaWhatsAppMessages.workspaceId, workspaceId),
            eq(menaWhatsAppMessages.instanceName, connection.instanceName),
            inArray(menaWhatsAppMessages.groupId, messageGroupIds),
          ),
        );

      const rows = await db
        .select()
        .from(menaWhatsAppMessages)
        .where(
          and(
            eq(menaWhatsAppMessages.workspaceId, workspaceId),
            eq(menaWhatsAppMessages.instanceName, connection.instanceName),
            inArray(menaWhatsAppMessages.groupId, messageGroupIds),
          ),
        )
        .orderBy(
          sort === "asc"
            ? asc(menaWhatsAppMessages.messageTimestamp)
            : desc(menaWhatsAppMessages.messageTimestamp),
          desc(menaWhatsAppMessages.createdAt),
          desc(menaWhatsAppMessages.id),
        )
        .limit(limit)
        .offset(offset);

      const pageMessageIds = rows.map((message) => message.id);
      const mediaRows =
        pageMessageIds.length > 0
          ? await db
              .select()
              .from(menaWhatsAppMessageMedia)
              .where(
                and(
                  eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
                  eq(
                    menaWhatsAppMessageMedia.instanceName,
                    connection.instanceName,
                  ),
                  inArray(menaWhatsAppMessageMedia.groupId, messageGroupIds),
                  inArray(menaWhatsAppMessageMedia.messageId, pageMessageIds),
                ),
              )
          : [];

      const mediaByMessage = new Map<string, typeof mediaRows>();
      for (const media of mediaRows) {
        const current = mediaByMessage.get(media.messageId) ?? [];
        current.push(media);
        current.sort((left, right) => left.mediaIndex - right.mediaIndex);
        mediaByMessage.set(media.messageId, current);
      }

      const messageIdsByGroup = new Map<string, string[]>();
      const groupIdByMessage = new Map<string, string>();
      for (const message of rows) {
        if (!message.groupId) continue;
        groupIdByMessage.set(message.id, message.groupId);
        const ids = messageIdsByGroup.get(message.groupId) ?? [];
        ids.push(message.id);
        messageIdsByGroup.set(message.groupId, ids);
      }
      const bundlesByMessage = new Map<
        string,
        { id: string; messageIds: string[] }
      >();
      const decisionsByGroup = new Map<
        string,
        Map<string, WhatsAppContentAssociationDecision>
      >();
      await Promise.all([...messageIdsByGroup].map(async ([messageGroupId, ids]) => {
        const scope = {
          workspaceId,
          instanceName: connection.instanceName,
          groupId: messageGroupId,
        };
        const [bundles, decisions] = await Promise.all([
          getWhatsAppContentBundles(scope, ids),
          getWhatsAppContentAssociationDecisions(scope),
        ]);
        for (const [id, bundle] of bundles) bundlesByMessage.set(id, bundle);
        decisionsByGroup.set(messageGroupId, decisions);
      }));
      const bundlesByAlbumId = new Map<
        string,
        { id: string; messageIds: string[] }
      >();
      for (const message of rows) {
        const bundle = bundlesByMessage.get(message.id);
        if (
          bundle &&
          message.mediaGroupId &&
          isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource)
        ) {
          bundlesByAlbumId.set(message.mediaGroupId, bundle);
        }
      }
      if (bundlesByAlbumId.size > 0) {
        const albumMembers = await db
          .select({
            id: menaWhatsAppMessages.id,
            mediaGroupId: menaWhatsAppMessages.mediaGroupId,
          })
          .from(menaWhatsAppMessages)
          .where(and(
            eq(menaWhatsAppMessages.workspaceId, workspaceId),
            eq(menaWhatsAppMessages.instanceName, connection.instanceName),
            inArray(menaWhatsAppMessages.groupId, messageGroupIds),
            inArray(
              menaWhatsAppMessages.mediaGroupId,
              [...bundlesByAlbumId.keys()],
            ),
            inArray(menaWhatsAppMessages.mediaGroupSource, [
              "protocol_association",
              "provider_album_container",
            ]),
          ));
        for (const albumMember of albumMembers) {
          const bundle = albumMember.mediaGroupId
            ? bundlesByAlbumId.get(albumMember.mediaGroupId)
            : null;
          if (bundle) bundlesByMessage.set(albumMember.id, bundle);
        }
      }
      for (const message of rows) {
        const albumBundle = message.mediaGroupId
          ? bundlesByAlbumId.get(message.mediaGroupId)
          : null;
        if (
          albumBundle &&
          isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource)
        ) {
          bundlesByMessage.set(message.id, albumBundle);
        }
      }

      const bundlesById = new Map(
        [...bundlesByMessage.values()].map((bundle) => [bundle.id, bundle]),
      );
      const bundleMessageIds = [
        ...new Set([...bundlesById.values()].flatMap((bundle) => bundle.messageIds)),
      ];
      const bundleMembers = bundleMessageIds.length > 0
        ? await db
            .select({
              id: menaWhatsAppMessages.id,
              mediaGroupId: menaWhatsAppMessages.mediaGroupId,
              mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
            })
            .from(menaWhatsAppMessages)
            .where(and(
              eq(menaWhatsAppMessages.workspaceId, workspaceId),
              eq(menaWhatsAppMessages.instanceName, connection.instanceName),
              inArray(menaWhatsAppMessages.groupId, messageGroupIds),
              inArray(menaWhatsAppMessages.id, bundleMessageIds),
            ))
        : [];
      const albumIdsByBundleId = new Map<string, Set<string>>();
      const bundleIdsByMediaMessageId = new Map<string, Set<string>>();
      for (const member of bundleMembers) {
        const bundle = bundlesByMessage.get(member.id);
        if (!bundle) continue;
        const memberBundleIds =
          bundleIdsByMediaMessageId.get(member.id) ?? new Set<string>();
        memberBundleIds.add(bundle.id);
        bundleIdsByMediaMessageId.set(member.id, memberBundleIds);
        if (
          !member.mediaGroupId ||
          !isConfirmedWhatsAppMediaGroupSource(member.mediaGroupSource)
        ) continue;
        const albumIds = albumIdsByBundleId.get(bundle.id) ?? new Set<string>();
        albumIds.add(member.mediaGroupId);
        albumIdsByBundleId.set(bundle.id, albumIds);
      }
      const bundleIdsByAlbumId = new Map<string, string[]>();
      for (const [bundleId, albumIds] of albumIdsByBundleId) {
        for (const albumId of albumIds) {
          const bundleIds = bundleIdsByAlbumId.get(albumId) ?? [];
          bundleIds.push(bundleId);
          bundleIdsByAlbumId.set(albumId, bundleIds);
        }
      }
      const bundleAlbumIds = [
        ...new Set([...albumIdsByBundleId.values()].flatMap((ids) => [...ids])),
      ];
      const associatedAlbumMembers = bundleAlbumIds.length > 0
        ? await db
            .select({
              id: menaWhatsAppMessages.id,
              mediaGroupId: menaWhatsAppMessages.mediaGroupId,
            })
            .from(menaWhatsAppMessages)
            .where(and(
              eq(menaWhatsAppMessages.workspaceId, workspaceId),
              eq(menaWhatsAppMessages.instanceName, connection.instanceName),
              inArray(menaWhatsAppMessages.groupId, messageGroupIds),
              inArray(menaWhatsAppMessages.mediaGroupId, bundleAlbumIds),
              inArray(menaWhatsAppMessages.mediaGroupSource, [
                "protocol_association",
                "provider_album_container",
              ]),
            ))
        : [];
      for (const member of associatedAlbumMembers) {
        if (!member.mediaGroupId) continue;
        for (const bundleId of bundleIdsByAlbumId.get(member.mediaGroupId) ?? []) {
          const bundle = bundlesById.get(bundleId);
          if (bundle) bundlesByMessage.set(member.id, bundle);
          const memberBundleIds =
            bundleIdsByMediaMessageId.get(member.id) ?? new Set<string>();
          memberBundleIds.add(bundleId);
          bundleIdsByMediaMessageId.set(member.id, memberBundleIds);
        }
      }
      const associatedMediaMessageIds = [...bundleIdsByMediaMessageId.keys()];
      const associatedMediaRows = associatedMediaMessageIds.length > 0
        ? await db
            .select()
            .from(menaWhatsAppMessageMedia)
            .where(and(
              eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
              eq(menaWhatsAppMessageMedia.instanceName, connection.instanceName),
              inArray(menaWhatsAppMessageMedia.groupId, messageGroupIds),
              inArray(
                menaWhatsAppMessageMedia.messageId,
                associatedMediaMessageIds,
              ),
            ))
        : [];
      const associatedMediaByBundle = new Map<
        string,
        typeof associatedMediaRows
      >();
      for (const media of associatedMediaRows) {
        for (const bundleId of bundleIdsByMediaMessageId.get(media.messageId) ?? []) {
          const bundleMedia = associatedMediaByBundle.get(bundleId) ?? [];
          bundleMedia.push(media);
          associatedMediaByBundle.set(bundleId, bundleMedia);
        }
      }

      const sourceIds = [
        ...new Set(
          rows.flatMap((message) => [
            message.id,
            ...(isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource) &&
            message.mediaGroupId
              ? [message.mediaGroupId]
              : []),
            ...(bundlesByMessage.get(message.id)
              ? [bundlesByMessage.get(message.id)!.id]
              : []),
          ]),
        ),
      ];
      const messageGroupJids = [...new Set(rows.map((message) => message.groupJid))];
      const linkedPosts =
        sourceIds.length > 0
          ? await db
              .select({
                id: posts.id,
                sourceMessageId: posts.sourceMessageId,
                status: posts.status,
              })
              .from(posts)
              .where(
                and(
                  eq(posts.workspaceId, workspaceId),
                  eq(posts.sourceType, "whatsapp"),
                  inArray(posts.sourceGroupJid, messageGroupJids),
                  inArray(posts.sourceMessageId, sourceIds),
                ),
              )
          : [];
      const linkedPostBySourceId = new Map(
        linkedPosts.map((post) => [post.sourceMessageId, post]),
      );

      const messages = rows.map((message) => {
        const contentBundle = bundlesByMessage.get(message.id) ?? null;
        const linkedSourceId =
          contentBundle?.id ??
          (isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource)
            ? message.mediaGroupId
            : null) ??
          message.id;
        return {
          id: message.id,
          remoteMessageId: message.remoteMessageId,
          senderId: message.senderId,
          senderName: message.senderName,
          messageType: message.messageType,
          textBody: message.textBody,
          caption: message.caption,
          mediaAvailable: message.mediaAvailable,
          mediaGroupId: message.mediaGroupId,
          mediaGroupSource: message.mediaGroupSource,
          contentBundleId: contentBundle?.id ?? null,
          contentBundleMedia: [] as ReturnType<
            typeof serializeWhatsAppMessageMedia
          >[],
          mediaGroupIndex: message.mediaGroupIndex,
          mediaGroupExpectedCount: message.mediaGroupExpectedCount,
          mediaDownloadStatus: message.mediaDownloadStatus,
          mediaDownloadError: message.mediaDownloadError,
          messageStatus: message.messageStatus,
          source: message.source,
          messageTimestamp: message.messageTimestamp?.toISOString() ?? null,
          createdAt: message.createdAt.toISOString(),
          replyToRemoteId: message.replyToRemoteId,
          linkedPostId: linkedPostBySourceId.get(linkedSourceId)?.id ?? null,
          linkedPostStatus: linkedPostBySourceId.get(linkedSourceId)?.status ?? null,
          associationSuggestions: [] as Array<{
            sourceMessageId: string;
            candidateMessageId: string;
            candidateGroupKey: string;
            candidateMediaGroupId: string | null;
            candidateText: string | null;
            candidateMediaCount: number;
            reason: string;
            decision: WhatsAppContentAssociationDecision | null;
          }>,
          media: (mediaByMessage.get(message.id) ?? []).map((media) =>
            serializeWhatsAppMessageMedia(media, requestOrigin),
          ),
        };
      });
      const bundlesWithAttachedMedia = new Set<string>();
      for (const message of messages) {
        if (!message.contentBundleId) continue;
        if (bundlesWithAttachedMedia.has(message.contentBundleId)) continue;
        const bundleMedia = associatedMediaByBundle.get(message.contentBundleId) ?? [];
        if (bundleMedia.length === 0) continue;
        bundlesWithAttachedMedia.add(message.contentBundleId);
        message.contentBundleMedia = bundleMedia.map((media) =>
          serializeWhatsAppMessageMedia(media, requestOrigin),
        );
      }
      const associationContextConditions = messages.flatMap((message) => {
        const timestamp = message.messageTimestamp
          ? new Date(message.messageTimestamp)
          : new Date(message.createdAt);
        if (!message.senderId || !Number.isFinite(timestamp.getTime())) return [];
        const rangeStart = new Date(timestamp.getTime() - 30_000);
        const rangeEnd = new Date(timestamp.getTime() + 30_000);
        const effectiveTimestamp = sql`coalesce(${menaWhatsAppMessages.messageTimestamp}, ${menaWhatsAppMessages.createdAt})`;
        return [and(
          eq(menaWhatsAppMessages.groupId, groupIdByMessage.get(message.id)!),
          eq(menaWhatsAppMessages.senderId, message.senderId),
          gte(effectiveTimestamp, rangeStart),
          lte(effectiveTimestamp, rangeEnd),
        )];
      });
      const associationContextRows = associationContextConditions.length > 0
        ? await db
            .select({
              id: menaWhatsAppMessages.id,
              groupId: menaWhatsAppMessages.groupId,
              remoteMessageId: menaWhatsAppMessages.remoteMessageId,
              senderId: menaWhatsAppMessages.senderId,
              textBody: menaWhatsAppMessages.textBody,
              caption: menaWhatsAppMessages.caption,
              mediaAvailable: menaWhatsAppMessages.mediaAvailable,
              mediaGroupId: menaWhatsAppMessages.mediaGroupId,
              mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
              messageTimestamp: menaWhatsAppMessages.messageTimestamp,
              createdAt: menaWhatsAppMessages.createdAt,
              replyToRemoteId: menaWhatsAppMessages.replyToRemoteId,
            })
            .from(menaWhatsAppMessages)
            .where(and(
              eq(menaWhatsAppMessages.workspaceId, workspaceId),
              eq(menaWhatsAppMessages.instanceName, connection.instanceName),
              inArray(menaWhatsAppMessages.groupId, messageGroupIds),
              or(...associationContextConditions),
            ))
        : [];
      const pageMessageIdSet = new Set(messages.map((message) => message.id));
      const externalContextRows = associationContextRows.filter(
        (message) => !pageMessageIdSet.has(message.id),
      );
      const contextMediaCounts = externalContextRows.length > 0
        ? await db
            .select({
              messageId: menaWhatsAppMessageMedia.messageId,
              count: sql<number>`count(*)::int`,
            })
            .from(menaWhatsAppMessageMedia)
            .where(and(
              eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
              eq(menaWhatsAppMessageMedia.instanceName, connection.instanceName),
              inArray(menaWhatsAppMessageMedia.groupId, messageGroupIds),
              inArray(
                menaWhatsAppMessageMedia.messageId,
                externalContextRows.map((message) => message.id),
              ),
            ))
            .groupBy(menaWhatsAppMessageMedia.messageId)
        : [];
      const contextMediaCountByMessageId = new Map(
        contextMediaCounts.map(({ messageId, count }) => [messageId, count]),
      );
      const suggestionMessagesByGroup = new Map<
        string,
        Parameters<typeof findWhatsAppAssociationSuggestions>[0]
      >();
      const appendSuggestionMessage = (
        messageGroupId: string | undefined,
        suggestionMessage: Parameters<typeof findWhatsAppAssociationSuggestions>[0][number],
      ) => {
        if (!messageGroupId) return;
        const groupMessages = suggestionMessagesByGroup.get(messageGroupId) ?? [];
        groupMessages.push(suggestionMessage);
        suggestionMessagesByGroup.set(messageGroupId, groupMessages);
      };
      for (const message of messages) {
        appendSuggestionMessage(groupIdByMessage.get(message.id), {
          id: message.id,
          remoteMessageId: message.remoteMessageId,
          senderId: message.senderId,
          textBody: message.textBody,
          caption: message.caption,
          mediaAvailable: message.mediaAvailable,
          mediaGroupId: message.mediaGroupId,
          mediaGroupSource: message.mediaGroupSource,
          messageTimestamp: message.messageTimestamp,
          createdAt: message.createdAt,
          replyToRemoteId: message.replyToRemoteId,
          mediaCount: message.media.length,
        });
      }
      for (const message of externalContextRows) {
        appendSuggestionMessage(message.groupId ?? undefined, {
          id: message.id,
          remoteMessageId: message.remoteMessageId,
          senderId: message.senderId,
          textBody: message.textBody,
          caption: message.caption,
          mediaAvailable: message.mediaAvailable,
          mediaGroupId: message.mediaGroupId,
          mediaGroupSource: message.mediaGroupSource,
          messageTimestamp: message.messageTimestamp?.toISOString() ?? null,
          createdAt: message.createdAt.toISOString(),
          replyToRemoteId: message.replyToRemoteId,
          mediaCount: contextMediaCountByMessageId.get(message.id) ?? 0,
        });
      }
      const suggestionsByMessage = new Map<
        string,
        Array<(typeof messages)[number]["associationSuggestions"][number]>
      >();
      for (const groupMessages of suggestionMessagesByGroup.values()) {
        for (const [messageId, suggestions] of
          findWhatsAppAssociationSuggestions(groupMessages)) {
          const current = suggestionsByMessage.get(messageId) ?? [];
          current.push(...suggestions.map((suggestion) => ({
            ...suggestion,
            decision: null,
          })));
          suggestionsByMessage.set(messageId, current);
        }
      }
      const messagesById = new Map(messages.map((message) => [message.id, message]));
      for (const [messageId, suggestions] of suggestionsByMessage) {
        for (const suggestion of suggestions) {
          const currentCandidateAlbumMessage = suggestion.candidateMediaGroupId
            ? messages.find((message) =>
                message.mediaGroupId === suggestion.candidateMediaGroupId &&
                isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource),
              )
            : undefined;
          const message = messagesById.get(messageId) ??
            messagesById.get(suggestion.candidateMessageId) ??
            currentCandidateAlbumMessage;
          if (!message) continue;
          const messageGroupId = groupIdByMessage.get(message.id);
          if (!messageGroupId) continue;
          const decisions = decisionsByGroup.get(messageGroupId) ?? new Map();
          message.associationSuggestions.push({
            ...suggestion,
            decision: decisions.get(whatsappAssociationPairKey(
              suggestion.sourceMessageId,
              suggestion.candidateMessageId,
            )) ?? null,
          });
        }
      }

      res.json({
        groupJid,
        groupName: selection.groupName,
        page,
        limit,
        totalCount: Number(totalRow?.count ?? 0),
        hasNextPage: offset + rows.length < Number(totalRow?.count ?? 0),
        messages,
      });
    } catch (error) {
      console.error("Error fetching WhatsApp group messages:", error);
      res.status(500).json({ error: "تعذّر جلب رسائل المجموعة." });
    }
  },
);

router.get(
  "/social/whatsapp/media/:mediaId/url",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    const mediaId = Array.isArray(req.params.mediaId)
      ? req.params.mediaId[0]
      : req.params.mediaId;
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    try {
      const media = await getWhatsAppMediaRecord(mediaId, workspaceId);
      if (!media) {
        res.status(404).json({ error: "الوسيط غير موجود." });
        return;
      }

      const variant =
        req.query.variant === "thumbnail" ? "thumbnail" : "original";
      if (!(await storedMediaExists(media, variant))) {
        res.status(404).json({ error: "ملف الوسائط غير متاح." });
        return;
      }
      res.json({
        url: signedWhatsAppMediaUrl(
          media.id,
          true,
          variant,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      });
    } catch (error) {
      console.error("Error refreshing signed WhatsApp media URL:", error);
      res.status(500).json({ error: "تعذّر تحديث رابط الوسائط." });
    }
  },
);

router.get("/social/whatsapp/public-media/:mediaId", async (req, res) => {
  const mediaId = Array.isArray(req.params.mediaId)
    ? req.params.mediaId[0]
    : req.params.mediaId;
  const expires =
    typeof req.query.expires === "string" ? req.query.expires : "";
  const signature =
    typeof req.query.signature === "string" ? req.query.signature : "";
  const variant = req.query.variant === "thumbnail" ||
      req.query.variant === "instagram-jpeg"
    ? req.query.variant
    : "original";
  if (!verifySignedMediaRequest(mediaId, expires, signature, variant)) {
    res.status(403).json({ error: "رابط الوسائط غير صالح أو منتهي الصلاحية." });
    return;
  }

  try {
    const media = await getWhatsAppMediaRecord(mediaId);
    if (!media) {
      res.status(404).json({ error: "الوسيط غير موجود." });
      return;
    }
    if (variant === "instagram-jpeg" && media.mediaType !== "image") {
      res.status(400).json({ error: "تحويل JPEG متاح للصور فقط." });
      return;
    }
    const file = await mediaResponse(media, variant);
    res.setHeader("Cache-Control", "private, max-age=300");
    await sendMediaResponse(res, file);
  } catch (error) {
    console.error("Error serving signed WhatsApp media:", error);
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    res.status(500).json({ error: "تعذّر فتح الوسائط." });
  }
});

router.get(
  "/social/whatsapp/media/:mediaId",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    const mediaId = Array.isArray(req.params.mediaId)
      ? req.params.mediaId[0]
      : req.params.mediaId;
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    try {
      const media = await getWhatsAppMediaRecord(mediaId, workspaceId);

      if (!media) {
        res.status(404).json({ error: "المرفق غير موجود." });
        return;
      }

      const file = await mediaResponse(media, "original");
      await sendMediaResponse(res, file);
    } catch (error) {
      console.error("Error serving WhatsApp media:", error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.status(500).json({ error: "تعذّر فتح المرفق." });
    }
  },
);

export default router;
