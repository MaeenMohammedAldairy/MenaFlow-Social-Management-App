import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReplyDebounceMs,
  autoReplyNextRunAt,
} from "./auto-reply-policy.ts";
import {
  whatsAppAutoReplyDefaultMaxAgeMs,
  whatsAppAutoReplyMaxAgeMs,
  whatsAppAutoReplyWindowExpiredCode,
} from "./whatsapp-auto-reply-policy.ts";
import {
  backgroundWorkerSnapshots,
  startBackgroundWorkerLoop,
} from "./background-worker-loop.ts";

// The debounce, the superseded and loop-guard codes and the hourly ceiling used
// to be defined once per queue and then asserted equal here. They are one
// definition now (`auto-reply-policy.ts`, with its own tests); what remains is
// the behaviour this file is named for, checked once for both queues.
test("a queued reply waits for the debounce window before running", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  assert.equal(
    autoReplyNextRunAt(now).toISOString(),
    new Date(now.getTime() + autoReplyDebounceMs).toISOString(),
  );
  assert.ok(autoReplyDebounceMs > 0);
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

test("a whatsapp reply is dropped once the customer message is too old", () => {
  assert.equal(whatsAppAutoReplyMaxAgeMs(undefined), whatsAppAutoReplyDefaultMaxAgeMs);
  assert.equal(whatsAppAutoReplyMaxAgeMs("30"), 30 * 60 * 1000);
  assert.equal(whatsAppAutoReplyMaxAgeMs("999999"), 7 * 24 * 60 * 60 * 1000);
  assert.equal(whatsAppAutoReplyMaxAgeMs("0"), whatsAppAutoReplyDefaultMaxAgeMs);
  assert.equal(whatsAppAutoReplyWindowExpiredCode, "AUTO_REPLY_WINDOW_EXPIRED");
});
