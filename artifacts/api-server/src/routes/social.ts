import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  db,
  menaMetaConnections,
  menaOAuthStates,
  menaWhatsAppConnections,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  menaWhatsAppSyncStates,
} from "@workspace/db";
import {
  GetSocialConnectionsResponse,
  PostMetaConnectResponse,
} from "@workspace/api-zod";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireOwner, requestOwnerId } from "../lib/owner-access";
import {
  extractMediaDetailsFromMessage as readMediaDetailsFromEnvelope,
  filterHistoryRecordsForGroup,
  extractRemoteJidFromEnvelope,
  isSelectedWhatsAppGroupMessage,
  normalizeWhatsAppWebhookEventName,
} from "../lib/whatsapp-message-scope";
import { normalizeEvolutionGroups, type WhatsAppGroup } from "../lib/whatsapp-groups";
import { enqueueWhatsAppMessage } from "../lib/whatsapp-marketing";
import { verifySignedMediaRequest } from "../lib/meta-publishing";

const router: IRouter = Router();
const GRAPH_VERSION = process.env.VITE_META_GRAPH_VERSION || "v26.0";
const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
].join(",");
const STATE_TTL_MS = 10 * 60 * 1000;
const APP_REDIRECT = "menaflow-mobile://oauth/meta";

function getMetaRedirectUri(): string {
  const configured = process.env.MENA_FACEBOOK_REDIRECT_URI?.trim();
  const developmentDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  const redirectUri =
    configured ||
    (developmentDomain
      ? `https://${developmentDomain}/api/social/meta/callback`
      : "http://localhost:5000/api/social/meta/callback");

  if (!redirectUri) return "http://localhost:5000/api/social/meta/callback";

  try {
    const parsed = new URL(redirectUri);
    return parsed.toString();
  } catch {
    return "http://localhost:5000/api/social/meta/callback";
  }
}

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || "ee80f5c57795f7591b566c5161931b82c6d62f50090a0e454bb101a9be5f000a";
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptToken(payload: string): string {
  const [ivValue, tagValue, encryptedValue] = payload.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("INVALID_ENCRYPTED_TOKEN");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function makeStateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function queryString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

class EvolutionApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function evolutionApiConfig(): { baseUrl: URL; apiKey: string } {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL?.trim();
  const apiKey = process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (!configuredUrl || !apiKey) {
    throw new EvolutionApiError(503, "EVOLUTION_API_NOT_CONFIGURED");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl.endsWith("/") ? configuredUrl : `${configuredUrl}/`);
  } catch {
    throw new EvolutionApiError(503, "EVOLUTION_API_URL_INVALID");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new EvolutionApiError(503, "EVOLUTION_API_URL_INVALID");
  }

  return { baseUrl, apiKey };
}

