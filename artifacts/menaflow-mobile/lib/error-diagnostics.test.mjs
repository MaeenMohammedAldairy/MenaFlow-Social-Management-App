import assert from "node:assert/strict";
import test from "node:test";
import { describeError } from "./error-diagnostics.ts";

test("assigns a stable code to the same error", () => {
  const first = describeError(new TypeError("Network request failed"));
  const second = describeError(new TypeError("Network request failed"));

  assert.equal(first.code, second.code);
  assert.match(first.code, /^MF-[0-9A-Z]{5}$/);
  assert.equal(first.name, "TypeError");
});

test("different errors get different codes", () => {
  const network = describeError(new TypeError("Network request failed"));
  const missing = describeError(
    new Error("Cannot read properties of undefined (reading 'map')"),
  );

  assert.notEqual(network.code, missing.code);
});

test("tolerates non-error values and empty messages", () => {
  const empty = describeError(new Error("   "));
  assert.equal(empty.message, "لم يرسل التطبيق أي رسالة مع الخطأ.");

  const thrown = describeError("boom");
  assert.equal(thrown.message, "boom");
  assert.match(thrown.code, /^MF-/);
});

test("truncates very long messages and stacks", () => {
  const longMessage = "x".repeat(600);
  const error = new Error(longMessage);
  const diagnostics = describeError(error);

  assert.ok(diagnostics.message.length <= 401);
  assert.ok(diagnostics.stack.split("\n").length <= 10);
});
