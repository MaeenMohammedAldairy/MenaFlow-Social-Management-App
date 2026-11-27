/**
 * product-extraction-lifecycle.ts
 *
 * Who looks at a WhatsApp product-extraction job next.
 *
 * A job's `status` column is a sentence about the future — `waiting_media` says
 * "media is on its way" — and for three weeks nothing in the code had to keep
 * that promise. The queue claimed `pending` and nothing else, so a job that
 * parked itself with `next_run_at = now + 60s` was never looked at again: 13 such
 * jobs on 2026-11-27, one of them four days old, all of them with every photo in
 * their bundle already stored. The mirror image is a state that *looks* like
 * progress: `pendingJobs.waitingMedia` counts them as pending work.
 *
 * So the taxonomy is one module, and every status must answer one question —
 * `nextBy`: who reads this row again? A status whose answer is "nobody" is a
 * bug in this file, and `product-extractionStuckStatuses()` says so in a test.
 *
 * Two rules follow from that and are the reason this file exists:
 *
 * 1. **A wait is claimed.** `CLAIMABLE_JOB_STATUSES` is what the claim query
 *    filters on, so honouring `next_run_at` is structural, not a courtesy that
 *    the media worker happens to extend when it finishes a download.
 * 2. **A wait costs nothing.** The claim spends an attempt (`attempts + 1`) and
 *    a pass that ends in another wait gives it back, exactly like the quota
 *    refund in `extraction-quota-policy.ts`. Without that, five minutes of slow
 *    photos exhausts a bundle's job and the merchant's only way back is the
 *    re-run button — for a message that was never broken.
 *
 * Pure: no database, no express, so the whole state machine is testable and the
 * review screen can read its copy from here instead of inventing its own.
 */

/** The values `mena_whatsapp_product_extraction_jobs_status_check` allows. */
export const PRODUCT_EXTRACTION_STATUSES = [
  "pending",
  "processing",
  "waiting_media",
  "waiting_association",
  "complete",
  "review",
  "failed",
] as const;

export type ProductExtractionStatus =
  (typeof PRODUCT_EXTRACTION_STATUSES)[number];

/**
 * The status that goes first when the queue can only take a few jobs.
 *
 * `CLAIMABLE_JOB_STATUSES` doubles as the priority order, and this names its head
 * explicitly, because the claim's `LIMIT` is the throughput of the whole pipeline:
 * waiting rows are the oldest rows in the table, so without a priority they would
 * take every slot and a merchant's new message would wait behind thirteen
 * re-decisions that cost nothing and change nothing.
 */
export const FRESH_WORK_JOB_STATUS: ProductExtractionStatus = "pending";

/**
 * Statuses the queue may claim when `next_run_at` has passed.
 *
 * `waiting_media` and `waiting_association` belong here: both are written by a
 * pass that decided to look again later, and a "later" nobody honours is a
 * silent stop. This is the list the claim query filters on — not a hint.
 */
export const CLAIMABLE_JOB_STATUSES: readonly ProductExtractionStatus[] = [
  // The order is the priority: see `FRESH_WORK_JOB_STATUS`.
  FRESH_WORK_JOB_STATUS,
  "waiting_media",
  "waiting_association",
];

/** What kind of state this is, for metrics and for the review screen. */
export type ProductExtractionOutcome =
  | "queued"
  | "running"
  | "waiting"
  | "review"
  | "closed";

/** Who reads the row again. `"none"` is only honest once the state is closed. */
export type ProductExtractionNextActor =
  | "queue"
  | "run"
  | "event"
  | "human"
  | "none";

export type ProductExtractionStatusDescription = {
  status: ProductExtractionStatus;
  outcome: ProductExtractionOutcome;
  nextBy: ProductExtractionNextActor;
  /** In words, because a reviewer needs the sentence, not the enum. */
  actor: string;
  /** In `CLAIMABLE_JOB_STATUSES`: the queue will come back for it. */
  claimable: boolean;
  /**
   * Whether a pass that ends in this state keeps the attempt the claim spent.
   * `false` is a refund, and only waiting may refund.
   */
  spendsAttempt: boolean;
  /** Must carry a `reason_code`. Kept equal to `requiresReasonForTransition`. */
  reasonRequired: boolean;
  /** The external thing that ends the wait, so it can be woken early. */
  releaseEvent: string | null;
  /** What the merchant can press, if anything. */
  merchantAction: "requeue" | null;
  /** One line in the merchant's language, shown wherever the state is shown. */
  merchantCopy: string;
};

const DESCRIPTIONS: Record<
  ProductExtractionStatus,
  ProductExtractionStatusDescription
