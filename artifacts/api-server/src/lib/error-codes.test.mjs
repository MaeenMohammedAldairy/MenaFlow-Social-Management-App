import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReplyGenerationPausedCodes,
  classifyAutoReplyGenerationFailure,
  errorClass,
  errorDefinition,
  errorHttpStatus,
  errorMessageKey,
  isAutoReplyGenerationPausedCode,
  isRetryableErrorCode,
  MAX_ERROR_CODE_LENGTH,
  registeredErrorCodes,
  stableErrorCode,
} from "./error-codes.ts";

const classes = ["retryable", "user_action", "config", "unknown_outcome"];

test("every registered code declares one of the four classes", () => {
  const codes = registeredErrorCodes();
  assert.ok(codes.length > 0);

  for (const code of codes) {
    const definition = errorDefinition(code);
    assert.ok(definition, code);
    assert.ok(classes.includes(definition.class), `${code}: ${definition.class}`);
    assert.ok(definition.httpStatus >= 200 && definition.httpStatus < 600, code);
    assert.match(definition.messageKey, /^[a-z]+\.[a-z_]+$/, code);
  }
});

test("the class decides the HTTP status contract", () => {
  const expected = {
    user_action: [403, 409],
    config: [500],
    retryable: [502],
    unknown_outcome: [202],
  };

  for (const code of registeredErrorCodes()) {
    const definition = errorDefinition(code);
    assert.ok(
      expected[definition.class].includes(definition.httpStatus),
      `${code} is ${definition.class} with ${definition.httpStatus}`,
    );
  }
});

test("unknown codes fail closed as configuration errors", () => {
  for (const code of ["", "  ", "NOT_A_REAL_CODE", "SOMETHING_NEW:failure"]) {
    assert.equal(errorDefinition(code), null, code);
    assert.equal(errorClass(code), "config", code);
    assert.equal(errorHttpStatus(code), 500, code);
    assert.equal(errorMessageKey(code), "error.unexpected", code);
    assert.equal(isRetryableErrorCode(code), false, code);
  }
});

test("error codes carry a detail suffix without losing their definition", () => {
  assert.equal(errorClass("SUBSCRIPTION_LIMIT_REACHED:posts"), "user_action");
  assert.equal(
    errorMessageKey("SUBSCRIPTION_LIMIT_REACHED:posts"),
    "subscription.limit_reached",
  );
  assert.equal(errorHttpStatus("SUBSCRIPTION_LIMIT_REACHED:posts"), 403);
});

test("retryable and unknown-outcome codes never collide", () => {
  for (const code of registeredErrorCodes()) {
    const definition = errorDefinition(code);
    if (definition.class === "unknown_outcome") {
      assert.equal(isRetryableErrorCode(code), false, code);
    }
  }
});

test("a registry-shaped code is recognized, with or without its suffix", () => {
  assert.equal(stableErrorCode("SUBSCRIPTION_LIMIT_REACHED"), "SUBSCRIPTION_LIMIT_REACHED");
  assert.equal(
    stableErrorCode("SUBSCRIPTION_LIMIT_REACHED:aiGenerations"),
    "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
  );
  assert.equal(stableErrorCode("  MISSING_AI_PROVIDER_KEY  "), "MISSING_AI_PROVIDER_KEY");
  assert.equal(stableErrorCode("EVOLUTION_API_UNREACHABLE"), "EVOLUTION_API_UNREACHABLE");
});

test("prose, class names and empty values are not codes", () => {
  // Storing any of these in an `error_code` column means the merchant's app
  // either shows an untranslatable string or renders a provider's prose back.
  for (const value of [
    "",
    "   ",
    null,
    undefined,
    "Error",
    "SubscriptionAiQuotaError",
    "request to https://example.test failed",
    "<html>502 Bad Gateway</html>",
    "lowercase_code",
    "A".repeat(MAX_ERROR_CODE_LENGTH + 1),
  ]) {
    assert.equal(stableErrorCode(value), null, String(value));
  }
  assert.equal(MAX_ERROR_CODE_LENGTH, 80);
});

test("limits that lift by themselves are the paused codes", () => {
  for (const code of autoReplyGenerationPausedCodes) {
    assert.equal(isAutoReplyGenerationPausedCode(code), true, code);
    assert.equal(isAutoReplyGenerationPausedCode(`${code}:detail`), true, code);
    assert.equal(classifyAutoReplyGenerationFailure(code), "skipped", code);
  }
  // A quota exhaustion arrives with the resource named; the bare prefix must
  // still be recognized.
  assert.equal(
    classifyAutoReplyGenerationFailure("SUBSCRIPTION_LIMIT_REACHED:aiGenerations"),
    "skipped",
  );
});

test("real faults are never classified as a pause", () => {
  for (const code of [
    "OPENAI_HTTP_429",
    "GEMINI_EMPTY_RESPONSE",
    "META_AUTO_REPLY_INVALID_RESPONSE",
    "EVOLUTION_API_UNREACHABLE",
    "WHATSAPP_RECIPIENT_PHONE_REQUIRED",
    "",
  ]) {
    assert.equal(classifyAutoReplyGenerationFailure(code), "failed", code);
    assert.equal(isAutoReplyGenerationPausedCode(code), false, code);
  }
});

test("every paused code is registered so it can be translated", () => {
  // A paused code the registry does not know would reach the merchant as a bare
  // string, which is the failure this vocabulary exists to prevent.
  const registered = new Set(registeredErrorCodes());
  for (const code of autoReplyGenerationPausedCodes) {
    assert.ok(registered.has(code), code);
  }
});
