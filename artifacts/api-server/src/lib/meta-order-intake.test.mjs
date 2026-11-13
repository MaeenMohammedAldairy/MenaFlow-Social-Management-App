import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaOrderDataPrompt,
  formatMetaOrderDraftReply,
  formatMetaOrderConfirmationMessage,
  isMetaOrderAffirmative,
  isMetaOrderConfirmation,
  normalizeMetaOrderDeliveryPreference,
  parseMetaOrderLabeledValue,
} from "./meta-order-messages.ts";

test("starts order intake from an affirmative reply only after an order offer", () => {
  const offer = "نعم، مصحف القلم متوفر. هل تود إتمام الطلب؟";

  assert.equal(isMetaOrderAffirmative("نعم"), true);
  assert.equal(isMetaOrderAffirmative("تمام"), true);
  assert.equal(isMetaOrderConfirmation("نعم", offer), true);
  assert.equal(isMetaOrderConfirmation("تمام، أريد", offer), true);
  assert.equal(isMetaOrderConfirmation("نعم", "السعر 6500 ريال."), false);
  assert.equal(isMetaOrderConfirmation("اشتي اطلب المصحف", null), false);
});

test("order data prompt requests one organized message and leaves delivery preference optional", () => {
  const prompt = buildMetaOrderDataPrompt({
    productName: "المصحف",
    missingFields: ["quantity", "phone", "address"],
    includeDeliveryPreference: true,
  });

  assert.match(prompt, /في رسالة واحدة/);
  assert.match(prompt, /الكمية المطلوبة/);
  assert.match(prompt, /رقم الهاتف/);
  assert.match(prompt, /عنوان التوصيل بالتفصيل/);
  assert.match(prompt, /يوم التوصيل المفضّل.*اختياري/);
});

test("delivery preference may be omitted and preserves a supplied day and time", () => {
  assert.equal(normalizeMetaOrderDeliveryPreference(null), null);
  assert.equal(normalizeMetaOrderDeliveryPreference("في أقرب وقت ممكن"), null);
  assert.equal(normalizeMetaOrderDeliveryPreference("لا يوجد تفضيل"), null);
  assert.equal(
    normalizeMetaOrderDeliveryPreference("غدًا الساعة ١٠ صباحًا"),
    "غدًا الساعة ١٠ صباحًا",
  );
});

test("labeled data extraction accepts the prompt's address and delivery labels", () => {
  const message =
    "عنوان التوصيل بالتفصيل (المدينة، الحي، وأقرب معلم): صنعاء، حدة، جوار السوق\nيوم التوصيل المفضّل والساعة إن رغبت (اختياري؛ اتركه فارغًا إن لم يكن لديك تفضيل): غدًا الساعة ١٠";

  assert.equal(
    parseMetaOrderLabeledValue(message, "عنوان التوصيل بالتفصيل", 500),
    "صنعاء، حدة، جوار السوق",
  );
  assert.equal(
    parseMetaOrderLabeledValue(
      message,
      "يوم التوصيل المفضّل(?: والساعة إن رغبت)?",
      120,
    ),
    "غدًا الساعة ١٠",
  );
});

test("draft reply summarizes customer data, product value, and preliminary number", () => {
  const reply = formatMetaOrderDraftReply({
    orderNumber: "MF-20261112-ABC",
    productName: "المصحف",
    quantity: 1,
    unitPrice: "6500.00",
    customerPhone: "777123456",
    deliveryAddress: "شارع النخيل، جوار السوق",
    desiredDeliveryTime: "غدًا الساعة ١٠ صباحًا",
    total: "6500.00",
    currency: "YER",
  });

  assert.match(reply, /الكمية: 1/);
  assert.match(reply, /سعر الوحدة/);
  assert.match(reply, /إجمالي المنتجات/);
  assert.match(reply, /777123456/);
  assert.match(reply, /شارع النخيل/);
  assert.match(reply, /غدًا الساعة ١٠ صباحًا/);
  assert.match(reply, /رقم الطلب المبدئي: MF-20261112-ABC/);
  assert.doesNotMatch(reply, /رقم التتبع|رقم المتابعة/);
  assert.match(reply, /ليس موعدًا مؤكدًا/);
});

test("confirmation message distinguishes product value, delivery fee, and preferred time", () => {
  const message = formatMetaOrderConfirmationMessage({
    orderNumber: "MF-20261112-ABC",
    items: [{ productName: "المصحف", quantity: 1 }],
    total: "6500.00",
    currency: "YER",
    deliveryFee: "500.00",
    notes: "يوم التوصيل المفضّل: غدًا الساعة ١٠ صباحًا",
  });

  assert.match(message, /تم تأكيد طلبك/);
  assert.match(message, /رقم الطلب: MF-20261112-ABC/);
  assert.match(message, /رسوم التوصيل/);
  assert.match(message, /الإجمالي شامل التوصيل/);
  assert.match(message, /سنراسلك لتأكيده/);
});
