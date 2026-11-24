/**
 * inbound-diagnostics.ts
 *
 * Shapes raw inbound counters into the diagnostics block the reply-settings
 * screens show. The question a merchant actually has is "did anything ever
 * arrive?", and answering it needs the same few facts on both platforms:
 * whether the provider reached the server, whether the webhook is configured on
 * our side, and what the last inbound event was.
 *
 * Pure on purpose: the routes fetch the rows, this module interprets them, so
 * the wording and the thresholds are testable.
 */

import { isAutoReplyGenerationPausedCode } from "./error-codes.ts";
import {
  inboundWebhookOutcomeForEvent,
  isInboundWebhookRejection,
} from "./inbound-webhook-diagnostics.ts";

/**
 * How many of the waiting replies are blocked by a limit that lifts by itself.
 *
 * The queue keeps such a reply `queued` rather than failing it, which is right
 * for the customer and invisible to the merchant: the settings screen would
 * otherwise show "3 replies waiting" with no way to tell a busy worker from a
 * quota that ran out. Counting them here is what makes the difference legible.
 */
function arabicDigits(value: number): string {
  return String(value).replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

/**
 * A count of postponed replies as a full Arabic noun phrase.
 *
 * Numeral agreement is not optional here: one, two, three to ten and eleven
 * above each take a different noun and adjective form, and a fragment like
 * "٣ مؤجَّل" is exactly what makes a diagnostics screen read as machine
 * translated.
 */
function postponedRepliesPhrase(count: number): string {
  const safe = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  if (safe === 1) return "ردّ واحد مؤجَّل";
  if (safe === 2) return "ردّان مؤجَّلان";
  if (safe <= 10) return `${arabicDigits(safe)} ردود مؤجَّلة`;
  return `${arabicDigits(safe)} ردًّا مؤجَّلًا`;
}

/**
 * The sentence shown when replies are waiting on a limit rather than on the
 * worker. It names both limits that can cause it, promises the automatic
 * resume, and always leaves the merchant an action they can take now.
 *
 * The reply window is deliberately not quoted as a number: WhatsApp's is
 * configurable, and a sentence that states "12 hours" on a deployment set to 60
 * minutes would be worse than one that says "within the reply window".
 */
export function postponedRepliesSentence(count: number): string {
  return `${postponedRepliesPhrase(count)} لأن حدًا يرتفع وحده يعيق توليد الرد: حصة الذكاء الاصطناعي لهذا الشهر، أو إعداد مزوّد الذكاء الاصطناعي على الخادم. يُستأنف الإرسال تلقائيًا عند ارتفاع الحد ما دامت الرسالة داخل مهلة الرد الآلي، ويمكنك الرد يدويًا الآن.`;
}

function countPostponedByLimit(
  errorCodes: ReadonlyArray<string | null | undefined>,
): number {
  return errorCodes.filter((code) => isAutoReplyGenerationPausedCode(code)).length;
}

export type DiagnosticIssue = {
  /** Stable code a client can branch on. */
  code: string;
  /** Arabic sentence shown to the merchant. */
  message: string;
  severity: "warning" | "critical";
};

/** One recorded webhook attempt, as the delivery log stores it. */
export type InboundWebhookAttemptRow = {
  event: string;
  deliveryConfirmed: boolean;
  createdAt: Date | string | null;
};

export type InboundWebhookAttemptSummary = {
  count: number;
  lastAt: string | null;
  lastEvent: string | null;
  /** Arabic guidance recorded for that outcome. */
  lastHint: string | null;
  acceptedCount: number;
  rejectedCount: number;
  lastRejectedEvent: string | null;
  lastRejectedHint: string | null;
};

function attemptTime(row: InboundWebhookAttemptRow): number {
  if (row.createdAt instanceof Date) return row.createdAt.getTime();
  if (typeof row.createdAt === "string") {
    const parsed = Date.parse(row.createdAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Folds recorded attempts into the facts a screen can show.
 *
 * The distinction that matters is between "the provider never called" and "it
 * called and we refused it": the first is a registration problem on the
 * provider side, the second names a variable to fix here. Both are invisible
 * without this log, and both read as "no messages arrive".
 */
export function summarizeInboundWebhookAttempts(
  rows: ReadonlyArray<InboundWebhookAttemptRow>,
): InboundWebhookAttemptSummary {
  const ordered = [...rows].sort((a, b) => attemptTime(b) - attemptTime(a));
  const last = ordered[0];
  const lastRejected = ordered.find((row) =>
    isInboundWebhookRejection(row.event),
  );
  const rejectedCount = ordered.filter((row) =>
    isInboundWebhookRejection(row.event),
  ).length;
  const lastOutcome = last ? inboundWebhookOutcomeForEvent(last.event) : null;
  const rejectedOutcome = lastRejected
    ? inboundWebhookOutcomeForEvent(lastRejected.event)
    : null;
  return {
    count: ordered.length,
    lastAt: last
      ? new Date(attemptTime(last)).toISOString()
      : null,
    lastEvent: last?.event ?? null,
    lastHint: lastOutcome?.hint ?? null,
    acceptedCount: ordered.length - rejectedCount,
    rejectedCount,
    lastRejectedEvent: lastRejected?.event ?? null,
    lastRejectedHint: rejectedOutcome?.hint ?? null,
  };
}

export type WhatsAppInboundDiagnosticsInput = {
  lastDirectMessageAt: Date | null;
  directMessageCount: number;
  autoReplyEventCounts: Array<{ status: string; total: number }>;
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
  webhookUrlError: string | null;
  /**
   * Recorded webhook attempts. Omitted when the caller has not read the log, in
   * which case the summary stays null and no attempt-based conclusion is drawn.
   */
  webhookAttempts?: ReadonlyArray<InboundWebhookAttemptRow>;
  /** Error codes of the replies still waiting, used to spot the postponed ones. */
  queuedReplyErrorCodes?: ReadonlyArray<string | null>;
};

export type WhatsAppInboundDiagnostics = {
  deliveryConfirmed: boolean;
  lastDirectMessageAt: string | null;
  directMessageCount: number;
  autoReplyEvents: {
    queued: number;
    sent: number;
    failed: number;
    other: number;
    /** Waiting on a limit that lifts by itself, not on the worker. */
    postponedByLimit: number;
  };
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
  webhookAttempts: InboundWebhookAttemptSummary | null;
  issues: DiagnosticIssue[];
};

function countByStatus(
  rows: ReadonlyArray<{ status: string; total: number }>,
  statuses: readonly string[],
): number {
  return rows
    .filter((row) => statuses.includes(row.status))
    .reduce((sum, row) => sum + row.total, 0);
}

export function whatsAppInboundDiagnostics(
  input: WhatsAppInboundDiagnosticsInput,
): WhatsAppInboundDiagnostics {
  const issues: DiagnosticIssue[] = [];
  if (!input.webhookSecretConfigured) {
    issues.push({
      code: "WHATSAPP_WEBHOOK_SECRET_MISSING",
      message:
        "WHATSAPP_EVOLUTION_WEBHOOK_SECRET غير مضبوط في الخادم، لذا تُرفض أحداث Evolution. أضفه ثم أعد تسجيل رابط الويب هوك.",
      severity: "critical",
    });
  }
  if (!input.webhookUrl) {
    issues.push({
      code: input.webhookUrlError ?? "WHATSAPP_WEBHOOK_URL_MISSING",
      message:
        "تعذر تحديد رابط الويب هوك العام. اضبط WHATSAPP_EVOLUTION_WEBHOOK_URL أو DOMAIN في الخادم.",
      severity: "critical",
    });
  }
  const attempts = input.webhookAttempts
    ? summarizeInboundWebhookAttempts(input.webhookAttempts)
    : null;
  const postponed = countPostponedByLimit(input.queuedReplyErrorCodes ?? []);
  if (input.directMessageCount === 0) {
    if (!attempts || attempts.count === 0) {
      issues.push({
        code: "WHATSAPP_NO_WEBHOOK_ATTEMPTS",
        message:
          "لم يسجّل الخادم أي محاولة استقبال من Evolution خلال الفترة المحفوظة، أي أن المزوّد لا يرسل الأحداث أصلًا. أعد تسجيل رابط الويب هوك من هذا الزر، وتحقق من أن Evolution يستطيع الوصول إلى نطاق الخادم، ثم أرسل رسالة تجريبية.",
        severity: "critical",
      });
    } else if (attempts.acceptedCount === 0) {
      issues.push({
        code: "WHATSAPP_WEBHOOK_ATTEMPTS_REJECTED",
        message: `يصل Evolution إلى الخادم لكن كل محاولة رُفضت (آخرها ${attempts.lastRejectedEvent}). ${attempts.lastRejectedHint ?? ""}`.trim(),
        severity: "critical",
      });
    } else {
      issues.push({
        code: "WHATSAPP_NO_INBOUND_EVENTS",
        message:
          "تصل أحداث من Evolution إلى الخادم، لكن لم تُحفظ أي رسالة فردية من عميل. الأحداث الواصلة أحداث مجموعات على الأرجح؛ أرسل رسالة فردية تجريبية من هاتف العميل للتحقق.",
        severity: "warning",
      });
    }
  }
  if (postponed > 0) {
    issues.push({
      code: "WHATSAPP_AUTO_REPLIES_POSTPONED_FOR_LIMIT",
      message: postponedRepliesSentence(postponed),
      severity: "warning",
    });
  }
  return {
    deliveryConfirmed: input.directMessageCount > 0,
    lastDirectMessageAt: input.lastDirectMessageAt?.toISOString() ?? null,
    directMessageCount: input.directMessageCount,
    autoReplyEvents: {
      queued: countByStatus(input.autoReplyEventCounts, [
        "queued",
        "processing",
        "sending",
      ]),
      sent: countByStatus(input.autoReplyEventCounts, ["sent", "completed"]),
      failed: countByStatus(input.autoReplyEventCounts, ["failed"]),
      other: countByStatus(input.autoReplyEventCounts, ["unknown", "skipped"]),
      postponedByLimit: postponed,
    },
    webhookSecretConfigured: input.webhookSecretConfigured,
    webhookUrl: input.webhookUrl,
    webhookAttempts: attempts,
    issues,
  };
}

export type MetaInboundDiagnosticsInput = {
  lastInboxItemAt: Date | null;
  inboxItemCount: number;
  inboxCountsByPlatform: Array<{ platform: string; total: number }>;
  autoReplyJobCounts: Array<{ status: string; total: number }>;
  subscriptions: Array<{
    platform: string;
    accountId: string;
    subscribedFields: string[];
    subscribedAt: Date | null;
    lastErrorCode: string | null;
  }>;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  /** Recorded webhook attempts; omitted when the log was not read. */
  webhookAttempts?: ReadonlyArray<InboundWebhookAttemptRow>;
  /** Error codes of the reply jobs still waiting. */
  queuedJobErrorCodes?: ReadonlyArray<string | null>;
};

export type MetaInboundDiagnostics = {
  deliveryConfirmed: boolean;
  lastInboxItemAt: string | null;
  inboxItemCount: number;
  inboxCountByPlatform: Record<string, number>;
  autoReplyJobs: {
    queued: number;
    completed: number;
    failed: number;
    skipped: number;
    /** Waiting on a limit that lifts by itself, not on the worker. */
    postponedByLimit: number;
  };
  subscriptions: Array<{
    platform: string;
    accountId: string;
    subscribedFields: string[];
    subscribedAt: string | null;
    lastErrorCode: string | null;
  }>;
  verifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  webhookAttempts: InboundWebhookAttemptSummary | null;
  issues: DiagnosticIssue[];
};

export function metaInboundDiagnostics(
  input: MetaInboundDiagnosticsInput,
): MetaInboundDiagnostics {
  const issues: DiagnosticIssue[] = [];
  if (!input.appSecretConfigured) {
    issues.push({
      code: "META_APP_SECRET_MISSING",
      message:
        "FACEBOOK_APP_SECRET غير مضبوط، لذا يُرفض كل حدث قادم من Meta. أضفه إلى متغيرات البيئة ثم أعد النشر.",
      severity: "critical",
    });
  }
  if (!input.verifyTokenConfigured) {
    issues.push({
      code: "META_WEBHOOK_VERIFY_TOKEN_MISSING",
      message:
        "MENA_META_WEBHOOK_VERIFY_TOKEN غير مضبوط، لذا لا يمكن لـ Meta التحقق من رابط الويب هوك ولا تجديد الاشتراكات.",
      severity: "critical",
    });
  }
  for (const subscription of input.subscriptions) {
    if (subscription.lastErrorCode) {
      issues.push({
        code: `META_SUBSCRIPTION_FAILED:${subscription.lastErrorCode}`,
        message:
          subscription.platform === "instagram"
            ? `تعذر تجديد اشتراك أحداث إنستغرام (${subscription.lastErrorCode}). أعد ربط الحساب أو جدّد الاشتراك من هذا الزر.`
            : `تعذر تجديد اشتراك أحداث الصفحة (${subscription.lastErrorCode}). أعد ربط الحساب أو جدّد الاشتراك من هذا الزر.`,
        severity: "warning",
      });
    }
  }
  if (input.subscriptions.length === 0) {
    issues.push({
      code: "META_NO_SUBSCRIPTIONS",
      message:
        "لا يوجد اشتراك أحداث مسجل. جدّد الاشتراك من هذا الزر بعد ربط حساب Meta.",
      severity: "warning",
    });
  }
  const metaAttempts = input.webhookAttempts
    ? summarizeInboundWebhookAttempts(input.webhookAttempts)
    : null;
  const metaPostponed = countPostponedByLimit(input.queuedJobErrorCodes ?? []);
  if (input.inboxItemCount === 0) {
    if (!metaAttempts || metaAttempts.count === 0) {
      issues.push({
        code: "META_NO_WEBHOOK_ATTEMPTS",
        message:
          "لم يسجّل الخادم أي محاولة استقبال من Meta خلال الفترة المحفوظة، أي أن Meta لا ترسل الأحداث أصلًا. تحقق من وضع التطبيق في لوحة Meta (وضع Development يلزمه مراجعة التطبيق) ومن أن رابط الويب هوك يشير إلى نطاق الخادم، ثم أرسل رسالة تجريبية.",
        severity: "critical",
      });
    } else if (metaAttempts.acceptedCount === 0) {
      issues.push({
        code: "META_WEBHOOK_ATTEMPTS_REJECTED",
        message: `تصل Meta إلى الخادم لكن كل محاولة رُفضت (آخرها ${metaAttempts.lastRejectedEvent}). ${metaAttempts.lastRejectedHint ?? ""}`.trim(),
        severity: "critical",
      });
    } else {
      issues.push({
        code: "META_NO_INBOUND_EVENTS",
        message:
          "تصل أحداث من Meta إلى الخادم، لكن لم يُحفظ أي تفاعل في صندوق الوارد. الأحداث الواصلة لا تخص الحسابات المرتبطة على الأرجح؛ جدّد الاشتراك وتأكد من مطابقة معرّف الصفحة أو حساب إنستغرام.",
        severity: "warning",
      });
    }
  }
  if (metaPostponed > 0) {
    issues.push({
      code: "META_AUTO_REPLIES_POSTPONED_FOR_LIMIT",
      message: postponedRepliesSentence(metaPostponed),
      severity: "warning",
    });
  }
  return {
    deliveryConfirmed: input.inboxItemCount > 0,
    lastInboxItemAt: input.lastInboxItemAt?.toISOString() ?? null,
    inboxItemCount: input.inboxItemCount,
    inboxCountByPlatform: Object.fromEntries(
      input.inboxCountsByPlatform.map((row) => [row.platform, row.total]),
    ),
    autoReplyJobs: {
      queued: countByStatus(input.autoReplyJobCounts, [
        "queued",
        "processing",
        "sending",
        "pending",
      ]),
      completed: countByStatus(input.autoReplyJobCounts, ["completed", "sent"]),
      failed: countByStatus(input.autoReplyJobCounts, [
        "failed",
        "action_required",
      ]),
      skipped: countByStatus(input.autoReplyJobCounts, ["skipped", "unknown"]),
      postponedByLimit: metaPostponed,
    },
    subscriptions: input.subscriptions.map((subscription) => ({
      platform: subscription.platform,
      accountId: subscription.accountId,
      subscribedFields: subscription.subscribedFields,
      subscribedAt: subscription.subscribedAt?.toISOString() ?? null,
      lastErrorCode: subscription.lastErrorCode,
    })),
    verifyTokenConfigured: input.verifyTokenConfigured,
    appSecretConfigured: input.appSecretConfigured,
    webhookAttempts: metaAttempts,
    issues,
  };
}
