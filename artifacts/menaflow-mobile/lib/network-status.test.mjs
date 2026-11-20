import assert from "node:assert/strict";
import test from "node:test";
import {
  isOffline,
  markNetworkAvailable,
  markNetworkUnavailable,
  subscribeToNetworkStatus,
} from "./network-status.ts";

test("starts online", () => {
  assert.equal(isOffline(), false);
});

test("reports offline once and notifies subscribers", () => {
  let calls = 0;
  const unsubscribe = subscribeToNetworkStatus(() => {
    calls += 1;
  });
  markNetworkUnavailable();
  markNetworkUnavailable();
  assert.equal(isOffline(), true);
  assert.equal(calls, 1);
  markNetworkAvailable();
  assert.equal(isOffline(), false);
  assert.equal(calls, 2);
  unsubscribe();
});

test("stops notifying after unsubscribe", () => {
  let calls = 0;
  const unsubscribe = subscribeToNetworkStatus(() => {
    calls += 1;
  });
  unsubscribe();
  markNetworkUnavailable();
  markNetworkAvailable();
  assert.equal(calls, 0);
  assert.equal(isOffline(), false);
});
