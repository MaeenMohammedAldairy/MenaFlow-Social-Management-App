import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReplyLimitPauseDefaultMinutes,
  autoReplyLimitPauseMaxMinutes,
  autoReplyLimitPauseMinMinutes,
  resolveAutoReplyLimitPauseMs,
} from "./auto-reply-limit-pause.ts";

const KEY = "WHATSAPP_AUTO_REPLY_QUOTA_PAUSE_MINUTES";
const META_KEY = "META_AUTO_REPLY_QUOTA_PAUSE_MINUTES";

test("the shared default is half an hour", () => {
  assert.equal(autoReplyLimitPauseDefaultMinutes, 30);
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, {}), 30 * 60_000);
  assert.equal(resolveAutoReplyLimitPauseMs(META_KEY, {}), 30 * 60_000);
  // Both queues read their own variable but share the bounds, so the same value
  // means the same wait on either side.
  assert.equal(
    resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "45" }),
    resolveAutoReplyLimitPauseMs(META_KEY, { [META_KEY]: "45" }),
  );
});

test("an unusable value falls back rather than retrying in a tight loop", () => {
  // A pause of zero would re-claim the job every poll and spend the attempt
  // budget on a limit that has not moved.
  for (const raw of ["", "   ", "abc", "0", "-30", "NaN"]) {
    assert.equal(
      resolveAutoReplyLimitPauseMs(KEY, { [KEY]: raw }),
      autoReplyLimitPauseDefaultMinutes * 60_000,
      raw,
    );
  }
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, { [KEY]: undefined }), 30 * 60_000);
});

test("a parsed value is clamped to the shared bounds", () => {
  assert.equal(autoReplyLimitPauseMinMinutes, 5);
  assert.equal(autoReplyLimitPauseMaxMinutes, 120);
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "1" }), 5 * 60_000);
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "600" }), 120 * 60_000);
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "90" }), 90 * 60_000);
  // Whole minutes, truncated like the other readers in these modules.
  assert.equal(resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "12.9" }), 12 * 60_000);
});

test("the upper bound stays inside the shortest reply window", () => {
  // WhatsApp drops a reply older than 12 hours and Meta older than 24, so a
  // pause beyond two hours would eat a visible share of the shorter window and
  // risk expiring the message before the limit could clear.
  const maxPauseMs = resolveAutoReplyLimitPauseMs(KEY, { [KEY]: "100000" });
  assert.ok(maxPauseMs <= 2 * 60 * 60 * 1000, maxPauseMs);
  assert.ok(maxPauseMs < 12 * 60 * 60 * 1000, maxPauseMs);
});
