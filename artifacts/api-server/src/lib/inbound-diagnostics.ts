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

export type DiagnosticIssue = {
  /** Stable code a client can branch on. */
  code: string;
  /** Arabic sentence shown to the merchant. */
  message: string;
  severity: "warning" | "critical";
};

export type WhatsAppInboundDiagnosticsInput = {
  lastDirectMessageAt: Date | null;
  directMessageCount: number;
  autoReplyEventCounts: Array<{ status: string; total: number }>;
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
  webhookUrlError: string | null;
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
  };
  webhookSecretConfigured: boolean;
  webhookUrl: string | null;
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
  if (input.directMessageCount === 0) {
    issues.push({
      code: "WHATSAPP_NO_INBOUND_EVENTS",
      message:
        "لم تصل أي رسالة واتساب فردية إلى الخادم. تحقق من أن Evolution يرسل الأحداث إلى رابط الويب هوك، ثم أعد تسجيله من هذا الزر وأرسل رسالة تجريبية.",
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
    },
    webhookSecretConfigured: input.webhookSecretConfigured,
    webhookUrl: input.webhookUrl,
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
  if (input.inboxItemCount === 0) {
    issues.push({
      code: "META_NO_INBOUND_EVENTS",
      message:
        "لم يصل أي حدث من فيسبوك أو إنستغرام إلى الخادم. تحقق من وضع التطبيق في لوحة Meta (Development يلزمه مراجعة) ومن أن رابط الويب هوك يشير إلى نطاق الخادم، ثم أرسل رسالة تجريبية.",
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
    issues,
  };
}
