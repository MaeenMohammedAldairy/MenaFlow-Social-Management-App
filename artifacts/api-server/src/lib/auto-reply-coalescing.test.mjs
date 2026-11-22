import assert from "node:assert/strict";
import test from "node:test";
import {
  metaAutoReplyDebounceMs,
  metaAutoReplyNextRunAt,
  metaAutoReplySupersededCode,
} from "./meta-auto-reply.ts";
import {
  whatsAppAutoReplyDebounceMs,
  whatsAppAutoReplyDefaultHourlyLimit,
  whatsAppAutoReplyHourlyLimit,
  whatsAppAutoReplyLoopGuardCode,
  whatsAppAutoReplyNextRunAt,
} from "./whatsapp-auto-reply-policy.ts";
import {
  backgroundWorkerSnapshots,
  startBackgroundWorkerLoop,
} from "./background-worker-loop.ts";

test("meta auto replies wait for the debounce window before running", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  assert.equal(
    metaAutoReplyNextRunAt(now).toISOString(),
    new Date(now.getTime() + metaAutoReplyDebounceMs).toISOString(),
  );
  assert.ok(metaAutoReplyDebounceMs > 0);
});

test("whatsapp auto replies use the same debounce behaviour", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  assert.equal(
    whatsAppAutoReplyNextRunAt(now).getTime(),
    now.getTime() + whatsAppAutoReplyDebounceMs,
  );
  assert.equal(whatsAppAutoReplyDebounceMs, metaAutoReplyDebounceMs);
});

test("superseded meta replies are recorded with a stable error code", () => {
  assert.equal(metaAutoReplySupersededCode, "SUPERSEDED_BY_NEWER_MESSAGE");
});

test("a chat is capped at a sensible number of automatic replies per hour", () => {
  assert.equal(whatsAppAutoReplyHourlyLimit(undefined), whatsAppAutoReplyDefaultHourlyLimit);
  assert.equal(whatsAppAutoReplyHourlyLimit("5"), 5);
  assert.equal(whatsAppAutoReplyHourlyLimit("1000"), 100);
  assert.equal(whatsAppAutoReplyHourlyLimit("0"), whatsAppAutoReplyDefaultHourlyLimit);
  assert.equal(whatsAppAutoReplyHourlyLimit("nonsense"), whatsAppAutoReplyDefaultHourlyLimit);
  assert.equal(whatsAppAutoReplyLoopGuardCode, "AUTO_REPLY_LOOP_GUARD");
});

test("worker snapshots expose a heartbeat a readiness check can read", async () => {
  assert.deepEqual(backgroundWorkerSnapshots(), []);
  const handle = startBackgroundWorkerLoop(
    "heartbeat-test",
    async () => 0,
    () => {},
    60_000,
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const [snapshot] = backgroundWorkerSnapshots();
  assert.equal(snapshot.name, "heartbeat-test");
  assert.equal(snapshot.intervalMs, 60_000);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.consecutiveErrors, 0);
  assert.equal(snapshot.stale, false);
  assert.ok(snapshot.lastRunStartedAt);
  await handle.stop();
});
