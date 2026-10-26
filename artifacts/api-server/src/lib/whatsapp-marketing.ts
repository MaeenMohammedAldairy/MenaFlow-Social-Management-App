import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, lte, lt, notExists, or, sql } from "drizzle-orm";
import {
  db,
  menaContentJobs,
  menaMetaConnections,
  menaContentSettings,
  menaPostActivityEvents,
  menaWhatsAppConnections,
  menaWhatsAppGroups,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
} from "@workspace/db";
import {
  canAutoPublishMessage,
  canAnalyzeWhatsAppMessage,
  isBusinessAuthoredMessage,
  containsSensitivePersonalData,
} from "./whatsapp-marketing-safety";
import { publishPostToMeta } from "./meta-publishing";
import { connectedMetaChannels } from "./meta-channel-routing";
import { notifyPostsChanged } from "./post-events";
import { makePostActivityEvent } from "./post-activity";
import {
  hasPreviouslyProcessedAlbumItems,
  whatsappAlbumProcessingLockKey,
  whatsappAlbumSettleMs,
  whatsappAlbumMaxWaitMs,
  whatsappAlbumCompletionState,
  whatsappContentPostId,
  whatsappTextNeedsAssociationWait,
  whatsappStandaloneMediaNeedsAssociationWait,
  whatsappTextAlbumAssociationMs,
  whatsappTextSettleMs,
} from "./whatsapp-albums";
import { isConfirmedWhatsAppMediaGroupSource } from "./whatsapp-album-relations";
import { getWhatsAppContentBundle } from "./whatsapp-content-associations";
import { retryWhatsAppMediaDownload } from "./whatsapp-media-download";
import { extractWhatsAppAlbumAssociation } from "./whatsapp-message-scope";
import { saveDraft, safePublishResults } from "./whatsapp-marketing-drafts";

type ProcessOptions = {
  allowAutoPublish?: boolean;
  manualReview?: boolean;
};

function isRetryableContentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["AbortError", "TimeoutError", "TypeError"].includes(error.name)) return true;
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|57P01|40001|40P01|08[0-9A-Z]{3})$/.test(
    String((error as Error & { code?: unknown }).code ?? ""),
  )) return true;
  return /(?:_HTTP_(?:408|425|429|500|502|503|504)|^GEMINI_HTTP_(?:408|425|429|500|502|503|504)$)/.test(
    error.message,
  );
}

function settingsChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((channel): channel is string =>
    channel === "facebook" || channel === "instagram",
  ))];
}



