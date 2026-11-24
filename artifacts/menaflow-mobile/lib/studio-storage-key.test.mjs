import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDIO_STORAGE_KEY,
  legacyStudioStorageKey,
  workspaceStorageNamespace,
} from "./studio-storage-key.ts";

test("the namespace names both the user and the workspace", () => {
  assert.equal(
    workspaceStorageNamespace("user_2abc", "1f0d0a5e-6a1e-4d3a-9a2b-7c8d9e0f1a2b"),
    "user:user_2abc:ws:1f0d0a5e-6a1e-4d3a-9a2b-7c8d9e0f1a2b",
  );
});

test("an unresolved user or workspace yields no namespace at all", () => {
  // Null is what the store reads as "not ready". Returning a placeholder instead
  // would create a cache for a workspace that does not exist yet and then seed the
  // real one from it — or, worse, render an empty post list as "no posts yet".
  assert.equal(workspaceStorageNamespace(null, "ws-1"), null);
  assert.equal(workspaceStorageNamespace(undefined, "ws-1"), null);
  assert.equal(workspaceStorageNamespace("user_2abc", null), null);
  assert.equal(workspaceStorageNamespace("user_2abc", undefined), null);
  assert.equal(workspaceStorageNamespace("", "ws-1"), null);
  assert.equal(workspaceStorageNamespace("user_2abc", ""), null);
});

test("two workspaces of one user never share a cache", () => {
  const first = workspaceStorageNamespace("user_2abc", "ws-1");
  const second = workspaceStorageNamespace("user_2abc", "ws-2");
  assert.notEqual(first, second);
  // And two users in one workspace do not either.
  assert.notEqual(
    workspaceStorageNamespace("user_2abc", "ws-1"),
    workspaceStorageNamespace("user_9xyz", "ws-1"),
  );
});

test("the legacy key is the old user-scoped one for the same user", () => {
  assert.equal(
    legacyStudioStorageKey("user:user_2abc:ws:ws-1"),
    `${STUDIO_STORAGE_KEY}.user:user_2abc`,
  );
});

test("namespaces that are not workspace-scoped have no legacy key", () => {
  // The local-auth namespace and a signed-out store must not read a cache that
  // belongs to a signed-in user of this device.
  assert.equal(legacyStudioStorageKey(null), null);
  assert.equal(legacyStudioStorageKey("local"), null);
  assert.equal(legacyStudioStorageKey("user:user_2abc"), null, "already the legacy shape");
});

test("every workspace of a user carries preferences from the same legacy key", () => {
  // The legacy cache is read, not consumed: the second workspace of the same user
  // has to find its preferences there too.
  const legacy = `${STUDIO_STORAGE_KEY}.user:user_2abc`;
  assert.equal(legacyStudioStorageKey("user:user_2abc:ws:ws-1"), legacy);
  assert.equal(legacyStudioStorageKey("user:user_2abc:ws:ws-2"), legacy);
});
