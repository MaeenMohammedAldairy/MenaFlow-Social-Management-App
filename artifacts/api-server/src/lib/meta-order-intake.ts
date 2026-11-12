import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
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
import type { CreateOrderInput } from "./order-validation";

type OrderIntakeField =
  "product" | "quantity" | "name" | "phone" | "address" | "delivery_time";

const orderIntentPattern =
  /(?:اريد|أريد|ابغى|أبغى|ابي|أبي|اشتي|أشتهي|بدي|حاب|ارغب|أرغب).{0,35}(?:اطلب|أطلب|طلب|اشتري|أشتري|شراء)|(?:اطلب|أطلب|اشتري|أشتري|شراء|order|buy)/iu;
const cancelOrderPattern =
  /^(?:الغاء|إلغاء|إلغاء الطلب|الغيه|ألغيه|تراجع|cancel)$/iu;
const digitMap: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

const fieldPrompts: Record<OrderIntakeField, string> = {
  product: "ما المنتج الذي تريد طلبه؟ اكتب اسمه كما يظهر في المتجر.",
  quantity: "كم الكمية المطلوبة؟ أرسل رقمًا فقط.",
  name: "ما الاسم الذي نسجّل به الطلب؟",
  phone: "ما رقم الهاتف الذي يمكن التواصل معك عليه؟",
  address: "ما عنوان التوصيل بالتفصيل؟",
  delivery_time: "ما اليوم والوقت المناسبان للتوصيل؟",
};

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => digitMap[digit] ?? digit);
}

function labeledValue(
  text: string,
  labels: string,
  maximum: number,
): string | null {
  const match = text.match(
    new RegExp(`(?:${labels})\\s*[:：=-]\\s*([^\\n]+)`, "iu"),
  );
  const value = match?.[1]?.trim();
  return value && value.length <= maximum ? value : null;
}

export function isMetaOrderIntent(text: string): boolean {
  return orderIntentPattern.test(text);
}

export function parseMetaOrderQuantity(
  text: string,
  allowBareNumber = false,
): number | null {
  const normalized = normalizeDigits(text);
  const match = normalized.match(
    allowBareNumber
      ? /^\s*(\d{1,3})\s*$/
      : /(?:الكمية|كمية|عدد|حبة|قطعة)\s*[:：]?\s*(\d{1,3})|(\d{1,3})\s*(?:حبة|قطعة|وحدات?)/iu,
  );
  const quantity = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 999
    ? quantity
    : null;
}

export function parseMetaOrderPhone(text: string): string | null {
  const normalized = normalizeDigits(text);
  const labeled = normalized
    .match(
      /(?:رقم\s*(?:الهاتف|الجوال|التواصل)|الهاتف|الجوال|phone)\s*[:：=-]?\s*([+]?\d[\d\s().-]{5,23}\d)/iu,
    )?.[1]
    ?.trim();
  const candidate =
    labeled ??
    normalized.match(/[+]?\d[\d\s().-]{5,23}\d/u)?.[0]?.trim() ??
    null;
  if (!candidate) return null;
  const digits = candidate.replace(/\D/gu, "");
  return digits.length >= 7 && digits.length <= 15
    ? `${candidate.startsWith("+") ? "+" : ""}${digits}`
    : null;
}

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
  if (!input.desiredDeliveryTime) return "delivery_time";
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
    };

export async function processMetaOrderIntake(input: {
  item: typeof menaMetaInboxItems.$inferSelect;
  workspaceId: string;
}): Promise<MetaOrderIntakeResult> {
  const { item, workspaceId } = input;
  if (item.kind !== "message") return { kind: "ignored" };

  const currentText = item.text.trim();
  const startsNewOrder = isMetaOrderIntent(currentText);
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
        })
        .from(menaOrders)
        .innerJoin(
          menaOrderItems,
          and(
            eq(menaOrderItems.workspaceId, menaOrders.workspaceId),
            eq(menaOrderItems.orderId, menaOrders.id),
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
      cancelOrderPattern.test(currentText) &&
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
      null;
    const quantity =
      (typeof parsedAwaited.quantity === "number"
        ? parsedAwaited.quantity
        : null) ??
      base.quantity ??
      parseMetaOrderQuantity(currentText);
    const customerName =
      (typeof parsedAwaited.name === "string" ? parsedAwaited.name : null) ??
      labeledValue(currentText, "الاسم|اسم العميل|name", 160) ??
      base.customerName;
    const customerPhone =
      (typeof parsedAwaited.phone === "string" ? parsedAwaited.phone : null) ??
      parseMetaOrderPhone(currentText) ??
      base.customerPhone;
    const deliveryAddress =
      (typeof parsedAwaited.address === "string"
        ? parsedAwaited.address
        : null) ??
      labeledValue(
        currentText,
        "عنوان التوصيل|العنوان|مكان التوصيل|address",
        500,
      ) ??
      base.deliveryAddress;
    const desiredDeliveryTime =
      (typeof parsedAwaited.delivery_time === "string"
        ? parsedAwaited.delivery_time
        : null) ??
      labeledValue(
        currentText,
        "وقت التوصيل|موعد التوصيل|وقت الاستلام|delivery time",
        120,
      ) ??
      base.desiredDeliveryTime;
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
    };
  }
  if (result.kind === "collecting") {
    return { kind: "reply", text: fieldPrompts[result.awaitingField] };
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
    !values.deliveryAddress ||
    !values.desiredDeliveryTime
  ) {
    throw new Error("META_ORDER_INTAKE_INCOMPLETE");
  }
  const orderInput: CreateOrderInput = {
    clientRequestId: requestIdFor(item.id),
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    deliveryAddress: values.deliveryAddress,
    notes: `وقت التوصيل المطلوب: ${values.desiredDeliveryTime}`,
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
    };
  } catch (error) {
    await db
      .update(menaMetaOrderIntakes)
      .set({ status: "collecting", awaitingField: null, updatedAt: new Date() })
      .where(eq(menaMetaOrderIntakes.id, intakeId));
    throw error;
  }
}
