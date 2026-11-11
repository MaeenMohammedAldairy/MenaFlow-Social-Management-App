type JsonRecord = Record<string, unknown>;

export type WhatsAppCloudInboundMessage = {
  metaMessageId: string;
  customerWaId: string;
  customerName: string | null;
  messageType: string;
  textBody: string | null;
  media: Array<Record<string, unknown>>;
  messageAt: Date;
  replyToMetaMessageId: string | null;
};

export type WhatsAppCloudMessageStatus = {
  metaMessageId: string;
  customerWaId: string;
  status: "sent" | "delivered" | "read" | "failed";
  statusAt: Date;
  errorCode: string | null;
};

export type ParsedWhatsAppCloudChange = {
  metaPhoneNumberId: string;
  messages: WhatsAppCloudInboundMessage[];
  statuses: WhatsAppCloudMessageStatus[];
};

const statusRank: Record<WhatsAppCloudMessageStatus["status"], number> = {
  sent: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(
  value: unknown,
  maxLength = 8_192,
): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result && result.length <= maxLength ? result : null;
}

function eventDate(value: unknown, fallback: Date): Date {
  const timestamp = typeof value === "string" ? Number(value) : value;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return fallback;
  }
  const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function mediaDescriptor(
  messageType: string,
  message: JsonRecord,
): Array<Record<string, unknown>> {
  const value = message[messageType];
  if (!isRecord(value)) return [];
  const media: Record<string, unknown> = { type: messageType };
  for (const [source, target] of [
    ["id", "metaMediaId"],
    ["mime_type", "mimeType"],
    ["sha256", "sha256"],
    ["filename", "filename"],
  ] as const) {
    const field = nonEmptyString(
      value[source],
      source === "filename" ? 512 : source === "mime_type" ? 128 : 256,
    );
    if (field) media[target] = field;
  }
  if (value.voice === true) media.voice = true;
  if (value.animated === true) media.animated = true;
  return Object.keys(media).length > 1 ? [media] : [];
}

function messageText(
  type: string,
  message: JsonRecord,
  media: Array<Record<string, unknown>>,
): string | null {
  const text = isRecord(message.text) ? nonEmptyString(message.text.body) : null;
  if (text) return text.slice(0, 10_000);
  const typedContent = message[type];
  const caption = isRecord(typedContent)
    ? nonEmptyString(typedContent.caption, 10_000)
    : null;
  if (caption) return caption.slice(0, 10_000);
  if (type === "button" && isRecord(message.button)) {
    return nonEmptyString(message.button.text)?.slice(0, 10_000) ?? null;
  }
  if (type === "interactive" && isRecord(message.interactive)) {
    const interactive = message.interactive;
    const buttonReply = isRecord(interactive.button_reply)
      ? nonEmptyString(interactive.button_reply.title)
      : null;
    const listReply = isRecord(interactive.list_reply)
      ? nonEmptyString(interactive.list_reply.title)
      : null;
    return (buttonReply ?? listReply)?.slice(0, 10_000) ?? null;
  }
  if (type === "reaction" && isRecord(message.reaction)) {
    return nonEmptyString(message.reaction.emoji)?.slice(0, 100) ?? null;
  }
  if (type === "location") return "موقع";
  if (type === "contacts") return "جهة اتصال";
  if (media.length > 0) return null;
  return null;
}

function contactName(value: unknown, customerWaId: string): string | null {
  if (!Array.isArray(value)) return null;
  for (const rawContact of value) {
    if (!isRecord(rawContact) || rawContact.wa_id !== customerWaId) continue;
    const profile = isRecord(rawContact.profile) ? rawContact.profile : null;
    return profile ? nonEmptyString(profile.name, 250) : null;
  }
  return null;
}

export function parseWhatsAppCloudMessageChange(
  payload: unknown,
  fallbackDate: Date,
): ParsedWhatsAppCloudChange | null {
  if (!isRecord(payload) || !isRecord(payload.value)) return null;
  const value = payload.value;
  if (!isRecord(value.metadata)) return null;
  const metaPhoneNumberId = nonEmptyString(value.metadata.phone_number_id, 256);
  if (!metaPhoneNumberId) return null;

  const messages: WhatsAppCloudInboundMessage[] = [];
  if (value.messages !== undefined) {
    if (!Array.isArray(value.messages)) return null;
    for (const rawMessage of value.messages) {
      if (!isRecord(rawMessage)) continue;
      const metaMessageId = nonEmptyString(rawMessage.id, 256);
      const customerWaId = nonEmptyString(rawMessage.from, 256);
      const messageType = nonEmptyString(rawMessage.type, 80);
      if (!metaMessageId || !customerWaId || !messageType) continue;

      const media = mediaDescriptor(messageType, rawMessage);
      const context = isRecord(rawMessage.context) ? rawMessage.context : null;
      messages.push({
        metaMessageId,
        customerWaId,
        customerName: contactName(value.contacts, customerWaId),
        messageType: messageType.slice(0, 80),
        textBody: messageText(messageType, rawMessage, media),
        media,
        messageAt: eventDate(rawMessage.timestamp, fallbackDate),
        replyToMetaMessageId: context
          ? nonEmptyString(context.id, 256)
          : null,
      });
    }
  }

  const statuses: WhatsAppCloudMessageStatus[] = [];
  if (value.statuses !== undefined) {
    if (!Array.isArray(value.statuses)) return null;
    for (const rawStatus of value.statuses) {
      if (!isRecord(rawStatus)) continue;
      const metaMessageId = nonEmptyString(rawStatus.id, 256);
      const customerWaId = nonEmptyString(rawStatus.recipient_id, 256);
      const rawStatusName = nonEmptyString(rawStatus.status, 32);
      if (
        !metaMessageId ||
        !customerWaId ||
        !rawStatusName ||
        !["sent", "delivered", "read", "failed"].includes(rawStatusName)
      ) {
        continue;
      }
      const firstError =
        Array.isArray(rawStatus.errors) && isRecord(rawStatus.errors[0])
          ? rawStatus.errors[0]
          : null;
      statuses.push({
        metaMessageId,
        customerWaId,
        status: rawStatusName as WhatsAppCloudMessageStatus["status"],
        statusAt: eventDate(rawStatus.timestamp, fallbackDate),
        errorCode: firstError ? nonEmptyString(firstError.code, 80) : null,
      });
    }
  }

  return { metaPhoneNumberId, messages, statuses };
}

export function shouldAdvanceWhatsAppCloudMessageStatus(
  current: string,
  next: WhatsAppCloudMessageStatus["status"],
): boolean {
  if (current === "received" || current === "unknown") return true;
  if (!["sent", "delivered", "read", "failed"].includes(current)) {
    return false;
  }
  return statusRank[next] > statusRank[current as WhatsAppCloudMessageStatus["status"]];
}

export function whatsappCloudMessagePreview(
  message: WhatsAppCloudInboundMessage,
): string {
  if (message.textBody) return message.textBody;
  const labelByType: Record<string, string> = {
    audio: "رسالة صوتية",
    contacts: "جهة اتصال",
    document: "مستند",
    image: "صورة",
    location: "موقع",
    sticker: "ملصق",
    video: "فيديو",
  };
  return labelByType[message.messageType] ?? "رسالة";
}
