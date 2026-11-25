import assert from "node:assert/strict";
import test from "node:test";
import { CreatePostBody, UpdateOnboardingProgressBody, UpdatePostBody, UpdateWorkspaceCurrentBody } from "./generated/api.ts";

test("workspace country accepts uppercase two-letter codes only", () => {
  assert.equal(UpdateWorkspaceCurrentBody.safeParse({ country: "YE" }).success, true);
  for (const country of ["ye", "YEM", "Y", "12"]) {
    assert.equal(UpdateWorkspaceCurrentBody.safeParse({ country }).success, false, country);
  }
});

test("expected onboarding step is optional and bounded", () => {
  assert.equal(UpdateOnboardingProgressBody.safeParse({ action: "advance" }).success, true);
  assert.equal(UpdateOnboardingProgressBody.safeParse({ action: "advance", expectedStep: 1 }).success, true);
  assert.equal(UpdateOnboardingProgressBody.safeParse({ action: "advance", expectedStep: 4 }).success, false);
});

test("post bodies keep scheduledAt a string instead of coercing it to a Date", () => {
  // The contract, the wire and the generated client all say `string`, but the
  // generator used to emit `zod.coerce.date()`, which turned the ISO string
  // into a Date object. The server's `parseScheduledAt` refuses anything that
  // is not a string, so every scheduled post was answered 422 — on create and
  // on patch — however valid the instant was.
  const instant = "2026-11-23T15:30:00Z";
  const created = CreatePostBody.safeParse({
    title: "عنوان",
    body: "نص",
    channels: ["facebook"],
    status: "scheduled",
    scheduledAt: instant,
  });
  assert.equal(created.success, true);
  assert.equal(typeof created.data.scheduledAt, "string");
  assert.equal(created.data.scheduledAt, instant);

  const patched = UpdatePostBody.safeParse({ scheduledAt: instant });
  assert.equal(patched.success, true);
  assert.equal(typeof patched.data.scheduledAt, "string");
  // `null` still clears the due time.
  assert.equal(UpdatePostBody.safeParse({ scheduledAt: null }).data.scheduledAt, null);
});
