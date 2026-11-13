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

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => digitMap[digit] ?? digit);
}

export function isMetaOrderIntent(text: string): boolean {
  return orderIntentPattern.test(text);
}

export function isMetaOrderCancellation(text: string): boolean {
  return cancelOrderPattern.test(text.trim());
}

export function parseMetaOrderQuantity(
  text: string,
  allowBareNumber = false,
): number | null {
  const normalized = normalizeDigits(text);
  const match = normalized.match(
    allowBareNumber
      ? /^\s*(\d{1,3})\s*$/
      : /(?:الكمية(?:\s+المطلوبة)?|كمية(?:\s+مطلوبة)?|عدد|حبة|قطعة)\s*[:：]?\s*(\d{1,3})|(\d{1,3})\s*(?:حبة|قطعة|وحدات?)/iu,
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
    labeled ?? normalized.match(/[+]?\d[\d\s().-]{5,23}\d/u)?.[0]?.trim() ?? null;
  if (!candidate) return null;
  const digits = candidate.replace(/\D/gu, "");
  return digits.length >= 7 && digits.length <= 15
    ? `${candidate.startsWith("+") ? "+" : ""}${digits}`
    : null;
}