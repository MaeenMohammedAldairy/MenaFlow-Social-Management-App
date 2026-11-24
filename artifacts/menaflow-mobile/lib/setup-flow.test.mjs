import assert from "node:assert/strict";
import test from "node:test";
import { canEditBusinessInfo, setupChecklistProgress } from "./setup-flow.ts";

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


const ALL_KNOWN = { canEditBusinessInfo: true, connectionsStateKnown: true };

const steps = (overrides = {}) => {
  const done = {
    "business-info": true,
    accounts: true,
    "first-post": true,
    "auto-publish": false,
    ...overrides,
  };
  return Object.entries(done).map(([key, isDone]) => ({
    key,
    done: isDone,
  }));
};

test("a fully known checklist counts every step except the optional one", () => {
  const progress = setupChecklistProgress(steps(), ALL_KNOWN);
  assert.deepEqual(progress.visibleKeys, [
    "business-info",
    "accounts",
    "first-post",
    "auto-publish",
  ]);
  assert.deepEqual(progress.requiredKeys, [
    "business-info",
    "accounts",
    "first-post",
  ]);
  assert.deepEqual([progress.completed, progress.total], [3, 3]);
  assert.equal(progress.isComplete, true);
});

test("auto-publish is a recommendation, so it never keeps the card alive", () => {
  // The optional step stays visible (the merchant may want it) and stays out of the
  // count, so leaving it off cannot make an otherwise finished checklist reappear.
  const progress = setupChecklistProgress(
    steps({ "auto-publish": false }),
    ALL_KNOWN,
  );
  assert.equal(progress.visibleKeys.includes("auto-publish"), true);
  assert.equal(progress.requiredKeys.includes("auto-publish"), false);
  assert.equal(progress.isComplete, true);
});

test("an unknown connections state discounts the accounts step instead of counting it as owed", () => {
  // The regression this module exists for: the connections query loading or erroring
  // used to read as "no publishing account linked", so a merchant who had already
  // linked a page was told they owed it for as long as the network was bad.
  const progress = setupChecklistProgress(
    steps({ accounts: false, "first-post": false }),
    { canEditBusinessInfo: true, connectionsStateKnown: false },
  );
  assert.equal(progress.visibleKeys.includes("accounts"), true,
    "the step stays on the card so it can still be tapped");
  assert.equal(progress.requiredKeys.includes("accounts"), false);
  assert.deepEqual(progress.requiredKeys, ["business-info", "first-post"]);
  // business-info is done, first-post is not, and accounts is not counted at all.
  assert.deepEqual([progress.completed, progress.total], [1, 2]);
  assert.equal(progress.isComplete, false);
});

test("an unknown connections state cannot hide a finished checklist either", () => {
  // Discounting is not the same as assuming done: with the accounts step unknown and
  // nothing else outstanding, the card stays out of the way rather than claiming 0/0.
  const progress = setupChecklistProgress(
    steps({ accounts: true, "first-post": true }),
    { canEditBusinessInfo: true, connectionsStateKnown: false },
  );
  assert.deepEqual(progress.requiredKeys, ["business-info", "first-post"]);
  assert.equal(progress.isComplete, true);
});

test("business-info a member cannot complete is hidden, not shown pre-checked", () => {
  const progress = setupChecklistProgress(
    steps({ "business-info": false }),
    { canEditBusinessInfo: false, connectionsStateKnown: true },
  );
  assert.equal(progress.visibleKeys.includes("business-info"), false);
  assert.equal(progress.requiredKeys.includes("business-info"), false);
  assert.deepEqual([progress.completed, progress.total], [2, 2]);
  assert.equal(progress.isComplete, true);
});

test("an empty checklist is complete, so the card stays away", () => {
  const progress = setupChecklistProgress([], ALL_KNOWN);
  assert.deepEqual(progress.requiredKeys, []);
  assert.deepEqual([progress.completed, progress.total], [0, 0]);
  assert.equal(progress.isComplete, true);
});

test("progress keeps display order and ignores steps it is not given", () => {
  const progress = setupChecklistProgress(
    [
      { key: "first-post", done: false },
      { key: "accounts", done: true },
    ],
    ALL_KNOWN,
  );
  assert.deepEqual(progress.visibleKeys, ["first-post", "accounts"]);
  assert.deepEqual(progress.requiredKeys, ["first-post", "accounts"]);
  assert.deepEqual([progress.completed, progress.total], [1, 2]);
  assert.equal(progress.isComplete, false);
});
