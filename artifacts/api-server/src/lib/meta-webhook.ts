import { createHmac, timingSafeEqual } from "node:crypto";

type RecordValue = Record<string, unknown>;

export type MetaInboxEvent = {
  platform: "facebook" | "instagram";
  kind: "message" | "comment";
  externalId: string;
  conversationId: string;
  parentId: string | null;
  actorId: string | null;
  actorName: string | null;
  text: string;
  media: MetaInboxMedia[];
  occurredAt: Date;
};

export type MetaInboxMedia = {
  type: string;
  url: string | null;
  thumbnailUrl: string | null;
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpsUrl(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function messageMedia(value: unknown): MetaInboxMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawAttachment) => {
    const attachment = record(rawAttachment);
    const payload = record(attachment?.payload);
    if (!attachment) return [];
    return [
      {
        type: stringValue(attachment.type) ?? "file",
        url: httpsUrl(payload?.url),
        thumbnailUrl: httpsUrl(payload?.thumbnail_url),
      },
    ];
  });
}

function eventDate(value: unknown): Date {
  const timestamp = typeof value === "number" ? value : Number(value);
  const date = new Date(
    timestamp > 10_000_000_000 ? timestamp : timestamp * 1000,
  );
  return Number.isFinite(date.getTime()) ? date : new Date();
}

export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!signature || !appSecret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(signature.slice("sha256=".length), "hex");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function parseMetaWebhookEvents(
  payload: unknown,
  platform: "facebook" | "instagram",
): MetaInboxEvent[] {
  const root = record(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const result: MetaInboxEvent[] = [];

  for (const rawEntry of entries) {
    const entry = record(rawEntry);
    if (!entry) continue;
    const accountId = stringValue(entry.id);
    const occurredAt = eventDate(entry.time);
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const rawEvent of messaging) {
      const event = record(rawEvent);
      const message = record(event?.message);
      const sender = record(event?.sender);
      const senderId = stringValue(sender?.id);
      const externalId = stringValue(message?.mid);
      if (
        !event ||
        !message ||
        message.is_echo === true ||
        !senderId ||
        !externalId
      ) {
        continue;
      }
      const media = messageMedia(message.attachments);
      const text =
        stringValue(message.text) ??
        (Array.isArray(message.attachments) ? "رسالة تحتوي على مرفق" : null);
      if (!text) continue;

      result.push({
        platform,
        kind: "message",
        externalId,
        conversationId: senderId,
        parentId: accountId,
        actorId: senderId,
        actorName: null,
        text,
        media,
        occurredAt: eventDate(event.timestamp ?? entry.time),
      });
    }

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const rawChange of changes) {
      const change = record(rawChange);
      const value = record(change?.value);
      if (!change || !value) continue;
      if (
        (platform === "facebook" && change.field !== "feed") ||
        (platform === "instagram" && change.field !== "comments")
      ) {
        continue;
      }
      if (
        platform === "facebook" &&
        (value.item !== "comment" || value.verb === "remove")
      ) {
        continue;
      }

      const from = record(value.from);
      const media = record(value.media);
      const externalId = stringValue(value.comment_id) ?? stringValue(value.id);
      const actorId = stringValue(from?.id);
      const text = stringValue(value.message) ?? stringValue(value.text);
      const parentId =
        stringValue(value.post_id) ??
        stringValue(media?.id) ??
        stringValue(value.parent_id);
      if (
        !externalId ||
        !text ||
        !parentId ||
        (actorId && actorId === accountId)
      ) {
        continue;
      }

      result.push({
        platform,
        kind: "comment",
        externalId,
        conversationId: parentId,
        parentId,
        actorId,
        actorName: stringValue(from?.name) ?? stringValue(from?.username),
        text,
        media: [],
        occurredAt,
      });
    }
  }

  return result;
}