async function processWhatsAppMessageUnlocked(
  workspaceId: string,
  messageId: string,
  options: ProcessOptions = {},
): Promise<{ outcome: "created" | "existing" | "skipped" | "deferred"; postId?: string; reason?: string; retryAt?: Date }> {
  const [message] = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      eq(menaWhatsAppMessages.id, messageId),
    ))
    .limit(1);
  if (!message || message.messageStatus === "deleted") return { outcome: "skipped", reason: "MESSAGE_NOT_AVAILABLE" };
  const ownerId = message.ownerId;
  if (message.messageType === "albumMediaUnresolved") {
    console.error("WhatsApp album media has no parent key and was withheld from individual publishing", {
      reason: "WHATSAPP_ALBUM_PARENT_KEY_MISSING_REQUIRES_REVIEW",
    });
    return { outcome: "skipped", reason: "WHATSAPP_ALBUM_PARENT_KEY_MISSING_REQUIRES_REVIEW" };
  }

  const textSettleMs = whatsappTextSettleMs(process.env.WHATSAPP_TEXT_SETTLE_MS);
  const associationWindowMs = whatsappTextAlbumAssociationMs(
    process.env.WHATSAPP_TEXT_ALBUM_ASSOCIATION_MS,
  );
  const textAssociationSettleMs = textSettleMs + associationWindowMs * 2;
  const contentBundle = message.groupId
    ? await getWhatsAppContentBundle(
        {
        workspaceId,
        instanceName: message.instanceName,
        groupId: message.groupId,
        },
        message.id,
      )
    : null;
  const hasConfirmedMediaGroup =
    isConfirmedWhatsAppMediaGroupSource(message.mediaGroupSource) &&
    Boolean(message.mediaGroupId);
  if (whatsappTextNeedsAssociationWait({
    hasMediaGroup: hasConfirmedMediaGroup || Boolean(contentBundle),
    hasMedia: message.mediaAvailable,
    hasText: Boolean(message.textBody?.trim() || message.caption?.trim()),
    createdAt: message.createdAt,
    now: new Date(),
    settleMs: textAssociationSettleMs,
  })) {
    return {
      outcome: "deferred",
      reason: "WHATSAPP_TEXT_WAITING_FOR_ALBUM_ASSOCIATION",
      retryAt: new Date(message.createdAt.getTime() + textAssociationSettleMs),
    };
  }
  if (message.mediaAvailable && whatsappStandaloneMediaNeedsAssociationWait({
    hasKnownGroup: hasConfirmedMediaGroup || Boolean(contentBundle),
    createdAt: message.createdAt,
    now: new Date(),
    settleMs: whatsappAlbumSettleMs(process.env.WHATSAPP_ALBUM_SETTLE_MS),
    associationWindowMs,
  })) {
    const retryAt = new Date(
      message.createdAt.getTime() +
      whatsappAlbumSettleMs(process.env.WHATSAPP_ALBUM_SETTLE_MS) +
      associationWindowMs * 2,
    );
    return {
      outcome: "deferred",
      reason: "WHATSAPP_MEDIA_WAITING_FOR_ALBUM_ASSOCIATION",
      retryAt,
    };
  }

  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(and(
      eq(menaWhatsAppConnections.workspaceId, workspaceId),
      eq(menaWhatsAppConnections.instanceName, message.instanceName),
    ))
    .limit(1);
  if (!connection) return { outcome: "skipped", reason: "WHATSAPP_CONNECTION_NOT_FOUND" };
  if (!message.groupId) {
    return { outcome: "skipped", reason: "WHATSAPP_GROUP_IDENTITY_REQUIRED" };
  }
  const [selection] = await db
    .select({
      id: menaWhatsAppGroupSelections.id,
      groupName: menaWhatsAppGroupSelections.groupName,
    })
    .from(menaWhatsAppGroupSelections)
    .innerJoin(
      menaWhatsAppGroups,
      and(
        eq(menaWhatsAppGroups.workspaceId, workspaceId),
        eq(menaWhatsAppGroups.instanceName, message.instanceName),
        eq(menaWhatsAppGroups.id, message.groupId),
      ),
    )
    .where(
      and(
        eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
        eq(menaWhatsAppGroupSelections.instanceName, message.instanceName),
        or(
          eq(menaWhatsAppGroupSelections.groupId, message.groupId),
          eq(
            menaWhatsAppGroupSelections.groupId,
            menaWhatsAppGroups.parentGroupId,
          ),
        ),
        eq(menaWhatsAppGroupSelections.selected, true),
      ),
    )
    .limit(1);
  if (!canAnalyzeWhatsAppMessage({
    isGroup: message.groupJid.endsWith("@g.us"),
    groupSelected: Boolean(selection),
    messageAvailable: message.messageStatus !== "deleted",
  })) {
    return { outcome: "skipped", reason: "GROUP_NOT_APPROVED" };
  }

  const bundleMessageIds = contentBundle?.messageIds ?? [message.id];
  const bundleRows = bundleMessageIds.length === 1 && bundleMessageIds[0] === message.id
    ? [message]
    : await db
        .select()
        .from(menaWhatsAppMessages)
        .where(and(
          eq(menaWhatsAppMessages.workspaceId, workspaceId),
          eq(menaWhatsAppMessages.instanceName, message.instanceName),
          eq(menaWhatsAppMessages.groupId, message.groupId),
          inArray(menaWhatsAppMessages.id, bundleMessageIds),
          eq(menaWhatsAppMessages.messageStatus, "received"),
        ));
  const confirmedAlbumIds = [...new Set(bundleRows
    .filter((item) =>
      item.mediaGroupId &&
      isConfirmedWhatsAppMediaGroupSource(item.mediaGroupSource),
    )
    .map((item) => item.mediaGroupId!))];
  let groupMessages = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      eq(menaWhatsAppMessages.instanceName, message.instanceName),
      eq(menaWhatsAppMessages.groupId, message.groupId),
      eq(menaWhatsAppMessages.messageStatus, "received"),
      or(
        inArray(menaWhatsAppMessages.id, bundleMessageIds),
        ...(confirmedAlbumIds.length > 0
          ? [and(
              inArray(menaWhatsAppMessages.mediaGroupId, confirmedAlbumIds),
              inArray(menaWhatsAppMessages.mediaGroupSource, [
                "protocol_association",
                "provider_album_container",
              ]),
            )]
          : []),
      ),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp), asc(menaWhatsAppMessages.createdAt));
  for (const groupMessage of groupMessages) {
    if (groupMessage.mediaDownloadStatus === "failed" || groupMessage.mediaDownloadStatus === "pending") {
      await retryWhatsAppMediaDownload(groupMessage);
    }
  }
  if (contentBundle || confirmedAlbumIds.length > 0) {
    groupMessages = await db
      .select()
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, workspaceId),
        eq(menaWhatsAppMessages.instanceName, message.instanceName),
        eq(menaWhatsAppMessages.groupId, message.groupId),
        eq(menaWhatsAppMessages.messageStatus, "received"),
        or(
          inArray(menaWhatsAppMessages.id, bundleMessageIds),
          ...(confirmedAlbumIds.length > 0
            ? [and(
                inArray(menaWhatsAppMessages.mediaGroupId, confirmedAlbumIds),
                inArray(menaWhatsAppMessages.mediaGroupSource, [
                  "protocol_association",
                  "provider_album_container",
                ]),
              )]
            : []),
        ),
      ))
      .orderBy(
        asc(menaWhatsAppMessages.messageTimestamp),
        asc(menaWhatsAppMessages.createdAt),
      );
  }
  groupMessages.sort((left, right) => {
    const leftIndex = left.mediaGroupIndex;
    const rightIndex = right.mediaGroupIndex;
    if (leftIndex !== null && rightIndex !== null && leftIndex !== rightIndex) return leftIndex - rightIndex;
    if (leftIndex !== null && rightIndex === null) return -1;
    if (leftIndex === null && rightIndex !== null) return 1;
    return (left.messageTimestamp?.getTime() ?? 0) - (right.messageTimestamp?.getTime() ?? 0);
  });
  const sourceMessage = groupMessages[0] ?? message;
  const confirmedMediaGroupId = groupMessages.find((item) =>
    item.mediaGroupId &&
    isConfirmedWhatsAppMediaGroupSource(item.mediaGroupSource),
  )?.mediaGroupId ?? null;
  const albumSourceMessageId =
    contentBundle?.id ?? confirmedMediaGroupId ?? sourceMessage.id;
  const contentGroupKey = albumSourceMessageId;
  const existingPostConditions = [
    eq(posts.sourceMessageId, albumSourceMessageId),
    eq(posts.id, whatsappContentPostId(ownerId, contentGroupKey)),
    ...(contentBundle || confirmedMediaGroupId
      ? groupMessages.map((item) =>
          sql`${posts.metadata} @> ${JSON.stringify({ sourceRemoteMessageIds: [item.remoteMessageId] })}::jsonb`,
        )
      : []),
  ];
  const [existingPost] = await db
    .select()
    .from(posts)
    .where(and(
      eq(posts.workspaceId, workspaceId),
      eq(posts.sourceType, "whatsapp"),
      or(...existingPostConditions),
    ))
    .limit(1);
  const sourceMessageId = existingPost?.sourceMessageId ?? albumSourceMessageId;

  const messageIds = [...new Set(groupMessages.map((item) => item.id))];
  const mediaRows = messageIds.length > 0
    ? await db
        .select()
        .from(menaWhatsAppMessageMedia)
        .where(and(
          eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
          inArray(menaWhatsAppMessageMedia.messageId, messageIds),
        ))
    : [];
  const messageOrder = new Map(groupMessages.map((item, index) => [item.id, index]));
  mediaRows.sort((left, right) => {
    return (messageOrder.get(left.messageId) ?? Number.MAX_SAFE_INTEGER) -
      (messageOrder.get(right.messageId) ?? Number.MAX_SAFE_INTEGER) ||
      left.mediaIndex - right.mediaIndex;
  });
  const readyMedia = mediaRows.filter((item) => item.downloadStatus === "stored");
  const expectedCount = Math.max(
    0,
    ...groupMessages.map((item) =>
      isConfirmedWhatsAppMediaGroupSource(item.mediaGroupSource)
        ? item.mediaGroupExpectedCount ?? 0
        : 0,
    ),
  );
  const isAlbumGroup = groupMessages.some((item) =>
    item.mediaGroupId &&
    isConfirmedWhatsAppMediaGroupSource(item.mediaGroupSource),
  );
  const settleMs = whatsappAlbumSettleMs(process.env.WHATSAPP_ALBUM_SETTLE_MS);
  const latestReceivedAt = Math.max(...groupMessages.map((item) => item.updatedAt.getTime()));
  const firstReceivedAt = Math.min(...groupMessages.map((item) => item.createdAt.getTime()));
  const missingMessageMedia = groupMessages.some((item) =>
    item.mediaAvailable && !readyMedia.some((media) => media.messageId === item.id),
  );
  const hasPendingDownload = mediaRows.some((item) => item.downloadStatus === "pending") ||
    groupMessages.some((item) => item.mediaDownloadStatus === "pending");
  const hasTerminalDownloadFailure = mediaRows.some((item) => item.downloadStatus === "failed") ||
    groupMessages.some((item) => item.mediaDownloadStatus === "failed");
  const unresolvedAlbumContainer = readyMedia.length === 0 &&
    groupMessages.some((item) =>
      item.mediaGroupSource === "provider_album_container" &&
      item.messageType.toLowerCase().includes("album"),
    );
  const completion = whatsappAlbumCompletionState({
    expectedCount,
    storedCount: readyMedia.length,
    isAlbum: isAlbumGroup,
    hasAlbumContainer: unresolvedAlbumContainer,
    hasMediaGroup: isAlbumGroup || Boolean(contentBundle),
    hasPendingDownload,
    hasMissingMessageMedia: missingMessageMedia,
    hasTerminalDownloadFailure,
    firstSeenAt: new Date(firstReceivedAt),
    latestUpdate: new Date(latestReceivedAt),
    now: new Date(),
    settleMs,
    maxWaitMs: whatsappAlbumMaxWaitMs(process.env.WHATSAPP_ALBUM_MAX_WAIT_MS),
    manualReview: options.manualReview,
  });
  const shouldWaitForAlbum = completion.shouldWait;
  const incompleteReview = completion.reviewRequired;
  const manualIncompleteReview = options.manualReview === true && incompleteReview;
  const timedOutIncompleteReview = incompleteReview && !manualIncompleteReview;
  if (shouldWaitForAlbum && !incompleteReview) {
    const retryAt = new Date(Date.now() + (hasPendingDownload ? 30_000 : settleMs));
    console.info("WhatsApp album is waiting for all expected media", {
      sourceMessageId,
      expectedCount,
      storedCount: readyMedia.length,
      mediaDownloadPending: hasPendingDownload,
      retryAt: retryAt.toISOString(),
    });
    return {
      outcome: "deferred",
      reason: hasPendingDownload
        ? "WHATSAPP_MEDIA_DOWNLOAD_RETRY_PENDING"
        : "WHATSAPP_ALBUM_WAITING_FOR_MEDIA",
      retryAt,
    };
  }
  if (timedOutIncompleteReview) {
    console.error("WhatsApp album completion timed out and was sent for manual review", {
      sourceMessageId,
      expectedCount,
      storedCount: readyMedia.length,
      firstSeenAt: new Date(firstReceivedAt).toISOString(),
      reason: "WHATSAPP_ALBUM_COMPLETION_UNCONFIRMED_REQUIRES_REVIEW",
    });
  } else if (manualIncompleteReview) {
    console.info("WhatsApp incomplete album was explicitly sent for manual review", {
      sourceMessageId,
      expectedCount,
      storedCount: readyMedia.length,
      reason: "WHATSAPP_ALBUM_MANUAL_REVIEW_INCOMPLETE",
    });
  }
  if (unresolvedAlbumContainer && !incompleteReview) {
    return {
      outcome: "deferred",
      reason: "WHATSAPP_ALBUM_CONTAINER_WAITING_FOR_MEDIA",
      retryAt: new Date(Date.now() + settleMs),
    };
  }

  if (groupMessages.filter((item) => item.mediaAvailable).length > 1) {
    const groupMessageIds = groupMessages.map((item) => item.id);
    const existingIndividualPosts = await db
      .select({ sourceMessageId: posts.sourceMessageId })
      .from(posts)
      .where(and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.sourceType, "whatsapp"),
        inArray(posts.sourceMessageId, groupMessageIds),
      ));
    const hasPreviouslyProcessedItems = hasPreviouslyProcessedAlbumItems(
      sourceMessageId,
      groupMessageIds,
      existingIndividualPosts.map((post) => post.sourceMessageId),
    );
    if (hasPreviouslyProcessedItems && !existingPost) {
      console.warn("WhatsApp album has prior individual posts; automatic reprocessing was blocked", {
        sourceMessageId,
        existingPostCount: existingIndividualPosts.length,
      });
      return {
        outcome: "skipped",
        reason: "WHATSAPP_ALBUM_HAS_EXISTING_POSTS_REQUIRES_MANUAL_REVIEW",
      };
    }
  }

  const [settings] = await db
    .select()
    .from(menaContentSettings)
    .where(eq(menaContentSettings.workspaceId, workspaceId))
    .limit(1);
  const configuredChannels = settingsChannels(settings?.autoPublishChannels);

  const text = [...new Set(groupMessages.flatMap((item) =>
    [item.textBody, item.caption].filter((value): value is string => Boolean(value?.trim())),
  ))].join("\n");
  const mediaReady = groupMessages.every((item) =>
    !item.mediaAvailable || readyMedia.some((media) => media.messageId === item.id),
  ) && completion.mediaReady;
  const safeText = containsSensitivePersonalData(text) ? null : text || null;
  const mediaUrls = readyMedia.map((media) => media.id);
  const hasVideo = readyMedia.some((media) => media.mediaType === "video");
  const reason = "WHATSAPP_ORIGINAL_CONTENT_REQUIRES_REVIEW";
  const draft = {
    eligible: false,
    title: "",
    facebook: text,
    instagram: text,
    reason,
  };
  const model: string | null = null;

  const saved = await saveDraft(
    ownerId,
    sourceMessage,
    sourceMessageId,
    draft,
    reason,
    model,
    mediaUrls,
    groupMessages.map((item) => item.remoteMessageId),
    safeText,
    readyMedia.map((media, mediaIndex) => ({
      id: media.id,
      messageId: media.messageId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      mediaIndex: media.mediaIndex,
      messageOrder: messageOrder.get(media.messageId) ?? mediaIndex,
      messageTimestamp: groupMessages
        .find((message) => message.id === media.messageId)
        ?.messageTimestamp?.toISOString() ?? null,
    })),
    selection.groupName,
    contentBundle?.id ?? null,
  );
  if (saved.post && saved.post.sourceMessageId !== sourceMessageId) {
    const consistentId = whatsappContentPostId(ownerId, sourceMessageId);
    if (saved.post.id !== consistentId) {
      await db
        .update(posts)
        .set({
          id: consistentId,
          sourceMessageId,
          sourceGroupJid: sourceMessage.groupJid,
          sourceMessageDate: sourceMessage.messageTimestamp,
          sourceText: safeText,
          updatedAt: new Date(),
        })
        .where(and(
          eq(posts.workspaceId, workspaceId),
          eq(posts.id, saved.post.id),
        ));
    }
  }
  if (!saved.created) return { outcome: "existing", postId: saved.post.id };

  const [metaConnection] = await db
    .select({
      pageId: menaMetaConnections.pageId,
      instagramUserId: menaMetaConnections.instagramUserId,
    })
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (
    metaConnection?.pageId &&
    Array.isArray(saved.post.channels) &&
    saved.post.channels.includes("facebook")
  ) {
    const events = [
      makePostActivityEvent({
        ownerId,
        workspaceId: saved.post.workspaceId,
        postId: saved.post.id,
        accountId: metaConnection.pageId,
        channel: "facebook",
        eventType: "post_created",
        actorId: ownerId,
        details: { title: saved.post.title },
      }),
      ...(saved.post.status === "review"
        ? [
            makePostActivityEvent({
              ownerId,
              workspaceId: saved.post.workspaceId,
              postId: saved.post.id,
              accountId: metaConnection.pageId,
              channel: "facebook",
              eventType: "post_submitted_for_review",
              actorId: ownerId,
              details: { title: saved.post.title },
            }),
          ]
        : []),
    ];
    await db.insert(menaPostActivityEvents).values(events);
  }
  const channels = connectedMetaChannels(configuredChannels, metaConnection);
  const businessAuthored = isBusinessAuthoredMessage(message.senderId, connection.phoneNumber);
  const contentEligible = canAutoPublishMessage({
    isGroup: message.groupJid.endsWith("@g.us"),
    businessAuthored,
    text,
    mediaReady,
    hasUnsupportedVideo: hasVideo,
  });
  const enabledForMessage = Boolean(
    settings?.enabledAt &&
    message.messageTimestamp &&
    message.messageTimestamp >= settings.enabledAt,
  );
  const selectedChannelsConnected =
    channels.length > 0 && channels.length === configuredChannels.length;
  const autoEligible =
    options.allowAutoPublish === true &&
    contentEligible &&
    settings?.autoPublishEnabled === true &&
    enabledForMessage &&
    !reason &&
    draft.eligible === true &&
    selectedChannelsConnected &&
    mediaReady;
  if (!autoEligible) {
    const autoPublishReason = reason ||
      (options.allowAutoPublish !== true
        ? "AUTO_PUBLISH_NOT_ALLOWED"
        : settings?.autoPublishEnabled !== true
          ? "AUTO_PUBLISH_DISABLED"
          : !enabledForMessage
            ? "MESSAGE_PRECEDES_AUTO_PUBLISH_ENABLEMENT"
            : !businessAuthored
              ? "MESSAGE_NOT_SENT_BY_BUSINESS"
              : !contentEligible
                ? "MESSAGE_NOT_ELIGIBLE_FOR_AUTO_PUBLISH"
                : !selectedChannelsConnected
                  ? "AUTO_PUBLISH_CHANNEL_NOT_CONNECTED"
                  : "AUTO_PUBLISH_CHANNELS_NOT_SELECTED");
    return { outcome: "created", postId: saved.post.id, reason: autoPublishReason };
  }

  const [locked] = await db
    .update(posts)
    .set({
      status: "publishing",
      channels,
      autoPublish: true,
      autoPublishChannels: channels,
      updatedAt: new Date(),
    })
    .where(and(
      eq(posts.id, saved.post.id),
      eq(posts.workspaceId, workspaceId),
      eq(posts.status, "review"),
    ))
    .returning();
  if (!locked) return { outcome: "existing", postId: saved.post.id, reason: "PUBLISH_ALREADY_CLAIMED" };

  let completed: Record<string, { status: string; reason?: string }>;
  const persistedResults = safePublishResults(locked.publishResults);
  try {
    completed = await publishPostToMeta(
      { ...locked, body: draft.facebook || "", metadata: { ...locked.metadata, instagramBody: draft.instagram || "" } },
      channels,
      async (channel, result) => {
        persistedResults[channel] = result;
        await db
          .update(posts)
          .set({ publishResults: { ...persistedResults }, updatedAt: new Date() })
          .where(and(
            eq(posts.id, locked.id),
            eq(posts.workspaceId, workspaceId),
          ));
      },
      workspaceId,
      false,
      true,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "META_PUBLISH_FAILED";
    await db
      .update(posts)
      .set({ status: "failed", error: reason, updatedAt: new Date() })
      .where(and(
        eq(posts.id, locked.id),
        eq(posts.workspaceId, workspaceId),
      ));
    notifyPostsChanged(ownerId);
    return { outcome: "created", postId: locked.id, reason };
  }
  const allPublished = channels.every((channel) => completed[channel]?.status === "published");
  await db
    .update(posts)
    .set({
      status: allPublished ? "published" : "failed",
      publishResults: completed,
      error: allPublished ? null : "AUTO_PUBLISH_INCOMPLETE",
      updatedAt: new Date(),
    })
    .where(and(
      eq(posts.id, locked.id),
      eq(posts.workspaceId, workspaceId),
    ));
  notifyPostsChanged(ownerId);
  return {
    outcome: "created",
    postId: locked.id,
    reason: allPublished ? undefined : "AUTO_PUBLISH_INCOMPLETE",
  };
}

