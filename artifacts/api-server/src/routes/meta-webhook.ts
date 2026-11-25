import { randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaInboxItems,
} from "@workspace/db";
import { autoReplyNextRunAt } from "../lib/auto-reply-policy";
import {
  type MetaInboundItem,
  metaInboundNotifications,
  scheduleMetaAutoReplies,
} from "../lib/meta-inbound-ingestion";
import { notifyCustomerMessage } from "../lib/push-notifications";
import {
  parseMetaWebhookEvents,
  resolveUniqueMetaConnection,
  verifyMetaWebhookSignature,
} from "../lib/meta-webhook";
import { metaString } from "../lib/meta-inbox-utils";
import {
  describeMetaInboundOutcome,
  logInboundWebhookOutcome,
  type InboundWebhookOutcome,
  type MetaInboundReason,
} from "../lib/inbound-webhook-diagnostics";
import {
  recordInboundWebhookAttempt,
  type InboundDeliveryPlatform,
} from "../lib/inbound-delivery-log";
import { logger } from "../lib/logger.ts";

/**
 * Logs one Meta inbound outcome and keeps it in the delivery log.
 *
 * The log line tells the operator what happened today; the persisted row is
 * what the reply-settings screen can still show tomorrow, which is the only
 * way to separate "Meta never called" from "Meta called and we refused it".
 * `platform` is null for attempts rejected before the object type was read —
 * a Meta webhook serves Facebook and Instagram, so guessing one would mislead
 * an Instagram-only merchant. Recording is fire-and-forget and swallows its
 * own failures: a broken delivery log must never fail an inbound event.
 */
function recordMetaInboundOutcome(
  platform: InboundDeliveryPlatform | null,
  outcome: InboundWebhookOutcome,
  context: Record<string, unknown> = {},
): void {
  logInboundWebhookOutcome(logger, outcome, context);
  void recordInboundWebhookAttempt({
    platform,
    event: outcome.event,
    deliveryConfirmed: outcome.deliveryConfirmed,
    workspaceId:
      typeof context.workspaceId === "string" ? context.workspaceId : null,
    accountId:
      typeof context.accountId === "string" ? context.accountId : null,
    context,
  });
}

const router = Router();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

router.get("/social/meta/webhook", (req, res) => {
  const verifyToken = process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim();
  const mode = metaString(req.query["hub.mode"]);
  const token = metaString(req.query["hub.verify_token"]);
  const challenge = metaString(req.query["hub.challenge"]);
  if (!verifyToken) {
    res.status(503).send("Webhook verification token is not configured.");
    return;
  }
  if (
    mode !== "subscribe" ||
    !token ||
    !challenge ||
    !constantTimeEqual(token, verifyToken)
  ) {
    res.status(403).send("Webhook verification failed.");
    return;
  }
  res.status(200).type("text/plain").send(challenge);
});

