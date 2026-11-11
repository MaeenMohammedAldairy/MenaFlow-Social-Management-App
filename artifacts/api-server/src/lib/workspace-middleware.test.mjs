import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { assertPostWorkspace } from "./workspace-record-access.ts";
import {
  createRequireWorkspace,
  requestWorkspaceContext,
} from "./workspace-middleware.ts";

const memberships = new Map([
  ["user-a", [{ workspaceId: "workspace-a", workspaceName: "A", role: "owner" }]],
  ["user-b", [{ workspaceId: "workspace-b", workspaceName: "B", role: "owner" }]],
]);

const repository = {
  async transaction(operation) {
    return operation({
      async lockUser() {},
      async listMemberships(userId) {
        return memberships.get(userId) ?? [];
      },
      async createWorkspace() {},
      async createOnboardingProgress() {},
      async createOwnerMembership() {},
    });
  },
};

const jobs = new Map([
  ["job-a", { id: "job-a", postId: "post-a", workspaceId: "workspace-a" }],
  ["job-b", { id: "job-b", postId: "post-b", workspaceId: "workspace-b" }],
]);

async function withApi(operation) {
  const app = express();
  const requireWorkspace = createRequireWorkspace(
    repository,
    (req) => req.get("x-test-user") ?? null,
  );

  app.get("/workspaces/current", requireWorkspace, (req, res) => {
    res.json(requestWorkspaceContext(req));
  });
  app.get("/queue/:jobId", requireWorkspace, (req, res) => {
    const workspaceId = requestWorkspaceContext(req)?.workspaceId ?? "";
    const job = jobs.get(req.params.jobId);
    if (!job) {
      res.sendStatus(404);
      return;
    }
    try {
      assertPostWorkspace(job, workspaceId);
      res.json({ id: job.id });
    } catch {
      res.sendStatus(404);
    }
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("workspace API middleware denies another user's workspace", async () => {
  await withApi(async (origin) => {
    const ownWorkspace = await fetch(`${origin}/workspaces/current`, {
      headers: { "x-test-user": "user-a" },
    });
    assert.equal(ownWorkspace.status, 200);
    assert.equal((await ownWorkspace.json()).workspaceId, "workspace-a");

    const foreignWorkspace = await fetch(`${origin}/workspaces/current`, {
      headers: {
        "x-test-user": "user-a",
        "x-workspace-id": "workspace-b",
      },
    });
    assert.equal(foreignWorkspace.status, 403);
    assert.equal((await foreignWorkspace.json()).code, "WORKSPACE_ACCESS_DENIED");
  });
});

test("queue route does not process a post from another workspace", async () => {
  await withApi(async (origin) => {
    const ownJob = await fetch(`${origin}/queue/job-a`, {
      headers: { "x-test-user": "user-a" },
    });
    assert.equal(ownJob.status, 200);

    const foreignJob = await fetch(`${origin}/queue/job-b`, {
      headers: { "x-test-user": "user-a" },
    });
    assert.equal(foreignJob.status, 404);

    const jobFromItsWorkspace = await fetch(`${origin}/queue/job-b`, {
      headers: { "x-test-user": "user-b" },
    });
    assert.equal(jobFromItsWorkspace.status, 200);
  });
});