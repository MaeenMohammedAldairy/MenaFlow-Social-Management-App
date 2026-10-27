import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPostWorkspace,
  assertWorkspaceContext,
} from "./workspace-record-access.ts";

const postFromWorkspaceB = {
  id: "post-b",
  workspaceId: "workspace-b",
  autoPublish: false,
};

test("publishing rejects a known post ID from another workspace", () => {
  assert.throws(
    () => assertPostWorkspace(postFromWorkspaceB, "workspace-a"),
    /POST_NOT_IN_WORKSPACE/,
  );
});

test("publish verification rejects a post from another workspace", () => {
  assert.throws(
    () => assertPostWorkspace(postFromWorkspaceB, "workspace-a"),
    /POST_NOT_IN_WORKSPACE/,
  );
});

test("publish verification and media retry fail closed without workspace context", () => {
  assert.throws(
    () => assertPostWorkspace(postFromWorkspaceB, ""),
    /WORKSPACE_CONTEXT_MISSING/,
  );
  assert.throws(
    () => assertWorkspaceContext(""),
    /WORKSPACE_CONTEXT_MISSING/,
  );
});
