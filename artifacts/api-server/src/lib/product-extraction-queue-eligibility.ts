/**
 * Which imported WhatsApp messages may be queued for product extraction at all.
 *
 * The extractor reads text: `text_body`, `caption`, and the text of associated
 * messages. It never receives image bytes unless the deployment opts into vision
 * extraction (`PRODUCT_VISION_EXTRACTION_ENABLED`), which reads the text visible
 * inside a *stored* image.
 *
 * That makes the queue's admission rule a question about whether anything
 * downstream could read the message — and getting it wrong is a dead end in both
 * directions. Admitting a photo with no caption while vision is off creates a job
 * that can only finish as `PRODUCT_TEXT_REQUIRED`; refusing it while vision is on
 * means the photo is never looked at by anything, ever. On the live workspace
 * every one of the thirteen media-bearing messages had an empty caption, so this
 * single rule decided whether any of them could become a product.
 *
 * Pure: no `@workspace/db`, so the rule is unit-testable on its own.
 */

export type QueueEligibilityPolicy = {
  /**
   * A message with a non-empty `text_body` or `caption`.
   *
   * Always admitted: there is something for the extractor to read, and refusing
   * it would mean refusing the only input the text path has.
   */
  admitTextMessages: boolean;
  /**
   * A message whose only content is media (`media_available` with no text).
   *
   * Admitted exactly when vision extraction is enabled — that is, when a stored
   * image can actually be read. A `failed` download counts as admitted on
   * purpose: queueing the message is what resets its media and gives the
   * download worker another set of attempts, so this is the only path that can
   * repair an image-only message whose download gave up.
   */
  admitMediaOnlyMessages: boolean;
};

/**
 * The admission rule for one deployment.
 *
 * `visionExtractionEnabled` should come from `visionProductExtractionEnabled()`,
 * so the queue and the worker that would eventually read the image always agree.
 */
export function queueEligibilityPolicy(options: {
  visionExtractionEnabled: boolean;
}): QueueEligibilityPolicy {
  return {
    admitTextMessages: true,
    admitMediaOnlyMessages: options.visionExtractionEnabled,
  };
}

/**
 * Whether one message may be queued.
 *
 * `hasText` is `text_body` or `caption` non-empty after trimming — the same pair
 * the extractor reads, so a photo *with* a caption is a text message here. A
 * message with neither text nor media is never eligible: there is nothing to read
 * now and nothing that could become readable later.
 */
export function isMessageQueueEligible(
  message: { hasText: boolean; mediaAvailable: boolean },
  policy: QueueEligibilityPolicy,
): boolean {
  if (message.hasText) return policy.admitTextMessages;
  return message.mediaAvailable && policy.admitMediaOnlyMessages;
}
