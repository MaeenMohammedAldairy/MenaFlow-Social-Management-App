import assert from "node:assert/strict";
import test from "node:test";
import { signOutAndClearQueryCache } from "./sign-out.ts";

test("cancels requests, signs out, then clears cached user data", async () => {
  const calls = [];

  await signOutAndClearQueryCache(
    {
      cancelQueries: async () => calls.push("cancel"),
      clear: () => calls.push("clear"),
    },
    async () => calls.push("sign-out"),
  );

  assert.deepEqual(calls, ["cancel", "sign-out", "clear"]);
});

test("keeps cached data when signing out fails", async () => {
  let cleared = false;

  await assert.rejects(
    signOutAndClearQueryCache(
      {
        cancelQueries: async () => {},
        clear: () => {
          cleared = true;
        },
      },
      async () => {
        throw new Error("sign-out failed");
      },
    ),
    /sign-out failed/,
  );

  assert.equal(cleared, false);
});