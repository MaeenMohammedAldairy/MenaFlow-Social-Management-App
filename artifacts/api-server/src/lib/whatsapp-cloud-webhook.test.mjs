import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  parseWhatsAppCloudWebhookEvents,
  verifyWhatsAppCloudWebhookSignature,
} from "./whatsapp-cloud-webhook.ts";

const webhookPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "messaging-account-1",
      time: 1_797_000_000,
      changes: [
        {
          field: "messages",
          value: {
            metadata: {
              phone_number_id: "phone-1",
              display_phone_number: "+1 555 0100",
            },
            messages: [{ id: "message-1", type: "text" }],
          },
        },
        {
          field: "message_template_status_update",
          value: { message_template_id: "template-1", event: "APPROVED" },
        },
      ],
    },
  ],
};

test("validates signatures over the exact raw body and rejects missing secrets", () => {
  const rawBody = Buffer.from(JSON.stringify(webhookPayload));
  const signature = `sha256=${createHmac("sha256", "app-secret")
    .update(rawBody)
    .digest("hex")}`;

  assert.equal(
    verifyWhatsAppCloudWebhookSignature(rawBody, signature, "app-secret"),
    true,
  );
  assert.equal(
    verifyWhatsAppCloudWebhookSignature(rawBody, signature, "wrong-secret"),
    false,
  );
  assert.equal(
    verifyWhatsAppCloudWebhookSignature(rawBody, signature, undefined),
    false,
  );
  assert.equal(
    verifyWhatsAppCloudWebhookSignature(
      Buffer.from(`${rawBody.toString()} `),
      signature,
      "app-secret",
    ),
    false,
  );
});

test("parses message and template changes as separately deduplicated durable events", () => {
  const events = parseWhatsAppCloudWebhookEvents(webhookPayload);

  assert.equal(events?.length, 2);
  assert.deepEqual(
    events?.map(({ eventType, metaMessagingAccountId }) => ({
      eventType,
      metaMessagingAccountId,
    })),
    [
      {
        eventType: "messages",
        metaMessagingAccountId: "messaging-account-1",
      },
      {
        eventType: "message_template_status_update",
        metaMessagingAccountId: "messaging-account-1",
      },
    ],
  );
  assert.notEqual(events?.[0]?.eventKey, events?.[1]?.eventKey);
  assert.deepEqual(
    parseWhatsAppCloudWebhookEvents(webhookPayload)?.map(
      ({ eventKey }) => eventKey,
    ),
    events?.map(({ eventKey }) => eventKey),
  );
});

test("deduplicates equivalent event values regardless of JSON property order", () => {
  const first = parseWhatsAppCloudWebhookEvents(webhookPayload)?.[0];
  const reordered = parseWhatsAppCloudWebhookEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        time: 1_797_000_000,
        changes: [
          {
            value: {
              messages: [{ type: "text", id: "message-1" }],
              metadata: {
                display_phone_number: "+1 555 0100",
                phone_number_id: "phone-1",
              },
            },
            field: "messages",
          },
        ],
        id: "messaging-account-1",
      },
    ],
  })?.[0];

  assert.equal(first?.eventKey, reordered?.eventKey);
});

test("rejects malformed or non-WhatsApp Cloud webhook envelopes", () => {
  assert.equal(parseWhatsAppCloudWebhookEvents(null), null);
  assert.equal(
    parseWhatsAppCloudWebhookEvents({ object: "page", entry: [] }),
    null,
  );
  assert.equal(
    parseWhatsAppCloudWebhookEvents({
      object: "whatsapp_business_account",
      entry: [{ id: "messaging-account-1", changes: [{ field: "messages" }] }],
    }),
    null,
  );
});
