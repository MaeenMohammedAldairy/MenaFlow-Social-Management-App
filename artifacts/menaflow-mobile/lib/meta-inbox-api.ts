import {
  fetchApiResponse,
  readJsonResponse,
} from "@workspace/api-client-react";
import type { WebhookAttemptSummary } from "./inbound-webhook-copy";

export type MetaInboxPlatform = "facebook" | "instagram";
export type MetaInboxKind = "message" | "comment";
export type InboxPlatform = "all" | MetaInboxPlatform | "whatsapp";

export type MetaInboxMedia = {
  type: string;
  url: string | null;
  thumbnailUrl: string | null;
};

export type MetaInboxItem = {
  id: string;
  platform: MetaInboxPlatform;
  kind: MetaInboxKind;
  externalId: string;
  conversationId: string;
  parentId: string | null;
  actorId: string | null;
  actorName: string | null;
  text: string;
  media: MetaInboxMedia[];
  occurredAt: string;
  replyText: string | null;
  repliedAt: string | null;
  replyStatus: "sending" | "unknown" | null;
  autoReplyStatus:
    | "queued"
    | "processing"
    | "sending"
    | "sent"
    | "failed"
    | "skipped"
    | "unknown"
    | null;
  autoReplyErrorCode: string | null;
};

export function metaInboxPersonId(item: MetaInboxItem): string {
  return (
    item.actorId ||
    (item.kind === "message"
      ? item.conversationId || item.externalId
      : item.externalId)
  );
}

export type MetaAutoReplySettings = {
  enabled: boolean;
  facebookMessagesEnabled: boolean;
  facebookCommentsEnabled: boolean;
  instagramMessagesEnabled: boolean;
  instagramCommentsEnabled: boolean;
  language: "ar" | "match_customer";
  tone: "friendly_professional" | "concise" | "formal";
  instructions: string;
};

export type MetaAutoReplyReadiness = {
  connected: boolean;
  tokenReady: boolean;
  webhookConfigured: boolean;
  subscriptionReady: boolean;
  messagesSubscriptionReady: boolean;
  commentsSubscriptionReady: boolean;
  aiConfigured: boolean;
  messagesReady: boolean;
  commentsReady: boolean;
  missingPermissions: string[];
};

export type MetaInboxResponse = {
  webhook: {
    verificationConfigured: boolean;
    callbackUrl: string | null;
    lastEventAt: string | null;
    accounts: Record<MetaInboxPlatform, string | null>;
    subscriptions: Partial<
      Record<
        MetaInboxPlatform,
        {
          accountId: string;
          subscribedAt: string | null;
          fields: string[];
          errorCode: string | null;
        }
      >
    >;
  };
  hasMore: boolean;
  nextCursor: string | null;
  items: MetaInboxItem[];
};

/** One named problem with the inbound path, already worded for the merchant. */
export type InboundDiagnosticIssue = {
  code: string;
  message: string;
  severity: "warning" | "critical";
};

/** Whether Facebook/Instagram events reach the server at all. */
export type MetaInboundDiagnostics = {
  deliveryConfirmed: boolean;
  lastInboxItemAt: string | null;
  inboxItemCount: number;
  inboxCountByPlatform: Record<string, number>;
  autoReplyJobs: {
    queued: number;
    completed: number;
    failed: number;
    skipped: number;
  };
  subscriptions: Array<{
    platform: MetaInboxPlatform;
    accountId: string;
    subscribedFields: string[];
    subscribedAt: string | null;
    lastErrorCode: string | null;
  }>;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  /**
   * Recorded Meta webhook calls, or null when the server did not read the
   * delivery log. This is what tells "Meta never called" apart from "Meta
   * called and we refused it".
   */
  webhookAttempts: WebhookAttemptSummary | null;
  issues: InboundDiagnosticIssue[];
};

export type MetaAutoReplySettingsResponse = {
  settings: MetaAutoReplySettings;
  readiness: Record<MetaInboxPlatform, MetaAutoReplyReadiness>;
  inbound?: MetaInboundDiagnostics;
};

