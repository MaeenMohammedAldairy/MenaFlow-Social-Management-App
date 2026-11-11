import assert from "node:assert/strict";
import test from "node:test";
import { startWhatsAppCloudWorkerLoop } from "./whatsapp-cloud-worker-loop.ts";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("starts immediately, prevents duplicate loops, and drains without waiting for HTTP requests", async () => {
  let calls = 0;
  const runOnce = async () => {
    calls += 1;
    return calls < 3 ? 1 : 0;
  };
  const first = startWhatsAppCloudWorkerLoop(runOnce, assert.fail, 50);
  const duplicate = startWhatsAppCloudWorkerLoop(runOnce, assert.fail, 50);

  assert.equal(duplicate, first);
  await delay(20);
  assert.equal(calls, 3);

  await first.stop();
});

test("does not overlap runs and waits for the active run when stopping", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let finishRun;
  const runOnce = () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      finishRun = () => {
        active -= 1;
        resolve(0);
      };
    });
  };

  const loop = startWhatsAppCloudWorkerLoop(runOnce, assert.fail, 5);
  await delay(15);
  assert.equal(calls, 1);
  assert.equal(maxActive, 1);

  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await delay(5);
  assert.equal(stopped, false);

  finishRun();
  await stopping;
  await delay(15);
  assert.equal(calls, 1);
  assert.equal(maxActive, 1);
});

test("reports a polling failure and keeps the loop available for retry", async () => {
  let calls = 0;
  const errors = [];
  const loop = startWhatsAppCloudWorkerLoop(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return 0;
    },
    (error) => errors.push(error),
    30,
  );

  const deadline = Date.now() + 500;
  while (calls < 2 && Date.now() < deadline) {
    await delay(5);
  }
  await loop.stop();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "temporary failure");
});
