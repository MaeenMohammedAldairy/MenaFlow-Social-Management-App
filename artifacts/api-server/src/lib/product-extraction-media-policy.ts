/**
 * product-extraction-media-policy.ts
 *
 * Decides whether a product-extraction job may proceed past the media gate, must
 * wait, or can never proceed at all.
 *
 * The distinction that matters is between *waiting* and *terminal*, and the code
 * used to have only one bucket for both. A message whose media download failed
 * for good is written as `media_download_status = 'failed'`, and the download
 * worker's claim query selects **only** `pending` messages — so nothing ever
 * looks at a `failed` message again. A job parked in `waiting_media` for one
 * therefore never resumes, never exhausts its attempts, and never reaches a
 * state that shows it to the merchant as repairable. In production on
 * 2026-11-24 three jobs sat like that for twelve hours behind a
 * `pendingJobs.waitingMedia` count that looked like progress.
 *
 * The second failure mode is the mirror image: treating a dead download as a
 * reason to fail a job that never needed it. The live workspace holds a message
 * whose text is a complete offer — a name, a description, «سعر الطقم 3حبات 2300
 * ريال فقط» — sent with four photos. The message was imported twenty-four days
 * after it was sent, and WhatsApp no longer serves media that old, so all four
 * downloads gave up (`EVOLUTION_API_REQUEST_FAILED`, five attempts each). The
 * text was still perfectly extractable; a gate that fails the bundle because a
 * photo expired destroys the offer to keep a photograph it cannot get.
 *
 * So `terminal` is reserved for the one case where nothing readable remains: no
 * text anywhere in the bundle and no stored media. Retries live one level down
 * and are already handled — a retryable download error keeps the row `pending`
 * with a `next_attempt_at`, and only a non-retryable error or exhausted attempts
 * produce `failed` — so `failed` here is settled by construction, which is what
 * makes it safe to reason about.
 *
 * Pure on purpose: no database and no network, so the three outcomes are
 * testable and the caller decides what to write.
 */

/** The subset of a source message the media gate reads. */
export type MediaGateMessage = {
  id: string;
  /**
   * Whether the message carries a non-empty `text_body` or `caption` — the same
   * pair the extractor reads. A bundle with text has something to extract even
   * when every photo in it is gone.
   */
  hasText: boolean;
  mediaAvailable: boolean;
  /** `mena_whatsapp_messages.media_download_status`. */
  mediaDownloadStatus: string | null;
};

export type WhatsAppMediaGateDecision =
  | {
      outcome: "ready";
      /**
       * Messages whose download gave up and were therefore left out. Non-empty
       * exactly when the job proceeds with less media than the bundle carried,
       * so the caller can say so in the log and the product can show the photo
       * as missing rather than as still on its way.
       */
      failedMediaSkipped: string[];
    }
  | {
      outcome: "waiting";
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING";
      /**
       * Downloads in the same bundle that already gave up. A wait is only
       * recoverable while something is still trying; the rows that stopped
       * trying need to be put back by the caller, or the in-flight one settles
       * and the dead one is missed forever — which is how six `waiting_media`
       * jobs sat there overnight in the live workspace.
       */
      failedMessageIds: string[];
    }
  | {
      outcome: "terminal";
      reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED";
      /** Messages whose download gave up, so the caller can reset them. */
      messageIds: string[];
    };

/**
 * Whether the bundle may be extracted now, must wait, or never can be.
 *
 * Order of questions, and why:
 *
 * 1. Is any download still in flight (`pending`, or a status this module does
 *    not recognise)? Then wait — it may still complete and bring its photo, and
 *    an unknown status must never fail a job, because failing is irreversible
 *    from the merchant's side while waiting is not.
 * 2. Everything has settled. Is there anything readable — text in any message,
 *    or media that did arrive? Then proceed, naming the downloads that gave up
 *    so the caller can log them.
 * 3. Nothing readable remains: no text and no stored media. Terminal, with the
 *    dead messages named so a manual re-queue can reset them.
 */
export function decideWhatsAppMediaGate(
  messages: readonly MediaGateMessage[],
): WhatsAppMediaGateDecision {
  const failed = [
    ...new Set(
      messages
        .filter(
          (message) =>
            message.mediaAvailable && message.mediaDownloadStatus === "failed",
        )
        .map((message) => message.id),
    ),
  ];

  const inFlight = messages.some(
    (message) =>
      message.mediaAvailable &&
      message.mediaDownloadStatus !== "stored" &&
      message.mediaDownloadStatus !== "failed",
  );
  if (inFlight) {
    return {
      outcome: "waiting",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
      failedMessageIds: failed,
    };
  }

  const anythingReadable =
    messages.some((message) => message.hasText) ||
    messages.some(
      (message) =>
        message.mediaAvailable && message.mediaDownloadStatus === "stored",
    );
  if (!anythingReadable && failed.length > 0) {
    return {
      outcome: "terminal",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
      messageIds: failed,
    };
  }

  return { outcome: "ready", failedMediaSkipped: failed };
}

/**
 * What the photos of an extracted group ended up doing, stored on the
 * suggestion. Without it, a text-only extraction and a full read of an album
 * look identical in the review queue — and the merchant cannot tell «the photos
 * had nothing to say» from «we never opened the photos».
 */
export type ProductExtractionMediaState =
  | "not_applicable"
  | "included"
  | "partial"
  | "pending"
  | "lost";

export function decideWhatsAppExtractionMediaState(input: {
  /** Media rows the group carries, of any status. */
  sent: number;
  /** Rows whose file reached storage. */
  stored: number;
  /** Images actually sent to the model (the vision cap may hold some back). */
  used: number;
  /** Rows still downloading, which is the only state worth waiting for. */
  pending?: number;
}): ProductExtractionMediaState {
  if (input.sent === 0) return "not_applicable";
  if (input.stored === 0) {
    return (input.pending ?? 0) > 0 ? "pending" : "lost";
  }
  if (input.stored < input.sent || input.used < input.stored) return "partial";
  return "included";
}

/**
 * One line for the merchant, in their language, about what happened to the
 * photos. A review card that says «the product has no image» without saying
 * whether the image was lost, still coming, or never existed sends the merchant
 * to look for a bug that is not in the product.
 */
export function productExtractionMediaStateMessage(
  state: ProductExtractionMediaState,
): string {
  switch (state) {
    case "not_applicable":
      return "لا صور لهذه المجموعة.";
    case "included":
      return "قُرئت كل صور المجموعة مع النص.";
    case "partial":
      return "قُرئت بعض الصور فقط؛ قد ينقص المنتج صورة أو معلومة مكتوبة فيها.";
    case "pending":
      return "التنزيل لم يكتمل بعد؛ ستُقرأ الصور تلقائيًا عند وصولها.";
    case "lost":
      return "لم تُحفظ صور المجموعة في التخزين، فلا يمكن قراءتها حاليًا.";
  }
}

/**
 * Whether a manual re-queue should also reset a message's media.
 *
 * Resetting is what turns "run extraction again" from a no-op into a repair: the
 * download worker only claims `pending`, so a `failed` message has to be put
 * back to `pending` by someone, and the merchant pressing the button is the only
 * signal that a human wants to spend another attempt on it.
 */
export function shouldResetMediaForRequeue(
  message: Pick<MediaGateMessage, "mediaAvailable" | "mediaDownloadStatus">,
): boolean {
  return message.mediaAvailable && message.mediaDownloadStatus === "failed";
}
