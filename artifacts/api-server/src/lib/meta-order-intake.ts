import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import {
  db,
  menaMetaInboxItems,
  menaOrderItems,
  menaMetaOrderIntakes,
  menaOrders,
  products,
} from "@workspace/db";
import { createWorkspaceOrder } from "./order-service";
import { matchMetaAutoReplyProduct } from "./meta-auto-reply";
import {
  isMetaOrderCancellation,
  isMetaOrderIntent,
  parseMetaOrderPhone,
  parseMetaOrderQuantity,
} from "./order-intake-parsing.ts";
export {
  isMetaOrderCancellation,
  isMetaOrderIntent,
  parseMetaOrderPhone,
  parseMetaOrderQuantity,
} from "./order-intake-parsing.ts";
import type { CreateOrderInput } from "./order-validation";
import {
  buildMetaOrderDataPrompt,
  formatMetaOrderDraftReply,
  isMetaOrderAffirmative,
  isMetaOrderConfirmation,
  normalizeMetaOrderDeliveryPreference,
  parseMetaOrderLabeledValue,
  type OrderIntakeField,
} from "./meta-order-messages";

function parseAwaitedValue(
  field: OrderIntakeField,
  text: string,
  productsList: Array<{
    id: string;
    name: string;
    sku: string | null;
    aliases: string[];
    description: string;
  }>,
): Partial<Record<OrderIntakeField, string | number>> {
  const normalized = text.trim();
  if (!normalized || normalized.length > 500) return {};
  switch (field) {
    case "product": {
      const product = matchMetaAutoReplyProduct(productsList, normalized);
      return product ? { product: product.id } : {};
    }
    case "quantity": {
      const quantity = parseMetaOrderQuantity(normalized, true);
      return quantity ? { quantity } : {};
    }
    case "name":
      return normalized.length <= 160 ? { name: normalized } : {};
    case "phone": {
      const phone = parseMetaOrderPhone(normalized);
      return phone ? { phone } : {};
    }
    case "address":
      return normalized.length >= 5 ? { address: normalized } : {};
    case "delivery_time":
      return normalized.length >= 2 && normalized.length <= 120
        ? { delivery_time: normalized }
        : {};
  }
}

function nextMissingField(input: {
  productId: string | null;
  quantity: number | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  desiredDeliveryTime: string | null;
}): OrderIntakeField | null {
  if (!input.productId) return "product";
  if (!input.quantity) return "quantity";
  if (!input.customerName) return "name";
  if (!input.customerPhone) return "phone";
  if (!input.deliveryAddress) return "address";
  return null;
}

function requestIdFor(inboxItemId: string): string {
  return createHash("sha256")
    .update(`meta-order:${inboxItemId}`)
    .digest("hex")
    .slice(0, 40);
}

export type MetaOrderIntakeResult =
  | { kind: "ignored" }
  | { kind: "reply"; text: string }
  | {
      kind: "draft";
      orderNumber: string;
      productName: string;
      quantity: number;
      unitPrice: string;
      customerPhone: string;
      deliveryAddress: string;
      desiredDeliveryTime: string | null;
      total: string;
      currency: string;
      productMediaUrls: string[];
    };

