/**
 * Reading a WhatsApp number the way a Saudi merchant types it.
 *
 * Pairing a WhatsApp account starts with a phone number, and the number arrives in
 * whatever shape the keyboard produced: Arabic-Indic digits (٠٥٦١٢٣٤٥٦٧), Persian
 * digits, a leading `00` instead of `+`, a local number with no country code at all,
 * or a mix of the above. Rejecting any of those sends the merchant back to the
 * keyboard to work out which spelling the app wants, on the one screen where they
 * are least able to tell what went wrong.
 *
 * The rules lived as a closure inside the 2,494-line sources screen, untestable.
 * `libphonenumber-js` is a plain dependency with no React Native in it, so this
 * module runs under `node:test` as-is — which is also why it folds the digits
 * itself instead of calling `normalizeArabicDigits` from `lib/formatting.ts`: the
 * plain-Node loader cannot resolve an extensionless relative import, and a tested
 * module in this app has no relative imports (see `lib/alert-routes.ts`,
 * `lib/onboarding-guard.ts`). Two regexes are the cheaper duplication.
 */
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js";

/** Arabic-Indic and Persian digits to the Latin ones `libphonenumber-js` reads. */
function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

/**
 * The country to assume for a number written without one, from the device locale
 * (`ar-SA` → SA, `en-US` → US). `undefined` when the locale carries no region,
 * which leaves the caller's fallback in charge.
 */
export function deviceCountryFromLocale(
  locale: string | null | undefined,
): CountryCode | undefined {
  if (!locale) return undefined;
  const region = locale
    .split("-")
    .slice(1)
    .find((part) => /^[a-z]{2}$/i.test(part));
  if (!region) return undefined;
  const upper = region.toUpperCase() as CountryCode;
  return getCountries().includes(upper) ? upper : undefined;
}

/** The device's own country, resolved once. Saudi Arabia when it cannot be told. */
export const deviceCountry: CountryCode =
  deviceCountryFromLocale(
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : null,
  ) ?? "SA";

/**
 * Parse a phone number for WhatsApp pairing, or `null` when nothing readable is in
 * it.
 *
 * Three attempts, cheapest first:
 * 1. as written, against the default country — handles `0561234567` and `+966561234567`;
 * 2. anything starting with `+` is returned even if the library calls it invalid,
 *    because the merchant spelled out the country code and only the provider can
 *    say whether the number exists;
 * 3. the digits alone re-read as international — handles `00966561234567` and
 *    `966 56 123 4567` typed without a leading `+`.
 */
export function parseWhatsAppPhoneNumber(
  value: string,
  defaultCountry: CountryCode = deviceCountry,
): PhoneNumber | null {
  const normalizedNumber = toLatinDigits(value).trim().replace(/^00/, "+");

  const parsedNumber = parsePhoneNumberFromString(
    normalizedNumber,
    defaultCountry,
  );
  if (parsedNumber?.isValid() || normalizedNumber.startsWith("+")) {
    return parsedNumber ?? null;
  }

  const digitsOnly = normalizedNumber.replace(/\D/g, "");
  const parsedInternationalNumber = parsePhoneNumberFromString(
    `+${digitsOnly}`,
  );
  return parsedInternationalNumber?.isValid()
    ? parsedInternationalNumber
    : (parsedNumber ?? null);
}
