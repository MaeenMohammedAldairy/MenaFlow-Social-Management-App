import assert from "node:assert/strict";
import test from "node:test";
import { requestPostsSync, setPostsSyncListener } from "./posts-sync-signal.ts";

test("a sync request with no store mounted reports that nothing happened", () => {
  // The caller is the root layout's alert handler, which can fire before the
  // provider has mounted (or after it has unmounted on sign-out). "Nobody is
  // listening" has to be distinguishable from "the store synced".
  assert.equal(requestPostsSync(), false);
});

test("a registered store receives the request", () => {
  let calls = 0;
  const unregister = setPostsSyncListener(() => {
    calls += 1;
  });
  try {
    assert.equal(requestPostsSync(), true);
    assert.equal(requestPostsSync(), true);
    assert.equal(calls, 2);
  } finally {
    unregister();
  }
  assert.equal(requestPostsSync(), false, "unregistering detaches the listener");
});

test("registering null detaches", () => {
  let calls = 0;
  setPostsSyncListener(() => {
    calls += 1;
  });
  setPostsSyncListener(null);
  assert.equal(requestPostsSync(), false);
  assert.equal(calls, 0);
});

test("an overlapping remount does not detach the mounted store", () => {
  // React runs a replacement effect's cleanup and setup in an order that must not
  // leave the new provider without a listener: the older unregister call has to be
  // a no-op once something else has taken over.
  let firstCalls = 0;
  let secondCalls = 0;
  const unregisterFirst = setPostsSyncListener(() => {
    firstCalls += 1;
  });
  const unregisterSecond = setPostsSyncListener(() => {
    secondCalls += 1;
  });

  unregisterFirst();
  assert.equal(requestPostsSync(), true);
  assert.deepEqual([firstCalls, secondCalls], [0, 1]);

  unregisterSecond();
  assert.equal(requestPostsSync(), false);
});
