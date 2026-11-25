import assert from "node:assert/strict";
import test from "node:test";
import {
  isWhatsAppAutoReplyPausedCode,
  isWhatsAppAutoReplyQuotaCode,
  whatsAppAutoReplyLimitFailureMessage,
  whatsAppAutoReplyPausedMessage,
} from "./whatsapp-auto-reply-copy.ts";

test("an exhausted quota is a pause, and the sentence says it resumes alone", () => {
  assert.equal(
    isWhatsAppAutoReplyPausedCode("SUBSCRIPTION_LIMIT_REACHED:aiGenerations"),
    true,
  );
  assert.equal(isWhatsAppAutoReplyQuotaCode("SUBSCRIPTION_LIMIT_REACHED"), true);
  const message = whatsAppAutoReplyPausedMessage(
    "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
  );
  assert.match(message, /حصة الذكاء الاصطناعي/);
  assert.match(message, /تلقائيًا/);
  // The merchant can always act now, and the copy must not imply otherwise.
  assert.match(message, /يدويًا/);
});

test("a configuration limit is worded differently from a quota", () => {
  // A quota resets on its own; a missing provider key does not, so promising an
  // automatic resume "when the quota renews" would be a lie.
  for (const code of [
    "MISSING_AI_PROVIDER_KEY",
    "MISSING_OPENAI_KEY",
    "MISSING_GEMINI_KEY",
    "AI_MODEL_NAME_INVALID",
    "WORKSPACE_SUBSCRIPTION_MISSING",
    "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
  ]) {
    assert.equal(isWhatsAppAutoReplyPausedCode(code), true, code);
    assert.equal(isWhatsAppAutoReplyQuotaCode(code), false, code);
    const message = whatsAppAutoReplyPausedMessage(code);
    assert.match(message, /إعداد الذكاء الاصطناعي/, code);
    assert.doesNotMatch(message, /حصة/, code);
  }
});

test("legacy rows stored under the class name are still understood", () => {
  // The queue recorded `error.name` before it recorded stable codes, so last
  // week's conversations still carry this string in production.
  assert.equal(isWhatsAppAutoReplyQuotaCode("SubscriptionAiQuotaError"), true);
  assert.match(
    whatsAppAutoReplyPausedMessage("SubscriptionAiQuotaError"),
    /حصة الذكاء الاصطناعي/,
  );
  const failure = whatsAppAutoReplyLimitFailureMessage("SubscriptionAiQuotaError");
  assert.match(failure, /يدويًا/);
  assert.match(failure, /تُؤجَّل الآن تلقائيًا/);
});

test("codes that are not limits produce no pause copy", () => {
  for (const code of [
    "AUTO_REPLY_WINDOW_EXPIRED",
    "SUPERSEDED_BY_NEWER_MESSAGE",
    "AUTO_REPLY_LOOP_GUARD",
    "AUTO_REPLY_DISABLED",
    "EVOLUTION_API_UNREACHABLE",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(isWhatsAppAutoReplyPausedCode(code), false, String(code));
    assert.equal(isWhatsAppAutoReplyQuotaCode(code), false, String(code));
    assert.equal(whatsAppAutoReplyPausedMessage(code), null, String(code));
    assert.equal(whatsAppAutoReplyLimitFailureMessage(code), null, String(code));
  }
});

test("a suffix never hides the code it belongs to", () => {
  assert.equal(
    whatsAppAutoReplyPausedMessage("SUBSCRIPTION_LIMIT_REACHED:posts"),
    whatsAppAutoReplyPausedMessage("SUBSCRIPTION_LIMIT_REACHED"),
  );
});