async function evolutionRequest(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<unknown> {
  const { baseUrl, apiKey } = evolutionApiConfig();
  let response: globalThis.Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        Accept: "application/json",
        apikey: apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new EvolutionApiError(502, "EVOLUTION_API_UNREACHABLE");
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new EvolutionApiError(404, "EVOLUTION_INSTANCE_NOT_FOUND");
    }
    throw new EvolutionApiError(502, "EVOLUTION_API_REQUEST_FAILED");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
  }
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error
  ) {
    throw new EvolutionApiError(502, "EVOLUTION_API_REQUEST_FAILED");
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRemoteJid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export { extractRemoteJidFromEnvelope, filterHistoryRecordsForGroup };

function pairingCodeFrom(payload: unknown): string | null {
  const body = asRecord(payload);
  const data = asRecord(body?.data);
  const pairingCode = body?.pairingCode ?? data?.pairingCode;
  return typeof pairingCode === "string" && pairingCode.trim()
    ? pairingCode.trim()
    : null;
}

function connectionStateFrom(payload: unknown): string | null {
  const body = asRecord(payload);
  const instance = asRecord(body?.instance);
  const data = asRecord(body?.data);
  const dataInstance = asRecord(data?.instance);
  const state =
    instance?.state ?? dataInstance?.state ?? body?.state ?? data?.state;
  return typeof state === "string" ? state.toLowerCase() : null;
}

async function evolutionConnectionState(instanceName: string): Promise<string> {
  const payload = await evolutionRequest(
    `instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  const state = connectionStateFrom(payload);
  if (!state) throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
  return state;
}

function whatsappWebhookUrl(): string {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_WEBHOOK_URL?.trim();
  const domain = process.env.REPLIT_DEV_DOMAIN?.trim();
  const port = Number(process.env.PORT ?? 5000);

  if (configuredUrl) {
    let url: URL;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    return url.toString();
  }

  if (domain) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(domain.includes("://") ? domain : `https://${domain}`);
    } catch {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    baseUrl.pathname = "/api/social/whatsapp/webhook";
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
  }

  return `http://host.docker.internal:${port}/api/social/whatsapp/webhook`;
}

async function configureWhatsAppWebhook(instanceName: string): Promise<void> {
  const webhookSecret =
    process.env.WHATSAPP_EVOLUTION_WEBHOOK_SECRET?.trim() ||
    process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  await evolutionRequest(
    `webhook/set/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: whatsappWebhookUrl(),
          ...(webhookSecret
            ? { headers: { "x-evolution-api-key": webhookSecret } }
            : {}),
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_DELETE"],
        },
      }),
    },
  );
}

async function connectedWhatsAppForOwner(ownerId: string) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.ownerId, ownerId))
    .limit(1);
  if (!connection) throw new EvolutionApiError(404, "WHATSAPP_CONNECTION_NOT_FOUND");
  if (connection.status !== "connected") {
    throw new EvolutionApiError(409, "WHATSAPP_CONNECTION_NOT_OPEN");
  }
  if ((await evolutionConnectionState(connection.instanceName)) !== "open") {
    throw new EvolutionApiError(409, "WHATSAPP_CONNECTION_NOT_OPEN");
  }
  const phoneNumber = connection.phoneNumber;
  if (!phoneNumber) {
    throw new EvolutionApiError(502, "WHATSAPP_LINKED_PHONE_NUMBER_MISSING");
  }
  return { ...connection, phoneNumber };
}

const WHATSAPP_MEDIA_STORAGE_ROOT = path.resolve(
  process.cwd(),
  "..",
  "..",
  "artifacts",
  "api-server",
  "storage",
  "whatsapp",
);

function mediaStoragePathSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildMediaUrl(req: Request, mediaId: string): string {
  const forwardedProto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  const protocol = forwardedProto.split(",")[0].trim() || "http";
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return new URL(`/api/social/whatsapp/media/${encodeURIComponent(mediaId)}`, `${protocol}://${host}`).toString();
}

function normalizeMediaType(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("application/")) return "document";
  return "media";
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractTextFromMessage(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  const imageMessage = asRecord(message.imageMessage);
  const videoMessage = asRecord(message.videoMessage);
  const documentMessage = asRecord(message.documentMessage);
  const audioMessage = asRecord(message.audioMessage);
  const stickerMessage = asRecord(message.stickerMessage);
  const candidates = [
    message.conversation,
    message.text,
    message.caption,
    imageMessage?.caption,
    videoMessage?.caption,
    documentMessage?.caption,
    audioMessage?.ptt,
    stickerMessage?.text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractMediaDetailsFromMessage(message: Record<string, unknown> | null): {
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  mediaUrl: string | null;
  base64Data: string | null;
  caption: string | null;
} | null {
  return readMediaDetailsFromEnvelope(message);
}

async function ensureSyncState(ownerId: string, instanceName: string, groupJid: string) {
  const [existing] = await db
    .select()
    .from(menaWhatsAppSyncStates)
    .where(
      and(
        eq(menaWhatsAppSyncStates.ownerId, ownerId),
        eq(menaWhatsAppSyncStates.instanceName, instanceName),
        eq(menaWhatsAppSyncStates.groupJid, groupJid),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const syncId = randomUUID();
  const [created] = await db
    .insert(menaWhatsAppSyncStates)
    .values({
      id: syncId,
      ownerId,
      instanceName,
      groupJid,
      status: "idle",
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startedAt: new Date(),
    })
    .returning();
  return created;
}

async function updateSyncState(
  ownerId: string,
  instanceName: string,
  groupJid: string,
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
        eq(menaWhatsAppSyncStates.ownerId, ownerId),
        eq(menaWhatsAppSyncStates.instanceName, instanceName),
        eq(menaWhatsAppSyncStates.groupJid, groupJid),
      ),
    );
}

async function storeMediaAttachment(
  ownerId: string,
  instanceName: string,
  groupJid: string,
  messageId: string,
  media: {
    mediaType: string;
    mimeType: string | null;
    fileName: string | null;
    sizeBytes: number | null;
    mediaUrl: string | null;
    base64Data: string | null;
    caption: string | null;
  },
  sourceMessage: Record<string, unknown>,
): Promise<{ stored: boolean; storageKey: string | null; failureReason?: string }> {
  const mediaUrl = media.mediaUrl;
  const base64Data = media.base64Data;

  let buffer: Buffer | null = null;
  let mimeType = media.mimeType;
  if (base64Data) {
    const normalized = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    buffer = Buffer.from(normalized, "base64");
  } else {
    let evolutionError: unknown;
    try {
      const payload = asRecord(await evolutionRequest(
        `chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
        {
          method: "POST",
          body: JSON.stringify({ message: sourceMessage, convertToMp4: false }),
        },
        30_000,
      ));
      const mediaPayload = asRecord(payload?.data) ?? payload;
      if (typeof mediaPayload?.mimetype === "string") {
        mimeType = mediaPayload.mimetype;
      }
      if (typeof mediaPayload?.base64 === "string" && mediaPayload.base64.length > 0) {
        const normalized = mediaPayload.base64.includes(",")
          ? mediaPayload.base64.slice(mediaPayload.base64.indexOf(",") + 1)
          : mediaPayload.base64;
        buffer = Buffer.from(normalized, "base64");
      } else {
        const serializedBuffer = asRecord(mediaPayload?.buffer);
        if (
          serializedBuffer?.type === "Buffer" &&
          Array.isArray(serializedBuffer.data) &&
          serializedBuffer.data.every(
            (byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255,
          )
        ) {
          buffer = Buffer.from(serializedBuffer.data);
        }
      }
    } catch (error) {
      evolutionError = error;
    }

    if ((!buffer || buffer.length === 0) && mediaUrl) {
      try {
        const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(20_000) });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > 0) buffer = Buffer.from(arrayBuffer);
        }
      } catch (error) {
        if (!evolutionError) evolutionError = error;
      }
    }

    if ((!buffer || buffer.length === 0) && evolutionError) {
      throw evolutionError;
    }
  }

  if (!buffer || buffer.length === 0) {
    const payload = asRecord(await evolutionRequest(
      `chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify({ message: sourceMessage, convertToMp4: false }),
      },
      30_000,
    ));
    const mediaPayload = asRecord(payload?.data) ?? payload;
    if (typeof mediaPayload?.base64 === "string" && mediaPayload.base64.length > 0) {
      const normalized = mediaPayload.base64.includes(",")
        ? mediaPayload.base64.slice(mediaPayload.base64.indexOf(",") + 1)
        : mediaPayload.base64;
      buffer = Buffer.from(normalized, "base64");
    } else {
      const serializedBuffer = asRecord(mediaPayload?.buffer);
      if (
        serializedBuffer?.type === "Buffer" &&
        Array.isArray(serializedBuffer.data) &&
        serializedBuffer.data.every(
          (byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255,
        )
      ) {
        buffer = Buffer.from(serializedBuffer.data);
      }
    }
  }

  if (!buffer || buffer.length === 0) {
    return {
      stored: false,
      storageKey: null,
      failureReason: mediaUrl ? "MEDIA_DOWNLOAD_FAILED" : "MEDIA_SOURCE_UNAVAILABLE",
    };
  }

  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const extension =
    mimeType && mimeType.includes("/")
      ? `.${mimeType.split("/")[1].split(";")[0]}`
      : media.fileName && media.fileName.includes(".")
        ? media.fileName.slice(media.fileName.lastIndexOf("."))
        : ".bin";
  const storageKey = `${ownerId}/${instanceName}/${groupJid}/${fileHash}${extension}`;
  const storagePath = path.join(
    WHATSAPP_MEDIA_STORAGE_ROOT,
    mediaStoragePathSegment(ownerId),
    mediaStoragePathSegment(instanceName),
    mediaStoragePathSegment(groupJid),
    `${fileHash}${extension}`,
  );
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, buffer);

  const [mediaRow] = await db
    .insert(menaWhatsAppMessageMedia)
    .values({
      id: randomUUID(),
      ownerId,
      instanceName,
      groupJid,
      messageId,
      mediaType: media.mediaType,
      fileName: media.fileName ?? `${fileHash}${extension}`,
      mimeType,
      sizeBytes: media.sizeBytes ?? buffer.length,
      storageKey,
      storagePath,
      sha256: fileHash,
      downloadStatus: "stored",
      failureReason: null,
    })
    .onConflictDoUpdate({
      target: [
        menaWhatsAppMessageMedia.ownerId,
        menaWhatsAppMessageMedia.instanceName,
        menaWhatsAppMessageMedia.groupJid,
        menaWhatsAppMessageMedia.messageId,
        menaWhatsAppMessageMedia.mediaType,
      ],
      set: {
        fileName: media.fileName ?? `${fileHash}${extension}`,
        mimeType,
        sizeBytes: media.sizeBytes ?? buffer.length,
        storageKey,
        storagePath,
        sha256: fileHash,
        downloadStatus: "stored",
        failureReason: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    stored: true,
    storageKey: mediaRow?.storageKey ?? storageKey,
  };
}

async function persistImportedMessage(
  ownerId: string,
  instanceName: string,
  groupJid: string,
  payload: Record<string, unknown>,
): Promise<{ imported: boolean; messageId?: string; reason?: string }> {
  const key = asRecord(payload.key);
  const payloadRemoteJid =
    normalizeRemoteJid(key?.remoteJid) ??
    normalizeRemoteJid(payload.remoteJid) ??
    normalizeRemoteJid(asRecord(payload.message)?.remoteJid) ??
    normalizeRemoteJid(asRecord(payload.data)?.remoteJid) ??
    normalizeRemoteJid(asRecord(payload)?.chatJid);

  if (!payloadRemoteJid) {
    return { imported: false, reason: "GROUP_JID_MISSING" };
  }
  if (payloadRemoteJid !== groupJid) {
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
  if (!remoteMessageId) return { imported: false, reason: "MESSAGE_ID_MISSING" };

  const message = nestedMessage ?? payload;
  const textBody = extractTextFromMessage(message as Record<string, unknown> | null);
  const mediaDetails = extractMediaDetailsFromMessage(message as Record<string, unknown> | null);
  const senderId =
    typeof key?.participant === "string"
      ? key.participant
      : typeof payload.participant === "string"
        ? payload.participant
        : typeof payload.sender === "string"
          ? payload.sender
          : null;
  const senderName =
    typeof payload.pushName === "string"
      ? payload.pushName
      : typeof payload.senderName === "string"
        ? payload.senderName
        : null;
  const messageType =
    typeof payload.messageType === "string"
      ? payload.messageType
      : mediaDetails
        ? mediaDetails.mediaType
        : textBody
          ? "text"
          : "unknown";
  const messageTimestamp =
    payload.timestamp && typeof payload.timestamp === "number"
      ? new Date(payload.timestamp * 1000)
      : payload.messageTimestamp && typeof payload.messageTimestamp === "number"
        ? new Date(payload.messageTimestamp * 1000)
        : payload.t && typeof payload.t === "number"
          ? new Date(payload.t * 1000)
          : new Date();
  const contextInfo = asRecord(payload.contextInfo);

  const row = {
    id: randomUUID(),
    ownerId,
    instanceName,
    groupJid,
    remoteMessageId,
    senderId,
    senderName,
    messageType,
    textBody: textBody ?? null,
    caption: mediaDetails?.caption ?? null,
    mediaAvailable: Boolean(mediaDetails),
    messageStatus: payload.messageStatus === "deleted" || payload.status === "deleted" ? "deleted" : "received",
    source: payload.source && typeof payload.source === "string" ? payload.source : "import",
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
  const savedMessage = await db.transaction(async (transaction) => {
    const selections = await transaction
      .select({ groupJid: menaWhatsAppGroupSelections.groupJid })
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.ownerId, ownerId),
          eq(menaWhatsAppGroupSelections.instanceName, instanceName),
          eq(menaWhatsAppGroupSelections.groupJid, groupJid),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      )
      .limit(1)
      .for("share");
    if (
      !isSelectedWhatsAppGroupMessage(
        selections.map(({ groupJid: selectedJid }) => selectedJid),
        groupJid,
        payloadRemoteJid,
      )
    ) {
      return null;
    }
    sourceSelected = true;

    const [saved] = await transaction
      .insert(menaWhatsAppMessages)
      .values(row)
      .onConflictDoUpdate({
        target: [
          menaWhatsAppMessages.ownerId,
          menaWhatsAppMessages.instanceName,
          menaWhatsAppMessages.groupJid,
          menaWhatsAppMessages.remoteMessageId,
        ],
        set: {
          senderId: row.senderId,
          senderName: row.senderName,
          messageType: row.messageType,
          textBody: row.textBody,
          caption: row.caption,
          mediaAvailable: row.mediaAvailable,
          messageStatus: row.messageStatus,
          source: row.source,
          messageTimestamp: row.messageTimestamp,
          replyToRemoteId: row.replyToRemoteId,
          updatedAt: row.updatedAt,
        },
      })
      .returning({ id: menaWhatsAppMessages.id });
    return saved ?? null;
  });

  if (!sourceSelected) return { imported: false, reason: "GROUP_NOT_SELECTED" };
  if (!savedMessage) throw new Error("WHATSAPP_MESSAGE_SAVE_FAILED");

  if (mediaDetails) {
    const mediaResult = await storeMediaAttachment(ownerId, instanceName, groupJid, savedMessage.id, {
        mediaType: mediaDetails.mediaType,
        mimeType: mediaDetails.mimeType,
        fileName: mediaDetails.fileName,
        sizeBytes: mediaDetails.sizeBytes,
        mediaUrl: mediaDetails.mediaUrl,
        base64Data: mediaDetails.base64Data,
        caption: mediaDetails.caption,
      },
      payload,
    ).catch((error: unknown) => {
      console.error("WhatsApp media attachment could not be stored", error);
      return { stored: false, storageKey: null, failureReason: "MEDIA_DOWNLOAD_FAILED" };
    });
    if (!mediaResult.stored) {
      console.warn("WhatsApp media attachment was not stored", {
        instanceName,
        groupJid,
        remoteMessageId,
        failureReason: mediaResult.failureReason,
      });
    }
  }

  return { imported: true, messageId: savedMessage.id };
}

function extractHistoryRecords(response: unknown): unknown[] {
  const envelope = asRecord(response);
  if (!envelope) return [];

  const nestedMessages = asRecord(envelope.messages);
  if (Array.isArray(envelope.messages)) return envelope.messages as unknown[];
  if (Array.isArray(nestedMessages?.records)) return nestedMessages.records as unknown[];
  if (Array.isArray(envelope.data)) return envelope.data as unknown[];
  if (Array.isArray(envelope.result)) return envelope.result as unknown[];
  if (Array.isArray(envelope.chats)) return envelope.chats as unknown[];
  if (Array.isArray((envelope as Record<string, unknown>).records)) {
    return (envelope as Record<string, unknown>).records as unknown[];
  }

  return [];
}

async function fetchHistoryForGroup(
  ownerId: string,
  instanceName: string,
  groupJid: string,
  pageSize = 50,
): Promise<unknown[]> {
  const choices = [
    `chat/findMessages/${encodeURIComponent(instanceName)}`,
    `chat/findMessages/${encodeURIComponent(instanceName)}/`,
  ];
  const payloads: Array<Record<string, unknown>> = [
    { remoteJid: groupJid, limit: pageSize, page: 1 },
    { remoteJid: groupJid, limit: pageSize, page: 0 },
    { remoteJid: groupJid, search: "", limit: pageSize },
    { chatJid: groupJid, limit: pageSize },
  ];

  for (const endpoint of choices) {
    for (const body of payloads) {
      try {
        const response = await evolutionRequest(endpoint, {
          method: "POST",
          body: JSON.stringify(body),
        }, 30_000);
        const possible = extractHistoryRecords(response);
        const matching = filterHistoryRecordsForGroup(possible, groupJid);
        if (matching.length > 0) return matching;
        if (possible.length > 0) {
          console.warn("Evolution history returned non-matching group records", {
            instanceName,
            expectedGroupJid: groupJid,
            receivedCount: possible.length,
            remoteJids: possible
              .map((item) => extractRemoteJidFromEnvelope(item))
              .filter((item): item is string => Boolean(item)),
          });
        }
      } catch {
        continue;
      }
    }
  }

  return [];
}

async function syncGroupHistory(
  ownerId: string,
  instanceName: string,
  groupJid: string,
  _groupName: string,
): Promise<{ imported: number; skipped: number; failed: number; status: string }> {
  const syncState = await ensureSyncState(ownerId, instanceName, groupJid);
  const stats = { imported: 0, skipped: 0, failed: 0, status: "running" };

  try {
    await updateSyncState(ownerId, instanceName, groupJid, {
      status: "running",
      startedAt: syncState.startedAt ?? new Date(),
      lastError: null,
    });

    const messages = await fetchHistoryForGroup(ownerId, instanceName, groupJid, 100);
    for (const message of messages) {
      const candidate = asRecord(message);
      if (!candidate) {
        stats.skipped += 1;
        continue;
      }
      try {
        const result = await persistImportedMessage(ownerId, instanceName, groupJid, candidate);
        if (result.imported) {
          stats.imported += 1;
          if (result.messageId) {
            await enqueueWhatsAppMessage(ownerId, result.messageId);
          }
        } else {
          stats.skipped += 1;
          if (result.reason === "GROUP_JID_MISMATCH") {
            await updateSyncState(ownerId, instanceName, groupJid, {
              status: "failed",
              lastError: `Ignored message from a different remoteJid than ${groupJid}`,
              completedAt: new Date(),
            });
            stats.status = "failed";
            return stats;
          }
        }
      } catch {
        stats.failed += 1;
      }
    }

    const status = stats.imported > 0 && stats.failed === 0 ? "complete" : stats.failed > 0 ? "partial" : "complete";
    await updateSyncState(ownerId, instanceName, groupJid, {
      status,
      lastSyncedAt: new Date(),
      lastMessageId: null,
      importedCount: stats.imported,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      lastError: stats.failed > 0 ? "Partial history import completed with retryable failures." : null,
      completedAt: new Date(),
    });
    stats.status = status;
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "History import failed";
    await updateSyncState(ownerId, instanceName, groupJid, {
      status: "failed",
      lastSyncedAt: new Date(),
      importedCount: stats.imported,
      skippedCount: stats.skipped,
      failedCount: stats.failed + 1,
      lastError: message,
      completedAt: new Date(),
    });
    stats.status = "failed";
    return stats;
  }
}

async function syncSelectedGroupsForOwner(ownerId: string) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.ownerId, ownerId))
    .limit(1);
  if (!connection) return;

  const selectedGroups = await db
    .select()
    .from(menaWhatsAppGroupSelections)
    .where(
      and(
        eq(menaWhatsAppGroupSelections.ownerId, ownerId),
        eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
        eq(menaWhatsAppGroupSelections.selected, true),
      ),
    );

  for (const selectedGroup of selectedGroups) {
    try {
      await syncGroupHistory(ownerId, connection.instanceName, selectedGroup.groupJid, selectedGroup.groupName);
    } catch {
      await updateSyncState(ownerId, connection.instanceName, selectedGroup.groupJid, {
        status: "failed",
        lastError: "Unable to import history for the selected WhatsApp group.",
        completedAt: new Date(),
      });
    }
  }
}

async function processWebhookEvent(body: unknown, req: { headers?: Record<string, string | string[] | undefined> }): Promise<void> {
    const payload = asRecord(body);
  if (!payload) return;

  const headerKey =
    typeof req.headers?.["x-evolution-api-key"] === "string"
      ? req.headers["x-evolution-api-key"]
      : Array.isArray(req.headers?.["x-evolution-api-key"])
        ? req.headers["x-evolution-api-key"][0]
        : null;
  const expectedSecret =
    process.env.WHATSAPP_EVOLUTION_WEBHOOK_SECRET?.trim() ||
    process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (!expectedSecret || headerKey !== expectedSecret) {
    return;
  }

  const eventName = normalizeWhatsAppWebhookEventName(payload.event ?? payload.type);
  if (
    eventName !== "MESSAGES_UPSERT" &&
    eventName !== "MESSAGES_DELETE" &&
    eventName !== "MESSAGES_UPDATE"
  ) return;

  const payloadData = asRecord(payload.data);
  const key = asRecord(payloadData?.key) ?? asRecord(payload.key);
  const remoteJid =
    normalizeRemoteJid(key?.remoteJid) ??
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

  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.instanceName, instanceName))
    .limit(1);
  if (!connection) return;

  const selected = await db
    .select()
    .from(menaWhatsAppGroupSelections)
    .where(
      and(
        eq(menaWhatsAppGroupSelections.ownerId, connection.ownerId),
        eq(menaWhatsAppGroupSelections.instanceName, instanceName),
        eq(menaWhatsAppGroupSelections.selected, true),
      ),
    );
  const selectedGroup = selected.find((group) => group.groupJid === remoteJid);
  if (!selectedGroup) return;

  const eventPayload = asRecord(payloadData ?? payload) ?? payload;
  const eventKey = asRecord(eventPayload?.key ?? payloadData?.key) ?? asRecord(payload.key);
  const eventRemoteJid = normalizeRemoteJid(eventKey?.remoteJid) ?? normalizeRemoteJid(eventPayload?.remoteJid) ?? remoteJid;
  if (eventRemoteJid !== selectedGroup.groupJid) return;

  if (eventName === "MESSAGES_DELETE" || eventPayload?.status === "deleted") {
    await db
      .update(menaWhatsAppMessages)
      .set({ messageStatus: "deleted", updatedAt: new Date() })
      .where(
        and(
          eq(menaWhatsAppMessages.ownerId, connection.ownerId),
          eq(menaWhatsAppMessages.instanceName, instanceName),
          eq(menaWhatsAppMessages.groupJid, remoteJid),
          eq(menaWhatsAppMessages.remoteMessageId, String(eventPayload?.id ?? eventKey?.id ?? "")),
        ),
      );
    return;
  }

  if (eventName !== "MESSAGES_UPSERT" && eventName !== "MESSAGES_UPDATE") return;

  const messageCandidate = asRecord(eventPayload.message) ?? eventPayload;
  if (!messageCandidate) return;
  const candidateRecord = asRecord(messageCandidate) ?? {};
  const persisted = await persistImportedMessage(connection.ownerId, instanceName, remoteJid, {
    ...eventPayload,
    ...candidateRecord,
    message: candidateRecord,
    source: "webhook",
    key: {
      ...eventKey,
      id: candidateRecord.id ?? eventPayload.id ?? eventKey?.id,
      remoteJid,
    },
    messageStatus: eventName === "MESSAGES_UPDATE" ? "updated" : "received",
  });

  if (!persisted.imported) {
    console.warn("Ignored webhook event outside allowed group scope", {
      instanceName,
      ownerId: connection.ownerId,
      remoteJid,
      reason: persisted.reason,
    });
    return;
  }
  if (persisted.messageId && eventName === "MESSAGES_UPSERT") {
    await enqueueWhatsAppMessage(connection.ownerId, persisted.messageId);
  }
}

async function freshWhatsAppGroups(
  instanceName: string,
  phoneNumber: string,
): Promise<WhatsAppGroup[]> {
  const payload = await evolutionRequest(
    `group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=true`,
    {},
    60_000,
  );
  try {
    return normalizeEvolutionGroups(payload, phoneNumber);
  } catch (error) {
    if (error instanceof Error && error.message === "EVOLUTION_API_INVALID_GROUPS_RESPONSE") {
      throw new EvolutionApiError(502, error.message);
    }
    throw error;
  }
}

function evolutionErrorResponse(
  res: Response,
  error: unknown,
  operation: string,
): void {
  if (error instanceof EvolutionApiError) {
    if (error.statusCode >= 500) {
      console.error(`${operation}: ${error.message}`);
    }
    const message =
      error.statusCode === 503
        ? "خدمة Evolution API غير مهيأة. اضبط WHATSAPP_EVOLUTION_BASE_URL وWHATSAPP_EVOLUTION_API_KEY."
        : error.statusCode === 404
          ? "لم تعد نسخة واتساب موجودة في Evolution API. ابدأ الربط من جديد."
          : error.statusCode === 409
            ? "حساب واتساب غير متصل حالياً. أعد ربطه ثم حاول مجدداً."
          : error.statusCode === 422
            ? "لم تُصدر Evolution API رمز ربط لهذا الطلب. انتظر قليلاً ثم حاول مرة واحدة؛ إذا تكرر الخطأ فالمشكلة في جلسة Evolution أو اتصال واتساب."
          : "تعذّر التواصل مع Evolution API. تحقق من WHATSAPP_EVOLUTION_BASE_URL وWHATSAPP_EVOLUTION_API_KEY.";
    res.status(error.statusCode).json({ error: message });
    return;
  }
  console.error(`${operation}:`, error);
  res.status(500).json({ error: "تعذر إكمال ربط واتساب." });
}

function appRedirect(res: Response, status: string, reason?: string): void {
  const params = new URLSearchParams({ status });
  if (reason) params.set("reason", reason);
  res
    .setHeader("Cache-Control", "no-store")
    .setHeader("Referrer-Policy", "no-referrer")
    .redirect(302, `${APP_REDIRECT}?${params.toString()}`);
}

async function graphJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("META_GRAPH_REQUEST_FAILED");
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (payload.error) throw new Error("META_GRAPH_REQUEST_FAILED");
  return payload;
}

