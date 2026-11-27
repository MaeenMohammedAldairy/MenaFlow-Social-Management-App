/**
 * product-extraction-reasons.ts
 *
 * Why an extraction job ended the way it did.
 *
 * Before this, a job could finish as `complete` with no error and no
 * suggestion — which is exactly what hid two merchant messages that carried a
 * price: their jobs ended silently because a sibling message in the same
 * bundle had already been processed. `last_error` can only say something went
 * wrong, so "nothing to do" and "we dropped your message" looked identical.
 *
 * Every terminal transition of a job must now name one of these codes, and the
 * code is what the API, the metrics and the merchant-facing copy read.
 *
 * Pure: no database, no side effects.
 */

export const EXTRACTION_REASON_CODES = [
  /** Suggestions were written (or deliberately none: every source was read). */
  "RECORDED",
  /** The message is deleted, or no longer in a state to extract from. */
  "SKIPPED_MESSAGE_UNRECEIVABLE",
  /**
   * The bundle's sources are already covered by an existing suggestion at this
   * version, so there is nothing new to read.
   */
  "SKIPPED_ALREADY_COVERED",
  /** A source message of the bundle could not be loaded. */
  "FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE",
  /** Nothing readable yet: a photo whose download is still running. */
  "WAITING_MEDIA",
  /** A download gave up for good, and nothing else in the bundle is readable. */
  "FAILED_MEDIA_UNRECOVERABLE",
  /** A readable offer exists but some of its photos are gone forever. */
  "RECORDED_MEDIA_PARTIAL",
  /** The bundle needs a merchant decision about which messages belong together. */
  "WAITING_ASSOCIATION",
  /**
   * The group grew after an earlier version was stored, so the whole group was
   * re-extracted instead of dropping the newcomer.
   */
  "REEXTRACTED_GROUP_GROWN",
  /** No text and no readable image: there is nothing for any model to read. */
  "NEEDS_TEXT",
  /** The AI provider rejected the answer twice; the job stays retryable. */
  "FAILED_MODEL_RESPONSE",
  /** The workspace's AI quota is exhausted; the queue is parked, not failed. */
  "PAUSED_AI_QUOTA",
  /** Storing the suggestion failed; the reason is kept verbatim in last_error. */
  "FAILED_PERSISTENCE",
] as const;

export type ExtractionReasonCode = (typeof EXTRACTION_REASON_CODES)[number];

const REASON_SET = new Set<string>(EXTRACTION_REASON_CODES);

export function isExtractionReasonCode(value: unknown): value is ExtractionReasonCode {
  return typeof value === "string" && REASON_SET.has(value);
}

/**
 * The job statuses that end a run, and so must carry a reason.
 *
 * `pending`/`processing` are transitions inside a run; everything else is a
 * conclusion a human or a metric will read.
 */
export function requiresReasonForTransition(input: {
  status?: string | null;
}): boolean {
  return (
    input.status === "complete" ||
    input.status === "failed" ||
    input.status === "waiting_media" ||
    input.status === "waiting_association" ||
    input.status === "review"
  );
}

/**
 * The reason for a terminal transition.
 *
 * Throws on a missing or unknown code: silence is what made the silent skips
 * invisible, so an unlabelled conclusion is a bug in the caller, not something
 * to tolerate at runtime.
 */
export function extractionReasonFor(input: {
  status: string;
  reason?: string | null;
}): ExtractionReasonCode {
  if (!requiresReasonForTransition(input)) return "RECORDED";
  if (!isExtractionReasonCode(input.reason)) {
    throw new Error(
      `PRODUCT_EXTRACTION_REASON_MISSING:${input.status}:${String(input.reason ?? "null")}`,
    );
  }
  return input.reason;
}

