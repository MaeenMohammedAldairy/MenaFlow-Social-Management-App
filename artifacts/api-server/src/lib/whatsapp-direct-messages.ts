import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from "./meta-token-crypto.ts";

export type WhatsAppDirectMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "album"
  | "location"
  | "contact"
  | "unknown";

export const WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS = 90;
const maximumDirectMessageLength = 4000;

export function normalizeWhatsAppDirectJid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{7,20})(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(
    value.trim(),
  );
  return match ? `${match[1]}@${match[2]}` : null;
}

export function selectWhatsAppDirectJid(
  remoteJid: unknown,
  remoteJidAlt?: unknown,
): string | null {
  const primary = normalizeWhatsAppDirectJid(remoteJid);
  const alternate = normalizeWhatsAppDirectJid(remoteJidAlt);
  if (primary?.endsWith("@s.whatsapp.net")) return primary;
  if (alternate?.endsWith("@s.whatsapp.net")) return alternate;
  return primary ?? alternate;
}

export function isWhatsAppDirectPhoneJid(value: unknown): value is string {
  return normalizeWhatsAppDirectJid(value)?.endsWith("@s.whatsapp.net") ?? false;
}

export function whatsappDirectPhoneNumber(value: unknown): string {
  const jid = normalizeWhatsAppDirectJid(value);
  if (!jid?.endsWith("@s.whatsapp.net")) {
    throw new Error("WHATSAPP_RECIPIENT_PHONE_REQUIRED");
  }
  return jid.replace(/@s\.whatsapp\.net$/, "");
}

export function whatsappDirectMessagePlaceholder(
  messageType: WhatsAppDirectMessageType,
): string {
  const labels: Record<WhatsAppDirectMessageType, string> = {
    text: "رسالة بدون نص محفوظ",
    image: "صورة — المرفق غير محفوظ في صندوق الخاص",
    video: "مقطع فيديو — المرفق غير محفوظ في صندوق الخاص",
    audio: "رسالة صوتية — المرفق غير محفوظ في صندوق الخاص",
    document: "ملف — المرفق غير محفوظ في صندوق الخاص",
    sticker: "ملصق — المرفق غير محفوظ في صندوق الخاص",
    album: "ألبوم وسائط — المرفقات غير محفوظة في صندوق الخاص",
    location: "موقع جغرافي",
    contact: "جهة اتصال",
    unknown: "رسالة واتساب بدون محتوى نصي",
  };
  return labels[messageType] ?? labels.unknown;
}

export function classifyWhatsAppDirectMessage(
  value: unknown,
  textBody: string | null,
): WhatsAppDirectMessageType {
  const pending: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const root = asRecord(value);
  if (root) pending.push(root);

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const current = pending[cursor];
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (current.imageMessage) return "image";
    if (current.videoMessage) return "video";
    if (current.audioMessage || current.pttMessage || current.voiceMessage) {
      return "audio";
    }
    if (current.documentMessage) return "document";
    if (current.stickerMessage) return "sticker";
    if (current.albumMessage) return "album";
    if (current.locationMessage || current.liveLocationMessage) {
      return "location";
    }
    if (current.contactMessage || current.contactsArrayMessage) return "contact";

    for (const key of [
      "message",
      "ephemeralMessage",
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
    ]) {
      const nested = asRecord(current[key]);
      const wrapped = nested && key !== "message"
        ? asRecord(nested.message)
        : nested;
      if (wrapped) pending.push(wrapped);
    }
  }

  return textBody?.trim() ? "text" : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function whatsappDirectConversationKeys(
  workspaceId: string,
  instanceName: string,
  remoteJid: string,
): string[] {
  const secrets = [
    process.env.ENCRYPTION_KEY,
    process.env.ENCRYPTION_KEY_PREVIOUS,
  ].filter((secret): secret is string => Boolean(secret));
  if (!secrets.length) throw new Error("MISSING_ENCRYPTION_KEY");
  const value = `${workspaceId}\u0000${instanceName}\u0000${remoteJid}`;
  return [...new Set(secrets)].map((secret) =>
    createHmac(
      "sha256",
      createHash("sha256").update(secret, "utf8").digest(),
    )
      .update(value, "utf8")
      .digest("hex"),
  );
}

export function encryptWhatsAppDirectMessageValue(value: string): string {
  return encryptSensitiveValue(value);
}

export function decryptWhatsAppDirectMessageValue(value: string): string {
  return decryptSensitiveValue(value);
}

export function normalizeWhatsAppDirectMessageText(value: string): string {
  return value.trim().slice(0, maximumDirectMessageLength);
}

const maximumDirectSenderNameLength = 120;

