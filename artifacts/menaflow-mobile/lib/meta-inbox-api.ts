/**
 * The Facebook and Instagram inbox, and the automatic replies to it.
 *
 * A thin adapter over the client generated from `lib/api-spec/openapi.yaml`. The
 * shapes live in the contract now; what is left here is the one filter the wire
 * does not have (an "all platforms" tab) and the names the screens already
 * import.
 *
 * This used to be a hand-written module with its own copies of the item,
 * settings, readiness and diagnostics types, kept in step with the server by
 * hand. It had already drifted: `inbound` was optional where the server always
 * sends it, and `lastInboxItemAt` was required where the contract said optional.
 */
import {
  listMetaInbox as generatedListMetaInbox,
  sendMetaInboxReply as generatedSendMetaInboxReply,
  retryMetaInboxAutoReply as generatedRetryMetaInboxAutoReply,
  confirmMetaInboxReplyNotSent as generatedConfirmMetaInboxReplyNotSent,
  getMetaAutoReplySettings as generatedGetMetaAutoReplySettings,
  saveMetaAutoReplySettings as generatedSaveMetaAutoReplySettings,
  getMetaAutoReplyHistoricalPosts as generatedGetMetaAutoReplyHistoricalPosts,
  queueMetaAutoReplyHistoricalComments as generatedQueueMetaAutoReplyHistoricalComments,
  activateMetaWebhookSubscriptions as generatedActivateMetaWebhookSubscriptions,
  testMetaAutoReply as generatedTestMetaAutoReply,
  type MetaInboxItem,
  type MetaInboxMedia,
  type MetaInboxResponse,
  type MetaAutoReplySettings,
  type MetaAutoReplyReadiness,
  type MetaAutoReplySettingsResponse,
  type MetaAutoReplyHistoricalPostsResponse,
  type MetaInboundDiagnostics,
  type DiagnosticIssue,
  type MetaAutoReplyTestInput,
} from "@workspace/api-client-react";

export type {
  MetaInboxItem,
  MetaInboxMedia,
  MetaInboxResponse,
  MetaAutoReplySettings,
  MetaAutoReplyReadiness,
  MetaAutoReplySettingsResponse,
  MetaAutoReplyHistoricalPostsResponse,
  MetaInboundDiagnostics,
};

export type MetaInboxPlatform = MetaInboxItem["platform"];
export type MetaInboxKind = MetaInboxItem["kind"];

/** The contract calls it `DiagnosticIssue`; the diagnostics screen imports this. */
export type InboundDiagnosticIssue = DiagnosticIssue;

/** The "all" tab is a client-side union; the wire only knows the two platforms. */
export type InboxPlatform = "all" | MetaInboxPlatform | "whatsapp";

export function metaInboxPersonId(item: MetaInboxItem): string {
  return (
    item.actorId ||
    (item.kind === "message"
      ? item.conversationId || item.externalId
      : item.externalId)
  );
}

export type MetaInboxQuery = {
  cursor?: string;
  personId?: string;
  platform?: MetaInboxPlatform;
};

export async function getMetaInbox(
  query: MetaInboxQuery = {},
): Promise<MetaInboxResponse> {
  return generatedListMetaInbox(query);
}

export async function getMetaAutoReplySettings(): Promise<MetaAutoReplySettingsResponse> {
  return generatedGetMetaAutoReplySettings();
}

export async function saveMetaAutoReplySettings(
  settings: MetaAutoReplySettings,
): Promise<MetaAutoReplySettings> {
  return generatedSaveMetaAutoReplySettings(settings);
}

export async function getMetaAutoReplyHistoricalPosts(): Promise<MetaAutoReplyHistoricalPostsResponse> {
  return generatedGetMetaAutoReplyHistoricalPosts();
}

export async function queueMetaAutoReplyHistoricalComments(input: {
  platform: MetaInboxPlatform;
  postIds?: string[];
  allEligible?: boolean;
}): Promise<{ queuedCount: number; batchCount: number }> {
  return generatedQueueMetaAutoReplyHistoricalComments(input);
}

export async function activateMetaWebhookSubscriptions(): Promise<{
  subscriptions: Record<
    string,
    { subscribed: boolean; fields: string[]; errorCode?: string }
  >;
}> {
  return generatedActivateMetaWebhookSubscriptions();
}

export async function sendMetaInboxReply(
  itemId: string,
  text: string,
): Promise<{ sent: boolean }> {
  return generatedSendMetaInboxReply(itemId, { text });
}

export async function retryMetaAutoReply(itemId: string): Promise<{
  queued: boolean;
  autoReplyStatus: string;
}> {
  return generatedRetryMetaInboxAutoReply(itemId);
}

export async function confirmMetaInboxReplyNotSent(
  itemId: string,
): Promise<{ cleared: boolean }> {
  return generatedConfirmMetaInboxReplyNotSent(itemId);
}

export async function testMetaAutoReply(
  input: MetaAutoReplyTestInput,
): Promise<{ reply: string; matchedProduct?: string | null }> {
  return generatedTestMetaAutoReply(input);
}