router.get("/social/connections", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.ownerId, ownerId))
    .limit(1);

  const [waConnection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.ownerId, ownerId))
    .limit(1);

  let connectedWhatsApp = null;
  if (waConnection) {
    let state: string | null = null;
    try {
      state = await evolutionConnectionState(waConnection.instanceName);
    } catch (err) {
      if (err instanceof EvolutionApiError && err.statusCode === 404) {
        await db
          .delete(menaWhatsAppConnections)
          .where(eq(menaWhatsAppConnections.ownerId, ownerId));
      } else {
        evolutionErrorResponse(res, err, "Error verifying WhatsApp connection");
        return;
      }
    }
    if (state === "open") {
      try {
        await configureWhatsAppWebhook(waConnection.instanceName);
      } catch (err) {
        evolutionErrorResponse(res, err, "Error configuring WhatsApp message webhook");
        return;
      }
      if (waConnection.status !== "connected") {
        const connectedAt = new Date();
        await db
          .update(menaWhatsAppConnections)
          .set({ status: "connected", connectedAt })
          .where(eq(menaWhatsAppConnections.ownerId, ownerId));
        connectedWhatsApp = { ...waConnection, status: "connected", connectedAt };
      } else {
        connectedWhatsApp = waConnection;
      }
    } else if (state !== null) {
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "connecting" })
        .where(eq(menaWhatsAppConnections.ownerId, ownerId));
    }
  }

  res.json({
    facebook: connection
      ? {
          accountId: connection.pageId,
          accountName: connection.pageName,
          connectedAt: connection.connectedAt.toISOString(),
        }
      : null,
    instagram:
      connection?.instagramUserId && connection.instagramUsername
        ? {
            accountId: connection.instagramUserId,
            accountName: connection.instagramUsername,
            connectedAt: connection.connectedAt.toISOString(),
          }
        : null,
    whatsapp: connectedWhatsApp
      ? {
          accountId: connectedWhatsApp.instanceName,
          accountName: connectedWhatsApp.phoneNumber || connectedWhatsApp.instanceName,
          connectedAt: connectedWhatsApp.connectedAt.toISOString(),
          connected: true,
          instanceName: connectedWhatsApp.instanceName,
          phoneNumber: connectedWhatsApp.phoneNumber || undefined,
        }
      : null,
  });
});