export async function processMetaOrderIntake(input: {
  item: typeof menaMetaInboxItems.$inferSelect;
  workspaceId: string;
}): Promise<MetaOrderIntakeResult> {
  const { item, workspaceId } = input;
  if (item.kind !== "message") return { kind: "ignored" };

  const currentText = item.text.trim();
  const [previousItem] = isMetaOrderAffirmative(currentText)
    ? await db
        .select({
          text: menaMetaInboxItems.text,
          replyText: menaMetaInboxItems.replyText,
        })
        .from(menaMetaInboxItems)
        .where(
          and(
            eq(menaMetaInboxItems.workspaceId, workspaceId),
            eq(menaMetaInboxItems.platform, item.platform),
            eq(menaMetaInboxItems.conversationId, item.conversationId),
            eq(menaMetaInboxItems.kind, "message"),
            or(
              lt(menaMetaInboxItems.occurredAt, item.occurredAt),
              and(
                eq(menaMetaInboxItems.occurredAt, item.occurredAt),
                lt(menaMetaInboxItems.createdAt, item.createdAt),
              ),
              and(
                eq(menaMetaInboxItems.occurredAt, item.occurredAt),
                eq(menaMetaInboxItems.createdAt, item.createdAt),
                lt(menaMetaInboxItems.id, item.id),
              ),
            ),
          ),
        )
        .orderBy(
          desc(menaMetaInboxItems.occurredAt),
          desc(menaMetaInboxItems.createdAt),
          desc(menaMetaInboxItems.id),
        )
        .limit(1)
    : [];
  const isOrderConfirmation = isMetaOrderConfirmation(
    currentText,
    previousItem?.replyText ?? null,
  );
  const startsNewOrder =
    isMetaOrderIntent(currentText) || isOrderConfirmation;
  const [activeIntake] = await db
    .select({
      status: menaMetaOrderIntakes.status,
      awaitingField: menaMetaOrderIntakes.awaitingField,
      productId: menaMetaOrderIntakes.productId,
      updatedAt: menaMetaOrderIntakes.updatedAt,
    })
    .from(menaMetaOrderIntakes)
    .where(
      and(
        eq(menaMetaOrderIntakes.workspaceId, workspaceId),
        eq(menaMetaOrderIntakes.platform, item.platform),
        eq(menaMetaOrderIntakes.conversationId, item.conversationId),
      ),
    )
    .limit(1);
  if (
    (!activeIntake ||
      activeIntake.status === "created" ||
      activeIntake.status === "cancelled") &&
    !startsNewOrder
  ) {
    return { kind: "ignored" };
  }
  if (
    activeIntake?.status === "creating" &&
    Date.now() - activeIntake.updatedAt.getTime() < 2 * 60_000
  ) {
    return {
      kind: "reply",
      text: "يجري تجهيز مسودة طلبك للمراجعة، وسنوافيك بالتفاصيل حال اكتمالها.",
    };
  }
  const needsProductCandidates =
    startsNewOrder ||
    activeIntake?.status === "collecting" ||
    activeIntake?.status === "creating";
  const productsList = needsProductCandidates
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          aliases: products.aliases,
          description: products.description,
          mediaUrls: products.mediaUrls,
        })
        .from(products)
        .where(
          and(
            eq(products.workspaceId, workspaceId),
            eq(products.status, "active"),
            isNotNull(products.verifiedAt),
          ),
        )
        .orderBy(desc(products.updatedAt))
        .limit(500)
    : [];

  const result = await db.transaction(async (transaction) => {
    await transaction
      .insert(menaMetaOrderIntakes)
      .values({
        id: randomUUID(),
        workspaceId,
        platform: item.platform,
        conversationId: item.conversationId,
        actorId: item.actorId,
      })
      .onConflictDoNothing({
        target: [
          menaMetaOrderIntakes.workspaceId,
          menaMetaOrderIntakes.platform,
          menaMetaOrderIntakes.conversationId,
        ],
      });

    const [existing] = await transaction
      .select()
      .from(menaMetaOrderIntakes)
      .where(
        and(
          eq(menaMetaOrderIntakes.workspaceId, workspaceId),
          eq(menaMetaOrderIntakes.platform, item.platform),
          eq(menaMetaOrderIntakes.conversationId, item.conversationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) throw new Error("META_ORDER_INTAKE_NOT_FOUND");

    if (
      existing.lastInboxItemId === item.id &&
      existing.status === "created" &&
      existing.draftOrderId
    ) {
      const [order] = await transaction
        .select({
          orderNumber: menaOrders.orderNumber,
          productName: menaOrderItems.productName,
          quantity: menaOrderItems.quantity,
          unitPrice: menaOrderItems.unitPrice,
          customerPhone: menaOrders.customerPhone,
          deliveryAddress: menaOrders.deliveryAddress,
          notes: menaOrders.notes,
          total: menaOrders.total,
          currency: menaOrders.currency,
          productMediaUrls: products.mediaUrls,
        })
        .from(menaOrders)
        .innerJoin(
          menaOrderItems,
          and(
            eq(menaOrderItems.workspaceId, menaOrders.workspaceId),
            eq(menaOrderItems.orderId, menaOrders.id),
          ),
        )
        .leftJoin(
          products,
          and(
            eq(products.workspaceId, menaOrderItems.workspaceId),
            eq(products.id, menaOrderItems.productId),
          ),
        )
        .where(
          and(
            eq(menaOrders.workspaceId, workspaceId),
            eq(menaOrders.id, existing.draftOrderId),
          ),
        )
        .limit(1);
      if (order) {
        return {
          kind: "duplicate" as const,
          orderNumber: order.orderNumber,
          productName: order.productName,
          quantity: order.quantity,
          unitPrice: order.unitPrice,
          customerPhone: order.customerPhone ?? "",
          deliveryAddress: order.deliveryAddress ?? "",
          desiredDeliveryTime:
            order.notes.match(
              /(?:يوم التوصيل المفضّل|وقت التوصيل المطلوب):\s*(.+)/iu,
            )?.[1] ?? null,
          total: order.total,
          currency: order.currency,
          productMediaUrls: order.productMediaUrls ?? [],
        };
      }
      return { kind: "ignored" as const };
    }

    if (
      existing.actorId &&
      item.actorId &&
      existing.actorId !== item.actorId &&
      existing.status === "collecting"
    ) {
      if (!startsNewOrder) return { kind: "ignored" as const };
    }
    const staleCreation =
      existing.status === "creating" &&
      Date.now() - existing.updatedAt.getTime() > 2 * 60_000;
    if (existing.status === "created" || existing.status === "cancelled") {
      if (!startsNewOrder) return { kind: "ignored" as const };
    } else if (existing.status === "creating") {
      if (!staleCreation) return { kind: "processing" as const };
    } else if (existing.status !== "collecting" && !startsNewOrder) {
      return { kind: "ignored" as const };
    }

    const isNew =
      startsNewOrder &&
      (existing.status === "created" ||
        existing.status === "cancelled" ||
        (existing.actorId !== null &&
          item.actorId !== null &&
          existing.actorId !== item.actorId));
    const base = isNew
      ? {
          productId: null,
          quantity: null,
          customerName:
            item.actorName?.trim() && item.actorName.trim().length <= 160
              ? item.actorName.trim()
              : null,
          customerPhone: null,
          deliveryAddress: null,
          desiredDeliveryTime: null,
        }
      : {
          productId: existing.productId,
          quantity: existing.quantity,
          customerName:
            existing.customerName ??
            (item.actorName?.trim() && item.actorName.trim().length <= 160
              ? item.actorName.trim()
              : null),
          customerPhone: existing.customerPhone,
          deliveryAddress: existing.deliveryAddress,
          desiredDeliveryTime: existing.desiredDeliveryTime,
        };

    if (
      isMetaOrderCancellation(currentText) &&
      existing.status === "collecting"
    ) {
      await transaction
        .update(menaMetaOrderIntakes)
        .set({
          status: "cancelled",
          awaitingField: null,
          productId: null,
          quantity: null,
          customerName: null,
          customerPhone: null,
          deliveryAddress: null,
          desiredDeliveryTime: null,
          lastInboxItemId: item.id,
          updatedAt: new Date(),
        })
        .where(eq(menaMetaOrderIntakes.id, existing.id));
      return { kind: "cancelled" as const };
    }

    const explicitProduct = matchMetaAutoReplyProduct(
      productsList,
      currentText,
    );
    const offeredProduct = isOrderConfirmation
      ? matchMetaAutoReplyProduct(productsList, previousItem?.text ?? "")
      : null;
    const parsedAwaited =
      !isNew && existing.awaitingField
        ? parseAwaitedValue(existing.awaitingField, currentText, productsList)
        : {};
    const productId =
      (typeof parsedAwaited.product === "string"
        ? parsedAwaited.product
        : null) ??
      base.productId ??
      explicitProduct?.id ??
      offeredProduct?.id ??
      null;
    const quantity =
      (typeof parsedAwaited.quantity === "number"
        ? parsedAwaited.quantity
        : null) ??
      base.quantity ??
      parseMetaOrderQuantity(currentText);
    const customerName =
      (typeof parsedAwaited.name === "string" ? parsedAwaited.name : null) ??
      parseMetaOrderLabeledValue(
        currentText,
        "الاسم|اسم العميل|اسم المستلم|name",
        160,
      ) ??
      base.customerName;
    const customerPhone =
      (typeof parsedAwaited.phone === "string" ? parsedAwaited.phone : null) ??
      parseMetaOrderPhone(currentText) ??
      base.customerPhone;
    const deliveryAddress =
      (typeof parsedAwaited.address === "string"
        ? parsedAwaited.address
        : null) ??
      parseMetaOrderLabeledValue(
        currentText,
        "عنوان التوصيل بالتفصيل|عنوان التوصيل|العنوان|مكان التوصيل|address",
        500,
      ) ??
      base.deliveryAddress;
    const desiredDeliveryTime = normalizeMetaOrderDeliveryPreference(
      (typeof parsedAwaited.delivery_time === "string"
        ? parsedAwaited.delivery_time
        : null) ??
        parseMetaOrderLabeledValue(
          currentText,
          "يوم التوصيل المفضّل(?: والساعة إن رغبت)?|يوم التوصيل المفضل(?: والساعة إن رغبت)?|موعد التوصيل المفضّل|موعد التوصيل المفضل|وقت التوصيل|موعد التوصيل|وقت الاستلام|delivery time",
          120,
        ) ??
        base.desiredDeliveryTime,
    );
    const values = {
      productId,
      quantity,
      customerName,
      customerPhone,
      deliveryAddress,
      desiredDeliveryTime,
    };
    const awaitingField = nextMissingField(values);
    const now = new Date();
    await transaction
      .update(menaMetaOrderIntakes)
      .set({
        status: "collecting",
        awaitingField,
        productId,
        quantity,
        customerName,
        customerPhone,
        deliveryAddress,
        desiredDeliveryTime,
        actorId: item.actorId ?? existing.actorId,
        lastInboxItemId: item.id,
        draftOrderId: null,
        ...(isNew ? { createdAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(menaMetaOrderIntakes.id, existing.id));

    if (!awaitingField) {
      await transaction
        .update(menaMetaOrderIntakes)
        .set({ status: "creating", updatedAt: now })
        .where(eq(menaMetaOrderIntakes.id, existing.id));
    }
    if (awaitingField) {
      return {
        kind: "collecting" as const,
        intakeId: existing.id,
        values,
        awaitingField,
        isNew,
        includeDeliveryPreference: isNew || !existing.lastInboxItemId,
      };
    }
    return {
      kind: "ready" as const,
      intakeId: existing.id,
      values,
      awaitingField,
      isNew,
    };
  });

  if (result.kind === "ignored") return { kind: "ignored" };
  if (result.kind === "cancelled") {
    return {
      kind: "reply",
      text: "تم إيقاف تجهيز الطلب. لن يُسجل أي طلب. إذا رغبت بالشراء لاحقًا، أرسل طلبك من جديد.",
    };
  }
  if (result.kind === "processing") {
    return {
      kind: "reply",
      text: "يجري تجهيز مسودة طلبك للمراجعة، وسنوافيك بالتفاصيل حال اكتمالها.",
    };
  }
  if (result.kind === "duplicate") {
    return {
      kind: "draft",
      orderNumber: result.orderNumber,
      productName: result.productName,
      quantity: result.quantity,
      unitPrice: result.unitPrice,
      customerPhone: result.customerPhone,
      deliveryAddress: result.deliveryAddress,
      desiredDeliveryTime: result.desiredDeliveryTime,
      total: result.total,
      currency: result.currency,
      productMediaUrls: result.productMediaUrls,
    };
  }
  if (result.kind === "collecting") {
    const productName =
      productsList.find((candidate) => candidate.id === result.values.productId)
        ?.name ?? null;
    return {
      kind: "reply",
      text: buildMetaOrderDataPrompt({
        productName,
        missingFields: [
          ...(!result.values.productId ? (["product"] as const) : []),
          ...(!result.values.quantity ? (["quantity"] as const) : []),
          ...(!result.values.customerName ? (["name"] as const) : []),
          ...(!result.values.customerPhone ? (["phone"] as const) : []),
          ...(!result.values.deliveryAddress ? (["address"] as const) : []),
        ],
        includeDeliveryPreference: result.includeDeliveryPreference,
      }),
    };
  }

  const { values, intakeId } = result;
  const product = productsList.find(
    (candidate) => candidate.id === values.productId,
  );
  if (
    !product ||
    !values.quantity ||
    !values.customerName ||
    !values.customerPhone ||
    !values.deliveryAddress
  ) {
    throw new Error("META_ORDER_INTAKE_INCOMPLETE");
  }
  const orderInput: CreateOrderInput = {
    clientRequestId: requestIdFor(item.id),
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    deliveryAddress: values.deliveryAddress,
    notes: values.desiredDeliveryTime
      ? `يوم التوصيل المفضّل: ${values.desiredDeliveryTime}`
      : "لم يحدد العميل يومًا مفضّلًا للتوصيل.",
    sourceMetaInboxItemId: item.id,
    items: [{ productId: product.id, quantity: values.quantity }],
  };
  try {
    const created = await createWorkspaceOrder(
      orderInput,
      item.ownerId,
      workspaceId,
    );
    if ("error" in created) {
      if (
        created.error === "PRODUCT_UNAVAILABLE" ||
        created.error === "PRODUCT_NOT_ORDERABLE" ||
        created.error === "INSUFFICIENT_STOCK" ||
        created.error === "PRODUCT_NOT_FOUND"
      ) {
        await db
          .update(menaMetaOrderIntakes)
          .set({
            status: "collecting",
            awaitingField: "product",
            productId: null,
            updatedAt: new Date(),
          })
          .where(eq(menaMetaOrderIntakes.id, intakeId));
        return {
          kind: "reply",
          text: "تعذر تأكيد توفر المنتج أو الكمية المطلوبة حاليًا. اكتب اسم منتج آخر وسنتحقق منه.",
        };
      }
      throw new Error(`META_ORDER_DRAFT_FAILED:${created.error}`);
    }
    const [createdItem] = created.items;
    if (!createdItem) {
      throw new Error("META_ORDER_DRAFT_ITEM_MISSING");
    }
    await db
      .update(menaMetaOrderIntakes)
      .set({
        status: "created",
        awaitingField: null,
        productId: null,
        quantity: null,
        customerName: null,
        customerPhone: null,
        deliveryAddress: null,
        desiredDeliveryTime: null,
        draftOrderId: created.order.id,
        lastInboxItemId: item.id,
        updatedAt: new Date(),
      })
      .where(eq(menaMetaOrderIntakes.id, intakeId));
    return {
      kind: "draft",
      orderNumber: created.order.orderNumber,
      productName: product.name,
      quantity: values.quantity,
      unitPrice: createdItem.unitPrice,
      customerPhone: values.customerPhone,
      deliveryAddress: values.deliveryAddress,
      desiredDeliveryTime: values.desiredDeliveryTime,
      total: created.order.total,
      currency: created.order.currency,
      productMediaUrls: product.mediaUrls,
    };
  } catch (error) {
    await db
      .update(menaMetaOrderIntakes)
      .set({ status: "collecting", awaitingField: null, updatedAt: new Date() })
      .where(eq(menaMetaOrderIntakes.id, intakeId));
    throw error;
  }
}
