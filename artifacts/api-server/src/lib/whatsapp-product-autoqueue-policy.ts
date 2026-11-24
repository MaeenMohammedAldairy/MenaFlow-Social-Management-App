/**
 * Policy for filling the WhatsApp product-extraction queue without a merchant
 * pressing a button.
 *
 * Pure on purpose: the queue pass walks the database in small pages and every
 * branch here is a decision that has to be exactly right to avoid either
 * starving a workspace or burning its AI quota twice. No `@workspace/db` import,
 * so the rules are unit-testable.
 */

import { QUOTA_EXHAUSTED_REASON_PREFIX } from "./extraction-quota-policy.ts";

/**
 * Workspaces queued per auto-queue pass.
 *
 * Small on purpose: the pass runs on an interval and a deployment with more
 * workspaces than this rotates through them via the cursor rather than always
 * serving the same first ten. Each workspace is still bounded by the
 * message cap inside `queueUnprocessedWhatsAppProductMessages`.
 */
export const AUTOQUEUE_WORKSPACE_BATCH_SIZE = 10;

type JobRow = {
  status: string | null;
  lastError: string | null;
  nextRunAt: Date | string | null;
};

/**
 * Whether a pending job row is an active AI-quota postponement.
 *
 * This is the same condition the catalog reports as `pendingJobs.quotaPaused`:
 * a pending job, scheduled for the future, carrying the quota-exhausted reason.
 * Auto-queueing over an active pause would insert jobs at `nextRunAt = now`,
 * jumping the queue the pause just protected — each would fail on the same quota
 * and re-pause the workspace, once per message, forever. A postponed job whose
 * time has already passed is no longer a pause: the extraction worker itself
 * will re-check the quota and postpone again if it is still exhausted.
 */
export function isQuotaPauseRow(row: JobRow, now: Date = new Date()): boolean {
  if (row.status !== "pending") return false;
  if (!row.lastError?.startsWith(QUOTA_EXHAUSTED_REASON_PREFIX)) return false;
  if (row.nextRunAt === null || row.nextRunAt === undefined) return false;
  const nextRunAt =
    row.nextRunAt instanceof Date ? row.nextRunAt : new Date(row.nextRunAt);
  if (Number.isNaN(nextRunAt.getTime())) return false;
  return nextRunAt.getTime() > now.getTime();
}

export type AutoQueuePassPlan = {
  /** Workspace ids to queue for, in order. */
  visit: string[];
  /** Cursor for the next pass; `null` starts the rotation over. */
  nextCursor: string | null;
  /** Whether this pass wrapped around to the beginning of the list. */
  restarted: boolean;
};

/**
 * Which workspaces one auto-queue pass should visit, and where the cursor ends.
 *
 * `workspaces` is the page fetched after `cursor`; `restartWorkspaces` is the
 * page fetched from the beginning, consulted only when the cursor has run past
 * the end of the list. Deduplication and the batch cap are applied here too so a
 * caller that forgets `selectDistinct` or `limit` cannot turn one pass into a
 * full sweep.
 *
 * The cursor advances to the last visited workspace even when some of them are
 * skipped (quota pause, error), so a stuck workspace cannot hold the rotation
 * still.
 */
export function planAutoQueuePass(input: {
  cursor: string | null;
  workspaces: readonly string[];
  restartWorkspaces?: readonly string[];
  batchSize?: number;
}): AutoQueuePassPlan {
  const batchSize = input.batchSize ?? AUTOQUEUE_WORKSPACE_BATCH_SIZE;
  const limit = Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 0;
  if (limit === 0) {
    // A caller that asks for nothing gets nothing and does not advance, so a
    // misconfigured batch size cannot silently strand the rotation.
    return { visit: [], nextCursor: input.cursor, restarted: false };
  }
  const page = dedupe(input.workspaces).slice(0, limit);

  const wrapped = input.cursor !== null && page.length === 0;
  const visit = wrapped
    ? dedupe(input.restartWorkspaces ?? []).slice(0, limit)
    : page;

  const nextCursor =
    visit.length > 0
      ? visit[visit.length - 1]
      : wrapped
        ? null
        : input.cursor;

  return { visit, nextCursor, restarted: wrapped };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Who asked for the queue to be filled.
 *
 * - `manual`: the merchant pressed «استخراج المنتجات» (or a specific message was
 *   named). Asking again is a request to retry, so settled jobs are revived.
 * - `automatic`: the timer. It has no opinion about any particular message, so
 *   it must not touch jobs that already ran.
 */
export type ProductQueueIntent = "manual" | "automatic";

export type SettledJobQueuePolicy = {
  /**
   * Skip messages that already have a job row, whatever its status.
   *
   * Without this the timer re-selects the same oldest 200 messages forever: a
   * workspace with more unextracted messages than settled ones would never reach
   * the newer messages at all, because the selection is ordered oldest-first and
   * capped.
   */
  excludeMessagesWithJobs: boolean;
  /**
   * Reset `failed` jobs and `complete` jobs that ended in `PRODUCT_TEXT_REQUIRED`
   * back to `pending` with `attempts = 0`.
   *
   * Right for a manual re-run, wrong on a timer: a job that fails for a durable
   * reason would be revived every minute, retrying forever and spending the
   * workspace's AI quota on it.
   */
  reviveSettledJobs: boolean;
};

/**
 * What the queue does with messages whose job has already settled.
 *
 * The two answers are opposites on purpose, and the difference is the whole
 * reason the automatic pass exists as its own intent rather than as another call
 * to the manual one.
 */
export function settledJobQueuePolicy(
  intent: ProductQueueIntent,
): SettledJobQueuePolicy {
  return intent === "manual"
    ? { excludeMessagesWithJobs: false, reviveSettledJobs: true }
    : { excludeMessagesWithJobs: true, reviveSettledJobs: false };
}
