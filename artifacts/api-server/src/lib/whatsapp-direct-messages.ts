import { createHash, createHmac } from "node:crypto";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from "./meta-token-crypto.ts";

export const WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS = 90;
const maximumDirectMessageLength = 4000;

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