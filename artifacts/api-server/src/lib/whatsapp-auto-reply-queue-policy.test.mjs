import assert from "node:assert/strict";
import test from "node:test";
import {
  whatsAppAutoReplyDefaultMaxAgeMs,
  shouldQueueWhatsAppAutoReply,
} from "./whatsapp-auto-reply-policy.ts";

const now = Date.parse("2026-11-24T03:00:00.000Z");

function input(overrides = {}) {
  return {
    eventName: "MESSAGES_UPSERT",
    autoReplyEnabled: true,
    customerOptedOut: false,
    messageTimestamp: new Date(now - 60_000),
    isDirectIncoming: true,
    isPhoneJid: true,
    hasMessageCandidate: true,
    customerMessageText: "كم السعر؟",
    remoteMessageId: "3EB0ABC123",
    maxAgeMs: whatsAppAutoReplyDefaultMaxAgeMs,
    now,
    ...overrides,
  };
}

/** Reference copy of the rule as it was written inline in processWebhookEvent:
 * one condition chain to queue, and the same chain negated to alert. */
function legacyRule(candidate) {
  const withinWindow =
    candidate.messageTimestamp === null ||
    candidate.now - candidate.messageTimestamp.getTime() <= candidate.maxAgeMs;
  const identifiesCustomerMessage =
    candidate.eventName === "MESSAGES_UPSERT" &&
    candidate.isDirectIncoming &&
    candidate.isPhoneJid &&
    candidate.hasMessageCandidate &&
    withinWindow;
  const queued =
    identifiesCustomerMessage &&
    candidate.autoReplyEnabled &&
    !candidate.customerOptedOut &&
    Boolean(candidate.customerMessageText?.trim()) &&
    Boolean(candidate.remoteMessageId?.trim());
  const notify =
    identifiesCustomerMessage &&
    (!candidate.autoReplyEnabled || candidate.customerOptedOut);
  return { queued, notify };
}

test("a fresh direct customer message with replies on is queued", () => {
  const decision = shouldQueueWhatsAppAutoReply(input());
  assert.deepEqual(decision, {
    shouldQueue: true,
    reason: "queued",
    notifyMerchant: false,
  });
});

test("each unmet condition is refused with its own reason", () => {
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ eventName: "MESSAGES_UPDATE" })).reason,
    "not_message_upsert",
  );
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ isDirectIncoming: false })).reason,
    "not_direct_incoming",
  );
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ isPhoneJid: false })).reason,
    "not_phone_jid",
  );
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ hasMessageCandidate: false })).reason,
    "no_message_candidate",
  );
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ customerMessageText: "   " })).reason,
    "no_message_text",
  );
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ remoteMessageId: "" })).reason,
    "no_remote_message_id",
  );
});

test("a customer message nobody will answer tells the merchant", () => {
  const disabled = shouldQueueWhatsAppAutoReply(input({ autoReplyEnabled: false }));
  assert.equal(disabled.shouldQueue, false);
  assert.equal(disabled.reason, "auto_reply_disabled");
  assert.equal(disabled.notifyMerchant, true);

  const optedOut = shouldQueueWhatsAppAutoReply(input({ customerOptedOut: true }));
  assert.equal(optedOut.reason, "customer_opted_out");
  assert.equal(optedOut.notifyMerchant, true);
});

test("an opt-out wins over the connection switch", () => {
  const decision = shouldQueueWhatsAppAutoReply(
    input({ autoReplyEnabled: false, customerOptedOut: true }),
  );
  assert.equal(decision.reason, "customer_opted_out");
  assert.equal(decision.notifyMerchant, true);
});

test("a backlog message is dropped silently instead of alerting", () => {
  const stale = shouldQueueWhatsAppAutoReply(
    input({
      messageTimestamp: new Date(now - whatsAppAutoReplyDefaultMaxAgeMs - 1000),
      autoReplyEnabled: false,
    }),
  );
  assert.equal(stale.reason, "message_too_old");
  assert.equal(stale.notifyMerchant, false);

  const freshEnough = shouldQueueWhatsAppAutoReply(
    input({
      messageTimestamp: new Date(now - whatsAppAutoReplyDefaultMaxAgeMs),
    }),
  );
  assert.equal(freshEnough.reason, "queued");

  const customWindow = shouldQueueWhatsAppAutoReply(
    input({
      messageTimestamp: new Date(now - 10 * 60_000),
      maxAgeMs: 5 * 60_000,
    }),
  );
  assert.equal(customWindow.reason, "message_too_old");
});

test("a message with no known timestamp is treated as fresh", () => {
  assert.equal(
    shouldQueueWhatsAppAutoReply(input({ messageTimestamp: null })).reason,
    "queued",
  );
});

test("group and outbound events never produce a merchant alert", () => {
  for (const overrides of [
    { isDirectIncoming: false, autoReplyEnabled: false },
    { isPhoneJid: false, autoReplyEnabled: false },
    { hasMessageCandidate: false, customerOptedOut: true },
    { eventName: "CONNECTION_UPDATE", autoReplyEnabled: false },
  ]) {
    const decision = shouldQueueWhatsAppAutoReply(input(overrides));
    assert.equal(decision.notifyMerchant, false, JSON.stringify(overrides));
    assert.equal(decision.shouldQueue, false, JSON.stringify(overrides));
  }
});

test("the decision matches the rule that was written inline, for every combination", () => {
  const booleans = [true, false];
  for (const eventName of ["MESSAGES_UPSERT", "MESSAGES_UPDATE"]) {
    for (const autoReplyEnabled of booleans) {
      for (const customerOptedOut of booleans) {
        for (const isDirectIncoming of booleans) {
          for (const isPhoneJid of booleans) {
            for (const hasMessageCandidate of booleans) {
              for (const ageMs of [60_000, whatsAppAutoReplyDefaultMaxAgeMs + 1]) {
                for (const customerMessageText of ["كم السعر؟", "", null]) {
                  for (const remoteMessageId of ["3EB0", "", null]) {
                    const candidate = input({
                      eventName,
                      autoReplyEnabled,
                      customerOptedOut,
                      isDirectIncoming,
                      isPhoneJid,
                      hasMessageCandidate,
                      messageTimestamp: new Date(now - ageMs),
                      customerMessageText,
                      remoteMessageId,
                    });
                    const decision = shouldQueueWhatsAppAutoReply(candidate);
                    const legacy = legacyRule(candidate);
                    const context = JSON.stringify(candidate);
                    assert.equal(decision.shouldQueue, legacy.queued, context);
                    assert.equal(decision.notifyMerchant, legacy.notify, context);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});
