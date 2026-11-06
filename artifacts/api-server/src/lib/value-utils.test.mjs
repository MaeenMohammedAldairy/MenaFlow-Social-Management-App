import assert from "node:assert/strict";
import test from "node:test";
import {
  asRecord,
  boundedString,
  isRecord,
  queryString,
  recordOrEmpty,
} from "./value-utils.ts";

test("recognizes plain records and rejects arrays and primitives", () => {
  const value = { id: "record" };
  assert.equal(isRecord(value), true);
  assert.equal(asRecord(value), value);
  assert.equal(isRecord([]), false);
  assert.equal(asRecord([]), null);
  assert.equal(isRecord(null), false);
  assert.equal(asRecord("record"), null);
  assert.equal(recordOrEmpty(value), value);
  assert.deepEqual(recordOrEmpty([]), {});
});

test("preserves query string behavior for empty and non-empty strings", () => {
  assert.equal(queryString("value"), "value");
  assert.equal(queryString(""), null);
  assert.equal(queryString("  "), "  ");
  assert.equal(queryString(1), null);
});

test("trims bounded strings and rejects empty or overlong values", () => {
  assert.equal(boundedString("  valid  ", 5), "valid");
  assert.equal(boundedString(" ", 5), null);
  assert.equal(boundedString("long", 3), null);
  assert.equal(boundedString(1, 3), null);
});
