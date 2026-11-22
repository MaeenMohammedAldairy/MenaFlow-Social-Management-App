import assert from "node:assert/strict";
import test from "node:test";
import {
  errorClass,
  errorDefinition,
  errorHttpStatus,
  errorMessageKey,
  isRetryableErrorCode,
  registeredErrorCodes,
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
