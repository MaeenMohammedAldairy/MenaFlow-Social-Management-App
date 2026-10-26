import assert from "node:assert/strict";
import test from "node:test";
import { whatsappInstanceNameForWorkspace } from "./whatsapp-instance.ts";

test("uses a stable Evolution instance name per workspace", () => {
  assert.equal(
    whatsappInstanceNameForWorkspace("workspace-123"),
    whatsappInstanceNameForWorkspace("workspace-123"),
  );
});

test("isolates Evolution instance names across workspaces", () => {
  assert.notEqual(
    whatsappInstanceNameForWorkspace("workspace-123"),
    whatsappInstanceNameForWorkspace("workspace-456"),
  );
});
