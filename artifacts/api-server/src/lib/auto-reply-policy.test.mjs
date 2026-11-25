import assert from "node:assert/strict";
import test from "node:test";
import {
  autoReplyDebounceMs,
  autoReplyDefaultHourlyLimit,
  autoReplyHourlyLimitCeiling,
  autoReplyLimitPauseDefaultMinutes,
  autoReplyLimitPauseMaxMinutes,
  autoReplyLimitPauseMinMinutes,
  autoReplyLoopGuardCode,
  autoReplyNextRunAt,
  autoReplySupersededCode,
  autoReplyToneInstructions,
  resolveAutoReplyHourlyLimit,
  resolveAutoReplyLimitPauseMs,
} from "./auto-reply-policy.ts";
import { metaAutoReplyHourlyLimit, metaAutoReplyLimitPauseMs } from "./meta-auto-reply.ts";
import {
  whatsAppAutoReplyHourlyLimit,
  whatsAppAutoReplyQuotaPauseMs,
} from "./whatsapp-auto-reply-policy.ts";

const KEY = "WHATSAPP_AUTO_REPLY_QUOTA_PAUSE_MINUTES";
const META_KEY = "META_AUTO_REPLY_QUOTA_PAUSE_MINUTES";
const HOURLY_KEY = "WHATSAPP_AUTO_REPLY_HOURLY_LIMIT";
const META_HOURLY_KEY = "META_AUTO_REPLY_HOURLY_LIMIT";

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

test("each queue's reader binds its own variable to the shared pause bounds", () => {
  // Operators tune one side without the other, but the same value means the same
  // wait on either queue, and both fall back to the shared default.
  assert.equal(whatsAppAutoReplyQuotaPauseMs({}), 30 * 60_000);
  assert.equal(metaAutoReplyLimitPauseMs({}), 30 * 60_000);
  assert.equal(
    whatsAppAutoReplyQuotaPauseMs({ [KEY]: "45" }),
    metaAutoReplyLimitPauseMs({ [META_KEY]: "45" }),
  );
  for (const raw of ["abc", "0", "-15", ""]) {
    assert.equal(whatsAppAutoReplyQuotaPauseMs({ [KEY]: raw }), 30 * 60_000, raw);
  }
  assert.equal(whatsAppAutoReplyQuotaPauseMs({ [KEY]: "1" }), 5 * 60_000);
  // A pause longer than this would eat the 12-hour reply window, so the event
  // would expire before the quota could lift.
  assert.equal(whatsAppAutoReplyQuotaPauseMs({ [KEY]: "600" }), 120 * 60_000);
  // Integer minutes, matching the age-window reader beside it: a fractional
  // value is truncated rather than rejected.
  assert.equal(whatsAppAutoReplyQuotaPauseMs({ [KEY]: "12.5" }), 12 * 60_000);
});

test("both queues debounce a burst into one reply", () => {
  const now = new Date("2026-11-22T10:00:00.000Z");
  assert.equal(autoReplyDebounceMs, 6_000);
  assert.equal(
    autoReplyNextRunAt(now).toISOString(),
    new Date(now.getTime() + autoReplyDebounceMs).toISOString(),
  );
});

test("the hourly ceiling per conversation defaults to twelve and caps at one hundred", () => {
  assert.equal(autoReplyDefaultHourlyLimit, 12);
  assert.equal(resolveAutoReplyHourlyLimit(HOURLY_KEY, {}), 12);
  assert.equal(resolveAutoReplyHourlyLimit(HOURLY_KEY, { [HOURLY_KEY]: "5" }), 5);
  assert.equal(resolveAutoReplyHourlyLimit(HOURLY_KEY, { [HOURLY_KEY]: "1000" }), 100);
  assert.equal(autoReplyHourlyLimitCeiling, 100);
  for (const raw of ["0", "-3", "nonsense", ""]) {
    assert.equal(resolveAutoReplyHourlyLimit(HOURLY_KEY, { [HOURLY_KEY]: raw }), 12, raw);
  }
  // Each queue reads its own variable, so tuning one leaves the other alone.
  assert.equal(whatsAppAutoReplyHourlyLimit({ [HOURLY_KEY]: "7" }), 7);
  assert.equal(metaAutoReplyHourlyLimit({ [HOURLY_KEY]: "7" }), 12);
  assert.equal(metaAutoReplyHourlyLimit({ [META_HOURLY_KEY]: "7" }), 7);
});

test("both queues record the same code for the same outcome", () => {
  // The inbox translates these through the error registry; two spellings for one
  // outcome would leave one queue's rows untranslated.
  assert.equal(autoReplySupersededCode, "SUPERSEDED_BY_NEWER_MESSAGE");
  assert.equal(autoReplyLoopGuardCode, "AUTO_REPLY_LOOP_GUARD");
});

test("the tone vocabulary is the one the settings screens offer", () => {
  assert.deepEqual(Object.keys(autoReplyToneInstructions).sort(), [
    "concise",
    "formal",
    "friendly_professional",
  ]);
});
