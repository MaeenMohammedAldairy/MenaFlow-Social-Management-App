import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  and,
  eq,
  isNull,
  like,
  asc,
  lte,
  ne,
  notLike,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
} from "@workspace/db";
import { menaWhatsAppMessages as WhatsAppMessageTable } from "@workspace/db";
import { extractMediaItemsFromMessage } from "./whatsapp-message-scope";
import { evolutionRequest } from "./whatsapp-evolution";
import { filterWhatsAppMediaItems } from "./whatsapp-sync-options";
import { assertWorkspaceContext } from "./workspace-record-access";
import {
  createMediaThumbnail,
  hasMediaObject,
  readMediaObject,
  resolveWhatsAppMediaStorageRoot,
  storeMediaObject,
  thumbnailObjectPath,
} from "./whatsapp-media-storage";

const MEDIA_ROOT = resolveWhatsAppMediaStorageRoot();
const MAX_DOWNLOAD_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
    return "stored";
  }

  const now = new Date();
  if (existing.downloadAttempts >= MAX_DOWNLOAD_ATTEMPTS) return "failed";
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

  try {
    const advertisedHash = sourceMediaHash(details.sourceSha256);
    if (advertisedHash) {
      const [reusable] = await db
        .select()
        .from(menaWhatsAppMessageMedia)
        .where(and(
          eq(menaWhatsAppMessageMedia.workspaceId, message.workspaceId),
          eq(menaWhatsAppMessageMedia.sha256, advertisedHash),
          eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          ne(menaWhatsAppMessageMedia.id, existing.id),
        ))
        .limit(1);
      if (
        reusable &&
        (!details.sizeBytes || !reusable.sizeBytes || details.sizeBytes === reusable.sizeBytes) &&
        await hasUsableFile(reusable.storagePath, reusable.storageProvider)
      ) {
        await db
          .update(menaWhatsAppMessageMedia)
          .set({
            fileName: details.fileName ?? reusable.fileName,
            mimeType: reusable.mimeType ?? normalizeMimeType(details.mimeType),
            sizeBytes: details.sizeBytes ?? reusable.sizeBytes,
            storageKey: reusable.storageKey,
            storagePath: reusable.storagePath,
            storageProvider: reusable.storageProvider,
            thumbnailPath: reusable.thumbnailPath,
            sha256: advertisedHash,
            downloadStatus: "stored",
            failureReason: null,
            lastError: null,
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(identity);
        return "stored";
      }
    }

    const inlineData = details.base64Data
      ? mediaBuffer({ base64: details.base64Data })
      : null;
    const downloaded = inlineData
      ? { buffer: inlineData, mimeType: details.mimeType }
      : await fetchMedia(message.instanceName, sourceMessage, key);
    const mimeType = normalizeMimeType(downloaded.mimeType ?? details.mimeType);
    const mimeExtension = mimeType?.split("/")[1];
    const fileExtension = details.fileName?.slice(details.fileName.lastIndexOf("."));
    const extension = mimeExtension && /^[a-z0-9.+-]{1,20}$/i.test(mimeExtension)
      ? `.${mimeExtension}`
      : fileExtension && /^\.[a-z0-9]{1,12}$/i.test(fileExtension)
        ? fileExtension
        : ".bin";
    const hash = createHash("sha256").update(downloaded.buffer).digest("hex");
    if (advertisedHash && hash !== advertisedHash) {
      throw new Error("MEDIA_SOURCE_HASH_MISMATCH");
    }
    const fileName = details.fileName ?? `${hash}${extension}`;
    const objectPath = [
      pathSegment(message.workspaceId),
      "objects",
      `${hash}${extension}`,
    ].join("/");
    const storageKey = objectPath;
    const provider = await storeMediaObject(objectPath, downloaded.buffer, mimeType ?? "application/octet-stream");
    const storagePath = provider === "supabase"
      ? objectPath
      : path.join(
          MEDIA_ROOT,
          pathSegment(message.workspaceId),
          pathSegment(message.ownerId),
          pathSegment(message.instanceName),
          pathSegment(message.groupJid),
          `${hash}${extension}`,
        );
    if (provider === "local") {
      await mkdir(path.dirname(storagePath), { recursive: true });
      await writeFile(storagePath, downloaded.buffer);
    }
    const [stored] = await db
      .update(menaWhatsAppMessageMedia)
      .set({
        fileName,
        mimeType,
        sizeBytes: details.sizeBytes ?? downloaded.buffer.length,
        storageKey,
        storagePath,
        storageProvider: provider,
        thumbnailPath: null,
        sha256: hash,
        downloadStatus: "stored",
        failureReason: null,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(identity)
      .returning({ id: menaWhatsAppMessageMedia.id });
    if (!stored) throw new Error("MEDIA_STORAGE_CONFLICT_WORKSPACE_MISMATCH");
    return "stored";
  } catch (error) {
    const errorCode = mediaErrorCode(error);
    const retry = isRetryableMediaError(errorCode) &&
      attempt.downloadAttempts < MAX_DOWNLOAD_ATTEMPTS;
    const retryAt = retry ? nextRetryAt(attempt.downloadAttempts, new Date()) : null;
    await db
      .update(menaWhatsAppMessageMedia)
      .set({
        downloadStatus: retry ? "pending" : "failed",
        failureReason: errorCode,
        lastError: errorCode,
        nextAttemptAt: retryAt,
        updatedAt: new Date(),
      })
      .where(identity);
    console.error("WhatsApp media download attempt failed", {
      messageId: message.id,
      mediaIndex,
      attempt: attempt.downloadAttempts,
      retryAt: retryAt?.toISOString() ?? null,
      reason: errorCode,
    });
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
      console.error("WhatsApp media source entry is invalid", {
        messageId: message.id,
        reason: "MEDIA_SOURCE_INVALID",
      });
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

let thumbnailWorkerRunning = false;

export async function processWhatsAppMediaThumbnailQueue(): Promise<number> {
  if (thumbnailWorkerRunning) return 0;
  thumbnailWorkerRunning = true;

  try {
    const pending = await db
      .select()
      .from(menaWhatsAppMessageMedia)
      .where(and(
        eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
        like(menaWhatsAppMessageMedia.mimeType, "image/%"),
        notLike(menaWhatsAppMessageMedia.mimeType, "%svg%"),
        isNull(menaWhatsAppMessageMedia.thumbnailPath),
      ))
      .orderBy(asc(menaWhatsAppMessageMedia.updatedAt))
      .limit(3);

    let completed = 0;
    for (const media of pending) {
      try {
        if (!media.mimeType) continue;
        const original = media.storageProvider === "supabase"
          ? await readMediaObject(media.storagePath)
          : await readLocalMedia(media.storagePath);
        const thumbnail = await createMediaThumbnail(original);
        let thumbnailPath = thumbnailObjectPath(media.storagePath);
        if (media.storageProvider === "supabase") {
          await storeMediaObject(thumbnailPath, thumbnail, "image/webp");
        } else {
          thumbnailPath = path.join(path.dirname(media.storagePath), path.basename(thumbnailPath));
          await mkdir(path.dirname(thumbnailPath), { recursive: true });
          await writeFile(thumbnailPath, thumbnail);
        }
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
        console.error("WhatsApp thumbnail job failed", {
          mediaId: media.id,
          workspaceId: media.workspaceId,
          error: mediaErrorCode(error),
        });
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
