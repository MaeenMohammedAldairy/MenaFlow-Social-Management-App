import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeMetaInboxCursor,
  parseMetaInboxCursor,
} from "./meta-inbox-pagination.ts";

test("Meta inbox cursors preserve timestamp and ID tie-breaker", () => {
  const occurredAt = new Date("2026-11-09T12:30:00.000Z");
  const cursor = parseMetaInboxCursor(
    encodeMetaInboxCursor(occurredAt, "item-42"),
  );
  assert.equal(cursor.occurredAt.toISOString(), occurredAt.toISOString());
  assert.equal(cursor.id, "item-42");
});

test("Meta inbox cursors reject malformed payloads", () => {
  assert.throws(() => parseMetaInboxCursor("not-base64-json"));
  assert.throws(() =>
    parseMetaInboxCursor(Buffer.from('{"occurredAt":"bad","id":"x"}').toString("base64url")),
  );
});