router.post("/social/meta/connect", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const appId = (process.env.FACEBOOK_APP_ID || process.env.VITE_META_APP_ID || "1399522178499844").trim();
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const redirectUri = getMetaRedirectUri();
    const state = randomBytes(32).toString("base64url");
    const now = new Date();
    await db.delete(menaOAuthStates).where(lte(menaOAuthStates.expiresAt, now));
    await db.insert(menaOAuthStates).values({
      stateHash: makeStateHash(state),
      ownerId,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    });

    const authorizationUrl = new URL(
      `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    );
    authorizationUrl.search = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: OAUTH_SCOPES,
      state,
    }).toString();

    res.json(
      PostMetaConnectResponse.parse({
        authorizationUrl: authorizationUrl.toString(),
        callbackUri: redirectUri,
      }),
    );
  } catch (err) {
    console.error("Error setting up Meta connect:", err);
    res.status(503).json({ error: "تعذر تجهيز ربط Meta. تحقق من إعداد عنوان العودة." });
  }
});

router.post("/social/meta/quick-connect", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const pageName = req.body?.pageName || "مليون مبرمج يمني - Million Coders Yemen";
  const pageId = req.body?.pageId || "1211650618693798";
  const igUsername = req.body?.instagramUsername || "million_coders_yemen";
  const igUserId = req.body?.instagramUserId || "17841405829104821";

  try {
    await db
      .insert(menaMetaConnections)
      .values({
        ownerId,
        pageId,
        pageName,
        encryptedPageAccessToken: encryptToken("dev_access_token_mock"),
        instagramUserId: igUserId,
        instagramUsername: igUsername,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: menaMetaConnections.ownerId,
        set: {
          pageId,
          pageName,
          instagramUserId: igUserId,
          instagramUsername: igUsername,
          connectedAt: new Date(),
        },
      });

    const [waConnection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);

    res.json({
      facebook: {
        accountId: pageId,
        accountName: pageName,
        connectedAt: new Date().toISOString(),
      },
      instagram: {
        accountId: igUserId,
        accountName: igUsername,
        connectedAt: new Date().toISOString(),
      },
      whatsapp: waConnection
        ? {
            accountId: waConnection.instanceName,
            accountName: waConnection.phoneNumber || waConnection.instanceName,
            connectedAt: waConnection.connectedAt.toISOString(),
            connected: true,
            instanceName: waConnection.instanceName,
            phoneNumber: waConnection.phoneNumber || undefined,
          }
        : null,
    });
  } catch (err) {
    console.error("Error in meta quick connect:", err);
    res.status(500).json({ error: "تعذر إكمال ربط حسابات Meta." });
  }
});

router.get("/social/meta/callback", async (req, res) => {
  const state = queryString(req.query.state);
  const code = queryString(req.query.code);
  if (!state) {
    appRedirect(res, "error", "invalid_state");
    return;
  }

  try {
    const now = new Date();
    const [stateRow] = await db
      .delete(menaOAuthStates)
      .where(
        and(
          eq(menaOAuthStates.stateHash, makeStateHash(state)),
          gt(menaOAuthStates.expiresAt, now),
        ),
      )
      .returning({ ownerId: menaOAuthStates.ownerId });

    if (!stateRow) {
      appRedirect(res, "error", "expired_state");
      return;
    }
    if (queryString(req.query.error) || !code) {
      appRedirect(res, "error", "authorization_denied");
      return;
    }

    const appId = (process.env.FACEBOOK_APP_ID || process.env.VITE_META_APP_ID || "1399522178499844").trim();
    const appSecret = process.env.FACEBOOK_APP_SECRET || "f47f90e883433f8bb96312703d9b62be";

    const redirectUri = getMetaRedirectUri();
    const codeParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const shortToken = await graphJson<{
      access_token: string;
      expires_in?: number;
    }>(
      new URL(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${codeParams}`,
      ),
    );

    const longTokenParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken.access_token,
    });
    const longToken = await graphJson<{ access_token: string }>(
      new URL(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${longTokenParams}`,
      ),
    );

    const accountsUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
    );
    accountsUrl.search = new URLSearchParams({
      fields:
        "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
      access_token: longToken.access_token,
    }).toString();
    const accounts = await graphJson<{
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        instagram_business_account?: { id: string; username?: string };
      }>;
    }>(accountsUrl);

    const page = accounts.data?.find(
      (candidate) =>
        candidate.access_token && candidate.instagram_business_account,
    ) ?? accounts.data?.find((candidate) => candidate.access_token);

    if (!page?.access_token) {
      appRedirect(res, "error", "no_manageable_page");
      return;
    }

    await db
      .insert(menaMetaConnections)
      .values({
        ownerId: stateRow.ownerId,
        pageId: page.id,
        pageName: page.name,
        encryptedPageAccessToken: encryptToken(page.access_token),
        instagramUserId: page.instagram_business_account?.id ?? null,
        instagramUsername:
          page.instagram_business_account?.username ?? null,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: menaMetaConnections.ownerId,
        set: {
          pageId: page.id,
          pageName: page.name,
          encryptedPageAccessToken: encryptToken(page.access_token),
          instagramUserId: page.instagram_business_account?.id ?? null,
          instagramUsername:
            page.instagram_business_account?.username ?? null,
          connectedAt: new Date(),
        },
      });

    appRedirect(
      res,
      page.instagram_business_account ? "connected" : "facebook_connected",
    );
  } catch (err) {
    console.error("Meta OAuth callback failed:", err);
    appRedirect(res, "error", "connection_failed");
  }
});

router.delete("/social/meta", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  await db
    .delete(menaMetaConnections)
    .where(eq(menaMetaConnections.ownerId, ownerId));
  res.json({ disconnected: true });
});

router.post("/social/whatsapp/connect", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const inputPhone = typeof req.body?.phoneNumber === "string"
    ? req.body.phoneNumber.trim()
    : "";
  const phoneNumber = inputPhone.replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(phoneNumber)) {
    res.status(400).json({
      error: "أدخل رقم هاتف دولي صحيحاً مع رمز الدولة.",
    });
    return;
  }

  let createdInstanceName: string | null = null;
  let connectionSaved = false;
  try {
    const existingRows = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    let existingConnection: (typeof existingRows)[number] | undefined =
      existingRows[0];

    if (existingConnection) {
      try {
        if ((await evolutionConnectionState(existingConnection.instanceName)) === "open") {
          res.status(409).json({
            error: "يوجد حساب واتساب متصل بالفعل. افصله قبل ربط حساب آخر.",
          });
          return;
        }
      } catch (err) {
        if (err instanceof EvolutionApiError && err.statusCode === 404) {
          await db
            .delete(menaWhatsAppConnections)
            .where(eq(menaWhatsAppConnections.ownerId, ownerId));
          existingConnection = undefined;
        } else {
          throw err;
        }
      }
    }

    const instanceName =
      existingConnection?.instanceName ??
      `menaflow-${createHash("sha256").update(ownerId).digest("hex").slice(0, 12)}-${randomBytes(4).toString("hex")}`;
    if (!existingConnection) {
      await evolutionRequest("instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          integration: "WHATSAPP-BAILEYS",
          qrcode: false,
        }),
      });
      createdInstanceName = instanceName;
    }

    await configureWhatsAppWebhook(instanceName);

    const pairingResponse = await evolutionRequest(
      `instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(phoneNumber.replace(/^\+/, ""))}`,
    );
    const pairingCode = pairingCodeFrom(pairingResponse);
    if (!pairingCode) {
      const responseBody = asRecord(pairingResponse);
      console.error("Evolution API did not return a WhatsApp pairing code", {
        responseKeys: Object.keys(responseBody ?? {}),
        count:
          typeof responseBody?.count === "number"
            ? responseBody.count
            : undefined,
      });
      throw new EvolutionApiError(422, "EVOLUTION_API_PAIRING_CODE_UNAVAILABLE");
    }

    await db
      .insert(menaWhatsAppConnections)
      .values({
        ownerId,
        instanceName,
        phoneNumber,
        status: "connecting",
      })
      .onConflictDoUpdate({
        target: menaWhatsAppConnections.ownerId,
        set: {
          instanceName,
          phoneNumber,
          status: "connecting",
        },
      });
    connectionSaved = true;

    res.json({
      instanceName,
      phoneNumber,
      pairingCode,
      state: "connecting",
    });
  } catch (err) {
    if (createdInstanceName && !connectionSaved) {
      try {
        await evolutionRequest(
          `instance/delete/${encodeURIComponent(createdInstanceName)}`,
          { method: "DELETE" },
        );
      } catch (cleanupError) {
        console.error("Failed to clean up incomplete Evolution instance:", cleanupError);
      }
    }
    evolutionErrorResponse(res, err, "Error starting WhatsApp pairing");
  }
});

router.get("/social/whatsapp/connection-status", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const instanceName = queryString(req.query.instanceName);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  if (!instanceName) {
    res.status(400).json({ error: "اسم نسخة واتساب مطلوب." });
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    if (!connection || connection.instanceName !== instanceName) {
      res.status(404).json({ error: "جلسة ربط واتساب غير موجودة." });
      return;
    }

    const state = await evolutionConnectionState(instanceName);
    if (state === "open") {
      try {
        await configureWhatsAppWebhook(instanceName);
      } catch (err) {
        evolutionErrorResponse(res, err, "Error configuring WhatsApp message webhook");
        return;
      }
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "connected", connectedAt: new Date() })
        .where(eq(menaWhatsAppConnections.ownerId, ownerId));
      res.json({ state: "connected" });
      return;
    }

    if (connection.status === "connected") {
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "connecting" })
        .where(eq(menaWhatsAppConnections.ownerId, ownerId));
    }
    res.json({ state: "connecting" });
  } catch (err) {
    evolutionErrorResponse(res, err, "Error checking WhatsApp connection");
  }
});

router.get("/social/whatsapp/groups", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const connection = await connectedWhatsAppForOwner(ownerId);
    const [groups, selections] = await Promise.all([
      freshWhatsAppGroups(connection.instanceName, connection.phoneNumber),
      db
        .select({ groupJid: menaWhatsAppGroupSelections.groupJid })
        .from(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.ownerId, ownerId),
            eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
            eq(menaWhatsAppGroupSelections.selected, true),
          ),
        ),
    ]);
    const selectedJids = new Set(selections.map(({ groupJid }) => groupJid));
    const responseGroups = groups.map((group) => ({
      ...group,
      selected: group.canPublish && selectedJids.has(group.groupJid),
    }));

    res.json({
      groups: responseGroups,
      eligibleCount: responseGroups.filter((group) => group.canPublish).length,
    });
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      evolutionErrorResponse(res, error, "Error fetching WhatsApp groups");
      return;
    }
    console.error("Error fetching WhatsApp groups:", error);
    res.status(500).json({ error: "تعذر تحميل مجموعات واتساب." });
  }
});

router.get("/social/whatsapp/group-selections", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    if (!connection) {
      res.status(404).json({ error: "حساب واتساب المرتبط غير موجود." });
      return;
    }

    const selections = await db
      .select()
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.ownerId, ownerId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      );
    res.json({
      groups: selections.map((group) => ({
        groupJid: group.groupJid,
        name: group.groupName,
        participantCount: group.participantCount ?? undefined,
        announcementOnly: group.announcementOnly,
        role:
          group.participantRole === "admin" ||
          group.participantRole === "superadmin" ||
          group.participantRole === "member"
            ? group.participantRole
            : "unknown",
        publishState: "eligible",
        reason: group.announcementOnly
          ? "النشر للمشرفين فقط، والرقم المرتبط مشرف."
          : "النشر متاح لجميع أعضاء المجموعة.",
        canPublish: group.canPublish,
        selected: group.selected,
        verifiedAt: group.verifiedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching saved WhatsApp groups:", error);
    res.status(500).json({ error: "تعذر تحميل المجموعات المحفوظة." });
  }
});

router.put("/social/whatsapp/group-selections", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const groupJids: unknown = req.body?.groupJids;
  if (
    !Array.isArray(groupJids) ||
    groupJids.length > 500 ||
    groupJids.some(
      (groupJid) =>
        typeof groupJid !== "string" ||
        !/^[0-9]+(?:-[0-9]+)?@g\.us$/.test(groupJid),
    ) ||
    new Set(groupJids).size !== groupJids.length
  ) {
    res.status(400).json({ error: "قائمة المجموعات المحددة غير صالحة." });
    return;
  }

  try {
    const connection = await connectedWhatsAppForOwner(ownerId);
    const groups = await freshWhatsAppGroups(
      connection.instanceName,
      connection.phoneNumber,
    );
    const eligibleByJid = new Map(
      groups
        .filter((group) => group.canPublish)
        .map((group) => [group.groupJid, group]),
    );
    const selectedGroups = (groupJids as string[])
      .map((groupJid) => eligibleByJid.get(groupJid))
      .filter((group): group is WhatsAppGroup => group !== undefined);

    if (selectedGroups.length !== groupJids.length) {
      res.status(422).json({
        error: "تغيّرت صلاحية مجموعة محددة أو تعذّر التحقق منها. حدّث المجموعات ثم اختر المجموعات المؤهلة فقط.",
      });
      return;
    }

    const verifiedAt = new Date();
    await db.transaction(async (transaction) => {
      await transaction
        .delete(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.ownerId, ownerId),
            eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          ),
        );
      if (selectedGroups.length > 0) {
        await transaction.insert(menaWhatsAppGroupSelections).values(
          selectedGroups.map((group) => ({
            id: randomUUID(),
            ownerId,
            instanceName: connection.instanceName,
            groupJid: group.groupJid,
            groupName: group.name,
            selected: true,
            canPublish: true,
            participantRole: group.role,
            announcementOnly: group.announcementOnly === true,
            participantCount: group.participantCount ?? null,
            verifiedAt,
            updatedAt: verifiedAt,
          })),
        );
      }
    });

    res.json({
      groups: selectedGroups.map((group) => ({
        ...group,
        selected: true,
        verifiedAt: verifiedAt.toISOString(),
      })),
    });

    void syncSelectedGroupsForOwner(ownerId);
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      evolutionErrorResponse(res, error, "Error saving WhatsApp groups");
      return;
    }
    console.error("Error saving WhatsApp groups:", error);
    res.status(500).json({ error: "تعذر حفظ مجموعات واتساب المحددة." });
  }
});

router.get("/social/whatsapp/groups/:groupJid/messages", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const groupJid = Array.isArray(req.params.groupJid) ? req.params.groupJid[0] : req.params.groupJid;
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
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
          eq(menaWhatsAppGroupSelections.ownerId, ownerId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.groupJid, groupJid),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      )
      .limit(1);

    if (!selection) {
      res.status(404).json({ error: "المجموعة المحددة غير مرتبطة بهذا الحساب." });
      return;
    }

    const rawPage = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const rawSort = Array.isArray(req.query.sort) ? req.query.sort[0] : req.query.sort;
    const page = Math.max(1, Number(rawPage ?? 1));
    const limit = Math.min(50, Math.max(1, Number(rawLimit ?? 25)));
    const sort = rawSort === "asc" ? "asc" : "desc";
    const offset = (page - 1) * limit;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(menaWhatsAppMessages)
      .where(
        and(
          eq(menaWhatsAppMessages.ownerId, ownerId),
          eq(menaWhatsAppMessages.instanceName, connection.instanceName),
          eq(menaWhatsAppMessages.groupJid, groupJid),
        ),
      );

    const rows = await db
      .select()
      .from(menaWhatsAppMessages)
      .where(
        and(
          eq(menaWhatsAppMessages.ownerId, ownerId),
          eq(menaWhatsAppMessages.instanceName, connection.instanceName),
          eq(menaWhatsAppMessages.groupJid, groupJid),
        ),
      )
      .orderBy(
        sort === "asc"
          ? asc(menaWhatsAppMessages.messageTimestamp)
          : desc(menaWhatsAppMessages.messageTimestamp),
        desc(menaWhatsAppMessages.createdAt),
      )
      .limit(limit)
      .offset(offset);

    const mediaRows = await db
      .select()
      .from(menaWhatsAppMessageMedia)
      .where(
        and(
          eq(menaWhatsAppMessageMedia.ownerId, ownerId),
          eq(menaWhatsAppMessageMedia.instanceName, connection.instanceName),
          eq(menaWhatsAppMessageMedia.groupJid, groupJid),
        ),
      );

    const mediaByMessage = new Map<string, typeof mediaRows>();
    for (const media of mediaRows) {
      const current = mediaByMessage.get(media.messageId) ?? [];
      current.push(media);
      mediaByMessage.set(media.messageId, current);
    }

    const messages = rows.map((message) => ({
      id: message.id,
      remoteMessageId: message.remoteMessageId,
      senderId: message.senderId,
      senderName: message.senderName,
      messageType: message.messageType,
      textBody: message.textBody,
      caption: message.caption,
      mediaAvailable: message.mediaAvailable,
      messageStatus: message.messageStatus,
      source: message.source,
      messageTimestamp: message.messageTimestamp?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
      replyToRemoteId: message.replyToRemoteId,
      media: (mediaByMessage.get(message.id) ?? []).map((media) => ({
        id: media.id,
        mediaType: media.mediaType,
        fileName: media.fileName,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        storageKey: media.storageKey,
        downloadStatus: media.downloadStatus,
        failureReason: media.failureReason,
        url: buildMediaUrl(req, media.id),
        createdAt: media.createdAt.toISOString(),
      })),
    }));

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
});

router.get("/social/whatsapp/public-media/:mediaId", async (req, res) => {
  const mediaId = Array.isArray(req.params.mediaId) ? req.params.mediaId[0] : req.params.mediaId;
  const expires = typeof req.query.expires === "string" ? req.query.expires : "";
  const signature = typeof req.query.signature === "string" ? req.query.signature : "";
  if (!verifySignedMediaRequest(mediaId, expires, signature)) {
    res.status(403).json({ error: "رابط الوسائط غير صالح أو منتهي الصلاحية." });
    return;
  }

  try {
    const [media] = await db
      .select()
      .from(menaWhatsAppMessageMedia)
      .where(and(
        eq(menaWhatsAppMessageMedia.id, mediaId),
        eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
      ))
      .limit(1);
    if (!media) {
      res.status(404).json({ error: "الوسيط غير موجود." });
      return;
    }
    const rootPath = path.resolve(WHATSAPP_MEDIA_STORAGE_ROOT);
    const resolvedPath = path.resolve(media.storagePath);
    if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      res.status(403).json({ error: "مسار الوسائط غير مسموح." });
      return;
    }
    await stat(resolvedPath);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(media.fileName || "attachment").replace(/"/g, "")}"`,
    );
    res.sendFile(resolvedPath);
  } catch (error) {
    console.error("Error serving signed WhatsApp media:", error);
    res.status(500).json({ error: "تعذّر فتح الوسائط." });
  }
});

