import { randomUUID } from "node:crypto";

export type PostActivityEventType =
  | "post_created"
  | "post_approved"
  | "post_submitted_for_review"
  | "post_scheduled"
  | "post_edited"
  | "publish_attempt_started"
  | "publish_succeeded"
  | "publish_failed"
  | "publish_uncertain"
  | "publish_verified";

export interface PostActivityEventInput {
  ownerId: string;
  workspaceId: string;
  postId: string;
  accountId: string | null;
  channel: string;
  eventType: PostActivityEventType;
  actorId: string;
  occurredAt?: Date;
  details?: Record<string, unknown>;
}

export function makePostActivityEvent(input: PostActivityEventInput) {
  return {
    id: randomUUID(),
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    postId: input.postId,
    accountId: input.accountId,
    channel: input.channel,
    eventType: input.eventType,
    actorId: input.actorId,
    occurredAt: input.occurredAt ?? new Date(),
    details: input.details ?? {},
  };
}

export function makePublishActivityEvent(input: {
  ownerId: string;
  workspaceId: string;
  postId: string;
  accountId: string | null;
  channel: string;
  actorId: string;
  autoPublish: boolean;
  status: string;
  attemptedAt?: string;
  completedAt?: string;
  externalPostId?: string;
  url?: string | null;
  reason?: string;
}) {
  const eventType: PostActivityEventType | null =
    input.status === "publishing"
      ? "publish_attempt_started"
      : input.status === "published"
        ? "publish_succeeded"
        : input.status === "failed"
          ? "publish_failed"
          : input.status === "unknown"
            ? "publish_uncertain"
            : null;
  if (!eventType) return null;

  const attemptedAt = input.attemptedAt ? new Date(input.attemptedAt) : null;
  const completedAt = input.completedAt ? new Date(input.completedAt) : null;
  const occurredAt = eventType === "publish_attempt_started"
    ? attemptedAt
    : completedAt ?? new Date();
  return makePostActivityEvent({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    postId: input.postId,
    accountId: input.accountId,
    channel: input.channel,
    eventType,
    actorId: input.autoPublish ? "system:auto-publish" : input.actorId,
    occurredAt:
      occurredAt && !Number.isNaN(occurredAt.getTime())
        ? occurredAt
        : new Date(),
    details: {
      status: input.status,
      ...(input.attemptedAt ? { attemptedAt: input.attemptedAt } : {}),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.externalPostId ? { externalPostId: input.externalPostId } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}
