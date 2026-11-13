import {
  parseMetaOrderLabeledValue,
  type OrderIntakeField,
} from "./meta-order-messages.ts";
import { matchMetaAutoReplyProduct } from "./meta-auto-reply.ts";
import {
  parseMetaOrderPhone,
  parseMetaOrderQuantity,
} from "./order-intake-parsing.ts";

export type CustomerOrderDetails = {
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
};

type OrderProductCandidate = {
  id: string;
  sku: string | null;
  name: string;
  aliases: string[];
  description: string;
  mediaUrls: string[];
};

export function parseWhatsAppOrderDetails(input: {
  text: string;
  awaitingField: OrderIntakeField | null;
  existing: CustomerOrderDetails;
  products: OrderProductCandidate[];
}) {
  const { text, awaitingField, existing, products: candidates } = input;
  const matchedProduct = matchMetaAutoReplyProduct(candidates, text);
  const nameFromLabel = parseMetaOrderLabeledValue(
    text,
    "الاسم|اسم العميل|اسم المستلم|name",
    160,
  );
  const phoneIsExpected =
    awaitingField === "phone" ||
    /(?:رقم\s*(?:الهاتف|الجوال|التواصل)|الهاتف|الجوال|phone)\s*[:：=-]/iu.test(
      text,
    );
  const phone = phoneIsExpected ? parseMetaOrderPhone(text) : null;
  const addressFromLabel = parseMetaOrderLabeledValue(
    text,
    "عنوان التوصيل بالتفصيل|عنوان التوصيل|العنوان|مكان التوصيل|address",
    500,
  );
  const addressFromAwaitedField =
    awaitingField === "address" && text.trim().length >= 5
      ? text.trim().slice(0, 500)
      : null;

  return {
    productId: matchedProduct?.id ?? null,
    quantity: parseMetaOrderQuantity(text, awaitingField === "quantity"),
    customerName:
      nameFromLabel ??
      (awaitingField === "name" && text.trim().length <= 160
        ? text.trim()
        : null),
    customerPhone: phone,
    deliveryAddress: addressFromLabel ?? addressFromAwaitedField,
    product: matchedProduct,
    customerDetails: {
      customerName: nameFromLabel ?? existing.customerName,
      customerPhone: phone ?? existing.customerPhone,
      deliveryAddress:
        addressFromLabel ?? addressFromAwaitedField ?? existing.deliveryAddress,
    },
  };
}

export { isMetaOrderCancellation } from "./order-intake-parsing.ts";