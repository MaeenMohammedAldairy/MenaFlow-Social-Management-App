import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_SYNC_GROUP_CONCURRENCY,
  DEFAULT_SYNC_RUN_BUDGET_MS,
  DEFAULT_SYNC_HEARTBEAT_MS,
  resolveSyncGroupConcurrency,
  resolveSyncRunBudgetMs,
  resolveSyncHeartbeatMs,
  createRunDeadline,
  createHeartbeat,
  mapWithConcurrency,
} = await import("./sync-run-control.ts");

test("concurrency defaults and bounds survive bad configuration", () => {
  assert.equal(resolveSyncGroupConcurrency({}), DEFAULT_SYNC_GROUP_CONCURRENCY);
  assert.equal(resolveSyncGroupConcurrency({ WHATSAPP_SYNC_GROUP_CONCURRENCY: "5" }), 5);
  assert.equal(resolveSyncGroupConcurrency({ WHATSAPP_SYNC_GROUP_CONCURRENCY: "0" }), DEFAULT_SYNC_GROUP_CONCURRENCY);
  assert.equal(resolveSyncGroupConcurrency({ WHATSAPP_SYNC_GROUP_CONCURRENCY: "-3" }), DEFAULT_SYNC_GROUP_CONCURRENCY);
  assert.equal(resolveSyncGroupConcurrency({ WHATSAPP_SYNC_GROUP_CONCURRENCY: "many" }), DEFAULT_SYNC_GROUP_CONCURRENCY);
  // A typo must not be able to open hundreds of parallel provider scans.
  assert.equal(resolveSyncGroupConcurrency({ WHATSAPP_SYNC_GROUP_CONCURRENCY: "5000" }), 16);
});

test("budget and heartbeat are clamped to their floors, not silently ignored", () => {
  assert.equal(resolveSyncRunBudgetMs({}), DEFAULT_SYNC_RUN_BUDGET_MS);
  assert.equal(resolveSyncRunBudgetMs({ WHATSAPP_SYNC_RUN_BUDGET_MS: "120000" }), 120_000);
  assert.equal(resolveSyncRunBudgetMs({ WHATSAPP_SYNC_RUN_BUDGET_MS: "1" }), 30_000);
  assert.equal(resolveSyncRunBudgetMs({ WHATSAPP_SYNC_RUN_BUDGET_MS: "0" }), DEFAULT_SYNC_RUN_BUDGET_MS);
  assert.equal(resolveSyncRunBudgetMs({ WHATSAPP_SYNC_RUN_BUDGET_MS: "soon" }), DEFAULT_SYNC_RUN_BUDGET_MS);
  assert.equal(resolveSyncHeartbeatMs({}), DEFAULT_SYNC_HEARTBEAT_MS);
  assert.equal(resolveSyncHeartbeatMs({ WHATSAPP_SYNC_HEARTBEAT_MS: "15000" }), 15_000);
  // A heartbeat faster than the floor would write on nearly every page.
  assert.equal(resolveSyncHeartbeatMs({ WHATSAPP_SYNC_HEARTBEAT_MS: "10" }), 5_000);
  assert.equal(resolveSyncHeartbeatMs({ WHATSAPP_SYNC_HEARTBEAT_MS: "abc" }), DEFAULT_SYNC_HEARTBEAT_MS);
});

test("a deadline reports expiry from the injected clock only", async () => {
  let clock = 1_000;
  const deadline = createRunDeadline(500, () => clock);
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.remainingMs(), 500);
  clock = 1_499;
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.elapsedMs(), 499);
  clock = 1_500;
  assert.equal(deadline.expired(), true);
  assert.equal(deadline.remainingMs(), 0);
});

test("a non-positive budget never expires, so it cannot cancel every run", () => {
  let clock = 0;
  const deadline = createRunDeadline(0, () => clock);
  clock = 10 ** 9;
  assert.equal(deadline.expired(), false);
});

test("a heartbeat is due once per interval and resets on beat", () => {
  let clock = 0;
  const heartbeat = createHeartbeat(100, () => clock);
  assert.equal(heartbeat.due(), false);
  clock = 99;
  assert.equal(heartbeat.due(), false);
  clock = 100;
  assert.equal(heartbeat.due(), true);
  heartbeat.beat();
  assert.equal(heartbeat.due(), false);
  assert.equal(heartbeat.lastBeatAt(), 100);
  clock = 200;
  assert.equal(heartbeat.due(), true);
});

test("mapWithConcurrency never exceeds the limit and keeps input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [...Array(9).keys()];
  const results = await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, (9 - item) * 2));
    inFlight -= 1;
    return item * 2;
  });
  assert.deepEqual(results, items.map((item) => item * 2));
  assert.equal(peak, 3);
});

test("mapWithConcurrency visits every item exactly once", async () => {
  const seen = [];
  await mapWithConcurrency(["a", "b", "c", "d"], 2, async (item) => {
    seen.push(item);
  });
  assert.deepEqual([...seen].sort(), ["a", "b", "c", "d"]);
});

test("mapWithConcurrency clamps nonsensical limits to serial work", async () => {
  let peak = 0;
  let inFlight = 0;
  await mapWithConcurrency([1, 2, 3], 0, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
  });
  assert.equal(peak, 1);
});

test("mapWithConcurrency with a limit above the item count spawns no idle workers", async () => {
  const results = await mapWithConcurrency([1, 2], 50, async (item) => item + 1);
  assert.deepEqual(results, [2, 3]);
});

test("an empty item list resolves without running anything", async () => {
  let calls = 0;
  const results = await mapWithConcurrency([], 3, async () => {
    calls += 1;
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("the first failure stops new work and rejects with that error", async () => {
  const started = [];
  await assert.rejects(
    mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (item) => {
      started.push(item);
      if (item === 2) throw new Error("SYNC_TASK_FAILED");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }),
    /SYNC_TASK_FAILED/,
  );
  assert.deepEqual(started, [1, 2]);
});

test("tasks already running are awaited rather than abandoned", async () => {
  const finished = [];
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("FIRST_FAILED");
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      finished.push(item);
    }),
    /FIRST_FAILED/,
  );
  // Item 3 was already claimed before item 1 failed; it runs to completion
  // instead of being dropped halfway through a write.
  assert.deepEqual(finished, [2, 3]);
});
