/**
 * auto-reply-policy.ts
 *
 * The rules both automatic-reply queues — Meta and WhatsApp — share, written
 * once. They spend the same workspace AI quota, read the same provider
 * configuration and answer the same kind of customer, so a number that is sane
 * for one queue is sane for the other. Two copies of each rule is how one queue
 * ends up retrying every few seconds while the other waits an hour: the first
 * burns the attempt budget on a limit that has not moved, the second outruns the
 * platform's reply window and loses the message.
 *
 * What lives here:
 *   - the pause when a limit that lifts by itself blocks generation (bounds
 *     shared; each queue reads its own environment variable);
 *   - the debounce that lets a burst of messages settle into one reply;
 *   - the hourly ceiling per conversation that stops two bots greeting each
 *     other forever;
 *   - the stable codes both queues record for the same outcome;
 *   - the language and tone vocabulary the merchant picks from.
 *
 * What deliberately stays per queue: the WhatsApp message-age window (Meta
 * enforces its own 24-hour window at the API), the provider-specific send, and
 * the mapping of a provider error to a storable code.
 *
 * Pure and injectable so the numbers are testable without a database or a clock.
 */

// ---------------------------------------------------------------------------
// Pause on a limit that lifts by itself
// ---------------------------------------------------------------------------

export const autoReplyLimitPauseDefaultMinutes = 30;

/**
 * Shorter than this and the pause is just a retry with extra logging: the quota
 * has not moved, and each attempt spends a claim on the same wall.
 */
export const autoReplyLimitPauseMinMinutes = 5;

/**
 * Longer than this and the pause eats a visible share of the reply window the
 * queue enforces (Meta's 24 hours, WhatsApp's 12), so the message would expire
 * before the limit could plausibly clear.
 */
export const autoReplyLimitPauseMaxMinutes = 120;

/**
 * Reads one queue's pause from the environment, in whole minutes.
 *
 * Unparseable or non-positive falls back to the default; a value that parses but
 * is merely too small or too large is clamped, so an operator who asks for a
 * two-hour pause gets two hours rather than a silent half-hour that contradicts
 * the setting they just made.
 */
export function resolveAutoReplyLimitPauseMs(
  envKey: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env[envKey]?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return autoReplyLimitPauseDefaultMinutes * 60_000;
  }
  const minutes = Math.min(
    autoReplyLimitPauseMaxMinutes,
    Math.max(autoReplyLimitPauseMinMinutes, parsed),
  );
  return minutes * 60_000;
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

/**
 * How long a queued reply waits before it runs.
 *
 * Customers often send two or three short messages in a row ("السلام عليكم",
 * "عندكم ...", "بكم؟"). Answering each one produces several AI replies to the
 * same conversation — some of them stale — and burns one AI generation per
 * message. A short wait lets the burst settle so the newest message is the one
 * answered, while the earlier jobs are superseded.
 */
export const autoReplyDebounceMs = 6_000;

export function autoReplyNextRunAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + autoReplyDebounceMs);
}

// ---------------------------------------------------------------------------
// Stable codes for outcomes both queues record
// ---------------------------------------------------------------------------

/** Recorded when a newer message in the same conversation wins the reply. */
export const autoReplySupersededCode = "SUPERSEDED_BY_NEWER_MESSAGE";

/** Recorded when a conversation hits the automatic-reply ceiling. */
export const autoReplyLoopGuardCode = "AUTO_REPLY_LOOP_GUARD";

// ---------------------------------------------------------------------------
// Hourly ceiling per conversation
// ---------------------------------------------------------------------------

/**
 * Automatic replies allowed per conversation in a rolling hour.
 *
 * Two automated systems greeting each other can otherwise answer in an endless
 * loop, spending the workspace AI quota on a conversation no customer reads.
 * A normal customer conversation stays well below this ceiling.
 */
export const autoReplyDefaultHourlyLimit = 12;

/** The ceiling an operator may raise the limit to; beyond it is not a guard. */
export const autoReplyHourlyLimitCeiling = 100;

/**
 * Reads one queue's hourly limit from the environment. As with the pause, each
 * queue keeps its own variable so an operator can tune one side without the
 * other, but the default and the ceiling are shared.
 */
export function resolveAutoReplyHourlyLimit(
  envKey: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env[envKey]?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return autoReplyDefaultHourlyLimit;
  }
  return Math.min(parsed, autoReplyHourlyLimitCeiling);
}

// ---------------------------------------------------------------------------
// Vocabulary the merchant picks from
// ---------------------------------------------------------------------------

export type AutoReplyLanguage = "ar" | "match_customer";
export type AutoReplyTone = "friendly_professional" | "concise" | "formal";

export const autoReplyToneInstructions: Record<AutoReplyTone, string> = {
  friendly_professional: "ودود ومهني، واضح ومحترم.",
  concise: "مختصر ومباشر مع الحفاظ على الاحترام.",
  formal: "رسمي ومهني.",
};
