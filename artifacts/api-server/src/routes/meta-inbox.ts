import { and, desc, eq, isNull, lt, max, or } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaConnections,
  menaMetaInboxItems,
  menaMetaWebhookSubscriptions,
} from "@workspace/db";
import { metaConnectionAccessToken } from "../lib/meta-connection-token.ts";
import { getMetaGraphVersion } from "../lib/meta-graph-config";
import { metaString, metaWebhookCallbackUrl } from "../lib/meta-inbox-utils";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  encodeMetaInboxCursor,
  parseMetaInboxCursor,
} from "../lib/meta-inbox-pagination";

const router = Router();
const MAX_PROFILE_LOOKUPS_PER_REQUEST = 10;

async function resolveMissingActorNames(
  items: Array<{ item: typeof menaMetaInboxItems.$inferSelect }>,
  connection: typeof menaMetaConnections.$inferSelect | undefined,
  workspaceId: string,
): Promise<void> {
  if (!connection) return;

  const pending = new Map<string, { platform: "facebook" | "instagram"; actorId: string }>();
  for (const { item } of items) {
    if (!item.actorName && item.actorId) {
      pending.set(`${item.platform}:${item.actorId}`, {
        platform: item.platform,
        actorId: item.actorId,
      });
    }
    if (pending.size >= MAX_PROFILE_LOOKUPS_PER_REQUEST) break;
  }
  if (pending.size === 0) return;

  let accessToken: string;
  try {
    accessToken = await metaConnectionAccessToken(connection);
  } catch (error) {
    console.warn("Unable to read Meta token for inbox participant names.", {
      workspaceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }

  await Promise.all(
    [...pending.values()].map(async ({ platform, actorId }) => {
      const fields =
        platform === "facebook"
          ? "first_name,last_name"
          : "name,username";
      const url = new URL(
        `https://graph.facebook.com/${getMetaGraphVersion()}/${encodeURIComponent(actorId)}`,
      );
      url.searchParams.set("fields", fields);

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(5_000),
        });
        const profile: unknown = await response.json();
        if (!response.ok || !profile || typeof profile !== "object") {
          console.warn("Meta did not return an inbox participant profile.", {
            platform,
            status: response.status,
          });
          return;
        }

        const profileRecord = profile as Record<string, unknown>;
        const name =
          platform === "facebook"
            ? [metaString(profileRecord.first_name), metaString(profileRecord.last_name)]
                .filter(Boolean)
                .join(" ") || metaString(profileRecord.name)
            : metaString(profileRecord.name) ?? metaString(profileRecord.username);
        if (!name) return;

        await db
          .update(menaMetaInboxItems)
          .set({ actorName: name })
          .where(
            and(
              eq(menaMetaInboxItems.workspaceId, workspaceId),
              eq(menaMetaInboxItems.platform, platform),
              eq(menaMetaInboxItems.actorId, actorId),
              isNull(menaMetaInboxItems.actorName),
            ),
          );
        for (const { item } of items) {
          if (item.platform === platform && item.actorId === actorId) {
            item.actorName = name;
          }
        }
      } catch (error) {
        console.warn("Unable to resolve a Meta inbox participant name.", {
          platform,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
  );
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
  const personId = metaString(req.query.personId);
  const cursorValue = metaString(req.query.cursor);
  const rawLimit = metaString(req.query.limit) ?? "50";
  const limit = Number(rawLimit);
  if (
    (platformValue && platformValue !== "facebook" && platformValue !== "instagram") ||
    (kindValue && kindValue !== "message" && kindValue !== "comment") ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    res.status(400).json({ error: "مرشحات أو حجم صفحة صندوق الوارد غير صالح." });
    return;
  }
  const filters = [eq(menaMetaInboxItems.workspaceId, workspaceId)];
  if (platformValue === "facebook" || platformValue === "instagram") {
    filters.push(eq(menaMetaInboxItems.platform, platformValue));
  }
  if (kindValue === "message" || kindValue === "comment") {
    filters.push(eq(menaMetaInboxItems.kind, kindValue));
  }
  if (personId) {
    const personFilter = or(
      eq(menaMetaInboxItems.actorId, personId),
      and(
        isNull(menaMetaInboxItems.actorId),
        eq(menaMetaInboxItems.kind, "message"),
        eq(menaMetaInboxItems.conversationId, personId),
      ),
      and(
        isNull(menaMetaInboxItems.actorId),
        eq(menaMetaInboxItems.kind, "comment"),
        eq(menaMetaInboxItems.externalId, personId),
      ),
    );
    if (personFilter) filters.push(personFilter);
  }
  if (cursorValue) {
    try {
      const cursor = parseMetaInboxCursor(cursorValue);
      const cursorFilter = or(
        lt(menaMetaInboxItems.occurredAt, cursor.occurredAt),
        and(
          eq(menaMetaInboxItems.occurredAt, cursor.occurredAt),
          lt(menaMetaInboxItems.id, cursor.id),
        ),
      );
      if (cursorFilter) filters.push(cursorFilter);
    } catch {
      res.status(400).json({ error: "مؤشر صفحة صندوق الوارد غير صالح." });
      return;
    }
  }

  const [[lastEvent], [connection], subscriptions, rows] = await Promise.all([
    db
      .select({ lastEventAt: max(menaMetaInboxItems.occurredAt) })
      .from(menaMetaInboxItems)
      .where(eq(menaMetaInboxItems.workspaceId, workspaceId)),
    db
      .select()
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
      .orderBy(desc(menaMetaInboxItems.occurredAt), desc(menaMetaInboxItems.id))
      .limit(limit + 1),
  ]);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  await resolveMissingActorNames(items, connection, workspaceId);
  const lastItem = items.at(-1)?.item;
  res.json({
    webhook: {
      verificationConfigured: Boolean(
        process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim(),
      ),
      callbackUrl: metaWebhookCallbackUrl(
        process.env.MENA_PUBLIC_MEDIA_BASE_URL,
        process.env.MENA_FACEBOOK_REDIRECT_URI,
      ),
      lastEventAt: lastEvent?.lastEventAt?.toISOString() ?? null,
      accounts: {
        facebook: connection?.pageId ?? null,
        instagram: connection?.instagramUserId ?? null,
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
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeMetaInboxCursor(lastItem.occurredAt, lastItem.id)
        : null,
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
      replyStatus: item.replyStatus,
      autoReplyStatus,
    })),
  });
});

export default router;
