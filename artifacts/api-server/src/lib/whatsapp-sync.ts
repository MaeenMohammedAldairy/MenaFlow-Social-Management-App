import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  lte,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppAutoReplyEvents,
  menaWhatsAppDirectMessages,
  menaContentJobs,
  menaWhatsAppGroups,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessages,
  menaWhatsAppSyncStates,
  products,
  whatsappProductExtractionJobs,
} from "@workspace/db";
import { createHash, randomUUID } from "node:crypto";
import { enqueueWhatsAppMessage } from "../lib/whatsapp-marketing";
import { storeWhatsAppDirectMediaForMessage } from "./whatsapp-direct-media-store.ts";
import { stripInlineMediaData } from "./whatsapp-direct-media.ts";

import {
  extractMediaItemsFromMessage,
  extractWhatsAppTextFromMessage,
  extractWhatsAppAlbumAssociation,
  extractWhatsAppReplySignal,
  hasWhatsAppAlbumAssociation,
  extractWhatsAppMediaGroupId,
  extractWhatsAppMediaGroupExpectedCount,
  extractWhatsAppWebhookBatch,
  getWhatsAppWebhookGroupJidCandidates,
  hasWhatsAppMessageContent,
  isWhatsAppAlbumContainer,
  filterHistoryRecordsForGroup,
  isWhatsAppMessageWebhookEvent,
  normalizeWhatsAppWebhookEventName,
  normalizeRemoteJid,
} from "../lib/whatsapp-message-scope";
import {
  isWhatsAppCustomerOptedOut,
  recordWhatsAppConsent,
  whatsAppConsentActionForMessage,
  withWhatsAppAutomationConsent,
} from "../lib/whatsapp-opt-out";
import {
  whatsAppOptOutLock,
  whatsAppOptOutStore,
} from "../lib/whatsapp-opt-out-store";
import {
  createHeartbeat,
  createRunDeadline,
  resolveSyncHeartbeatMs,
  resolveSyncRunBudgetMs,
} from "../lib/sync-run-control";
import {
  shouldQueueWhatsAppAutoReply,
  whatsAppAutoReplyHourlyLimit,
  whatsAppAutoReplyMaxAgeMs,
  whatsAppAutoReplyQuotaPauseMs,
  whatsAppAutoReplyWindowExpiredCode,
} from "../lib/whatsapp-auto-reply-policy";
import {
  autoReplyLoopGuardCode,
  autoReplyNextRunAt,
  autoReplySupersededCode,
} from "../lib/auto-reply-policy";
import {
  planAutoReplyFailure,
  whatsAppAutoReplyErrorCode,
} from "../lib/auto-reply-failure";
import {
  describeWhatsAppAutoReplySkip,
  describeWhatsAppInboundOutcome,
  logInboundWebhookOutcome,
  type InboundWebhookOutcome,
} from "../lib/inbound-webhook-diagnostics";
import { recordInboundWebhookAttempt } from "../lib/inbound-delivery-log";
import { isActiveWhatsAppConnectionStatus } from "../lib/whatsapp-phone-ownership.ts";
import { processWhatsAppOrderIntake } from "../lib/whatsapp-order-intake";
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
  isWhatsAppHistoryFilterIgnored,
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
import {
  matchMetaAutoReplyProduct,
  formatMetaAutoReplyPrice,
  retryMetaAutoReplyGeneration,
} from "../lib/meta-auto-reply";
import { isDirectIncomingWhatsAppMessage } from "../lib/whatsapp-auto-reply-policy";
import { notifyCustomerMessage } from "./push-notifications";
import {
  buildWhatsAppDirectMessageContext,
  decryptWhatsAppDirectMessageValue,
  encryptWhatsAppDirectMessageValue,
  isWhatsAppDirectPhoneJid,
  outboundWhatsAppDirectMessageValues,
  normalizeWhatsAppDirectMessageText,
  redactWhatsAppPrivateData,
  classifyWhatsAppDirectMessage,
  whatsappDirectSenderNameFromPayload,
  selectWhatsAppDirectJid,
  whatsappDirectConversationKeys,
  whatsappDirectMessageExpiry,
  whatsappDirectMessagePlaceholder,
} from "../lib/whatsapp-direct-messages";
import { asRecord, queryString } from "./value-utils.ts";
import { resolveMessageSenderId } from "../lib/whatsapp-marketing-safety";
import { logger } from "./logger.ts";

export const WHATSAPP_SYNC_STALE_THRESHOLD_MS = 10 * 60 * 1000;
export const DEFAULT_WHATSAPP_HISTORY_IMPORT_LIMIT = 500;
export const MAX_WHATSAPP_HISTORY_IMPORT_LIMIT = 10_000;
const whatsappAutoReplyLeaseMs = 60_000;

const activeWhatsAppSyncCounts = new Map<string, number>();

