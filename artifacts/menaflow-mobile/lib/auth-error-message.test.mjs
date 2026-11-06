import assert from "node:assert/strict";
import test from "node:test";
import { getAuthErrorMessage } from "./auth-error-message.ts";

test("translates common Clerk sign-in and verification errors", () => {
  assert.match(
    getAuthErrorMessage(
      { errors: [{ code: "form_identifier_not_found" }] },
      "fallback",
    ),
    /لم نعثر على حساب/,
  );
  assert.match(
    getAuthErrorMessage(
      { errors: [{ code: "verification_attempt_exceeded" }] },
      "fallback",
    ),
    /تجاوزت عدد محاولات التحقق/,
  );
});

test("uses the provided fallback for unrecognized Clerk errors", () => {
  assert.equal(
    getAuthErrorMessage({ errors: [{ code: "unknown_code" }] }, "حدث خطأ"),
    "حدث خطأ",
  );
});