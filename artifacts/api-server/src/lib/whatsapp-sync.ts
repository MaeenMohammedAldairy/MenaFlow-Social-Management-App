import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppAutoReplyEvents,
  menaContentJobs,
  menaWhatsAppGroups,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessages,
  menaWhatsAppSyncStates,
  whatsappProductExtractionJobs,
} from "@workspace/db";
import { createHash, randomUUID } from "node:crypto";
import { enqueueWhatsAppMessage } from "../lib/whatsapp-marketing";

import {
  extractMediaItemsFromMessage,
  extractWhatsAppTextFromMessage,
  extractWhatsAppAlbumAssociation,
  hasWhatsAppAlbumAssociation,
  extractWhatsAppMediaGroupId,
  extractWhatsAppMediaGroupExpectedCount,
  extractWhatsAppWebhookBatch,
  hasWhatsAppMessageContent,
  isWhatsAppAlbumContainer,
  filterHistoryRecordsForGroup,
  isWhatsAppMessageWebhookEvent,
  normalizeWhatsAppWebhookEventName,
  normalizeRemoteJid,
} from "../lib/whatsapp-message-scope";
import { isWhatsAppOptOutMessage } from "../lib/whatsapp-opt-out";
import {
  resolveWhatsAppAlbumSource,
  whatsappAlbumId,
} from "../lib/whatsapp-albums";
import { resolveWhatsAppMediaGroupSource } from "../lib/whatsapp-album-relations";
import {
  EvolutionApiError,
  evolutionRequest,
  verifyWhatsAppWebhookSecret,
} from "../lib/whatsapp-evolution";
import {
  buildWhatsAppHistoryQuery,
  extractWhatsAppHistoryRecords,
  filterWhatsAppHistoryFrom,
  getWhatsAppHistoryMessageId,
  getWhatsAppHistoryTimestamp,
  isWhatsAppHistoryPageBeforeCursor,
  isWhatsAppHistoryCandidate,
  parseWhatsAppHistoryTimestamp,
} from "../lib/whatsapp-history";
import {
  filterWhatsAppMediaItems,
  shouldSyncWhatsAppMessage,
} from "../lib/whatsapp-sync-options";
import {
  generateWhatsAppAutoReply,
  sendWhatsAppAutoReply,
} from "../lib/whatsapp-auto-reply";
import { isDirectIncomingWhatsAppMessage } from "../lib/whatsapp-auto-reply-policy";
import { asRecord, queryString } from "./value-utils.ts";
import { resolveMessageSenderId } from "../lib/whatsapp-marketing-safety";

export const WHATSAPP_SYNC_STALE_THRESHOLD_MS = 10 * 60 * 1000;
export const DEFAULT_WHATSAPP_HISTORY_IMPORT_LIMIT = 500;
export const MAX_WHATSAPP_HISTORY_IMPORT_LIMIT = 10_000;

const activeWhatsAppSyncCounts = new Map<string, number>();

function persistedWhatsAppCursor(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const cursor = parseWhatsAppHistoryTimestamp(value);
  if (!cursor) throw new Error("WHATSAPP_SYNC_CURSOR_INVALID");
  return cursor;
}

function stripInlineMediaData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInlineMediaData);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) => !["base64", "data", "buffer"].includes(key.toLowerCase()),
      )
      .map(([key, nested]) => [key, stripInlineMediaData(nested)]),
  );
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function historyImportFailureCode(error: unknown): string {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === "string") {
      if (
        candidate.code.startsWith("08") ||
        candidate.code.startsWith("57P") ||
        ["EAUTHTIMEOUT", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(
          candidate.code,
        )
      ) {
        return "WHATSAPP_DATABASE_UNAVAILABLE";
      }
      return "WHATSAPP_MESSAGE_IMPORT_FAILED";
    }
    current = candidate.cause;
  }
  return "WHATSAPP_MESSAGE_IMPORT_FAILED";
}

export async function ensureSyncState(
  workspaceId: string,
  instanceName: string,
  groupJid: string,
  groupId: string,
) {
  const [connection] = await db
    .select({
      ownerId: menaWhatsAppConnections.ownerId,
      workspaceId: menaWhatsAppConnections.workspaceId,
    })
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
        eq(menaWhatsAppConnections.instanceName, instanceName),
      ),
    )
    .limit(1);
  if (!connection) throw new Error("WHATSAPP_CONNECTION_NOT_FOUND");
  const syncId = randomUUID();
  const [created] = await db
    .insert(menaWhatsAppSyncStates)
    .values({
      id: syncId,
      ownerId: connection.ownerId,
      workspaceId: connection.workspaceId,
      instanceName,
      groupJid,
      groupId,
      status: "idle",
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        menaWhatsAppSyncStates.workspaceId,
        menaWhatsAppSyncStates.instanceName,
        menaWhatsAppSyncStates.groupId,
      ],
    })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(menaWhatsAppSyncStates)
    .where(
      and(
        eq(menaWhatsAppSyncStates.workspaceId, connection.workspaceId),
        eq(menaWhatsAppSyncStates.instanceName, instanceName),
        eq(menaWhatsAppSyncStates.groupId, groupId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("WHATSAPP_SYNC_STATE_CREATE_FAILED");
  return existing;
}

async function isWhatsAppAutoSyncEnabled(
  workspaceId: string,
  instanceName: string,
): Promise<boolean> {
  const [connection] = await db
    .select({ autoSyncEnabled: menaWhatsAppConnections.autoSyncEnabled })
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
        eq(menaWhatsAppConnections.instanceName, instanceName),
      ),
    )
    .limit(1);
  return connection?.autoSyncEnabled ?? false;
}

export async function updateSyncState(
  workspaceId: string,
  instanceName: string,
  groupJid: string,
  groupId: string,
  updates: Partial<{
    status: string;
    lastCursor: string | null;
    lastMessageId: string | null;
    lastSyncedAt: Date | null;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    lastError: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
) {
  await db
    .update(menaWhatsAppSyncStates)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
        eq(menaWhatsAppSyncStates.instanceName, instanceName),
        eq(menaWhatsAppSyncStates.groupId, groupId),
      ),
    );
}

