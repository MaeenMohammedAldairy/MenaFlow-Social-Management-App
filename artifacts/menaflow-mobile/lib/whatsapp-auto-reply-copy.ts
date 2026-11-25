/**
 * whatsapp-auto-reply-copy.ts
 *
 * Merchant wording for a WhatsApp automatic reply that is waiting on a limit
 * rather than broken.
 *
 * The queue now keeps such an event `queued` with the limit's code on it, which
 * the inbox used to render as "preparing your reply…" — true, but it hid the one
 * thing the merchant can act on. An exhausted AI quota resets by itself; a
 * missing provider key does not, and the two need different sentences.
 *
 * Rows stored before this behaviour existed are terminal `failed` rows carrying
 * the error's class name (`SubscriptionAiQuotaError`), so the legacy spelling is
 * still matched: a merchant looking at last week's conversation must not see a
 * raw class name or nothing at all.
 *
 * No imports on purpose — the unit test runner cannot resolve the app's
 * extensionless module paths.
 */

/** Codes that mean "never generated, and the limit lifts by itself". */
const quotaPausedCodes = ["SUBSCRIPTION_LIMIT_REACHED"];

const configurationPausedCodes = [
  "WORKSPACE_SUBSCRIPTION_MISSING",
  "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
  "MISSING_OPENAI_KEY",
  "MISSING_GEMINI_KEY",
  "MISSING_AI_PROVIDER_KEY",
  "AI_MODEL_NAME_INVALID",
];

/** Class names stored by the queue before it recorded stable codes. */
const legacyQuotaNames = ["SubscriptionAiQuotaError"];

function normalize(code: string | null | undefined): string {
  return code?.trim() ?? "";
}

function matches(code: string, candidates: readonly string[]): boolean {
  if (!code) return false;
  return candidates.some(
    (candidate) =>
      code === candidate ||
      code.startsWith(`${candidate}:`) ||
      code.includes(candidate),
  );
}

/** True when the reply is postponed by a limit that lifts without the merchant. */
export function isWhatsAppAutoReplyPausedCode(
  code: string | null | undefined,
): boolean {
  const value = normalize(code);
  return (
    matches(value, quotaPausedCodes) || matches(value, configurationPausedCodes)
  );
}

/** True for a quota exhaustion, including rows stored under the legacy name. */
export function isWhatsAppAutoReplyQuotaCode(
  code: string | null | undefined,
): boolean {
  const value = normalize(code);
  return matches(value, quotaPausedCodes) || matches(value, legacyQuotaNames);
}

/**
 * The sentence shown on a message whose reply is waiting on a limit, or null
 * when the code is not one of those.
 */
export function whatsAppAutoReplyPausedMessage(
  code: string | null | undefined,
): string | null {
  const value = normalize(code);
  if (matches(value, quotaPausedCodes) || matches(value, legacyQuotaNames)) {
    return "تأجّل الرد الآلي على هذه الرسالة لأن حصة الذكاء الاصطناعي في خطتك مستنفدة. يُستأنف تلقائيًا عند تجديد الحصة أو فور ترقية خطتك، ويمكنك الرد يدويًا الآن.";
  }
  if (matches(value, configurationPausedCodes)) {
    return "تأجّل الرد الآلي على هذه الرسالة لأن إعداد الذكاء الاصطناعي على الخادم غير مكتمل. يُستأنف تلقائيًا بمجرد اكتمال الإعداد، ويمكنك الرد يدويًا الآن.";
  }
  return null;
}

/**
 * The sentence shown on a terminal `failed` row whose cause was a limit —
 * legacy rows the pause behaviour cannot rescue, where the honest advice is a
 * manual reply for this message and patience for the next ones.
 */
export function whatsAppAutoReplyLimitFailureMessage(
  code: string | null | undefined,
): string | null {
  if (!isWhatsAppAutoReplyQuotaCode(code)) return null;
  return "تعذّر إنشاء الرد الآلي لأن حصة الذكاء الاصطناعي كانت مستنفدة. أرسل ردًا يدويًا لهذه الرسالة؛ الرسائل الجديدة تُؤجَّل الآن تلقائيًا حتى تتجدد الحصة بدل أن يفوت الرد عليها.";
}
