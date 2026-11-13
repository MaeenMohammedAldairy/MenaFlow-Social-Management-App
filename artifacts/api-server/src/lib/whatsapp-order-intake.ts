import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  menaWhatsAppOrderIntakes,
  menaOrderItems,
  menaOrders,
  products,
} from "@workspace/db";
import { createWorkspaceOrder } from "./order-service";
import {
  buildMetaOrderDataPrompt,
  formatMetaOrderDraftReply,
} from "./meta-order-messages.ts";
import {
  isMetaOrderIntent,
  isMetaOrderCancellation,
} from "./order-intake-parsing.ts";
import {
  parseWhatsAppOrderDetails,
  type CustomerOrderDetails,
} from "./whatsapp-order-intake-policy.ts";
import {
  decryptWhatsAppDirectMessageValue,
  encryptWhatsAppDirectMessageValue,
  whatsappDirectConversationKeys,
  whatsappDirectMessageExpiry,
} from "./whatsapp-direct-messages";
import type { OrderIntakeField } from "./meta-order-messages.ts";

const staleIntakeMs = 14 * 24 * 60 * 60 * 1000;
type WhatsAppOrderIntakeField = Exclude<OrderIntakeField, "delivery_time">;

function missingFields(input: {
  productId: string | null;
  quantity: number | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
}): WhatsAppOrderIntakeField[] {
  return ([
    ["product", !input.productId],
    ["quantity", !input.quantity],
    ["name", !input.customerName],
    ["phone", !input.customerPhone],
    ["address", !input.deliveryAddress],
  ] as const)
    .filter(([, missing]) => missing)
    .map(([field]) => field);
}

function requestId(): string {
  return randomUUID().replace(/-/g, "");
}

function customerDetailsFromCiphertext(value: string): CustomerOrderDetails {
  const parsed: unknown = JSON.parse(decryptWhatsAppDirectMessageValue(value));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WHATSAPP_ORDER_INTAKE_DATA_INVALID");
  }
  const details = parsed as Record<string, unknown>;
  return {
    customerName:
      typeof details.customerName === "string" ? details.customerName : null,
    customerPhone:
      typeof details.customerPhone === "string" ? details.customerPhone : null,
    deliveryAddress:
      typeof details.deliveryAddress === "string"
        ? details.deliveryAddress
        : null,
  };
}

export type WhatsAppOrderIntakeResult =
  | { kind: "ignored" }
  | { kind: "reply"; text: string }
  | { kind: "draft"; text: string };

