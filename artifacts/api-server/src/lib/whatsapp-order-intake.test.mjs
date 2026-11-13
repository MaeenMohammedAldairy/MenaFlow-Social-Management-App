import assert from "node:assert/strict";
import test from "node:test";
import { isMetaOrderCancellation } from "./order-intake-parsing.ts";
import { parseWhatsAppOrderDetails } from "./whatsapp-order-intake-policy.ts";

const products = [
  {
    id: "product-qalam",
    name: "مصحف القلم القارئ الذكي",
    sku: "QALAM-1",
    aliases: ["المصحف الذكي"],
    description: "مصحف مع قلم قارئ",
    mediaUrls: [],
  },
];

test("parses a labeled Arabic WhatsApp order message", () => {
  const parsed = parseWhatsAppOrderDetails({
    text: [
      "المنتج: مصحف القلم القارئ الذكي",
      "الكمية: ٢",
      "اسم المستلم: فاطمة علي",
      "رقم الهاتف: +967777123456",
      "عنوان التوصيل بالتفصيل: صنعاء، حدة، جوار السوق",
    ].join("\n"),
    awaitingField: null,
    existing: {
      customerName: null,
      customerPhone: null,
      deliveryAddress: null,
    },
    products,
  });

  assert.equal(parsed.productId, "product-qalam");
  assert.equal(parsed.quantity, 2);
  assert.equal(parsed.customerDetails.customerName, "فاطمة علي");
  assert.equal(parsed.customerDetails.customerPhone, "+967777123456");
  assert.equal(
    parsed.customerDetails.deliveryAddress,
    "صنعاء، حدة، جوار السوق",
  );
});

test("does not invent a product and accepts an awaited free-form address", () => {
  const parsed = parseWhatsAppOrderDetails({
    text: "عنوان العميل في مدينة غير محددة",
    awaitingField: "address",
    existing: {
      customerName: "فاطمة",
      customerPhone: "777123456",
      deliveryAddress: null,
    },
    products,
  });

  assert.equal(parsed.productId, null);
  assert.equal(
    parsed.customerDetails.deliveryAddress,
    "عنوان العميل في مدينة غير محددة",
  );
});

test("recognizes explicit order cancellation phrases", () => {
  assert.equal(isMetaOrderCancellation("إلغاء الطلب"), true);
  assert.equal(isMetaOrderCancellation("تراجع"), true);
  assert.equal(isMetaOrderCancellation("أريد الطلب"), false);
});