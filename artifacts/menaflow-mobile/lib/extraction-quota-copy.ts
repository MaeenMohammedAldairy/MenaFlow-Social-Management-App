/** What the queued batch costs in AI quota, as the server estimated it. */
export type ExtractionQuotaEstimate = {
  messages: number;
  estimatedGenerations: number;
  worstCaseGenerations: number;
  used: number;
  limit: number;
  remaining: number;
  fitsWithinQuota: boolean;
  messagesWithinQuota: number;
};

/**
 * What the merchant is told after queueing messages for product extraction.
 *
 * Queueing is free to click and not free to run: every message costs one AI
 * generation from the plan's monthly quota. Saying only «أُضيفت ٢٠٠ رسالة»
 * leaves the merchant to discover the cost when the queue pauses, so the
 * summary states what the remaining quota covers and what happens to the rest.
 *
 * The number formatter is injected rather than imported: this module is read by
 * the app's test runner, which cannot follow the app's extensionless imports.
 */
export function analysisSummaryMessage(
  result: {
    queuedMessages: number;
    quota?: ExtractionQuotaEstimate;
  },
  formatNumber: (value: number) => string,
): string {
  const queued = Math.max(0, Math.trunc(result.queuedMessages) || 0);
  if (queued === 0) {
    return "لا توجد رسائل جديدة أو غير معالجة في المجموعات المحددة.";
  }
  const base =
    `أُضيفت ${formatNumber(queued)} رسالة إلى طابور تحليل المنتجات.` +
    " لا تُجدول للنشر تلقائيًا؛ ستظهر النتائج للمراجعة بعد اكتمالها.";
  const quota = result.quota;
  if (!quota) return base;
  if (quota.fitsWithinQuota) {
    return (
      `${base} تستهلك كل رسالة عملية ذكاء اصطناعي واحدة،` +
      ` والمتبقي في حصتك ${formatNumber(quota.remaining)} من ${formatNumber(quota.limit)}.`
    );
  }
  return (
    `${base} تكفي حصتك المتبقية` +
    ` (${formatNumber(quota.remaining)} من ${formatNumber(quota.limit)})` +
    ` لتحليل ${formatNumber(quota.messagesWithinQuota)} رسالة الآن؛` +
    " تنتظر البقية تلقائيًا حتى تتجدد الحصة أو ترقّي خطتك."
  );
}