export async function processWhatsAppMessage(
  workspaceId: string,
  messageId: string,
  options: ProcessOptions = {},
): Promise<{ outcome: "created" | "existing" | "skipped" | "deferred"; postId?: string; reason?: string; retryAt?: Date }> {
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  const [message] = await db
    .select({
      id: menaWhatsAppMessages.id,
      ownerId: menaWhatsAppMessages.ownerId,
      instanceName: menaWhatsAppMessages.instanceName,
      groupId: menaWhatsAppMessages.groupId,
      mediaGroupId: menaWhatsAppMessages.mediaGroupId,
      mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
      messageType: menaWhatsAppMessages.messageType,
      remoteMessageId: menaWhatsAppMessages.remoteMessageId,
      sourceMediaPayload: menaWhatsAppMessages.sourceMediaPayload,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      eq(menaWhatsAppMessages.id, messageId),
    ))
    .limit(1);
  if (!message) return processWhatsAppMessageUnlocked(workspaceId, messageId, options);

  const contentBundle = message.groupId
    ? await getWhatsAppContentBundle({
        workspaceId,
        instanceName: message.instanceName,
        groupId: message.groupId,
      }, message.id)
    : null;
  const confirmedMediaGroupId = isConfirmedWhatsAppMediaGroupSource(
    message.mediaGroupSource,
  ) ? message.mediaGroupId : null;
  const parentMessageId = message.mediaGroupSource === "protocol_association"
    ? extractWhatsAppAlbumAssociation(message.sourceMediaPayload)?.parentMessageId
    : message.mediaGroupSource === "provider_album_container" &&
        message.messageType.toLowerCase().includes("album")
      ? message.remoteMessageId
      : null;
  const lockKey = whatsappAlbumProcessingLockKey(
    message.ownerId,
    contentBundle?.id ?? confirmedMediaGroupId,
    message.remoteMessageId,
    parentMessageId,
  );
  return withMessageLock(lockKey, () =>
    processWhatsAppMessageUnlocked(workspaceId, messageId, options),
  );
}