/**
 * Evolution already sends the customer's display name as `pushName` (and
 * sometimes `senderName`). Reuse those exact fields — and the same
 * `sender_name` column the group messages use — instead of inventing another
 * contact-name vocabulary. A JID, a phone number or an empty/control-character
 * string is not a usable display name: callers fall back to the phone number.
 */
export function normalizeWhatsAppDirectSenderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumDirectSenderNameLength) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (/^\d{7,20}(?::\d+)?@(?:s\.whatsapp\.net|lid)$/.test(trimmed)) return null;
  if (/^\d{7,20}$/.test(trimmed)) return null;
  return trimmed;
}

/** `pushName` wins, matching the existing group-message extraction path. */
export function whatsappDirectSenderNameFromPayload(
  ...payloads: unknown[]
): string | null {
  for (const payload of payloads) {
    const record = asRecord(payload);
    if (!record) continue;
    const name =
      normalizeWhatsAppDirectSenderName(record.pushName) ??
      normalizeWhatsAppDirectSenderName(record.senderName);
    if (name) return name;
  }
  return null;
}

export function redactWhatsAppPrivateData(value: string): string {
  const labeled = value
    .replace(
      /(?:اسم\s*(?:العميل|المستلم)|الاسم|customer\s*name|name)\s*[:：=-]\s*[^\n,]+/giu,
      "الاسم: [محذوف]",
    )
    .replace(
      /(?:رقم\s*(?:الهاتف|الجوال|التواصل)|الهاتف|الجوال|phone)\s*[:：=-]?\s*[+]?\d[\d\s().-]{5,23}\d/giu,
      "رقم الهاتف: [محذوف]",
    )
    .replace(
      /(?:عنوان\s*التوصيل(?:\s*بالتفصيل)?|العنوان|مكان\s*التوصيل|delivery\s*address|address)\s*[:：=-]\s*[^\n]+/giu,
      "عنوان التوصيل: [محذوف]",
    );
  return labeled.replace(/[+]?\d[\d\s().-]{5,23}\d/gu, (candidate) => {
    const digits = candidate.replace(/\D/gu, "");
    return digits.length >= 7 && digits.length <= 15
      ? "[رقم محذوف]"
      : candidate;
  });
}

export function whatsappDirectMessageExpiry(
  timestamp: Date,
): Date {
  return new Date(
    timestamp.getTime() +
      WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * The stored form of one outbound direct message.
 *
 * Every outbound row — an automatic reply, an order confirmation, a manual
 * reply from the inbox — is keyed, encrypted and given its expiry the same way,
 * and getting any of it wrong is silent: a wrong conversation key breaks the
 * thread's grouping, unencrypted text defeats the protection at rest, a missing
 * expiry keeps the message forever. The three writers spelled this out
 * separately; now they don't.
 *
 * Only the row's shape. When it is written — before the send so the inbox can
 * show a pending reply, or after it so nothing is recorded that did not go —
 * stays the caller's decision.
 */
export function outboundWhatsAppDirectMessageValues(input: {
  ownerId: string;
  workspaceId: string;
  instanceName: string;
  remoteJid: string;
  text: string;
  status: "sending" | "sent";
  messageTimestamp: Date;
  providerMessageId?: string | null;
  clientRequestId?: string | null;
}) {
  const conversationKey = whatsappDirectConversationKeys(
    input.workspaceId,
    input.instanceName,
    input.remoteJid,
  )[0]!;
  return {
    id: randomUUID(),
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    instanceName: input.instanceName,
    remoteJidHash: conversationKey,
    encryptedRemoteJid: encryptWhatsAppDirectMessageValue(input.remoteJid),
    ...(input.providerMessageId === undefined
      ? {}
      : { providerMessageId: input.providerMessageId }),
    ...(input.clientRequestId === undefined
      ? {}
      : { clientRequestId: input.clientRequestId }),
    direction: "outbound" as const,
    status: input.status,
    encryptedTextBody: encryptWhatsAppDirectMessageValue(
      normalizeWhatsAppDirectMessageText(input.text),
    ),
    messageTimestamp: input.messageTimestamp,
    expiresAt: whatsappDirectMessageExpiry(input.messageTimestamp),
  };
}

export function buildWhatsAppDirectMessageContext(
  messages: Array<{
    direction: "inbound" | "outbound";
    textBody: string;
  }>,
) {
  return messages
    .map((message) => ({
      role: message.direction === "outbound" ? ("business" as const) : ("customer" as const),
      text: normalizeWhatsAppDirectMessageText(message.textBody),
    }))
    .filter((message) => message.text.length > 0)
    .slice(-10);
}