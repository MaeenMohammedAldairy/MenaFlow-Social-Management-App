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
    async () => calls.push("before"),
  );

  // "before" is where the push token is unregistered: it must run while the
  // session still exists, because the DELETE that removes the device is
  // authenticated.
  assert.deepEqual(calls, ["cancel", "before", "sign-out", "clear"]);
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
      async () => {},
    ),
    /sign-out failed/,
  );

  assert.equal(cleared, false);
});
test("a failing pre-sign-out hook does not trap the user in the session", async () => {
  const calls = [];

  await signOutAndClearQueryCache(
    {
      cancelQueries: async () => calls.push("cancel"),
      clear: () => calls.push("clear"),
    },
    async () => calls.push("sign-out"),
    async () => {
      calls.push("before");
      throw new Error("network is down");
    },
  );

  // Signing out must win over a failed push unregistration: the device is
  // corrected the next time anybody signs in on it, whereas a stuck session is
  // a privacy problem.
  assert.deepEqual(calls, ["cancel", "before", "sign-out", "clear"]);
});
