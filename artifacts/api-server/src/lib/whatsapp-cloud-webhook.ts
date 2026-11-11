import { createHash } from "node:crypto";
import { verifyMetaWebhookSignature } from "./meta-webhook.ts";

type JsonRecord = Record<string, unknown>;

export type WhatsAppCloudWebhookEvent = {
  eventKey: string;
  metaMessagingAccountId: string;
  eventType: string;
  payload: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function verifyWhatsAppCloudWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  return verifyMetaWebhookSignature(rawBody, signature, appSecret);
}

export function parseWhatsAppCloudWebhookEvents(
  input: unknown,
): WhatsAppCloudWebhookEvent[] | null {
  if (!isRecord(input) || input.object !== "whatsapp_business_account") {
    return null;
  }
  if (!Array.isArray(input.entry)) return null;

  const events: WhatsAppCloudWebhookEvent[] = [];
  for (const rawEntry of input.entry) {
    if (!isRecord(rawEntry)) return null;
    const metaMessagingAccountId = nonEmptyString(rawEntry.id);
    if (!metaMessagingAccountId || !Array.isArray(rawEntry.changes)) return null;

    for (const rawChange of rawEntry.changes) {
      if (!isRecord(rawChange)) return null;
      const eventType = nonEmptyString(rawChange.field);
      if (!eventType || !isRecord(rawChange.value)) return null;

      const payload = {
        object: "whatsapp_business_account",
        metaMessagingAccountId,
        entryTime:
          typeof rawEntry.time === "string" ||
          typeof rawEntry.time === "number"
            ? rawEntry.time
            : null,
        field: eventType,
        value: rawChange.value,
      };
      const eventKey = createHash("sha256")
        .update(stableJson(payload))
        .digest("hex");
      events.push({
        eventKey,
        metaMessagingAccountId,
        eventType,
        payload,
      });
    }
  }

  return events;
}
