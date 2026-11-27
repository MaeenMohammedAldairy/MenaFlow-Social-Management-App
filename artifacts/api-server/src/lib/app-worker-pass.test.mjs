// ---------------------------------------------------------------------------
// One pass over the background workers, for a caller that has no timer.
//
// Every queue in this product — media downloads, extraction, publication,
// auto-replies, push — is driven by a `setInterval` inside the API process. That
// is invisible in production on 2026-11-27: `vercel.json` carries `rewrites`
// only, no `crons`, and four media rows sat past `next_attempt_at` while the
// platform froze the instance that owned the timers. A queue that only advances
// while a customer happens to keep a function warm is not a queue.
//
// The fix has to be a *thing a scheduler can call*, so the loop body moves here,
// dependency-free, and `app-workers.ts` just feeds it its own worker list. These
// tests are the reason it is not inlined there: a runner that imports the server
// graph cannot be unit-tested, and an untested runner is where a busy worker gets
// started twice — which is the failure mode this whole file exists to avoid.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";

const { runWorkerPass } = await import("./app-worker-pass.ts");

function worker(name, options = {}) {
  return {
    name,
    intervalMs: options.intervalMs ?? 3_000,
    enabled: () => options.enabled !== false,
    run: options.run ?? (async () => 0),
    disabledMessage: "",
    errorMessage: `worker ${name} failed`,
  };
}

test("runs every enabled worker once, in registration order", async () => {
  const seen = [];
  const result = await runWorkerPass({
    definitions: [
      worker("a", { run: async () => { seen.push("a"); return 2; } }),
      worker("b", { enabled: false }),
      worker("c", { run: async () => { seen.push("c"); return 0; } }),
    ],
    inFlight: new Set(),
  });
  assert.deepEqual(seen, ["a", "c"]);
  assert.deepEqual(result.ran, ["a", "c"]);
  assert.deepEqual(result.disabled, ["b"]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.processed, 2);
});

test("one failing worker does not stop the pass, and names its error", async () => {
  const result = await runWorkerPass({
    definitions: [
      worker("broken", {
        run: async () => {
          throw new Error("QUEUE_LOCK_TIMEOUT");
        },
      }),
      worker("healthy"),
    ],
    inFlight: new Set(),
  });
  assert.deepEqual(
    result.failed.map((failure) => failure.name),
    ["broken"],
  );
  assert.match(result.failed[0].error, /QUEUE_LOCK_TIMEOUT/);
  // The pass kept going: a stalled extraction queue must not stop media downloads.
  assert.deepEqual(result.ran, ["healthy"]);
});

test("a worker still running from an earlier pass is reported busy, not doubled", async () => {
  const inFlight = new Set();
  let release = () => {};
  const blocker = worker("slow", {
    run: () => new Promise((resolve) => { release = () => resolve(1); }),
  });

  const first = runWorkerPass({ definitions: [blocker], inFlight });
  const second = await runWorkerPass({ definitions: [blocker], inFlight });
  assert.deepEqual(second.busy, ["slow"], "two overlapping passes on one queue");
  assert.deepEqual(second.ran, []);

  release();
  assert.deepEqual((await first).ran, ["slow"]);
  // Released, so the next pass may take the name again: the guard is per run, not
  // a permanent blacklist written by the first failure to finish.
  const third = await runWorkerPass({
    definitions: [worker("slow", { run: async () => 7 })],
    inFlight,
  });
  assert.deepEqual(third.busy, []);
  assert.deepEqual(third.ran, ["slow"]);
});

test("a pass that runs out of budget defers the rest instead of being killed", async () => {
  // A Vercel function is cut off at its timeout; a half-finished pass with no
  // answer is worse than a pass that says what it skipped. The clock advances
  // 1s per worker here, so the budget is spent after the first.
  let ticks = 0;
  const result = await runWorkerPass({
    definitions: [worker("one"), worker("two"), worker("three")],
    inFlight: new Set(),
    budgetMs: 1,
    now: () => ++ticks * 1_000,
  });
  assert.deepEqual(result.ran, ["one"]);
  assert.deepEqual(result.deferred, ["two", "three"]);
});

test("a budget of zero means no limit", async () => {
  let ticks = 0;
  const result = await runWorkerPass({
    definitions: [worker("one"), worker("two")],
    inFlight: new Set(),
    budgetMs: 0,
    now: () => ++ticks * 60_000,
  });
  assert.deepEqual(result.ran, ["one", "two"]);
  assert.deepEqual(result.deferred, []);
});

test("only the named workers run, so one queue can be driven alone", async () => {
  const seen = [];
  const result = await runWorkerPass({
    definitions: [
      worker("media-download", { run: async () => { seen.push("media"); return 0; } }),
      worker("product-extraction", { run: async () => { seen.push("extraction"); return 0; } }),
    ],
    inFlight: new Set(),
    only: ["product-extraction"],
  });
  assert.deepEqual(seen, ["extraction"]);
  assert.deepEqual(result.ran, ["product-extraction"]);
  // Not asked for, not run, and not reported as a failure or as skipped-by-config.
  assert.deepEqual(result.disabled, []);
});

test("the elapsed time is reported, because a tick that took 30s is the finding", async () => {
  const startedAt = 10_000;
  let current = startedAt;
  const result = await runWorkerPass({
    definitions: [worker("slow", { run: async () => { current += 250; return 0; } })],
    inFlight: new Set(),
    now: () => current,
  });
  assert.equal(result.durationMs, 250);
});

/**
 * The registration itself, checked statically. `app-workers.ts` cannot be
 * imported here (it pulls in the whole server graph, which is why this runner was
 * extracted), so the wiring is asserted the way `whatsapp-product-extraction`
 * asserts its DB contract: by reading the file.
 */
test("the worker list and the tick share one definition, not two", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("./app-workers.ts", import.meta.url),
    "utf8",
  );
  const tick = await readFile(
    new URL("../routes/worker-tick.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runAppWorkersOnce/);
  assert.match(source, /runWorkerPass\(/);
  assert.match(source, /const workers: WorkerDefinition\[\]/);
  // The route must not keep its own list of queues: two lists drift, and the
  // one nobody reads is the one that stops running.
  assert.doesNotMatch(tick, /processWhatsAppMediaDownloadQueue/);
  assert.match(tick, /runAppWorkersOnce/);
  assert.match(tick, /workerTickAccessDecision|decideWorkerTickAccess/);
});