function persistedWhatsAppCursor(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const cursor = parseWhatsAppHistoryTimestamp(value);
  if (!cursor) throw new Error("WHATSAPP_SYNC_CURSOR_INVALID");
  return cursor;
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
  // The quoted-message signal, read from every address Evolution uses. The old
  // code looked only at `payload.contextInfo`, so a stanza id living under
  // `message.imageMessage.contextInfo` was invisible. This reads; it does not
  // change how a message is grouped.
  const replySignal = extractWhatsAppReplySignal(payload, message);

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
    logger.info(
      {
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
      },
      "WhatsApp message sync metadata received",
    );
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
    fromMe: fromBusiness,
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
    // Priority is unchanged for the field itself: an explicit `replyTo`, then a
    // stanza id from wherever it was found. `null` when nothing carries one.
    replyToRemoteId: replySignal.replyToRemoteId,
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
          fromMe: effectiveRow.fromMe || sql`${menaWhatsAppMessages.fromMe}`,
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

// Cap for the fallback scan used when an Evolution deployment ignores the
// remoteJid filter (50 pages × 100 records per sync run per group).
const WHATSAPP_HISTORY_SCAN_PAGE_CAP = 50;

/** Cooperative controls for a history scan: a liveness beat and a stop check. */
type WhatsAppHistoryFetchControls = {
  /** Called after every page; the caller uses it to prove the run is alive. */
  onPage?: (info: { page: number; recordCount: number }) => void | Promise<void>;
  /** Returning false stops the scan and keeps whatever was collected. */
  shouldContinue?: () => boolean;
};

async function fetchHistoryForGroup(
  instanceName: string,
  groupJid: string,
  pageSize = 100,
  beforeCursor?: Date,
  maxNewMessages?: number,
  fullyPersistedMessageIds: ReadonlySet<string> = new Set(),
  controls: WhatsAppHistoryFetchControls = {},
): Promise<{ records: unknown[]; budgetReached: boolean }> {
  const matchingRecords = new Map<string, unknown>();
  let budgetReached = false;
  let receivedRecordCount = 0;
  let newMessageCount = 0;
  // When the upstream Evolution deployment ignores the remoteJid filter it
  // returns other chats' messages; the per-record group filter below still
  // keeps only this group's records (checking both JID fields), so one
  // bounded scan replaces both filtered passes. The scan briefly holds
  // unrelated chats of the same merchant in memory — unavoidable while the
  // upstream filter is broken, hence the page cap.
  let filterIgnored = false;
  let scannedPages = 0;
  for (const jidField of ["remoteJid", "remoteJidAlt"] as const) {
    if (filterIgnored || budgetReached) break;
    if (
      maxNewMessages !== undefined &&
      newMessageCount >= maxNewMessages
    ) {
      break;
    }
    const seenPageRecordIds = new Set<string>();
    for (let page = 1; page <= 1000; page += 1) {
      // Checked before the request, not after: a run that is out of budget must
      // not start another 30-second page fetch. What was already collected is
      // kept, and the next sync continues from the advanced cursor.
      if (controls.shouldContinue && !controls.shouldContinue()) {
        budgetReached = true;
        break;
      }
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
      if (controls.onPage) {
        await controls.onPage({ page, recordCount: records.length });
      }
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
        if (!filterIgnored) {
          throw new Error("EVOLUTION_HISTORY_PAGINATION_STALLED");
        }
        break;
      }
      const matching = filterHistoryRecordsForGroup(records, groupJid);
      if (
        !filterIgnored &&
        page === 1 &&
        isWhatsAppHistoryFilterIgnored(records.length, matching.length)
      ) {
        filterIgnored = true;
        logger.warn(
          { instanceName, groupJid },
          "WHATSAPP_HISTORY_FILTER_IGNORED_FALLING_BACK_TO_SCAN",
        );
      }
      if (filterIgnored) {
        scannedPages += 1;
      }
      const scanPageCapReached =
        filterIgnored && scannedPages >= WHATSAPP_HISTORY_SCAN_PAGE_CAP;
      const scanPastCursor =
        filterIgnored &&
        beforeCursor !== undefined &&
        isWhatsAppHistoryPageBeforeCursor(records, beforeCursor);
      if (scanPageCapReached) {
        logger.warn(
          { instanceName, groupJid, scannedPages },
          "WHATSAPP_HISTORY_SCAN_PAGE_CAP_REACHED",
        );
      }
      if (
        !filterIgnored &&
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
      if (scanPastCursor || scanPageCapReached) break;
      if (records.length < pageSize) break;
      if (page === 1000) {
        throw new Error("EVOLUTION_HISTORY_PAGINATION_LIMIT");
      }
    }
  }
  if (
    !filterIgnored &&
    !budgetReached &&
    receivedRecordCount > 0 &&
    matchingRecords.size === 0
  ) {
    throw new Error("EVOLUTION_HISTORY_GROUP_MISMATCH");
  }
  if (budgetReached) {
    logger.warn(
      {
        instanceName,
        groupJid,
        receivedRecordCount,
        matchedRecordCount: matchingRecords.size,
      },
      "WHATSAPP_HISTORY_RUN_BUDGET_REACHED",
    );
  }
  return { records: [...matchingRecords.values()], budgetReached };
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
  const runDeadline = createRunDeadline(resolveSyncRunBudgetMs());
  const heartbeat = createHeartbeat(resolveSyncHeartbeatMs());
  let historyBudgetReached = false;
  let fetchedHistoryCount = 0;
  let alreadyPersistedCount = 0;
  const logSyncResult = (fetchedCount: number) => {
    logger.info(
      {
        workspaceId,
        instanceName,
        groupJid,
        status: stats.status,
        fetchedCount,
        alreadyPersistedCount,
        importedCount: stats.imported,
        skippedCount: stats.skipped,
        failedCount: stats.failed,
        historyBudgetReached,
        durationMs: Date.now() - runStartedAt,
      },
      "WhatsApp historical sync completed",
    );
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

    const history = await fetchHistoryForGroup(
      instanceName,
      groupJid,
      100,
      historyCursor,
      includeHistory ? historyLimit : undefined,
      fullyPersistedMessageIds,
      {
        shouldContinue: () => !runDeadline.expired(),
        // The fetch phase can run for minutes without touching the database,
        // and stale-run cancellation in another process only looks at
        // updated_at. Beating once per interval keeps a live run alive without
        // writing on every page.
        onPage: async () => {
          if (!heartbeat.due()) return;
          heartbeat.beat();
          await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
            status: "running",
          });
        },
      },
    );
    let messages = history.records;
    historyBudgetReached = history.budgetReached;
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
      stats.status = historyBudgetReached
        ? "partial"
        : includeHistory && fetchedHistoryCount === 0
          ? "empty"
          : "complete";
      await updateSyncState(workspaceId, instanceName, groupJid, groupId, {
        status: stats.status,
        lastSyncedAt: new Date(),
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        lastError:
          stats.status === "empty"
            ? "EVOLUTION_HISTORY_EMPTY"
            : historyBudgetReached
              ? "WHATSAPP_HISTORY_RUN_BUDGET_REACHED"
              : null,
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
          logger.error(
            {
              workspaceId,
              instanceName,
              groupJid,
              failureCode,
            },
            "WhatsApp historical message import failed",
          );
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
      stats.failed > 0 ||
      historyBudgetReached ||
      (stats.imported === 0 && stats.skipped > 0)
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
          : historyBudgetReached
            // Not a fault: the run stopped on its budget and the next sync
            // continues from the cursor this one advanced.
            ? "WHATSAPP_HISTORY_RUN_BUDGET_REACHED"
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
    logger.error(
      {
        workspaceId,
        instanceName,
        groupJid,
        reason: message,
        durationMs: Date.now() - runStartedAt,
      },
      "WhatsApp historical sync failed",
    );
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

async function processWhatsAppAutoReplyAsync(input: {
  claimId: string;
  attempts: number;
  connection: typeof menaWhatsAppConnections.$inferSelect;
  instanceName: string;
  remoteJid: string;
  remoteJidHash: string;
  remoteMessageId: string;
  messageTimestamp: Date;
  customerMessage: string;
}): Promise<void> {
  let sendStarted = false;
  // Both replies — the order-intake text and the generated one — leave through
  // the same sequence, which used to be written out twice: mark the event
  // `sending` (so a crash from here on is read as "may have landed"), send,
  // record the outbound message in the conversation, settle the event as sent.
  const deliverReply = async (text: string): Promise<void> => {
    // Final gate immediately before the provider call. The webhook persists a
    // STOP without taking this lock, so a consent change that lands while the
    // reply was being generated is still seen here and cancels the send.
    if (
      await isWhatsAppCustomerOptedOut({
        store: whatsAppOptOutStore,
        workspaceId: input.connection.workspaceId,
        customerId: input.remoteJidHash,
      })
    ) {
      await stopWhatsAppAutoReplyEvent({
        claimId: input.claimId,
        workspaceId: input.connection.workspaceId,
        errorCode: "CUSTOMER_OPTED_OUT",
      });
      return;
    }
    await db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "sending",
        leaseExpiresAt: new Date(Date.now() + whatsappAutoReplyLeaseMs),
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
          eq(menaWhatsAppAutoReplyEvents.status, "processing"),
        ),
      );
    sendStarted = true;
    const replyMessageId = await sendWhatsAppAutoReply(
      input.instanceName,
      input.remoteJid,
      text,
    );
    const sentAt = new Date();
    await db
      .insert(menaWhatsAppDirectMessages)
      .values(
        outboundWhatsAppDirectMessageValues({
          ownerId: input.connection.ownerId,
          workspaceId: input.connection.workspaceId,
          instanceName: input.instanceName,
          remoteJid: input.remoteJid,
          text,
          status: "sent",
          messageTimestamp: sentAt,
          providerMessageId: replyMessageId,
        }),
      )
      .onConflictDoNothing();
    await db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "sent",
        replyMessageId,
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
          eq(
            menaWhatsAppAutoReplyEvents.workspaceId,
            input.connection.workspaceId,
          ),
        ),
      );
  };
  try {
    if (!isWhatsAppDirectPhoneJid(input.remoteJid)) {
      await db
        .update(menaWhatsAppAutoReplyEvents)
        .set({
          status: "failed",
          errorCode: "WHATSAPP_RECIPIENT_PHONE_REQUIRED",
          leaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
            eq(
              menaWhatsAppAutoReplyEvents.workspaceId,
              input.connection.workspaceId,
            ),
          ),
        );
      return;
    }
    // Re-check the toggle before generating/sending so a merchant who disabled
    // auto replies while the job was pending never gets a reply sent.
    const [latestConnection] = await db
      .select({
        autoReplyEnabled: menaWhatsAppConnections.autoReplyEnabled,
        autoReplyLanguage: menaWhatsAppConnections.autoReplyLanguage,
        autoReplyTone: menaWhatsAppConnections.autoReplyTone,
        autoReplyInstructions: menaWhatsAppConnections.autoReplyInstructions,
      })
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, input.connection.workspaceId))
      .limit(1);

    if (!latestConnection?.autoReplyEnabled) {
      await db
        .update(menaWhatsAppAutoReplyEvents)
        .set({
          status: "failed",
          errorCode: "AUTO_REPLY_DISABLED",
          leaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
            eq(
              menaWhatsAppAutoReplyEvents.workspaceId,
              input.connection.workspaceId,
            ),
          ),
        );
      return;
    }
    // WhatsApp has no messaging window like Meta, so a delayed queue could
    // answer a message from yesterday. Beyond the limit a human takes over.
    if (
      Date.now() - input.messageTimestamp.getTime() >
      whatsAppAutoReplyMaxAgeMs()
    ) {
      await stopWhatsAppAutoReplyEvent({
        claimId: input.claimId,
        workspaceId: input.connection.workspaceId,
        errorCode: whatsAppAutoReplyWindowExpiredCode,
      });
      return;
    }
    // A newer message in the same chat may have its own waiting reply; drop
    // this stale answer before spending an AI generation on it.
    if (
      await chatHasNewerWaitingWhatsAppAutoReply({
        workspaceId: input.connection.workspaceId,
        instanceName: input.instanceName,
        remoteJidHash: input.remoteJidHash,
        claimId: input.claimId,
        messageTimestamp: input.messageTimestamp,
      })
    ) {
      await stopWhatsAppAutoReplyEvent({
        claimId: input.claimId,
        workspaceId: input.connection.workspaceId,
        errorCode: autoReplySupersededCode,
      });
      return;
    }
    if (
      (await countRecentWhatsAppAutoReplies({
        workspaceId: input.connection.workspaceId,
        instanceName: input.instanceName,
        remoteJidHash: input.remoteJidHash,
      })) >= whatsAppAutoReplyHourlyLimit()
    ) {
      await stopWhatsAppAutoReplyEvent({
        claimId: input.claimId,
        workspaceId: input.connection.workspaceId,
        errorCode: autoReplyLoopGuardCode,
      });
      return;
    }

    const consentGate = await withWhatsAppAutomationConsent({
      store: whatsAppOptOutStore,
      lock: whatsAppOptOutLock,
      workspaceId: input.connection.workspaceId,
      customerId: input.remoteJidHash,
      run: async () => {
        const orderIntake = await processWhatsAppOrderIntake({
          ownerId: input.connection.ownerId,
          workspaceId: input.connection.workspaceId,
          instanceName: input.instanceName,
          remoteJid: input.remoteJid,
          remoteJidHash: input.remoteJidHash,
          providerMessageId: input.remoteMessageId,
          text: input.customerMessage,
        });
        if (orderIntake.kind !== "ignored") {
          await deliverReply(orderIntake.text);
          return;
        }

        let contextTurns: Array<{ role: "customer" | "business"; text: string }> = [];
        try {
          const conversationKeys = whatsappDirectConversationKeys(
            input.connection.workspaceId,
            input.instanceName,
            input.remoteJid,
          );
          const recentMessages = await db
            .select({
              direction: menaWhatsAppDirectMessages.direction,
              encryptedTextBody: menaWhatsAppDirectMessages.encryptedTextBody,
            })
            .from(menaWhatsAppDirectMessages)
            .where(
              and(
                eq(menaWhatsAppDirectMessages.workspaceId, input.connection.workspaceId),
                eq(menaWhatsAppDirectMessages.instanceName, input.instanceName),
                inArray(menaWhatsAppDirectMessages.remoteJidHash, conversationKeys),
                gt(menaWhatsAppDirectMessages.expiresAt, new Date()),
              ),
            )
            .orderBy(
              desc(menaWhatsAppDirectMessages.messageTimestamp),
              desc(menaWhatsAppDirectMessages.createdAt),
            )
            .limit(10);

          contextTurns = buildWhatsAppDirectMessageContext(
            recentMessages.reverse().map((message) => ({
              direction: message.direction,
              textBody: decryptWhatsAppDirectMessageValue(
                message.encryptedTextBody,
              ),
            })),
          );
        } catch (contextError) {
          logger.warn(
            { contextError },
            "Failed to fetch previous WhatsApp conversation history for auto reply",
          );
        }

        let matchingProduct = null;
        try {
          const activeProducts = await db
            .select()
            .from(products)
            .where(
              and(
                eq(products.workspaceId, input.connection.workspaceId),
                eq(products.status, "active"),
                isNotNull(products.verifiedAt),
              ),
            )
            .orderBy(desc(products.updatedAt))
            .limit(100);

          const matched = matchMetaAutoReplyProduct(
            activeProducts,
            input.customerMessage,
          );
          if (matched) {
            matchingProduct = {
              name: matched.name,
              sku: matched.sku,
              price: formatMetaAutoReplyPrice(matched.price),
              currency: matched.currency,
              availability: matched.availability,
              description: matched.description,
            };
          }
        } catch (productError) {
          logger.warn(
            { productError },
            "Failed to query catalog products for WhatsApp auto reply",
          );
        }

        const reply = await generateWhatsAppAutoReply(
          input.connection.workspaceId,
          redactWhatsAppPrivateData(input.customerMessage),
          {
            language:
              latestConnection.autoReplyLanguage === "match_customer"
                ? "match_customer"
                : "ar",
            tone:
              latestConnection.autoReplyTone === "concise" ||
              latestConnection.autoReplyTone === "formal"
                ? latestConnection.autoReplyTone
                : "friendly_professional",
            instructions: latestConnection.autoReplyInstructions ?? "",
          },
          contextTurns.map((turn) => ({
            ...turn,
            text: redactWhatsAppPrivateData(turn.text),
          })),
          matchingProduct,
        );

        await deliverReply(reply);
      },
    });
    if (consentGate.status === "opted_out") {
      await stopWhatsAppAutoReplyEvent({
        claimId: input.claimId,
        workspaceId: input.connection.workspaceId,
        errorCode: "CUSTOMER_OPTED_OUT",
      });
    }
  } catch (error) {
    // A limit that lifts by itself is not a failure: an exhausted AI quota
    // resets next period and a missing provider key is fixed in minutes, while a
    // `failed` row is never claimed again, so the customer's message would lose
    // its reply permanently. The planner keeps such an event `queued`, pushes
    // `next_run_at` out and hands the attempt back; the age check above is what
    // bounds the loop, so a quota that never lifts ends with the conversation
    // handed to a human instead of an event queued forever.
    const plan = planAutoReplyFailure({
      errorCode: whatsAppAutoReplyErrorCode(
        error,
        error instanceof EvolutionApiError,
      ),
      retryable: retryMetaAutoReplyGeneration(error, input.attempts),
      attempts: input.attempts,
      sendStarted,
      quotaPauseMs: whatsAppAutoReplyQuotaPauseMs(),
    });
    const logContext = {
      workspaceId: input.connection.workspaceId,
      instanceName: input.instanceName,
      errorCode: plan.errorCode,
      outcome: plan.kind,
    };
    if (plan.kind === "quota_pause") {
      logger.warn(
        { ...logContext, nextRunAt: plan.nextRunAt.toISOString() },
        "WHATSAPP_AUTO_REPLY_PAUSED_FOR_LIMIT",
      );
    } else {
      logger.error(logContext, "WhatsApp automatic reply failed");
    }
    await db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: plan.status,
        errorCode: plan.errorCode,
        // The attempt was claimed but never spent on a generation, and the
        // column is capped at 3, so it is handed back rather than lost.
        attempts: plan.returnAttempt
          ? sql`GREATEST(${menaWhatsAppAutoReplyEvents.attempts} - 1, 0)`
          : undefined,
        nextRunAt: plan.nextRunAt ?? new Date(),
        leaseExpiresAt: null,
        completedAt: plan.completed ? new Date() : null,
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
          eq(
            menaWhatsAppAutoReplyEvents.workspaceId,
            input.connection.workspaceId,
          ),
        ),
      );
  }
}

