/**
 * product-draft-policy.ts
 *
 * Pure rules that decide what happens to an extracted product candidate and
 * which product fields still block publication. Extracted from the persistence
 * transaction in whatsapp-product-extraction.ts and the publication route so
 * the decisions can be unit tested without a database.
 */

import type { PriceStatus } from "./product-price-parsing.ts";

export type ProductFieldKey =
  | "name"
  | "description"
  | "price"
  | "currency"
  | "availability"
  | "media";

export type ProductDraftFields = {
  name: string | null | undefined;
  description: string | null | undefined;
  price: string | null | undefined;
  currency: string | null | undefined;
  availability: string | null | undefined;
  /** Omit to skip the media check (e.g. before media are attached). */
  mediaUrls?: readonly string[] | null;
};

/** Fields a merchant must fill before a product can be published to Meta. */
export const PRODUCT_PUBLICATION_REQUIRED_FIELDS: ProductFieldKey[] = [
  "name",
  "price",
  "currency",
  "availability",
  "media",
];

/** Fields worth completing but not enforced at publish time. */
export const PRODUCT_ADVISORY_FIELDS: ProductFieldKey[] = ["description"];

const fieldMessages: Record<ProductFieldKey, string> = {
  name: "اسم المنتج",
  description: "وصف المنتج",
  price: "السعر",
  currency: "العملة",
  availability: "حالة التوفر",
  media: "صورة أو فيديو واحد على الأقل",
};

export function productFieldMessage(field: ProductFieldKey): string {
  return fieldMessages[field];
}

export function missingProductFieldMessages(
  fields: readonly ProductFieldKey[],
): string[] {
  return fields.map((field) => fieldMessages[field]);
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Every field that is still empty. `media` is only reported when the caller
 * supplied `mediaUrls`, because a candidate that has not reached persistence
 * yet has no media to judge.
 */
export function missingProductFields(
  product: ProductDraftFields,
): ProductFieldKey[] {
  const missing: ProductFieldKey[] = [];
  if (!hasText(product.name)) missing.push("name");
  if (!hasText(product.description)) missing.push("description");
  if (!hasText(product.price)) missing.push("price");
  if (!hasText(product.currency)) missing.push("currency");
  if (!product.availability || product.availability === "unknown") {
    missing.push("availability");
  }
  if (product.mediaUrls !== undefined && product.mediaUrls !== null) {
    const usableMedia = product.mediaUrls.filter((url) => hasText(url));
    if (usableMedia.length === 0) missing.push("media");
  }
  return missing;
}

/** Missing fields that stop publication. */
export function productPublicationBlockers(
  product: ProductDraftFields,
): ProductFieldKey[] {
  const missing = new Set(missingProductFields(product));
  return PRODUCT_PUBLICATION_REQUIRED_FIELDS.filter((field) =>
    missing.has(field),
  );
}

/** Missing fields that are worth fixing but do not stop publication. */
export function productAdvisoryFields(
  product: ProductDraftFields,
): ProductFieldKey[] {
  const missing = new Set(missingProductFields(product));
  return PRODUCT_ADVISORY_FIELDS.filter((field) => missing.has(field));
}

export function isProductPublishable(product: ProductDraftFields): boolean {
  return productPublicationBlockers(product).length === 0;
}

/**
 * What a merchant's decision on an extraction card writes into the catalog.
 *
 * The accept step used to condition the number on the unit
 * (`price && currency ? price : null`), which is how three live products ended
 * up with `raw_price_text = "2500"`, `price = null`, and a publication blocker
 * naming «السعر» — the digits the merchant wrote were thrown away in the one
 * step where a human had just chosen the card. A decision is not a guess: the
 * number is stored, and the fields that say how sure it is travel with it.
 *
 * Publication is still guarded where it belongs — `productPublicationBlockers`
 * requires a currency — so this drops nothing and permits no wrong post.
 */
export type AcceptedExtractionPriceFields = {
  price: string | null;
  currency: string | null;
  rawPriceText: string | null;
  priceStatus: PriceStatus | null;
};

export function acceptedExtractionProductFields(candidate: {
  price?: string | number | null;
  currency?: string | null;
  rawPriceText?: string | null;
  priceStatus?: string | null;
}): AcceptedExtractionPriceFields {
  const text = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") return null;
    return value.trim() ? value.trim() : null;
  };
  const price = text(candidate.price);
  // The label is kept as the reading wrote it; an unrecognised one is no claim
  // at all, so it becomes `null` rather than being coerced into a status.
  const stated = text(candidate.priceStatus);
  const status: PriceStatus | null =
    stated === "confirmed" || stated === "unquoted" || stated === "ambiguous"
      ? stated
      : stated === "missing"
        ? "missing"
        : null;
  return {
    price,
    currency: text(candidate.currency),
    rawPriceText: text(candidate.rawPriceText),
    priceStatus: price ? status : "missing",
  };
}

export type ProductDraftDecisionReason =
  | "auto_draft"
  | "not_product"
  | "missing_name"
  | "incomplete_extraction"
  | "duplicate_name"
  | "duplicate_sku"
  | "manual_review_required";

export type ProductDraftDecision = {
  canCreate: boolean;
  reason: ProductDraftDecisionReason;
  /** True when the name or the SKU already exists in the workspace catalog. */
  duplicate: boolean;
};

export type ProductDraftCandidate = {
  classification: "product" | "not_product";
  data: { name: string | null; sku: string | null };
  /** True only when every required field has literal evidence and confidence. */
  complete: boolean;
  seenNames: ReadonlySet<string>;
  seenSkus: ReadonlySet<string>;
  /**
   * Force review instead of an automatic draft. Set for candidates that came
   * from an image rather than from message text, where there is no quoted
   * evidence to check the extraction against.
   */
  manualReviewRequired?: boolean;
};

/**
 * Mirrors the rules that were inline in the persistence transaction: only a
 * classified product with a name, a complete extraction and no name/SKU clash
 * becomes a draft automatically. Everything else stays a suggestion for review.
 */
export function shouldAutoCreateProductDraft(
  candidate: ProductDraftCandidate,
  normalizedName: string,
  normalizedSku: string | null,
): ProductDraftDecision {
  const duplicateName = normalizedName ? candidate.seenNames.has(normalizedName) : false;
  const duplicateSku = normalizedSku ? candidate.seenSkus.has(normalizedSku) : false;
  const duplicate = duplicateName || duplicateSku;
  const refuse = (reason: ProductDraftDecisionReason): ProductDraftDecision => ({
    canCreate: false,
    reason,
    duplicate,
  });

  if (candidate.classification !== "product") return refuse("not_product");
  if (!candidate.data.name?.trim()) return refuse("missing_name");
  if (!candidate.complete) return refuse("incomplete_extraction");
  if (candidate.manualReviewRequired) return refuse("manual_review_required");
  if (duplicateName) return refuse("duplicate_name");
  if (duplicateSku) return refuse("duplicate_sku");
  return { canCreate: true, reason: "auto_draft", duplicate: false };
}

export type ProductDraftStatus =
  | "draft_created"
  | "possible_duplicate"
  | "review";

/** Suggestion status that follows from the draft decision. */
export function productSuggestionStatus(
  candidate: ProductDraftCandidate,
  decision: ProductDraftDecision,
): ProductDraftStatus {
  if (candidate.classification === "not_product") return "review";
  if (decision.duplicate) return "possible_duplicate";
  return decision.canCreate ? "draft_created" : "review";
}
