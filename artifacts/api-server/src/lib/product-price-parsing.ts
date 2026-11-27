/**
 * product-price-parsing.ts
 *
 * Reading a price the way a Yemeni or Gulf merchant writes one.
 *
 * The extraction path used to accept a price only when a currency word sat
 * directly next to the digits, so «25 ألف», «20 الف» and «30$» produced nothing
 * at all — silently, because the field was nulled instead of reported. Live
 * measurement: 0 of 12 product suggestions carried a price while 8 messages in
 * the same workspace mentioned one.
 *
 * This module separates the two jobs that were tangled together:
 *   • *parse* what the merchant wrote (a number, a thousands word, a separator);
 *   • *report* how well it is grounded (`confirmed` / `unquoted` / `ambiguous`),
 *     which is what decides whether a product may be drafted automatically.
 *
 * Pure: no database, no model, no side effects.
 */

/**
 * Words that scale a number instead of naming a currency.
 *
 * The hamza is optional in writing the way merchants write it: «25 ألف» and
 * «25 الف» are the same thousand, and «الاف»/«آلاف» are the same thousands. A
 * pattern that insisted on one spelling read «25 الف» as a bare 25, which is how
 * a scaled price was lost rather than mis-scaled.
 */
const THOUSANDS_WORDS = String.raw`(?:[أآا]?ل[ا]?ف(?:ين|ان)?|[kK])`;

/** Currency words and codes, including the shapes the old pattern missed. */
const CURRENCY_TOKEN = String.raw`(?:ر\s*ي+\s*ا+\s*ل+|ر\.?\s*س\.?|SAR|YER|USD|EUR|دولار(?:ات)?|سعودي(?:ة|ه)?|دينار|درهم|جنيه|يورو|ليرة|ليره)`;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_INDIC = "۰۱۲۳۴۵۶۷۸۹";
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

export type PriceMention = {
  /** The digits as written, in Latin form, separators kept. */
  raw: string;
  /** Currency words touching the number, in the order they were written. */
  currencies: string[];
  /** Decimal string (`"25000"`, `"2500.50"`) after separators/multipliers. */
  value: string;
  /** The number was scaled by «ألف»/«k». */
  multiplied: boolean;
  /** A currency word or code sits next to the number. */
  hasCurrency: boolean;
  /** Offset of the match in the normalized text. */
  index: number;
  /**
   * The words written between this number and the numbers (or the line) around
   * it — the only text that can say *which* currency this amount is in.
   *
   * `currencies` answers "is there a currency word touching the digits"; it is
   * one matched token, and «ريال يمني» is two. Resolving a currency code needs
   * the whole phrase, and it must not reach past the next number: in
   * «بـ 3,000 او 21 ريال سعودي» the rial belongs to the 21, and reading it onto
   * the 3,000 would print a Saudi price on a Yemeni amount.
   */
  neighbourhood: string;
};

/**
 * Arabic-Indic digits to Latin; diacritics and tatweel removed.
 *
 * Tatweel («ريــال») is decoration, and without this a decorative spelling of
 * the currency word would read as "no price mentioned".
 */
export function normalizePriceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_INDIC.indexOf(digit)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns one written number into a decimal string.
 *
 * `1,500` and `1.500` are thousands groups (English and European habits),
 * while `2.50` is a decimal. The rule that tells them apart is the group size:
 * exactly three digits after the last separator means a thousands separator.
 */
function toDecimal(digits: string): string | null {
  const grouped = /^(\d{1,3})(?:[,.\u066C]\d{3})+$/.exec(digits);
  if (grouped) return digits.replace(/[,.\u066C]/g, "");
  const decimal = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(digits);
  if (!decimal) return null;
  return decimal[2] ? `${decimal[1]}.${decimal[2]}` : decimal[1];
}

function applyMultiplier(value: string, multiplier: string): string | null {
  const word = multiplier.toLocaleLowerCase();
  const scale = /ين|ان/.test(word) ? 2_000 : 1_000;
  const [whole, fraction = ""] = value.split(".");
  const scaled = `${BigInt(whole) * BigInt(scale)}${fraction ? `.${fraction}` : ""}`;
  return scaled.replace(/\.+$/, "");
}

