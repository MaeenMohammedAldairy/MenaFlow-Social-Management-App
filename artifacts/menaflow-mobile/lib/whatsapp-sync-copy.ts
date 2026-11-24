/**
 * Arabic copy for the WhatsApp sync panel.
 *
 * The server records machine codes in `mena_whatsapp_sync_states.last_error`
 * and `status`. Shown verbatim they are noise to a merchant («
 * EVOLUTION_HISTORY_GROUP_MISMATCH » says nothing about what to do), so every
 * code the sync path can produce is translated here, and an unknown one falls
 * back to wording that still tells the merchant the next step — with the code
 * kept in brackets, because that is what support needs to see it.
 */

const SYNC_STATUS_LABELS: Record<string, string> = {
  idle: "لم تبدأ",
  running: "جارٍ الاستيراد",
  complete: "اكتملت المزامنة",
  partial: "اكتملت جزئيًا",
  failed: "فشلت المزامنة",
  cancelled: "أُلغيت المزامنة",
  empty: "لا توجد رسائل محفوظة",
};

const SYNC_FAILURE_MESSAGES: Record<string, string> = {
  // Provider configuration — nothing the merchant can fix in the app.
  EVOLUTION_API_NOT_CONFIGURED:
    "خدمة ربط واتساب غير مهيأة على الخادم. تواصل مع الدعم لإكمال الإعداد.",
  EVOLUTION_API_URL_INVALID:
    "عنوان خدمة ربط واتساب غير صالح على الخادم. تواصل مع الدعم.",
  EVOLUTION_API_UNREACHABLE:
    "تعذّر الوصول إلى خدمة ربط واتساب. تحقق من اتصال الإنترنت وأعد المزامنة، وإذا تكرر الخطأ فتواصل مع الدعم.",
  EVOLUTION_API_TIMEOUT:
    "استغرقت خدمة ربط واتساب وقتًا أطول من المسموح. أعد المزامنة بعد قليل.",
  EVOLUTION_API_REQUEST_FAILED:
    "رفضت خدمة ربط واتساب طلب المزامنة. أعد المزامنة، وإذا تكرر الخطأ فأعد ربط الحساب.",
  EVOLUTION_API_INVALID_RESPONSE:
    "أرسلت خدمة ربط واتساب استجابة غير متوقعة. أعد المزامنة مرة أخرى.",
  EVOLUTION_API_RESPONSE_TOO_LARGE:
    "سجل المحادثة أكبر من الحد المسموح. قلّل عدد الرسائل المستوردة ثم أعد المزامنة.",
  EVOLUTION_INSTANCE_NOT_FOUND:
    "لم تعد خدمة ربط واتساب تتعرف على هذا الاتصال. أعد ربط حساب واتساب من شاشة المصادر.",

  // History retrieval.
  EVOLUTION_HISTORY_EMPTY:
    "لم يعثر الخادم على رسائل سابقة لهذه المجموعة في سجل واتساب المتاح. تحقّق من توفر سجل المحادثة في خدمة الربط، ثم جرّب المزامنة مرة أخرى.",
  EVOLUTION_HISTORY_GROUP_MISMATCH:
    "لم تصل رسائل تخص هذه المجموعة من خدمة الربط. تأكد من اختيار المجموعة الصحيحة ثم أعد المزامنة.",
  EVOLUTION_HISTORY_INVALID_RESPONSE:
    "أرسلت خدمة الربط سجلًا بصيغة غير متوقعة. أعد المزامنة مرة أخرى.",
  EVOLUTION_HISTORY_PAGINATION_STALLED:
    "توقّف استيراد السجل لأن خدمة الربط أعادت الصفحة نفسها. أعد المزامنة، وإذا تكرر الأمر فتواصل مع الدعم.",
  EVOLUTION_HISTORY_PAGINATION_LIMIT:
    "سجل هذه المجموعة أطول من الحد الأقصى للاستيراد في محاولة واحدة. كرّر المزامنة لمتابعة الاستيراد من حيث توقّف.",
  EVOLUTION_HISTORY_MESSAGES_SKIPPED:
    "وصلت رسائل لهذه المجموعة، لكن تعذّر حفظها كلها. أعد المزامنة، وإذا تكرر الأمر فتواصل مع الدعم.",
  WHATSAPP_HISTORY_RUN_BUDGET_REACHED:
    "استورد الخادم جزءًا من سجل هذه المجموعة لأن المزامنة بلغت أقصى مدة مسموحة. المزامنة التالية تكمل من حيث توقفت، ويمكنك إعادة المزامنة الآن لمتابعة الاستيراد.",

  // Local persistence and identity.
  WHATSAPP_DATABASE_UNAVAILABLE:
    "تعذّر الاتصال بقاعدة البيانات أثناء حفظ الرسائل. انتظر حتى استقرار الاتصال ثم أعد المزامنة.",
  WHATSAPP_MESSAGE_IMPORT_FAILED:
    "تعذّر حفظ بعض الرسائل. أعد المزامنة، وإذا تكرر الخطأ فتواصل مع الدعم.",
  WHATSAPP_MESSAGE_SAVE_FAILED:
    "تعذّر حفظ رسالة في قاعدة البيانات. أعد المزامنة مرة أخرى.",
  WHATSAPP_SYNC_STATE_CREATE_FAILED:
    "تعذّر تسجيل حالة المزامنة لهذه المجموعة. أعد المزامنة من شاشة المصادر.",
  WHATSAPP_SYNC_CURSOR_INVALID:
    "نقطة المتابعة المحفوظة لهذه المجموعة غير صالحة. ابدأ مزامنة جديدة من شاشة المصادر.",
  WHATSAPP_GROUP_IDENTITY_JID_MISSING:
    "توجد اختيارات قديمة بلا هوية مجموعة مؤكدة. شغّل تقرير ترحيل الهوية وراجع السجلات قبل المزامنة.",
  WHATSAPP_CONNECTION_NOT_FOUND:
    "لم يعثر الخادم على اتصال واتساب لهذه المساحة. أعد ربط الحساب من شاشة المصادر.",
  WHATSAPP_NOT_CONNECTED:
    "اتصال واتساب غير نشط الآن. افتح حالة الاتصال وأعد الربط إن لزم.",
  WHATSAPP_SYNC_TYPE_DISABLED:
    "نوع المزامنة المطلوب غير مفعّل على الخادم. تواصل مع الدعم لتفعيله.",
  WHATSAPP_HISTORY_SYNC_FAILED:
    "تعذّر إتمام مزامنة السجل. أعد المحاولة، وإذا تكرر الخطأ فتواصل مع الدعم.",
};

const FALLBACK_STATUS_LABEL = "حالة غير معروفة";

/** Arabic label for a sync state status, never the raw value. */
export function describeWhatsAppSyncStatus(
  status: string | null | undefined,
): string {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return "لم تبدأ";
  return SYNC_STATUS_LABELS[normalized] ?? FALLBACK_STATUS_LABEL;
}

/**
 * Arabic explanation of a recorded sync failure. The raw code is preserved in
 * brackets only when it is not one this app knows, so support still gets it.
 */
export function describeWhatsAppSyncFailure(
  code: string | null | undefined,
): string | null {
  const normalized = code?.trim();
  if (!normalized) return null;
  const known = SYNC_FAILURE_MESSAGES[normalized.toUpperCase()];
  if (known) return known;
  return `تعذّر إتمام المزامنة (${normalized}). أعد المحاولة، وإذا تكرر الخطأ فتواصل مع الدعم.`;
}
