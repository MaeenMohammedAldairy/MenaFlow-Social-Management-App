import assert from "node:assert/strict";
import test from "node:test";
import {
  describeMetaInboundOutcome,
  describeWhatsAppAutoReplySkip,
  describeWhatsAppInboundOutcome,
  inboundWebhookEventNames,
  logInboundWebhookOutcome,
} from "./inbound-webhook-diagnostics.ts";

const whatsAppReasons = [
  "PAYLOAD_NOT_OBJECT",
  "REJECTED_SECRET",
  "IGNORED_EVENT",
  "MISSING_INSTANCE_OR_JID",
  "UNKNOWN_INSTANCE",
  "AMBIGUOUS_INSTANCE",
  "PROCESSED",
];

const metaReasons = [
  "MISSING_APP_SECRET",
  "REJECTED_SIGNATURE",
  "INVALID_JSON",
  "IGNORED_OBJECT",
  "MISSING_ACCOUNT_ID",
  "UNKNOWN_ACCOUNT",
  "AMBIGUOUS_ACCOUNT",
  "NO_EVENTS",
  "AUTO_REPLY_DISABLED",
  "AUTO_REPLY_CHANNEL_OFF",
  "INBOX_STORED",
  "AUTO_REPLY_QUEUED",
  "PROCESSED",
];

const skipReasons = [
  "not_message_upsert",
  "not_direct_incoming",
  "not_phone_jid",
  "no_message_candidate",
  "message_too_old",
  "customer_opted_out",
  "auto_reply_disabled",
  "no_message_text",
  "no_remote_message_id",
];

function fakeLogger() {
  const calls = [];
  const record = (level) => (context, message) => calls.push({ level, context, message });
  return {
    calls,
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
}

test("every WhatsApp outcome is named, levelled and explained in Arabic", () => {
  for (const reason of whatsAppReasons) {
    const outcome = describeWhatsAppInboundOutcome(reason);
    assert.equal(outcome.event, `WHATSAPP_WEBHOOK_${reason}`);
    assert.ok(["debug", "info", "warn", "error"].includes(outcome.level), reason);
    assert.equal(outcome.deliveryConfirmed, true, reason);
    assert.match(outcome.hint, /[\u0600-\u06FF]/, reason);
  }
  assert.equal(describeWhatsAppInboundOutcome("REJECTED_SECRET").level, "warn");
  assert.equal(describeWhatsAppInboundOutcome("AMBIGUOUS_INSTANCE").level, "error");
  assert.equal(describeWhatsAppInboundOutcome("IGNORED_EVENT").level, "debug");
  assert.equal(describeWhatsAppInboundOutcome("PROCESSED").level, "info");
  assert.match(
    describeWhatsAppInboundOutcome("REJECTED_SECRET").hint,
    /WHATSAPP_EVOLUTION_WEBHOOK_SECRET/,
  );
});

test("every Meta outcome is named, levelled and explained in Arabic", () => {
  for (const reason of metaReasons) {
    const outcome = describeMetaInboundOutcome(reason);
    assert.equal(outcome.event, `META_WEBHOOK_${reason}`);
    assert.ok(["debug", "info", "warn", "error"].includes(outcome.level), reason);
    assert.equal(outcome.deliveryConfirmed, true, reason);
    assert.match(outcome.hint, /[\u0600-\u06FF]/, reason);
  }
  assert.equal(describeMetaInboundOutcome("MISSING_APP_SECRET").level, "error");
  assert.equal(describeMetaInboundOutcome("REJECTED_SIGNATURE").level, "warn");
  assert.equal(describeMetaInboundOutcome("AUTO_REPLY_DISABLED").level, "info");
  assert.equal(describeMetaInboundOutcome("NO_EVENTS").level, "debug");
  assert.match(
    describeMetaInboundOutcome("MISSING_APP_SECRET").hint,
    /FACEBOOK_APP_SECRET/,
  );
});

test("an unanswered customer message is visible, a group message is not", () => {
  for (const reason of skipReasons) {
    const outcome = describeWhatsAppAutoReplySkip(reason);
    assert.equal(outcome.event, `WHATSAPP_AUTO_REPLY_SKIPPED_${reason.toUpperCase()}`);
    assert.match(outcome.hint, /[\u0600-\u06FF]/, reason);
    assert.equal(outcome.deliveryConfirmed, true, reason);
  }
  assert.equal(describeWhatsAppAutoReplySkip("auto_reply_disabled").level, "info");
  assert.equal(describeWhatsAppAutoReplySkip("customer_opted_out").level, "info");
  assert.equal(describeWhatsAppAutoReplySkip("not_direct_incoming").level, "debug");
  assert.equal(describeWhatsAppAutoReplySkip("no_remote_message_id").level, "warn");
});

test("the emitter picks the logger method from the outcome level", () => {
  const { calls, logger } = fakeLogger();
  logInboundWebhookOutcome(logger, describeWhatsAppInboundOutcome("REJECTED_SECRET"), {
    instanceName: "menaflow-3c247db8a54d",
  });
  logInboundWebhookOutcome(logger, describeMetaInboundOutcome("PROCESSED"), {
    platform: "instagram",
    accountId: "17841415814930227",
  });
  logInboundWebhookOutcome(logger, describeWhatsAppInboundOutcome("IGNORED_EVENT"));

  assert.deepEqual(
    calls.map((call) => call.level),
    ["warn", "info", "debug"],
  );
  assert.deepEqual(calls[0].context, {
    event: "WHATSAPP_WEBHOOK_REJECTED_SECRET",
    hint: describeWhatsAppInboundOutcome("REJECTED_SECRET").hint,
    instanceName: "menaflow-3c247db8a54d",
  });
  assert.equal(calls[0].message, "WHATSAPP_WEBHOOK_REJECTED_SECRET");
  assert.equal(calls[1].context.platform, "instagram");
  assert.deepEqual(Object.keys(calls[2].context), ["event", "hint"]);
});

test("event names are unique across both platforms and the skip reasons", () => {
  const names = inboundWebhookEventNames();
  assert.equal(names.length, whatsAppReasons.length + metaReasons.length + skipReasons.length);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("WHATSAPP_WEBHOOK_REJECTED_SECRET"));
  assert.ok(names.includes("META_WEBHOOK_AUTO_REPLY_QUEUED"));
  assert.ok(names.includes("WHATSAPP_AUTO_REPLY_SKIPPED_AUTO_REPLY_DISABLED"));
});
