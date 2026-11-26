import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  and,
  eq,
  isNull,
  isNotNull,
  like,
  asc,
  gt,
  lte,
  ne,
  notExists,
  notLike,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessageMedia,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
} from "@workspace/db";
import { menaWhatsAppMessages as WhatsAppMessageTable } from "@workspace/db";
import {
  extractMediaItemsFromMessage,
  type WhatsAppMediaDetails,
} from "./whatsapp-message-scope";
import { evolutionRequest } from "./whatsapp-evolution";
import { filterWhatsAppMediaItems } from "./whatsapp-sync-options";
import { assertWorkspaceContext } from "./workspace-record-access";
import {
  mediaDownloadAttemptLimit,
  mediaDownloadFailureReason,
  messageAgeMs,
} from "./whatsapp-media-expiry-policy.ts";
import {
  createMediaThumbnail,
  hasMediaObject,
  readMediaObject,
  resolveWhatsAppMediaStorageRoot,
  storeMediaObject,
  thumbnailObjectPath,
} from "./whatsapp-media-storage";
import { requeueWhatsAppProductMessage } from "./whatsapp-product-extraction";
import { asRecord } from "./value-utils.ts";
import { logger } from "./logger.ts";

const MEDIA_ROOT = resolveWhatsAppMediaStorageRoot();
const MAX_DOWNLOAD_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
const MAX_WHATSAPP_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_EVOLUTION_MEDIA_RESPONSE_BYTES = 32 * 1024 * 1024;

type WhatsAppMessage = typeof WhatsAppMessageTable.$inferSelect;
type MediaEntry = Record<string, unknown>;

function pathSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const baseType = value.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(baseType)
    ? baseType
    : null;
}

