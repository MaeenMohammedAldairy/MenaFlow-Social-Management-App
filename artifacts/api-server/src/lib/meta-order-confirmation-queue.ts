import { and, asc, desc, eq, sql } from "drizzle-orm";
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
import {
  runOrderConfirmationQueue,
  type OrderConfirmationQueue,
} from "./order-confirmation-queue";
import {
  META_CONFIRMATION_LEASE_MS,
  ORDER_CONFIRMATION_MAX_ATTEMPTS,
} from "./order-confirmation-policy";

const messageReplyWindowMs = 24 * 60 * 60 * 1000;
let processing = false;

/**
 * The Meta family's share of the confirmation state machine. Unlike the
 * WhatsApp queue, an exhausted row is recorded as `failed` (the Graph API said
 * why, and the merchant's inbox has the conversation), due rows are taken in
 * creation order because `next_run_at` here is a rate-limit backoff rather than
 * a schedule, and two sweeps run before each claim. The statements themselves
 * are `order-confirmation-queue.ts`.
 */
const metaOrderConfirmationQueue: OrderConfirmationQueue = {
  columns: {
    status: menaOrders.metaConfirmationStatus,
    attempts: menaOrders.metaConfirmationAttempts,
    leaseExpiresAt: menaOrders.metaConfirmationLeaseExpiresAt,
    nextRunAt: menaOrders.metaConfirmationNextRunAt,
  },
  patches: {
    sweep: (to, error, now) => ({
      metaConfirmationStatus: to,
      metaConfirmationError: error,
      metaConfirmationLeaseExpiresAt: null,
      metaConfirmationNextRunAt: now,
      updatedAt: now,
    }),
    exhausted: (now) => ({
      metaConfirmationStatus: "failed",
      metaConfirmationError: "META_CONFIRMATION_RETRY_LIMIT_REACHED",
      metaConfirmationLeaseExpiresAt: null,
      updatedAt: now,
    }),
    claim: (leaseExpiresAt, now) => ({
      metaConfirmationStatus: "processing",
      metaConfirmationAttempts: sql`${menaOrders.metaConfirmationAttempts} + 1`,
      metaConfirmationLeaseExpiresAt: leaseExpiresAt,
      metaConfirmationNextRunAt: now,
      metaConfirmationError: null,
      updatedAt: now,
    }),
  },
  leaseMs: META_CONFIRMATION_LEASE_MS,
  orderBy: asc(menaOrders.createdAt),
  staleSweeps: [
    { from: "sending", to: "unknown", error: "META_SEND_RESULT_UNKNOWN" },
    {
      from: "processing",
      to: "failed",
      error: "META_CONFIRMATION_RETRY_LIMIT_REACHED",
      exhaustedOnly: true,
    },
  ],
  process: processOrder,
};

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
        metaConfirmationLeaseExpiresAt: new Date(
          Date.now() + META_CONFIRMATION_LEASE_MS,
        ),
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
      order.metaConfirmationAttempts < ORDER_CONFIRMATION_MAX_ATTEMPTS
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
    // One failing order does not hold up the rest: the failure is logged with
    // its order and the loop claims the next one.
    await runOrderConfirmationQueue(metaOrderConfirmationQueue, {
      limit,
      onError: (error, order) => {
        logger.error(
          { err: error, workspaceId: order.workspaceId, orderId: order.id },
          "Meta order confirmation queue processing failed",
        );
      },
    });
  } finally {
    processing = false;
  }
}
