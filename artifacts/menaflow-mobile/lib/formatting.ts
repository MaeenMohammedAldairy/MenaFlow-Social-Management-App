// Latin digits: the app formats prices, phone numbers and IDs that users type
// with Western digits, so matching them avoids cross-script comparisons.
export const ARABIC_LOCALE = "ar-EG-u-nu-latn";

export function normalizeArabicDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

export function formatArabicNumber(value: number): string {
  return normalizeArabicDigits(new Intl.NumberFormat(ARABIC_LOCALE).format(value));
}

export function formatArabicCurrency(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;

  const amount =
    typeof value === "number"
      ? value
      : Number(normalizeArabicDigits(value).replace(/,/g, ""));
  if (!Number.isFinite(amount)) return `${value} ${currency ?? ""}`.trim();
  if (!currency) return formatArabicNumber(amount);

  try {
    return normalizeArabicDigits(
      new Intl.NumberFormat(ARABIC_LOCALE, {
        style: "currency",
        currency: currency.toUpperCase(),
        currencyDisplay: "name",
        maximumFractionDigits: 2,
      }).format(amount),
    );
  } catch {
    return `${formatArabicNumber(amount)} ${currency}`;
  }
}

export function formatArabicDate(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" },
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return normalizeArabicDigits(new Intl.DateTimeFormat(ARABIC_LOCALE, options).format(date));
}

export function formatArabicDateTime(
  value: Date | string | number | null | undefined,
): string | null {
  return formatArabicDate(value, { dateStyle: "short", timeStyle: "short" });
}