export async function cancelStaleWhatsAppSyncs(
  workspaceId: string,
  instanceName: string,
): Promise<void> {
  const now = new Date();
  const runningStates = await db
    .select({
      id: menaWhatsAppSyncStates.id,
      updatedAt: menaWhatsAppSyncStates.updatedAt,
    })
    .from(menaWhatsAppSyncStates)
    .where(
      and(
        eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
        eq(menaWhatsAppSyncStates.instanceName, instanceName),
        eq(menaWhatsAppSyncStates.status, "running"),
      ),
    );
  const staleStates = runningStates.filter(
    (state) =>
      now.getTime() - state.updatedAt.getTime() >=
        WHATSAPP_SYNC_STALE_THRESHOLD_MS &&
      !activeWhatsAppSyncCounts.has(state.id),
  );

  for (const state of staleStates) {
    await db
      .update(menaWhatsAppSyncStates)
      .set({
        status: "cancelled",
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(menaWhatsAppSyncStates.id, state.id),
          eq(menaWhatsAppSyncStates.status, "running"),
          eq(menaWhatsAppSyncStates.updatedAt, state.updatedAt),
        ),
      );
  }
}

async function persistImportedMessage(
  workspaceId: string,
  instanceName: string,
  groupJid: string,
  groupId: string,
  payload: Record<string, unknown>,
): Promise<{
  imported: boolean;
  messageId?: string;
  relatedMessageIds?: string[];
  reason?: string;
}> {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
        eq(menaWhatsAppConnections.instanceName, instanceName),
      ),
    )
    .limit(1);
  if (!connection)
    return { imported: false, reason: "WHATSAPP_CONNECTION_NOT_FOUND" };
  const ownerId = connection.ownerId;
  const key = asRecord(payload.key);
  const payloadRemoteJid =
    normalizeRemoteJid(key?.remoteJid) ??
    normalizeRemoteJid(payload.remoteJid) ??
    normalizeRemoteJid(asRecord(payload.message)?.remoteJid) ??
    normalizeRemoteJid(asRecord(payload.data)?.remoteJid) ??
    normalizeRemoteJid(asRecord(payload)?.chatJid);
  const alternateRemoteJids = [
    normalizeRemoteJid(key?.remoteJidAlt),
    normalizeRemoteJid(payload.remoteJidAlt),
    normalizeRemoteJid(asRecord(payload.message)?.remoteJidAlt),
  ].filter((jid): jid is string => Boolean(jid));

  if (!payloadRemoteJid) {
    return { imported: false, reason: "GROUP_JID_MISSING" };
  }
  if (
    payloadRemoteJid !== groupJid &&
    !alternateRemoteJids.includes(groupJid)
  ) {
    return { imported: false, reason: "GROUP_JID_MISMATCH" };
  }

  const nestedMessage = asRecord(payload.message);
  const extractedRemoteMessageId =
    typeof key?.id === "string"
      ? key.id
      : typeof payload.id === "string"
        ? payload.id
        : typeof nestedMessage?.id === "string"
          ? nestedMessage.id
          : null;
  const remoteMessageId = extractedRemoteMessageId ?? "";
  if (!remoteMessageId)
    return { imported: false, reason: "MESSAGE_ID_MISSING" };

  const message = nestedMessage ?? payload;
  const textBody = extractWhatsAppTextFromMessage(
    message as Record<string, unknown> | null,
  );
  const extractedMediaItems = extractMediaItemsFromMessage(
    message as Record<string, unknown> | null,
  );
  const mediaItems = filterWhatsAppMediaItems(extractedMediaItems, {
    syncMessagesEnabled: connection.syncMessagesEnabled,
    syncImagesEnabled: connection.syncImagesEnabled,
    syncVideosEnabled: connection.syncVideosEnabled,
  });
  if (
    !shouldSyncWhatsAppMessage(
      connection.syncMessagesEnabled,
      Boolean(textBody),
      extractedMediaItems.length > 0,
      mediaItems.length,
    )
  ) {
    return { imported: false, reason: "WHATSAPP_SYNC_TYPE_DISABLED" };
  }
  const mediaDetails = mediaItems[0] ?? null;
  const albumAssociation = extractWhatsAppAlbumAssociation(payload);
  const hasAlbumAssociation = hasWhatsAppAlbumAssociation(payload);
  const missingAlbumParentKey = hasAlbumAssociation && !albumAssociation;
  const fromBusiness = key?.fromMe === true || payload.fromMe === true;
  let businessPhone: string | null = null;
  if (fromBusiness) {
    businessPhone = connection.phoneNumber ?? null;
  }
  const senderId = resolveMessageSenderId(
    {
      fromMe: fromBusiness,
      participant: key?.participant ?? payload.participant,
      sender: payload.sender,
    },
    businessPhone,
  );
  const senderName =
    typeof payload.pushName === "string"
      ? payload.pushName
      : typeof payload.senderName === "string"
        ? payload.senderName
        : null;
  const messageType = missingAlbumParentKey
    ? "albumMediaUnresolved"
    : typeof payload.messageType === "string"
      ? payload.messageType
      : mediaItems.length > 0
        ? mediaDetails.mediaType
        : isWhatsAppAlbumContainer(message)
          ? "albumMessage"
          : textBody
            ? "text"
            : "unknown";
  const messageTimestamp =
    [
      payload.timestamp,
      payload.messageTimestamp,
      payload.t,
      message.timestamp,
      message.messageTimestamp,
      message.t,
    ]
      .map(parseWhatsAppHistoryTimestamp)
      .find((timestamp): timestamp is Date => timestamp !== null) ?? new Date();
  const contextInfo = asRecord(payload.contextInfo);

  const caption =
    mediaItems.map((item) => item.caption).find((item) => Boolean(item)) ??
    textBody ??
    (typeof payload.caption === "string" ? payload.caption : null);
  if (
    albumAssociation?.parentRemoteJid &&
    albumAssociation.parentRemoteJid !== groupJid
  ) {
    return { imported: false, reason: "ALBUM_PARENT_GROUP_MISMATCH" };
  }
  const mediaGroupMarker = extractWhatsAppMediaGroupId(payload);
  const advertisedMediaCount = extractWhatsAppMediaGroupExpectedCount(payload);
  const isProviderAlbumContainer =
    isWhatsAppAlbumContainer(message) ||
    (messageType.toLowerCase().includes("album") &&
      advertisedMediaCount !== null);
  const albumSource = resolveWhatsAppAlbumSource({
    ownerId,
    instanceName,
    groupJid,
    remoteMessageId,
    mediaItemCount: mediaItems.length,
    mediaGroupMarker,
    advertisedMediaCount,
    isAlbumContainer: isProviderAlbumContainer,
    association: albumAssociation,
  });
  const mediaGroupSource = missingAlbumParentKey
    ? null
    : resolveWhatsAppMediaGroupSource({
        hasValidProtocolAssociation: albumAssociation !== null,
        isProviderAlbumContainer,
      });
  const mediaGroupIsAlbum = Boolean(
    hasAlbumAssociation ||
    mediaGroupMarker ||
    isWhatsAppAlbumContainer(message) ||
    advertisedMediaCount !== null,
  );
  if (
    mediaItems.length > 0 ||
    hasAlbumAssociation ||
    albumSource.mediaGroupExpectedCount !== null
  ) {
    console.info("WhatsApp message sync metadata received", {
      source: payload.source === "webhook" ? "webhook" : "history",
      mediaTypes: [...new Set(mediaItems.map((item) => item.mediaType))],
      observedMediaCount: mediaItems.length,
      expectedMediaCount: albumSource.mediaGroupExpectedCount,
      mediaAlbumAssociation: hasAlbumAssociation,
      parentMessageKeyPresent: Boolean(albumAssociation),
      messageIndex: albumAssociation?.messageIndex ?? null,
      groupKeyResolved: Boolean(albumSource.mediaGroupId),
      albumContainer: isWhatsAppAlbumContainer(message),
      hasCaptionOrText: Boolean(textBody || caption),
      mediaDownloadStatus: mediaItems.length > 0 ? "pending" : "not_required",
    });
  }
  const sourceMediaPayload = mediaItems.map((item, mediaIndex) => {
    const sourceMessageKey = asRecord(item.sourceMessage.key) ?? {};
    return {
      mediaIndex,
      mediaType: item.mediaType,
      mimeType: item.mimeType,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      caption: item.caption,
      messageKey: {
        ...key,
        ...sourceMessageKey,
        id: sourceMessageKey.id ?? remoteMessageId,
        remoteJid: sourceMessageKey.remoteJid ?? groupJid,
      },
      sourceMessage: stripInlineMediaData(item.sourceMessage),
    };
  });
  const row = {
    id: randomUUID(),
    ownerId,
    workspaceId: connection.workspaceId,
    instanceName,
    groupJid,
    groupId,
    providerRemoteJid: payloadRemoteJid,
    providerRemoteJidAlt: alternateRemoteJids[0] ?? null,
    remoteMessageId,
    senderId,
    senderName,
    messageType,
    textBody: textBody ?? null,
    caption,
    mediaAvailable: mediaItems.length > 0,
    mediaGroupId: missingAlbumParentKey ? null : albumSource.mediaGroupId,
    mediaGroupIsAlbum,
    mediaGroupSource,
    mediaGroupExpectedCount: albumSource.mediaGroupExpectedCount,
    mediaGroupIndex: albumSource.mediaGroupIndex,
    mediaDownloadStatus: mediaItems.length > 0 ? "pending" : "not_required",
    mediaDownloadError: null,
    sourceMediaPayload:
      extractedMediaItems.length > 0 ? sourceMediaPayload : null,
    messageStatus:
      payload.messageStatus === "deleted" || payload.status === "deleted"
        ? "deleted"
        : "received",
    source:
      payload.source && typeof payload.source === "string"
        ? payload.source
        : "import",
    messageTimestamp,
    replyToRemoteId:
      typeof payload.replyTo === "string"
        ? payload.replyTo
        : typeof contextInfo?.stanzaId === "string"
          ? contextInfo.stanzaId
          : null,
    updatedAt: new Date(),
  };

  let sourceSelected = false;
  const relatedMessageIds = new Set<string>();
  const receivedAt = new Date();
  const savedMessage = await db.transaction(async (transaction) => {
    const [targetGroup] = await transaction
      .select({ parentGroupId: menaWhatsAppGroups.parentGroupId })
      .from(menaWhatsAppGroups)
      .where(
        and(
          eq(menaWhatsAppGroups.id, groupId),
          eq(menaWhatsAppGroups.workspaceId, workspaceId),
          eq(menaWhatsAppGroups.instanceName, instanceName),
        ),
      )
      .limit(1)
      .for("share");
    if (!targetGroup) return null;

    const selectableGroupIds = [
      groupId,
      targetGroup.parentGroupId,
    ].filter((id): id is string => Boolean(id));
    const selections = await transaction
      .select({ id: menaWhatsAppGroupSelections.id })
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
          eq(menaWhatsAppGroupSelections.instanceName, instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
          inArray(menaWhatsAppGroupSelections.groupId, selectableGroupIds),
        ),
      )
      .limit(1)
      .for("share");
    if (selections.length === 0) return null;
    sourceSelected = true;

    let effectiveRow = row;

    if (
      !effectiveRow.mediaGroupId &&
      mediaItems.length === 0 &&
      !missingAlbumParentKey
    ) {
      const parentGroupId = whatsappAlbumId({
        ownerId,
        instanceName,
        groupJid,
        parentMessageId: remoteMessageId,
      });
      const [associatedMedia] = await transaction
        .select({
          mediaGroupId: menaWhatsAppMessages.mediaGroupId,
          mediaGroupExpectedCount: menaWhatsAppMessages.mediaGroupExpectedCount,
        })
        .from(menaWhatsAppMessages)
        .where(
          and(
            eq(menaWhatsAppMessages.workspaceId, workspaceId),
            eq(menaWhatsAppMessages.instanceName, instanceName),
            eq(menaWhatsAppMessages.groupId, groupId),
            eq(menaWhatsAppMessages.mediaGroupId, parentGroupId),
            eq(
              menaWhatsAppMessages.mediaGroupSource,
              "protocol_association",
            ),
          ),
        )
        .limit(1);
      if (associatedMedia) {
        effectiveRow = {
          ...effectiveRow,
          mediaGroupId: associatedMedia.mediaGroupId,
          mediaGroupIsAlbum: true,
          mediaGroupSource: "protocol_association",
          mediaGroupExpectedCount:
            Math.max(
              effectiveRow.mediaGroupExpectedCount ?? 0,
              associatedMedia.mediaGroupExpectedCount ?? 0,
            ) || null,
        };
      }
    }

    const [saved] = await transaction
      .insert(menaWhatsAppMessages)
      .values(effectiveRow)
      .onConflictDoUpdate({
        target: [
          menaWhatsAppMessages.ownerId,
          menaWhatsAppMessages.instanceName,
          menaWhatsAppMessages.groupId,
          menaWhatsAppMessages.remoteMessageId,
        ],
        setWhere: eq(menaWhatsAppMessages.workspaceId, workspaceId),
        set: {
          senderId:
            effectiveRow.senderId ?? sql`${menaWhatsAppMessages.senderId}`,
          senderName:
            effectiveRow.senderName ?? sql`${menaWhatsAppMessages.senderName}`,
          messageType:
            effectiveRow.messageType === "unknown"
              ? sql`${menaWhatsAppMessages.messageType}`
              : effectiveRow.messageType,
          textBody:
            effectiveRow.textBody ?? sql`${menaWhatsAppMessages.textBody}`,
          caption: effectiveRow.caption ?? sql`${menaWhatsAppMessages.caption}`,
          mediaAvailable: sql`${menaWhatsAppMessages.mediaAvailable} OR ${effectiveRow.mediaAvailable}`,
          mediaGroupId:
            effectiveRow.mediaGroupId ??
            sql`${menaWhatsAppMessages.mediaGroupId}`,
          mediaGroupIsAlbum: sql`${menaWhatsAppMessages.mediaGroupIsAlbum} OR ${effectiveRow.mediaGroupIsAlbum}`,
          mediaGroupSource:
            effectiveRow.mediaGroupSource ??
            sql`${menaWhatsAppMessages.mediaGroupSource}`,
          mediaGroupExpectedCount:
            effectiveRow.mediaGroupExpectedCount === null
              ? sql`${menaWhatsAppMessages.mediaGroupExpectedCount}`
              : sql`greatest(coalesce(${menaWhatsAppMessages.mediaGroupExpectedCount}, 0), ${effectiveRow.mediaGroupExpectedCount})`,
          mediaGroupIndex:
            effectiveRow.mediaGroupIndex ??
            sql`${menaWhatsAppMessages.mediaGroupIndex}`,
          mediaDownloadStatus: effectiveRow.mediaAvailable
            ? sql`CASE WHEN ${menaWhatsAppMessages.mediaDownloadStatus} = 'stored' THEN 'stored' ELSE ${effectiveRow.mediaDownloadStatus} END`
            : effectiveRow.sourceMediaPayload !== null
              ? effectiveRow.mediaDownloadStatus
              : sql`${menaWhatsAppMessages.mediaDownloadStatus}`,
          mediaDownloadError: effectiveRow.mediaAvailable
            ? effectiveRow.mediaDownloadError
            : effectiveRow.sourceMediaPayload !== null
              ? effectiveRow.mediaDownloadError
              : sql`${menaWhatsAppMessages.mediaDownloadError}`,
          sourceMediaPayload:
            effectiveRow.sourceMediaPayload !== null
              ? sql`CASE WHEN ${menaWhatsAppMessages.mediaDownloadStatus} = 'stored' THEN ${menaWhatsAppMessages.sourceMediaPayload} ELSE ${JSON.stringify(effectiveRow.sourceMediaPayload)}::jsonb END`
              : sql`${menaWhatsAppMessages.sourceMediaPayload}`,
          messageStatus:
            effectiveRow.messageStatus === "deleted"
              ? "deleted"
              : sql`${menaWhatsAppMessages.messageStatus}`,
          source: effectiveRow.source,
          providerRemoteJid:
            effectiveRow.providerRemoteJid ??
            sql`${menaWhatsAppMessages.providerRemoteJid}`,
          providerRemoteJidAlt:
            effectiveRow.providerRemoteJidAlt ??
            sql`${menaWhatsAppMessages.providerRemoteJidAlt}`,
          messageTimestamp: effectiveRow.messageTimestamp,
          replyToRemoteId:
            effectiveRow.replyToRemoteId ??
            sql`${menaWhatsAppMessages.replyToRemoteId}`,
          updatedAt: effectiveRow.updatedAt,
        },
      })
      .returning({ id: menaWhatsAppMessages.id });
    if (saved && albumAssociation && albumSource.mediaGroupId) {
      const [parent] = await transaction
        .update(menaWhatsAppMessages)
        .set({
          mediaGroupId: albumSource.mediaGroupId,
          mediaGroupIsAlbum: true,
          mediaGroupSource: "protocol_association",
          mediaGroupExpectedCount:
            albumSource.mediaGroupExpectedCount === null
              ? sql`${menaWhatsAppMessages.mediaGroupExpectedCount}`
              : sql`greatest(coalesce(${menaWhatsAppMessages.mediaGroupExpectedCount}, 0), ${albumSource.mediaGroupExpectedCount})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(menaWhatsAppMessages.workspaceId, workspaceId),
            eq(menaWhatsAppMessages.instanceName, instanceName),
            eq(menaWhatsAppMessages.groupId, groupId),
            eq(
              menaWhatsAppMessages.remoteMessageId,
              albumAssociation.parentMessageId,
            ),
          ),
        )
        .returning({ id: menaWhatsAppMessages.id });
      if (parent) {
        relatedMessageIds.add(parent.id);
      }
    }
    if (saved) {
      const now = new Date();
      await transaction
        .insert(menaContentJobs)
        .values({
          id: createHash("sha256")
            .update(`${workspaceId}:${saved.id}`)
            .digest("hex"),
          ownerId,
          workspaceId: connection.workspaceId,
          messageId: saved.id,
          status: "pending",
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
    if (relatedMessageIds.size > 0) {
      const now = new Date();
      await transaction
        .insert(menaContentJobs)
        .values(
          [...relatedMessageIds].map((id) => ({
            id: createHash("sha256")
              .update(`${workspaceId}:${id}`)
              .digest("hex"),
            ownerId,
            workspaceId: connection.workspaceId,
            messageId: id,
            status: "pending",
            attempts: 0,
            nextRunAt: now,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: menaContentJobs.id,
          setWhere: eq(menaContentJobs.workspaceId, connection.workspaceId),
          set: {
            status: "pending",
            attempts: 0,
            lastError: null,
            nextRunAt: now,
            updatedAt: now,
          },
        });
    }
    if (saved && effectiveRow.messageStatus === "received") {
      const extractionMessageIds = new Set([saved.id, ...relatedMessageIds]);
      const now = new Date();
      await transaction
        .insert(whatsappProductExtractionJobs)
        .values([...extractionMessageIds].map((messageId) => ({
          id: createHash("sha256")
            .update(`whatsapp-product:${workspaceId}:${messageId}`)
            .digest("hex"),
          ownerId,
          workspaceId,
          messageId,
          status: "pending" as const,
          stage: "received" as const,
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        })))
        .onConflictDoNothing();
    }
    return saved ?? null;
  });

  if (!sourceSelected) return { imported: false, reason: "GROUP_NOT_SELECTED" };
  if (!savedMessage) throw new Error("WHATSAPP_MESSAGE_SAVE_FAILED");

  return {
    imported: true,
    messageId: savedMessage.id,
    relatedMessageIds: [...relatedMessageIds],
  };
}

async function fetchHistoryForGroup(
  instanceName: string,
  groupJid: string,
  pageSize = 100,
  beforeCursor?: Date,
  maxNewMessages?: number,
  fullyPersistedMessageIds: ReadonlySet<string> = new Set(),
): Promise<unknown[]> {
  const matchingRecords = new Map<string, unknown>();
  let receivedRecordCount = 0;
  let newMessageCount = 0;
  for (const jidField of ["remoteJid", "remoteJidAlt"] as const) {
    if (
      maxNewMessages !== undefined &&
      newMessageCount >= maxNewMessages
    ) {
      break;
    }
    const seenPageRecordIds = new Set<string>();
    for (let page = 1; page <= 1000; page += 1) {
      const response = await evolutionRequest(
        `chat/findMessages/${encodeURIComponent(instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify(
            buildWhatsAppHistoryQuery(groupJid, pageSize, jidField, page),
          ),
        },
        30_000,
      );
      const records = extractWhatsAppHistoryRecords(response);
      if (!records) {
        throw new Error("EVOLUTION_HISTORY_INVALID_RESPONSE");
      }
      receivedRecordCount += records.length;
      const pageRecordIds = records.map((record) => {
        const envelope = asRecord(record);
        const key = asRecord(envelope?.key);
        return typeof key?.id === "string"
          ? `${String(key.fromMe)}:${key.id}`
          : JSON.stringify(record);
      });
      const newPageRecordIds = pageRecordIds.filter(
        (recordId) => !seenPageRecordIds.has(recordId),
      );
      for (const recordId of newPageRecordIds) {
        seenPageRecordIds.add(recordId);
      }
      if (records.length >= pageSize && newPageRecordIds.length === 0) {
        throw new Error("EVOLUTION_HISTORY_PAGINATION_STALLED");
      }
      const matching = filterHistoryRecordsForGroup(records, groupJid);
      if (
        beforeCursor &&
        isWhatsAppHistoryPageBeforeCursor(matching, beforeCursor)
      ) {
        break;
      }
      for (const record of matching) {
        const envelope = asRecord(record);
        const key = asRecord(envelope?.key);
        const recordId =
          typeof key?.id === "string"
            ? `${String(key.fromMe)}:${key.id}`
            : JSON.stringify(record);
        const isNewRecord = !matchingRecords.has(recordId);
        matchingRecords.set(recordId, record);
        if (isNewRecord && isWhatsAppHistoryCandidate(
          record,
          fullyPersistedMessageIds,
        )) {
          newMessageCount += 1;
        }
        if (
          maxNewMessages !== undefined &&
          newMessageCount >= maxNewMessages
        ) {
          break;
        }
      }
      if (
        maxNewMessages !== undefined &&
        newMessageCount >= maxNewMessages
      ) {
        break;
      }
      if (records.length < pageSize) break;
      if (page === 1000) {
        throw new Error("EVOLUTION_HISTORY_PAGINATION_LIMIT");
      }
    }
  }
  if (receivedRecordCount > 0 && matchingRecords.size === 0) {
    throw new Error("EVOLUTION_HISTORY_GROUP_MISMATCH");
  }
  return [...matchingRecords.values()];
}

export async function syncGroupHistory(
  workspaceId: string,
  instanceName: string,
  groupJid: string,
  _groupName: string,
  groupId: string,
  includeHistory = true,
  respectAutoSync = false,
  historyLimit = DEFAULT_WHATSAPP_HISTORY_IMPORT_LIMIT,
): Promise<{
  imported: number;
  skipped: number;
  failed: number;
  status: string;
}> {
  const [connection] = await db
    .select({ ownerId: menaWhatsAppConnections.ownerId })
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
        eq(menaWhatsAppConnections.instanceName, instanceName),
      ),
    )
    .limit(1);
  if (!connection) {
    return { imported: 0, skipped: 0, failed: 0, status: "cancelled" };
  }
  const ownerId = connection.ownerId;
  const syncState = await ensureSyncState(
    workspaceId,
    instanceName,
    groupJid,
    groupId,
  );
  const [latestMessage] = await db
    .select({
      messageTimestamp: sql<Date | null>`max(${menaWhatsAppMessages.messageTimestamp})`,
    })
    .from(menaWhatsAppMessages)
    .where(
      and(
        eq(menaWhatsAppMessages.workspaceId, workspaceId),
        eq(menaWhatsAppMessages.instanceName, instanceName),
        eq(menaWhatsAppMessages.groupId, groupId),
      ),
    );
  const latestMessageCursor = persistedWhatsAppCursor(
    latestMessage?.messageTimestamp,
  );
  const persistedCursor =
    latestMessageCursor ?? persistedWhatsAppCursor(syncState.lastCursor);
  const syncStartedAt = persistedCursor ?? new Date();
  const historyCursor = includeHistory ? undefined : syncStartedAt;
  const existingMessages = await db
    .select({
      remoteMessageId: menaWhatsAppMessages.remoteMessageId,
      mediaDownloadStatus: menaWhatsAppMessages.mediaDownloadStatus,
    })
    .from(menaWhatsAppMessages)
    .where(
      and(
        eq(menaWhatsAppMessages.workspaceId, workspaceId),
        eq(menaWhatsAppMessages.instanceName, instanceName),
        eq(menaWhatsAppMessages.groupId, groupId),
        ...(includeHistory
          ? []
          : [
              or(
                gte(menaWhatsAppMessages.messageTimestamp, syncStartedAt),
                isNull(menaWhatsAppMessages.messageTimestamp),
              ),
            ]),
      ),
    );
  const fullyPersistedMessageIds = new Set(
    existingMessages
      .filter(
        (message) =>
          message.mediaDownloadStatus !== "pending" &&
          message.mediaDownloadStatus !== "failed",
      )
      .map((message) => message.remoteMessageId),
  );
  activeWhatsAppSyncCounts.set(
    syncState.id,
    (activeWhatsAppSyncCounts.get(syncState.id) ?? 0) + 1,
  );
  const stats = { imported: 0, skipped: 0, failed: 0, status: "running" };
  const runStartedAt = Date.now();
  let fetchedHistoryCount = 0;
  let alreadyPersistedCount = 0;
  const logSyncResult = (fetchedCount: number) => {
    console.info("WhatsApp historical sync completed", {
      workspaceId,
      instanceName,
      groupJid,
      status: stats.status,
      fetchedCount,
      alreadyPersistedCount,
      importedCount: stats.imported,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      durationMs: Date.now() - runStartedAt,
    });
  };
  const cancelIfAutoSyncDisabled = async (): Promise<boolean> => {
    if (
      !respectAutoSync ||
      (await isWhatsAppAutoSyncEnabled(workspaceId, instanceName))
    ) {
      return false;
    }
    stats.status = "cancelled";
    await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
      status: "cancelled",
      completedAt: new Date(),
    });
    return true;
  };

  try {
    await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
      status: "running",
      startedAt: syncState.startedAt ?? new Date(),
      lastError: null,
    });

    if (await cancelIfAutoSyncDisabled()) return stats;

    let messages = await fetchHistoryForGroup(
      instanceName,
      groupJid,
      100,
      historyCursor,
      includeHistory ? historyLimit : undefined,
      fullyPersistedMessageIds,
    );
    fetchedHistoryCount = messages.length;
    if (!includeHistory) {
      messages = filterWhatsAppHistoryFrom(messages, syncStartedAt);
    }
    const candidateMessageCount = messages.length;
    messages = messages.filter((message) => {
      const messageId = getWhatsAppHistoryMessageId(message);
      return !messageId || !fullyPersistedMessageIds.has(messageId);
    });
    alreadyPersistedCount = candidateMessageCount - messages.length;
    if (await cancelIfAutoSyncDisabled()) return stats;
    if (messages.length === 0) {
      stats.status =
        includeHistory && fetchedHistoryCount === 0 ? "empty" : "complete";
      await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
        status: stats.status,
        lastSyncedAt: new Date(),
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        lastError: stats.status === "empty" ? "EVOLUTION_HISTORY_EMPTY" : null,
        completedAt: new Date(),
      });
      logSyncResult(fetchedHistoryCount);
      return stats;
    }

    let firstFailureCode: string | null = null;
    let latestCursor = persistedCursor;
    let latestMessageId = syncState.lastMessageId;
    for (const [index, message] of messages.entries()) {
      if (await cancelIfAutoSyncDisabled()) return stats;
      const candidate = asRecord(message);
      if (!candidate) {
        stats.skipped += 1;
      } else {
        const messageTimestamp = getWhatsAppHistoryTimestamp(candidate);
        try {
          const result = await persistImportedMessage(
            workspaceId,
            instanceName,
            groupJid,
            groupId,
            candidate,
          );
          if (result.imported) {
            stats.imported += 1;
            if (
              messageTimestamp &&
              (!latestCursor ||
                messageTimestamp.getTime() >= latestCursor.getTime())
            ) {
              latestCursor = messageTimestamp;
              latestMessageId = getWhatsAppHistoryMessageId(candidate);
            }
          } else {
            stats.skipped += 1;
            if (result.reason === "WHATSAPP_CONNECTION_NOT_FOUND") {
              stats.status = "cancelled";
              await updateSyncState(
                workspaceId,
                instanceName,
                groupJid,
                groupId,
                {
                  status: "cancelled",
                  importedCount: stats.imported,
                  skippedCount: stats.skipped,
                  failedCount: stats.failed,
                  completedAt: new Date(),
                },
              );
              return stats;
            }
            if (result.reason === "GROUP_JID_MISMATCH") {
              await updateSyncState(
                workspaceId,
                instanceName,
                groupJid,
                groupId,
                {
                  status: "failed",
                  lastError: `Ignored message from a different remoteJid than ${groupJid}`,
                  completedAt: new Date(),
                },
              );
              stats.status = "failed";
              return stats;
            }
          }
        } catch (error) {
          stats.failed += 1;
          const failureCode = historyImportFailureCode(error);
          firstFailureCode ??= failureCode;
          console.error("WhatsApp historical message import failed", {
            workspaceId,
            instanceName,
            groupJid,
            failureCode,
          });
        }
      }
      if ((index + 1) % 10 === 0 || index === messages.length - 1) {
        await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
          status: "running",
          importedCount: stats.imported,
          skippedCount: stats.skipped,
          failedCount: stats.failed,
        });
      }
    }

    if (await cancelIfAutoSyncDisabled()) return stats;

    const status =
      stats.failed > 0 || (stats.imported === 0 && stats.skipped > 0)
        ? "partial"
        : "complete";
    const cursorUpdates = latestCursor
      ? {
          lastCursor: latestCursor.toISOString(),
          lastMessageId: latestMessageId,
        }
      : {};
    await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
      status,
      lastSyncedAt: new Date(),
      ...cursorUpdates,
      importedCount: stats.imported,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      lastError:
        stats.failed > 0
          ? (firstFailureCode ?? "WHATSAPP_MESSAGE_IMPORT_FAILED")
          : stats.imported === 0 && stats.skipped > 0
            ? "EVOLUTION_HISTORY_MESSAGES_SKIPPED"
            : null,
      completedAt: new Date(),
    });
    stats.status = status;
    logSyncResult(fetchedHistoryCount);
    return stats;
  } catch (error) {
    if (await cancelIfAutoSyncDisabled()) return stats;

    const message =
      error instanceof Error ? error.message : "History import failed";
    await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
      status: "failed",
      lastSyncedAt: new Date(),
      importedCount: stats.imported,
      skippedCount: stats.skipped,
      failedCount: stats.failed + 1,
      lastError: message,
      completedAt: new Date(),
    });
    stats.status = "failed";
    console.error("WhatsApp historical sync failed", {
      workspaceId,
      instanceName,
      groupJid,
      reason: message,
      durationMs: Date.now() - runStartedAt,
    });
    return stats;
  } finally {
    const activeCount = activeWhatsAppSyncCounts.get(syncState.id) ?? 0;
    if (activeCount <= 1) {
      activeWhatsAppSyncCounts.delete(syncState.id);
    } else {
      activeWhatsAppSyncCounts.set(syncState.id, activeCount - 1);
    }
  }
}

