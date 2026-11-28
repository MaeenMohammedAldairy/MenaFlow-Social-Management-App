/**
 * Shadow comparison — Phase 2.
 *
 * Legacy grouping and the shadow engine are asked the same question about the
 * same window: *which messages belong together?* This module turns their two
 * answers into one of a fixed set of categories, plus the reason.
 *
 * It reads legacy state through a caller-supplied function, so nothing here
 * touches the database itself: the CLI feeds it rows, the tests feed it
 * fixtures.
 */

import type { ShadowPlanResult } from "./whatsapp-bundle-engine.ts";

/**
 * The categories are named after *what the current pipeline did*, because that
 * is the thing being judged. `LEGACY_SPLIT` therefore means "legacy saw fewer
 * messages than the bundle really has" — including the common case of a group of
 * one, which is how every album-less photo run is stored today.
 */
export type ShadowComparison =
  | "MATCH"
  | "LEGACY_SPLIT"
  | "LEGACY_MERGE"
  | "SET_OVERLAP"
  | "MISSING_SIGNAL"
  | "CONFLICT"
  | "WAITING_MEDIA"
  | "NEEDS_REVIEW"
  | "NO_MATCH";

/** Legacy group identity of one message, as the current pipeline sees it. */
export type LegacyGroupReference = {
  /** `album:<hash>`, `bundle:<hash>`, `message:<hash>` — or null when unqueued. */
  groupKey: string | null;
  kind: "album" | "bundle" | "message" | "none";
  /** Message ids the current pipeline would send to the model. */
  memberMessageIds: string[];
  reason: string | null;
};

export type ShadowMessageComparison = {
  messageId: string;
  remoteMessageId: string;
  legacyGroupKey: string | null;
  legacyKind: LegacyGroupReference["kind"];
  newBundleKey: string | null;
  newBundleStatus: string | null;
  result: ShadowComparison;
  reason: string;
  detail: Record<string, unknown>;
};

export type ShadowComparisonSummary = {
  total: number;
  byResult: Record<ShadowComparison, number>;
  messages: ShadowMessageComparison[];
};

const RESULT_ORDER: ShadowComparison[] = [
  "MATCH",
  "LEGACY_SPLIT",
  "LEGACY_MERGE",
  "SET_OVERLAP",
  "MISSING_SIGNAL",
  "CONFLICT",
  "WAITING_MEDIA",
  "NEEDS_REVIEW",
  "NO_MATCH",
];

function emptyCounts(): Record<ShadowComparison, number> {
  const counts = {} as Record<ShadowComparison, number>;
  for (const result of RESULT_ORDER) counts[result] = 0;
  return counts;
}

function sameGroup(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/**
 * Compare one window.
 *
 * The category is assigned from the *sets*, not from the labels: a legacy
 * album id and a shadow bundle id are different strings even when they cover
 * exactly the same messages, and that is a MATCH — the ids are not the claim,
 * the membership is.
 */
export function compareShadowPlan(input: {
  plan: ShadowPlanResult;
  legacyByMessage: Map<string, LegacyGroupReference>;
  /** Media rows still downloading, keyed by message id. */
  pendingMediaByMessage?: Map<string, number>;
}): ShadowComparisonSummary {
  const messages: ShadowMessageComparison[] = [];
  const byResult = emptyCounts();

  for (const [messageId, bundleId] of input.plan.messageBundle) {
    const bundle = input.plan.bundles.find((item) => item.id === bundleId);
    const legacy = input.legacyByMessage.get(messageId) ?? {
      groupKey: null,
      kind: "none" as const,
      memberMessageIds: [messageId],
      reason: null,
    };
    const newMembers = bundle?.members.map((member) => member.messageId) ?? [];
    const pending = input.pendingMediaByMessage?.get(messageId) ?? 0;

    let result: ShadowComparison;
    let reason: string;

    if (!legacy.groupKey) {
      result = "NO_MATCH";
      reason = "LEGACY_HAS_NO_GROUP";
    } else if (bundle?.status === "NEEDS_REVIEW") {
      // A question, not an answer: neither side can be called right yet.
      result = "NEEDS_REVIEW";
      reason = bundle.reviewReason ?? "AMBIGUOUS_EVIDENCE";
    } else if (bundle?.status === "COLLECTING" && (pending > 0 || bundle.reviewReason === "MEDIA_PENDING")) {
      result = "WAITING_MEDIA";
      reason = "MEDIA_NOT_STORED_YET";
    } else if (sameGroup(legacy.memberMessageIds, newMembers)) {
      result = "MATCH";
      reason = bundle?.evidence ?? "SAME_MEMBERSHIP";
    } else {
      const legacySet = new Set(legacy.memberMessageIds);
      const newSet = new Set(newMembers);
      const legacyInsideNew = [...legacySet].every((id) => newSet.has(id));
      const newInsideLegacy = [...newSet].every((id) => legacySet.has(id));
      if (legacyInsideNew) {
        // Legacy sent fewer messages than the offer really has: the price text
        // was never queued, or only the first photo of five was.
        result = "LEGACY_SPLIT";
        // `MEDIA_PARTIAL` is a READY bundle with a named shortfall, so the
        // comparison still judges membership — the gap is reported in `detail`.
        reason = legacySet.size === 1
          ? "LEGACY_QUEUED_ONE_MESSAGE_ALONE"
          : "LEGACY_SENT_FEWER_MESSAGES";
      } else if (newInsideLegacy) {
        // Legacy joined messages that are not one offer.
        result = "LEGACY_MERGE";
        reason =
          legacy.kind === "bundle"
            ? "LEGACY_ASSOCIATION_JOINED_EXTRA_MESSAGES"
            : "LEGACY_GROUP_WIDER";
      } else {
        // Neither set contains the other: legacy split one side and merged the
        // other, so the two answers cross rather than differ in width.
        result = "SET_OVERLAP";
        reason = "MEMBERSHIPS_CROSS";
      }
    }

    // A signal the shadow engine needed but the stored row does not carry is
    // reported as such, whatever the membership says: it is the entry point
    // for fixing the misconfiguration, not just a difference of opinion.
    if (legacy.reason === "MISSING_SIGNAL") {
      result = "MISSING_SIGNAL";
      reason = "SIGNAL_ABSENT_AT_STORAGE_TIME";
    }

    byResult[result] += 1;
    messages.push({
      messageId,
      remoteMessageId: messageId,
      legacyGroupKey: legacy.groupKey,
      legacyKind: legacy.kind,
      newBundleKey: bundle?.id ?? null,
      newBundleStatus: bundle?.status ?? null,
      result,
      reason,
      detail: {
        legacyMembers: legacy.memberMessageIds.length,
        newMembers: newMembers.length,
        evidence: bundle?.evidence ?? null,
        pendingMedia: pending,
        mediaExpected: bundle?.mediaExpected ?? null,
        mediaStored: bundle?.mediaStored ?? null,
        reviewReason: bundle?.reviewReason ?? null,
        bundleVersion: bundle?.version ?? null,
      },
    });
  }

  return { total: messages.length, byResult, messages };
}
