import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppDirectMessageContext,
  classifyWhatsAppDirectMessage,
  decryptWhatsAppDirectMessageValue,
  encryptWhatsAppDirectMessageValue,
  isWhatsAppDirectPhoneJid,
  normalizeWhatsAppDirectJid,
  normalizeWhatsAppDirectMessageText,
  redactWhatsAppPrivateData,
  selectWhatsAppDirectJid,
  whatsappDirectMessageExpiry,
  whatsappDirectMessagePlaceholder,
  whatsappDirectPhoneNumber,
  whatsappDirectConversationKeys,
  WHATSAPP_DIRECT_MESSAGE_RETENTION_DAYS,
} from "./whatsapp-direct-messages.ts";

test("normalizes phone and LID JIDs and prefers a phone alternate for replies", () => {
  assert.equal(
    normalizeWhatsAppDirectJid("967777123456:4@s.whatsapp.net"),
    "967777123456@s.whatsapp.net",
  );
  assert.equal(
    selectWhatsAppDirectJid("12345678901234@lid", "967777123456@s.whatsapp.net"),
    "967777123456@s.whatsapp.net",
  );
  assert.equal(
    selectWhatsAppDirectJid("12345678901234@lid"),
    "12345678901234@lid",
  );
  assert.equal(isWhatsAppDirectPhoneJid("12345678901234@lid"), false);
  assert.equal(selectWhatsAppDirectJid("120363000000000000@g.us"), null);
  assert.equal(whatsappDirectPhoneNumber("967777123456:4@s.whatsapp.net"), "967777123456");
  assert.throws(
    () => whatsappDirectPhoneNumber("12345678901234@lid"),
    /WHATSAPP_RECIPIENT_PHONE_REQUIRED/,
  );
});

test("classifies media-only messages for a non-empty inbox display", () => {
  assert.equal(
    classifyWhatsAppDirectMessage(
      { ephemeralMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } },
      null,
    ),
    "image",
  );
  assert.equal(classifyWhatsAppDirectMessage({ audioMessage: {} }, null), "audio");
  assert.equal(classifyWhatsAppDirectMessage({ locationMessage: {} }, null), "location");
  assert.equal(classifyWhatsAppDirectMessage({ conversation: "مرحبًا" }, "مرحبًا"), "text");
  assert.match(whatsappDirectMessagePlaceholder("image"), /المرفق غير محفوظ/);
});

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