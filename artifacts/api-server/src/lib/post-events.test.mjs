import assert from "node:assert/strict";
import test from "node:test";
import { notifyPostsChanged, subscribeToPostChanges } from "./post-events.ts";

test("post change notifications are scoped to the owner and stop after unsubscribe", () => {
  let ownerOneEvents = 0;
  let ownerTwoEvents = 0;
  const unsubscribeOne = subscribeToPostChanges("owner-one", () => ownerOneEvents++);
  const unsubscribeTwo = subscribeToPostChanges("owner-two", () => ownerTwoEvents++);

  notifyPostsChanged("owner-one");
  assert.equal(ownerOneEvents, 1);
  assert.equal(ownerTwoEvents, 0);

  unsubscribeOne();
  notifyPostsChanged("owner-one");
  notifyPostsChanged("owner-two");
  assert.equal(ownerOneEvents, 1);
  assert.equal(ownerTwoEvents, 1);

  unsubscribeTwo();
});
