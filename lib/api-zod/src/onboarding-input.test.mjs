import assert from "node:assert/strict";
import test from "node:test";
import { UpdateOnboardingProgressBody, UpdateWorkspaceCurrentBody } from "./generated/api.ts";

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