export async function processWhatsAppOrderIntake(input: {
  ownerId: string;
  workspaceId: string;
  instanceName: string;
  remoteJid: string;
  remoteJidHash: string;
  providerMessageId: string;
  text: string;
}): Promise<WhatsAppOrderIntakeResult> {
  const currentText = input.text.trim().slice(0, 2000);
  const startsNewOrder = isMetaOrderIntent(currentText);
  const requestsCancellation = isMetaOrderCancellation(currentText);
  const conversationKeys = whatsappDirectConversationKeys(
    input.workspaceId,
    input.instanceName,
    input.remoteJid,
  );
  const [active] = await db
    .select({
      status: menaWhatsAppOrderIntakes.status,
      updatedAt: menaWhatsAppOrderIntakes.updatedAt,
      lastProviderMessageId: menaWhatsAppOrderIntakes.lastProviderMessageId,
      draftOrderId: menaWhatsAppOrderIntakes.draftOrderId,
    })
    .from(menaWhatsAppOrderIntakes)
    .where(
      and(
        eq(menaWhatsAppOrderIntakes.workspaceId, input.workspaceId),
        eq(menaWhatsAppOrderIntakes.instanceName, input.instanceName),
        inArray(menaWhatsAppOrderIntakes.remoteJidHash, conversationKeys),
      ),
    )
    .limit(1);
  if (
    requestsCancellation &&
    (!active || active.status === "cancelled")
  ) {
    return { kind: "ignored" };
  }
  if (requestsCancellation && active?.status === "created") {
    return {
      kind: "reply",
      text: "وصلت مسودة طلبك إلى المتجر للمراجعة. أرسل التفاصيل التي تريد تعديلها وسيتابعها الموظف.",
    };
  }
  if (
    active?.status === "created" &&
    active.lastProviderMessageId === input.providerMessageId &&
    active.draftOrderId
  ) {
    const [existingOrder] = await db
      .select({
        orderNumber: menaOrders.orderNumber,
        productName: menaOrderItems.productName,
        quantity: menaOrderItems.quantity,
        unitPrice: menaOrderItems.unitPrice,
        customerPhone: menaOrders.customerPhone,
        deliveryAddress: menaOrders.deliveryAddress,
        total: menaOrders.total,
        currency: menaOrders.currency,
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
          eq(menaOrders.workspaceId, input.workspaceId),
          eq(menaOrders.id, active.draftOrderId),
        ),
      )
      .limit(1);
    if (existingOrder) {
      return {
        kind: "draft",
        text: formatMetaOrderDraftReply({
          orderNumber: existingOrder.orderNumber,
          productName: existingOrder.productName,
          quantity: existingOrder.quantity,
          unitPrice: existingOrder.unitPrice,
          customerPhone: existingOrder.customerPhone ?? "",
          deliveryAddress: existingOrder.deliveryAddress ?? "",
          desiredDeliveryTime: null,
          total: existingOrder.total,
          currency: existingOrder.currency,
        }),
      };
    }
  }
  const stale = Boolean(
    active && Date.now() - active.updatedAt.getTime() > staleIntakeMs,
  );
  if (
    (!active || active.status === "created" || active.status === "cancelled" || stale) &&
    !startsNewOrder &&
    !requestsCancellation
  ) {
    return { kind: "ignored" };
  }

  const productsList = await db
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
        eq(products.workspaceId, input.workspaceId),
        eq(products.status, "active"),
        isNotNull(products.verifiedAt),
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(200);

  const collected = await db.transaction(async (transaction) => {
    let [intake] = await transaction
      .select()
      .from(menaWhatsAppOrderIntakes)
      .where(
        and(
          eq(menaWhatsAppOrderIntakes.workspaceId, input.workspaceId),
          eq(menaWhatsAppOrderIntakes.instanceName, input.instanceName),
          inArray(menaWhatsAppOrderIntakes.remoteJidHash, conversationKeys),
        ),
      )
      .for("update")
      .limit(1);
    if (!intake) {
      await transaction
        .insert(menaWhatsAppOrderIntakes)
        .values({
          id: randomUUID(),
          ownerId: input.ownerId,
          workspaceId: input.workspaceId,
          instanceName: input.instanceName,
          remoteJidHash: conversationKeys[0]!,
          encryptedCustomerData: encryptWhatsAppDirectMessageValue("{}"),
          clientRequestId: requestId(),
          expiresAt: whatsappDirectMessageExpiry(new Date()),
        })
        .onConflictDoNothing();
      [intake] = await transaction
        .select()
        .from(menaWhatsAppOrderIntakes)
        .where(
          and(
            eq(menaWhatsAppOrderIntakes.workspaceId, input.workspaceId),
            eq(menaWhatsAppOrderIntakes.instanceName, input.instanceName),
            inArray(menaWhatsAppOrderIntakes.remoteJidHash, conversationKeys),
          ),
        )
        .for("update")
        .limit(1);
    }
    if (!intake) throw new Error("WHATSAPP_ORDER_INTAKE_NOT_FOUND");
    if (
      intake.status === "creating" &&
      Date.now() - intake.updatedAt.getTime() < 2 * 60_000
    ) {
      return { kind: "reply" as const, text: "يجري تجهيز مسودة طلبك للمراجعة." };
    }
    if (requestsCancellation && intake.status === "collecting") {
      const now = new Date();
      await transaction
        .update(menaWhatsAppOrderIntakes)
        .set({
          status: "cancelled",
          awaitingField: null,
          productId: null,
          quantity: null,
          encryptedCustomerData: encryptWhatsAppDirectMessageValue("{}"),
          lastProviderMessageId: input.providerMessageId,
          expiresAt: whatsappDirectMessageExpiry(now),
          updatedAt: now,
        })
        .where(eq(menaWhatsAppOrderIntakes.id, intake.id));
      return { kind: "cancelled" as const };
    }

    const isNewOrder =
      intake.status === "created" ||
      intake.status === "cancelled" ||
      Date.now() - intake.updatedAt.getTime() > staleIntakeMs;
    if (isNewOrder && !startsNewOrder) return { kind: "ignored" as const };
    const baseDetails = isNewOrder
      ? { customerName: null, customerPhone: null, deliveryAddress: null }
      : customerDetailsFromCiphertext(intake.encryptedCustomerData);
    const parsed = parseWhatsAppOrderDetails({
      text: currentText,
      awaitingField: isNewOrder ? null : intake.awaitingField,
      existing: baseDetails,
      products: productsList,
    });
    const productId = parsed.productId ?? (isNewOrder ? null : intake.productId);
    const quantity =
      parsed.quantity ?? (isNewOrder ? null : intake.quantity);
    const details = {
      customerName: parsed.customerName ?? baseDetails.customerName,
      customerPhone: parsed.customerPhone ?? baseDetails.customerPhone,
      deliveryAddress: parsed.deliveryAddress ?? baseDetails.deliveryAddress,
    };
    const remainingFields = missingFields({
      productId,
      quantity,
      ...details,
    });
    const awaitingField = remainingFields[0] ?? null;
    const now = new Date();
    const customerData = encryptWhatsAppDirectMessageValue(
      JSON.stringify(details),
    );
    const nextRequestId = isNewOrder ? requestId() : intake.clientRequestId;
    await transaction
      .update(menaWhatsAppOrderIntakes)
      .set({
        status: awaitingField ? "collecting" : "creating",
        awaitingField,
        productId,
        quantity,
        encryptedCustomerData: customerData,
        clientRequestId: nextRequestId,
        lastProviderMessageId: input.providerMessageId,
        draftOrderId: isNewOrder ? null : intake.draftOrderId,
        expiresAt: whatsappDirectMessageExpiry(now),
        updatedAt: now,
      })
      .where(eq(menaWhatsAppOrderIntakes.id, intake.id));

    if (awaitingField) {
      const productName = productsList.find(({ id }) => id === productId)?.name ?? null;
      return {
        kind: "reply" as const,
        text: buildMetaOrderDataPrompt({
          productName,
          missingFields: remainingFields,
          includeDeliveryPreference: false,
        }),
      };
    }
    const product = productsList.find(({ id }) => id === productId);
    if (!product || !quantity || !details.customerName || !details.customerPhone || !details.deliveryAddress) {
      throw new Error("WHATSAPP_ORDER_INTAKE_INCOMPLETE");
    }
    return {
      kind: "ready" as const,
      intakeId: intake.id,
      clientRequestId: nextRequestId,
      product,
      quantity,
      details,
    };
  });

  if (collected.kind === "ignored" || collected.kind === "reply") return collected;
  if (collected.kind === "cancelled") {
    return {
      kind: "reply",
      text: "تم إيقاف تجهيز الطلب. لم تُنشأ مسودة. إذا رغبت بالشراء لاحقًا، أرسل طلبك من جديد.",
    };
  }
  const created = await createWorkspaceOrder(
    {
      clientRequestId: collected.clientRequestId,
      customerName: collected.details.customerName!,
      customerPhone: collected.details.customerPhone!,
      deliveryAddress: collected.details.deliveryAddress!,
      notes: "",
      sourceMetaInboxItemId: null,
      sourceWhatsApp: {
        instanceName: input.instanceName,
        remoteJidHash: input.remoteJidHash,
      },
      items: [{ productId: collected.product.id, quantity: collected.quantity }],
    },
    input.ownerId,
    input.workspaceId,
  );
  if ("error" in created) {
    await db
      .update(menaWhatsAppOrderIntakes)
      .set({
        status: "collecting",
        awaitingField: "product",
        productId: null,
        updatedAt: new Date(),
      })
      .where(eq(menaWhatsAppOrderIntakes.id, collected.intakeId));
    return {
      kind: "reply",
      text: "تعذر تأكيد توفر المنتج أو الكمية المطلوبة حاليًا. اكتب اسم منتج آخر وسنتحقق منه.",
    };
  }
  const [orderItem] = created.items;
  if (!orderItem) throw new Error("WHATSAPP_ORDER_DRAFT_ITEM_MISSING");
  await db
    .update(menaWhatsAppOrderIntakes)
    .set({
      status: "created",
      awaitingField: null,
      draftOrderId: created.order.id,
      updatedAt: new Date(),
    })
    .where(eq(menaWhatsAppOrderIntakes.id, collected.intakeId));

  return {
    kind: "draft",
    text: formatMetaOrderDraftReply({
      orderNumber: created.order.orderNumber,
      productName: orderItem.productName,
      quantity: orderItem.quantity,
      unitPrice: orderItem.unitPrice,
      customerPhone: collected.details.customerPhone!,
      deliveryAddress: collected.details.deliveryAddress!,
      desiredDeliveryTime: null,
      total: created.order.total,
      currency: created.order.currency,
    }),
  };
}