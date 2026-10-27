import assert from "node:assert/strict";
import test from "node:test";
import { buildFacebookPerformance } from "./facebook-performance.ts";

const now = new Date("2026-11-01T12:00:00.000Z");
const facebookEvent = (id, postId, eventType, occurredAt, extra = {}) => ({
  id,
  postId,
  workspaceId: "workspace-a",
  accountId: "page-1",
  channel: "facebook",
  eventType,
  actorId: "owner-1",
  occurredAt,
  details: {},
  title: "منشور تجريبي",
  ...extra,
});

test("counts a post once after multiple Facebook publish attempts", () => {
  const publishedAt = "2026-10-30T12:00:00.000Z";
  const summary = buildFacebookPerformance(
    [{
      id: "post-1",
      workspaceId: "workspace-a",
      title: "منشور تجريبي",
      status: "published",
      channels: ["facebook"],
      publishResults: {},
      metadata: { aiGenerated: true },
      createdAt: "2026-10-20T12:00:00.000Z",
      updatedAt: publishedAt,
    }],
    [
      facebookEvent("event-1", "post-1", "publish_attempt_started", "2026-10-28T12:00:00.000Z"),
      facebookEvent("event-2", "post-1", "publish_failed", "2026-10-28T12:01:00.000Z"),
      facebookEvent("event-3", "post-1", "publish_attempt_started", "2026-10-30T11:59:00.000Z"),
      facebookEvent("event-4", "post-1", "publish_succeeded", publishedAt),
      facebookEvent("event-other-account", "post-2", "publish_succeeded", publishedAt, {
        accountId: "page-2",
      }),
    ],
    "page-1",
    "owner-1",
    "workspace-a",
    now,
  );

  assert.equal(summary.publishedCount, 1);
  assert.equal(summary.attemptedCount, 1);
  assert.equal(summary.successRate, 100);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.aiPublishedCount, 1);
  assert.equal(summary.weeklyPublished.reduce((total, week) => total + week.count, 0), 1);
  assert.equal(
    summary.recentActivity.find((event) => event.id === "event-3")?.attempt,
    2,
  );
  assert.equal(summary.recentActivity.some((event) => event.id === "event-other-account"), false);
});

test("keeps legacy failures visible beside creation activity and scopes pending counts", () => {
  const summary = buildFacebookPerformance(
    [
      {
        id: "failed-post",
        workspaceId: "workspace-a",
        title: "تعذر النشر",
        status: "failed",
        channels: ["facebook"],
        publishResults: {
          facebook: {
            accountId: "page-1",
            status: "failed",
            attemptedAt: "2026-10-29T12:00:00.000Z",
            reason: "META_ERROR",
          },
        },
        metadata: {},
        createdAt: "2026-10-28T12:00:00.000Z",
        updatedAt: "2026-10-29T12:00:00.000Z",
      },
      {
        id: "scheduled-post",
        workspaceId: "workspace-a",
        title: "منشور مجدول",
        status: "scheduled",
        channels: ["facebook"],
        publishResults: {},
        metadata: {},
        createdAt: "2026-10-30T12:00:00.000Z",
        updatedAt: "2026-10-30T12:00:00.000Z",
      },
    ],
    [
      facebookEvent("created", "failed-post", "post_created", "2026-10-28T12:00:00.000Z"),
      facebookEvent("scheduled", "scheduled-post", "post_scheduled", "2026-10-30T12:00:00.000Z"),
    ],
    "page-1",
    "owner-1",
    "workspace-a",
    now,
  );

  assert.equal(summary.attemptedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.scheduledCount, 1);
  assert.equal(summary.recentActivity.some((event) => event.id === "legacy:failed-post"), true);
});

test("Facebook performance excludes posts and activity from another workspace", () => {
  const summary = buildFacebookPerformance(
    [
      {
        id: "post-a",
        workspaceId: "workspace-a",
        title: "A",
        status: "published",
        channels: ["facebook"],
        publishResults: {},
        metadata: {},
        createdAt: "2026-10-30T12:00:00.000Z",
        updatedAt: "2026-10-30T12:00:00.000Z",
      },
      {
        id: "post-b",
        workspaceId: "workspace-b",
        title: "B",
        status: "published",
        channels: ["facebook"],
        publishResults: {},
        metadata: {},
        createdAt: "2026-10-30T12:00:00.000Z",
        updatedAt: "2026-10-30T12:00:00.000Z",
      },
    ],
    [
      facebookEvent("event-a", "post-a", "publish_succeeded", "2026-10-30T12:00:00.000Z"),
      facebookEvent("event-b", "post-b", "publish_succeeded", "2026-10-30T12:00:00.000Z", {
        workspaceId: "workspace-b",
      }),
    ],
    "page-1",
    "owner-a",
    "workspace-a",
    now,
  );

  assert.equal(summary.publishedCount, 1);
  assert.equal(summary.recentActivity.some((event) => event.postId === "post-b"), false);
});