function sourceMediaHash(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  if (!/^[a-z0-9+/_-]+={0,2}$/i.test(normalized)) return null;
  const bytes = Buffer.from(normalized.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return bytes.length === 32 ? bytes.toString("hex") : null;
}

function mediaBuffer(payload: Record<string, unknown>): Buffer | null {
  const nested = asRecord(payload.data) ?? payload;
  if (typeof nested.base64 === "string" && nested.base64.length > 0) {
    const encoded = nested.base64.includes(",")
      ? nested.base64.slice(nested.base64.indexOf(",") + 1)
      : nested.base64;
    const buffer = Buffer.from(encoded, "base64");
    return buffer.length > 0 ? buffer : null;
  }
  const serialized = asRecord(nested.buffer);
  if (
    serialized?.type === "Buffer" &&
    Array.isArray(serialized.data) &&
    serialized.data.every(
      (byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  ) {
    const buffer = Buffer.from(serialized.data);
    return buffer.length > 0 ? buffer : null;
  }
  return null;
}

function mediaErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "MEDIA_DOWNLOAD_FAILED";
  if (/^[A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)
    ? code
    : error.name === "TimeoutError" || error.name === "AbortError"
      ? "MEDIA_DOWNLOAD_TIMEOUT"
      : "MEDIA_DOWNLOAD_FAILED";
}

function isRetryableMediaError(errorCode: string): boolean {
  if ([
    "MEDIA_DOWNLOAD_TIMEOUT",
    "EVOLUTION_API_TIMEOUT",
    "EVOLUTION_API_UNREACHABLE",
    "EVOLUTION_API_REQUEST_FAILED",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "EIO",
    "EBUSY",
  ].includes(errorCode)) {
    return true;
  }
  const status = errorCode.match(/^EVOLUTION_MEDIA_HTTP_(\d{3})$/)?.[1];
  return Boolean(status && [408, 425, 429, 500, 502, 503, 504].includes(Number(status)));
}

function nextRetryAt(attempt: number, now: Date): Date {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + delay);
}

async function hasUsableFile(
  filePath: string | null,
  provider: string,
): Promise<boolean> {
  if (!filePath) return false;
  if (provider === "supabase") return hasMediaObject(filePath);
  try {
    const file = await stat(filePath);
    return file.isFile() && file.size > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function fetchMedia(
  instanceName: string,
  sourceMessage: Record<string, unknown>,
  messageKey: Record<string, unknown>,
) {
  const keyFromMessage = asRecord(sourceMessage.key) ?? {};
  const key = {
    ...messageKey,
    ...keyFromMessage,
    id: keyFromMessage.id ?? messageKey.id,
    remoteJid: keyFromMessage.remoteJid ?? messageKey.remoteJid,
  };
  const payload = asRecord(await evolutionRequest(
    `chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        message: { ...sourceMessage, key },
        convertToMp4: false,
      }),
    },
    30_000,
    MAX_EVOLUTION_MEDIA_RESPONSE_BYTES,
  ));
  const buffer = payload ? mediaBuffer(payload) : null;
  if (!buffer) throw new Error("MEDIA_DOWNLOAD_FAILED");
  const data = asRecord(payload?.data);
  return {
    buffer,
    mimeType:
      typeof data?.mimetype === "string"
        ? data.mimetype
        : typeof payload?.mimetype === "string"
          ? payload.mimetype
          : null,
  };
}

type StoredMediaLike = {
  storageKey: string | null;
  storagePath: string | null;
  storageProvider: string | null;
  thumbnailPath: string | null;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
};

type ReusableMedia = StoredMediaLike & { id: string; hash: string };

type AcquiredMedia =
  | { kind: "reuse"; reusable: ReusableMedia }
  | {
      kind: "downloaded";
      mimeType: string | null;
      hash: string;
      storageKey: string;
      storagePath: string;
      provider: "supabase" | "local";
      fileName: string;
      sizeBytes: number;
      downloadMs: number;
      uploadMs: number;
      localWriteMs: number;
      bytes: number;
    };

/**
 * The binary half of the media pipeline, shared by group and direct messages.
 * Both callers keep their own row identity and retry policy; only downloading,
 * verifying and storing the bytes lives here.
 */
async function acquireAndStoreMediaBuffer(input: {
  instanceName: string;
  workspaceId: string;
  ownerId: string;
  storageScope: string;
  details: WhatsAppMediaDetails;
  sourceMessage: Record<string, unknown>;
  messageKey: Record<string, unknown>;
  findReusable?: (hash: string) => Promise<ReusableMedia | null>;
}): Promise<AcquiredMedia> {
  if (
    input.details.sizeBytes !== null &&
    input.details.sizeBytes > MAX_WHATSAPP_MEDIA_BYTES
  ) {
    throw new Error("WHATSAPP_MEDIA_SIZE_LIMIT_EXCEEDED");
  }

  const advertisedHash = sourceMediaHash(input.details.sourceSha256);
  if (advertisedHash && input.findReusable) {
    const reusable = await input.findReusable(advertisedHash);
    if (
      reusable &&
      (!input.details.sizeBytes ||
        !reusable.sizeBytes ||
        input.details.sizeBytes === reusable.sizeBytes) &&
      reusable.storagePath &&
      await hasUsableFile(reusable.storagePath, reusable.storageProvider ?? "local")
    ) {
      return { kind: "reuse", reusable };
    }
  }

  const inlineData = input.details.base64Data
    ? mediaBuffer({ base64: input.details.base64Data })
    : null;
  const downloadStartedAt = performance.now();
  const downloaded = inlineData
    ? { buffer: inlineData, mimeType: input.details.mimeType }
    : await fetchMedia(
        input.instanceName,
        input.sourceMessage,
        input.messageKey,
      );
  const downloadMs = Math.round(performance.now() - downloadStartedAt);
  const bytes = downloaded.buffer.length;
  if (bytes > MAX_WHATSAPP_MEDIA_BYTES) {
    throw new Error("WHATSAPP_MEDIA_SIZE_LIMIT_EXCEEDED");
  }
  const mimeType = normalizeMimeType(downloaded.mimeType ?? input.details.mimeType);
  const mimeExtension = mimeType?.split("/")[1];
  const fileExtension = input.details.fileName?.slice(
    input.details.fileName.lastIndexOf("."),
  );
  const extension = mimeExtension && /^[a-z0-9.+-]{1,20}$/i.test(mimeExtension)
    ? `.${mimeExtension}`
    : fileExtension && /^\.[a-z0-9]{1,12}$/i.test(fileExtension)
      ? fileExtension
      : ".bin";
  const hash = createHash("sha256").update(downloaded.buffer).digest("hex");
  if (advertisedHash && hash !== advertisedHash) {
    throw new Error("MEDIA_SOURCE_HASH_MISMATCH");
  }
  const fileName = input.details.fileName ?? `${hash}${extension}`;
  const objectPath = [
    pathSegment(input.workspaceId),
    "objects",
    `${hash}${extension}`,
  ].join("/");
  const storageKey = objectPath;
  const uploadStartedAt = performance.now();
  const provider = await storeMediaObject(
    objectPath,
    downloaded.buffer,
    mimeType ?? "application/octet-stream",
  );
  const uploadMs = Math.round(performance.now() - uploadStartedAt);
  const storagePath = provider === "supabase"
    ? objectPath
    : path.join(
        MEDIA_ROOT,
        pathSegment(input.workspaceId),
        pathSegment(input.ownerId),
        pathSegment(input.instanceName),
        pathSegment(input.storageScope),
        `${hash}${extension}`,
      );
  let localWriteMs = 0;
  if (provider === "local") {
    const localWriteStartedAt = performance.now();
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, downloaded.buffer);
    localWriteMs = Math.round(performance.now() - localWriteStartedAt);
  }
  return {
    kind: "downloaded",
    mimeType,
    hash,
    storageKey,
    storagePath,
    provider,
    fileName,
    sizeBytes: input.details.sizeBytes ?? bytes,
    downloadMs,
    uploadMs,
    localWriteMs,
    bytes,
  };
}

async function storeMedia(
  message: WhatsAppMessage,
  entry: MediaEntry,
): Promise<"stored" | "pending" | "failed"> {
  if (!message.groupId) throw new Error("WHATSAPP_GROUP_IDENTITY_REQUIRED");
  const sourceMessage = asRecord(entry.sourceMessage);
  if (!sourceMessage) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const details = extractMediaItemsFromMessage(sourceMessage)[0];
  if (!details) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const mediaIndex =
    typeof entry.mediaIndex === "number" && Number.isInteger(entry.mediaIndex) && entry.mediaIndex >= 0
      ? entry.mediaIndex
      : 0;
  const sourceKey = asRecord(entry.messageKey) ?? asRecord(sourceMessage.key) ?? {};
  const key = {
    ...sourceKey,
    id: sourceKey.id ?? message.remoteMessageId,
    remoteJid: sourceKey.remoteJid ?? message.groupJid,
  };
  const identity = and(
    eq(menaWhatsAppMessageMedia.ownerId, message.ownerId),
    eq(menaWhatsAppMessageMedia.workspaceId, message.workspaceId),
    eq(menaWhatsAppMessageMedia.instanceName, message.instanceName),
    eq(menaWhatsAppMessageMedia.groupId, message.groupId),
    eq(menaWhatsAppMessageMedia.messageId, message.id),
    eq(menaWhatsAppMessageMedia.mediaIndex, mediaIndex),
    eq(menaWhatsAppMessageMedia.mediaType, details.mediaType),
  );

  await db
    .insert(menaWhatsAppMessageMedia)
    .values({
      id: randomUUID(),
      ownerId: message.ownerId,
      workspaceId: message.workspaceId,
      instanceName: message.instanceName,
      groupJid: message.groupJid,
      groupId: message.groupId,
      messageId: message.id,
      mediaIndex,
      mediaType: details.mediaType,
      fileName: details.fileName,
      mimeType: details.mimeType,
      sizeBytes: details.sizeBytes,
      storageKey: "",
      storagePath: "",
      downloadStatus: "pending",
      downloadAttempts: 0,
      failureReason: null,
      lastError: null,
    })
    .onConflictDoNothing();

  const [existing] = await db
    .select()
    .from(menaWhatsAppMessageMedia)
    .where(identity)
    .limit(1);
  if (!existing) throw new Error("MEDIA_TRACKING_ROW_UNAVAILABLE");
  if (
    existing.downloadStatus === "stored" &&
    await hasUsableFile(existing.storagePath, existing.storageProvider)
  ) {
    await requeueWhatsAppProductMessage(message.workspaceId, message.id);
    return "stored";
  }

  const now = new Date();
  // A message older than WhatsApp's serving window gets one attempt, not five:
  // the object is gone upstream, and four extra calls only postpone the honest
  // answer. See `whatsapp-media-expiry-policy.ts` for the measured window.
  const attemptLimit = mediaDownloadAttemptLimit({
    messageAgeMs: messageAgeMs(message.messageTimestamp, now),
    defaultLimit: MAX_DOWNLOAD_ATTEMPTS,
  });
  if (existing.downloadAttempts >= attemptLimit) return "failed";
  if (
    existing.downloadStatus === "failed" &&
    !isRetryableMediaError(existing.lastError ?? existing.failureReason ?? "") &&
    existing.failureReason !== "STORED_MEDIA_FILE_MISSING"
  ) return "failed";
  if (existing.nextAttemptAt && existing.nextAttemptAt > now) return "pending";

  const [attempt] = await db
    .update(menaWhatsAppMessageMedia)
    .set({
      downloadStatus: "pending",
      downloadAttempts: sql`${menaWhatsAppMessageMedia.downloadAttempts} + 1`,
      lastAttemptAt: now,
      nextAttemptAt: null,
      failureReason: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      identity,
      eq(menaWhatsAppMessageMedia.downloadAttempts, existing.downloadAttempts),
      or(isNull(menaWhatsAppMessageMedia.nextAttemptAt), lte(menaWhatsAppMessageMedia.nextAttemptAt, now)),
    ))
    .returning({ downloadAttempts: menaWhatsAppMessageMedia.downloadAttempts });
  if (!attempt) {
    const [current] = await db
      .select({ downloadStatus: menaWhatsAppMessageMedia.downloadStatus })
      .from(menaWhatsAppMessageMedia)
      .where(identity)
      .limit(1);
    return current?.downloadStatus === "stored" ? "stored" : "pending";
  }

  const startedAt = performance.now();
  let downloadMs = 0;
  let uploadMs = 0;
  let localWriteMs = 0;
  let downloadedBytes = 0;
  let storageProvider: string | null = null;
  try {
    const acquired = await acquireAndStoreMediaBuffer({
      instanceName: message.instanceName,
      workspaceId: message.workspaceId,
      ownerId: message.ownerId,
      storageScope: message.groupJid,
      details,
      sourceMessage,
      messageKey: key,
      findReusable: async (hash) => {
        const [reusable] = await db
          .select()
          .from(menaWhatsAppMessageMedia)
          .where(and(
            eq(menaWhatsAppMessageMedia.workspaceId, message.workspaceId),
            eq(menaWhatsAppMessageMedia.sha256, hash),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
            ne(menaWhatsAppMessageMedia.id, existing.id),
          ))
          .limit(1);
        return reusable
          ? { ...reusable, hash }
          : null;
      },
    });

    if (acquired.kind === "reuse") {
      const reusable = acquired.reusable;
      await db
        .update(menaWhatsAppMessageMedia)
        .set({
          fileName: details.fileName ?? reusable.fileName,
          mimeType: reusable.mimeType ?? normalizeMimeType(details.mimeType),
          sizeBytes: details.sizeBytes ?? reusable.sizeBytes,
          storageKey: reusable.storageKey ?? "",
          storagePath: reusable.storagePath ?? "",
          storageProvider: reusable.storageProvider ?? "local",
          thumbnailPath: reusable.thumbnailPath,
          sha256: reusable.hash,
          downloadStatus: "stored",
          failureReason: null,
          lastError: null,
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(identity);
      await requeueWhatsAppProductMessage(message.workspaceId, message.id);
      return "stored";
    }

    downloadMs = acquired.downloadMs;
    uploadMs = acquired.uploadMs;
    localWriteMs = acquired.localWriteMs;
    downloadedBytes = acquired.bytes;
    storageProvider = acquired.provider;
    await db
      .update(menaWhatsAppMessageMedia)
      .set({
        fileName: acquired.fileName,
        mimeType: acquired.mimeType,
        sizeBytes: acquired.sizeBytes,
        storageKey: acquired.storageKey,
        storagePath: acquired.storagePath,
        storageProvider: acquired.provider,
        thumbnailPath: null,
        sha256: acquired.hash,
        downloadStatus: "stored",
        failureReason: null,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(identity)
      .returning({ id: menaWhatsAppMessageMedia.id });
    await requeueWhatsAppProductMessage(message.workspaceId, message.id);
    logger.info(
      {
        messageId: message.id,
        mediaIndex,
        bytes: downloadedBytes,
        provider: storageProvider,
        downloadMs,
        uploadMs,
        localWriteMs,
        totalMs: Math.round(performance.now() - startedAt),
      },
      "WhatsApp media stored",
    );
    return "stored";
  } catch (error) {
    const errorCode = mediaErrorCode(error);
    // For an old message the transport error is the symptom and the age is the
    // cause; recording the cause is what lets the catalog say the media expired
    // upstream instead of a generic «فشل التحميل». The expiry reason is not in
    // the retryable list, so nothing schedules another attempt on its own.
    const failureReason = mediaDownloadFailureReason({
      messageAgeMs: messageAgeMs(message.messageTimestamp, new Date()),
      errorCode,
    });
    const retry = isRetryableMediaError(failureReason) &&
      attempt.downloadAttempts < attemptLimit;
    const retryAt = retry ? nextRetryAt(attempt.downloadAttempts, new Date()) : null;
    await db
      .update(menaWhatsAppMessageMedia)
      .set({
        downloadStatus: retry ? "pending" : "failed",
        failureReason,
        lastError: failureReason,
        nextAttemptAt: retryAt,
        updatedAt: new Date(),
      })
      .where(identity);
    logger.error(
      {
        messageId: message.id,
        mediaIndex,
        attempt: attempt.downloadAttempts,
        retryAt: retryAt?.toISOString() ?? null,
        reason: errorCode,
        bytes: downloadedBytes,
        provider: storageProvider,
        downloadMs,
        uploadMs,
        localWriteMs,
        totalMs: Math.round(performance.now() - startedAt),
      },
      "WhatsApp media download attempt failed",
    );
    return retry ? "pending" : "failed";
  }
}

type WhatsAppDirectMediaRow = typeof menaWhatsAppDirectMessageMedia.$inferSelect;

/** Downloads and stores one direct-message attachment. Never throws for a
 * transport failure — the row keeps the failure code and remains retryable. */
async function storeDirectMedia(
  media: WhatsAppDirectMediaRow,
): Promise<"stored" | "pending" | "failed"> {
  assertWorkspaceContext(media.workspaceId);
  const metadata = asRecord(media.sourceMetadata) ?? {};
  const sourceMessage = asRecord(metadata.sourceMessage);
  if (!sourceMessage) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const items = extractMediaItemsFromMessage(sourceMessage);
  // Albums carry several media nodes under one provider message id. The row's
  // mediaIndex selects which one this worker must fetch; falling back to the
  // first item keeps older single-attachment rows compatible.
  const details = items[media.mediaIndex] ?? items[0];
  if (!details) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const sourceKey = asRecord(metadata.messageKey) ?? {};
  const key = {
    ...sourceKey,
    id: sourceKey.id ?? media.providerMessageId ?? media.id,
    remoteJid: sourceKey.remoteJid ?? media.remoteJidHash,
  };
  const identity = and(
    eq(menaWhatsAppDirectMessageMedia.id, media.id),
    eq(menaWhatsAppDirectMessageMedia.workspaceId, media.workspaceId),
    eq(menaWhatsAppDirectMessageMedia.instanceName, media.instanceName),
    eq(menaWhatsAppDirectMessageMedia.directMessageId, media.directMessageId),
  );
  if (
    media.downloadStatus === "stored" &&
    await hasUsableFile(media.storagePath, media.storageProvider)
  ) return "stored";

  const now = new Date();
  const attemptLimit = mediaDownloadAttemptLimit({
    messageAgeMs: messageAgeMs(media.createdAt, now),
    defaultLimit: MAX_DOWNLOAD_ATTEMPTS,
  });
  if (media.downloadAttempts >= attemptLimit) return "failed";
  if (
    media.downloadStatus === "failed" &&
    !isRetryableMediaError(media.lastError ?? media.errorCode ?? "")
  ) return "failed";
  if (media.nextAttemptAt && media.nextAttemptAt > now) return "pending";

  const [attempt] = await db
    .update(menaWhatsAppDirectMessageMedia)
    .set({
      downloadStatus: "pending",
      downloadAttempts: sql`${menaWhatsAppDirectMessageMedia.downloadAttempts} + 1`,
      lastAttemptAt: now,
      nextAttemptAt: null,
      errorCode: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      identity,
      eq(menaWhatsAppDirectMessageMedia.downloadAttempts, media.downloadAttempts),
      or(
        isNull(menaWhatsAppDirectMessageMedia.nextAttemptAt),
        lte(menaWhatsAppDirectMessageMedia.nextAttemptAt, now),
      ),
    ))
    .returning({ downloadAttempts: menaWhatsAppDirectMessageMedia.downloadAttempts });
  if (!attempt) {
    const [current] = await db
      .select({ downloadStatus: menaWhatsAppDirectMessageMedia.downloadStatus })
      .from(menaWhatsAppDirectMessageMedia)
      .where(identity)
      .limit(1);
    return current?.downloadStatus === "stored" ? "stored" : "pending";
  }

  const startedAt = performance.now();
  let downloadMs = 0;
  let uploadMs = 0;
  let downloadedBytes = 0;
  try {
    const acquired = await acquireAndStoreMediaBuffer({
      instanceName: media.instanceName,
      workspaceId: media.workspaceId,
      ownerId: media.ownerId,
      storageScope: media.remoteJidHash,
      details,
      sourceMessage,
      messageKey: key,
      findReusable: async (hash) => {
        const [reusable] = await db
          .select()
          .from(menaWhatsAppDirectMessageMedia)
          .where(and(
            eq(menaWhatsAppDirectMessageMedia.workspaceId, media.workspaceId),
            eq(menaWhatsAppDirectMessageMedia.sha256, hash),
            eq(menaWhatsAppDirectMessageMedia.downloadStatus, "stored"),
            ne(menaWhatsAppDirectMessageMedia.id, media.id),
          ))
          .limit(1);
        return reusable ? { ...reusable, hash } : null;
      },
    });

    const stored = acquired.kind === "reuse"
      ? {
          mimeType: acquired.reusable.mimeType ?? normalizeMimeType(details.mimeType),
          storageKey: acquired.reusable.storageKey,
          storagePath: acquired.reusable.storagePath,
          storageProvider: acquired.reusable.storageProvider ?? "local",
          thumbnailPath: acquired.reusable.thumbnailPath,
          sha256: acquired.reusable.hash,
          fileName: details.fileName ?? acquired.reusable.fileName,
          sizeBytes: details.sizeBytes ?? acquired.reusable.sizeBytes,
        }
      : {
          mimeType: acquired.mimeType,
          storageKey: acquired.storageKey,
          storagePath: acquired.storagePath,
          storageProvider: acquired.provider,
          thumbnailPath: null,
          sha256: acquired.hash,
          fileName: acquired.fileName,
          sizeBytes: acquired.sizeBytes,
        };
    if (acquired.kind === "downloaded") {
      downloadMs = acquired.downloadMs;
      uploadMs = acquired.uploadMs;
      downloadedBytes = acquired.bytes;
    }
    await db
      .update(menaWhatsAppDirectMessageMedia)
      .set({
        ...stored,
        downloadStatus: "stored",
        errorCode: null,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(identity)
      .returning({ id: menaWhatsAppDirectMessageMedia.id });
    logger.info(
      {
        mediaId: media.id,
        providerMessageId: media.providerMessageId,
        mediaIndex: media.mediaIndex,
        bytes: downloadedBytes,
        downloadMs,
        uploadMs,
        totalMs: Math.round(performance.now() - startedAt),
      },
      "WhatsApp direct media stored",
    );
    return "stored";
  } catch (error) {
    const errorCode = mediaErrorCode(error);
    const failureReason = mediaDownloadFailureReason({
      messageAgeMs: messageAgeMs(media.createdAt, new Date()),
      errorCode,
    });
    const retry = isRetryableMediaError(failureReason) &&
      attempt.downloadAttempts < attemptLimit;
    const retryAt = retry ? nextRetryAt(attempt.downloadAttempts, new Date()) : null;
    await db
      .update(menaWhatsAppDirectMessageMedia)
      .set({
        downloadStatus: retry ? "pending" : "failed",
        errorCode: failureReason,
        lastError: failureReason,
        nextAttemptAt: retryAt,
        updatedAt: new Date(),
      })
      .where(identity);
    logger.error(
      {
        mediaId: media.id,
        providerMessageId: media.providerMessageId,
        mediaIndex: media.mediaIndex,
        attempt: attempt.downloadAttempts,
        retryAt: retryAt?.toISOString() ?? null,
        reason: failureReason,
        totalMs: Math.round(performance.now() - startedAt),
      },
      "WhatsApp direct media download attempt failed",
    );
    return retry ? "pending" : "failed";
  }
}

export async function retryWhatsAppMediaDownload(message: WhatsAppMessage): Promise<boolean> {
  assertWorkspaceContext(message.workspaceId);
  if (!message.groupId) throw new Error("WHATSAPP_GROUP_IDENTITY_REQUIRED");
  const [persistedMessage] = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.id, message.id),
      eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
      eq(menaWhatsAppMessages.instanceName, message.instanceName),
      eq(menaWhatsAppMessages.groupId, message.groupId),
    ))
    .limit(1);
  if (!persistedMessage) return false;

  const existingMedia = await db
    .select()
    .from(menaWhatsAppMessageMedia)
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, message.workspaceId),
      eq(menaWhatsAppMessageMedia.messageId, message.id),
    ));
  let missingStoredFile = false;
  for (const media of existingMedia) {
    if (media.downloadStatus !== "stored") continue;
    if (!await hasUsableFile(media.storagePath, media.storageProvider)) {
      missingStoredFile = true;
      await db
        .update(menaWhatsAppMessageMedia)
        .set({
          downloadStatus: "failed",
          failureReason: "STORED_MEDIA_FILE_MISSING",
          lastError: "STORED_MEDIA_FILE_MISSING",
          nextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(menaWhatsAppMessageMedia.workspaceId, message.workspaceId),
          eq(menaWhatsAppMessageMedia.id, media.id),
        ));
    }
  }
  if (
    persistedMessage.mediaDownloadStatus === "not_required" &&
    existingMedia.length === 0
  ) return true;
  if (
    persistedMessage.mediaDownloadStatus === "stored" &&
    !missingStoredFile &&
    existingMedia.length > 0 &&
    existingMedia.every((media) => media.downloadStatus === "stored") &&
    (!Array.isArray(persistedMessage.sourceMediaPayload) ||
      existingMedia.length >= persistedMessage.sourceMediaPayload.length)
  ) return true;

  if (
    persistedMessage.mediaDownloadStatus === "not_required" &&
    existingMedia.length === 0 &&
    !persistedMessage.mediaAvailable
  ) return true;

  const [connection] = await db
    .select({
      syncMessagesEnabled: menaWhatsAppConnections.syncMessagesEnabled,
      syncImagesEnabled: menaWhatsAppConnections.syncImagesEnabled,
      syncVideosEnabled: menaWhatsAppConnections.syncVideosEnabled,
    })
    .from(menaWhatsAppConnections)
    .where(and(
      eq(menaWhatsAppConnections.workspaceId, persistedMessage.workspaceId),
      eq(menaWhatsAppConnections.instanceName, persistedMessage.instanceName),
    ))
    .limit(1);
  if (!connection) {
    await db
      .update(menaWhatsAppMessages)
      .set({
        mediaDownloadStatus: "failed",
        mediaDownloadError: "WHATSAPP_CONNECTION_NOT_FOUND",
        updatedAt: new Date(),
      })
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
        eq(menaWhatsAppMessages.id, message.id),
      ));
    return false;
  }
  if (!Array.isArray(persistedMessage.sourceMediaPayload) || persistedMessage.sourceMediaPayload.length === 0) {
    const reason = missingStoredFile
      ? "STORED_MEDIA_FILE_MISSING_SOURCE_UNAVAILABLE"
      : "MEDIA_SOURCE_PAYLOAD_UNAVAILABLE";
    await db
      .update(menaWhatsAppMessages)
      .set({
        mediaDownloadStatus: "failed",
        mediaDownloadError: reason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
        eq(menaWhatsAppMessages.id, message.id),
      ));
    return false;
  }

  const selected = filterWhatsAppMediaItems(persistedMessage.sourceMediaPayload, connection);
  if (selected.length === 0) {
    await db
      .update(menaWhatsAppMessages)
      .set({
        mediaDownloadStatus: "not_required",
        mediaDownloadError: null,
        sourceMediaPayload: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(menaWhatsAppMessages.id, message.id),
        eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
      ));
    return true;
  }

  const outcomes: Array<"stored" | "pending" | "failed"> = [];
  for (const value of selected) {
    const entry = asRecord(value);
    if (!entry) {
      outcomes.push("failed");
      logger.error(
        {
          messageId: message.id,
          reason: "MEDIA_SOURCE_INVALID",
        },
        "WhatsApp media source entry is invalid",
      );
      continue;
    }
    outcomes.push(await storeMedia(persistedMessage, entry));
  }
  const status = outcomes.includes("pending")
    ? "pending"
    : outcomes.includes("failed")
      ? "failed"
      : "stored";
  const error = status === "failed"
    ? "MEDIA_DOWNLOAD_FAILED_REQUIRES_REVIEW"
    : null;
  await db
    .update(menaWhatsAppMessages)
    .set({
      mediaDownloadStatus: status,
      mediaDownloadError: error,
      sourceMediaPayload: status === "stored" ? null : selected,
      updatedAt: new Date(),
    })
    .where(and(
      eq(menaWhatsAppMessages.ownerId, message.ownerId),
      eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
      eq(menaWhatsAppMessages.id, message.id),
    ));
  return status === "stored";
}

let directMediaDownloadWorkerRunning = false;

/**
 * Downloads attachments created by the direct-message webhook path. It is
 * intentionally part of the same worker tick as group media: no new worker,
 * config or cron is needed, and both queues share the same storage primitives.
 */
export async function processWhatsAppDirectMediaDownloadQueue(): Promise<number> {
  if (directMediaDownloadWorkerRunning) return 0;
  directMediaDownloadWorkerRunning = true;
  try {
    const now = new Date();
    const pending = await db
      .select()
      .from(menaWhatsAppDirectMessageMedia)
      .where(and(
        eq(menaWhatsAppDirectMessageMedia.downloadStatus, "pending"),
        or(
          isNull(menaWhatsAppDirectMessageMedia.nextAttemptAt),
          lte(menaWhatsAppDirectMessageMedia.nextAttemptAt, now),
        ),
      ))
      .orderBy(asc(menaWhatsAppDirectMessageMedia.updatedAt))
      .limit(10);

    let completed = 0;
    for (let offset = 0; offset < pending.length; offset += 3) {
      const batch = pending.slice(offset, offset + 3);
      const outcomes = await Promise.all(batch.map(async (media) => {
        try {
          const result = await storeDirectMedia(media);
          return result === "stored";
        } catch (error) {
          logger.error(
            {
              mediaId: media.id,
              providerMessageId: media.providerMessageId,
              reason: mediaErrorCode(error),
            },
            "WhatsApp direct media queue item failed",
          );
          return false;
        }
      }));
      completed += outcomes.filter(Boolean).length;
    }
    return completed;
  } finally {
    directMediaDownloadWorkerRunning = false;
  }
}

let mediaDownloadWorkerRunning = false;

export async function processWhatsAppMediaDownloadQueue(): Promise<number> {
  if (mediaDownloadWorkerRunning) return 0;
  mediaDownloadWorkerRunning = true;
  const startedAt = performance.now();

  try {
    const now = new Date();
    const messages = await db
      .select()
      .from(menaWhatsAppMessages)
      .where(and(
        ne(menaWhatsAppMessages.messageStatus, "deleted"),
        eq(menaWhatsAppMessages.mediaAvailable, true),
        eq(menaWhatsAppMessages.mediaDownloadStatus, "pending"),
        isNotNull(menaWhatsAppMessages.groupId),
        isNotNull(menaWhatsAppMessages.sourceMediaPayload),
        notExists(
          db
            .select({ id: menaWhatsAppMessageMedia.id })
            .from(menaWhatsAppMessageMedia)
            .where(and(
              eq(menaWhatsAppMessageMedia.workspaceId, menaWhatsAppMessages.workspaceId),
              eq(menaWhatsAppMessageMedia.messageId, menaWhatsAppMessages.id),
              isNotNull(menaWhatsAppMessageMedia.nextAttemptAt),
              gt(menaWhatsAppMessageMedia.nextAttemptAt, now),
            )),
        ),
      ))
      .orderBy(asc(menaWhatsAppMessages.updatedAt))
      .limit(10);

    let completed = 0;
    for (let offset = 0; offset < messages.length; offset += 3) {
      const batch = messages.slice(offset, offset + 3);
      const outcomes = await Promise.all(batch.map(async (message) => {
        try {
          return await retryWhatsAppMediaDownload(message);
        } catch (error) {
          logger.error(
            {
              messageId: message.id,
              reason: mediaErrorCode(error),
            },
            "WhatsApp media queue item failed",
          );
          return false;
        }
      }));
      completed += outcomes.filter(Boolean).length;
    }

    const directCompleted = await processWhatsAppDirectMediaDownloadQueue();
    completed += directCompleted;

    if (messages.length > 0 || directCompleted > 0) {
      logger.info(
        {
          selected: messages.length,
          completed,
          directCompleted,
          totalMs: Math.round(performance.now() - startedAt),
        },
        "WhatsApp media queue batch completed",
      );
    }
    return completed;
  } finally {
    mediaDownloadWorkerRunning = false;
  }
}

let thumbnailWorkerRunning = false;

type ThumbnailCandidate = {
  id: string;
  workspaceId: string;
  storagePath: string | null;
  storageProvider: string | null;
  mimeType: string | null;
};

async function buildMediaThumbnail(candidate: ThumbnailCandidate): Promise<string> {
  if (!candidate.mimeType || !candidate.storagePath) {
    throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  }
  const original = candidate.storageProvider === "supabase"
    ? await readMediaObject(candidate.storagePath)
    : await readLocalMedia(candidate.storagePath);
  const thumbnail = await createMediaThumbnail(original);
  let thumbnailPath = thumbnailObjectPath(candidate.storagePath);
  if (candidate.storageProvider === "supabase") {
    await storeMediaObject(thumbnailPath, thumbnail, "image/webp");
  } else {
    thumbnailPath = path.join(
      path.dirname(candidate.storagePath),
      path.basename(thumbnailPath),
    );
    await mkdir(path.dirname(thumbnailPath), { recursive: true });
    await writeFile(thumbnailPath, thumbnail);
  }
  return thumbnailPath;
}

export async function processWhatsAppMediaThumbnailQueue(): Promise<number> {
  if (thumbnailWorkerRunning) return 0;
  thumbnailWorkerRunning = true;

  try {
    const [groupPending, directPending] = await Promise.all([
      db
        .select()
        .from(menaWhatsAppMessageMedia)
        .where(and(
          eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          like(menaWhatsAppMessageMedia.mimeType, "image/%"),
          notLike(menaWhatsAppMessageMedia.mimeType, "%svg%"),
          isNull(menaWhatsAppMessageMedia.thumbnailPath),
        ))
        .orderBy(asc(menaWhatsAppMessageMedia.updatedAt))
        .limit(5),
      db
        .select()
        .from(menaWhatsAppDirectMessageMedia)
        .where(and(
          eq(menaWhatsAppDirectMessageMedia.downloadStatus, "stored"),
          like(menaWhatsAppDirectMessageMedia.mimeType, "image/%"),
          notLike(menaWhatsAppDirectMessageMedia.mimeType, "%svg%"),
          isNull(menaWhatsAppDirectMessageMedia.thumbnailPath),
        ))
        .orderBy(asc(menaWhatsAppDirectMessageMedia.updatedAt))
        .limit(5),
    ]);

    let completed = 0;
    for (const media of groupPending) {
      try {
        const thumbnailPath = await buildMediaThumbnail(media);
        await db
          .update(menaWhatsAppMessageMedia)
          .set({ thumbnailPath, updatedAt: new Date() })
          .where(and(
            eq(menaWhatsAppMessageMedia.id, media.id),
            eq(menaWhatsAppMessageMedia.workspaceId, media.workspaceId),
            isNull(menaWhatsAppMessageMedia.thumbnailPath),
          ));
        completed += 1;
      } catch (error) {
        logger.error(
          {
            mediaId: media.id,
            workspaceId: media.workspaceId,
            error: mediaErrorCode(error),
          },
          "WhatsApp thumbnail job failed",
        );
        await db
          .update(menaWhatsAppMessageMedia)
          .set({ thumbnailPath: "failed", updatedAt: new Date() })
          .where(and(
            eq(menaWhatsAppMessageMedia.id, media.id),
            eq(menaWhatsAppMessageMedia.workspaceId, media.workspaceId),
            isNull(menaWhatsAppMessageMedia.thumbnailPath),
          ));
      }
    }

    for (const media of directPending) {
      try {
        const thumbnailPath = await buildMediaThumbnail(media);
        await db
          .update(menaWhatsAppDirectMessageMedia)
          .set({ thumbnailPath, updatedAt: new Date() })
          .where(and(
            eq(menaWhatsAppDirectMessageMedia.id, media.id),
            eq(menaWhatsAppDirectMessageMedia.workspaceId, media.workspaceId),
            isNull(menaWhatsAppDirectMessageMedia.thumbnailPath),
          ));
        completed += 1;
      } catch (error) {
        logger.error(
          {
            mediaId: media.id,
            workspaceId: media.workspaceId,
            error: mediaErrorCode(error),
          },
          "WhatsApp direct thumbnail job failed",
        );
        await db
          .update(menaWhatsAppDirectMessageMedia)
          .set({ thumbnailPath: "failed", updatedAt: new Date() })
          .where(and(
            eq(menaWhatsAppDirectMessageMedia.id, media.id),
            eq(menaWhatsAppDirectMessageMedia.workspaceId, media.workspaceId),
            isNull(menaWhatsAppDirectMessageMedia.thumbnailPath),
          ));
      }
    }
    return completed;
  } finally {
    thumbnailWorkerRunning = false;
  }
}

async function readLocalMedia(storagePath: string): Promise<Buffer> {
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(`${MEDIA_ROOT}${path.sep}`)) {
    throw new Error("INVALID_MEDIA_STORAGE_PATH");
  }
  return readFile(resolved);
}
