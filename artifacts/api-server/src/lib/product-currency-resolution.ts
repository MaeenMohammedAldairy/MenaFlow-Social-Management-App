/**
 * product-currency-resolution.ts
 *
 * Turns the currency evidence a product extraction quoted into an ISO 4217 code,
 * optionally using the workspace's business country to settle an ambiguity.
 *
 * The problem: merchants write prices the way they speak. «45 ريال» is how a
 * Yemeni or Saudi shop states a price — nobody writes «ريال يمني» in a WhatsApp
 * group. The strict resolver required the nationality adjective, so a bare «ريال»
 * produced `currency: null`, and `currency` is a required publication field. The
 * price survived (the quote «45 ريال» verifies exactly one amount) while the
 * currency did not, so the offer became a draft with a blocker instead of a
 * publishable product — for every price written normally.
 *
 * What this does **not** do is guess. The fallback fires only when all of these
 * hold, so no invariant of the extractor is loosened:
 *
 * 1. the strict resolver found nothing — an explicit «ريال يمني» or a literal
 *    `YER` in the quote still wins, unchanged;
 * 2. the quote contains a currency *word* («ريال», «دولار», «جنيه», «دينار»,
 *    «درهم», «ليرة», «يورو»);
 * 3. the workspace's country has a currency that word is actually used for — so
 *    «ريال» settles to `YER` for `YE` and to `SAR` for `SA`, while «دولار» in a
 *    Yemeni workspace still resolves to nothing, because Yemen's currency is not
 *    a dollar.
 *
 * The model still has to have claimed that same code in `data.currency`: the
 * caller compares the two and drops the pair when they disagree, exactly as
 * before. And a currency settled this way is flagged for manual review, because
 * it came from a setting rather than from the message.
 */

/** ISO 3166-1 alpha-2 → ISO 4217. Markets this product serves, plus the majors. */
const COUNTRY_CURRENCY: Record<string, string> = {
  YE: "YER",
  SA: "SAR",
  AE: "AED",
  QA: "QAR",
  KW: "KWD",
  BH: "BHD",
  OM: "OMR",
  JO: "JOD",
  LB: "LBP",
  SY: "SYP",
  IQ: "IQD",
  EG: "EGP",
  LY: "LYD",
  TN: "TND",
  DZ: "DZD",
  MA: "MAD",
  SD: "SDG",
  SO: "SOS",
  TR: "TRY",
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  MY: "MYR",
  ID: "IDR",
  PK: "PKR",
  IN: "INR",
  CN: "CNY",
  JP: "JPY",
  RU: "RUB",
  BR: "BRL",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  GR: "EUR",
  FI: "EUR",
  IE: "EUR",
};

/**
 * Currency words and the codes each is used for. Deliberately one-directional:
 * the lookup asks "is this country's currency written with this word?", never
 * "which country does this word mean?" — the second question has no single
 * answer and answering it is how a price gets the wrong currency.
 */
/**
 * Matches a currency word as a whole word.
 *
 * Arabic has no `\b` — JavaScript's word boundary is ASCII, and every Arabic
 * letter is a non-word character to it, so `\bريال\b` matches inside «ريالة».
 * The lookarounds do the job instead: not preceded by an Arabic letter unless it
 * is the definite article, and not followed by one. Plurals and broken plurals
 * are listed as their own stems because «دنانير» does not contain «دينار».
 */
function currencyWord(...stems: string[]): RegExp {
  const forms = stems.join("|");
  return new RegExp(
    `(?<![\\u0621-\\u064A])(?:ال)?(?:${forms})(?![\\u0621-\\u064A])`,
  );
}

const CURRENCY_WORD_CODES: Array<[RegExp, string[]]> = [
  [currencyWord("ريال", "ريالات", "ر\\s*\\.\\s*س"), ["YER", "SAR", "QAR", "OMR"]],
  [currencyWord("دولار", "دولارات"), ["USD", "CAD", "AUD"]],
  [currencyWord("جنيه", "جنيهات"), ["EGP", "SDG"]],
  [currencyWord("دينار", "دنانير"), ["JOD", "KWD", "BHD", "IQD", "TND", "DZD", "LYD"]],
  [currencyWord("درهم", "دراهم"), ["AED", "MAD"]],
  [currencyWord("ليره", "ليرات"), ["LBP", "SYP", "TRY"]],
  [currencyWord("يورو"), ["EUR"]],
];

