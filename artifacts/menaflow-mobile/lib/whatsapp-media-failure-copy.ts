/**
 * What the catalog says when a WhatsApp message's media never arrived.
 *
 * «فشل التحميل» reads as "try again later", and for most failures that is true —
 * the download worker retries on its own schedule and a manual re-queue spends a
 * fresh set of attempts. For one class of failure it is a lie: WhatsApp stops
 * serving a message's media a few weeks after it was sent, so a photo imported
 * twenty-four days late can never load, at any attempt count. Telling the
 * merchant "failed" there invites them to keep pressing a button that cannot
 * work; telling them the media expired tells them what to change (import sooner,
 * or re-send the photo).
 *
 * The server records the same distinction in
 * `mena_whatsapp_message_media.failure_reason`
 * (`WHATSAPP_MEDIA_EXPIRED_UPSTREAM`), but the card renders from the message's
 * age so the copy is right even for rows written before that reason existed.
 * The window itself is the server's number, pinned by a drift test.
 */

/**
 * Age past which WhatsApp is assumed to no longer serve a message's media.
 * Must stay equal to `MEDIA_UPSTREAM_EXPIRY_AGE_MS` on the server — the drift
 * test in `whatsapp-media-failure-copy.test.mjs` fails if the two diverge.
 */
export const MEDIA_UPSTREAM_EXPIRY_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export const MEDIA_UPSTREAM_EXPIRED_COPY =
  "انتهت صلاحية الوسيط لدى واتساب — الرسالة أقدم من نحو ثلاثة أسابيع، فلن ينجح تحميلها مجددًا.";

export const MEDIA_DOWNLOAD_FAILED_COPY = "فشل التحميل";
export const MEDIA_DOWNLOAD_PENDING_COPY = "جارٍ التحميل";

/** The failure code written by the server for an item WhatsApp no longer serves. */
export const MEDIA_UPSTREAM_EXPIRED_REASON = "WHATSAPP_MEDIA_EXPIRED_UPSTREAM";

/**
 * Whether a media item can ever be downloaded again.
 *
 * The server's reason takes precedence; older rows without it are recognised
 * by the send date, using the same window as the server's copy.
 */
export function isExpiredWhatsAppMediaFailure(input: {
  failureReason?: string | null;
  messageTimestamp?: string | null;
  now?: number;
}): boolean {
  if (input.failureReason === MEDIA_UPSTREAM_EXPIRED_REASON) return true;
  const sentAt = input.messageTimestamp
    ? new Date(input.messageTimestamp).getTime()
    : Number.NaN;
  const now = input.now ?? Date.now();
  return (
    Number.isFinite(sentAt) && now - sentAt > MEDIA_UPSTREAM_EXPIRY_AGE_MS
  );
}

/**
 * The placeholder label for a media item that is not stored yet.
 *
 * `messageTimestamp` is when the message was *sent*, not imported: a message can
 * sit in the queue for days and still be young enough for WhatsApp to serve its
 * media. An unknown timestamp falls back to the generic failure copy, because
 * guessing "expired" from missing data would blame WhatsApp for what might be
 * our own outage.
 */
export function describeMediaDownloadFailure(input: {
  downloadStatus?: string | null;
  messageTimestamp?: string | null;
  failureReason?: string | null;
  now?: number;
}): string {
  if (input.downloadStatus !== "failed") return MEDIA_DOWNLOAD_PENDING_COPY;
  const expired = isExpiredWhatsAppMediaFailure({
    failureReason: input.failureReason,
    messageTimestamp: input.messageTimestamp,
    now: input.now,
  });
  return expired ? MEDIA_UPSTREAM_EXPIRED_COPY : MEDIA_DOWNLOAD_FAILED_COPY;
}
