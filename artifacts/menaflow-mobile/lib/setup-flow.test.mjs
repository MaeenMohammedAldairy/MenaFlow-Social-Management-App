import assert from "node:assert/strict";
import test from "node:test";
import { canEditBusinessInfo } from "./setup-flow.ts";

const OWNER = { role: "owner" };
const MEMBER = { role: "member" };

test("the owner can edit business info", () => {
  assert.equal(canEditBusinessInfo(OWNER), true);
});

test("a member cannot — PATCH /workspaces/current is owner-only", () => {
  // Without this the checklist would pin an impossible step on them forever.
  assert.equal(canEditBusinessInfo(MEMBER), false);
});

test("an unknown role does not hide the step while the list loads", () => {
  // Regression guard: treating null as "not owner" would make the step blink
  // out and back in on every cold start.
  assert.equal(canEditBusinessInfo(null), true);
});

test("local-auth mode has no workspace row to gate", () => {
  assert.equal(canEditBusinessInfo(null, { isLocalAuthDisabled: true }), true);
  assert.equal(
    canEditBusinessInfo(MEMBER, { isLocalAuthDisabled: true }),
    true,
  );
});