/** Same normalization the strict resolver uses, so both see one spelling. */
function normalizeCurrencyText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase();
}

/**
 * Currency of a workspace's business country, or null when the country is unset
 * or not one this map knows. An unknown country must not fall back to a guess.
 */
export function countryCurrencyCode(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  return COUNTRY_CURRENCY[code] ?? null;
}

/**
 * A currency named with its nationality. The definite article is optional on
 * both halves because «الريال اليمني» is as normal a way to write it as
 * «ريال يمني», and the article was what made the stricter pattern miss.
 */
function namedCurrency(noun: string, nationality: string): RegExp {
  return new RegExp(`(?:ال)?${noun}\\s+(?:ال)?${nationality}`);
}

const EXPLICIT_CURRENCIES: Array<[RegExp, string]> = [
  [namedCurrency("ريال", "سعودي"), "SAR"],
  [namedCurrency("ريال", "يمني"), "YER"],
  [namedCurrency("ريال", "عماني"), "OMR"],
  [namedCurrency("ريال", "قطري"), "QAR"],
  [namedCurrency("دينار", "كويتي"), "KWD"],
  [namedCurrency("دينار", "بحريني"), "BHD"],
  [namedCurrency("دينار", "اردني"), "JOD"],
  [namedCurrency("درهم", "اماراتي"), "AED"],
  [namedCurrency("جنيه", "مصري"), "EGP"],
  [namedCurrency("دولار", "امريكي"), "USD"],
];

/**
 * The strict resolver: a literal three-letter code in the quote, or a currency
 * named with its nationality. Moved here unchanged from `product-extraction.ts`
 * so both resolution paths read one spelling of the rules.
 */
export function currencyCodeFromEvidence(value: string): string | null {
  const code = /(?:^|[^A-Za-z])([A-Za-z]{3})(?:$|[^A-Za-z])/.exec(value);
  if (code) return code[1]!.toUpperCase();

  const normalized = normalizeCurrencyText(value);
  return EXPLICIT_CURRENCIES.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export type CurrencyResolution = {
  code: string | null;
  /** True when the country settled an ambiguity the quote left open. */
  derivedFromCountry: boolean;
};

/**
 * Resolves the quoted evidence to a currency code.
 *
 * Strict first, country second, and never the other way round: «ريال سعودي» in a
 * Yemeni workspace is `SAR`, because the message said so.
 */
export function resolveCurrencyFromEvidence(input: {
  evidence: string | null | undefined;
  country?: string | null;
}): CurrencyResolution {
  const evidence = input.evidence?.trim();
  if (!evidence) return { code: null, derivedFromCountry: false };

  const strict = currencyCodeFromEvidence(evidence);
  if (strict) return { code: strict, derivedFromCountry: false };

  const countryCurrency = countryCurrencyCode(input.country ?? null);
  if (!countryCurrency) return { code: null, derivedFromCountry: false };

  const normalized = normalizeCurrencyText(evidence);
  const wordMatches = CURRENCY_WORD_CODES.some(
    ([pattern, codes]) => pattern.test(normalized) && codes.includes(countryCurrency),
  );
  return wordMatches
    ? { code: countryCurrency, derivedFromCountry: true }
    : { code: null, derivedFromCountry: false };
}

/**
 * Whether a verified currency pair had to be settled by the workspace's country.
 * Used to force a manual review: the number and the word are quoted from the
 * message, but the *which rial* answer came from a setting, so a human should
 * see it before it becomes a publishable price.
 */
export function isCurrencyDerivedFromCountry(input: {
  evidence: string | null | undefined;
  code: string | null | undefined;
  country?: string | null;
}): boolean {
  if (!input.code) return false;
  const resolved = resolveCurrencyFromEvidence({
    evidence: input.evidence,
    country: input.country,
  });
  return resolved.derivedFromCountry && resolved.code === input.code;
}
