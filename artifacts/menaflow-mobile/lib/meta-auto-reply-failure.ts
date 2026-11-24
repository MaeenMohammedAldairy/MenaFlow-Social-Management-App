/**
 * Turns the stored failure code of a Meta automatic reply into something the
 * merchant can act on. The server records a short machine code; without this
 * mapping every cause collapses into the same "could not send" banner.
 */
const metaAutoReplyFailureReasons: Array<{
  match: string;
  describe: string;
}> = [
  {
    // Terminal rows only. A reply blocked by the quota now stays queued and
    // resumes by itself, so this wording is for jobs recorded before that
    // behaviour existed — the honest advice there is a manual reply.
    match: "SUBSCRIPTION_LIMIT_REACHED",
    describe:
      "لم يُرسل الرد الآلي لأن حصة الذكاء الاصطناعي كانت مستنفدة. أرسل ردًا يدويًا لهذه الرسالة؛ الرسائل الجديدة تُؤجَّل الآن تلقائيًا حتى تتجدد الحصة بدل أن يفوت الرد عليها.",
  },
  {
    match: "WORKSPACE_SUBSCRIPTION_MISSING",
    describe:
      "توقّف الرد الآلي لأن إعداد اشتراك هذه المساحة غير مكتمل على الخادم.",
  },
  {
    match: "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
    describe:
      "توقّف الرد الآلي لأن خطة الاشتراك المحفوظة غير معروفة على الخادم.",
  },
  {
    match: "MISSING_OPENAI_KEY",
    describe:
      "توقّف الرد الآلي لأن مفتاح مزوّد الذكاء الاصطناعي غير مهيأ على الخادم.",
  },
  {
    match: "MISSING_GEMINI_KEY",
    describe:
      "توقّف الرد الآلي لأن مفتاح مزوّد الذكاء الاصطناعي غير مهيأ على الخادم.",
  },
  {
    match: "MISSING_AI_PROVIDER_KEY",
    describe:
      "توقّف الرد الآلي لأن مفتاح مزوّد الذكاء الاصطناعي غير مهيأ على الخادم.",
  },
  {
    match: "AI_MODEL_NAME_INVALID",
    describe:
      "توقّف الرد الآلي لأن موديل الذكاء الاصطناعي المحدد غير متاح على الخادم.",
  },
  {
    match: "META_PERMISSION_REQUIRED",
    describe:
      "توقّف الرد الآلي لأن صلاحيات الحساب المرتبط لا تسمح بالرد. أعد ربط Meta ومنح الصلاحية المطلوبة.",
  },
  {
    match: "META_TOKEN_EXPIRED",
    describe:
      "توقّف الرد الآلي لأن صلاحية ربط Meta انتهت. أعد ربط الحساب.",
  },
  {
    match: "WINDOW_EXPIRED",
    describe:
      "توقّف الرد الآلي لأن مهلة الرد المسموح بها (24 ساعة) انتهت. يمكنك الرد يدويًا.",
  },
  {
    match: "AUTOMATION_DISABLED",
    describe:
      "لم يُرسل رد آلي لأن الردود الآلية متوقفة لهذه القناة أو لهذا النوع.",
  },
  {
    match: "META_AUTO_REPLY_INVALID_RESPONSE",
    describe:
      "تعذّر توليد رد مناسب لهذه الرسالة. أعد المحاولة أو اكتب ردًا يدويًا.",
  },
  {
    match: "EMPTY_RESPONSE",
    describe:
      "تعذّر توليد رد مناسب لهذه الرسالة. أعد المحاولة أو اكتب ردًا يدويًا.",
  },
  {
    match: "WORKER_RETRY_LIMIT_REACHED",
    describe:
      "توقّف الرد الآلي بعد عدة محاولات فاشلة. أعد المحاولة أو اكتب ردًا يدويًا.",
  },
  {
    match: "WORKER_INTERRUPTED_DURING_SEND",
    describe:
      "انقطع الاتصال أثناء المحاولة السابقة. تحقق من المحادثة قبل إعادة المحاولة.",
  },
  {
    match: "SUPERSEDED_BY_NEWER_MESSAGE",
    describe:
      "لم يُرسل رد آلي لهذه الرسالة لأن رسالة أحدث في المحادثة ستحصل على الرد بدلًا منها.",
  },
  {
    match: "AUTO_REPLY_LOOP_GUARD",
    describe:
      "أوقف النظام الرد الآلي مؤقتًا لأن المحادثة استهلكت الحد المسموح من الردود في ساعة واحدة.",
  },
];

export function describeMetaAutoReplyFailure(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const reason = metaAutoReplyFailureReasons.find((entry) =>
    normalized.includes(entry.match),
  );
  return reason?.describe ?? null;
}

/**
 * Limits that lift without the merchant doing anything to this message: the
 * quota returns at the next period, and a missing provider key or unreadable
 * subscription row is fixed on the server. A job blocked by one of these stays
 * queued now instead of ending, so the inbox must say "waiting" and not
 * "failed" — and must not imply the merchant has to press retry.
 */
const postponedQuotaCodes = ["SUBSCRIPTION_LIMIT_REACHED"];

const postponedConfigurationCodes = [
  "WORKSPACE_SUBSCRIPTION_MISSING",
  "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
  "MISSING_OPENAI_KEY",
  "MISSING_GEMINI_KEY",
  "MISSING_AI_PROVIDER_KEY",
  "AI_MODEL_NAME_INVALID",
];

/** Class names stored before the server recorded stable codes. */
const postponedLegacyNames = ["SubscriptionAiQuotaError"];

function matchesCode(
  code: string,
  candidates: readonly string[],
): boolean {
  if (!code) return false;
  return candidates.some((candidate) => code.includes(candidate));
}

/** True when the reply is waiting on a limit rather than broken. */
export function isMetaAutoReplyPostponedCode(
  code: string | null | undefined,
): boolean {
  return describeMetaAutoReplyPostponed(code) !== null;
}

/**
 * The sentence for a reply that is waiting on a limit, or null when the code is
 * not one of those. Mirrors the WhatsApp wording so the same situation reads the
 * same on both platforms.
 */
export function describeMetaAutoReplyPostponed(
  code: string | null | undefined,
): string | null {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  if (
    matchesCode(normalized, postponedQuotaCodes) ||
    matchesCode(code?.trim() ?? "", postponedLegacyNames)
  ) {
    return "تأجّل الرد الآلي لأن حصة الذكاء الاصطناعي في خطتك انتهت. يُستأنف تلقائيًا عند تجديد الحصة أو فور ترقية خطتك، ويمكنك الرد يدويًا الآن.";
  }
  if (matchesCode(normalized, postponedConfigurationCodes)) {
    return "تأجّل الرد الآلي لأن إعداد الذكاء الاصطناعي على الخادم غير مكتمل. يُستأنف تلقائيًا بمجرد اكتمال الإعداد، ويمكنك الرد يدويًا الآن.";
  }
  return null;
}

/** Mirrors the server: only paused or failed attempts may be requeued. */
export function canRetryMetaAutoReply(
  status: string | null | undefined,
): boolean {
  return status === "failed" || status === "skipped";
}
