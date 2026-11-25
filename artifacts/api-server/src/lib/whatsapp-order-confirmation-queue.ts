import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  menaOrderItems,
  menaOrders,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessages,
} from "@workspace/db";
import { formatMetaOrderConfirmationMessage } from "./meta-order-messages";
import { sendWhatsAppAutoReply } from "./whatsapp-auto-reply";
import {
  decryptWhatsAppDirectMessageValue,
  outboundWhatsAppDirectMessageValues,
} from "./whatsapp-direct-messages";
import {
  runOrderConfirmationQueue,
  type OrderConfirmationQueue,
} from "./order-confirmation-queue";
import { WHATSAPP_CONFIRMATION_LEASE_MS } from "./order-confirmation-policy";
import {
  isWhatsAppCustomerOptedOut,
  withWhatsAppAutomationConsent,
} from "./whatsapp-opt-out";
import {
  whatsAppOptOutLock,
  whatsAppOptOutStore,
} from "./whatsapp-opt-out-store";

/**
 * The WhatsApp family's share of the confirmation state machine: which columns,
 * how long a lease runs, which write ends an exhausted row (the merchant is
 * asked to follow up — the number is known and the customer is reachable),
 * due order (`next_run_at`, which this queue never defers, so it is the queue
 * order), and the one sweep before each claim. The statements themselves are
 * `order-confirmation-queue.ts`; what follows is the send.
 */
const whatsappOrderConfirmationQueue: OrderConfirmationQueue = {
  columns: {
    status: menaOrders.whatsappConfirmationStatus,
    attempts: menaOrders.whatsappConfirmationAttempts,
    leaseExpiresAt: menaOrders.whatsappConfirmationLeaseExpiresAt,
    nextRunAt: menaOrders.whatsappConfirmationNextRunAt,
  },
  patches: {
    sweep: (to, error) => ({
      whatsappConfirmationStatus: to,
      whatsappConfirmationError: error,
      whatsappConfirmationLeaseExpiresAt: null,
    }),
    exhausted: (now) => ({
      whatsappConfirmationStatus: "manual_followup",
      whatsappConfirmationError: "ORDER_CONFIRMATION_RETRY_LIMIT_REACHED",
      whatsappConfirmationLeaseExpiresAt: null,
      updatedAt: now,
    }),
    claim: (leaseExpiresAt, now) => ({
      whatsappConfirmationStatus: "processing",
      whatsappConfirmationAttempts: sql`${menaOrders.whatsappConfirmationAttempts} + 1`,
      whatsappConfirmationLeaseExpiresAt: leaseExpiresAt,
      updatedAt: now,
    }),
  },
  leaseMs: WHATSAPP_CONFIRMATION_LEASE_MS,
  orderBy: asc(menaOrders.whatsappConfirmationNextRunAt),
  // A worker that died while sending: the Evolution API may have delivered, so
  // the row is ended as unknown rather than retried (a retry could confirm twice).
  staleSweeps: [
    { from: "sending", to: "unknown", error: "ORDER_CONFIRMATION_RESULT_UNKNOWN" },
  ],
  process: processWhatsAppOrderConfirmation,
};

async function markConfirmation(
  orderId: string,
  workspaceId: string,
  input: {
    status: "sent" | "failed" | "unknown" | "manual_followup";
    error?: string | null;
    sentAt?: Date | null;
  },
): Promise<void> {
  await db
    .update(menaOrders)
    .set({
      whatsappConfirmationStatus: input.status,
      whatsappConfirmationError: input.error ?? null,
      whatsappConfirmationSentAt: input.sentAt ?? null,
      whatsappConfirmationLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(menaOrders.id, orderId), eq(menaOrders.workspaceId, workspaceId)),
    );
}