/** Maps an existing `last_error` value onto a reason code, for old rows. */
export function reasonCodeFromLastError(lastError: string | null | undefined): ExtractionReasonCode {
  if (!lastError) return "RECORDED";
  if (lastError === "PRODUCT_TEXT_REQUIRED") return "NEEDS_TEXT";
  if (lastError === "WHATSAPP_MEDIA_DOWNLOAD_PENDING") return "WAITING_MEDIA";
  if (lastError === "WHATSAPP_MEDIA_DOWNLOAD_FAILED") return "FAILED_MEDIA_UNRECOVERABLE";
  if (lastError.startsWith("WHATSAPP_CONTENT_ASSOCIATION")) return "WAITING_ASSOCIATION";
  if (lastError === "WHATSAPP_ASSOCIATED_MESSAGE_UNAVAILABLE") {
    return "FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE";
  }
  if (lastError.startsWith("PRODUCT_EXTRACTION_")) return "FAILED_MODEL_RESPONSE";
  if (lastError.startsWith("Failed query:") || lastError.startsWith("update \"")) {
    return "FAILED_PERSISTENCE";
  }
  return "FAILED_PERSISTENCE";
}

/** Arabic copy for operators and the review screen. */
const REASON_MESSAGES: Record<ExtractionReasonCode, string> = {
  RECORDED: "تم تسجيل الاقتراحات.",
  SKIPPED_MESSAGE_UNRECEIVABLE: "الرسالة محذوفة أو لم تعد قابلة للاستخراج.",
  SKIPPED_ALREADY_COVERED: "كل رسائل هذه المجموعة استُخرجت سابقًا.",
  FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE: "إحدى رسائل المجموعة المرتبطة غير متوفرة.",
  WAITING_MEDIA: "بانتظار تنزيل الصور المرفقة.",
  FAILED_MEDIA_UNRECOVERABLE: "الصور لم تعد متاحة في واتساب ولا يوجد نص يُقرأ.",
  RECORDED_MEDIA_PARTIAL: "سُجِّل المنتج مع صور ناقصة.",
  WAITING_ASSOCIATION: "يحتاج ربط الرسائل بمنتج واحد إلى قرار التاجر.",
  REEXTRACTED_GROUP_GROWN: "أُعيد الاستخراج بعد انضمام رسالة جديدة للمجموعة.",
  NEEDS_TEXT: "لا نص ولا صورة مقروءة في هذه الرسالة.",
  FAILED_MODEL_RESPONSE: "رفض النموذج إجابة قابلة للتحليل مرتين.",
  PAUSED_AI_QUOTA: "الطابور متوقف مؤقتًا لاستنفاد حصة الذكاء الاصطناعي.",
  FAILED_PERSISTENCE: "فشل حفظ الاقتراح في قاعدة البيانات.",
};

export function extractionReasonMessage(code: ExtractionReasonCode): string {
  return REASON_MESSAGES[code];
}

/**
 * The event name recorded for a terminal transition, so `mena_product_extraction_events`
 * shows failures and drops instead of only successes.
 */
export function extractionEventForReason(code: ExtractionReasonCode): string {
  switch (code) {
    case "RECORDED":
    case "RECORDED_MEDIA_PARTIAL":
    case "REEXTRACTED_GROUP_GROWN":
      return "EXTRACTION_SUCCEEDED";
    case "WAITING_MEDIA":
      return "EXTRACTION_WAITING_MEDIA";
    case "WAITING_ASSOCIATION":
      return "EXTRACTION_WAITING_ASSOCIATION";
    case "NEEDS_TEXT":
      return "EXTRACTION_NEEDS_TEXT";
    case "SKIPPED_ALREADY_COVERED":
    case "SKIPPED_MESSAGE_UNRECEIVABLE":
      return "EXTRACTION_SKIPPED";
    case "FAILED_MEDIA_UNRECOVERABLE":
      return "EXTRACTION_MEDIA_LOST";
    case "FAILED_MODEL_RESPONSE":
    case "FAILED_PERSISTENCE":
    case "FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE":
      return "EXTRACTION_FAILED";
    case "PAUSED_AI_QUOTA":
      return "EXTRACTION_PAUSED";
  }
}
