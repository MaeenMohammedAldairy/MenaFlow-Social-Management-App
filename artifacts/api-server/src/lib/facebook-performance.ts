type JsonRecord = Record<string, unknown>;

export interface FacebookPerformancePost {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  channels: unknown;
  publishResults: unknown;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string | null;
}

export interface FacebookPerformanceActivity {
  id: string;
  postId: string;
  workspaceId: string;
  accountId: string | null;
  channel: string;
  eventType: string;
  actorId: string;
  occurredAt: Date | string;
  details: unknown;
  title: string | null;
}

export interface FacebookPerformanceSummary {
  publishedCount: number;
  attemptedCount: number;
  successRate: number | null;
  scheduledCount: number;
  reviewCount: number;
  failedCount: number;
  aiPublishedCount: number;
  weeklyPublished: Array<{ label: string; count: number }>;
  recentActivity: Array<{
    id: string;
    postId: string;
    title: string;
    eventType: string;
    occurredAt: string;
    actorLabel: string;
    attempt: number | null;
    reason: string | null;
  }>;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function dateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resultForFacebook(post: FacebookPerformancePost, accountId: string): JsonRecord | null {
  const results = record(post.publishResults);
  const result = record(results.facebook);
  const resultAccountId = stringValue(result.accountId);
  if (resultAccountId && resultAccountId !== accountId) return null;
  return Object.keys(result).length > 0 ? result : null;
}

function channelList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((channel): channel is string => typeof channel === "string")
    : [];
}

function isPublished(eventType: string): boolean {
  return eventType === "publish_succeeded" || eventType === "publish_verified";
}

function isTerminalPublishEvent(eventType: string): boolean {
  return isPublished(eventType) ||
    eventType === "publish_failed" ||
    eventType === "publish_uncertain";
}

function addWeeklyPost(
  buckets: Array<Set<string>>,
  postId: string,
  timestamp: Date | null,
  since: Date,
  now: Date,
): void {
  if (!timestamp || timestamp < since || timestamp > now) return;
  const daysAgo = (now.getTime() - timestamp.getTime()) / 86_400_000;
  const bucketIndex = Math.min(3, Math.floor((30 - daysAgo) / 7));
  buckets[bucketIndex].add(postId);
}