const inFlightMessageLocks = new Map<string, Promise<void>>();

async function withMessageLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  while (inFlightMessageLocks.has(lockKey)) {
    try {
      await inFlightMessageLocks.get(lockKey);
    } catch {
      // ignore
    }
  }

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  inFlightMessageLocks.set(lockKey, lockPromise);

  try {
    return await fn();
  } finally {
    inFlightMessageLocks.delete(lockKey);
    releaseLock();
  }
}

export async function processWhatsAppBacklog(
  workspaceId: string,
  limit: number,
): Promise<{ scanned: number; created: number; existing: number; skipped: number; deferred: number }> {
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  const messages = await db
    .select({ id: menaWhatsAppMessages.id })
    .from(menaWhatsAppMessages)
    .innerJoin(
      menaWhatsAppGroups,
      and(
        eq(menaWhatsAppGroups.id, menaWhatsAppMessages.groupId),
        eq(menaWhatsAppGroups.workspaceId, workspaceId),
        eq(menaWhatsAppGroups.instanceName, menaWhatsAppMessages.instanceName),
      ),
    )
    .innerJoin(
      menaWhatsAppGroupSelections,
      and(
        eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
        eq(menaWhatsAppGroupSelections.instanceName, menaWhatsAppMessages.instanceName),
        or(
          eq(menaWhatsAppGroupSelections.groupId, menaWhatsAppMessages.groupId),
          eq(menaWhatsAppGroupSelections.groupId, menaWhatsAppGroups.parentGroupId),
        ),
        eq(menaWhatsAppGroupSelections.selected, true),
      ),
    )
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      eq(menaWhatsAppMessages.messageStatus, "received"),
      notExists(
        db
          .select({ id: posts.id })
          .from(posts)
          .where(and(
            eq(posts.workspaceId, menaWhatsAppMessages.workspaceId),
            eq(posts.sourceType, "whatsapp"),
            or(
              eq(posts.sourceMessageId, menaWhatsAppMessages.id),
              and(
                isNotNull(menaWhatsAppMessages.mediaGroupId),
                inArray(menaWhatsAppMessages.mediaGroupSource, [
                  "protocol_association",
                  "provider_album_container",
                ]),
                eq(posts.sourceMessageId, menaWhatsAppMessages.mediaGroupId),
              ),
            ),
          )),
      ),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
    .limit(limit);
  const results = { scanned: messages.length, created: 0, existing: 0, skipped: 0, deferred: 0 };
  for (const message of messages) {
    const result = await processWhatsAppMessage(workspaceId, message.id, {
      allowAutoPublish: false,
    });
    results[result.outcome] += 1;
  }
  return results;
}

