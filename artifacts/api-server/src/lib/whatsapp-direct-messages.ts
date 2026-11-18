import { createHash, createHmac } from "node:crypto";
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