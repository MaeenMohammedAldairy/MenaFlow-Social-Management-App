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
    match: "SUBSCRIPTION_LIMIT_REACHED",
    describe:
      "توقّف الرد الآلي لأن حصة الذكاء الاصطناعي في خطتك انتهت. رقِّ الخطة أو انتظر تجديد الحصة الشهرية، ويمكنك الرد يدويًا الآن.",
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

/** Mirrors the server: only paused or failed attempts may be requeued. */
export function canRetryMetaAutoReply(
  status: string | null | undefined,
): boolean {
  return status === "failed" || status === "skipped";
}