async function claimNextWhatsAppAutoReplyEvent() {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(menaWhatsAppAutoReplyEvents)
      .where(
        or(
          and(
            eq(menaWhatsAppAutoReplyEvents.status, "queued"),
            lte(menaWhatsAppAutoReplyEvents.nextRunAt, now),
          ),
          and(
            eq(menaWhatsAppAutoReplyEvents.status, "processing"),
            lt(menaWhatsAppAutoReplyEvents.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(menaWhatsAppAutoReplyEvents.nextRunAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate || candidate.attempts >= 3) return null;
    const [claimed] = await transaction
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "processing",
        attempts: sql`${menaWhatsAppAutoReplyEvents.attempts} + 1`,
        leaseExpiresAt: new Date(now.getTime() + whatsappAutoReplyLeaseMs),
      })
      .where(eq(menaWhatsAppAutoReplyEvents.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function processWhatsAppAutoReplyQueue(limit = 5): Promise<number> {
  let processed = 0;
  for (let count = 0; count < limit; count += 1) {
    const event = await claimNextWhatsAppAutoReplyEvent();
    if (!event) break;
    const [[connection], [message]] = await Promise.all([
      db
        .select()
        .from(menaWhatsAppConnections)
        .where(
          and(
            eq(menaWhatsAppConnections.workspaceId, event.workspaceId),
            eq(menaWhatsAppConnections.instanceName, event.instanceName),
          ),
        )
        .limit(1),
      db
        .select()
        .from(menaWhatsAppDirectMessages)
        .where(
          and(
            eq(menaWhatsAppDirectMessages.workspaceId, event.workspaceId),
            eq(menaWhatsAppDirectMessages.instanceName, event.instanceName),
            eq(menaWhatsAppDirectMessages.providerMessageId, event.remoteMessageId),
            eq(menaWhatsAppDirectMessages.direction, "inbound"),
          ),
        )
        .limit(1),
    ]);
    if (!connection || !message) {
      await db
        .update(menaWhatsAppAutoReplyEvents)
        .set({
          status: "failed",
          errorCode: !connection
            ? "WHATSAPP_CONNECTION_NOT_FOUND"
            : "WHATSAPP_DIRECT_MESSAGE_NOT_FOUND",
          leaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(eq(menaWhatsAppAutoReplyEvents.id, event.id));
      processed += 1;
      continue;
    }
    const remoteJid = decryptWhatsAppDirectMessageValue(
      message.encryptedRemoteJid,
    );
    const customerMessage = decryptWhatsAppDirectMessageValue(
      message.encryptedTextBody,
    );
    await processWhatsAppAutoReplyAsync({
      claimId: event.id,
      attempts: event.attempts,
      connection,
      instanceName: event.instanceName,
      remoteJid,
      remoteJidHash: message.remoteJidHash,
      remoteMessageId: event.remoteMessageId,
      messageTimestamp: message.messageTimestamp,
      customerMessage,
    });
    processed += 1;
  }
  return processed;
}

/**
 * Ends a claimed auto-reply event without sending anything.
 *
 * Nothing reached the customer, so the event is closed so it cannot be
 * retried; `errorCode` explains why to the inbox.
 */
async function stopWhatsAppAutoReplyEvent(input: {
  claimId: string;
  workspaceId: string;
  errorCode: string;
}): Promise<void> {
  await db
    .update(menaWhatsAppAutoReplyEvents)
    .set({
      status: "failed",
      errorCode: input.errorCode,
      leaseExpiresAt: null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.id, input.claimId),
        eq(menaWhatsAppAutoReplyEvents.workspaceId, input.workspaceId),
      ),
    );
}

/**
 * True when a newer message in the same chat already has its own waiting
 * reply, so the reply being generated now would answer an older message.
 */
async function chatHasNewerWaitingWhatsAppAutoReply(input: {
  workspaceId: string;
  instanceName: string;
  remoteJidHash: string;
  claimId: string;
  messageTimestamp: Date;
}): Promise<boolean> {
  const [newer] = await db
    .select({ id: menaWhatsAppAutoReplyEvents.id })
    .from(menaWhatsAppAutoReplyEvents)
    .innerJoin(
      menaWhatsAppDirectMessages,
      and(
        eq(
          menaWhatsAppDirectMessages.workspaceId,
          menaWhatsAppAutoReplyEvents.workspaceId,
        ),
        eq(
          menaWhatsAppDirectMessages.instanceName,
          menaWhatsAppAutoReplyEvents.instanceName,
        ),
        eq(
          menaWhatsAppDirectMessages.providerMessageId,
          menaWhatsAppAutoReplyEvents.remoteMessageId,
        ),
        eq(menaWhatsAppDirectMessages.direction, "inbound"),
      ),
    )
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.workspaceId, input.workspaceId),
        eq(menaWhatsAppAutoReplyEvents.instanceName, input.instanceName),
        eq(menaWhatsAppDirectMessages.remoteJidHash, input.remoteJidHash),
        inArray(menaWhatsAppAutoReplyEvents.status, ["queued", "processing"]),
        gt(menaWhatsAppDirectMessages.messageTimestamp, input.messageTimestamp),
        ne(menaWhatsAppAutoReplyEvents.id, input.claimId),
      ),
    )
    .limit(1);
  return Boolean(newer);
}

/**
 * Automatic replies already sent to this chat during the last hour.
 *
 * Two automated systems greeting each other would otherwise answer forever and
 * spend the workspace AI quota on a conversation no customer ever reads.
 */
async function countRecentWhatsAppAutoReplies(input: {
  workspaceId: string;
  instanceName: string;
  remoteJidHash: string;
}): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(menaWhatsAppAutoReplyEvents)
    .innerJoin(
      menaWhatsAppDirectMessages,
      and(
        eq(
          menaWhatsAppDirectMessages.workspaceId,
          menaWhatsAppAutoReplyEvents.workspaceId,
        ),
        eq(
          menaWhatsAppDirectMessages.instanceName,
          menaWhatsAppAutoReplyEvents.instanceName,
        ),
        eq(
          menaWhatsAppDirectMessages.providerMessageId,
          menaWhatsAppAutoReplyEvents.remoteMessageId,
        ),
        eq(menaWhatsAppDirectMessages.direction, "inbound"),
      ),
    )
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.workspaceId, input.workspaceId),
        eq(menaWhatsAppAutoReplyEvents.instanceName, input.instanceName),
        eq(menaWhatsAppDirectMessages.remoteJidHash, input.remoteJidHash),
        eq(menaWhatsAppAutoReplyEvents.status, "sent"),
        gt(menaWhatsAppAutoReplyEvents.completedAt, since),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Keep one waiting reply per chat.
 *
 * Customers often send two or three short messages in a row. Queueing a reply
 * for every message produced several AI answers (and spent several AI
 * generations) for the same conversation, some of them already stale. When the
 * chat already has a reply that has not started yet, that reply is moved to the
 * newest message and its timer restarted instead of queueing a second one.
 *
 * Returns false when there was nothing to reuse, so the caller inserts a row.
 */
async function coalesceQueuedWhatsAppAutoReply(input: {
  workspaceId: string;
  instanceName: string;
  remoteJidHash: string;
  remoteMessageId: string;
  messageTimestamp: Date | null;
  nextRunAt: Date;
}): Promise<boolean> {
  const [pending] = await db
    .select({ id: menaWhatsAppAutoReplyEvents.id })
    .from(menaWhatsAppAutoReplyEvents)
    .innerJoin(
      menaWhatsAppDirectMessages,
      and(
        eq(
          menaWhatsAppDirectMessages.workspaceId,
          menaWhatsAppAutoReplyEvents.workspaceId,
        ),
        eq(
          menaWhatsAppDirectMessages.instanceName,
          menaWhatsAppAutoReplyEvents.instanceName,
        ),
        eq(
          menaWhatsAppDirectMessages.providerMessageId,
          menaWhatsAppAutoReplyEvents.remoteMessageId,
        ),
        eq(menaWhatsAppDirectMessages.direction, "inbound"),
      ),
    )
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.workspaceId, input.workspaceId),
        eq(menaWhatsAppAutoReplyEvents.instanceName, input.instanceName),
        eq(menaWhatsAppDirectMessages.remoteJidHash, input.remoteJidHash),
        eq(menaWhatsAppAutoReplyEvents.status, "queued"),
        gt(menaWhatsAppAutoReplyEvents.nextRunAt, new Date()),
        ...(input.messageTimestamp
          ? [
              lte(
                menaWhatsAppDirectMessages.messageTimestamp,
                input.messageTimestamp,
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(menaWhatsAppAutoReplyEvents.nextRunAt))
    .limit(1);
  if (!pending) return false;
  const updated = await db
    .update(menaWhatsAppAutoReplyEvents)
    .set({ remoteMessageId: input.remoteMessageId, nextRunAt: input.nextRunAt })
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.id, pending.id),
        eq(menaWhatsAppAutoReplyEvents.status, "queued"),
      ),
    )
    .returning({ id: menaWhatsAppAutoReplyEvents.id });
  return updated.length > 0;
}

