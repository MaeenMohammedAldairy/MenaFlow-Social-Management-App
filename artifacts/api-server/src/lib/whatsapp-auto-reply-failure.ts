/**
 * whatsapp-auto-reply-failure.ts
 *
 * Decides what a failed WhatsApp automatic-reply attempt turns into.
 *
 * The queue used to have two outcomes for anything that was not a transient
 * provider fault: `failed`, terminally. That is correct for a send that broke
 * and wrong for a limit that lifts by itself — an exhausted AI quota resets at
 * the next billing period, and a missing provider key is fixed by the operator
 * in minutes, but a `failed` row is never picked up again, so the customer's
 * message lost its reply permanently and the merchant was told a send failed
 * that never happened.
 *
 * A third outcome existed for the Meta queue (`skipped`), but the WhatsApp
 * schema has no such status, so the pause is expressed with the states it does
 * have: stay `queued`, push `next_run_at` out, and hand the attempt back.
 *
 * The loop this creates is bounded by a rule the queue already enforces: before
 * generating anything it re-checks the customer message's age
 * (`WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES`, 12 hours by default) and drops the
 * event as `AUTO_REPLY_WINDOW_EXPIRED`. A quota that never lifts therefore ends
 * with the conversation handed to a human, not with an event queued forever,
 * and never with a reply delivered half a day late.
 *
 * Pure on purpose — the caller computes the error code and whether a send had
 * started, this module only decides, so the table below is testable.
 */

import {
  classifyAutoReplyGenerationFailure,
  MAX_ERROR_CODE_LENGTH,
  stableErrorCode,
} from "./error-codes.ts";

/** Stored when nothing better is available. */
export const whatsAppAutoReplyFallbackCode = "AUTO_REPLY_FAILED";

/**
 * The code to store for a failed attempt.
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
  return name.slice(0, MAX_ERROR_CODE_LENGTH) || whatsAppAutoReplyFallbackCode;
}

export const whatsAppAutoReplyDefaultQuotaPauseMinutes = 30;
/** Shorter than this and a quota pause is just a retry with extra logging. */
export const whatsAppAutoReplyMinQuotaPauseMinutes = 5;
/**
 * Longer than this and the pause eats a visible share of the 12-hour reply
 * window, so the event would expire before the quota could lift.
 */
export const whatsAppAutoReplyMaxQuotaPauseMinutes = 120;

/**
 * Unparseable or non-positive falls back to the default; a value that parses but
 * is merely too small or too large is clamped, so an operator who asks for a
 * two-hour pause gets two hours rather than a silent half-hour.
 */
export function whatsAppAutoReplyQuotaPauseMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(
    env.WHATSAPP_AUTO_REPLY_QUOTA_PAUSE_MINUTES?.trim() ?? "",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return whatsAppAutoReplyDefaultQuotaPauseMinutes * 60_000;
  }
  const minutes = Math.min(
    whatsAppAutoReplyMaxQuotaPauseMinutes,
    Math.max(whatsAppAutoReplyMinQuotaPauseMinutes, parsed),
  );
  return minutes * 60_000;
}

export type WhatsAppAutoReplyFailurePlan =
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

export type WhatsAppAutoReplyFailureInput = {
  /** Stable machine code, already normalized by the caller. */
  errorCode: string;
  /** True when the generation-retry predicate accepted this fault. */
  retryable: boolean;
  /** Attempts already spent, including the one just claimed. */
  attempts: number;
  /** True once a send request left this server. */
  sendStarted: boolean;
  now?: number;
  quotaPauseMs?: number;
};

/** Error code recorded when a send's outcome cannot be known. */
export const whatsAppAutoReplyResultUnknownCode = "AUTO_REPLY_RESULT_UNKNOWN";

export function planWhatsAppAutoReplyFailure(
  input: WhatsAppAutoReplyFailureInput,
): WhatsAppAutoReplyFailurePlan {
  const now = input.now ?? Date.now();
  const errorCode =
    input.errorCode.trim().slice(0, MAX_ERROR_CODE_LENGTH) || "AUTO_REPLY_FAILED";

  if (input.sendStarted) {
    return {
      kind: "unknown_outcome",
      status: "unknown",
      errorCode: whatsAppAutoReplyResultUnknownCode,
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
        now + (input.quotaPauseMs ?? whatsAppAutoReplyQuotaPauseMs()),
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
