/**
 * Pure policy for the Message → Product intake path.
 *
 * These rules are deliberately free of database and provider calls so they can
 * be exercised directly by Node tests and reused by the webhook, the worker and
 * the review routes without drifting apart.
 */

import { createHash } from "node:crypto";
import { normalizedProductName } from "./product-utils.ts";

/** Stable delivery key for an Evolution event; volatile fields are excluded. */
export function evolutionWebhookEventKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const event = typeof root.event === "string" ? root.event : "unknown";
  const instance = typeof root.instance === "string" ? root.instance : "";
  const data = root.data as Record<string, unknown> | undefined;
  const upsert = data?.upsert as Record<string, unknown> | undefined;
  const message =
    (upsert?.message as Record<string, unknown> | undefined) ??
    (data?.message as Record<string, unknown> | undefined) ??
    {};
  const key = (message.key as Record<string, unknown> | undefined) ?? {};
  const messageId = typeof key.id === "string" ? key.id : null;
  if (!messageId) return null;
  return createHash("sha256")
    .update(
      [
        "evolution",
        event,
        instance,
        messageId,
        typeof key.fromMe === "boolean" ? String(key.fromMe) : "",
        typeof key.remoteJid === "string" ? key.remoteJid : "",
      ].join(":"),
    )
    .digest("hex");
}

export type SenderRole = "merchant" | "customer" | "unknown";
export type MatchStrategy =
  | "exact_sku"
  | "exact_name"
  | "alias_match"
  | "fuzzy_candidate"
  | "new_product";

export type ExtractedDataLike = {
  name?: string | null;
  sku?: string | null;
  aliases?: string[];
  description?: string | null;
  price?: string | null;
  currency?: string | null;
  availability?: string | null;
};

export type ConfidenceInput = {
  data: ExtractedDataLike;
  evidence: Record<string, string | null>;
  senderRole?: SenderRole;
  multiplePriceMentions?: boolean;
  currencyDerivedFromCountry?: boolean;
  vision?: boolean;
  generatedSku?: boolean;
};

export type MatchableProduct = {
  id: string;
  name: string;
  sku: string | null;
  aliases?: string[];
  normalizedName?: string | null;
};

export type MatchInput = {
  name?: string | null;
  sku?: string | null;
  aliases?: string[];
  products: readonly MatchableProduct[];
};

export type MatchResult = {
  strategy: MatchStrategy;
  score: number;
  productId: string | null;
  reasons: string[];
};

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10000) / 10000));
}

function hasEvidence(evidence: Record<string, string | null>, field: string): boolean {
  return typeof evidence[field] === "string" && Boolean(evidence[field]!.trim());
}

/** Converts model-declared confidence into a server-owned, auditable number. */
export function computeExtractionConfidence(input: ConfidenceInput): number {
  const weights: Array<[keyof ExtractedDataLike, number]> = [
    ["name", 0.35],
    ["price", 0.2],
    ["currency", 0.1],
    ["availability", 0.1],
    ["description", 0.1],
    ["aliases", 0.05],
  ];
  let score = 0;
  for (const [field, weight] of weights) {
    const value = input.data[field];
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!present) continue;
    score += weight * (hasEvidence(input.evidence, field) ? 1 : 0.45);
  }

  const senderRole = input.senderRole ?? "unknown";
  score += senderRole === "merchant" ? 0.05 : senderRole === "unknown" ? -0.1 : -0.25;
  if (input.multiplePriceMentions) score -= 0.2;
  if (input.currencyDerivedFromCountry) score -= 0.1;
  if (input.vision) score -= 0.15;
  if (input.generatedSku) score -= 0.02;
  return clamp(score);
}

/** Merchant-authored messages are catalog facts; customer messages are signals. */
export function classifySenderRole(input: {
  fromMe?: boolean;
  senderId?: string | null;
  merchantSenderIds?: readonly string[];
}): SenderRole {
  if (input.fromMe) return "merchant";
  if (
    input.senderId &&
    input.merchantSenderIds?.some((id) => id === input.senderId)
  ) {
    return "merchant";
  }
  if (input.senderId) return "customer";
  return "unknown";
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizedProductName(value)
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function similarity(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  // A shorter name inside a longer one is still a strong signal; one shared
  // word alone is not enough to call two products the same.
  return shared < 2 ? 0 : shared / Math.min(a.size, b.size);
}

/**
 * Finds the existing product a suggestion is most likely describing.
 * An exact SKU is a hard match: creating a second product is never allowed
 * without an explicit, logged override.
 */
export function matchProductCandidate(input: MatchInput): MatchResult {
  const name = input.name?.trim() ?? "";
  const normalizedName = normalizedProductName(name);
  const sku = input.sku?.trim().toUpperCase() ?? null;
  const aliases = (input.aliases ?? []).map(normalizedProductName).filter(Boolean);

  if (sku) {
    const bySku = input.products.find(
      (product) => product.sku?.trim().toUpperCase() === sku,
    );
    if (bySku) {
      return {
        strategy: "exact_sku",
        score: 1,
        productId: bySku.id,
        reasons: ["SKU مطابق لمنتج موجود في المساحة"],
      };
    }
  }

  if (normalizedName) {
    const byName = input.products.find(
      (product) =>
        (product.normalizedName ?? normalizedProductName(product.name)) ===
        normalizedName,
    );
    if (byName) {
      return {
        strategy: "exact_name",
        score: 1,
        productId: byName.id,
        reasons: ["الاسم مطابق لمنتج موجود في المساحة"],
      };
    }

    for (const product of input.products) {
      const productAliases = (product.aliases ?? []).map(normalizedProductName);
      if (
        productAliases.includes(normalizedName) ||
        aliases.some(
          (alias) =>
            alias === normalizedProductName(product.name) ||
            productAliases.includes(alias),
        )
      ) {
        return {
          strategy: "alias_match",
          score: 0.95,
          productId: product.id,
          reasons: ["الاسم أو أحد الأسماء البديلة مطابق لمنتج موجود"],
        };
      }
    }
  }

  let best: MatchResult = {
    strategy: "new_product",
    score: 0,
    productId: null,
    reasons: ["لا يوجد منتج مطابق في المساحة"],
  };
  if (!normalizedName) return best;

  for (const product of input.products) {
    const score = similarity(normalizedName, product.name);
    if (score >= 0.82 && score > best.score) {
      best = {
        strategy: "fuzzy_candidate",
        score,
        productId: product.id,
        reasons: ["تطابق قوي مع اسم منتج موجود — يحتاج تأكيد التاجر"],
      };
    }
  }
  return best;
}

/** Exact matches must never silently create a duplicate catalog row. */
export function requiresOverrideReason(strategy: MatchStrategy): boolean {
  return strategy === "exact_sku" || strategy === "exact_name" || strategy === "alias_match";
}

export type DiffEntry = {
  before: unknown;
  after: unknown;
  evidence: string | null;
};

/** Builds a reviewable diff for only the fields the merchant may update. */
export function buildChangeDiff(
  fields: readonly string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  evidence: Record<string, string | null> = {},
): Record<string, DiffEntry> {
  const diff: Record<string, DiffEntry> = {};
  for (const field of fields) {
    const previous = before[field] ?? null;
    const next = after[field] ?? null;
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    diff[field] = { before: previous, after: next, evidence: evidence[field] ?? null };
  }
  return diff;
}
