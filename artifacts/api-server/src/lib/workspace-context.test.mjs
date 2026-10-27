import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWorkspaceContext,
  WorkspaceContextError,
} from "./workspace-resolution.ts";

function createRepository() {
  const memberships = [];
  const workspaceNames = new Map();
  const workspaces = new Map();
  const onboardingProgress = new Map();
  let transactionQueue = Promise.resolve();
  let lockCalls = 0;

  return {
    memberships,
    workspaces,
    onboardingProgress,
    get lockCalls() {
      return lockCalls;
    },
    async transaction(operation) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation({
          async lockUser() {
            lockCalls += 1;
          },
          async listMemberships(userId) {
            return memberships
              .filter((membership) => membership.userId === userId)
              .map((membership) => ({
                ...membership,
                workspaceName: workspaceNames.get(membership.workspaceId),
              }));
          },
          async createWorkspace(workspace) {
            workspaceNames.set(workspace.id, workspace.name);
            workspaces.set(workspace.id, workspace);
          },
          async createOnboardingProgress(progress) {
            onboardingProgress.set(
              `${progress.workspaceId}:${progress.userId}`,
              progress,
            );
          },
          async createOwnerMembership(membership) {
            memberships.push({
              ...membership,
              role: "owner",
            });
          },
        });
      } finally {
        release();
      }
    },
  };
}

test("initializes exactly one workspace and owner membership for a new user", async () => {
  const repository = createRepository();

  const contexts = await Promise.all(
    Array.from({ length: 8 }, () =>
      resolveWorkspaceContext(repository, "user-a"),
    ),
  );

  assert.equal(new Set(contexts.map((context) => context.workspaceId)).size, 1);
  assert.equal(repository.memberships.length, 1);
  assert.equal(repository.memberships[0].role, "owner");
  const progress = repository.onboardingProgress.get(
    `${contexts[0].workspaceId}:user-a`,
  );
  assert.equal(progress.currentStep, 0);
  assert.equal(progress.completed, false);
  assert.equal(progress.socialAccountsCompleted, false);
});

test("creates isolated default workspaces for different users", async () => {
  const repository = createRepository();

  const first = await resolveWorkspaceContext(repository, "user-a");
  const second = await resolveWorkspaceContext(repository, "user-b");

  assert.notEqual(first.workspaceId, second.workspaceId);
  assert.equal(repository.memberships.length, 2);
});

test("does not serialize requests for users who already have a workspace", async () => {
  const repository = createRepository();
  await resolveWorkspaceContext(repository, "user-a");
  const initialLockCalls = repository.lockCalls;

  await Promise.all(
    Array.from({ length: 8 }, () => resolveWorkspaceContext(repository, "user-a")),
  );

  assert.equal(repository.lockCalls, initialLockCalls);
});

test("rejects unowned workspace selections and requires context for multiple memberships", async () => {
  const repository = createRepository();
  const first = await resolveWorkspaceContext(repository, "user-a");
  repository.memberships.push({
    id: "membership-two",
    userId: "user-a",
    workspaceId: "workspace-two",
    role: "member",
  });

  await assert.rejects(
    resolveWorkspaceContext(repository, "user-a", "workspace-other"),
    (error) =>
      error instanceof WorkspaceContextError && error.statusCode === 403,
  );
  await assert.rejects(
    resolveWorkspaceContext(repository, "user-a"),
    (error) =>
      error instanceof WorkspaceContextError && error.statusCode === 409,
  );
  assert.equal(
    (await resolveWorkspaceContext(repository, "user-a", first.workspaceId))
      .workspaceId,
    first.workspaceId,
  );
});

test("does not initialize a workspace for an unauthenticated identity", async () => {
  const repository = createRepository();

  await assert.rejects(
    resolveWorkspaceContext(repository, ""),
    (error) =>
      error instanceof WorkspaceContextError && error.statusCode === 401,
  );
  assert.equal(repository.memberships.length, 0);
});
