import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_EXTRACTION_QUOTA_PAUSE_MS,
  EXTRACTION_BASE_RETRY_DELAY_MS,
  EXTRACTION_MAX_ATTEMPTS,
  EXTRACTION_MAX_RETRY_DELAY_MS,
  isQuotaExhaustedReason,
  resolveExtractionQuotaPauseMs,
  extractionRetryDelayMs,
  planExtractionFailure,
} = await import("./extraction-quota-policy.ts");

const now = new Date("2026-11-22T10:00:00.000Z");

test("the quota reason is recognised with its meter suffix", () => {
  assert.equal(isQuotaExhaustedReason("SUBSCRIPTION_LIMIT_REACHED:aiGenerations"), true);
  assert.equal(isQuotaExhaustedReason("SUBSCRIPTION_LIMIT_REACHED"), true);
  assert.equal(isQuotaExhaustedReason("  SUBSCRIPTION_LIMIT_REACHED:postsCreated"), true);
  assert.equal(isQuotaExhaustedReason("OPENAI_HTTP_429"), false);
  assert.equal(isQuotaExhaustedReason("PRODUCT_EXTRACTION_INVALID_JSON"), false);
  assert.equal(isQuotaExhaustedReason(null), false);
  assert.equal(isQuotaExhaustedReason(undefined), false);
});

test("an exhausted quota keeps the job pending and returns its attempt", () => {
  const plan = planExtractionFailure({
    reason: "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
    attempts: 1,
    now,
  });
  assert.equal(plan.kind, "quota_pause");
  assert.equal(plan.status, "pending");
  assert.equal(plan.consumeAttempt, false);
  assert.equal(plan.pauseWorkspaceQueue, true);
  assert.equal(
    plan.nextRunAt.getTime(),
    now.getTime() + DEFAULT_EXTRACTION_QUOTA_PAUSE_MS,
  );
});

test("the quota pause applies on the last attempt too, so it never fails the job", () => {
  const plan = planExtractionFailure({
    reason: "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
    attempts: EXTRACTION_MAX_ATTEMPTS,
    now,
  });
  assert.equal(plan.status, "pending");
  assert.equal(plan.consumeAttempt, false);
});

test("ordinary faults retry with exponential backoff", () => {
  const delays = [1, 2, 3, 4].map((attempts) =>
    planExtractionFailure({ reason: "PRODUCT_EXTRACTION_INVALID_JSON", attempts, now })
      .nextRunAt.getTime() - now.getTime(),
  );
  assert.deepEqual(delays, [
    EXTRACTION_BASE_RETRY_DELAY_MS,
    60_000,
    120_000,
    240_000,
  ]);
  for (const plan of [1, 2, 3].map((attempts) =>
    planExtractionFailure({ reason: "OPENAI_HTTP_500", attempts, now }),
  )) {
    assert.equal(plan.kind, "retry");
    assert.equal(plan.status, "pending");
    assert.equal(plan.consumeAttempt, true);
    assert.equal(plan.pauseWorkspaceQueue, false);
  }
});

test("the backoff is capped at an hour", () => {
  assert.equal(extractionRetryDelayMs(1), 30_000);
  assert.equal(extractionRetryDelayMs(10), EXTRACTION_MAX_RETRY_DELAY_MS);
  assert.equal(extractionRetryDelayMs(0), EXTRACTION_BASE_RETRY_DELAY_MS);
});

test("the fifth failed attempt fails the job", () => {
  const plan = planExtractionFailure({
    reason: "PRODUCT_EXTRACTION_INVALID_JSON",
    attempts: EXTRACTION_MAX_ATTEMPTS,
    now,
  });
  assert.equal(plan.kind, "attempts_exhausted");
  assert.equal(plan.status, "failed");
  assert.equal(plan.nextRunAt.getTime(), now.getTime());
});

test("the attempt ceiling is configurable", () => {
  const plan = planExtractionFailure({
    reason: "PRODUCT_EXTRACTION_INVALID_JSON",
    attempts: 2,
    now,
    maxAttempts: 2,
  });
  assert.equal(plan.status, "failed");
});

test("the quota pause is configurable but floored", () => {
  assert.equal(resolveExtractionQuotaPauseMs({}), DEFAULT_EXTRACTION_QUOTA_PAUSE_MS);
  assert.equal(
    resolveExtractionQuotaPauseMs({ PRODUCT_EXTRACTION_QUOTA_PAUSE_MS: "3600000" }),
    3_600_000,
  );
  // Below the floor a misconfiguration would hammer the metered provider, so
  // the value is raised to five minutes rather than honoured.
  assert.equal(
    resolveExtractionQuotaPauseMs({ PRODUCT_EXTRACTION_QUOTA_PAUSE_MS: "1000" }),
    300_000,
  );
  assert.equal(
    resolveExtractionQuotaPauseMs({ PRODUCT_EXTRACTION_QUOTA_PAUSE_MS: "abc" }),
    DEFAULT_EXTRACTION_QUOTA_PAUSE_MS,
  );
  const plan = planExtractionFailure({
    reason: "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
    attempts: 1,
    now,
    quotaPauseMs: 90_000,
  });
  assert.equal(plan.nextRunAt.getTime(), now.getTime() + 90_000);
});
