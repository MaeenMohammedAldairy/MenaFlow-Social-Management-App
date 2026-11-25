/**
 * What a failed product-extraction attempt does next.
 *
 * Two failure kinds need opposite handling. A provider or parsing fault is
 * worth retrying soon, and after five attempts the job is failed so it stops
 * consuming queue slots. An exhausted AI quota is neither: it is a billing
 * state that lifts on its own at the start of the next period, so spending
 * attempts on it converts a temporary limit into permanent data loss — the
 * merchant upgrades or waits, and the messages are never extracted because
 * their jobs are already `failed`.
 *
 * Quota exhaustion therefore keeps the job `pending`, does not consume an
 * attempt, and postpones the whole workspace queue: every other pending job
 * would fail the same way in the next few seconds, and each of those failures
 * would burn an attempt too.
 */

export const QUOTA_EXHAUSTED_REASON_PREFIX = "SUBSCRIPTION_LIMIT_REACHED";
export const EXTRACTION_MAX_ATTEMPTS = 5;
export const EXTRACTION_BASE_RETRY_DELAY_MS = 30_000;
export const EXTRACTION_MAX_RETRY_DELAY_MS = 60 * 60_000;
export const DEFAULT_EXTRACTION_QUOTA_PAUSE_MS = 6 * 60 * 60_000;

const MIN_EXTRACTION_QUOTA_PAUSE_MS = 5 * 60_000;

/** True when the reason is the subscription quota, not a provider fault. */
export function isQuotaExhaustedReason(
  reason: string | null | undefined,
): boolean {
  return Boolean(reason?.trim().startsWith(QUOTA_EXHAUSTED_REASON_PREFIX));
}

/** How long the queue waits after the quota runs out. */
export function resolveExtractionQuotaPauseMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(
    env.PRODUCT_EXTRACTION_QUOTA_PAUSE_MS?.trim() ?? "",
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EXTRACTION_QUOTA_PAUSE_MS;
  }
  return Math.max(MIN_EXTRACTION_QUOTA_PAUSE_MS, parsed);
}

/** Exponential backoff for ordinary faults: 30s, 60s, 120s … capped at an hour. */
export function extractionRetryDelayMs(attempts: number): number {
  const attempt = Number.isFinite(attempts) ? Math.max(1, attempts) : 1;
  return Math.min(
    EXTRACTION_MAX_RETRY_DELAY_MS,
    EXTRACTION_BASE_RETRY_DELAY_MS * 2 ** (attempt - 1),
  );
}

export type ExtractionFailurePlan =
  | {
      kind: "quota_pause";
      status: "pending";
      nextRunAt: Date;
      /** The attempt counter is given back; the quota, not the job, failed. */
      consumeAttempt: false;
      /** Other pending jobs of the workspace would fail identically. */
      pauseWorkspaceQueue: true;
    }
  | {
      kind: "retry";
      status: "pending";
      nextRunAt: Date;
      consumeAttempt: true;
      pauseWorkspaceQueue: false;
    }
  | {
      kind: "attempts_exhausted";
      status: "failed";
      nextRunAt: Date;
      consumeAttempt: true;
      pauseWorkspaceQueue: false;
    };

export function planExtractionFailure(input: {
  reason: string | null | undefined;
  /** Attempts already spent, counting the one that just failed. */
  attempts: number;
  now?: Date;
  maxAttempts?: number;
  quotaPauseMs?: number;
}): ExtractionFailurePlan {
  const now = input.now ?? new Date();
  if (isQuotaExhaustedReason(input.reason)) {
    const pauseMs = input.quotaPauseMs ?? DEFAULT_EXTRACTION_QUOTA_PAUSE_MS;
    return {
      kind: "quota_pause",
      status: "pending",
      nextRunAt: new Date(now.getTime() + pauseMs),
      consumeAttempt: false,
      pauseWorkspaceQueue: true,
    };
  }
  const maxAttempts = input.maxAttempts ?? EXTRACTION_MAX_ATTEMPTS;
  const attempts = Number.isFinite(input.attempts) ? input.attempts : 0;
  if (attempts < maxAttempts) {
    return {
      kind: "retry",
      status: "pending",
      nextRunAt: new Date(now.getTime() + extractionRetryDelayMs(attempts)),
      consumeAttempt: true,
      pauseWorkspaceQueue: false,
    };
  }
  return {
    kind: "attempts_exhausted",
    status: "failed",
    nextRunAt: now,
    consumeAttempt: true,
    pauseWorkspaceQueue: false,
  };
}

/**
 * What a batch of messages will cost in AI quota.
 *
 * One extraction is one metered generation; a response the grounding rejects is
 * retried once against the other provider, which is metered again. The estimate
 * is therefore a range, and the honest number to show a merchant before he
 * queues two hundred messages is the low end plus the fact that the high end
 * exists.
 */
export const GENERATIONS_PER_EXTRACTION = 1;
export const GENERATIONS_PER_EXTRACTION_WITH_RETRY = 2;

export type ExtractionQuotaEstimate = {
  messages: number;
  estimatedGenerations: number;
  worstCaseGenerations: number;
  used: number;
  limit: number;
  remaining: number;
  /** True when every message in the batch fits in what is left. */
  fitsWithinQuota: boolean;
  /** How many of the batch can run before the queue has to wait. */
  messagesWithinQuota: number;
};

export function estimateExtractionQuota(input: {
  messages: number;
  used: number;
  limit: number;
}): ExtractionQuotaEstimate {
  const messages = Math.max(0, Math.trunc(input.messages) || 0);
  const used = Math.max(0, Math.trunc(input.used) || 0);
  const limit = Math.max(0, Math.trunc(input.limit) || 0);
  const remaining = Math.max(0, limit - used);
  const estimatedGenerations = messages * GENERATIONS_PER_EXTRACTION;
  return {
    messages,
    estimatedGenerations,
    worstCaseGenerations: messages * GENERATIONS_PER_EXTRACTION_WITH_RETRY,
    used,
    limit,
    remaining,
    fitsWithinQuota: estimatedGenerations <= remaining,
    messagesWithinQuota: Math.min(messages, remaining),
  };
}