> = {
  pending: {
    status: "pending",
    outcome: "queued",
    nextBy: "queue",
    actor: "product-extraction queue, on its next pass",
    claimable: true,
    spendsAttempt: true,
    reasonRequired: false,
    releaseEvent: null,
    merchantAction: null,
    merchantCopy: "في الطابور، ستُقرأ تلقائيًا.",
  },
  processing: {
    status: "processing",
    outcome: "running",
    nextBy: "run",
    // A claim older than ten minutes is handed back by the same pass that makes
    // the claim, so a dead instance cannot strand a job.
    actor: "the run itself; a stale claim is reclaimed after ten minutes",
    claimable: false,
    spendsAttempt: true,
    reasonRequired: false,
    releaseEvent: null,
    merchantAction: null,
    merchantCopy: "يُقرأ الآن.",
  },
  waiting_media: {
    status: "waiting_media",
    outcome: "waiting",
    nextBy: "queue",
    actor: "product-extraction queue on its own timer, or immediately when a photo in the bundle lands",
    claimable: true,
    // The photos are not the job's fault: a wait may never exhaust it.
    spendsAttempt: false,
    reasonRequired: true,
    releaseEvent: "whatsapp-media-settled",
    merchantAction: null,
    merchantCopy: "ينظر إليها مجددًا عند وصول صور المجموعة.",
  },
  waiting_association: {
    status: "waiting_association",
    outcome: "waiting",
    nextBy: "human",
    actor: "the merchant's association decision, with the queue re-checking hourly",
    claimable: true,
    spendsAttempt: false,
    reasonRequired: true,
    releaseEvent: "whatsapp-association-decided",
    merchantAction: null,
    merchantCopy: "بانتظار قرارك: أي الرسائل تنتمي إلى هذا المنتج؟",
  },
  review: {
    status: "review",
    outcome: "review",
    nextBy: "human",
    actor: "the merchant, from the product's review card",
    claimable: false,
    spendsAttempt: true,
    reasonRequired: true,
    releaseEvent: null,
    merchantAction: null,
    merchantCopy: "يحتاج مراجعتك قبل النشر.",
  },
  complete: {
    status: "complete",
    outcome: "closed",
    nextBy: "none",
    actor: "nobody: the run ended, and `reason_code` says what it concluded",
    claimable: false,
    spendsAttempt: true,
    reasonRequired: true,
    releaseEvent: null,
    // Re-running extraction can still produce a newer version of the group, but
    // nothing is owed here, so there is no action to advertise.
    merchantAction: null,
    merchantCopy: "انتهت القراءة.",
  },
  failed: {
    status: "failed",
    outcome: "closed",
    nextBy: "human",
    actor: "the merchant: «استخراج المنتجات» puts failed jobs back in the queue",
    claimable: false,
    spendsAttempt: true,
    reasonRequired: true,
    releaseEvent: null,
    merchantAction: "requeue",
    merchantCopy: "تعذّرت القراءة؛ اضغط «استخراج المنتجات» لإعادة المحاولة.",
  },
};

export function describeProductExtractionStatus(
  status: string | null | undefined,
): ProductExtractionStatusDescription | null {
  if (!status) return null;
  return DESCRIPTIONS[status as ProductExtractionStatus] ?? null;
}

export function isClaimableProductExtractionStatus(
  status: string | null | undefined,
): boolean {
  const described = describeProductExtractionStatus(status);
  return described !== null && described.claimable;
}

/**
 * Whether the attempt the claim spent has to be given back after this pass.
 *
 * The call site asks this before it knows where the run ended, so the wording is
 * "a wait gives it back" and both wait branches share one expression.
 */
export function refundsAttemptForStatus(
  status: string | null | undefined,
): boolean {
  const described = describeProductExtractionStatus(status);
  return described !== null && !described.spendsAttempt;
}

/**
 * Statuses that no one owns: not claimed by the queue, not waiting on a named
 * event, not a human's card, and not closed. Must stay empty — a non-empty list
 * is the exact shape of the 2026-11-27 outage.
 */
export function productExtractionStuckStatuses(): ProductExtractionStatus[] {
  return PRODUCT_EXTRACTION_STATUSES.filter((status) => {
    const described = DESCRIPTIONS[status];
    if (described.claimable) return false;
    if (described.releaseEvent !== null) return false;
    if (described.nextBy === "human") return false;
    // A closed state owes nobody a next look; that is what "closed" means.
    return described.outcome !== "closed" && described.outcome !== "running";
  });
}

/**
 * The copy for a list of jobs, keyed by status. The review screen reads this
 * instead of writing its own sentences, so a state cannot be displayed without
 * the promise that someone will look at it again.
 */
export function productExtractionStatusCopies(): Record<string, string> {
  const copies: Record<string, string> = {};
  for (const status of PRODUCT_EXTRACTION_STATUSES) {
    copies[status] = DESCRIPTIONS[status].merchantCopy;
  }
  return copies;
}
