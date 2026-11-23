import assert from "node:assert/strict";
import test from "node:test";
import { serializeError } from "./logger.ts";

test("serializeError keeps type, message and stack for an Error", () => {
  const serialized = serializeError(new Error("provider rejected the request"));

  assert.equal(serialized.type, "Error");
  assert.equal(serialized.message, "provider rejected the request");
  assert.match(serialized.stack, /^Error: provider rejected the request\n/);
});

test("serializeError reports the subclass name, not just Error", () => {
  const serialized = serializeError(new TypeError("id is not a string"));

  assert.equal(serialized.type, "TypeError");
  assert.equal(serialized.message, "id is not a string");
});

test("serializeError passes non-Error values through untouched", () => {
  // Catch blocks in this codebase log strings and plain objects under the same
  // keys, so the serializer must not reshape them.
  const context = { workspaceId: "ws_1", attempts: 3 };

  assert.deepEqual(serializeError(context), context);
  assert.equal(serializeError("MEDIA_SOURCE_INVALID"), "MEDIA_SOURCE_INVALID");
  assert.equal(serializeError(null), null);
  assert.equal(serializeError(undefined), undefined);
});