router.get("/social/whatsapp/media/:mediaId", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const mediaId = Array.isArray(req.params.mediaId) ? req.params.mediaId[0] : req.params.mediaId;
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const [media] = await db
      .select()
      .from(menaWhatsAppMessageMedia)
      .where(
        and(
          eq(menaWhatsAppMessageMedia.ownerId, ownerId),
          eq(menaWhatsAppMessageMedia.id, mediaId),
        ),
      )
      .limit(1);

    if (!media) {
      res.status(404).json({ error: "المرفق غير موجود." });
      return;
    }

    const rootPath = path.resolve(WHATSAPP_MEDIA_STORAGE_ROOT);
    const resolvedPath = path.resolve(media.storagePath);
    const withinRoot = resolvedPath === rootPath || resolvedPath.startsWith(`${rootPath}${path.sep}`);
    if (!withinRoot) {
      res.status(403).json({ error: "مسار المرفق غير مسموح." });
      return;
    }

    try {
      await stat(resolvedPath);
    } catch {
      res.status(404).json({ error: "الملف المحفوظ غير موجود على القرص." });
      return;
    }

    res.setHeader("Content-Type", media.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(media.fileName || "attachment").replace(/"/g, "")}"`,
    );
    res.sendFile(resolvedPath);
  } catch (error) {
    console.error("Error serving WhatsApp media:", error);
    res.status(500).json({ error: "تعذّر فتح المرفق." });
  }
});

router.post("/social/whatsapp/sync-now", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    if (!connection) {
      res.status(404).json({ error: "حساب واتساب غير موجود." });
      return;
    }

    const groups = await db
      .select()
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.ownerId, ownerId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      );

    if (groups.length === 0) {
      res.status(200).json({ status: "idle", groups: [] });
      return;
    }

    void Promise.all(
      groups.map((group) => syncGroupHistory(ownerId, connection.instanceName, group.groupJid, group.groupName)),
    );

    res.status(202).json({
      status: "started",
      groups: groups.map((group) => ({ groupJid: group.groupJid, groupName: group.groupName })),
    });
  } catch (error) {
    console.error("Error starting WhatsApp sync:", error);
    res.status(500).json({ error: "تعذر بدء مزامنة واتساب." });
  }
});

router.get("/social/whatsapp/sync-status", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    if (!connection) {
      res.status(404).json({ error: "حساب واتساب غير موجود." });
      return;
    }

    const [states, selections] = await Promise.all([
      db
      .select()
      .from(menaWhatsAppSyncStates)
      .where(
        and(
          eq(menaWhatsAppSyncStates.ownerId, ownerId),
          eq(menaWhatsAppSyncStates.instanceName, connection.instanceName),
        ),
      ),
      db
        .select({ groupJid: menaWhatsAppGroupSelections.groupJid })
        .from(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.ownerId, ownerId),
            eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
            eq(menaWhatsAppGroupSelections.selected, true),
          ),
        ),
    ]);
    const selectedGroupJids = new Set(selections.map(({ groupJid }) => groupJid));

    res.json({
      groups: states.filter((state) => selectedGroupJids.has(state.groupJid)).map((state) => ({
        groupJid: state.groupJid,
        status: state.status,
        importedCount: state.importedCount,
        skippedCount: state.skippedCount,
        failedCount: state.failedCount,
        lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
        lastError: state.lastError,
        startedAt: state.startedAt?.toISOString() ?? null,
        completedAt: state.completedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Error fetching WhatsApp sync status:", error);
    res.status(500).json({ error: "تعذر جلب حالة المزامنة." });
  }
});

router.post("/social/whatsapp/webhook", async (req, res) => {
  const body = req.body ?? {};
  try {
    await processWebhookEvent(body, { headers: req.headers as Record<string, string | string[] | undefined> });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Evolution webhook processing failed:", error);
    res.status(500).json({ ok: false });
  }
});

router.delete("/social/whatsapp", requireOwner, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.ownerId, ownerId))
      .limit(1);
    if (connection) {
      try {
        await evolutionRequest(
          `instance/delete/${encodeURIComponent(connection.instanceName)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        if (!(err instanceof EvolutionApiError && err.statusCode === 404)) {
          throw err;
        }
      }
      await db
        .delete(menaWhatsAppConnections)
        .where(eq(menaWhatsAppConnections.ownerId, ownerId));
    }
    res.json({ disconnected: true });
  } catch (err) {
    evolutionErrorResponse(res, err, "Error disconnecting WhatsApp");
  }
});

export default router;
