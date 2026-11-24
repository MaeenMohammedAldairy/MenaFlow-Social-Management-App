/**
 * auto-reply-limit-pause.ts
 *
 * How long an automatic reply waits when it could not be generated because of a
 * limit that lifts by itself — an exhausted AI quota, a missing provider key, an
 * unreadable subscription row.
 *
 * Both reply queues (Meta and WhatsApp) spend the same workspace AI quota and
 * read the same provider configuration, so both must wait the same kind of time
 * for the same reason. Keeping the bounds in one place is what stops one queue
 * from retrying every few seconds while the other waits an hour: the first burns
 * the attempt budget on a limit that has not moved, the second outruns the
 * platform's reply window and loses the message.
 *
 * Pure and injectable so the numbers are testable without a database or a clock.
 */

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
