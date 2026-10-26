import assert from "node:assert/strict";
import test from "node:test";
import {
  canAnalyzeWhatsAppMessage,
  canAutoPublishMessage,
  containsSensitivePersonalData,
  isBusinessAuthoredMessage,
  resolveMessageSenderId,
} from "./whatsapp-marketing-safety.ts";

test("only exact linked business sender IDs qualify as business-authored", () => {
  assert.equal(isBusinessAuthoredMessage("971501234567@s.whatsapp.net", "+971 50 123 4567"), true);
  assert.equal(isBusinessAuthoredMessage("971501234568@s.whatsapp.net", "+971 50 123 4567"), false);
  assert.equal(isBusinessAuthoredMessage("12345@lid", "+971 50 123 4567"), false);
});

test("outgoing group messages with fromMe set use the linked business phone", () => {
  const businessPhone = "+967777187184";
  assert.equal(resolveMessageSenderId({
    fromMe: true,
    participant: undefined,
  }, businessPhone), businessPhone);
  assert.equal(resolveMessageSenderId({
    fromMe: false,
    participant: "967700000001@s.whatsapp.net",
  }, businessPhone), "967700000001@s.whatsapp.net");
});

test("personal contact details and verification secrets are rejected", () => {
  assert.equal(containsSensitivePersonalData("يرجى التواصل على +971 50 123 4567"), true);
  assert.equal(containsSensitivePersonalData("أرسل الرمز إلى user@example.com"), true);
  assert.equal(containsSensitivePersonalData("رمز التحقق 123456"), true);
  assert.equal(containsSensitivePersonalData("منتج متوفر بلون أزرق"), false);
});

test("available messages from selected WhatsApp groups are analyzed regardless of send permissions", () => {
  const approved = {
    isGroup: true,
    groupSelected: true,
    messageAvailable: true,
  };
  assert.equal(canAnalyzeWhatsAppMessage(approved), true);
  assert.equal(canAnalyzeWhatsAppMessage({ ...approved, canPublish: false }), true);
  assert.equal(canAnalyzeWhatsAppMessage({ ...approved, isGroup: false }), false);
  assert.equal(canAnalyzeWhatsAppMessage({ ...approved, groupSelected: false }), false);
  assert.equal(canAnalyzeWhatsAppMessage({ ...approved, messageAvailable: false }), false);
});

test("auto-publish fails closed for non-groups, customer-authored messages, incomplete files, or videos", () => {
  const accepted = {
    isGroup: true,
    businessAuthored: true,
    text: "منتج جديد بتصميم عملي",
    mediaReady: true,
    hasUnsupportedVideo: false,
  };
  assert.equal(canAutoPublishMessage(accepted), true);
  assert.equal(canAutoPublishMessage({ ...accepted, isGroup: false }), false);
  assert.equal(canAutoPublishMessage({ ...accepted, businessAuthored: false }), false);
  assert.equal(canAutoPublishMessage({ ...accepted, mediaReady: false }), false);
  assert.equal(canAutoPublishMessage({ ...accepted, hasUnsupportedVideo: true }), false);
  assert.equal(canAutoPublishMessage({ ...accepted, text: "الاتصال 0501234567" }), false);
});
