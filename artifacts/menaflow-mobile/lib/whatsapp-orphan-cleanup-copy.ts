/**
 * whatsapp-orphan-cleanup-copy.ts
 *
 * Merchant wording for the orphan-session sweep that runs when a WhatsApp webhook
 * is re-registered.
 *
 * The server reports counts and stable reason codes; what a merchant needs is the
 * one thing this can explain that nothing else in the app can: that messages were
 * arriving all along and going to a WhatsApp session left behind by a workspace
 * that no longer exists, which is why the inbox looked empty. That sentence is
 * worth showing only when something was actually removed — otherwise the button
 * reads as though it had found a problem it did not find.
 *
 * A session this app cannot remove is reported too, because it has a different
 * owner and a different fix: another workspace still claims that phone number,
 * and only disconnecting it there will let messages arrive here.
 *
 * Dependency-free with injected formatters, matching `lib/inbound-webhook-copy.ts`:
 * the unit test runner cannot resolve the app's extensionless imports, so this
 * module stays testable on its own.
 */

export type OrphanedInstanceSummary = {
  instanceName?: string | null;
  /** `deleted`, `delete_failed`, `skipped` or `not_attempted`. */
  action?: string | null;
  /** Stable reason code, e.g. `CLAIMED_BY_WORKSPACE`. */
  reason?: string | null;
};

export type OrphanCleanupSummary = {
  attempted?: boolean | null;
  deleted?: number | null;
  failed?: number | null;
  skipped?: number | null;
  instances?: ReadonlyArray<OrphanedInstanceSummary> | null;
};

export type OrphanCleanupFormatters = {
  formatNumber: (value: number) => string;
};

/** Whole, non-negative count; a missing or fractional value degrades to 0. */
function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * Arabic does not put a plural noun after every number, and the verb and pronouns
 * have to agree with it: one session is feminine singular («فأزالها»), two take
 * the dual («فأزالهما»), three to ten the plural, eleven and above the singular
 * again. Each case is written out whole rather than assembled, because assembling
 * it is what produces «٢ جلسات» and «أزالها» for a dual.
 */
function removedSessionsPhrase(
  deleted: number,
  formatters: OrphanCleanupFormatters,
): string {
  const trailing =
    "الرسائل التي كانت تصل إليها كانت تُرفض فلا تظهر في صندوق الوارد.";
  if (deleted <= 1) {
    return `وجد الخادم جلسة واتساب قديمة مرتبطة بالرقم نفسه ولا تخص أي مساحة عمل، فأزالها. ${trailing}`;
  }
  if (deleted === 2) {
    return `وجد الخادم جلستي واتساب قديمتين مرتبطتين بالرقم نفسه ولا تخصان أي مساحة عمل، فأزالهما. ${trailing.replace(
      "إليها",
      "إليهما",
    )}`;
  }
  const total = formatters.formatNumber(deleted);
  if (deleted <= 10) {
    return `وجد الخادم ${total} جلسات واتساب قديمة مرتبطة بالرقم نفسه ولا تخص أي مساحة عمل، فأزالها. ${trailing}`;
  }
  return `وجد الخادم ${total} جلسة واتساب قديمة مرتبطة بالرقم نفسه ولا تخص أي مساحة عمل، فأزالها. ${trailing}`;
}

/**
 * One or two sentences over the sweep, or null when there is nothing worth
 * saying. Not attempted, and attempted-but-clean, both stay silent: the
 * re-registration message already tells the merchant what happened, and
 * «nothing was wrong» invites them to stop looking when the inbox is still dead.
 */
export function orphanCleanupSentence(
  summary: OrphanCleanupSummary | null | undefined,
  formatters: OrphanCleanupFormatters,
): string | null {
  if (!summary || summary.attempted === false) return null;

  const deleted = count(summary.deleted);
  const failed = count(summary.failed);
  const claimedByWorkspace = (summary.instances ?? []).filter(
    (instance) =>
      instance?.action === "skipped" && instance?.reason === "CLAIMED_BY_WORKSPACE",
  ).length;

  const parts: string[] = [];

  if (deleted > 0) {
    parts.push(removedSessionsPhrase(deleted, formatters));
    if (failed > 0) {
      // No count here on purpose: «تعذّر إزالة ١ منها» reads as a mistake, and
      // the exact number is in the server log either way.
      parts.push("وتعذّر إزالة جلسات أخرى؛ أعد المحاولة بعد قليل.");
    }
  } else if (failed > 0) {
    parts.push(
      "تعذّر إزالة جلسات واتساب قديمة مرتبطة بالرقم نفسه؛ أعد المحاولة بعد قليل.",
    );
  }

  if (claimedByWorkspace > 0) {
    parts.push(
      "توجد جلسة واتساب أخرى مرتبطة بالرقم نفسه ومسجَّلة في مساحة عمل أخرى؛ افصلها من تلك المساحة لتصل الرسائل إلى هذه المساحة.",
    );
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
