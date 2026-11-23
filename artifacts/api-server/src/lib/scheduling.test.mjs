import assert from "node:assert/strict";
import test from "node:test";
import { isValidTimezone, parseScheduledAt } from "./scheduling.ts";

const NOW = new Date("2026-11-23T12:00:00.000Z");

test("parseScheduledAt accepts a future instant and rounds to the second", () => {
  const parsed = parseScheduledAt("2026-11-23T15:30:00.750Z", NOW);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), "2026-11-23T15:30:00.000Z");
});

test("parseScheduledAt accepts offsets, not only Z", () => {
  // 18:00 +03:00 (Riyadh/Aden-style offset) === 15:00Z, which is future.
  const parsed = parseScheduledAt("2026-11-23T18:00:00+03:00", NOW);
  assert.ok(parsed);
  assert.equal(parsed.toISOString(), "2026-11-23T15:00:00.000Z");
});

test("parseScheduledAt rejects past, exactly-now, and malformed values", () => {
  assert.equal(parseScheduledAt("2026-11-23T11:59:59Z", NOW), null);
  assert.equal(parseScheduledAt("2026-11-23T12:00:00Z", NOW), null);
  assert.equal(parseScheduledAt("ليس موعدًا", NOW), null);
  assert.equal(parseScheduledAt("", NOW), null);
  assert.equal(parseScheduledAt(null, NOW), null);
  assert.equal(parseScheduledAt(undefined, NOW), null);
  assert.equal(parseScheduledAt(1763899200000, NOW), null);
});

test("isValidTimezone accepts IANA names and rejects the rest", () => {
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Asia/Aden"), true);
  assert.equal(isValidTimezone("Asia/Riyadh"), true);
  assert.equal(isValidTimezone("Asia/Dubai"), true);
  assert.equal(isValidTimezone("Mars/Olympus"), false);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone("x".repeat(65)), false);
  assert.equal(isValidTimezone(3), false);
  assert.equal(isValidTimezone(null), false);
});
