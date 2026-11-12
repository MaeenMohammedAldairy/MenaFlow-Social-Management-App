import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaInboxItems,
  menaInventoryMovements,
  menaOrderDeliveryEvents,
  menaOrderEvents,
  menaOrderItems,
  menaOrders,
  products,
  type MenaOrder,
  type MenaOrderEvent,
  type MenaOrderItem,
  type OrderStatus,
  type DeliveryStatus,
  type CollectionStatus,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  calculateOrder,
  canTransitionDeliveryStatus,
  canTransitionOrderStatus,
  parseDeliveryUpdate,
  parseCreateOrderInput,
  parseOrderStatus,
} from "../lib/order-validation";
import {
  createWorkspaceOrder,
  type CreateOrderError,
} from "../lib/order-service";

const router = Router();
const orderPageSize = 50;

function parseOrderCursor(
  value: string,
): { createdAt: Date; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("createdAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length > 200
    ) {
      return null;
    }
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeOrderCursor(order: MenaOrder): string {
  return Buffer.from(
    JSON.stringify({ createdAt: order.createdAt.toISOString(), id: order.id }),
  ).toString("base64url");
}

function orderResponse(
  order: MenaOrder,
  items: MenaOrderItem[] = [],
  events: MenaOrderEvent[] = [],
  deliveryEvents: Array<{
    id: string;
    toStatus: DeliveryStatus;
    createdAt: Date;
  }> = [],
) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    notes: order.notes,
    sourceMetaInboxItemId: order.sourceMetaInboxItemId,
    sourcePlatform: order.sourcePlatform,
    sourceConversationId: order.sourceConversationId,
    metaConfirmationStatus: order.metaConfirmationStatus,
    metaConfirmationError: order.metaConfirmationError,
    metaConfirmationSentAt: order.metaConfirmationSentAt,
    status: order.status,
    deliveryStatus: order.deliveryStatus,
    deliveryProvider: order.deliveryProvider,
    trackingNumber: order.trackingNumber,
    deliveryFee: order.deliveryFee,
    collectionStatus: order.collectionStatus,
    collectedAmount: order.collectedAmount,
    deliveredAt: order.deliveredAt,
    currency: order.currency,
    total: order.total,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    events: events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      createdAt: event.createdAt,
    })),
    deliveryEvents: deliveryEvents.map((event) => ({
      id: event.id,
      toStatus: event.toStatus,
      createdAt: event.createdAt,
    })),
  };
}

router.get("/social/orders/summary", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const [summary] = await db
    .select({
      total: sql<number>`count(*)::int`,
      draft: sql<number>`count(*) filter (where ${menaOrders.status} = 'draft')::int`,
      confirmed: sql<number>`count(*) filter (where ${menaOrders.status} = 'confirmed')::int`,
      preparing: sql<number>`count(*) filter (where ${menaOrders.status} = 'preparing')::int`,
      shipped: sql<number>`count(*) filter (where ${menaOrders.status} = 'shipped')::int`,
      completed: sql<number>`count(*) filter (where ${menaOrders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${menaOrders.status} = 'cancelled')::int`,
      metaDrafts: sql<number>`count(*) filter (where ${menaOrders.status} = 'draft' and ${menaOrders.sourcePlatform} is not null)::int`,
    })
    .from(menaOrders)
    .where(eq(menaOrders.workspaceId, workspaceId));
  res.json(summary);
});