export async function enqueueWhatsAppMessage(workspaceId: string, messageId: string): Promise<void> {
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  const [message] = await db
    .select({
      workspaceId: menaWhatsAppMessages.workspaceId,
      instanceName: menaWhatsAppMessages.instanceName,
      ownerId: menaWhatsAppMessages.ownerId,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      eq(menaWhatsAppMessages.id, messageId),
    ))
    .limit(1);
  if (!message) throw new Error("WHATSAPP_MESSAGE_NOT_FOUND");
  const [connection] = await db
    .select({ instanceName: menaWhatsAppConnections.instanceName })
    .from(menaWhatsAppConnections)
    .where(and(
      eq(menaWhatsAppConnections.workspaceId, workspaceId),
      eq(menaWhatsAppConnections.instanceName, message.instanceName),
    ))
    .limit(1);
  if (!connection) throw new Error("WHATSAPP_CONNECTION_NOT_FOUND");
  const id = createHash("sha256").update(`${workspaceId}:${messageId}`).digest("hex");
  const now = new Date();
  await db
    .insert(menaContentJobs)
    .values({
      id,
      ownerId: message.ownerId,
      workspaceId,
      messageId,
      status: "pending",
      attempts: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: menaContentJobs.id,
      setWhere: eq(menaContentJobs.workspaceId, workspaceId),
      set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        nextRunAt: now,
        updatedAt: now,
      },
    });
}

