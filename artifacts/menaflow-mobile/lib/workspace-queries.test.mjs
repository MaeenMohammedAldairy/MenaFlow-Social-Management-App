import assert from "node:assert/strict";
import test from "node:test";
import { workspaceQueryEnabled } from "./workspace-queries.ts";

const RESOLVED = {
  isLocalAuthDisabled: false,
  activeWorkspaceId: "ws-1",
  selectionApplied: true,
  workspaceListSettled: true,
  workspaceListFailed: false,
};

const COLD_START = {
  isLocalAuthDisabled: false,
  activeWorkspaceId: null,
  selectionApplied: false,
  workspaceListSettled: false,
  workspaceListFailed: false,
};

test("a resolved workspace lets scoped requests through", () => {
  assert.equal(workspaceQueryEnabled(RESOLVED), true);
  // The gate does not depend on the rest of the state once an id exists.
  assert.equal(
    workspaceQueryEnabled({ ...RESOLVED, workspaceListFailed: true }),
    true,
  );
});

test("the cold-start window waits, so a request is not made twice", () => {
  // This is the case the gate exists for: before the workspace list and the saved
  // selection are read, a request goes out without the header and is then thrown
  // away by the invalidation that follows resolution.
  assert.equal(workspaceQueryEnabled(COLD_START), false);
  assert.equal(
    workspaceQueryEnabled({ ...COLD_START, workspaceListSettled: true }),
    false,
    "the list alone is not enough — the saved selection still has to be applied",
  );
  assert.equal(
    workspaceQueryEnabled({ ...COLD_START, selectionApplied: true }),
    false,
    "the selection alone is not enough — the list still has to answer",
  );
});

test("local-auth development has no workspace row to wait for", () => {
  assert.equal(
    workspaceQueryEnabled({ ...COLD_START, isLocalAuthDisabled: true }),
    true,
  );
});

test("a failed workspace list opens the gate rather than showing endless skeletons", () => {
  // Waiting cannot produce a workspace here, and the merchant has to be told the
  // list failed instead of watching a spinner with no explanation.
  assert.equal(
    workspaceQueryEnabled({ ...COLD_START, workspaceListFailed: true }),
    true,
  );
});

test("a user with no workspace at all is not held forever", () => {
  // Selection applied and the list answered, yet there is nothing to select: the
  // server bootstraps a workspace on the first scoped request.
  assert.equal(
    workspaceQueryEnabled({
      isLocalAuthDisabled: false,
      activeWorkspaceId: null,
      selectionApplied: true,
      workspaceListSettled: true,
      workspaceListFailed: false,
    }),
    true,
  );
});

test("an empty or whitespace workspace id is not treated as a workspace", () => {
  // It must not short-circuit the gate the way a real id does: sending whitespace
  // as `x-workspace-id` would ask the server to resolve a membership that cannot
  // exist. Whether the request then goes out is decided by the rest of the state,
  // exactly as if no id had been read at all.
  for (const activeWorkspaceId of ["", "   ", null, undefined]) {
    assert.equal(
      workspaceQueryEnabled({ ...COLD_START, activeWorkspaceId }),
      false,
      JSON.stringify(activeWorkspaceId),
    );
    assert.equal(
      workspaceQueryEnabled({ ...RESOLVED, activeWorkspaceId }),
      true,
      "with the selection applied and the list answered, waiting cannot help",
    );
  }
});