router.get("/social/orders", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const statusValue = req.query.status;
  const cursorValue =
    typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const status =
    statusValue === undefined || statusValue === "all"
      ? null
      : parseOrderStatus(statusValue);
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (
    (statusValue !== undefined && statusValue !== "all" && !status) ||
    (typeof req.query.search !== "undefined" &&
      typeof req.query.search !== "string") ||
    (typeof req.query.cursor !== "undefined" &&
      (typeof req.query.cursor !== "string" ||
        req.query.cursor.length > 1000)) ||
    search.length > 100
  ) {
    res.status(400).json({ error: "مرشحات الطلبات غير صالحة." });
    return;
  }

  const conditions = [eq(menaOrders.workspaceId, workspaceId)];
  if (status) conditions.push(eq(menaOrders.status, status));
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const searchCondition = or(
      ilike(menaOrders.orderNumber, pattern),
      ilike(menaOrders.customerName, pattern),
      ilike(menaOrders.customerPhone, pattern),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (cursorValue) {
    const cursor = parseOrderCursor(cursorValue);
    if (!cursor) {
      res.status(400).json({ error: "مؤشر صفحة الطلبات غير صالح." });
      return;
    }
    const cursorCondition = or(
      lt(menaOrders.createdAt, cursor.createdAt),
      and(
        eq(menaOrders.createdAt, cursor.createdAt),
        lt(menaOrders.id, cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }
  const rows = await db
    .select()
    .from(menaOrders)
    .where(and(...conditions))
    .orderBy(desc(menaOrders.createdAt), desc(menaOrders.id))
    .limit(orderPageSize + 1);
  const hasMore = rows.length > orderPageSize;
  const orders = rows.slice(0, orderPageSize);
  const orderIds = orders.map((order) => order.id);
  const [items, events, deliveryEvents] = orderIds.length
    ? await Promise.all([
        db
          .select()
          .from(menaOrderItems)
          .where(
            and(
              eq(menaOrderItems.workspaceId, workspaceId),
              inArray(menaOrderItems.orderId, orderIds),
            ),
          )
          .orderBy(menaOrderItems.createdAt),
        db
          .select()
          .from(menaOrderEvents)
          .where(
            and(
              eq(menaOrderEvents.workspaceId, workspaceId),
              inArray(menaOrderEvents.orderId, orderIds),
            ),
          )
          .orderBy(menaOrderEvents.createdAt),
        db
          .select({
            id: menaOrderDeliveryEvents.id,
            orderId: menaOrderDeliveryEvents.orderId,
            toStatus: menaOrderDeliveryEvents.toStatus,
            createdAt: menaOrderDeliveryEvents.createdAt,
          })
          .from(menaOrderDeliveryEvents)
          .where(
            and(
              eq(menaOrderDeliveryEvents.workspaceId, workspaceId),
              inArray(menaOrderDeliveryEvents.orderId, orderIds),
            ),
          )
          .orderBy(menaOrderDeliveryEvents.createdAt),
      ])
    : [[], [], []];
  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const group = itemsByOrder.get(item.orderId) ?? [];
    group.push(item);
    itemsByOrder.set(item.orderId, group);
  }
  const eventsByOrder = new Map<string, typeof events>();
  for (const event of events) {
    const group = eventsByOrder.get(event.orderId) ?? [];
    group.push(event);
    eventsByOrder.set(event.orderId, group);
  }
  const deliveryEventsByOrder = new Map<string, typeof deliveryEvents>();
  for (const event of deliveryEvents) {
    const group = deliveryEventsByOrder.get(event.orderId) ?? [];
    group.push(event);
    deliveryEventsByOrder.set(event.orderId, group);
  }
  res.json({
    orders: orders.map((order) =>
      orderResponse(
        order,
        itemsByOrder.get(order.id) ?? [],
        eventsByOrder.get(order.id) ?? [],
        deliveryEventsByOrder.get(order.id) ?? [],
      ),
    ),
    hasMore,
    nextCursor:
      hasMore && orders.length
        ? encodeOrderCursor(orders[orders.length - 1])
        : null,
  });
});

router.post("/social/orders", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const input = parseCreateOrderInput(req.body);
  if (!input) {
    res
      .status(400)
      .json({ error: "تحقق من بيانات العميل والمنتجات والكميات." });
    return;
  }

  const created = await createWorkspaceOrder(input, ownerId, workspaceId);

  if ("error" in created) {
    const responseByError: Record<CreateOrderError, readonly [number, string]> = {
      PRODUCT_NOT_FOUND: [
        404,
        "لم يتم العثور على أحد المنتجات في مساحة العمل.",
      ],
      PRODUCT_UNAVAILABLE: [409, "لا يمكن إضافة منتج غير مفعّل إلى الطلب."],
      PRODUCT_NOT_ORDERABLE: [
        409,
        "أحد المنتجات غير متاح للبيع أو لا يملك سعرًا معتمدًا.",
      ],
      INSUFFICIENT_STOCK: [
        409,
        "الكمية المطلوبة تتجاوز المخزون المتاح لأحد المنتجات.",
      ],
      INVALID_PRODUCT_PRICE: [
        409,
        "تحقق من سعر المنتج وعملته قبل إنشاء الطلب.",
      ],
      ORDER_TOTAL_TOO_LARGE: [400, "إجمالي الطلب يتجاوز الحد المسموح."],
      SOURCE_NOT_FOUND: [404, "تعذر العثور على المحادثة ضمن مساحة العمل."],
    } as const;
    const response = created.error ? responseByError[created.error] : undefined;
    if (!response) throw new Error("ORDER_CREATION_FAILED");
    const [statusCode, error] = response;
    res.status(statusCode).json({ error });
    return;
  }
  res.status(201).json({
    order: orderResponse(created.order, created.items, created.events),
  });
});

router.patch(
  "/social/orders/:id/status",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const orderId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    const status = parseOrderStatus(req.body?.status);
    if (!orderId || orderId.length > 200 || !status) {
      res.status(400).json({ error: "حالة الطلب أو معرّفه غير صالح." });
      return;
    }

    const result = await db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(menaOrders)
        .where(
          and(
            eq(menaOrders.id, orderId),
            eq(menaOrders.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!current) return { error: "NOT_FOUND" as const };
      if (!canTransitionOrderStatus(current.status, status)) {
        return { error: "INVALID_TRANSITION" as const };
      }
      const items = await transaction
        .select()
        .from(menaOrderItems)
        .where(
          and(
            eq(menaOrderItems.workspaceId, workspaceId),
            eq(menaOrderItems.orderId, orderId),
          ),
        )
        .orderBy(menaOrderItems.productId);
      const productIds = [
        ...new Set(
          items
            .map((item) => item.productId)
            .filter((id): id is string => id !== null),
        ),
      ];
      const lockedProducts = productIds.length
        ? await transaction
            .select()
            .from(products)
            .where(
              and(
                eq(products.workspaceId, workspaceId),
                inArray(products.id, productIds),
              ),
            )
            .orderBy(products.id)
            .for("update")
        : [];
      const productById = new Map(
        lockedProducts.map((product) => [product.id, product]),
      );
      const inventoryChanges: Array<{
        productId: string;
        stockDelta: number;
        reservedDelta: number;
        type: "reservation" | "release" | "shipment";
      }> = [];
      if (status === "confirmed") {
        for (const item of items) {
          if (!item.productId) continue;
          const product = productById.get(item.productId);
          if (!product) return { error: "PRODUCT_NOT_FOUND" as const };
          if (!product.inventoryTracked) continue;
          if (item.quantity > product.stockOnHand - product.stockReserved) {
            return { error: "INSUFFICIENT_STOCK" as const };
          }
          product.stockReserved += item.quantity;
          inventoryChanges.push({
            productId: item.productId,
            stockDelta: 0,
            reservedDelta: item.quantity,
            type: "reservation",
          });
        }
      } else if (status === "shipped" || status === "cancelled") {
        for (const item of items) {
          if (!item.productId) continue;
          const product = productById.get(item.productId);
          if (!product?.inventoryTracked) continue;
          if (status === "shipped") {
            if (
              current.inventoryReserved &&
              product.stockReserved < item.quantity
            ) {
              return { error: "INVENTORY_RESERVATION_MISSING" as const };
            }
            if (
              !current.inventoryReserved &&
              product.stockOnHand - product.stockReserved < item.quantity
            ) {
              return { error: "INSUFFICIENT_STOCK" as const };
            }
            product.stockOnHand -= item.quantity;
            if (current.inventoryReserved) {
              product.stockReserved -= item.quantity;
            }
            inventoryChanges.push({
              productId: item.productId,
              stockDelta: -item.quantity,
              reservedDelta: current.inventoryReserved ? -item.quantity : 0,
              type: "shipment",
            });
          } else if (
            current.inventoryReserved &&
            (current.status === "confirmed" ||
              current.status === "preparing")
          ) {
            if (product.stockReserved < item.quantity) {
              return { error: "INVENTORY_RESERVATION_MISSING" as const };
            }
            product.stockReserved -= item.quantity;
            inventoryChanges.push({
              productId: item.productId,
              stockDelta: 0,
              reservedDelta: -item.quantity,
              type: "release",
            });
          }
        }
      }
      const now = new Date();
      let confirmationUpdate: Partial<
        Pick<
          MenaOrder,
          | "metaConfirmationStatus"
          | "metaConfirmationAttempts"
          | "metaConfirmationNextRunAt"
          | "metaConfirmationLeaseExpiresAt"
          | "metaConfirmationSentAt"
          | "metaConfirmationError"
        >
      > = {};
      if (
        status === "confirmed" &&
        current.status === "draft" &&
        current.sourcePlatform
      ) {
        const [source] = current.sourceMetaInboxItemId
          ? await transaction
              .select({
                kind: menaMetaInboxItems.kind,
                platform: menaMetaInboxItems.platform,
                conversationId: menaMetaInboxItems.conversationId,
              })
              .from(menaMetaInboxItems)
              .where(
                and(
                  eq(menaMetaInboxItems.id, current.sourceMetaInboxItemId),
                  eq(menaMetaInboxItems.workspaceId, workspaceId),
                ),
              )
              .limit(1)
          : [];
        const validMessageSource =
          source?.kind === "message" &&
          source.platform === current.sourcePlatform &&
          source.conversationId === current.sourceConversationId;
        confirmationUpdate = {
          metaConfirmationStatus: validMessageSource
            ? "queued"
            : "manual_followup",
          metaConfirmationAttempts: 0,
          metaConfirmationNextRunAt: now,
          metaConfirmationLeaseExpiresAt: null,
          metaConfirmationSentAt: null,
          metaConfirmationError: validMessageSource
            ? null
            : "META_SOURCE_UNAVAILABLE",
        };
      }
      const [updated] = await transaction
        .update(menaOrders)
        .set({
          status,
          ...confirmationUpdate,
          ...(status === "confirmed"
            ? {
                inventoryReserved: inventoryChanges.some(
                  (entry) => entry.type === "reservation",
                ),
              }
            : {}),
          ...(status === "cancelled" || status === "shipped"
            ? { inventoryReserved: false }
            : {}),
          ...(status === "shipped" && current.deliveryStatus !== "delivered"
            ? { deliveryStatus: "in_transit" as const }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(menaOrders.id, orderId),
            eq(menaOrders.workspaceId, workspaceId),
            eq(menaOrders.status, current.status),
          ),
        )
        .returning();
      if (!updated) return { error: "CONCURRENT_CHANGE" as const };
      for (const product of productById.values()) {
        const changes = inventoryChanges.filter(
          (entry) => entry.productId === product.id,
        );
        if (!changes.length) continue;
        const stockDelta = changes.reduce(
          (total, entry) => total + entry.stockDelta,
          0,
        );
        const reservedDelta = changes.reduce(
          (total, entry) => total + entry.reservedDelta,
          0,
        );
        await transaction
          .update(products)
          .set({
            stockOnHand: product.stockOnHand,
            stockReserved: product.stockReserved,
            ...(product.inventoryTracked
              ? {
                  availability:
                    product.stockOnHand - product.stockReserved > 0
                      ? "in_stock" as const
                      : "out_of_stock" as const,
                }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(products.id, product.id),
              eq(products.workspaceId, workspaceId),
            ),
          );
        await transaction.insert(menaInventoryMovements).values({
          id: randomUUID(),
          workspaceId,
          productId: product.id,
          orderId,
          actorId: ownerId,
          type: changes[0].type,
          stockDelta,
          reservedDelta,
          reason:
            changes[0].type === "reservation"
              ? `حجز لطلب ${current.orderNumber}`
              : changes[0].type === "release"
                ? `تحرير حجز الطلب ${current.orderNumber}`
                : `شحن الطلب ${current.orderNumber}`,
          createdAt: now,
        });
      }
      const [event] = await transaction
        .insert(menaOrderEvents)
        .values({
          id: randomUUID(),
          workspaceId,
          orderId,
          actorId: ownerId,
          fromStatus: current.status,
          toStatus: status,
          createdAt: now,
        })
        .returning();
      const storedDeliveryStatus =
        status === "shipped" && current.deliveryStatus !== "delivered"
          ? "in_transit"
          : current.deliveryStatus;
      if (storedDeliveryStatus !== current.deliveryStatus) {
        await transaction.insert(menaOrderDeliveryEvents).values({
          id: randomUUID(),
          workspaceId,
          orderId,
          actorId: ownerId,
          fromStatus: current.deliveryStatus,
          toStatus: storedDeliveryStatus,
          createdAt: now,
        });
      }
      const [events, deliveryEvents] = await Promise.all([
        transaction
          .select()
          .from(menaOrderEvents)
          .where(
            and(
              eq(menaOrderEvents.workspaceId, workspaceId),
              eq(menaOrderEvents.orderId, orderId),
            ),
          )
          .orderBy(menaOrderEvents.createdAt),
        transaction
          .select({
            id: menaOrderDeliveryEvents.id,
            toStatus: menaOrderDeliveryEvents.toStatus,
            createdAt: menaOrderDeliveryEvents.createdAt,
          })
          .from(menaOrderDeliveryEvents)
          .where(
            and(
              eq(menaOrderDeliveryEvents.workspaceId, workspaceId),
              eq(menaOrderDeliveryEvents.orderId, orderId),
            ),
          )
          .orderBy(menaOrderDeliveryEvents.createdAt),
      ]);
      return { order: updated, items, events, deliveryEvents };
    });

    if ("error" in result && result.error) {
      const errors: Record<
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "CONCURRENT_CHANGE"
        | "PRODUCT_NOT_FOUND"
        | "INSUFFICIENT_STOCK"
        | "INVENTORY_RESERVATION_MISSING",
        readonly [number, string]
      > = {
        NOT_FOUND: [404, "لم يتم العثور على الطلب."],
        INVALID_TRANSITION: [409, "لا يمكن نقل الطلب إلى الحالة المطلوبة."],
        CONCURRENT_CHANGE: [
          409,
          "تغيرت حالة الطلب بالتزامن؛ حدّث القائمة ثم أعد المحاولة.",
        ],
        PRODUCT_NOT_FOUND: [409, "تعذر العثور على منتج مرتبط بالطلب."],
        INSUFFICIENT_STOCK: [
          409,
          "المخزون المتاح لا يكفي لتأكيد الطلب. حدّث كمية المنتج أو عدّل الطلب.",
        ],
        INVENTORY_RESERVATION_MISSING: [
          409,
          "تعذر التحقق من حجز المخزون. حدّث الطلب وتواصل مع الدعم إذا تكرر الخطأ.",
        ],
      } as const;
      const response = result.error ? errors[result.error] : undefined;
      if (!response) throw new Error("ORDER_STATUS_UPDATE_FAILED");
      const [statusCode, error] = response;
      res.status(statusCode).json({ error });
      return;
    }
    res.json({
      order: orderResponse(
        result.order,
        result.items,
        result.events,
        result.deliveryEvents,
      ),
    });
  },
);

router.patch(
  "/social/orders/:id/delivery",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const orderId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    const input = parseDeliveryUpdate(req.body);
    if (!orderId || orderId.length > 200 || !input) {
      res.status(400).json({ error: "بيانات التوصيل أو معرّف الطلب غير صالح." });
      return;
    }

    const result = await db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(menaOrders)
        .where(
          and(
            eq(menaOrders.id, orderId),
            eq(menaOrders.workspaceId, workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return { error: "NOT_FOUND" as const };
      if (current.status === "draft" || current.status === "cancelled") {
        return { error: "ORDER_NOT_DELIVERABLE" as const };
      }
      const deliveryStatus = input.deliveryStatus ?? current.deliveryStatus;
      if (
        input.deliveryStatus &&
        input.deliveryStatus !== current.deliveryStatus &&
        !canTransitionDeliveryStatus(
          current.deliveryStatus,
          input.deliveryStatus,
        )
      ) {
        return { error: "INVALID_DELIVERY_TRANSITION" as const };
      }
      if (
        deliveryStatus === "delivered" &&
        current.status !== "shipped" &&
        current.status !== "completed"
      ) {
        return { error: "ORDER_NOT_SHIPPED" as const };
      }
      const collectionStatus =
        input.collectionStatus ?? current.collectionStatus;
      const collectedAmount =
        input.collectedAmount ?? current.collectedAmount;
      if (
        collectionStatus === "remitted" &&
        current.collectionStatus === "not_collected"
      ) {
        return { error: "INVALID_COLLECTION_TRANSITION" as const };
      }
      if (
        collectionStatus !== "not_collected" &&
        Number(collectedAmount) <= 0
      ) {
        return { error: "COLLECTION_AMOUNT_REQUIRED" as const };
      }
      if (
        collectionStatus === "not_collected" &&
        Number(collectedAmount) > 0
      ) {
        return { error: "UNEXPECTED_COLLECTION_AMOUNT" as const };
      }
      const now = new Date();
      const [updated] = await transaction
        .update(menaOrders)
        .set({
          deliveryStatus,
          ...(input.deliveryProvider !== undefined
            ? { deliveryProvider: input.deliveryProvider }
            : {}),
          ...(input.trackingNumber !== undefined
            ? { trackingNumber: input.trackingNumber }
            : {}),
          ...(input.deliveryFee !== undefined
            ? { deliveryFee: input.deliveryFee }
            : {}),
          collectionStatus,
          collectedAmount,
          ...(deliveryStatus === "delivered" &&
          deliveryStatus !== current.deliveryStatus
            ? { deliveredAt: now }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(menaOrders.id, orderId),
            eq(menaOrders.workspaceId, workspaceId),
          ),
        )
        .returning();
      if (!updated) return { error: "NOT_FOUND" as const };
      if (deliveryStatus !== current.deliveryStatus) {
        await transaction.insert(menaOrderDeliveryEvents).values({
          id: randomUUID(),
          workspaceId,
          orderId,
          actorId: ownerId,
          fromStatus: current.deliveryStatus,
          toStatus: deliveryStatus,
          createdAt: now,
        });
      }
      const [items, events, deliveryEvents] = await Promise.all([
        transaction
          .select()
          .from(menaOrderItems)
          .where(
            and(
              eq(menaOrderItems.workspaceId, workspaceId),
              eq(menaOrderItems.orderId, orderId),
            ),
          )
          .orderBy(menaOrderItems.createdAt),
        transaction
          .select()
          .from(menaOrderEvents)
          .where(
            and(
              eq(menaOrderEvents.workspaceId, workspaceId),
              eq(menaOrderEvents.orderId, orderId),
            ),
          )
          .orderBy(menaOrderEvents.createdAt),
        transaction
          .select({
            id: menaOrderDeliveryEvents.id,
            toStatus: menaOrderDeliveryEvents.toStatus,
            createdAt: menaOrderDeliveryEvents.createdAt,
          })
          .from(menaOrderDeliveryEvents)
          .where(
            and(
              eq(menaOrderDeliveryEvents.workspaceId, workspaceId),
              eq(menaOrderDeliveryEvents.orderId, orderId),
            ),
          )
          .orderBy(menaOrderDeliveryEvents.createdAt),
      ]);
      return { order: updated, items, events, deliveryEvents };
    });

    if ("error" in result && result.error) {
      const errors = {
        NOT_FOUND: [404, "لم يتم العثور على الطلب."],
        INVALID_DELIVERY_TRANSITION: [
          409,
          "لا يمكن نقل الشحنة إلى الحالة المطلوبة.",
        ],
        ORDER_NOT_DELIVERABLE: [
          409,
          "أكد الطلب قبل تسجيل بيانات التوصيل.",
        ],
        ORDER_NOT_SHIPPED: [
          409,
          "حدّث حالة الطلب إلى تم الشحن قبل تسجيل التسليم.",
        ],
        COLLECTION_AMOUNT_REQUIRED: [
          400,
          "أدخل المبلغ المحصّل قبل تسجيل التحصيل أو التوريد.",
        ],
        INVALID_COLLECTION_TRANSITION: [
          409,
          "سجّل التحصيل أولاً قبل تأكيد توريد المبلغ.",
        ],
        UNEXPECTED_COLLECTION_AMOUNT: [
          400,
          "سجّل حالة التحصيل قبل حفظ المبلغ المحصّل.",
        ],
      } as const;
      const [statusCode, error] = errors[result.error];
      res.status(statusCode).json({ error });
      return;
    }
    res.json({
      order: orderResponse(
        result.order,
        result.items,
        result.events,
        result.deliveryEvents,
      ),
    });
  },
);

export default router;
