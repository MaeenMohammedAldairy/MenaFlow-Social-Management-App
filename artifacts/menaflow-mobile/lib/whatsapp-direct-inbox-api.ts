/**
 * The one-to-one WhatsApp inbox.
 *
 * A thin adapter over the client generated from `lib/api-spec/openapi.yaml`. The
 * shapes live in the contract now; what is left here is the one piece of
 * presentation the wire does not carry — the placeholder text for a message that
 * stored nothing readable — and the names the screens already import.
 *
 * This used to be a hand-written module with its own copies of the message and
 * conversation types. One of them claimed ten message types where the server
 * sends two: the inbox stores only encrypted text, so a message either has text
 * or it does not, and eight of the ten placeholder labels were unreachable.
 */
import {
  listWhatsAppDirectConversations,
  listWhatsAppDirectMessages,
  sendWhatsAppDirectReply as generatedSendWhatsAppDirectReply,
  confirmWhatsAppDirectReplyNotSent as generatedConfirmWhatsAppDirectReplyNotSent,
  type WhatsAppDirectConversation,
  type WhatsAppDirectMessage,
  type WhatsAppDirectMessageAttachment,
  type WhatsAppDirectMessageListResponse,
  type WhatsAppDirectReplyResponse,
  type WhatsAppDirectMessageEnvelope,
} from "@workspace/api-client-react";

export type {
  WhatsAppDirectConversation,
  WhatsAppDirectMessage,
  WhatsAppDirectMessageAttachment,
  WhatsAppDirectMessageListResponse,
};

/**
 * Whether a message held text. The server derives this from the stored body
 * rather than reading a type field, so it cannot name an attachment type.
 */
export type WhatsAppDirectMessageType = WhatsAppDirectMessage["messageType"];

/** The page cursor, echoed back by the screen as the next request's `before*`. */
export type WhatsAppDirectMessageCursor = NonNullable<
  WhatsAppDirectMessageListResponse["nextCursor"]
>;

export function whatsappDirectMessagePlaceholder(
  messageType: WhatsAppDirectMessageType,
): string {
  const labels: Record<WhatsAppDirectMessageType, string> = {
    text: "رسالة بدون نص محفوظ",
    unknown: "رسالة واتساب بدون محتوى نصي",
  };
  return labels[messageType];
}

/** What to show while a stored attachment is still being downloaded, or after
 * its download failed. The caption stays in `message.text`, never here. */
export function whatsappDirectAttachmentStatusLabel(
  attachment: WhatsAppDirectMessageAttachment,
): string {
  if (attachment.downloadStatus === "failed") {
    const code = attachment.errorCode ? ` (${attachment.errorCode})` : "";
    return `تعذر تنزيل المرفق${code}`;
  }
  if (attachment.downloadStatus === "pending") return "جارٍ تنزيل المرفق...";
  if (attachment.accessError) {
    return `تعذر إنشاء رابط آمن للمرفق (${attachment.accessError})`;
  }
  return "المرفق غير متاح";
}

export async function getWhatsAppDirectConversations(): Promise<{
  conversations: WhatsAppDirectConversation[];
}> {
  return listWhatsAppDirectConversations();
}

export async function getWhatsAppDirectMessages(
  remoteJid: string,
  cursor?: WhatsAppDirectMessageCursor | null,
): Promise<WhatsAppDirectMessageListResponse> {
  return listWhatsAppDirectMessages({
    remoteJid,
    ...(cursor
      ? { beforeTimestamp: cursor.beforeTimestamp, beforeId: cursor.beforeId }
      : {}),
  });
}

export async function sendWhatsAppDirectReply(input: {
  remoteJid: string;
  text: string;
  clientRequestId: string;
}): Promise<WhatsAppDirectReplyResponse> {
  return generatedSendWhatsAppDirectReply(input);
}

export async function confirmWhatsAppDirectReplyNotSent(
  messageId: string,
): Promise<WhatsAppDirectMessageEnvelope> {
  return generatedConfirmWhatsAppDirectReplyNotSent(messageId);
}
