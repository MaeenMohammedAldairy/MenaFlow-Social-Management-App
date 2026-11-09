import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaInboxItems,
  menaOrderEvents,
  menaOrderItems,
  menaOrders,
  products,
  type MenaOrder,
  type MenaOrderEvent,
  type MenaOrderItem,
  type OrderStatus,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  calculateOrder,
  canTransitionOrderStatus,
  parseCreateOrderInput,
  parseOrderStatus,
} from "../lib/order-validation";

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
    status: order.status,
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
  const [items, events] = orderIds.length
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
      ])
    : [[], []];
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
  res.json({
    orders: orders.map((order) =>
      orderResponse(
        order,
        itemsByOrder.get(order.id) ?? [],
        eventsByOrder.get(order.id) ?? [],
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

  const created = await db.transaction(async (transaction) => {
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

  if ("error" in created) {
    const responseByError: Record<
      | "PRODUCT_NOT_FOUND"
      | "PRODUCT_UNAVAILABLE"
      | "PRODUCT_NOT_ORDERABLE"
      | "INVALID_PRODUCT_PRICE"
      | "ORDER_TOTAL_TOO_LARGE"
      | "SOURCE_NOT_FOUND",
      readonly [number, string]
    > = {
      PRODUCT_NOT_FOUND: [
        404,
        "لم يتم العثور على أحد المنتجات في مساحة العمل.",
      ],
      PRODUCT_UNAVAILABLE: [409, "لا يمكن إضافة منتج غير مفعّل إلى الطلب."],
      PRODUCT_NOT_ORDERABLE: [
        409,
        "أحد المنتجات غير متاح للبيع أو لا يملك سعرًا معتمدًا.",
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
      const now = new Date();
      const [updated] = await transaction
        .update(menaOrders)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(menaOrders.id, orderId),
            eq(menaOrders.workspaceId, workspaceId),
            eq(menaOrders.status, current.status),
          ),
        )
        .returning();
      if (!updated) return { error: "CONCURRENT_CHANGE" as const };
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
      const [items, events] = await Promise.all([
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
      ]);
      return { order: updated, items, events };
    });

    if ("error" in result) {
      const errors: Record<
        "NOT_FOUND" | "INVALID_TRANSITION" | "CONCURRENT_CHANGE",
        readonly [number, string]
      > = {
        NOT_FOUND: [404, "لم يتم العثور على الطلب."],
        INVALID_TRANSITION: [409, "لا يمكن نقل الطلب إلى الحالة المطلوبة."],
        CONCURRENT_CHANGE: [
          409,
          "تغيرت حالة الطلب بالتزامن؛ حدّث القائمة ثم أعد المحاولة.",
        ],
      } as const;
      const response = result.error ? errors[result.error] : undefined;
      if (!response) throw new Error("ORDER_STATUS_UPDATE_FAILED");
      const [statusCode, error] = response;
      res.status(statusCode).json({ error });
      return;
    }
    res.json({
      order: orderResponse(result.order, result.items, result.events),
    });
  },
);

export default router;
