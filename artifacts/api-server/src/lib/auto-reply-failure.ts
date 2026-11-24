/**
 * auto-reply-failure.ts
 *
 * Decides what a failed automatic-reply attempt turns into, for both queues.
 *
 * The queues used to have two outcomes for anything that was not a transient
 * provider fault: `failed`, terminally. That is correct for a send that broke
 * and wrong for a limit that lifts by itself — an exhausted AI quota resets at
 * the next billing period, and a missing provider key is fixed by the operator
 * in minutes, but a `failed` row is never picked up again, so the customer's
 * message lost its reply permanently and the merchant was told a send failed
 * that never happened.
 *
 * The Meta queue had a third outcome (`skipped`) and expressed the pause as a
 * re-queue from inside its worker; the WhatsApp schema has no such status, so
 * its queue expressed the same pause as "stay `queued`, push `next_run_at` out,
 * hand the attempt back". Same decision, two implementations, in two files —
 * which is how the two drifted (a second attempt waited 30 seconds on one side
 * and 20 on the other). The decision table now lives here, pure, and each queue
 * applies the resulting plan to its own table.
 *
 * The loop a pause creates is bounded by a rule each queue already enforces:
 * before generating anything it re-checks the customer message's age (Meta's
 * 24-hour window, WhatsApp's `WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES`, 12 hours by
 * default) and drops the job as window-expired. A quota that never lifts
 * therefore ends with the conversation handed to a human, not with a job queued
 * forever, and never with a reply delivered half a day late.
 *
 * `whatsAppAutoReplyErrorCode` stays here as well: it is how the WhatsApp queue
 * derives the code the planner is given. Meta derives its own from the Graph
 * error, because `isUnansweredMetaReply` matches on those exact codes.
 */

import { autoReplyLimitPauseDefaultMinutes } from "./auto-reply-policy.ts";
import {
  classifyAutoReplyGenerationFailure,
  MAX_ERROR_CODE_LENGTH,
  stableErrorCode,
} from "./error-codes.ts";

/** Stored when nothing better is available. */
export const autoReplyFallbackCode = "AUTO_REPLY_FAILED";

/**
 * The code to store for a failed WhatsApp attempt.
 *
 * Evolution's own errors carry a stable code in `message`, so `trustMessage`
 * passes them through. Everything else is trusted only when the message has the
 * shape of a registry code — `SUBSCRIPTION_LIMIT_REACHED:aiGenerations` — and
 * otherwise falls back to the error's class name.
 *
 * Both halves matter. The class name alone is what the queue stored before, so
 * an exhausted quota was recorded as `SubscriptionAiQuotaError`: untranslatable
 * by the registry and unmatched by the shared paused-code vocabulary. A raw
 * message is worse, because a provider fault can carry model output into a
 * column the merchant's app renders back to them.
 */
export function whatsAppAutoReplyErrorCode(
  error: unknown,
  trustMessage = false,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const trimmed = message.trim();
  if (trustMessage && trimmed) {
    return trimmed.slice(0, MAX_ERROR_CODE_LENGTH);
  }
  const stable = stableErrorCode(trimmed);
  if (stable) return stable;
  const name = error instanceof Error ? error.name.trim() : "";
  return name.slice(0, MAX_ERROR_CODE_LENGTH) || autoReplyFallbackCode;
}

export type AutoReplyFailurePlan =
  | {
      /** A send may have reached the customer; never retried automatically. */
      kind: "unknown_outcome";
      status: "unknown";
      errorCode: string;
      nextRunAt: Date | null;
      returnAttempt: false;
      completed: true;
    }
  | {
      /** A limit that lifts by itself: wait, then try the same event again. */
      kind: "quota_pause";
      status: "queued";
      errorCode: string;
      nextRunAt: Date;
      /** The attempt was never spent, so it is handed back. */
      returnAttempt: true;
      completed: false;
    }
  | {
      /** A transient provider fault, retried up to the queue's attempt budget. */
      kind: "retry";
      status: "queued";
      errorCode: string;
      nextRunAt: Date;
      returnAttempt: false;
      completed: false;
    }
  | {
      kind: "failed";
      status: "failed";
      errorCode: string;
      nextRunAt: Date;
      returnAttempt: false;
      completed: true;
    };

export type AutoReplyFailureInput = {
  /** Stable machine code, already normalized by the caller. */
  errorCode: string;
  /** True when the generation-retry predicate accepted this fault. */
  retryable: boolean;
  /** Attempts already spent, including the one just claimed. */
  attempts: number;
  /** True once a send request left this server. */
  sendStarted: boolean;
  now?: number;
  /** This queue's configured pause; the shared half-hour when omitted. */
  quotaPauseMs?: number;
};

/** Error code recorded when a send's outcome cannot be known. */
export const autoReplyResultUnknownCode = "AUTO_REPLY_RESULT_UNKNOWN";

export function planAutoReplyFailure(
  input: AutoReplyFailureInput,
): AutoReplyFailurePlan {
  const now = input.now ?? Date.now();
  const errorCode =
    input.errorCode.trim().slice(0, MAX_ERROR_CODE_LENGTH) || autoReplyFallbackCode;

  if (input.sendStarted) {
    return {
      kind: "unknown_outcome",
      status: "unknown",
      errorCode: autoReplyResultUnknownCode,
      nextRunAt: null,
      returnAttempt: false,
      completed: true,
    };
  }

  if (classifyAutoReplyGenerationFailure(errorCode) === "skipped") {
    return {
      kind: "quota_pause",
      status: "queued",
      errorCode,
      nextRunAt: new Date(
        now + (input.quotaPauseMs ?? autoReplyLimitPauseDefaultMinutes * 60_000),
      ),
      returnAttempt: true,
      completed: false,
    };
  }

  if (input.retryable) {
    return {
      kind: "retry",
      status: "queued",
      errorCode,
      nextRunAt: new Date(now + Math.min(input.attempts * 10_000, 30_000)),
      returnAttempt: false,
      completed: false,
    };
  }

  return {
    kind: "failed",
    status: "failed",
    errorCode,
    nextRunAt: new Date(now),
    returnAttempt: false,
    completed: true,
  };
}
