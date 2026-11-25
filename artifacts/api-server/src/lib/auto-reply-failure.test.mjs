import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReplyResultUnknownCode,
  planAutoReplyFailure,
  whatsAppAutoReplyErrorCode,
} from "./auto-reply-failure.ts";

const NOW = Date.parse("2026-11-24T04:00:00.000Z");

class FakeError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

test("an exhausted AI quota postpones the reply instead of failing it", () => {
  // The quota lifts at the next billing period, so a terminal `failed` row would
  // turn a temporary limit into a permanently lost reply.
  const plan = planAutoReplyFailure({
    errorCode: "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
    retryable: false,
    attempts: 1,
    sendStarted: false,
    now: NOW,
    quotaPauseMs: 30 * 60_000,
  });
  assert.equal(plan.kind, "quota_pause");
  assert.equal(plan.status, "queued");
  assert.equal(plan.errorCode, "SUBSCRIPTION_LIMIT_REACHED:aiGenerations");
  assert.equal(plan.nextRunAt.toISOString(), "2026-11-24T04:30:00.000Z");
  assert.equal(plan.returnAttempt, true);
  assert.equal(plan.completed, false);
});

test("configuration limits are postponed by the same rule", () => {
  for (const code of [
    "WORKSPACE_SUBSCRIPTION_MISSING",
    "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
    "MISSING_OPENAI_KEY",
    "MISSING_GEMINI_KEY",
    "MISSING_AI_PROVIDER_KEY",
    "AI_MODEL_NAME_INVALID",
  ]) {
    const plan = planAutoReplyFailure({
      errorCode: code,
      retryable: false,
      attempts: 3,
      sendStarted: false,
      now: NOW,
      quotaPauseMs: 60_000,
    });
    assert.equal(plan.kind, "quota_pause", code);
    // Even at the attempt ceiling: the attempts were never spent on a
    // generation, and the claim cap would otherwise strand the event.
    assert.equal(plan.returnAttempt, true, code);
  }
});

test("a transient provider fault still retries on the existing schedule", () => {
  const plan = planAutoReplyFailure({
    errorCode: "OPENAI_HTTP_500",
    retryable: true,
    attempts: 2,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.kind, "retry");
  assert.equal(plan.status, "queued");
  assert.equal(plan.returnAttempt, false);
  assert.equal(plan.completed, false);
  assert.equal(plan.nextRunAt.getTime(), NOW + 20_000);
});

test("the retry backoff stays capped at thirty seconds", () => {
  const plan = planAutoReplyFailure({
    errorCode: "GEMINI_TIMEOUT",
    retryable: true,
    attempts: 3,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.nextRunAt.getTime(), NOW + 30_000);
});

test("a fault that is neither transient nor a limit fails terminally", () => {
  const plan = planAutoReplyFailure({
    errorCode: "WHATSAPP_RECIPIENT_PHONE_REQUIRED",
    retryable: false,
    attempts: 1,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.kind, "failed");
  assert.equal(plan.status, "failed");
  assert.equal(plan.completed, true);
  assert.equal(plan.returnAttempt, false);
  assert.equal(plan.nextRunAt.getTime(), NOW);
});

test("a send that already left the server is never retried", () => {
  // Retrying an ambiguous send risks a second reply to the same customer
  // message, which is worse than an unresolved row an operator can confirm.
  const plan = planAutoReplyFailure({
    errorCode: "EVOLUTION_API_REQUEST_FAILED",
    retryable: true,
    attempts: 1,
    sendStarted: true,
    now: NOW,
  });
  assert.equal(plan.kind, "unknown_outcome");
  assert.equal(plan.status, "unknown");
  assert.equal(plan.errorCode, autoReplyResultUnknownCode);
  assert.equal(plan.completed, true);
});

test("a quota pause never outranks an ambiguous send", () => {
  const plan = planAutoReplyFailure({
    errorCode: "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
    retryable: false,
    attempts: 1,
    sendStarted: true,
    now: NOW,
  });
  assert.equal(plan.kind, "unknown_outcome");
});

test("an empty code is stored as the fallback, never as an empty string", () => {
  const plan = planAutoReplyFailure({
    errorCode: "   ",
    retryable: false,
    attempts: 1,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.errorCode, "AUTO_REPLY_FAILED");
  assert.equal(plan.kind, "failed");
});

test("an over-long code is truncated to what the column holds", () => {
  const plan = planAutoReplyFailure({
    errorCode: "X".repeat(200),
    retryable: false,
    attempts: 1,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.errorCode.length, 80);
});

test("a quota error records its stable code, not its class name", () => {
  // Before this, the queue stored `error.name`, so an exhausted quota was
  // recorded as `SubscriptionAiQuotaError`: untranslatable by the registry and
  // unmatched by the paused-code vocabulary that decides the outcome.
  const error = new FakeError(
    "SubscriptionAiQuotaError",
    "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
  );
  assert.equal(
    whatsAppAutoReplyErrorCode(error),
    "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
  );
  assert.equal(
    planAutoReplyFailure({
      errorCode: whatsAppAutoReplyErrorCode(error),
      retryable: false,
      attempts: 1,
      sendStarted: false,
      now: NOW,
      quotaPauseMs: 1,
    }).kind,
    "quota_pause",
  );
});

test("provider prose is never stored in the merchant-visible code column", () => {
  const error = new FakeError(
    "Error",
    'Unexpected token < in JSON at position 0: "<html>502 Bad Gateway</html>"',
  );
  // Not a registry-shaped code, so the class name is stored instead of prose
  // that could carry part of a model or proxy response back to the merchant.
  assert.equal(whatsAppAutoReplyErrorCode(error), "Error");
});

test("Evolution's own messages are trusted as codes", () => {
  const error = new FakeError("EvolutionApiError", "EVOLUTION_API_UNREACHABLE");
  assert.equal(
    whatsAppAutoReplyErrorCode(error, true),
    "EVOLUTION_API_UNREACHABLE",
  );
  const prose = new FakeError(
    "EvolutionApiError",
    "request to https://example.test failed",
  );
  assert.equal(
    whatsAppAutoReplyErrorCode(prose, true),
    "request to https://example.test failed",
  );
});

test("a non-error thrown value still yields a storable code", () => {
  assert.equal(whatsAppAutoReplyErrorCode("EVOLUTION_INSTANCE_NOT_FOUND"), "EVOLUTION_INSTANCE_NOT_FOUND");
  assert.equal(whatsAppAutoReplyErrorCode(null), "AUTO_REPLY_FAILED");
  assert.equal(whatsAppAutoReplyErrorCode(undefined), "AUTO_REPLY_FAILED");
  assert.equal(whatsAppAutoReplyErrorCode({}), "AUTO_REPLY_FAILED");
});

test("a pause with no configured value falls back to the shared half hour", () => {
  // The planner is pure and queue-agnostic: a queue that has not said how long
  // it waits gets the shared default, never another queue's environment.
  const plan = planAutoReplyFailure({
    errorCode: "MISSING_AI_PROVIDER_KEY",
    retryable: false,
    attempts: 1,
    sendStarted: false,
    now: NOW,
  });
  assert.equal(plan.kind, "quota_pause");
  assert.equal(plan.nextRunAt.getTime(), NOW + 30 * 60_000);
});
