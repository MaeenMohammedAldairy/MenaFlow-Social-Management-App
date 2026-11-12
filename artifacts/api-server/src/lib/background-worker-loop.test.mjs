import assert from "node:assert/strict";
import test from "node:test";
import { startBackgroundWorkerLoop } from "./background-worker-loop.ts";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("runs distinct queues independently and reuses a loop by name", async () => {
  let firstQueueCalls = 0;
  let secondQueueCalls = 0;
  const firstQueue = startBackgroundWorkerLoop(
    "test-first-queue",
    async () => {
      firstQueueCalls += 1;
      return 0;
    },
    assert.fail,
    50,
  );
  const secondQueue = startBackgroundWorkerLoop(
    "test-second-queue",
    async () => {
      secondQueueCalls += 1;
      return 0;
    },
    assert.fail,
    50,
    false,
  );

  assert.equal(
    startBackgroundWorkerLoop(
      "test-second-queue",
      async () => 0,
      assert.fail,
      50,
      false,
    ),
    secondQueue,
  );
  await delay(20);
  await Promise.all([firstQueue.stop(), secondQueue.stop()]);

  assert.equal(firstQueueCalls, 1);
  assert.equal(secondQueueCalls, 1);
});
