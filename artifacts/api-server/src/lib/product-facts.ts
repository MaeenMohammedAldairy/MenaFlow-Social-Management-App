/**
 * product-facts.ts
 *
 * The parts of an offer that are not a name, a price or a description.
 *
 * A merchant writes «مزود ب12 رأس» and «ضد الماء 30 متر» inside one long
 * paragraph, and until now that paragraph was *only* a description: nothing
 * structured, nothing searchable, nothing a publication or an update diff could
 * compare. That is a loss of fidelity, not a loss of text — the words survive,
 * the meaning is buried.
 *
 * A fact is therefore stored as a value plus the words that prove it. A value
 * with no proof is kept but flagged `verified: false`, so the review card can
 * show it as a suggestion rather than as catalog truth.
 *
 * Pure: no database, no model, no side effects.
 */

import { normalizePriceText } from "./product-price-parsing.ts";

export const PRODUCT_FACT_KINDS = [
  "features",
  "specifications",
  "accessories",
] as const;

export type ProductFactKind = (typeof PRODUCT_FACT_KINDS)[number];

export type ProductFact = {
  /** The merchant's own words for the fact, verbatim. */
  value: string;
  /** Which source message proves it, among the ids given to the model. */
  sourceId: string | null;
  /** The literal quote the value was taken from. */
  quote: string | null;
  start: number | null;
  end: number | null;
  /** True when the value is contained in a quote that is in a source. */
  verified: boolean;
};

export const MAX_FACTS_PER_KIND = 20;
export const MAX_FACT_VALUE_LENGTH = 200;

const KIND_LABELS: Record<ProductFactKind, string> = {
  features: "مزايا",
  specifications: "مواصفات",
  accessories: "ملحقات",
};

export function productFactLabel(kind: ProductFactKind): string {
  return KIND_LABELS[kind];
}

function boundedValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, MAX_FACT_VALUE_LENGTH);
}

/**
 * Comparison form of Arabic text: hamza forms, teh marbuta and the
 * alef-maqsurah are spelling habits, not different words. A quote of «تأتي»
 * has to find the merchant's «تاتي» (and the other way round), or a fact the
 * merchant wrote verbatim would be thrown away for a dot.
 */
function foldArabic(value: string): string {
  return normalizePriceText(value)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function containsValue(haystack: string, needle: string): boolean {
  const left = foldArabic(haystack);
  const right = foldArabic(needle);
  return Boolean(right) && left.includes(right);
}

function spanOf(sourceText: string, quote: string): { start: number; end: number } | null {
  const index = sourceText.indexOf(quote);
  if (index < 0) return null;
  return { start: index, end: index + quote.length };
}

/**
 * Validates one model-supplied fact list against the source text.
 *
 * `sourceText` is the joined text of the messages the item claims, and
 * `visibleText` (when present) is the model's own transcription of the images
 * — a fact read off a photo is as grounded as a fact read off a message, so
 * both corpora count, and which one did it is recorded in `sourceId`.
 */
export function normalizeProductFacts(
  raw: unknown,
  options: {
    sourceText: string;
    visibleText?: string | null;
    allowedSourceIds: readonly string[];
  },
): ProductFact[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(options.allowedSourceIds);
  const visibleText = options.visibleText?.trim() ?? "";
  const seen = new Set<string>();
  const facts: ProductFact[] = [];
  for (const entry of raw) {
    const item = entry && typeof entry === "object"
      ? (entry as Record<string, unknown>)
      : null;
    const value = boundedValue(item?.value ?? item?.text);
    if (!value) continue;
    const key = normalizePriceText(value);
    if (!key || seen.has(key)) continue;
    const quote = boundedValue(item?.evidence ?? item?.quote);
    const fromSource = Boolean(quote) && containsValue(options.sourceText, quote!);
    const fromImage = !fromSource &&
      Boolean(quote) &&
      containsValue(visibleText, quote!);
    if (quote && !fromSource && !fromImage) continue;
    const grounded = containsValue(fromImage ? visibleText : options.sourceText, value);
    if (!grounded) continue;
    const span = fromSource
      ? spanOf(options.sourceText, quote!)
      : fromImage
        ? spanOf(visibleText, quote!)
        : null;
    const sourceId = typeof item?.sourceId === "string" && allowed.has(item.sourceId)
      ? item.sourceId
      : typeof item?.source_id === "string" && allowed.has(item.source_id)
        ? item.source_id
        : null;
    seen.add(key);
    facts.push({
      value,
      sourceId,
      quote: quote ?? null,
      start: span?.start ?? null,
      end: span?.end ?? null,
      // A value with no quote at all is a lead, never catalog truth.
      verified: Boolean(quote),
    });
    if (facts.length >= MAX_FACTS_PER_KIND) break;
  }
  return facts;
}

export type ProductFactMap = Record<ProductFactKind, ProductFact[]>;

export function emptyProductFacts(): ProductFactMap {
  return { features: [], specifications: [], accessories: [] };
}

/** Validates all three kinds from one model `data` object. */
export function normalizeProductFactMap(
  rawData: Record<string, unknown> | null | undefined,
  options: {
    sourceText: string;
    visibleText?: string | null;
    allowedSourceIds: readonly string[];
  },
): ProductFactMap {
  return {
    features: normalizeProductFacts(rawData?.features, options),
    specifications: normalizeProductFacts(rawData?.specifications, options),
    accessories: normalizeProductFacts(rawData?.accessories, options),
  };
}

/**
 * Replaces the short ids a model was shown with the real message ids, dropping a
 * fact whose source does not resolve: a value pointing at a message nobody gave
 * it is not evidence, and re-pointing it at a guess would make it look like one.
 */
export function remapFactSourceIds(
  facts: ProductFactMap,
  sourceIdById: ReadonlyMap<string, string>,
): ProductFactMap {
  const remap = (list: ProductFact[]): ProductFact[] =>
    list.flatMap((fact) => {
      if (fact.sourceId === null) return [fact];
      const resolved = sourceIdById.get(fact.sourceId);
      return resolved ? [{ ...fact, sourceId: resolved }] : [];
    });
  return {
    features: remap(facts.features),
    specifications: remap(facts.specifications),
    accessories: remap(facts.accessories),
  };
}

/** Counts only the facts a merchant can act on without re-checking the text. */
export function unverifiedFactCount(facts: ProductFactMap): number {
  return PRODUCT_FACT_KINDS.reduce(
    (total, kind) =>
      total + facts[kind].filter((fact) => !fact.verified).length,
    0,
  );
}

export function totalFactCount(facts: ProductFactMap): number {
  return PRODUCT_FACT_KINDS.reduce((total, kind) => total + facts[kind].length, 0);
}
