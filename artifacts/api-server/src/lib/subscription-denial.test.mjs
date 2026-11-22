import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSCRIPTION_LIMIT_CODE,
  errorPayload,
  subscriptionDenial,
} from "./subscription-denial.ts";
import { errorHttpStatus, errorMessageKey } from "./error-codes.ts";

test("every denial uses the registry status and the same envelope", () => {
  for (const meter of ["postsCreated", "aiGenerations", "channels"]) {
    const denial = subscriptionDenial(meter, { used: 10, limit: 10 });

    assert.equal(denial.status, errorHttpStatus(SUBSCRIPTION_LIMIT_CODE));
    assert.equal(denial.status, 403);
    assert.equal(denial.body.code, SUBSCRIPTION_LIMIT_CODE);
    assert.equal(denial.body.errorClass, "user_action");
    assert.equal(denial.body.retryable, false);
    assert.equal(denial.body.messageKey, "subscription.limit_reached");
    assert.equal(denial.body.meter, meter);
    assert.equal(denial.body.usage, 10);
    assert.equal(denial.body.limit, 10);
    assert.ok(denial.body.error.length > 10, meter);
  }
});

test("each meter explains itself without changing the code", () => {
  const messages = ["postsCreated", "aiGenerations", "channels"].map(
    (meter) => subscriptionDenial(meter).body.error,
  );

  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) assert.match(message, /الحد/);
});

test("usage is omitted when the caller cannot know it", () => {
  const body = subscriptionDenial("postsCreated").body;

  assert.equal("usage" in body, false);
  assert.equal("limit" in body, false);
});

test("the envelope exposes the class and message key of any registered code", () => {
  const retryable = errorPayload("AI_PROVIDER_ERROR", "failed");
  assert.equal(retryable.errorClass, "retryable");
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.messageKey, errorMessageKey("AI_PROVIDER_ERROR"));

  const config = errorPayload("MISSING_AI_PROVIDER_KEY", "missing");
  assert.equal(config.errorClass, "config");
  assert.equal(config.retryable, false);
});
