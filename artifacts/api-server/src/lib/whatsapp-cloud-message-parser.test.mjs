import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWhatsAppCloudMessageChange,
  shouldAdvanceWhatsAppCloudMessageStatus,
  whatsappCloudMessagePreview,
} from "./whatsapp-cloud-message-parser.ts";

const fallbackDate = new Date("2026-11-11T00:00:00.000Z");

test("parses inbound text and media messages with phone and customer identity", () => {
  const parsed = parseWhatsAppCloudMessageChange(
    {
      value: {
        metadata: { phone_number_id: "phone-1" },
        contacts: [
          {
            wa_id: "customer-1",
            profile: { name: "Customer" },
          },
        ],
        messages: [
          {
            id: "message-text",
            from: "customer-1",
            timestamp: "1797000000",
            type: "text",
            text: { body: "Hello" },
            context: { id: "replied-message" },
          },
          {
            id: "message-image",
            from: "customer-1",
            timestamp: "invalid",
            type: "image",
            image: {
              id: "media-1",
              mime_type: "image/jpeg",
              sha256: "hash",
              caption: "Photo",
            },
          },
        ],
      },
    },
    fallbackDate,
  );

  assert.equal(parsed?.metaPhoneNumberId, "phone-1");
  assert.equal(parsed?.messages.length, 2);
  assert.equal(parsed?.messages[0]?.customerName, "Customer");
  assert.equal(parsed?.messages[0]?.textBody, "Hello");
  assert.equal(
    parsed?.messages[0]?.replyToMetaMessageId,
    "replied-message",
  );
  assert.equal(parsed?.messages[1]?.messageAt, fallbackDate);
  assert.equal(parsed?.messages[1]?.textBody, "Photo");
  assert.deepEqual(parsed?.messages[1]?.media, [
    {
      type: "image",
      metaMediaId: "media-1",
      mimeType: "image/jpeg",
      sha256: "hash",
    },
  ]);
  assert.equal(
    whatsappCloudMessagePreview(parsed.messages[1]),
    "Photo",
  );
});

test("parses delivery statuses and stores only an error code", () => {
  const parsed = parseWhatsAppCloudMessageChange(
    {
      value: {
        metadata: { phone_number_id: "phone-1" },
        statuses: [
          {
            id: "outgoing-1",
            recipient_id: "customer-1",
            status: "delivered",
            timestamp: "1797000001",
          },
          {
            id: "outgoing-2",
            recipient_id: "customer-2",
            status: "failed",
            timestamp: "1797000002",
            errors: [
              {
                code: 131047,
                title: "sensitive provider details are not persisted",
              },
            ],
          },
          {
            id: "outgoing-3",
            recipient_id: "customer-3",
            status: "queued",
          },
        ],
      },
    },
    fallbackDate,
  );

  assert.deepEqual(
    parsed?.statuses.map(({ metaMessageId, status, errorCode }) => ({
      metaMessageId,
      status,
      errorCode,
    })),
    [
      {
        metaMessageId: "outgoing-1",
        status: "delivered",
        errorCode: null,
      },
      {
        metaMessageId: "outgoing-2",
        status: "failed",
        errorCode: "131047",
      },
    ],
  );
});

test("requires a phone number id and rejects non-structured changes", () => {
  assert.equal(
    parseWhatsAppCloudMessageChange({ value: {} }, fallbackDate),
    null,
  );
  assert.equal(
    parseWhatsAppCloudMessageChange(
      { value: { metadata: { phone_number_id: "phone-1" }, messages: {} } },
      fallbackDate,
    ),
    null,
  );
});

test("message status progression never regresses on out-of-order events", () => {
  assert.equal(shouldAdvanceWhatsAppCloudMessageStatus("sent", "delivered"), true);
  assert.equal(shouldAdvanceWhatsAppCloudMessageStatus("delivered", "read"), true);
  assert.equal(shouldAdvanceWhatsAppCloudMessageStatus("read", "delivered"), false);
  assert.equal(shouldAdvanceWhatsAppCloudMessageStatus("failed", "sent"), false);
  assert.equal(shouldAdvanceWhatsAppCloudMessageStatus("failed", "delivered"), true);
});
