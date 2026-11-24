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
/** The noun forms Arabic grammar requires for a counted thing. */
export type ArabicCountForms = {
  /** Used for exactly one, with the count already in the phrase. */
  one: string;
  /** Used for exactly two — Arabic has a dual, not "2 + plural". */
  two: string;
  /** Used for 3–10: the broken plural, e.g. "منشورات". */
  few: string;
  /** Used for 11 and above: the singular accusative, e.g. "منشورًا". */
  many: string;
};

/**
 * "N things" in grammatical Arabic.
 *
 * The app's counts are read aloud (the header bell's accessibility label) and read
 * by merchants, and Arabic does not put a plural noun after every number: one and
 * two take a noun phrase of their own, three to ten take the plural, and eleven and
 * above take the singular. Writing `${count} منشورات` throughout produced "1
 * منشورات تحتاج إلى إجراء" and "12 منشورات", both of which read as a mistake.
 *
 * The count is formatted with `formatArabicNumber` so digits match the rest of the
 * app, and is treated as a whole number of items: these counts arrive as sums of
 * optional fields from a query response, so a non-integer or a missing value has to
 * degrade into a grammatical phrase rather than into "undefined منشورات".
 */
export function arabicCountPhrase(
  count: number,
  forms: ArabicCountForms,
): string {
  const whole = Number.isFinite(count) ? Math.floor(count) : 0;
  if (whole <= 1) return forms.one;
  if (whole === 2) return forms.two;
  if (whole <= 10) return `${formatArabicNumber(whole)} ${forms.few}`;
  return `${formatArabicNumber(whole)} ${forms.many}`;
}