router.post("/social/meta/webhook", async (req, res) => {
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const signatureValid = rawBody !== null &&
    verifyMetaWebhookSignature(rawBody, req.get("x-hub-signature-256"), appSecret);
  if (!signatureValid) {
    // Splitting the two causes matters: a missing secret is a deployment
    // mistake on our side, a bad signature is a mismatch with the Meta app.
    recordMetaInboundOutcome(
      null,
      describeMetaInboundOutcome(
        appSecret ? "REJECTED_SIGNATURE" : "MISSING_APP_SECRET",
      ),
      { hasRawBody: Boolean(rawBody), hasSignatureHeader: Boolean(req.get("x-hub-signature-256")) },
    );
    res.status(401).json({ error: "توقيع Meta webhook غير صالح." });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody!.toString("utf8"));
  } catch {
    recordMetaInboundOutcome(null, describeMetaInboundOutcome("INVALID_JSON"));
    res.status(400).json({ error: "صيغة حدث Meta غير صالحة." });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    recordMetaInboundOutcome(null, describeMetaInboundOutcome("INVALID_JSON"));
    res.status(400).json({ error: "صيغة حدث Meta غير صالحة." });
    return;
  }
  const objectType = metaString((payload as Record<string, unknown>).object);
  const platform =
    objectType === "page"
      ? "facebook"
      : objectType === "instagram"
        ? "instagram"
        : null;
  if (!platform) {
    recordMetaInboundOutcome(
      null,
      describeMetaInboundOutcome("IGNORED_OBJECT"),
      { objectType: objectType ?? null },
    );
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  const entries = Array.isArray((payload as Record<string, unknown>).entry)
    ? ((payload as Record<string, unknown>).entry as unknown[])
    : [];
  const totals = { stored: 0, queued: 0, entries: 0 };
  const outcomeLog = (
    reason: MetaInboundReason,
    context: Record<string, unknown> = {},
  ) =>
    recordMetaInboundOutcome(platform, describeMetaInboundOutcome(reason), {
      platform,
      ...context,
    });
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    totals.entries += 1;
    const accountId = metaString((entry as Record<string, unknown>).id);
    if (!accountId) {
      outcomeLog("MISSING_ACCOUNT_ID");
      continue;
    }
    const predicate =
      platform === "facebook"
        ? eq(menaMetaConnections.pageId, accountId)
        : eq(menaMetaConnections.instagramUserId, accountId);
    const connections = await db
      .select({
        ownerId: menaMetaConnections.ownerId,
        workspaceId: menaMetaConnections.workspaceId,
      })
      .from(menaMetaConnections)
      .where(predicate)
      .limit(2);
    const connection = resolveUniqueMetaConnection(connections);
    if (!connection) {
      outcomeLog(
        connections.length > 1 ? "AMBIGUOUS_ACCOUNT" : "UNKNOWN_ACCOUNT",
        { accountId, matches: connections.length },
      );
      continue;
    }

    const events = parseMetaWebhookEvents({ entry: [entry] }, platform);
    if (events.length === 0) {
      outcomeLog("NO_EVENTS", { accountId });
      continue;
    }
    for (let offset = 0; offset < events.length; offset += 100) {
      // Step 1: persist the inbox items in their own committed transaction.
      // No settings lookup, no job insert and no push I/O may join it: a
      // failure in automation must never roll a customer message back.
      const prepared = events.slice(offset, offset + 100).map((event) => {
        const { media, ...item } = event;
        return {
          id: randomUUID(),
          ownerId: connection.ownerId,
          workspaceId: connection.workspaceId,
          ...item,
          metadata: { media },
        };
      });
      const inserted = await db.transaction((transaction) =>
        transaction
          .insert(menaMetaInboxItems)
          .values(prepared)
          .onConflictDoNothing()
          .returning({
            id: menaMetaInboxItems.id,
            workspaceId: menaMetaInboxItems.workspaceId,
            platform: menaMetaInboxItems.platform,
            kind: menaMetaInboxItems.kind,
            conversationId: menaMetaInboxItems.conversationId,
            actorId: menaMetaInboxItems.actorId,
            actorName: menaMetaInboxItems.actorName,
            text: menaMetaInboxItems.text,
          }),
      );
      if (inserted.length === 0) continue;
      totals.stored += inserted.length;
      const items: MetaInboundItem[] = inserted;

      // Step 2: optional automation. Its own errors are contained; the items
      // above are already stored and cannot be rolled back.
      const scheduling = await scheduleMetaAutoReplies({
        items,
        ownerId: connection.ownerId,
        workspaceId: connection.workspaceId,
        nextRunAt: () => autoReplyNextRunAt(),
        newJobId: () => randomUUID(),
        getSettings: async () => {
          const [settings] = await db
            .select()
            .from(menaMetaAutoReplySettings)
            .where(
              eq(menaMetaAutoReplySettings.workspaceId, connection.workspaceId),
            )
            .limit(1);
          return settings;
        },
        insertJobs: async (jobs) => {
          const rows = await db
            .insert(menaMetaAutoReplyJobs)
            .values(jobs)
            .onConflictDoNothing()
            .returning({ inboxItemId: menaMetaAutoReplyJobs.inboxItemId });
          return rows.map((row) => row.inboxItemId);
        },
        onError: (error) => {
          logger.error(
            {
              err: error,
              workspaceId: connection.workspaceId,
              accountId,
              count: items.length,
            },
            "META_AUTO_REPLY_QUEUE_FAILED",
          );
        },
      });
      totals.queued += scheduling.queuedItemIds.length;

      // Step 3: tell the merchant. This runs even when the reply worker has
      // never been deployed, is stopped, or the reply queue failed.
      const notifications = metaInboundNotifications(items, scheduling.queuedItemIds);
      const notified = await Promise.allSettled(
        notifications.map(({ item }) =>
          notifyCustomerMessage({
            workspaceId: item.workspaceId,
            conversationId: item.conversationId,
            platform: item.platform,
            customerName: item.actorName,
            preview: item.text,
          }),
        ),
      );
      const notificationFailures = notified.filter(
        (result) => result.status === "rejected",
      ).length;
      outcomeLog("INBOX_STORED", {
        accountId,
        workspaceId: connection.workspaceId,
        stored: items.length,
        notified: notified.length - notificationFailures,
      });

      if (scheduling.reason === "disabled") {
        outcomeLog("AUTO_REPLY_DISABLED", {
          accountId,
          workspaceId: connection.workspaceId,
        });
      } else if (scheduling.reason === "channel_off") {
        outcomeLog("AUTO_REPLY_CHANNEL_OFF", {
          accountId,
          workspaceId: connection.workspaceId,
        });
      } else if (scheduling.reason === "queue_failed") {
        outcomeLog("AUTO_REPLY_QUEUE_FAILED", {
          accountId,
          workspaceId: connection.workspaceId,
        });
      } else if (scheduling.queuedItemIds.length > 0) {
        outcomeLog("AUTO_REPLY_QUEUED", {
          accountId,
          workspaceId: connection.workspaceId,
          queued: scheduling.queuedItemIds.length,
        });
      }
    }
  }

  outcomeLog("PROCESSED", {
    entries: totals.entries,
    stored: totals.stored,
    queued: totals.queued,
  });
  res.status(200).json({ received: true });
});

export default router;
