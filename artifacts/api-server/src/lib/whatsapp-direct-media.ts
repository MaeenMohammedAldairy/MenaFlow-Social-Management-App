/**
 * whatsapp-direct-media.ts
 *
 * Pure rules for one-to-one WhatsApp attachments. The group pipeline already
 * knows how to extract, download, store and sign media; this module contains
 * only the direct-conversation-specific parts: sanitising the provider payload,
 * building a stable media row, and describing a failed download in the inbox.
 *
 * Nothing here touches the database, Evolution, or the filesystem, which keeps
 * the idempotency and placeholder rules testable without infrastructure.
 */

import { asRecord } from "./value-utils.ts";
import type { WhatsAppMediaDetails } from "./whatsapp-message-scope.ts";

export type WhatsAppDirectMediaType =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "album"
  | "unknown";

export const WHATSAPP_DIRECT_MEDIA_STATUSES = [
  "pending",
  "stored",
  "failed",
] as const;

export type WhatsAppDirectMediaStatus =
  (typeof WHATSAPP_DIRECT_MEDIA_STATUSES)[number];

/** Inline base64 belongs in storage, not in a diagnostics row in PostgreSQL. */
export function stripInlineMediaData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInlineMediaData);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !["base64", "data", "buffer"].includes(key.toLowerCase()))
      .map(([key, nested]) => [key, stripInlineMediaData(nested)]),
  );
}

export function normalizeWhatsAppDirectMediaType(
  value: unknown,
): WhatsAppDirectMediaType {
  if (typeof value !== "string") return "unknown";
  const type = value.trim().toLowerCase();
  return (
    ["image", "video", "audio", "document", "sticker", "album"].includes(type)
      ? type
      : "unknown"
  ) as WhatsAppDirectMediaType;
}

/**
 * Everything the downloader needs to fetch this attachment later. The source
 * message is stripped of inline bytes first; Evolution is asked for the binary
 * again by message key, which is how the group pipeline already works.
 */
export function whatsappDirectMediaSourceMetadata(input: {
  item: WhatsAppMediaDetails;
  mediaIndex: number;
  messageKey: Record<string, unknown>;
  sourceMessage: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    mediaIndex: input.mediaIndex,
    mediaType: normalizeWhatsAppDirectMediaType(input.item.mediaType),
    mimeType: input.item.mimeType ?? null,
    fileName: input.item.fileName ?? null,
    sizeBytes: input.item.sizeBytes ?? null,
    caption: input.item.caption ?? null,
    sourceSha256: input.item.sourceSha256 ?? null,
    messageKey: input.messageKey,
    sourceMessage: stripInlineMediaData(input.sourceMessage),
  };
}

export type WhatsAppDirectMediaRowInput = {
  ownerId: string;
  workspaceId: string;
  instanceName: string;
  directMessageId: string;
  providerMessageId: string;
  remoteJidHash: string;
  mediaIndex: number;
  item: WhatsAppMediaDetails;
  sourceMetadata: Record<string, unknown>;
};

/** Deterministic fields; `id` is injected so callers control idempotency keys. */
export function buildWhatsAppDirectMediaRow(
  input: WhatsAppDirectMediaRowInput,
  id: string,
) {
  return {
    id,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    instanceName: input.instanceName,
    directMessageId: input.directMessageId,
    providerMessageId: input.providerMessageId,
    remoteJidHash: input.remoteJidHash,
    mediaIndex: input.mediaIndex,
    mediaType: normalizeWhatsAppDirectMediaType(input.item.mediaType),
    mimeType: input.item.mimeType ?? null,
    fileName: input.item.fileName ?? null,
    sizeBytes: input.item.sizeBytes ?? null,
    sourceUrl: input.item.mediaUrl ?? null,
    sourceMetadata: input.sourceMetadata,
    sha256: null,
    storageKey: null,
    storagePath: null,
    storageProvider: "local" as const,
    thumbnailPath: null,
    downloadStatus: "pending" as const,
    errorCode: null,
    downloadAttempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
  };
}

const FAILED_MEDIA_LABELS: Record<WhatsAppDirectMediaType, string> = {
  image: "تعذر تنزيل الصورة المرفقة.",
  video: "تعذر تنزيل الفيديو المرفق.",
  audio: "تعذر تنزيل الرسالة الصوتية المرفقة.",
  document: "تعذر تنزيل الملف المرفق.",
  sticker: "تعذر تنزيل الملصق المرفق.",
  album: "تعذر تنزيل مرفقات الألبوم.",
  unknown: "تعذر تنزيل المرفق.",
};

export function whatsappDirectMediaFailureLabel(
  mediaType: unknown,
  errorCode?: string | null,
): string {
  const label = FAILED_MEDIA_LABELS[normalizeWhatsAppDirectMediaType(mediaType)];
  return errorCode ? `${label} (${errorCode})` : label;
}

export function whatsappDirectMediaPendingLabel(mediaType: unknown): string {
  const type = normalizeWhatsAppDirectMediaType(mediaType);
  return type === "image"
    ? "جارٍ تنزيل الصورة..."
    : type === "video"
      ? "جارٍ تنزيل الفيديو..."
      : type === "audio"
        ? "جارٍ تنزيل الرسالة الصوتية..."
        : "جارٍ تنزيل المرفق...";
}

export type WhatsAppDirectAttachmentView = {
  id: string;
  mediaIndex: number;
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  downloadStatus: string;
  errorCode: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  accessError: string | null;
};

/** The wire shape. Storage paths never enter this object. */
export function serializeWhatsAppDirectAttachment(
  media: {
    id: string;
    mediaIndex: number;
    mediaType: string;
    mimeType: string | null;
    fileName: string | null;
    sizeBytes: number | null;
    downloadStatus: string;
    errorCode: string | null;
    storagePath: string | null;
    thumbnailPath: string | null;
  },
  sign: (
    variant: "original" | "thumbnail",
  ) => { url: string | null; accessError: string | null },
): WhatsAppDirectAttachmentView {
  const canServe = media.downloadStatus === "stored" && Boolean(media.storagePath);
  const original = canServe ? sign("original") : { url: null, accessError: null };
  const thumbnail = canServe &&
    media.thumbnailPath &&
    !["failed", "unavailable"].includes(media.thumbnailPath)
    ? sign("thumbnail")
    : original;
  return {
    id: media.id,
    mediaIndex: media.mediaIndex,
    mediaType: media.mediaType,
    mimeType: media.mimeType,
    fileName: media.fileName,
    sizeBytes: media.sizeBytes,
    downloadStatus: media.downloadStatus,
    errorCode: media.errorCode,
    url: original.url,
    thumbnailUrl: thumbnail.url,
    accessError: original.accessError,
  };
}
