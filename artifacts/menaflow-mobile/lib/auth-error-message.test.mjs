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
test("distinguishes duplicate usernames from duplicate emails", () => {
  assert.match(getAuthErrorMessage({ errors: [{ code: "form_identifier_exists", meta: { paramName: "username" } }] }, "fallback"), /اسم المستخدم مستخدم بالفعل/);
  assert.match(getAuthErrorMessage({ errors: [{ code: "form_identifier_exists", meta: { param_name: "email_address" } }] }, "fallback"), /البريد الإلكتروني مرتبط بحساب/);
  assert.match(getAuthErrorMessage({ code: "form_identifier_exists", meta: { paramName: "phone_number" } }, "fallback"), /رقم الهاتف مرتبط بحساب/);
});

test("does not falsely identify the email when Clerk omits the duplicate field", () => {
  const message = getAuthErrorMessage({ errors: [{ code: "form_identifier_exists" }] }, "fallback");
  assert.match(message, /البريد الإلكتروني أو اسم المستخدم/);
});
