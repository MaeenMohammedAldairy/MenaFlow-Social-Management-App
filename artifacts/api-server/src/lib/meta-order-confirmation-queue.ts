import { and, asc, desc, eq, lt, lte, or, sql } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaMetaInboxItems,
  menaOrderItems,
  menaOrders,
} from "@workspace/db";
import {
  metaPageAccessToken,
  MetaInboxGraphError,
  sendMetaInboxReply,
} from "./meta-inbox-graph";
import { formatMetaOrderConfirmationMessage } from "./meta-order-messages";
import { logger } from "./logger";

const leaseMs = 90_000;
const maxAttempts = 3;
const messageReplyWindowMs = 24 * 60 * 60 * 1000;
let processing = false;

async function updateConfirmation(
  orderId: string,
  workspaceId: string,
  status:
    | "queued"
    | "processing"
    | "sending"
    | "sent"
    | "manual_followup"
    | "failed"
    | "unknown",
  options: {
    error?: string | null;
    nextRunAt?: Date;
    leaseExpiresAt?: Date | null;
    sentAt?: Date | null;
  } = {},
): Promise<void> {
  await db
    .update(menaOrders)
    .set({
      metaConfirmationStatus: status,
      metaConfirmationError: options.error ?? null,
      metaConfirmationNextRunAt: options.nextRunAt ?? new Date(),
      metaConfirmationLeaseExpiresAt: options.leaseExpiresAt ?? null,
      ...(options.sentAt ? { metaConfirmationSentAt: options.sentAt } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(menaOrders.id, orderId), eq(menaOrders.workspaceId, workspaceId)),
    );
}

async function claimNextOrder() {
  const now = new Date();
  await db
    .update(menaOrders)
    .set({
      metaConfirmationStatus: "unknown",
      metaConfirmationError: "META_SEND_RESULT_UNKNOWN",
      metaConfirmationLeaseExpiresAt: null,
      metaConfirmationNextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(menaOrders.metaConfirmationStatus, "sending"),
        lt(menaOrders.metaConfirmationLeaseExpiresAt, now),
      ),
    );
  await db
    .update(menaOrders)
    .set({
      metaConfirmationStatus: "failed",
      metaConfirmationError: "META_CONFIRMATION_RETRY_LIMIT_REACHED",
      metaConfirmationLeaseExpiresAt: null,
      metaConfirmationNextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(menaOrders.metaConfirmationStatus, "processing"),
        lt(menaOrders.metaConfirmationLeaseExpiresAt, now),
        sql`${menaOrders.metaConfirmationAttempts} >= ${maxAttempts}`,
      ),
    );

  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(menaOrders)
      .where(
        or(
          and(
            eq(menaOrders.metaConfirmationStatus, "queued"),
            lte(menaOrders.metaConfirmationNextRunAt, now),
          ),
          and(
            eq(menaOrders.metaConfirmationStatus, "processing"),
            lt(menaOrders.metaConfirmationLeaseExpiresAt, now),
            sql`${menaOrders.metaConfirmationAttempts} < ${maxAttempts}`,
          ),
        ),
      )
      .orderBy(asc(menaOrders.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await transaction
      .update(menaOrders)
      .set({
        metaConfirmationStatus: "processing",
        metaConfirmationAttempts: sql`${menaOrders.metaConfirmationAttempts} + 1`,
        metaConfirmationLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        metaConfirmationNextRunAt: now,
        metaConfirmationError: null,
        updatedAt: now,
      })
      .where(eq(menaOrders.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function processOrder(order: typeof menaOrders.$inferSelect) {
  const [[source], [connection], items] = await Promise.all([
    db
      .select()
      .from(menaMetaInboxItems)
      .where(
        and(
          eq(menaMetaInboxItems.id, order.sourceMetaInboxItemId ?? ""),
          eq(menaMetaInboxItems.workspaceId, order.workspaceId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, order.workspaceId))
      .limit(1),
    db
      .select()
      .from(menaOrderItems)
      .where(
        and(
          eq(menaOrderItems.workspaceId, order.workspaceId),
          eq(menaOrderItems.orderId, order.id),
        ),
      )
      .orderBy(asc(menaOrderItems.createdAt)),
  ]);
  if (order.status === "cancelled") {
    await updateConfirmation(order.id, order.workspaceId, "failed", {
      error: "ORDER_CANCELLED_BEFORE_CONFIRMATION_MESSAGE",
    });
    return;
  }
  if (
    !source ||
    source.kind !== "message" ||
    source.platform !== order.sourcePlatform ||
    source.conversationId !== order.sourceConversationId
  ) {
    await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
      error: "META_SOURCE_UNAVAILABLE",
    });
    return;
  }
  const [latestInboundMessage] = await db
    .select({ occurredAt: menaMetaInboxItems.occurredAt })
    .from(menaMetaInboxItems)
    .where(
      and(
        eq(menaMetaInboxItems.workspaceId, order.workspaceId),
        eq(menaMetaInboxItems.platform, source.platform),
        eq(menaMetaInboxItems.conversationId, source.conversationId),
        eq(menaMetaInboxItems.kind, "message"),
      ),
    )
    .orderBy(
      desc(menaMetaInboxItems.occurredAt),
      desc(menaMetaInboxItems.createdAt),
    )
    .limit(1);
  if (
    Date.now() -
      (latestInboundMessage?.occurredAt ?? source.occurredAt).getTime() >
    messageReplyWindowMs
  ) {
    await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
      error: "META_MESSAGE_WINDOW_EXPIRED",
    });
    return;
  }
  if (!connection || !order.sourcePlatform || !order.sourceConversationId) {
    await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
      error: "META_CONNECTION_UNAVAILABLE",
    });
    return;
  }
  const requiredPermission =
    order.sourcePlatform === "facebook"
      ? "pages_messaging"
      : "instagram_manage_messages";
  if (
    !connection.authorizationVerifiedAt ||
    !connection.grantedPermissions.includes(requiredPermission)
  ) {
    await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
      error: "META_PERMISSION_REQUIRED",
    });
    return;
  }
  if (
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt <= new Date()
  ) {
    await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
      error: "META_TOKEN_EXPIRED",
    });
    return;
  }

  let externalSendStarted = false;
  let externalSendSucceeded = false;
  try {
    const token = await metaPageAccessToken(
      connection.encryptedPageAccessToken,
    );
    if (token.rotatedCiphertext) {
      await db
        .update(menaMetaConnections)
        .set({ encryptedPageAccessToken: token.rotatedCiphertext })
        .where(
          and(
            eq(menaMetaConnections.workspaceId, order.workspaceId),
            eq(
              menaMetaConnections.encryptedPageAccessToken,
              connection.encryptedPageAccessToken,
            ),
          ),
        );
    }
    const [sending] = await db
      .update(menaOrders)
      .set({
        metaConfirmationStatus: "sending",
        metaConfirmationLeaseExpiresAt: new Date(Date.now() + leaseMs),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(menaOrders.id, order.id),
          eq(menaOrders.metaConfirmationStatus, "processing"),
        ),
      )
      .returning({ id: menaOrders.id });
    if (!sending) return;

    externalSendStarted = true;
    await sendMetaInboxReply({
      platform: order.sourcePlatform,
      kind: "message",
      pageId: connection.pageId,
      instagramUserId: connection.instagramUserId,
      recipientId: source.conversationId,
      externalId: source.externalId,
      accessToken: token.accessToken,
      text: formatMetaOrderConfirmationMessage({
        orderNumber: order.orderNumber,
        items: items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
        })),
        total: order.total,
        currency: order.currency,
        deliveryFee: order.deliveryFee,
        notes: order.notes,
      }),
    });
    externalSendSucceeded = true;
    await updateConfirmation(order.id, order.workspaceId, "sent", {
      sentAt: new Date(),
    });
  } catch (error) {
    if (error instanceof MetaInboxGraphError && error.code === 190) {
      await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
        error: "META_TOKEN_EXPIRED",
      });
      return;
    }
    if (
      error instanceof MetaInboxGraphError &&
      (error.networkFailure ||
        (error.status !== undefined && error.status >= 500) ||
        error.status === 200 ||
        externalSendSucceeded)
    ) {
      await updateConfirmation(order.id, order.workspaceId, "unknown", {
        error: "META_SEND_RESULT_UNKNOWN",
      });
      return;
    }
    if (
      error instanceof MetaInboxGraphError &&
      error.status === 429 &&
      !externalSendSucceeded &&
      order.metaConfirmationAttempts < maxAttempts
    ) {
      const delayMs = order.metaConfirmationAttempts === 1 ? 10_000 : 30_000;
      await updateConfirmation(order.id, order.workspaceId, "queued", {
        error: "META_RATE_LIMITED",
        nextRunAt: new Date(Date.now() + delayMs),
      });
      return;
    }
    if (
      error instanceof MetaInboxGraphError &&
      (error.code === 10 || error.code === 200)
    ) {
      await updateConfirmation(order.id, order.workspaceId, "manual_followup", {
        error: "META_PERMISSION_REQUIRED",
      });
      return;
    }
    if (externalSendStarted && !(error instanceof MetaInboxGraphError)) {
      await updateConfirmation(order.id, order.workspaceId, "unknown", {
        error: "META_SEND_RESULT_UNKNOWN",
      });
      return;
    }
    logger.error(
      {
        err: error,
        workspaceId: order.workspaceId,
        orderId: order.id,
      },
      "Meta order confirmation failed before sending",
    );
    await updateConfirmation(order.id, order.workspaceId, "failed", {
      error:
        error instanceof MetaInboxGraphError && error.status === 429
          ? "META_RATE_LIMIT_RETRIES_EXHAUSTED"
          : "META_CONFIRMATION_SEND_FAILED",
    });
  }
}

export async function processMetaOrderConfirmationsQueue(
  limit = 5,
): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (let count = 0; count < limit; count += 1) {
      const order = await claimNextOrder();
      if (!order) break;
      try {
        await processOrder(order);
      } catch (error) {
        logger.error(
          { err: error, workspaceId: order.workspaceId, orderId: order.id },
          "Meta order confirmation queue processing failed",
        );
      }
    }
  } finally {
    processing = false;
  }
}
