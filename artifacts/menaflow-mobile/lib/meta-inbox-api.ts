import { fetchApiResponse } from "@workspace/api-client-react";

export type MetaInboxPlatform = "facebook" | "instagram";
export type MetaInboxKind = "message" | "comment";

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

export type MetaAutoReplySettingsResponse = {
  settings: MetaAutoReplySettings;
  readiness: Record<MetaInboxPlatform, MetaAutoReplyReadiness>;
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

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    throw new Error("تعذر قراءة استجابة الخادم.");
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : `HTTP ${response.status}`,
    );
  }
  return payload as T;
}

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
  return responseJson<MetaInboxResponse>(response);
}

export async function getMetaAutoReplySettings(): Promise<MetaAutoReplySettingsResponse> {
  const response = await fetchApiResponse("/api/social/meta-auto-replies");
  return responseJson<MetaAutoReplySettingsResponse>(response);
}

export async function saveMetaAutoReplySettings(
  settings: MetaAutoReplySettings,
): Promise<MetaAutoReplySettings> {
  const response = await fetchApiResponse("/api/social/meta-auto-replies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return responseJson<MetaAutoReplySettings>(response);
}

export async function getMetaAutoReplyHistoricalPosts(): Promise<MetaAutoReplyHistoricalPostsResponse> {
  const response = await fetchApiResponse(
    "/api/social/meta-auto-replies/historical-comments",
  );
  return responseJson<MetaAutoReplyHistoricalPostsResponse>(response);
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
  return responseJson<{ queuedCount: number; batchCount: number }>(response);
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
  return responseJson(response);
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
  return responseJson(response);
}

export async function confirmMetaInboxReplyNotSent(
  itemId: string,
): Promise<{ cleared: boolean }> {
  const response = await fetchApiResponse(
    `/api/social/meta-inbox/items/${encodeURIComponent(itemId)}/retry-confirmation`,
    { method: "POST" },
  );
  return responseJson(response);
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
  return responseJson<{ reply: string; matchedProduct?: string | null }>(response);
}
