import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppDirectMessageContext,
  decryptWhatsAppDirectMessageValue,
  encryptWhatsAppDirectMessageValue,
  normalizeWhatsAppDirectMessageText,
  redactWhatsAppPrivateData,
  whatsappDirectMessageExpiry,
  whatsappDirectConversationKeys,
  WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS,
} from "./whatsapp-direct-messages.ts";

test("expires direct messages after the configured retention period", () => {
  const timestamp = new Date("2026-11-13T00:00:00.000Z");
  assert.equal(WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS, 90);
  assert.equal(
    whatsappDirectMessageExpiry(timestamp).toISOString(),
    "2027-02-11T00:00:00.000Z",
  );
});

test("builds ordered customer/business context and omits blank messages", () => {
  const context = buildWhatsAppDirectMessageContext([
    { direction: "inbound", textBody: "كم السعر؟" },
    { direction: "outbound", textBody: "السعر 6500 ريال." },
    { direction: "inbound", textBody: "   " },
  ]);

  assert.deepEqual(context, [
    { role: "customer", text: "كم السعر؟" },
    { role: "business", text: "السعر 6500 ريال." },
  ]);
});

test("bounds stored direct message text", () => {
  assert.equal(normalizeWhatsAppDirectMessageText("  مرحبًا  "), "مرحبًا");
  assert.equal(normalizeWhatsAppDirectMessageText("x".repeat(5000)).length, 4000);
});

test("encrypts message content and finds conversations during key rotation", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalPreviousKey = process.env.ENCRYPTION_KEY_PREVIOUS;
  try {
    process.env.ENCRYPTION_KEY = "old-direct-message-encryption-key";
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    const encrypted = encryptWhatsAppDirectMessageValue("نص خاص");
    const oldConversationKey = whatsappDirectConversationKeys(
      "workspace-1",
      "instance-1",
      "967777123456@s.whatsapp.net",
    )[0];

    process.env.ENCRYPTION_KEY = "new-direct-message-encryption-key";
    process.env.ENCRYPTION_KEY_PREVIOUS = "old-direct-message-encryption-key";
    const lookupKeys = whatsappDirectConversationKeys(
      "workspace-1",
      "instance-1",
      "967777123456@s.whatsapp.net",
    );

    assert.equal(decryptWhatsAppDirectMessageValue(encrypted), "نص خاص");
    assert.equal(lookupKeys[0] === oldConversationKey, false);
    assert.equal(lookupKeys.includes(oldConversationKey), true);
    assert.equal(lookupKeys[0]?.length, 64);
  } finally {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalPreviousKey === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = originalPreviousKey;
  }
});

test("redacts private order details before building AI prompts", () => {
  const redacted = redactWhatsAppPrivateData(
    "المنتج: المصحف\nاسم المستلم: فاطمة علي\nرقم الهاتف: +967777123456\nعنوان التوصيل بالتفصيل: صنعاء، حدة",
  );

  assert.match(redacted, /المنتج: المصحف/);
  assert.doesNotMatch(redacted, /فاطمة علي|967777123456|صنعاء، حدة/);
  assert.match(redacted, /\[محذوف\]/);
});