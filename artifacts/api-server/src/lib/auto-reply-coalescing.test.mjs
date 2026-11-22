import assert from "node:assert/strict";
import test from "node:test";
import {
  metaAutoReplyDebounceMs,
  metaAutoReplyNextRunAt,
  metaAutoReplySupersededCode,
} from "./meta-auto-reply.ts";
import {
  whatsAppAutoReplyDebounceMs,
  whatsAppAutoReplyNextRunAt,
} from "./whatsapp-auto-reply-policy.ts";

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
