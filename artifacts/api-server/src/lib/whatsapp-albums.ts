import { createHash } from "node:crypto";
import type { WhatsAppAlbumAssociation } from "./whatsapp-message-scope";

export type WhatsAppAlbumItem = {
  messageId: string;
  mediaGroupId: string | null;
  mediaGroupSource?: string | null;
  mediaType: string;
  caption: string | null;
  senderId: string | null;
  mediaGroupIndex?: number | null;
};

export function whatsappAlbumSettleMs(value: unknown): number {
  const parsed = Number(value);
  return Math.max(1_000, Math.min(30_000, Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000));
}

export function whatsappTextSettleMs(value: unknown): number {
  const parsed = Number(value);
  return Math.max(1_000, Math.min(30_000, Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000));
}

export function whatsappTextAlbumAssociationMs(value: unknown): number {
  const parsed = Number(value);
  return Math.max(0, Math.min(30_000, Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000));
}

export function whatsappTextNeedsAssociationWait(input: {
  hasMediaGroup: boolean;
  hasMedia: boolean;
  hasText: boolean;
  createdAt: Date;
  now: Date;
  settleMs: number;
}): boolean {
  return !input.hasMediaGroup &&
    !input.hasMedia &&
    input.hasText &&
    input.now.getTime() - input.createdAt.getTime() < input.settleMs;
}

export function whatsappStandaloneMediaNeedsAssociationWait(input: {
  hasKnownGroup: boolean;
  createdAt: Date;
  now: Date;
  settleMs: number;
  associationWindowMs: number;
}): boolean {
  const waitMs = input.settleMs + input.associationWindowMs * 2;
  return !input.hasKnownGroup &&
    input.associationWindowMs > 0 &&
    input.now.getTime() - input.createdAt.getTime() < waitMs;
}

export function whatsappAlbumMaxWaitMs(value: unknown): number {
  const parsed = Number(value);
  return Math.max(60_000, Math.min(24 * 60 * 60_000, Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60_000));
}

export function whatsappAlbumWaitExpired(input: {
  firstSeenAt: Date;
  now: Date;
  maxWaitMs: number;
}): boolean {
  return input.now.getTime() - input.firstSeenAt.getTime() >= input.maxWaitMs;
}

export function whatsappAlbumId(input: {
  ownerId: string;
  instanceName: string;
  groupJid: string;
  parentMessageId: string;
}): string {
  const sourceKey = JSON.stringify([
    input.ownerId,
    input.instanceName,
    input.groupJid,
    input.parentMessageId,
  ]);
  return `album:${createHash("sha256").update(sourceKey).digest("hex")}`;
}

export function resolveWhatsAppAlbumSource(input: {
  ownerId: string;
  instanceName: string;
  groupJid: string;
  remoteMessageId: string;
  mediaItemCount: number;
  mediaGroupMarker: string | null;
  advertisedMediaCount: number | null;
  isAlbumContainer: boolean;
  association: WhatsAppAlbumAssociation | null;
}): { mediaGroupId: string | null; mediaGroupExpectedCount: number | null; mediaGroupIndex: number | null } {
  const parentMessageId = input.association?.parentMessageId ??
    (input.isAlbumContainer && input.mediaItemCount === 0
      ? input.remoteMessageId
      : input.mediaGroupMarker);
  const hasGroupEvidence = Boolean(
    parentMessageId || input.mediaGroupMarker || input.association || input.isAlbumContainer,
  );
  const mediaGroupId = !hasGroupEvidence
    ? null
    : whatsappAlbumId({
        ownerId: input.ownerId,
        instanceName: input.instanceName,
        groupJid: input.groupJid,
        parentMessageId: parentMessageId ?? input.remoteMessageId,
      });
  return {
    mediaGroupId,
    mediaGroupExpectedCount: input.mediaItemCount > 1
      ? Math.max(input.mediaItemCount, input.advertisedMediaCount ?? 0)
      : input.advertisedMediaCount,
    mediaGroupIndex: input.association?.messageIndex ?? null,
  };
}

export function groupWhatsAppAlbumItems<T extends WhatsAppAlbumItem>(
  items: T[],
): Array<{ sourceId: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const confirmedAlbum =
      item.mediaGroupSource === "protocol_association" ||
      item.mediaGroupSource === "provider_album_container";
    const sourceId = item.mediaGroupId && confirmedAlbum
      ? item.mediaGroupId
      : `message:${item.messageId}`;
    const group = groups.get(sourceId) ?? [];
    group.push(item);
    groups.set(sourceId, group);
  }
  return [...groups].map(([sourceId, groupedItems]) => ({ sourceId, items: groupedItems }));
}

