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

/**
 * The direct inbox stores only encrypted text, so the server can only ever
 * report whether a message had text or not. It used to claim ten values —
 * image, video, audio, document, sticker, album, location, contact — none of
 * which it sends, and the placeholder below carried a label for each.
 */
export type WhatsAppDirectMessageType = "text" | "unknown";

export type WhatsAppDirectMessageCursor = {
  beforeTimestamp: string;
  beforeId: string;
};

export function whatsappDirectMessagePlaceholder(
  messageType: WhatsAppDirectMessageType,
): string {
  const labels: Record<WhatsAppDirectMessageType, string> = {
    text: "رسالة بدون نص محفوظ",
    unknown: "رسالة واتساب بدون محتوى نصي",
  };
  return labels[messageType];
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