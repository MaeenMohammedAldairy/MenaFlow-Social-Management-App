/**
 * product-extraction-fixtures.ts
 *
 * Turns merchant field reviews into benchmark fixtures, closing the loop the
 * review endpoint opened: `POST .../whatsapp-extractions/:id/review` stores a
 * correct/incorrect verdict per field, and until now nothing consumed it.
 *
 * A fixture is a case in the same shape as
 * `product-extraction.synthetic.jsonl`, so the existing benchmark harness can
 * replay it through `normalizeProductExtractionResponse` after any prompt or
 * model change and show whether the fields a merchant corrected still come out
 * wrong.
 *
 * Identifiers are hashed: a committed fixture must not carry a workspace or
 * message id from production.
 */

import { createHash } from "node:crypto";

import { toLocalProductExtractionSources } from "./product-extraction.ts";

export type ReviewFixtureSource = {
  id: string;
  groupId: string;
  messageTimestamp: string | null;
  replyToMessageId: string | null;
  text: string;
};

export type ReviewedSuggestion = {
  id: string;
  classification: "product" | "not_product";
  extractedData: {
    name: string | null;
    sku: string | null;
    aliases: string[];
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: "in_stock" | "out_of_stock" | "preorder" | null;
  };
  evidence: Record<string, string | null>;
  confidence: Record<string, number>;
  fieldReview: Record<string, boolean>;
  aiModel: string;
  reviewedAt: string | null;
  sources: ReviewFixtureSource[];
};

export type ReviewFixtureCase = {
  caseId: string;
  source: "merchant_review";
  aiModel: string;
  reviewedAt: string | null;
  classification: "product" | "not_product";
  /** Field verdicts exactly as the merchant gave them. */
  verdicts: Record<string, boolean>;
  /** Fields the merchant marked wrong; the regression the fixture records. */
  incorrectFields: string[];
  messages: ReviewFixtureSource[];
  target: {
    products: Array<{
      sourceMessageIds: string[];
      data: ReviewedSuggestion["extractedData"];
      evidence: Record<string, string | null>;
      confidence: Record<string, number>;
    }>;
    nonProductMessageIds: string[];
  };
};

export type ReviewVerdictSummary = {
  suggestions: number;
  reviewed: number;
  verdicts: number;
  correct: number;
  incorrect: number;
  /** Accuracy per field, so a weak field is visible without reading cases. */
  byField: Record<string, { correct: number; incorrect: number }>;
};

/** Stable, non-reversible identifier for a reviewed suggestion. */
export function reviewFixtureCaseId(suggestionId: string): string {
  return `rev-${createHash("sha256").update(suggestionId).digest("hex").slice(0, 12)}`;
}

function hasVerdicts(fieldReview: Record<string, boolean> | null | undefined): boolean {
  return Boolean(fieldReview) && Object.keys(fieldReview ?? {}).length > 0;
}

/**
 * Builds one benchmark case, or null when the suggestion teaches nothing:
 * no verdict recorded, no source messages, or sources without text (a fixture
 * with no text cannot be replayed through the normalizer).
 */
export function reviewFixtureFromSuggestion(
  suggestion: ReviewedSuggestion,
): ReviewFixtureCase | null {
  if (!hasVerdicts(suggestion.fieldReview)) return null;
  if (suggestion.sources.length === 0) return null;
  const messages = toLocalProductExtractionSources(suggestion.sources);
  if (!messages.some((message) => message.text.trim())) return null;

  const verdicts = Object.fromEntries(
    Object.entries(suggestion.fieldReview ?? {})
      .filter(([, correct]) => typeof correct === "boolean")
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, boolean>;
  if (Object.keys(verdicts).length === 0) return null;

  const localIds = messages.map((message) => message.id);
  return {
    caseId: reviewFixtureCaseId(suggestion.id),
    source: "merchant_review",
    aiModel: suggestion.aiModel,
    reviewedAt: suggestion.reviewedAt,
    classification: suggestion.classification,
    verdicts,
    incorrectFields: Object.entries(verdicts)
      .filter(([, correct]) => !correct)
      .map(([field]) => field),
    messages,
    target:
      suggestion.classification === "product"
        ? {
            products: [
              {
                sourceMessageIds: localIds,
                data: suggestion.extractedData,
                evidence: suggestion.evidence ?? {},
                confidence: suggestion.confidence ?? {},
              },
            ],
            nonProductMessageIds: [],
          }
        : { products: [], nonProductMessageIds: localIds },
  };
}

export function reviewFixturesFromSuggestions(
  suggestions: readonly ReviewedSuggestion[],
): ReviewFixtureCase[] {
  return suggestions
    .flatMap((suggestion) => {
      const fixture = reviewFixtureFromSuggestion(suggestion);
      return fixture ? [fixture] : [];
    })
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
}

/** Verdict accuracy across suggestions, per field and overall. */
export function summarizeReviewVerdicts(
  suggestions: readonly ReviewedSuggestion[],
): ReviewVerdictSummary {
  const byField: ReviewVerdictSummary["byField"] = {};
  let reviewed = 0;
  let verdicts = 0;
  let correct = 0;
  for (const suggestion of suggestions) {
    const entries = Object.entries(suggestion.fieldReview ?? {}).filter(
      ([, value]) => typeof value === "boolean",
    );
    if (entries.length === 0) continue;
    reviewed += 1;
    for (const [field, value] of entries) {
      verdicts += 1;
      if (value) correct += 1;
      const current = byField[field] ?? { correct: 0, incorrect: 0 };
      byField[field] = value
        ? { correct: current.correct + 1, incorrect: current.incorrect }
        : { correct: current.correct, incorrect: current.incorrect + 1 };
    }
  }
  return {
    suggestions: suggestions.length,
    reviewed,
    verdicts,
    correct,
    incorrect: verdicts - correct,
    byField: Object.fromEntries(
      Object.entries(byField).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

/** Deterministic JSONL, one case per line, matching the synthetic benchmark. */
export function serializeReviewFixtures(
  cases: readonly ReviewFixtureCase[],
): string {
  return cases.length
    ? `${cases.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`
    : "";
}
