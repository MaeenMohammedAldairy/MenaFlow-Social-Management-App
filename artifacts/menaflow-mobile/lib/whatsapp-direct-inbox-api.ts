import { fetchApiResponse } from "@workspace/api-client-react";

export type WhatsAppDirectMessageStatus =
  | "received"
  | "sending"
  | "sent"
  | "failed"
  | "unknown";

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
  autoReplyStatus: string | null;
  autoReplyErrorCode: string | null;
  text: string;
  occurredAt: string;
  createdAt: string;
  errorCode: string | null;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    throw new Error("تعذر قراءة استجابة الخادم.");
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : `HTTP ${response.status}`,
    );
  }
  return payload as T;
}

export async function getWhatsAppDirectConversations(): Promise<{
  conversations: WhatsAppDirectConversation[];
}> {
  const response = await fetchApiResponse(
    "/api/social/whatsapp/direct-conversations",
  );
  return responseJson(response);
}

export async function getWhatsAppDirectMessages(
  remoteJid: string,
): Promise<{ messages: WhatsAppDirectMessage[] }> {
  const query = new URLSearchParams({ remoteJid });
  const response = await fetchApiResponse(
    `/api/social/whatsapp/direct-messages?${query.toString()}`,
  );
  return responseJson(response);
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
  return responseJson(response);
}

export async function confirmWhatsAppDirectReplyNotSent(
  messageId: string,
): Promise<{ message: WhatsAppDirectMessage }> {
  const response = await fetchApiResponse(
    `/api/social/whatsapp/direct-messages/${encodeURIComponent(messageId)}/confirm-not-sent`,
    { method: "POST" },
  );
  return responseJson(response);
}