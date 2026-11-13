export type OrderIntakeField =
  "product" | "quantity" | "name" | "phone" | "address" | "delivery_time";

const noDeliveryPreferencePattern =
  /^(?:لا\s*(?:يوجد(?:\s*تفضيل)?|أفضل|افضل|تفضيل)|لا\s*فرق|أي\s*وقت|اي\s*وقت|في\s*أقرب\s*وقت(?:\s*ممكن)?|اقرب\s*وقت(?:\s*ممكن)?|أقرب\s*وقت(?:\s*ممكن)?|لا\s*يهم)$/iu;
const metaOrderAffirmativePattern =
  /^(?:نعم|أجل|اجل|ايوا|ايوه|أيوه|اي|إي|تمام|حسنًا|حسنا|أكيد|اكيد|yes|ok|okay)(?:\s*[,،]?\s*(?:أريد|اريد|أرغب|ارغب|أطلب|اطلب|أشتري|اشتري))?[.!؟?]*$/iu;
const metaOrderOfferPattern =
  /(?:هل\s*(?:تود|ترغب|تحب|تريد)[\s\S]{0,80}(?:إتمام|إكمال|تنفيذ|الطلب|الشراء)|(?:تود|ترغب|تحب)[\s\S]{0,50}(?:إتمام|إكمال|تنفيذ)\s*الطلب)/iu;

export function isMetaOrderAffirmative(text: string): boolean {
  return metaOrderAffirmativePattern.test(text.trim());
}

export function isMetaOrderConfirmation(
  text: string,
  previousBusinessReply: string | null,
): boolean {
  return Boolean(
    previousBusinessReply &&
      isMetaOrderAffirmative(text) &&
      metaOrderOfferPattern.test(previousBusinessReply),
  );
}

const fieldLabels: Record<OrderIntakeField, string> = {
  product: "اسم المنتج",
  quantity: "الكمية المطلوبة",
  name: "اسم المستلم",
  phone: "رقم الهاتف",
  address: "عنوان التوصيل بالتفصيل (المدينة، الحي، وأقرب معلم)",
  delivery_time: "يوم التوصيل المفضّل والساعة إن رغبت",
};

export function normalizeMetaOrderDeliveryPreference(
  value: string | null,
): string | null {
  const normalized = value?.trim();
  return !normalized || noDeliveryPreferencePattern.test(normalized)
    ? null
    : normalized;
}

export function parseMetaOrderLabeledValue(
  text: string,
  labels: string,
  maximum: number,
): string | null {
  const match = text.match(
    new RegExp(
      `(?:${labels})(?:\\s*\\([^\\n]*\\))?\\s*[:：=-]\\s*([^\\n]+)`,
      "iu",
    ),
  );
  const value = match?.[1]?.trim();
  return value && value.length <= maximum ? value : null;
}

export function buildMetaOrderDataPrompt(input: {
  productName: string | null;
  missingFields: OrderIntakeField[];
  includeDeliveryPreference: boolean;
}): string {
  const productLabel = input.productName
    ? `طلب «${input.productName}»`
    : "الطلب";
  const fields = input.missingFields.map((field) => `• ${fieldLabels[field]}:`);
  if (input.includeDeliveryPreference) {
    fields.push(
      `• ${fieldLabels.delivery_time} (اختياري؛ اتركه فارغًا إن لم يكن لديك تفضيل):`,
    );
  }
  return `لإتمام ${productLabel}، أرسل البيانات التالية في رسالة واحدة إن أمكن:\n${fields.join("\n")}\n\nإذا أرسلت بعض البيانات فقط، سنطلب منك ما ينقص.`;
}

export function formatMetaOrderAmount(
  amount: string,
  currency: string,
): string {
  const formattedAmount = new Intl.NumberFormat("ar-YE", {
    maximumFractionDigits: 2,
  }).format(Number(amount));
  const currencyLabel =
    currency === "YER"
      ? "ريال يمني"
      : currency === "SAR"
        ? "ريال سعودي"
        : currency === "USD"
          ? "دولار أمريكي"
          : currency;
  return `${formattedAmount} ${currencyLabel}`;
}

export function formatMetaOrderDraftReply(input: {
  orderNumber: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  customerPhone: string;
  deliveryAddress: string;
  desiredDeliveryTime: string | null;
  total: string;
  currency: string;
}): string {
  const deliveryPreference = input.desiredDeliveryTime
    ? `يوم التوصيل المفضّل: ${input.desiredDeliveryTime}`
    : "موعد التوصيل المفضّل: لم تحدد موعدًا؛ سينسّق المتجر معك أقرب وقت متاح.";
  return [
    "شكرًا لك، استلمنا بيانات طلبك المبدئي:",
    `المنتج: ${input.productName}`,
    `الكمية: ${input.quantity}`,
    `سعر الوحدة: ${formatMetaOrderAmount(input.unitPrice, input.currency)}`,
    `إجمالي المنتجات: ${formatMetaOrderAmount(input.total, input.currency)}`,
    `رقم التواصل: ${input.customerPhone}`,
    `عنوان التوصيل: ${input.deliveryAddress}`,
    deliveryPreference,
    `رقم الطلب المبدئي: ${input.orderNumber}`,
    "",
    "طلبك بانتظار مراجعة المتجر وتأكيد التوفر والتوصيل. الموعد المذكور تفضيل وليس موعدًا مؤكدًا. إذا أردت تعديل أي معلومة، أرسل لنا التصحيح.",
  ].join("\n");
}

export function formatMetaOrderConfirmationMessage(input: {
  orderNumber: string;
  items: Array<{ productName: string; quantity: number }>;
  total: string;
  currency: string;
  deliveryFee: string;
  notes: string;
}): string {
  const preferredDeliveryTime = input.notes.match(
    /(?:يوم التوصيل المفضّل|وقت التوصيل المطلوب):\s*(.+)/iu,
  )?.[1];
  const lines = [
    "تم تأكيد طلبك ✅",
    `رقم الطلب: ${input.orderNumber}`,
    `المنتج والكمية: ${input.items
      .map(({ productName, quantity }) => `${productName} × ${quantity}`)
      .join("، ")}`,
    `قيمة المنتجات: ${formatMetaOrderAmount(input.total, input.currency)}`,
  ];
  const deliveryFee = Number(input.deliveryFee);
  if (deliveryFee > 0) {
    lines.push(
      `رسوم التوصيل: ${formatMetaOrderAmount(input.deliveryFee, input.currency)}`,
      `الإجمالي شامل التوصيل: ${formatMetaOrderAmount(
        (Number(input.total) + deliveryFee).toFixed(2),
        input.currency,
      )}`,
    );
  } else {
    lines.push("رسوم التوصيل - إن وجدت - سيؤكدها المتجر قبل التسليم.");
  }
  lines.push(
    preferredDeliveryTime
      ? `موعد التوصيل المفضّل: ${preferredDeliveryTime}، وسنراسلك لتأكيده.`
      : "سنتواصل معك لتنسيق أقرب موعد توصيل متاح.",
    "شكرًا لطلبك، سنرسل لك تحديثًا عند تجهيز الطلب.",
  );
  return lines.join("\n");
}
