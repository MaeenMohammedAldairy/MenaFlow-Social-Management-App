import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETION_GRACE_MS,
  DELETION_MAX_ATTEMPTS,
  deletionDueCutoff,
  isDeletionRequestDue,
  workspaceStoragePrefixes,
} from "./workspace-deletion-policy.ts";
import { deleteMediaObjectsByPrefixes } from "./whatsapp-media-storage.ts";
import { workspaceMediaKey } from "./product-utils.ts";

const NOW = new Date("2026-12-23T12:00:00.000Z");

test("the grace period is 30 days and the cutoff is exactly now minus grace", () => {
  assert.equal(DELETION_GRACE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(
    deletionDueCutoff(NOW).toISOString(),
    "2026-11-23T12:00:00.000Z",
  );
});

test("a request is due only after the full grace period elapsed", () => {
  const exactlyDue = new Date(NOW.getTime() - DELETION_GRACE_MS);
  assert.equal(isDeletionRequestDue(exactlyDue, NOW), true);
  assert.equal(
    isDeletionRequestDue(new Date(NOW.getTime() - DELETION_GRACE_MS + 1000), NOW),
    false,
  );
  assert.equal(isDeletionRequestDue(NOW, NOW), false);
});

test("storage prefixes cover whatsapp objects and product media, keyed per workspace", () => {
  const prefixes = workspaceStoragePrefixes("workspace:abc123");
  assert.deepEqual(prefixes, [
    "workspace:abc123",
    `product-media/${workspaceMediaKey("workspace:abc123")}`,
  ]);
  // Different workspaces never share a product-media prefix (hash-keyed).
  const other = workspaceStoragePrefixes("workspace:other");
  assert.notEqual(prefixes[1], other[1]);
});

test("the retry budget is finite so failures surface instead of spinning", () => {
  assert.equal(DELETION_MAX_ATTEMPTS, 5);
});

test("prefix deletion rejects empty and traversal prefixes before any I/O", async () => {
  await assert.rejects(
    () => deleteMediaObjectsByPrefixes([]),
    /EMPTY_MEDIA_DELETE_PREFIXES/,
  );
  await assert.rejects(
    () => deleteMediaObjectsByPrefixes(["   "]),
    /EMPTY_MEDIA_DELETE_PREFIXES/,
  );
  // "/" normalizes to an empty prefix and is rejected as EMPTY — still
  // rejected before any I/O, which is what matters.
  for (const bad of ["/", "/ws", "a/../b", "a//b", "./a", ".."]) {
    await assert.rejects(
      () => deleteMediaObjectsByPrefixes([bad]),
      /EMPTY_MEDIA_DELETE_PREFIXES|INVALID_MEDIA_DELETE_PREFIX/,
      `كان يجب رفض ${bad}`,
    );
  }
});
