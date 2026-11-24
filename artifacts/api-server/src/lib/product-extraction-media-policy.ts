/**
 * product-extraction-media-policy.ts
 *
 * Decides whether a product-extraction job may proceed past the media gate, must
 * wait, or can never proceed at all.
 *
 * The distinction that matters is between *waiting* and *terminal*, and the code
 * used to have only one bucket for both. A message whose media download failed
 * for good is written as `media_download_status = 'failed'` with
 * `media_download_error = 'MEDIA_DOWNLOAD_FAILED_REQUIRES_REVIEW'`, and the
 * download worker's claim query selects **only** `pending` messages — so nothing
 * ever looks at a `failed` message again. A job parked in `waiting_media` for one
 * therefore never resumes, never exhausts its attempts, and never reaches the
 * `failed` state that would show it to the merchant as repairable. In production
 * on 2026-11-24 three jobs sat like that for twelve hours behind a
 * `pendingJobs.waitingMedia` count that looked like progress.
 *
 * Retries live one level down and are already handled: a retryable download error
 * keeps the media row `pending` with a `next_attempt_at`, and only a non-retryable
 * error or exhausted attempts produce `failed`. So `failed` here is terminal by
 * construction, not by inspection — which is what makes it safe to fail the job.
 *
 * Pure on purpose: no database and no network, so the three outcomes are testable
 * and the caller decides what to write.
 */

/** The subset of a source message the media gate reads. */
export type MediaGateMessage = {
  id: string;
  mediaAvailable: boolean;
  /** `mena_whatsapp_messages.media_download_status`. */
  mediaDownloadStatus: string | null;
};

export type WhatsAppMediaGateDecision =
  | { outcome: "ready" }
  | {
      outcome: "waiting";
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING";
    }
  | {
      outcome: "terminal";
      reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED";
      /** Messages whose download gave up, so the caller can reset them. */
      messageIds: string[];
    };

/**
 * A bundle is ready only when every message that carries media has it stored.
 *
 * Terminal wins over waiting: if one message in the bundle gave up, the bundle
 * can never complete no matter how many siblings are still downloading, and
 * waiting an hour to re-discover that is how the dead end above was built.
 */
export function decideWhatsAppMediaGate(
  messages: readonly MediaGateMessage[],
): WhatsAppMediaGateDecision {
  const terminal = messages
    .filter((message) => message.mediaAvailable && message.mediaDownloadStatus === "failed")
    .map((message) => message.id);
  if (terminal.length > 0) {
    return {
      outcome: "terminal",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
      messageIds: [...new Set(terminal)],
    };
  }

  const waiting = messages.some(
    (message) => message.mediaAvailable && message.mediaDownloadStatus !== "stored",
  );
  if (waiting) {
    return { outcome: "waiting", reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING" };
  }

  return { outcome: "ready" };
}

/**
 * Whether a manual re-queue should also reset a message's media.
 *
 * Resetting is what turns "run extraction again" from a no-op into a repair: the
 * download worker only claims `pending`, so a `failed` message has to be put back
 * to `pending` by someone, and the merchant pressing the button is the only
 * signal that a human wants to spend another attempt on it.
 */
export function shouldResetMediaForRequeue(
  message: Pick<MediaGateMessage, "mediaAvailable" | "mediaDownloadStatus">,
): boolean {
  return message.mediaAvailable && message.mediaDownloadStatus === "failed";
}
