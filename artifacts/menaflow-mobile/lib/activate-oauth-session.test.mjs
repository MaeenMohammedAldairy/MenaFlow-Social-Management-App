import assert from "node:assert/strict";
import test from "node:test";
import { activateOAuthSession } from "./activate-oauth-session.ts";

test("activates the Clerk session before navigating after OAuth", async () => {
  const calls = [];

  const activated = await activateOAuthSession(
    "oauth-session-id",
    async ({ session }) => {
      calls.push(`activate:${session}`);
    },
    () => calls.push("navigate"),
  );

  assert.equal(activated, true);
  assert.deepEqual(calls, ["activate:oauth-session-id", "navigate"]);
});

test("does not navigate when Clerk cannot activate the OAuth session", async () => {
  let navigated = false;

  await assert.rejects(
    activateOAuthSession(
      "oauth-session-id",
      async () => {
        throw new Error("activation failed");
      },
      () => {
        navigated = true;
      },
    ),
    /activation failed/,
  );

  assert.equal(navigated, false);
});