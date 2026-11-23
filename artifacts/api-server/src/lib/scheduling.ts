/**
 * Pure helpers for post scheduling and workspace timezones (§4.7 of the audit).
 *
 * No db/express imports on purpose so the validation rules are testable in
 * plain Node — the same reason `post-readiness.ts` and `onboarding-progress.ts`
 * are standalone modules.
 */

/**
 * Parses a client-supplied scheduled time. Returns `null` when the value is
 * missing, malformed, or not strictly in the future relative to `now`.
 *
 * Clients send absolute ISO-8601 instants (with offset or Z), so no timezone
 * guessing happens here; the workspace timezone only shapes how the merchant
 * picked the instant on screen.
 */
export function parseScheduledAt(
  value: unknown,
  now: Date = new Date(),
): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  // Round to the second: sub-second precision invites "it says 10:00 but ran
  // at 09:59:59.7" bug reports, and due comparisons do not need it.
  const scheduled = new Date(Math.floor(date.getTime() / 1000) * 1000);
  if (scheduled.getTime() <= now.getTime()) return null;
  return scheduled;
}

/** True when the value is an IANA timezone name this runtime understands. */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    // Throws RangeError for unknown zone names.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}
