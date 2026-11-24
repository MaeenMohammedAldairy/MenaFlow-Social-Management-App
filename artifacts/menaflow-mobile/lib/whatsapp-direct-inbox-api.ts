import {
  fetchApiResponse,
  readJsonResponse,
} from "@workspace/api-client-react";

export type WhatsAppDirectMessageStatus =
  | "received"
  | "sending"
  | "sent"
  | "failed"
  | "unknown";

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

export type WhatsAppDirectMessageCursor = {
  beforeTimestamp: string;
  beforeId: string;
};

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

export type WhatsAppDirectConversation = {
  remoteJid: string;
  customerNumber: string;
  preview: string;
  lastDirection: "inbound" | "outbound";
  lastStatus: WhatsAppDirectMessageStatus;
  lastMessageAt: string;
};

export type WhatsAppDirectMessage = {
  id: string;
  remoteJid: string;
  direction: "inbound" | "outbound";
  status: WhatsAppDirectMessageStatus;
  messageType: WhatsAppDirectMessageType;
  autoReplyStatus: string | null;
  autoReplyErrorCode: string | null;
  text: string;
  occurredAt: string;
  createdAt: string;
  errorCode: string | null;
};

export async function getWhatsAppDirectConversations(): Promise<{
  conversations: WhatsAppDirectConversation[];
}> {
  const response = await fetchApiResponse(
    "/api/social/whatsapp/direct-conversations",
  );
  return readJsonResponse(response);
}

export async function getWhatsAppDirectMessages(
  remoteJid: string,
  cursor?: WhatsAppDirectMessageCursor,
): Promise<{
  messages: WhatsAppDirectMessage[];
  nextCursor: WhatsAppDirectMessageCursor | null;
}> {
  const query = new URLSearchParams({ remoteJid });
  if (cursor) {
    query.set("beforeTimestamp", cursor.beforeTimestamp);
    query.set("beforeId", cursor.beforeId);
  }
  const response = await fetchApiResponse(
    `/api/social/whatsapp/direct-messages?${query.toString()}`,
  );
  return readJsonResponse(response);
}

export async function sendWhatsAppDirectReply(input: {
  remoteJid: string;
  text: string;
  clientRequestId: string;
}): Promise<{ message: WhatsAppDirectMessage | null; duplicate?: boolean }> {
  const response = await fetchApiResponse(
    "/api/social/whatsapp/direct-messages/reply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readJsonResponse(response);
}

export async function confirmWhatsAppDirectReplyNotSent(
  messageId: string,
): Promise<{ message: WhatsAppDirectMessage }> {
  const response = await fetchApiResponse(
    `/api/social/whatsapp/direct-messages/${encodeURIComponent(messageId)}/confirm-not-sent`,
    { method: "POST" },
  );
  return readJsonResponse(response);
}