let queueWorkerRunning = false;

export async function processWhatsAppMarketingQueue(): Promise<void> {
  if (queueWorkerRunning) return;
  queueWorkerRunning = true;
  try {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    await db
      .update(menaContentJobs)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(
        eq(menaContentJobs.status, "processing"),
        lt(menaContentJobs.updatedAt, staleBefore),
      ));

    const claimed = await db.transaction(async (transaction) => {
      const batch = await transaction
        .select()
        .from(menaContentJobs)
        .where(and(
          eq(menaContentJobs.status, "pending"),
          lte(menaContentJobs.nextRunAt, new Date()),
        ))
        .orderBy(asc(menaContentJobs.createdAt))
        .limit(5)
        .for("update", { skipLocked: true });
      if (batch.length === 0) return [];
      const ids = batch.map((job) => job.id);
      return transaction
        .update(menaContentJobs)
        .set({
          status: "processing",
          attempts: sql`${menaContentJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(inArray(menaContentJobs.id, ids))
        .returning();
    });

    for (const job of claimed) {
      try {
        const result = await processWhatsAppMessage(
          job.workspaceId,
          job.messageId,
          { allowAutoPublish: true },
        );
        await db
          .update(menaContentJobs)
          .set({
            status: result.outcome === "deferred"
              ? "pending"
              : result.outcome === "skipped"
                ? "skipped"
                : "done",
            lastError: result.reason ?? null,
            nextRunAt: result.retryAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(menaContentJobs.id, job.id),
            eq(menaContentJobs.workspaceId, job.workspaceId),
          ));
        console.info("WhatsApp content job completed", {
          jobId: job.id,
          messageId: job.messageId,
          outcome: result.outcome,
          postId: result.postId ?? null,
          reason: result.reason ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "WHATSAPP_CONTENT_PROCESSING_FAILED";
        const retry = job.attempts < 3 && isRetryableContentError(error);
        await db
          .update(menaContentJobs)
          .set({
            status: retry ? "pending" : "failed",
            lastError: message,
            nextRunAt: new Date(Date.now() + (retry ? job.attempts * 30_000 : 0)),
            updatedAt: new Date(),
          })
          .where(and(
            eq(menaContentJobs.id, job.id),
            eq(menaContentJobs.workspaceId, job.workspaceId),
          ));
        console.error("WhatsApp content job failed", {
          jobId: job.id,
          messageId: job.messageId,
          attempt: job.attempts,
          retry,
          reason: message,
        });
      }
    }
  } finally {
    queueWorkerRunning = false;
  }
}
