import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, lte, or, sql } from "drizzle-orm";
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
  encryptWhatsAppDirectMessageValue,
  normalizeWhatsAppDirectMessageText,
  whatsappDirectConversationKeys,
  whatsappDirectMessageExpiry,
} from "./whatsapp-direct-messages";

const confirmationLeaseMs = 60_000;

async function claimNextWhatsAppOrderConfirmation() {
  const now = new Date();
  await db
    .update(menaOrders)
    .set({
      whatsappConfirmationStatus: "unknown",
      whatsappConfirmationError: "ORDER_CONFIRMATION_RESULT_UNKNOWN",
      whatsappConfirmationLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(menaOrders.whatsappConfirmationStatus, "sending"),
        lt(menaOrders.whatsappConfirmationLeaseExpiresAt, now),
      ),
    );

  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(menaOrders)
      .where(
        or(
          and(
            eq(menaOrders.whatsappConfirmationStatus, "queued"),
            lte(menaOrders.whatsappConfirmationNextRunAt, now),
          ),
          and(
            eq(menaOrders.whatsappConfirmationStatus, "processing"),
            lt(menaOrders.whatsappConfirmationLeaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(menaOrders.whatsappConfirmationNextRunAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    if (candidate.whatsappConfirmationAttempts >= 3) {
      await transaction
        .update(menaOrders)
        .set({
          whatsappConfirmationStatus: "manual_followup",
          whatsappConfirmationError: "ORDER_CONFIRMATION_RETRY_LIMIT_REACHED",
          whatsappConfirmationLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(menaOrders.id, candidate.id));
      return null;
    }
    const [claimed] = await transaction
      .update(menaOrders)
      .set({
        whatsappConfirmationStatus: "processing",
        whatsappConfirmationAttempts: sql`${menaOrders.whatsappConfirmationAttempts} + 1`,
        whatsappConfirmationLeaseExpiresAt: new Date(
          now.getTime() + confirmationLeaseMs,
        ),
        updatedAt: now,
      })
      .where(eq(menaOrders.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

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
        Date.now() + confirmationLeaseMs,
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
    sendStarted = true;
    const providerMessageId = await sendWhatsAppAutoReply(
      order.sourceWhatsAppInstanceName,
      remoteJid,
      text,
    );
    const sentAt = new Date();
    const conversationKey = whatsappDirectConversationKeys(
      order.workspaceId,
      order.sourceWhatsAppInstanceName,
      remoteJid,
    )[0]!;
    await db
      .insert(menaWhatsAppDirectMessages)
      .values({
        id: randomUUID(),
        ownerId: order.ownerId,
        workspaceId: order.workspaceId,
        instanceName: order.sourceWhatsAppInstanceName,
        remoteJidHash: conversationKey,
        encryptedRemoteJid: encryptWhatsAppDirectMessageValue(
          remoteJid,
        ),
        providerMessageId,
        clientRequestId: `order-confirmation-${order.id}`,
        direction: "outbound",
        status: "sent",
        encryptedTextBody: encryptWhatsAppDirectMessageValue(
          normalizeWhatsAppDirectMessageText(text),
        ),
        messageTimestamp: sentAt,
        expiresAt: whatsappDirectMessageExpiry(sentAt),
      })
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
}

export async function processWhatsAppOrderConfirmationsQueue(
  limit = 5,
): Promise<number> {
  let processed = 0;
  for (let count = 0; count < limit; count += 1) {
    const order = await claimNextWhatsAppOrderConfirmation();
    if (!order) break;
    await processWhatsAppOrderConfirmation(order);
    processed += 1;
  }
  return processed;
}