const NUMBER_BODY = String.raw`\d+(?:[.,\u066C]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
/** Lead-in that makes a following number a price («فقط بـ 2500»). */
const PRICE_LEAD_IN = new RegExp(String.raw`(?:فقط\s*ب|بالريال|بالسعودي)\s*$`, "u");

/**
 * A currency word plus the qualifier written directly after it — «ريال يمني»,
 * «الريال السعودي» — which is the half a token-by-token scan loses.
 */
const CURRENCY_PHRASE = new RegExp(
  String.raw`(?:${CURRENCY_TOKEN})(?:\s+(?:ال)?[\p{L}\p{M}_]+)?`,
  "u",
);

/**
 * Every number in the text, priced or not, with its grounding flags.
 *
 * Adjacency is read from the context around the digits rather than from one
 * long alternation, so «45 ريال», «ريال 45», «25 ألف», «25 ألف ريال» and «30$»
 * share one rule: a currency word before or after, or a thousands word right
 * after.
 */
export function findNumberMentions(text: string): PriceMention[] {
  const normalized = normalizePriceText(text);
  if (!normalized) return [];
  const currencyBefore = new RegExp(String.raw`(?:${CURRENCY_TOKEN})\s*$`, "u");
  const currencyAfter = new RegExp(String.raw`^\s*\$?\s*(?:${CURRENCY_TOKEN})|\s*\$`, "u");
  const multiplierAfter = new RegExp(String.raw`^\s*(${THOUSANDS_WORDS})(?![\p{L}])`, "u");
  const currencyWordsBefore = new RegExp(
    String.raw`(${CURRENCY_TOKEN})[^\p{N}]*$`,
    "u",
  );
  const currencyWordsAfter = new RegExp(
    String.raw`^[^\p{N}]*(${CURRENCY_TOKEN})`,
    "u",
  );
  const numbers = new RegExp(NUMBER_BODY, "g");
  const mentions: PriceMention[] = [];
  for (const match of normalized.matchAll(numbers)) {
    const digits = match[0];
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 24), index);
    const after = normalized.slice(index + digits.length, index + digits.length + 24);
    const decimal = toDecimal(digits);
    if (!decimal) continue;
    const scaled = multiplierAfter.exec(after);
    const value = scaled ? applyMultiplier(decimal, scaled[1]) : decimal;
    if (!value) continue;
    const currencies = [
      ...(currencyWordsBefore.exec(before)?.slice(1) ?? []),
      ...(currencyWordsAfter.exec(after)?.slice(1) ?? []),
    ];
    // A neighbourhood ends where another number or another line begins, so a
    // bundle joined into one text cannot lend one message's currency to another.
    const boundary = /\p{N}|\n/u;
    const nextNumber = after.search(boundary);
    const afterWords = nextNumber === -1 ? after : after.slice(0, nextNumber);
    const beforeMatch = [...before.matchAll(new RegExp(boundary.source, "gu"))].at(-1);
    const beforeWords = before.slice((beforeMatch?.index ?? -1) + 1);
    // Keep the currency phrase, not the whole window: the card shows this text,
    // and «واط) بشاشة لمس — بسعر» around a number is not evidence of a unit.
    const phraseBefore = [
      ...beforeWords.matchAll(new RegExp(CURRENCY_PHRASE.source, "gu")),
    ].at(-1)?.[0];
    const phraseAfter = new RegExp(
      // `String.raw`, not a plain template: `\s` inside one is the letter `s`,
      // and a pattern of `^s*` matches every phrase while saying nothing about
      // whitespace — which is how this line silently returned `undefined`.
      String.raw`^\s*(${CURRENCY_PHRASE.source})`,
      "u",
    ).exec(afterWords)?.[0];
    const neighbourhood = [phraseBefore, phraseAfter]
      .filter(Boolean)
      .join(" ")
      .trim();
    mentions.push({
      raw: digits,
      value,
      currencies,
      neighbourhood,
      multiplied: Boolean(scaled),
      hasCurrency:
        currencies.length > 0 ||
        currencyBefore.test(before) ||
        currencyAfter.test(after) ||
        PRICE_LEAD_IN.test(before),
      index,
    });
  }
  return dedupeMentions(mentions);
}

function dedupeMentions(mentions: PriceMention[]): PriceMention[] {
  const seen = new Set<string>();
  const result: PriceMention[] = [];
  for (const mention of mentions) {
    const key = `${mention.value}@${mention.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mention);
  }
  return result;
}

/**
 * Every number in the text that reads as a price: a currency word beside it, a
 * thousands word after it, or a «فقط بـ» lead-in.
 */
export function findPriceMentions(text: string): PriceMention[] {
  return findNumberMentions(text).filter(
    (mention) => mention.hasCurrency || mention.multiplied,
  );
}

/** True when the text offers more than one distinct price — never guess. */
export function hasAmbiguousPriceMentions(text: string): boolean {
  return new Set(findPriceMentions(text).map((mention) => mention.value)).size > 1;
}

export type PriceStatus =
  /** One price in the quoted evidence, matched by the extracted value. */
  | "confirmed"
  /** The value appears in a source but the quote does not ground a price. */
  | "unquoted"
  /** The source offers several prices; the value needs a human choice. */
  | "ambiguous"
  /** No price was written anywhere in the sources. */
  | "missing";

export type ParsedPrice = {
  /** Decimal string, or `null` when there is nothing trustworthy to store. */
  price: string | null;
  status: PriceStatus;
  /** The merchant's own words for the number, kept verbatim for the card. */
  raw: string | null;
  /**
   * The text written around the number the value was matched in, or `null`.
   *
   * A currency is decided by what sits next to the amount, and the quote a model
   * returns is often just the digits («2500»). Handing the caller this phrase is
   * what lets `product-currency-resolution.ts` read «2500 ريال يمني» from the
   * merchant's own message instead of giving up: measured on the live workspace,
   * 0 of 57 suggestions had a currency because nothing looked past the quote.
   */
  currencyEvidence: string | null;
};