export function albumNeedsSettleWait(input: {
  expectedCount: number;
  actualCount: number;
  latestUpdate: Date;
  now: Date;
  settleMs: number;
}): boolean {
  if (input.expectedCount > 0) return input.actualCount < input.expectedCount;
  return input.now.getTime() - input.latestUpdate.getTime() < input.settleMs;
}
export function whatsappAlbumMediaReady(input: {
  expectedCount: number;
  storedCount: number;
  pendingOrFailedDownload: boolean;
}): boolean {
  return !input.pendingOrFailedDownload &&
    (input.expectedCount <= 0 || input.storedCount >= input.expectedCount);
}

export function whatsappAlbumCompletionState(input: {
  expectedCount: number;
  storedCount: number;
  isAlbum: boolean;
  hasAlbumContainer: boolean;
  hasMediaGroup: boolean;
  hasPendingDownload: boolean;
  hasMissingMessageMedia: boolean;
  hasTerminalDownloadFailure: boolean;
  firstSeenAt: Date;
  latestUpdate: Date;
  now: Date;
  settleMs: number;
  maxWaitMs: number;
  manualReview?: boolean;
}): {
  shouldWait: boolean;
  reviewRequired: boolean;
  incomplete: boolean;
  mediaReady: boolean;
} {
  const albumIncomplete = input.expectedCount > 0 && input.storedCount < input.expectedCount;
  const unknownAlbumCompletion = input.isAlbum && input.expectedCount === 0;
  const incomplete = albumIncomplete || input.hasAlbumContainer || unknownAlbumCompletion;
  const waitExpired = whatsappAlbumWaitExpired({
    firstSeenAt: input.firstSeenAt,
    now: input.now,
    maxWaitMs: input.maxWaitMs,
  });
  const shouldWait = input.hasPendingDownload ||
    (input.hasMissingMessageMedia && !input.hasTerminalDownloadFailure) ||
    (
      input.hasMediaGroup &&
      albumNeedsSettleWait({
        expectedCount: input.expectedCount,
        actualCount: input.storedCount,
        latestUpdate: input.latestUpdate,
        now: input.now,
        settleMs: input.settleMs,
      })
    ) ||
    (unknownAlbumCompletion && !waitExpired);
  const manualReview = input.manualReview === true && (incomplete || shouldWait);
  const timedOutReview = incomplete && waitExpired && !input.hasPendingDownload;
  const reviewRequired = manualReview || timedOutReview;
  return {
    shouldWait,
    reviewRequired,
    incomplete,
    mediaReady:
      !input.hasMissingMessageMedia &&
      !input.hasTerminalDownloadFailure &&
      !reviewRequired &&
      !albumIncomplete &&
      !unknownAlbumCompletion,
  };
}

export function whatsappAlbumProcessingLockKey(
  ownerId: string,
  mediaGroupId: string | null,
  messageId: string,
  parentMessageId: string | null = null,
): string {
  return `${ownerId}:${parentMessageId ?? mediaGroupId ?? messageId}`;
}

export function resolveWhatsAppContentGroupKey(input: {
  ownerId: string;
  messageId: string;
  mediaGroupId: string | null;
  remoteMessageId: string | null;
  sourceMessageId?: string | null;
}): string {
  return input.mediaGroupId ?? input.sourceMessageId ?? input.messageId ?? input.remoteMessageId ?? `${input.ownerId}:${input.messageId}`;
}

export function whatsappContentPostId(ownerId: string, contentGroupKey: string): string {
  return createHash("sha256").update(`${ownerId}:${contentGroupKey}`).digest("hex");
}

export function hasPreviouslyProcessedAlbumItems(
  sourceMessageId: string,
  groupMessageIds: readonly string[],
  postSourceMessageIds: readonly (string | null)[],
): boolean {
  const messageIds = new Set(groupMessageIds);
  return postSourceMessageIds.some(
    (postSourceMessageId) => postSourceMessageId !== sourceMessageId &&
      postSourceMessageId !== null &&
      messageIds.has(postSourceMessageId),
  );
}

export function whatsappMediaRetryDue(
  status: string,
  updatedAt: Date,
  now: Date,
  retryDelayMs = 30_000,
): boolean {
  return (status === "failed" || status === "pending") &&
    now.getTime() - updatedAt.getTime() >= retryDelayMs;
}
