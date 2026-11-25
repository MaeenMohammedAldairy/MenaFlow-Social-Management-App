import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOQUEUE_WORKSPACE_BATCH_SIZE,
  isQuotaPauseRow,
  planAutoQueuePass,
  settledJobQueuePolicy,
} from "./whatsapp-product-autoqueue-policy.ts";

const now = new Date("2026-11-25T12:00:00Z");

test("batch size is bounded so one pass cannot sweep every workspace", () => {
  assert.equal(AUTOQUEUE_WORKSPACE_BATCH_SIZE, 10);
});

test("a quota pause is pending + scheduled in the future + quota reason", () => {
  assert.equal(
    isQuotaPauseRow(
      {
        status: "pending",
        lastError: "SUBSCRIPTION_LIMIT_REACHED:ai_generations",
        nextRunAt: new Date("2026-11-25T18:00:00Z"),
      },
      now,
    ),
    true,
  );
});

test("an elapsed postponement is not a pause", () => {
  assert.equal(
    isQuotaPauseRow(
      {
        status: "pending",
        lastError: "SUBSCRIPTION_LIMIT_REACHED:ai_generations",
        nextRunAt: new Date("2026-11-25T06:00:00Z"),
      },
      now,
    ),
    false,
  );
});

test("a quota-shaped error on a settled job is not a pause", (t) => {
  for (const status of ["complete", "failed", "processing", "waiting_media"]) {
    t.assert.ok(
      !isQuotaPauseRow(
        {
          status,
          lastError: "SUBSCRIPTION_LIMIT_REACHED:ai_generations",
          nextRunAt: new Date("2026-11-25T18:00:00Z"),
        },
        now,
      ),
      `status ${status}`,
    );
  }
});

test("an unrelated future job is not a pause", () => {
  assert.equal(
    isQuotaPauseRow(
      {
        status: "pending",
        lastError: "PRODUCT_EXTRACTION_FAILED",
        nextRunAt: new Date("2026-11-25T18:00:00Z"),
      },
      now,
    ),
    false,
  );
  assert.equal(
    isQuotaPauseRow({ status: "pending", lastError: null, nextRunAt: null }, now),
    false,
  );
});

test("nextRunAt arriving as a string is read the same way", () => {
  assert.equal(
    isQuotaPauseRow(
      {
        status: "pending",
        lastError: "SUBSCRIPTION_LIMIT_REACHED:ai_generations",
        nextRunAt: "2026-11-25T18:00:00.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    isQuotaPauseRow(
      {
        status: "pending",
        lastError: "SUBSCRIPTION_LIMIT_REACHED:ai_generations",
        nextRunAt: "not-a-date",
      },
      now,
    ),
    false,
  );
});

test("a pass visits the fetched page and moves the cursor to its last workspace", () => {
  const plan = planAutoQueuePass({
    cursor: "ws-a",
    workspaces: ["ws-b", "ws-c"],
    restartWorkspaces: ["ws-a", "ws-b", "ws-c"],
    batchSize: 10,
  });
  assert.deepEqual(plan, {
    visit: ["ws-b", "ws-c"],
    nextCursor: "ws-c",
    restarted: false,
  });
});

test("an empty page past the cursor restarts the rotation", () => {
  const plan = planAutoQueuePass({
    cursor: "ws-z",
    workspaces: [],
    restartWorkspaces: ["ws-a", "ws-b"],
    batchSize: 10,
  });
  assert.deepEqual(plan, {
    visit: ["ws-a", "ws-b"],
    nextCursor: "ws-b",
    restarted: true,
  });
});

test("no cursor means a first pass, so an empty page is just an empty pass", () => {
  const plan = planAutoQueuePass({
    cursor: null,
    workspaces: [],
    restartWorkspaces: ["ws-a"],
    batchSize: 10,
  });
  assert.deepEqual(plan, { visit: [], nextCursor: null, restarted: false });
});

test("nothing at all selected stays an empty rotation with no cursor", () => {
  const plan = planAutoQueuePass({
    cursor: "ws-z",
    workspaces: [],
    restartWorkspaces: [],
    batchSize: 10,
  });
  assert.deepEqual(plan, { visit: [], nextCursor: null, restarted: true });
});

test("the visit list is deduplicated, capped, and order preserving", () => {
  const plan = planAutoQueuePass({
    cursor: null,
    workspaces: ["ws-b", "ws-b", "ws-c", "ws-a"],
    restartWorkspaces: [],
    batchSize: 2,
  });
  assert.deepEqual(plan, {
    visit: ["ws-b", "ws-c"],
    nextCursor: "ws-c",
    restarted: false,
  });
});

test("a non-positive batch size visits nothing and keeps the cursor", () => {
  const plan = planAutoQueuePass({
    cursor: "ws-a",
    workspaces: ["ws-b"],
    restartWorkspaces: [],
    batchSize: 0,
  });
  assert.deepEqual(plan, { visit: [], nextCursor: "ws-a", restarted: false });
});

test("a manual re-run revives settled jobs and re-selects them", () => {
  assert.deepEqual(settledJobQueuePolicy("manual"), {
    excludeMessagesWithJobs: false,
    reviveSettledJobs: true,
  });
});

test("the timer leaves settled jobs alone and skips messages that have one", () => {
  assert.deepEqual(settledJobQueuePolicy("automatic"), {
    excludeMessagesWithJobs: true,
    reviveSettledJobs: false,
  });
});