const PLAIN_AMOUNT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

function normalizeCandidate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return PLAIN_AMOUNT.test(String(value)) ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const text = normalizePriceText(value);
  if (!text) return null;
  // A model may echo the merchant's phrasing («25 ألف») instead of the number.
  const [mention] = findPriceMentions(text);
  const decimal = mention && PLAIN_AMOUNT.test(mention.value)
    ? mention.value
    : toDecimal(text);
  return decimal && PLAIN_AMOUNT.test(decimal) ? decimal : null;
}

/**
 * Resolves what the model claimed for `price` against the merchant's own text.
 *
 * The claim is never accepted on its own, and it is never thrown away over a
 * formatting detail either: when the digits are written in a source but the
 * quote does not ground them as a price, the value is kept and marked
 * `unquoted` so a human decides. Only a claim found nowhere is dropped.
 */
export function resolveExtractedPrice(input: {
  claimed: unknown;
  evidenceQuote: string | null;
  sourceText: string;
}): ParsedPrice {
  const sourceMentions = findPriceMentions(input.sourceText);
  const distinctSourcePrices = new Set(sourceMentions.map((mention) => mention.value));
  const candidate = normalizeCandidate(input.claimed);
  if (!candidate) {
    return {
      price: null,
      // A lone written price with no usable claim stays a gap, not a guess;
      // several of them are reported as the ambiguity the merchant created.
      status: distinctSourcePrices.size > 1 ? "ambiguous" : "missing",
      raw: distinctSourcePrices.size === 1 ? sourceMentions[0]?.raw ?? null : null,
      currencyEvidence: null,
    };
  }
  const quoteMentions = findPriceMentions(input.evidenceQuote ?? "");
  const quoteMatch = quoteMentions.find((mention) => mention.value === candidate);
  const sourceMatchAll = findNumberMentions(input.sourceText);
  const sourceMatchPrice = sourceMentions.find(
    (mention) => mention.value === candidate,
  );
  const sourceMatchNumber = sourceMatchAll.find(
    (mention) => mention.value === candidate,
  );
  const currencyEvidence = (sourceMatchPrice ?? sourceMatchNumber)?.neighbourhood ??
    quoteMatch?.neighbourhood ??
    null;
  if (quoteMatch) {
    const grounded = quoteMatch.hasCurrency || quoteMatch.multiplied;
    // One rule for the whole function: more than one price written in the
    // sources is an open question, whatever the quote managed to pin down. It is
    // still reported with its number, so the reviewer chooses instead of
    // guessing why a field is empty.
    const status: PriceStatus = distinctSourcePrices.size > 1
      ? "ambiguous"
      : grounded
        ? "confirmed"
        : "unquoted";
    return { price: candidate, status, raw: quoteMatch.raw, currencyEvidence };
  }
  if (sourceMatchPrice) {
    return {
      price: candidate,
      status: distinctSourcePrices.size > 1 ? "ambiguous" : "unquoted",
      raw: sourceMatchPrice.raw,
      currencyEvidence,
    };
  }
  // The number is written in the source but nothing around it says «price» — a
  // weight, a count, a size could read the same. Kept, and flagged: the field is
  // not thrown away, and it cannot become a draft on its own.
  const writtenNumber = sourceMatchNumber;
  if (writtenNumber) {
    return {
      price: candidate,
      status: distinctSourcePrices.size > 1 ? "ambiguous" : "unquoted",
      raw: writtenNumber.raw,
      currencyEvidence,
    };
  }
  return { price: null, status: "missing", raw: null, currencyEvidence: null };
}

/**
 * Currency families written in a text, so «١٢٥ ريال أو ١٢٥ دولار» is read as an
 * open question about the currency and not as two prices.
 *
 * «سعودي» and «يمني» qualify the rial rather than adding a currency: the word
 * that decides *which* rial is exactly the one the workspace country is allowed
 * to settle, so folding them together is what keeps «45 ريال سعودي» a single,
 * grounded currency.
 */
export function distinctCurrencyFamilies(text: string): string[] {
  const normalized = normalizePriceText(text);
  const families = new Set<string>();
  if (/(?:ر\s*ي+\s*ا+\s*ل+|SAR|YER|سعود|يمني)/i.test(normalized)) {
    families.add("riyal");
  }
  if (/(?:دولار|USD)/i.test(normalized)) families.add("dollar");
  if (/(?:يورو|EUR)/i.test(normalized)) families.add("euro");
  if (/دينار/.test(normalized)) families.add("dinar");
  if (/درهم/.test(normalized)) families.add("dirham");
  if (/(?:جنيه|لير[ةه])/.test(normalized)) families.add("pound");
  return [...families];
}

/** Whether a price is grounded well enough to reach a product without a choice. */
export function isPriceReadyForDraft(status: PriceStatus | null | undefined): boolean {
  return status === "confirmed";
}