export type MetaAutoReplyHistoricalPostsResponse = {
  platforms: Record<
    MetaInboxPlatform,
    {
      ready: boolean;
      reason: string | null;
      posts: Array<{
        id: string;
        title: string;
        body: string;
        createdAt: string;
        imageUrl: string | null;
        products: string[];
        eligibleCommentCount: number;
      }>;
    }
  >;
};

export type MetaInboxQuery = {
  cursor?: string;
  personId?: string;
  platform?: MetaInboxPlatform;
};

export async function getMetaInbox(
  query: MetaInboxQuery = {},
): Promise<MetaInboxResponse> {
  const search = new URLSearchParams();
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.personId) search.set("personId", query.personId);
  if (query.platform) search.set("platform", query.platform);
  const searchText = search.toString();
  const suffix = searchText ? `?${searchText}` : "";
  const response = await fetchApiResponse(`/api/social/meta-inbox${suffix}`);
  return readJsonResponse<MetaInboxResponse>(response);
}

export async function getMetaAutoReplySettings(): Promise<MetaAutoReplySettingsResponse> {
  const response = await fetchApiResponse("/api/social/meta-auto-replies");
  return readJsonResponse<MetaAutoReplySettingsResponse>(response);
}

export async function saveMetaAutoReplySettings(
  settings: MetaAutoReplySettings,
): Promise<MetaAutoReplySettings> {
  const response = await fetchApiResponse("/api/social/meta-auto-replies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return readJsonResponse<MetaAutoReplySettings>(response);
}

export async function getMetaAutoReplyHistoricalPosts(): Promise<MetaAutoReplyHistoricalPostsResponse> {
  const response = await fetchApiResponse(
    "/api/social/meta-auto-replies/historical-comments",
  );
  return readJsonResponse<MetaAutoReplyHistoricalPostsResponse>(response);
}

export async function queueMetaAutoReplyHistoricalComments(input: {
  platform: MetaInboxPlatform;
  postIds?: string[];
  allEligible?: boolean;
}): Promise<{ queuedCount: number; batchCount: number }> {
  const response = await fetchApiResponse(
    "/api/social/meta-auto-replies/historical-comments",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readJsonResponse<{ queuedCount: number; batchCount: number }>(response);
}

export async function activateMetaWebhookSubscriptions(): Promise<{
  subscriptions: Record<
    string,
    { subscribed: boolean; fields: string[]; errorCode?: string }
  >;
}> {
  const response = await fetchApiResponse(
    "/api/social/meta-inbox/webhook-subscriptions",
    { method: "POST" },
  );
  return readJsonResponse(response);
}

export async function sendMetaInboxReply(
  itemId: string,
  text: string,
): Promise<{ sent: boolean }> {
  const response = await fetchApiResponse(
    `/api/social/meta-inbox/items/${encodeURIComponent(itemId)}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  return readJsonResponse(response);
}

export async function retryMetaAutoReply(itemId: string): Promise<{
  queued: boolean;
  autoReplyStatus: string;
}> {
  const response = await fetchApiResponse(
    `/api/social/meta-inbox/items/${encodeURIComponent(itemId)}/auto-reply`,
    { method: "POST" },
  );
  return readJsonResponse(response);
}

export async function confirmMetaInboxReplyNotSent(
  itemId: string,
): Promise<{ cleared: boolean }> {
  const response = await fetchApiResponse(
    `/api/social/meta-inbox/items/${encodeURIComponent(itemId)}/retry-confirmation`,
    { method: "POST" },
  );
  return readJsonResponse(response);
}

export async function testMetaAutoReply(input: {
  message: string;
  settings: MetaAutoReplySettings;
  platform?: MetaInboxPlatform;
  kind?: MetaInboxKind;
}): Promise<{ reply: string; matchedProduct?: string | null }> {
  const response = await fetchApiResponse("/api/social/meta-auto-replies/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJsonResponse<{ reply: string; matchedProduct?: string | null }>(response);
}
