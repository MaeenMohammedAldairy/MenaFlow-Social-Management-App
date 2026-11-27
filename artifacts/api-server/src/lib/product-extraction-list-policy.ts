/**
 * How the WhatsApp product review queue is listed.
 *
 * The catalog shows a merchant what the extraction found and asks for a decision
 * on each item, so the list has to be able to say "these three need you" instead
 * of dumping every message the importer ever saw. Two things made that
 * impossible: the endpoint returned a flat, unfiltered page of 50, and
 * `not_product` suggestions — a message that turned out to be a post candidate,
 * a greeting, an order — were indistinguishable from real products in the
 * response. On the live workspace that meant 18 empty «لم يستخرج منتجًا من
 * الرسالة» cards crowding out the 2 suggestions that actually had a product in
 * them, and anything past the 50th row was unreachable.
 *
 * Pure on purpose: no `@workspace/db`, so the parsing, clamping and counting
 * rules are unit-testable on their own.
 */

/** One page of the review queue. Larger pages just move the problem around. */
export const PRODUCT_EXTRACTION_LIST_MAX_LIMIT = 50;

/**
 * Ceiling for `offset`.
 *
 * `OFFSET` costs a row scan per skipped row, so an arbitrarily large offset is a
 * way to make the database work for nothing. A review queue deeper than this is a
 * backlog to clear, not a list to page through.
 */
export const PRODUCT_EXTRACTION_LIST_MAX_OFFSET = 10_000;

const CLASSIFICATIONS = ["product", "not_product"] as const;
/**
 * The statuses this queue can name. Exported because the database has to allow
 * exactly them: a `CHECK` narrower than this list is not a typo, it is a silent
 * write failure — six re-extractions in the live workspace died on one, and the
 * contract test compares this list against the migration.
 */
export const PRODUCT_EXTRACTION_LIST_STATUSES = [
  "review",
  "draft_created",
  "possible_duplicate",
  "update_proposed",
  "accepted_update",
  "rejected_update",
  "superseded",
] as const;

export type ProductExtractionClassification = (typeof CLASSIFICATIONS)[number];
export type ProductExtractionListStatus =
  (typeof PRODUCT_EXTRACTION_LIST_STATUSES)[number];

/**
 * Statuses the review queue keeps out of sight until somebody asks for them.
 *
 * A group's version chain is history, not work: once a re-extraction supersedes
 * the older card, showing both is the duplicate the merchant was complaining
 * about — two cards for one offer, one of them already answered. `dismissed`
 * stays hidden unconditionally (it is a decision, not a state to review), while
 * `superseded` is listed on request, because «what did the new version change?»
 * is a fair question about a product the merchant already accepted or edited.
 */
export const PRODUCT_EXTRACTION_DEFAULT_HIDDEN_STATUSES = [
  "superseded",
] as const;

export type ProductExtractionHiddenStatus =
  (typeof PRODUCT_EXTRACTION_DEFAULT_HIDDEN_STATUSES)[number];

export function productExtractionHiddenStatuses(
  requested: readonly string[],
): ProductExtractionHiddenStatus[] {
  return PRODUCT_EXTRACTION_DEFAULT_HIDDEN_STATUSES.filter(
    (status) => !requested.includes(status),
  );
}

export type ProductExtractionListQuery = {
  ok: true;
  /** `null` means both classifications. */
  classification: ProductExtractionClassification | null;
  /** Empty means every status. `dismissed` is never selectable. */
  statuses: ProductExtractionListStatus[];
  limit: number;
  offset: number;
};

export type ProductExtractionListQueryError = {
  ok: false;
  /** Arabic, ready to hand to the client. */
  error: string;
};

/**
 * Reads the list query.
 *
 * Unknown classifications and statuses are rejected rather than ignored: a client
 * that asks for `status=approved` and silently receives everything would show the
 * merchant a queue that does not match the filter they pressed. `limit` and
 * `offset` are the opposite — they are clamped, because a stale client sending an
 * out-of-range page size should still get a usable page.
 */
