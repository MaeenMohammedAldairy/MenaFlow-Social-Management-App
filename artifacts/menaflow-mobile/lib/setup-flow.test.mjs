import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditBusinessInfo,
  shouldArmSkipRetry,
  shouldReplayPendingSkip,
} from "./setup-flow.ts";

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

const armed = {
  isOffline: false,
  wasOffline: true,
  awaitingRetry: true,
  pendingExit: "dashboard",
  requestInFlight: false,
};

test("an armed skip replays exactly on the offline to online transition", () => {
  assert.equal(shouldReplayPendingSkip(armed), true);
});

test("still offline means wait", () => {
  assert.equal(shouldReplayPendingSkip({ ...armed, isOffline: true }), false);
});

test("no offline stretch observed means no replay", () => {
  // A server-side rejection while online must not loop.
  assert.equal(shouldReplayPendingSkip({ ...armed, wasOffline: false }), false);
});

test("nothing replays without an armed retry, an exit, or with a request in flight", () => {
  assert.equal(
    shouldReplayPendingSkip({ ...armed, awaitingRetry: false }),
    false,
  );
  assert.equal(shouldReplayPendingSkip({ ...armed, pendingExit: null }), false);
  assert.equal(
    shouldReplayPendingSkip({ ...armed, requestInFlight: true }),
    false,
  );
});

test("only an offline failure is armed for the automatic retry", () => {
  assert.equal(shouldArmSkipRetry(true), true);
  assert.equal(shouldArmSkipRetry(false), false);
});
