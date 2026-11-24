/**
 * whatsapp-media-expiry-policy.ts
 *
 * How many download attempts a WhatsApp message is worth, given its age.
 *
 * WhatsApp stops serving a message's media a few weeks after it was sent. The
 * live workspace measures the window: every media row whose message was six to
 * twelve days old when the history sync imported it downloaded on the first
 * attempt, while every row whose message was twenty-four to twenty-five days old
 * burned all five attempts on `EVOLUTION_API_REQUEST_FAILED` and ended `failed`
 * anyway. Five retries against a server that no longer has the object are four
 * wasted calls, four log lines, and — worst of all — a merchant-facing «فشل
 * التحميل» that reads as "try again later" when later cannot help.
 *
 * So an old message gets one attempt, and when it fails the row records a reason
 * that says what actually happened. The reason is deliberately outside the
 * retryable list in `whatsapp-media-download.ts`, so nothing schedules another
 * attempt on its own; a human re-queue can still spend one more.
 *
 * Pure: no database, no network, unit-testable.
 */

/**
 * Age past which WhatsApp is assumed to no longer serve a message's media.
 *
 * A heuristic by necessity — Meta publishes no window — set between the oldest
 * observed success (twelve days) and the youngest observed permanent failure
 * (twenty-four days). The mobile app carries the same number for its copy, and a
 * drift test pins the two together.
 */
export const MEDIA_UPSTREAM_EXPIRY_AGE_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Recorded when an old message's single attempt fails. Not in the retryable
 * list, so the download worker will not schedule another attempt by itself.
 */
export const MEDIA_UPSTREAM_EXPIRED_REASON = "WHATSAPP_MEDIA_EXPIRED_UPSTREAM";

/**
 * How long ago the message was sent, or `null` when that is unknown.
 *
 * Unknown age must behave exactly like a fresh message: guessing "old" from a
 * missing timestamp would refuse downloads that might well succeed.
 */
export function messageAgeMs(
  messageTimestamp: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (messageTimestamp === null || messageTimestamp === undefined) return null;
  const sent =
    messageTimestamp instanceof Date
      ? messageTimestamp
      : new Date(messageTimestamp);
  if (Number.isNaN(sent.getTime())) return null;
  return Math.max(0, now.getTime() - sent.getTime());
}

/**
 * Attempts worth spending on a message of this age.
 *
 * One for a message past the expiry window — enough to confirm the object is
 * really gone, not enough to pretend otherwise four more times.
 */
export function mediaDownloadAttemptLimit(input: {
  messageAgeMs: number | null;
  defaultLimit: number;
}): number {
  if (input.messageAgeMs === null) return input.defaultLimit;
  return input.messageAgeMs > MEDIA_UPSTREAM_EXPIRY_AGE_MS
    ? 1
    : input.defaultLimit;
}

/**
 * The reason to record when an attempt fails.
 *
 * Old messages get the expiry reason whatever the transport said, because the
 * transport error (`EVOLUTION_API_REQUEST_FAILED`) describes the symptom while
 * the age describes the cause — and only the cause tells the merchant anything
 * actionable.
 */
export function mediaDownloadFailureReason(input: {
  messageAgeMs: number | null;
  errorCode: string;
}): string {
  if (
    input.messageAgeMs !== null &&
    input.messageAgeMs > MEDIA_UPSTREAM_EXPIRY_AGE_MS
  ) {
    return MEDIA_UPSTREAM_EXPIRED_REASON;
  }
  return input.errorCode;
}

/**
 * Whether a media item is gone from WhatsApp for good.
 *
 * The recorded reason wins: a merchant can re-queue an old row, and the retry
 * writes a fresh transport error over `failure_reason`'s predecessor. A row
 * written before the reason existed falls back to the message's age, which is
 * the same evidence the original download attempt used.
 */
export function isExpiredWhatsAppMediaFailure(input: {
  downloadStatus?: string | null;
  failureReason?: string | null;
  messageTimestamp?: Date | string | null;
  now?: Date;
}): boolean {
  if (input.downloadStatus && input.downloadStatus !== "failed") return false;
  if (input.failureReason === MEDIA_UPSTREAM_EXPIRED_REASON) return true;
  const age = messageAgeMs(input.messageTimestamp, input.now ?? new Date());
  return age !== null && age > MEDIA_UPSTREAM_EXPIRY_AGE_MS;
}