export function parseProductExtractionListQuery(
  query: Record<string, unknown>,
): ProductExtractionListQuery | ProductExtractionListQueryError {
  // Case is not part of the contract: a client that sends `PRODUCT` means the
  // same tab as one that sends `product`.
  const requestedClassification = firstValue(query.classification);
  const classification =
    requestedClassification === null
      ? null
      : requestedClassification.toLowerCase();
  if (classification !== null && !isClassification(classification)) {
    return { ok: false, error: "قيمة التصنيف غير صالحة." };
  }

  const statuses: ProductExtractionListStatus[] = [];
  for (const raw of everyValue(query.status)) {
    const status = raw.toLowerCase();
    if (!isListStatus(status)) {
      // Includes `dismissed`: a dismissed suggestion stays out of the review
      // queue no matter what a client asks for.
      return { ok: false, error: "حالة الاقتراح غير صالحة." };
    }
    if (!statuses.includes(status)) statuses.push(status);
  }

  return {
    ok: true,
    classification,
    statuses,
    limit: clampInt(query.limit, 1, PRODUCT_EXTRACTION_LIST_MAX_LIMIT, PRODUCT_EXTRACTION_LIST_MAX_LIMIT),
    offset: clampInt(query.offset, 0, PRODUCT_EXTRACTION_LIST_MAX_OFFSET, 0),
  };
}

function isClassification(
  value: string,
): value is ProductExtractionClassification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

function isListStatus(value: string): value is ProductExtractionListStatus {
  return (PRODUCT_EXTRACTION_LIST_STATUSES as readonly string[]).includes(value);
}

/**
 * Query values arrive as a string, an array of strings, or nested objects from a
 * malformed query string. Only the first usable string matters for a
 * single-valued parameter.
 */
function firstValue(value: unknown): string | null {
  const values = everyValue(value);
  return values.length > 0 ? values[0] : null;
}

/** Every non-empty, trimmed string in a query value, comma separated ones split. */
function everyValue(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/**
 * An integer from a query value, clamped into range.
 *
 * Anything that is not a number at all falls back to `fallback`, which is how
 * `limit=abc` still returns a page instead of a 400.
 */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const text = firstValue(value);
  if (text === null) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * What the workspace's review queue holds, counted over every non-dismissed
 * suggestion regardless of the page filters, so badges stay stable while the
 * merchant moves between tabs.
 */
export type ProductExtractionSuggestionCounts = {
  total: number;
  /** Suggestions the model read as a product. */
  product: number;
  /**
   * Suggestions the model read as *not* a product: a post candidate, a greeting,
   * an order. They are kept because they explain where a message went, but they
   * are not review work and must never be counted as such.
   */
  notProduct: number;
  /** Awaiting a decision, of either classification. */
  pendingReview: number;
  /** Awaiting a decision *and* holding a product — the badge number. */
  pendingProductReview: number;
  draftCreated: number;
  possibleDuplicate: number;
  updateProposed: number;
  acceptedUpdate: number;
  rejectedUpdate: number;
  superseded: number;
};

export function summarizeProductExtractionSuggestions(
  rows: ReadonlyArray<{
    classification: string | null;
    status: string | null;
    total: number | string | null;
  }>,
): ProductExtractionSuggestionCounts {
  const counts: ProductExtractionSuggestionCounts = {
    total: 0,
    product: 0,
    notProduct: 0,
    pendingReview: 0,
    pendingProductReview: 0,
    draftCreated: 0,
    possibleDuplicate: 0,
    updateProposed: 0,
    acceptedUpdate: 0,
    rejectedUpdate: 0,
    superseded: 0,
  };
  for (const row of rows) {
    const total = toCount(row.total);
    if (total === 0) continue;
    counts.total += total;
    if (row.classification === "product") counts.product += total;
    if (row.classification === "not_product") counts.notProduct += total;
    if (row.status === "review") {
      counts.pendingReview += total;
      if (row.classification === "product") counts.pendingProductReview += total;
    }
    if (row.status === "draft_created") counts.draftCreated += total;
    if (row.status === "possible_duplicate") counts.possibleDuplicate += total;
    if (row.status === "update_proposed") counts.updateProposed += total;
    if (row.status === "accepted_update") counts.acceptedUpdate += total;
    if (row.status === "rejected_update") counts.rejectedUpdate += total;
    if (row.status === "superseded") counts.superseded += total;
  }
  return counts;
}

function toCount(value: number | string | null): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export type ProductExtractionPagination = {
  total: number;
  limit: number;
  offset: number;
  /** `null` when this page already held the last row. */
  nextOffset: number | null;
};

/** Where the next page starts, if there is one. */
export function buildProductExtractionPagination(input: {
  total: number;
  limit: number;
  offset: number;
}): ProductExtractionPagination {
  const limit = Math.min(
    PRODUCT_EXTRACTION_LIST_MAX_LIMIT,
    Math.max(1, Math.floor(input.limit)),
  );
  const offset = Math.min(
    PRODUCT_EXTRACTION_LIST_MAX_OFFSET,
    Math.max(0, Math.floor(input.offset)),
  );
  const total = Math.max(0, Math.floor(input.total));
  const next = offset + limit;
  return {
    total,
    limit,
    offset,
    nextOffset: next < total ? next : null,
  };
}