export function buildFacebookPerformance(
  posts: FacebookPerformancePost[],
  allActivity: FacebookPerformanceActivity[],
  accountId: string,
  ownerId: string,
  workspaceId: string,
  now = new Date(),
): FacebookPerformanceSummary {
  const workspacePosts = posts.filter((post) => post.workspaceId === workspaceId);
  const activity = allActivity
    .filter((event) =>
      event.workspaceId === workspaceId &&
      event.accountId === accountId &&
      event.channel === "facebook",
    )
    .sort((left, right) => {
      const leftTime = dateValue(left.occurredAt)?.getTime() ?? 0;
      const rightTime = dateValue(right.occurredAt)?.getTime() ?? 0;
      return leftTime - rightTime;
    });
  const postsById = new Map(workspacePosts.map((post) => [post.id, post]));
  const attemptNumbers = new Map<string, number>();
  const eventAttempts = new Map<string, number>();
  const latestTerminalByPost = new Map<string, FacebookPerformanceActivity>();
  const publishedIds = new Set<string>();
  const attemptedIds = new Set<string>();
  const eventPostIds = new Set(activity.map((event) => event.postId));
  const trackedPublishPostIds = new Set(
    activity
      .filter((event) =>
        event.eventType === "publish_attempt_started" ||
        isTerminalPublishEvent(event.eventType),
      )
      .map((event) => event.postId),
  );
  const associatedPostIds = new Set(eventPostIds);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const weeklyPostIds = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()];

  for (const event of activity) {
    const eventKey = `${event.postId}:facebook`;
    if (event.eventType === "publish_attempt_started") {
      attemptedIds.add(event.postId);
      const nextAttempt = (attemptNumbers.get(eventKey) ?? 0) + 1;
      attemptNumbers.set(eventKey, nextAttempt);
      eventAttempts.set(event.id, nextAttempt);
    } else if (isTerminalPublishEvent(event.eventType)) {
      attemptedIds.add(event.postId);
      latestTerminalByPost.set(event.postId, event);
      eventAttempts.set(event.id, attemptNumbers.get(eventKey) ?? 1);
      if (isPublished(event.eventType)) {
        publishedIds.add(event.postId);
        addWeeklyPost(
          weeklyPostIds,
          event.postId,
          dateValue(event.occurredAt),
          since,
          now,
        );
      }
    }
  }

  for (const post of workspacePosts) {
    const result = resultForFacebook(post, accountId);
    const resultStatus = stringValue(result?.status);
    if (result) {
      associatedPostIds.add(post.id);
    }
    if (result && ["published", "failed", "unknown", "publishing"].includes(resultStatus ?? "")) {
      attemptedIds.add(post.id);
      if (!trackedPublishPostIds.has(post.id) && resultStatus === "published") {
        publishedIds.add(post.id);
        const resultTime = dateValue(stringValue(result.attemptedAt)) ?? dateValue(post.updatedAt);
        addWeeklyPost(weeklyPostIds, post.id, resultTime, since, now);
      } else if (!trackedPublishPostIds.has(post.id) && (resultStatus === "failed" || resultStatus === "unknown")) {
        latestTerminalByPost.set(post.id, {
          id: `legacy:${post.id}`,
          postId: post.id,
          workspaceId,
          accountId,
          channel: "facebook",
          eventType: resultStatus === "failed" ? "publish_failed" : "publish_uncertain",
          actorId: "",
          occurredAt: stringValue(result.attemptedAt) ?? post.updatedAt ?? post.createdAt,
          details: { reason: result.reason },
          title: post.title,
        });
      }
    }
  }

  const failedIds = new Set(
    [...latestTerminalByPost]
      .filter(([, event]) =>
        event.eventType === "publish_failed" || event.eventType === "publish_uncertain",
      )
      .map(([postId]) => postId),
  );
  const successfulPosts = new Set([...publishedIds].filter((postId) => postsById.has(postId)));
  const aiPublishedCount = [...successfulPosts].filter((postId) =>
    record(postsById.get(postId)?.metadata).aiGenerated === true ||
    Boolean(stringValue(record(postsById.get(postId)?.metadata).aiModel)) ||
    Boolean(stringValue(record(postsById.get(postId)?.metadata).aiProvider)),
  ).length;
  const sinceThirtyDays = since.getTime();

  const recentActivity = activity
    .filter((event) => {
      const eventTime = dateValue(event.occurredAt)?.getTime();
      return eventTime !== undefined &&
        eventTime >= sinceThirtyDays &&
        (event.eventType === "publish_attempt_started" ||
          isTerminalPublishEvent(event.eventType) ||
          event.eventType === "post_created" ||
          event.eventType === "post_approved" ||
        event.eventType === "post_submitted_for_review" ||
        event.eventType === "post_scheduled" ||
          event.eventType === "post_edited");
    })
    .slice(-40)
    .reverse()
    .map((event) => {
      const details = record(event.details);
      return {
        id: event.id,
        postId: event.postId,
        title: event.title ?? postsById.get(event.postId)?.title ?? "منشور",
        eventType: event.eventType,
        occurredAt: dateValue(event.occurredAt)?.toISOString() ?? now.toISOString(),
        actorLabel: event.actorId === "system:auto-publish"
          ? "النشر التلقائي"
          : event.actorId === ownerId
            ? "مستخدم مساحة العمل"
            : "عضو مساحة العمل",
        attempt: eventAttempts.get(event.id) ?? null,
        reason: stringValue(details.reason),
      };
    });

  for (const post of workspacePosts) {
    if (trackedPublishPostIds.has(post.id)) continue;
    const result = resultForFacebook(post, accountId);
    const status = stringValue(result?.status);
    if (!result || !["publishing", "published", "failed", "unknown"].includes(status ?? "")) continue;
    const occurredAt = dateValue(stringValue(result.attemptedAt)) ??
      dateValue(post.updatedAt) ??
      dateValue(post.createdAt);
    if (!occurredAt || occurredAt < since || occurredAt > now) continue;
    recentActivity.push({
      id: `legacy:${post.id}`,
      postId: post.id,
      title: post.title || "منشور",
      eventType: status === "published"
        ? "publish_succeeded"
        : status === "failed"
          ? "publish_failed"
          : status === "unknown"
            ? "publish_uncertain"
            : "publish_attempt_started",
      occurredAt: occurredAt.toISOString(),
      actorLabel: "سجل النشر",
      attempt: null,
      reason: stringValue(result.reason),
    });
  }

  for (const post of posts) {
    if (!channelList(post.channels).includes("facebook")) continue;
    if (post.status !== "scheduled" && post.status !== "review") continue;
    if (eventPostIds.has(post.id)) continue;
    if (!associatedPostIds.has(post.id)) continue;
    const result = resultForFacebook(post, accountId);
    if (result) continue;
    recentActivity.push({
      id: `pending:${post.id}`,
      postId: post.id,
      title: post.title || "منشور",
      eventType: post.status === "scheduled" ? "post_scheduled" : "post_approved",
      occurredAt: dateValue(post.updatedAt)?.toISOString() ??
        dateValue(post.createdAt)?.toISOString() ??
        now.toISOString(),
      actorLabel: "سجل المنشور",
      attempt: null,
      reason: null,
    });
  }

  const totalAttempted = attemptedIds.size;
  return {
    publishedCount: publishedIds.size,
    attemptedCount: totalAttempted,
    successRate: totalAttempted === 0
      ? null
      : Math.round((publishedIds.size / totalAttempted) * 100),
    scheduledCount: workspacePosts.filter((post) =>
      post.status === "scheduled" &&
      channelList(post.channels).includes("facebook") &&
      associatedPostIds.has(post.id),
    ).length,
    reviewCount: workspacePosts.filter((post) =>
      post.status === "review" &&
      channelList(post.channels).includes("facebook") &&
      associatedPostIds.has(post.id),
    ).length,
    failedCount: failedIds.size,
    aiPublishedCount,
    weeklyPublished: weeklyPostIds.map((ids, index) => ({
      label: `الأسبوع ${index + 1}`,
      count: ids.size,
    })),
    recentActivity: recentActivity
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, 20),
  };
}
