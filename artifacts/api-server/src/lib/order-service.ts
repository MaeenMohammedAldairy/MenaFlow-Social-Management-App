import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  menaMetaInboxItems,
  menaOrderEvents,
  menaOrderItems,
  menaOrders,
  products,
} from "@workspace/db";
import { calculateOrder, type CreateOrderInput } from "./order-validation";

export type CreateOrderError =
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "PRODUCT_NOT_ORDERABLE"
  | "INSUFFICIENT_STOCK"
  | "INVALID_PRODUCT_PRICE"
  | "ORDER_TOTAL_TOO_LARGE"
  | "SOURCE_NOT_FOUND";

export async function createWorkspaceOrder(
  input: CreateOrderInput,
  ownerId: string,
  workspaceId: string,
) {
  return db.transaction(async (transaction) => {
    const [existingOrder] = await transaction
      .select()
      .from(menaOrders)
      .where(
        and(
          eq(menaOrders.workspaceId, workspaceId),
          eq(menaOrders.clientRequestId, input.clientRequestId),
        ),
      )
      .limit(1);
    if (existingOrder) {
      const [existingItems, existingEvents] = await Promise.all([
        transaction
          .select()
          .from(menaOrderItems)
          .where(
            and(
              eq(menaOrderItems.workspaceId, workspaceId),
              eq(menaOrderItems.orderId, existingOrder.id),
            ),
          )
          .orderBy(menaOrderItems.createdAt),
        transaction
          .select()
          .from(menaOrderEvents)
          .where(
            and(
              eq(menaOrderEvents.workspaceId, workspaceId),
              eq(menaOrderEvents.orderId, existingOrder.id),
            ),
          )
          .orderBy(menaOrderEvents.createdAt),
      ]);
      return {
        order: existingOrder,
        items: existingItems,
        events: existingEvents,
      };
    }

    const productIds = input.items.map((item) => item.productId);
    const selectedProducts = await transaction
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        price: products.price,
        currency: products.currency,
        availability: products.availability,
        status: products.status,
        verifiedAt: products.verifiedAt,
        inventoryTracked: products.inventoryTracked,
        stockOnHand: products.stockOnHand,
        stockReserved: products.stockReserved,
      })
      .from(products)
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          inArray(products.id, productIds),
        ),
      );
    if (selectedProducts.length !== productIds.length) {
      return { error: "PRODUCT_NOT_FOUND" as const };
    }

    const calculation = calculateOrder(input.items, selectedProducts);
    if ("error" in calculation) return calculation;

    let source: {
      id: string;
      platform: "facebook" | "instagram";
      conversationId: string;
    } | null = null;
    if (input.sourceMetaInboxItemId) {
      const [inboxItem] = await transaction
        .select({
          id: menaMetaInboxItems.id,
          platform: menaMetaInboxItems.platform,
          conversationId: menaMetaInboxItems.conversationId,
        })
        .from(menaMetaInboxItems)
        .where(
          and(
            eq(menaMetaInboxItems.id, input.sourceMetaInboxItemId),
            eq(menaMetaInboxItems.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!inboxItem) return { error: "SOURCE_NOT_FOUND" as const };
      source = inboxItem;
    }

    const now = new Date();
    const id = randomUUID();
    const orderNumber = `MF-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${id.slice(0, 10).toUpperCase()}`;
    const [order] = await transaction
      .insert(menaOrders)
      .values({
        id,
        orderNumber,
        ownerId,
        clientRequestId: input.clientRequestId,
        workspaceId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: input.deliveryAddress,
        notes: input.notes,
        sourceMetaInboxItemId: source?.id ?? null,
        sourcePlatform: source?.platform ?? null,
        sourceConversationId: source?.conversationId ?? null,
        status: "draft",
        currency: calculation.order.currency,
        total: calculation.order.total,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [menaOrders.workspaceId, menaOrders.clientRequestId],
      })
      .returning();
    if (!order) {
      const [idempotentOrder] = await transaction
        .select()
        .from(menaOrders)
        .where(
          and(
            eq(menaOrders.workspaceId, workspaceId),
            eq(menaOrders.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (!idempotentOrder) {
        throw new Error("ORDER_IDEMPOTENCY_CONFLICT_WITHOUT_ORDER");
      }
      const [idempotentItems, idempotentEvents] = await Promise.all([
        transaction
          .select()
          .from(menaOrderItems)
          .where(
            and(
              eq(menaOrderItems.workspaceId, workspaceId),
              eq(menaOrderItems.orderId, idempotentOrder.id),
            ),
          )
          .orderBy(menaOrderItems.createdAt),
        transaction
          .select()
          .from(menaOrderEvents)
          .where(
            and(
              eq(menaOrderEvents.workspaceId, workspaceId),
              eq(menaOrderEvents.orderId, idempotentOrder.id),
            ),
          )
          .orderBy(menaOrderEvents.createdAt),
      ]);
      return {
        order: idempotentOrder,
        items: idempotentItems,
        events: idempotentEvents,
      };
    }

    const createdItems = await transaction
      .insert(menaOrderItems)
      .values(
        calculation.order.items.map((item) => ({
          ...item,
          id: randomUUID(),
          workspaceId,
          orderId: id,
        })),
      )
      .returning();
    const [event] = await transaction
      .insert(menaOrderEvents)
      .values({
        id: randomUUID(),
        workspaceId,
        orderId: id,
        actorId: ownerId,
        fromStatus: null,
        toStatus: "draft",
        createdAt: now,
      })
      .returning();
    return { order, items: createdItems, events: [event] };
  });
}