/**
 * Logs one inbound outcome and keeps it in the delivery log.
 *
 * A log line disappears with the deployment; the merchant's question — "did
 * Evolution ever call us?" — needs the answer to still exist hours later. The
 * persisted contexts here carry event names, instance names and hashed
 * conversation keys only, never message text.
 *
 * Recording is fire-and-forget: `recordInboundWebhookAttempt` swallows its own
 * failures, so a broken delivery log can never turn a received message into a
 * failed webhook.
 */
function recordWhatsAppInboundOutcome(
  outcome: InboundWebhookOutcome,
  context: Record<string, unknown> = {},
): void {
  logInboundWebhookOutcome(logger, outcome, context);
  void recordInboundWebhookAttempt({
    platform: "whatsapp",
    event: outcome.event,
    deliveryConfirmed: outcome.deliveryConfirmed,
    workspaceId:
      typeof context.workspaceId === "string" ? context.workspaceId : null,
    instanceName:
      typeof context.instanceName === "string" ? context.instanceName : null,
    context,
  });
}

export async function processWebhookEvent(
  body: unknown,
  req: { headers?: Record<string, string | string[] | undefined> },
): Promise<void> {
  const payload = asRecord(body);
  if (!payload) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("PAYLOAD_NOT_OBJECT"),
    );
    return;
  }

  if (!verifyWhatsAppWebhookSecret(req.headers?.["x-evolution-api-key"])) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("REJECTED_SECRET"),
    );
    return;
  }

  const eventName = normalizeWhatsAppWebhookEventName(
    payload.event ?? payload.type,
  );
  if (!isWhatsAppMessageWebhookEvent(eventName)) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("IGNORED_EVENT"),
      { eventName },
    );
    return;
  }

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
  if (!remoteJid || !instanceName) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("MISSING_INSTANCE_OR_JID"),
      { eventName, hasInstance: Boolean(instanceName), hasJid: Boolean(remoteJid) },
    );
    return;
  }

  const matchingConnections = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.instanceName, instanceName))
    .limit(2);
  if (matchingConnections.length !== 1) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome(
        matchingConnections.length > 1 ? "AMBIGUOUS_INSTANCE" : "UNKNOWN_INSTANCE",
      ),
      { eventName, instanceName, matches: matchingConnections.length },
    );
    return;
  }
  const [connection] = matchingConnections;
  if (!connection) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("UNKNOWN_INSTANCE"),
      { eventName, instanceName, matches: 0 },
    );
    return;
  }
  // A stale or released session must not write into the workspace. Routing
  // stays instance-based; this only refuses connections that no longer hold
  // an active claim, without ever falling back to the phone number.
  if (!isActiveWhatsAppConnectionStatus(connection.status)) {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("INACTIVE_CONNECTION"),
      { eventName, instanceName, status: connection.status },
    );
    return;
  }

  const eventPayload = asRecord(payloadData ?? payload) ?? payload;
  const eventKey =
    asRecord(eventPayload?.key ?? payloadData?.key) ?? asRecord(payload.key);
  const eventMessage = asRecord(eventPayload?.message);
  const eventMessageKey = asRecord(eventMessage?.key);
  const eventRemoteJid =
    normalizeRemoteJid(eventKey?.remoteJid) ??
    normalizeRemoteJid(eventPayload?.remoteJid) ??
    remoteJid;
  const eventRemoteJidAlt =
    normalizeRemoteJid(eventKey?.remoteJidAlt) ??
    normalizeRemoteJid(eventPayload?.remoteJidAlt) ??
    normalizeRemoteJid(eventMessageKey?.remoteJidAlt) ??
    normalizeRemoteJid(eventMessage?.remoteJidAlt);
  const directRemoteJid = selectWhatsAppDirectJid(
    eventRemoteJid,
    eventRemoteJidAlt,
  );
  const isDirectIncoming =
    eventName === "MESSAGES_UPSERT" &&
    isDirectIncomingWhatsAppMessage({
      fromMe: eventKey?.fromMe ?? eventPayload?.fromMe,
      remoteJid: eventRemoteJid,
      remoteJidAlt: eventRemoteJidAlt,
    });
  const incomingMessageCandidate = isDirectIncoming
    ? (asRecord(eventPayload.message) ?? eventPayload)
    : null;
  const customerMessageText = incomingMessageCandidate
    ? extractWhatsAppTextFromMessage(incomingMessageCandidate)
    : null;
  const isDirectPhoneJid = isWhatsAppDirectPhoneJid(directRemoteJid);
  const optOutCustomerId =
    directRemoteJid && isDirectIncoming && isDirectPhoneJid
      ? whatsappDirectConversationKeys(
          connection.workspaceId,
          instanceName,
          directRemoteJid,
        )[0]!
      : null;
  const consentAction = optOutCustomerId
    ? whatsAppConsentActionForMessage(customerMessageText)
    : null;
  // Persist before any auto-reply decision is made. The original message is
  // still stored below; consent only removes the customer from automation.
  if (consentAction && optOutCustomerId) {
    await recordWhatsAppConsent({
      store: whatsAppOptOutStore,
      ownerId: connection.ownerId,
      workspaceId: connection.workspaceId,
      customerId: optOutCustomerId,
      action: consentAction,
    });
  }
  const storedOptOut = optOutCustomerId
    ? await isWhatsAppCustomerOptedOut({
        store: whatsAppOptOutStore,
        workspaceId: connection.workspaceId,
        customerId: optOutCustomerId,
      })
    : false;
  const customerOptedOut = storedOptOut || consentAction === "opt_out";
  const isConsentCommand = consentAction !== null;
  const isDirectConversationMessage =
    eventName === "MESSAGES_UPSERT" &&
    (isDirectIncoming ||
      (eventKey?.fromMe === true && Boolean(directRemoteJid)));
  const directMessageId =
    typeof eventKey?.id === "string"
      ? eventKey.id
      : typeof eventPayload.id === "string"
        ? eventPayload.id
        : null;
  let directConversationKey: string | null = null;
  let directMessageTimestamp: Date | null = null;
  if (
    isDirectConversationMessage &&
    directMessageId &&
    directRemoteJid
  ) {
    const direction = eventKey?.fromMe === true ? "outbound" : "inbound";
    const directMessage = eventMessage ?? eventPayload;
    // Only an inbound payload carries the customer's own pushName. Never let
    // an outbound/business name overwrite the stored contact name.
    const directSenderName = direction === "inbound"
      ? whatsappDirectSenderNameFromPayload(eventPayload, directMessage)
      : null;
    // A media-only DM has no conversation or caption. Store a typed Arabic
    // placeholder instead of an empty body so the Inbox thread shows that a
    // photo/voice note arrived. Nothing is downloaded or copied here: the body
    // stays encrypted at rest with the same workspace/instance key as before.
    const messageText =
      extractWhatsAppTextFromMessage(directMessage) ??
      whatsappDirectMessagePlaceholder(
        classifyWhatsAppDirectMessage(directMessage, null),
      );
    const messageTimestamp =
      [
        directMessage.messageTimestamp,
        directMessage.timestamp,
        eventPayload.messageTimestamp,
        eventPayload.timestamp,
        directMessage.t,
        eventPayload.t,
      ]
        .map(parseWhatsAppHistoryTimestamp)
        .find((timestamp): timestamp is Date => Boolean(timestamp)) ??
      new Date();
    directMessageTimestamp = messageTimestamp;
    const conversationKey = whatsappDirectConversationKeys(
      connection.workspaceId,
      instanceName,
      directRemoteJid,
    )[0]!;
    directConversationKey = conversationKey;
    const [savedDirectMessage] = await db
      .insert(menaWhatsAppDirectMessages)
      .values({
        id: randomUUID(),
        ownerId: connection.ownerId,
        workspaceId: connection.workspaceId,
        instanceName,
        remoteJidHash: conversationKey,
        encryptedRemoteJid: encryptWhatsAppDirectMessageValue(directRemoteJid),
        providerMessageId: directMessageId,
        senderName: directSenderName,
        direction,
        status: direction === "outbound" ? "sent" : "received",
        encryptedTextBody: encryptWhatsAppDirectMessageValue(
          normalizeWhatsAppDirectMessageText(messageText ?? ""),
        ),
        messageTimestamp,
        expiresAt: whatsappDirectMessageExpiry(messageTimestamp),
      })
      .onConflictDoNothing()
      .returning({
        id: menaWhatsAppDirectMessages.id,
        senderName: menaWhatsAppDirectMessages.senderName,
      });

    // A retried webhook finds the row created by the first delivery. Resolve it
    // by the same stable identity the unique index uses, then let the media
    // store apply its own on-conflict rule per attachment.
    const [directMessageRow] = savedDirectMessage
      ? [savedDirectMessage]
      : await db
          .select({
            id: menaWhatsAppDirectMessages.id,
            senderName: menaWhatsAppDirectMessages.senderName,
          })
          .from(menaWhatsAppDirectMessages)
          .where(
            and(
              eq(menaWhatsAppDirectMessages.workspaceId, connection.workspaceId),
              eq(menaWhatsAppDirectMessages.instanceName, instanceName),
              eq(menaWhatsAppDirectMessages.remoteJidHash, conversationKey),
              eq(menaWhatsAppDirectMessages.providerMessageId, directMessageId),
            ),
          )
          .limit(1);
    if (directMessageRow) {
      // A redelivered payload can carry a name the first delivery lacked. Only
      // this nullable display column changes — never the conversation key,
      // ownership, body, direction or provider message id.
      if (directSenderName && directMessageRow.senderName !== directSenderName) {
        await db
          .update(menaWhatsAppDirectMessages)
          .set({ senderName: directSenderName })
          .where(
            and(
              eq(menaWhatsAppDirectMessages.id, directMessageRow.id),
              eq(
                menaWhatsAppDirectMessages.workspaceId,
                connection.workspaceId,
              ),
              eq(menaWhatsAppDirectMessages.instanceName, instanceName),
            ),
          );
      }
      const directMediaMessageKey = {
        ...(eventKey ?? {}),
        id: directMessageId,
        remoteJid: eventRemoteJid ?? directRemoteJid,
        ...(eventRemoteJidAlt ? { remoteJidAlt: eventRemoteJidAlt } : {}),
      };
      try {
        await storeWhatsAppDirectMediaForMessage({
          ownerId: connection.ownerId,
          workspaceId: connection.workspaceId,
          instanceName,
          directMessageId: directMessageRow.id,
          providerMessageId: directMessageId,
          remoteJidHash: conversationKey,
          message: directMessage as Record<string, unknown>,
          messageKey: directMediaMessageKey,
          connection,
        });
      } catch (error) {
        // The text was saved successfully. Media is a best-effort enrichment,
        // and its failure is diagnosable from the pending/failed media row.
        logger.warn(
          { error, instanceName, providerMessageId: directMessageId },
          "WhatsApp direct media could not be queued",
        );
      }
    }
  }
  const remoteMessageId =
    typeof eventKey?.id === "string"
      ? eventKey.id
      : typeof eventPayload.id === "string"
        ? eventPayload.id
        : "";
  const autoReplyDecision = shouldQueueWhatsAppAutoReply({
    eventName,
    autoReplyEnabled: connection.autoReplyEnabled,
    customerOptedOut,
    isConsentCommand,
    messageTimestamp: directMessageTimestamp,
    isDirectIncoming,
    isPhoneJid: isDirectPhoneJid,
    hasMessageCandidate: Boolean(incomingMessageCandidate),
    customerMessageText: incomingMessageCandidate
      ? extractWhatsAppTextFromMessage(incomingMessageCandidate)
      : null,
    remoteMessageId,
  });
  if (!autoReplyDecision.shouldQueue && isDirectIncoming && isDirectPhoneJid) {
    // A real customer message that produced no reply is the one case an
    // operator must be able to find in the log, with the reason next to it.
    recordWhatsAppInboundOutcome(
      describeWhatsAppAutoReplySkip(autoReplyDecision.reason),
      {
        workspaceId: connection.workspaceId,
        instanceName,
        eventName,
        autoReplyEnabled: connection.autoReplyEnabled,
        conversationKey: directConversationKey,
      },
    );
  }
  if (eventName === "MESSAGES_UPSERT") {
    recordWhatsAppInboundOutcome(
      describeWhatsAppInboundOutcome("PROCESSED"),
      {
        workspaceId: connection.workspaceId,
        instanceName,
        eventName,
        directIncoming: isDirectIncoming,
        autoReplyQueued: autoReplyDecision.shouldQueue,
      },
    );
  }
  if (autoReplyDecision.shouldQueue) {
    const customerMessage = extractWhatsAppTextFromMessage(
      incomingMessageCandidate!,
    );
    if (customerMessage && remoteMessageId) {
      const nextRunAt = autoReplyNextRunAt();
      const coalesced =
        directConversationKey !== null &&
        (await coalesceQueuedWhatsAppAutoReply({
          workspaceId: connection.workspaceId,
          instanceName,
          remoteJidHash: directConversationKey,
          remoteMessageId,
          messageTimestamp: directMessageTimestamp,
          nextRunAt,
        }));
      if (!coalesced) {
        await db
          .insert(menaWhatsAppAutoReplyEvents)
          .values({
            id: randomUUID(),
            ownerId: connection.ownerId,
            workspaceId: connection.workspaceId,
            instanceName,
            remoteMessageId,
            status: "queued",
            nextRunAt,
          })
          .onConflictDoNothing();
      }
    }
  } else if (
    // A direct customer message that no automatic reply will answer, which is
    // exactly when the merchant has to be told: either automatic replies are
    // switched off for this connection, or this customer asked for a human.
    // Messages too old to answer are excluded — those arrive from a backlog
    // sync, where the customer is not waiting, and alerting on them turns one
    // reconnect into a wall of notifications.
    autoReplyDecision.notifyMerchant
  ) {
    // `directConversationKey` is an HMAC-SHA256 of workspace, instance and JID
    // keyed by ENCRYPTION_KEY, so it identifies the conversation for throttling
    // without revealing the phone number. Message text is deliberately not
    // included: WhatsApp bodies and JIDs are encrypted at rest in this schema,
    // and copying plaintext into an alert that travels through Expo's servers
    // would undo that. Meta inbox text is stored in plaintext, which is why the
    // Meta path does include a preview.
    await notifyCustomerMessage({
      workspaceId: connection.workspaceId,
      conversationId: directConversationKey,
    });
  }

  if (!connection.autoSyncEnabled) return;

  const groupJidCandidates = getWhatsAppWebhookGroupJidCandidates(
    eventRemoteJid,
    eventRemoteJidAlt,
    remoteJid,
  );
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
    logger.warn(
      {
        instanceName,
        ownerId: connection.ownerId,
        remoteJid,
        reason: persisted.reason,
      },
      "Ignored webhook event outside allowed group scope",
    );
    return;
  }
  if (persisted.messageId) {
    await enqueueWhatsAppMessage(connection.workspaceId, persisted.messageId);
  }
  for (const relatedMessageId of persisted.relatedMessageIds ?? []) {
    await enqueueWhatsAppMessage(connection.workspaceId, relatedMessageId);
  }
}