async function processWhatsAppOrderConfirmation(
  order: typeof menaOrders.$inferSelect,
): Promise<void> {
  if (
    order.sourcePlatform !== "whatsapp" ||
    !order.sourceWhatsAppInstanceName ||
    !order.sourceConversationId
  ) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "WHATSAPP_SOURCE_UNAVAILABLE",
    });
    return;
  }
  if (order.status === "cancelled") {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "ORDER_CANCELLED_BEFORE_CONFIRMATION",
    });
    return;
  }
  if (order.status !== "confirmed") {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "ORDER_NOT_CONFIRMED_AT_SEND",
    });
    return;
  }
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.workspaceId, order.workspaceId),
        eq(
          menaWhatsAppConnections.instanceName,
          order.sourceWhatsAppInstanceName,
        ),
      ),
    )
    .limit(1);
  if (!connection) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "WHATSAPP_CONNECTION_NOT_FOUND",
    });
    return;
  }
  const items = await db
    .select({ productName: menaOrderItems.productName, quantity: menaOrderItems.quantity })
    .from(menaOrderItems)
    .where(
      and(
        eq(menaOrderItems.workspaceId, order.workspaceId),
        eq(menaOrderItems.orderId, order.id),
      ),
    )
    .orderBy(asc(menaOrderItems.createdAt));
  if (items.length === 0) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "ORDER_ITEMS_NOT_FOUND",
    });
    return;
  }
  const [sourceMessage] = await db
    .select({ encryptedRemoteJid: menaWhatsAppDirectMessages.encryptedRemoteJid })
    .from(menaWhatsAppDirectMessages)
    .where(
      and(
        eq(menaWhatsAppDirectMessages.workspaceId, order.workspaceId),
        eq(
          menaWhatsAppDirectMessages.instanceName,
          order.sourceWhatsAppInstanceName,
        ),
        eq(
          menaWhatsAppDirectMessages.remoteJidHash,
          order.sourceConversationId,
        ),
        gt(menaWhatsAppDirectMessages.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(menaWhatsAppDirectMessages.messageTimestamp))
    .limit(1);
  if (!sourceMessage) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "WHATSAPP_SOURCE_EXPIRED",
    });
    return;
  }
  const remoteJid = decryptWhatsAppDirectMessageValue(
    sourceMessage.encryptedRemoteJid,
  );
  const [sending] = await db
    .update(menaOrders)
    .set({
      whatsappConfirmationStatus: "sending",
      whatsappConfirmationLeaseExpiresAt: new Date(
        Date.now() + WHATSAPP_CONFIRMATION_LEASE_MS,
      ),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(menaOrders.id, order.id),
        eq(menaOrders.workspaceId, order.workspaceId),
        eq(menaOrders.status, "confirmed"),
        eq(menaOrders.whatsappConfirmationStatus, "processing"),
      ),
    )
    .returning({ id: menaOrders.id });
  if (!sending) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "ORDER_STATUS_CHANGED_BEFORE_SEND",
    });
    return;
  }

  const customerId = order.sourceConversationId;
  const instanceName = order.sourceWhatsAppInstanceName;
  if (!customerId || !instanceName) {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "WHATSAPP_CONVERSATION_ID_MISSING",
    });
    return;
  }
  const consentGate = await withWhatsAppAutomationConsent({
    store: whatsAppOptOutStore,
    lock: whatsAppOptOutLock,
    workspaceId: order.workspaceId,
    customerId,
    run: async () => {
      let sendStarted = false;
      try {
        const text = formatMetaOrderConfirmationMessage({
          orderNumber: order.orderNumber,
          items,
          total: order.total,
          currency: order.currency,
          deliveryFee: order.deliveryFee,
          notes: order.notes,
        });
      if (
        await isWhatsAppCustomerOptedOut({
          store: whatsAppOptOutStore,
          workspaceId: order.workspaceId,
          customerId,
        })
      ) {
        await markConfirmation(order.id, order.workspaceId, {
          status: "manual_followup",
          error: "CUSTOMER_OPTED_OUT",
        });
        return;
      }
      sendStarted = true;
      const providerMessageId = await sendWhatsAppAutoReply(
        instanceName,
        remoteJid,
        text,
      );
      const sentAt = new Date();
      await db
        .insert(menaWhatsAppDirectMessages)
        .values(
          outboundWhatsAppDirectMessageValues({
            ownerId: order.ownerId,
            workspaceId: order.workspaceId,
            instanceName,
            remoteJid,
            text,
            status: "sent",
            messageTimestamp: sentAt,
            providerMessageId,
            // The idempotency key: a retried confirmation for the same order
            // lands on the same row instead of a second message.
            clientRequestId: `order-confirmation-${order.id}`,
          }),
        )
        .onConflictDoNothing();
      await markConfirmation(order.id, order.workspaceId, {
        status: "sent",
        sentAt,
      });
      } catch (error) {
        await markConfirmation(order.id, order.workspaceId, {
          status: sendStarted ? "unknown" : "manual_followup",
          error: sendStarted
            ? "ORDER_CONFIRMATION_RESULT_UNKNOWN"
            : error instanceof Error
              ? error.message.slice(0, 80)
              : "WHATSAPP_ORDER_CONFIRMATION_FAILED",
        });
      }
    },
  });
  if (consentGate.status === "opted_out") {
    await markConfirmation(order.id, order.workspaceId, {
      status: "manual_followup",
      error: "CUSTOMER_OPTED_OUT",
    });
  }
}

export async function processWhatsAppOrderConfirmationsQueue(
  limit = 5,
): Promise<number> {
  // No `onError`: a throw here is a database or decrypt failure, not a bad
  // order, so the batch stops and the worker loop reports it on the next tick.
  return runOrderConfirmationQueue(whatsappOrderConfirmationQueue, { limit });
}