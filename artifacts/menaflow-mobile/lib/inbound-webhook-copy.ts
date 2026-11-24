/**
 * inbound-webhook-copy.ts
 *
 * Merchant wording for the recorded webhook attempts behind the reply-settings
 * screens.
 *
 * The server reports counts and stable event names; neither is something a
 * merchant can act on. What they need is the one distinction that decides where
 * to look: did the provider never call, did it call and get refused, or is
 * everything arriving and the silence is upstream of us? Each of those gets its
 * own sentence, and a refusal carries the recorded hint next to it because that
 * hint names the setting to change.
 *
 * Formatters are injected, matching `lib/extraction-quota-copy.ts`: the unit
 * test runner cannot resolve the app's extensionless imports, so this module
 * stays dependency-free and testable.
 */

export type WebhookAttemptSummary = {
  count: number;
  lastAt?: string | null;
  lastEvent?: string | null;
  /** Arabic guidance recorded for the last outcome. */
  lastHint?: string | null;
  acceptedCount: number;
  rejectedCount: number;
  lastRejectedEvent?: string | null;
  lastRejectedHint?: string | null;
};

export type WebhookAttemptFact = {
  label: string;
  value: string;
};

export type WebhookAttemptFormatters = {
  formatNumber: (value: number) => string;
  /** Returns null when the value cannot be formatted. */
  formatDateTime: (value: string | null) => string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * One sentence over the recorded attempts, or null when there is nothing worth
 * saying. Zero attempts is deliberately not summarized here: the diagnostics
 * issues already name that case with the fix, and repeating it as a neutral
 * sentence would soften a critical finding.
 *
 * The total is stated as a floor. The server throttles repeated *accepted*
 * outcomes to one row per minute, because the inbound path is its hottest code
 * and a hundred identical "event ignored" rows say what the first one did;
 * refusals are never throttled. So the accepted count is a sample and the
 * refusal count is exact — and the wording must not claim a precision the data
 * does not have.
 */
export function webhookAttemptHeadline(
  summary: WebhookAttemptSummary | null | undefined,
  formatters: WebhookAttemptFormatters,
): string | null {
  if (!summary) return null;
  const count = Number.isFinite(summary.count) ? Math.max(0, summary.count) : 0;
  if (count === 0) return null;
  const rejected = Number.isFinite(summary.rejectedCount)
    ? Math.max(0, summary.rejectedCount)
    : 0;
  const total = formatters.formatNumber(count);

  if (rejected >= count) {
    // Exact: refusals are never throttled, so "every recorded attempt was
    // refused" is a statement about all of them, not a sample.
    const reason =
      text(summary.lastRejectedHint) ?? text(summary.lastRejectedEvent);
    const named = reason ? `؛ آخرها ${reason}` : "";
    return `وصلت ${total} محاولة إلى الخادم ورُفضت كلها${named}.`;
  }
  if (rejected > 0) {
    const reason =
      text(summary.lastRejectedHint) ?? text(summary.lastRejectedEvent);
    const named = reason ? `؛ آخر رفض ${reason}` : "";
    return `استقبل الخادم ${total} محاولة مسجَّلة على الأقل، ورُفضت ${formatters.formatNumber(rejected)} منها${named}.`;
  }
  const when = formatters.formatDateTime(summary.lastAt ?? null);
  return `استقبل الخادم ${total} محاولة مسجَّلة على الأقل وعالجها جميعًا${when ? `، آخرها ${when}` : ""}.`;
}

/**
 * Fact rows for the delivery card. Rows with no value are omitted by the card,
 * so the refusal rows simply disappear when nothing was refused.
 */
export function webhookAttemptFacts(
  summary: WebhookAttemptSummary | null | undefined,
  formatters: WebhookAttemptFormatters,
): WebhookAttemptFact[] {
  if (!summary) return [];
  const count = Number.isFinite(summary.count) ? Math.max(0, summary.count) : 0;
  if (count === 0) return [];
  const rejected = Number.isFinite(summary.rejectedCount)
    ? Math.max(0, summary.rejectedCount)
    : 0;
  const facts: WebhookAttemptFact[] = [
    {
      label: "محاولات الويب هوك المسجّلة",
      value: formatters.formatNumber(count),
    },
    {
      label: "آخر محاولة",
      value: formatters.formatDateTime(summary.lastAt ?? null) ?? "غير مؤرّخة",
    },
  ];
  if (rejected > 0) {
    facts.push({
      label: "محاولات مرفوضة",
      value: formatters.formatNumber(rejected),
    });
    const reason =
      text(summary.lastRejectedHint) ?? text(summary.lastRejectedEvent);
    if (reason) {
      facts.push({ label: "سبب آخر رفض", value: reason });
    }
  }
  return facts;
}