export async function processWebhookEvent(
  body: unknown,
  req: { headers?: Record<string, string | string[] | undefined> },
): Promise<void> {
  const payload = asRecord(body);
  if (!payload) return;

  if (!verifyWhatsAppWebhookSecret(req.headers?.["x-evolution-api-key"])) {
    return;
  }

  const eventName = normalizeWhatsAppWebhookEventName(
    payload.event ?? payload.type,
  );
  if (!isWhatsAppMessageWebhookEvent(eventName)) return;

  const webhookBatch = extractWhatsAppWebhookBatch(payload);
  if (webhookBatch) {
    for (const message of webhookBatch) {
      await processWebhookEvent({ ...payload, data: message }, req);
    }
    return;
  }

  const payloadData = asRecord(payload.data);
  const key = asRecord(payloadData?.key) ?? asRecord(payload.key);
  const remoteJid =
    normalizeRemoteJid(key?.remoteJid) ??
    normalizeRemoteJid(key?.remoteJidAlt) ??
    normalizeRemoteJid(payload.remoteJid) ??
    normalizeRemoteJid(payloadData?.remoteJid) ??
    normalizeRemoteJid(payloadData?.chatJid) ??
    normalizeRemoteJid(payloadData?.groupJid) ??
    normalizeRemoteJid(payload?.groupJid) ??
    null;

  const instanceName =
    queryString(payload.instance) ??
    queryString(payloadData?.instance) ??
    queryString(key?.instance) ??
    queryString(payload?.instanceName) ??
    null;
  if (!remoteJid || !instanceName) return;

  const matchingConnections = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.instanceName, instanceName))
    .limit(2);
  if (matchingConnections.length !== 1) {
    if (matchingConnections.length > 1) {
      console.error("WhatsApp webhook instance is ambiguous in the database", {
        instanceName,
      });
    }
    return;
  }
  const [connection] = matchingConnections;
  if (!connection) return;

  const eventPayload = asRecord(payloadData ?? payload) ?? payload;
  const eventKey =
    asRecord(eventPayload?.key ?? payloadData?.key) ?? asRecord(payload.key);
  const eventRemoteJid =
    normalizeRemoteJid(eventKey?.remoteJid) ??
    normalizeRemoteJid(eventPayload?.remoteJid) ??
    remoteJid;
  const isDirectIncoming =
    eventName === "MESSAGES_UPSERT" &&
    isDirectIncomingWhatsAppMessage({
      fromMe: eventKey?.fromMe ?? eventPayload?.fromMe,
      remoteJid: eventRemoteJid,
    });
  const incomingMessageCandidate = isDirectIncoming
    ? (asRecord(eventPayload.message) ?? eventPayload)
    : null;
  const customerOptedOut =
    incomingMessageCandidate !== null &&
    isWhatsAppOptOutMessage(
      extractWhatsAppTextFromMessage(incomingMessageCandidate),
    );
  if (
    eventName === "MESSAGES_UPSERT" &&
    connection.autoReplyEnabled &&
    !customerOptedOut &&
    isDirectIncoming &&
    incomingMessageCandidate
  ) {
    const customerMessage = extractWhatsAppTextFromMessage(
      incomingMessageCandidate,
    );
    const remoteMessageId =
      typeof eventKey?.id === "string"
        ? eventKey.id
        : typeof eventPayload.id === "string"
          ? eventPayload.id
          : "";
    if (customerMessage && remoteMessageId) {
      const [claim] = await db
        .insert(menaWhatsAppAutoReplyEvents)
        .values({
          id: randomUUID(),
          ownerId: connection.ownerId,
          workspaceId: connection.workspaceId,
          instanceName,
          remoteMessageId,
          status: "processing",
        })
        .onConflictDoNothing()
        .returning({ id: menaWhatsAppAutoReplyEvents.id });
      if (claim) {
        let sendStarted = false;
        try {
          // Re-check the toggle after generation so a merchant who disabled
          // auto replies while the AI call was running never gets a reply sent.
          const [latestConnection] = await db
            .select({ autoReplyEnabled: menaWhatsAppConnections.autoReplyEnabled })
            .from(menaWhatsAppConnections)
            .where(eq(menaWhatsAppConnections.workspaceId, connection.workspaceId))
            .limit(1);
          if (latestConnection?.autoReplyEnabled) {
            const reply = await generateWhatsAppAutoReply(
              connection.workspaceId,
              customerMessage,
              {
                language:
                  connection.autoReplyLanguage === "match_customer"
                    ? "match_customer"
                    : "ar",
                tone:
                  connection.autoReplyTone === "concise" ||
                  connection.autoReplyTone === "formal"
                    ? connection.autoReplyTone
                    : "friendly_professional",
                instructions: connection.autoReplyInstructions ?? "",
              },
            );
            sendStarted = true;
            const replyMessageId = await sendWhatsAppAutoReply(
              instanceName,
              eventRemoteJid!,
              reply,
            );
            await db
              .update(menaWhatsAppAutoReplyEvents)
              .set({
                status: "sent",
                replyMessageId,
                completedAt: new Date(),
              })
              .where(
                and(
                  eq(menaWhatsAppAutoReplyEvents.id, claim.id),
                  eq(
                    menaWhatsAppAutoReplyEvents.workspaceId,
                    connection.workspaceId,
                  ),
                ),
              );
          } else {
            await db
              .update(menaWhatsAppAutoReplyEvents)
              .set({
                status: "failed",
                errorCode: "AUTO_REPLY_DISABLED",
                completedAt: new Date(),
              })
              .where(
                and(
                  eq(menaWhatsAppAutoReplyEvents.id, claim.id),
                  eq(
                    menaWhatsAppAutoReplyEvents.workspaceId,
                    connection.workspaceId,
                  ),
                ),
              );
          }
        } catch (error) {
          const errorCode =
            error instanceof EvolutionApiError
              ? error.message.slice(0, 80)
              : error instanceof Error
                ? error.name.slice(0, 80)
                : "AUTO_REPLY_FAILED";
          console.error("WhatsApp automatic reply failed", {
            workspaceId: connection.workspaceId,
            instanceName,
            errorCode: sendStarted ? "AUTO_REPLY_RESULT_UNKNOWN" : errorCode,
          });
          await db
            .update(menaWhatsAppAutoReplyEvents)
            .set({
              status: sendStarted ? "unknown" : "failed",
              errorCode: sendStarted
                ? "AUTO_REPLY_RESULT_UNKNOWN"
                : errorCode,
              completedAt: new Date(),
            })
            .where(
              and(
                eq(menaWhatsAppAutoReplyEvents.id, claim.id),
                eq(
                  menaWhatsAppAutoReplyEvents.workspaceId,
                  connection.workspaceId,
                ),
              ),
            );
        }
      }
    }
  }

  if (!connection.autoSyncEnabled) return;

  const groupJidCandidates = [
    ...new Set(
      [
        eventRemoteJid,
        normalizeRemoteJid(eventKey?.remoteJidAlt),
        remoteJid,
      ].filter((jid): jid is string => Boolean(jid)),
    ),
  ];
  const [groupIdentity] = await db
    .select({
      groupId: menaWhatsAppGroupJids.groupId,
      groupJid: menaWhatsAppGroupJids.groupJid,
    })
    .from(menaWhatsAppGroupJids)
    .where(
      and(
        eq(menaWhatsAppGroupJids.workspaceId, connection.workspaceId),
        eq(menaWhatsAppGroupJids.instanceName, instanceName),
        inArray(menaWhatsAppGroupJids.groupJid, groupJidCandidates),
      ),
    )
    .limit(1);
  if (!groupIdentity) return;

  const [selectedGroup] = await db
    .select({ id: menaWhatsAppGroupSelections.id })
    .from(menaWhatsAppGroupSelections)
    .innerJoin(
      menaWhatsAppGroups,
      and(
        eq(menaWhatsAppGroups.id, groupIdentity.groupId),
        eq(menaWhatsAppGroups.workspaceId, connection.workspaceId),
        eq(menaWhatsAppGroups.instanceName, instanceName),
      ),
    )
    .where(
      and(
        eq(menaWhatsAppGroupSelections.workspaceId, connection.workspaceId),
        eq(menaWhatsAppGroupSelections.instanceName, instanceName),
        eq(menaWhatsAppGroupSelections.selected, true),
        or(
          eq(menaWhatsAppGroupSelections.groupId, groupIdentity.groupId),
          eq(
            menaWhatsAppGroupSelections.groupId,
            menaWhatsAppGroups.parentGroupId,
          ),
        ),
      ),
    )
    .limit(1);
  if (!selectedGroup) return;

  if (eventName === "MESSAGES_DELETE" || eventPayload?.status === "deleted") {
    await db
      .update(menaWhatsAppMessages)
      .set({ messageStatus: "deleted", updatedAt: new Date() })
      .where(
        and(
          eq(menaWhatsAppMessages.workspaceId, connection.workspaceId),
          eq(menaWhatsAppMessages.instanceName, instanceName),
          eq(menaWhatsAppMessages.groupId, groupIdentity.groupId),
          eq(
            menaWhatsAppMessages.remoteMessageId,
            String(eventPayload?.id ?? eventKey?.id ?? ""),
          ),
        ),
      );
    return;
  }

  if (
    eventName !== "MESSAGES_UPSERT" &&
    eventName !== "MESSAGES_SET" &&
    eventName !== "MESSAGES_UPDATE"
  )
    return;

  const messageCandidate = asRecord(eventPayload.message) ?? eventPayload;
  if (!messageCandidate) return;
  const candidateRecord = asRecord(messageCandidate) ?? {};
  if (
    eventName === "MESSAGES_UPDATE" &&
    !hasWhatsAppMessageContent(candidateRecord)
  )
    return;
  const persisted = await persistImportedMessage(
    connection.workspaceId,
    instanceName,
    groupIdentity.groupJid,
    groupIdentity.groupId,
    {
      ...eventPayload,
      ...candidateRecord,
      message: candidateRecord,
      source: "webhook",
      key: {
        ...eventKey,
        id: candidateRecord.id ?? eventPayload.id ?? eventKey?.id,
        remoteJid: eventKey?.remoteJid ?? groupIdentity.groupJid,
      },
      messageStatus: eventName === "MESSAGES_UPDATE" ? "updated" : "received",
    },
  );

  if (!persisted.imported) {
    console.warn("Ignored webhook event outside allowed group scope", {
      instanceName,
      ownerId: connection.ownerId,
      remoteJid,
      reason: persisted.reason,
    });
    return;
  }
  if (persisted.messageId) {
    await enqueueWhatsAppMessage(connection.workspaceId, persisted.messageId);
  }
  for (const relatedMessageId of persisted.relatedMessageIds ?? []) {
    await enqueueWhatsAppMessage(connection.workspaceId, relatedMessageId);
  }
}
