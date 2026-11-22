import assert from "node:assert/strict";
import test from "node:test";
import {
  metaAutoReplyDebounceMs,
  metaAutoReplyDefaultHourlyLimit,
  metaAutoReplyHourlyLimit,
  metaAutoReplyLoopGuardCode,
  metaAutoReplyNextRunAt,
  metaAutoReplySupersededCode,
} from "./meta-auto-reply.ts";
import {
  whatsAppAutoReplyDebounceMs,
  whatsAppAutoReplyDefaultHourlyLimit,
  whatsAppAutoReplyDefaultMaxAgeMs,
  whatsAppAutoReplyHourlyLimit,
  whatsAppAutoReplyLoopGuardCode,
  whatsAppAutoReplyMaxAgeMs,
  whatsAppAutoReplyNextRunAt,
  whatsAppAutoReplyWindowExpiredCode,
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

test("meta conversations are capped at the same hourly reply limit", () => {
  assert.equal(metaAutoReplyHourlyLimit(undefined), metaAutoReplyDefaultHourlyLimit);
  assert.equal(metaAutoReplyHourlyLimit("3"), 3);
  assert.equal(metaAutoReplyHourlyLimit("500"), 100);
  assert.equal(metaAutoReplyLoopGuardCode, "AUTO_REPLY_LOOP_GUARD");
  assert.equal(metaAutoReplyHourlyLimit(undefined), whatsAppAutoReplyHourlyLimit(undefined));
});

test("a whatsapp reply is dropped once the customer message is too old", () => {
  assert.equal(whatsAppAutoReplyMaxAgeMs(undefined), whatsAppAutoReplyDefaultMaxAgeMs);
  assert.equal(whatsAppAutoReplyMaxAgeMs("30"), 30 * 60 * 1000);
  assert.equal(whatsAppAutoReplyMaxAgeMs("999999"), 7 * 24 * 60 * 60 * 1000);
  assert.equal(whatsAppAutoReplyMaxAgeMs("0"), whatsAppAutoReplyDefaultMaxAgeMs);
  assert.equal(whatsAppAutoReplyWindowExpiredCode, "AUTO_REPLY_WINDOW_EXPIRED");
});
