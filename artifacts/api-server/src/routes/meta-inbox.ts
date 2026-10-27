import { and, desc, eq, max } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaConnections,
  menaMetaInboxItems,
  menaMetaWebhookSubscriptions,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();

function webhookCallbackUrl(): string | null {
  const configuredRedirect = process.env.MENA_FACEBOOK_REDIRECT_URI?.trim();
  if (!configuredRedirect) return null;
  try {
    const url = new URL(configuredRedirect);
    url.pathname = "/api/social/meta/webhook";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

router.get("/social/meta-inbox", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const platformValue = metaString(req.query.platform);
  const kindValue = metaString(req.query.kind);
  const filters = [eq(menaMetaInboxItems.workspaceId, workspaceId)];
  if (platformValue === "facebook" || platformValue === "instagram") {
    filters.push(eq(menaMetaInboxItems.platform, platformValue));
  }
  if (kindValue === "message" || kindValue === "comment") {
    filters.push(eq(menaMetaInboxItems.kind, kindValue));
  }
  const limit = Math.min(
    100,
    Math.max(1, Number(metaString(req.query.limit) ?? "50") || 50),
  );

  const [[lastEvent], [connection], subscriptions, items] = await Promise.all([
    db
      .select({ lastEventAt: max(menaMetaInboxItems.occurredAt) })
      .from(menaMetaInboxItems)
      .where(eq(menaMetaInboxItems.workspaceId, workspaceId)),
    db
      .select({
        facebook: menaMetaConnections.pageId,
        instagram: menaMetaConnections.instagramUserId,
      })
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(menaMetaWebhookSubscriptions)
      .where(eq(menaMetaWebhookSubscriptions.workspaceId, workspaceId)),
    db
      .select({
        item: menaMetaInboxItems,
        autoReplyStatus: menaMetaAutoReplyJobs.status,
      })
      .from(menaMetaInboxItems)
      .leftJoin(
        menaMetaAutoReplyJobs,
        and(
          eq(menaMetaAutoReplyJobs.workspaceId, menaMetaInboxItems.workspaceId),
          eq(menaMetaAutoReplyJobs.inboxItemId, menaMetaInboxItems.id),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(menaMetaInboxItems.occurredAt))
      .limit(limit),
  ]);
  res.json({
    webhook: {
      verificationConfigured: Boolean(
        process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim(),
      ),
      callbackUrl: webhookCallbackUrl(),
      lastEventAt: lastEvent?.lastEventAt?.toISOString() ?? null,
      accounts: {
        facebook: connection?.facebook ?? null,
        instagram: connection?.instagram ?? null,
      },
      subscriptions: Object.fromEntries(
        subscriptions.map((subscription) => [
          subscription.platform,
          {
            accountId: subscription.accountId,
            subscribedAt: subscription.subscribedAt?.toISOString() ?? null,
            fields: subscription.subscribedFields,
            errorCode: subscription.lastErrorCode,
          },
        ]),
      ),
    },
    items: items.map(({ item, autoReplyStatus }) => ({
      id: item.id,
      platform: item.platform,
      kind: item.kind,
      externalId: item.externalId,
      conversationId: item.conversationId,
      parentId: item.parentId,
      actorId: item.actorId,
      actorName: item.actorName,
      text: item.text,
      media: Array.isArray(item.metadata.media) ? item.metadata.media : [],
      occurredAt: item.occurredAt.toISOString(),
      replyText: item.replyText,
      repliedAt: item.repliedAt?.toISOString() ?? null,
      autoReplyStatus,
    })),
  });
});

export default router;
