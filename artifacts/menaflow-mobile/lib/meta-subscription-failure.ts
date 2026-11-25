/**
 * Arabic copy for a recorded Meta webhook subscription failure.
 *
 * `mena_meta_webhook_subscriptions.last_error_code` holds a short machine code
 * written by the subscription worker (`token_expired`, `graph_190`, …). Shown
 * raw it tells the merchant nothing; each code maps to the action that actually
 * restores delivery, and a Graph code keeps its number because Meta support
 * asks for it.
 */

const SUBSCRIPTION_FAILURE_MESSAGES: Record<string, string> = {
  token_expired:
    "انتهت صلاحية رمز الوصول لحساب ميتا. أعد ربط الحساب من شاشة المصادر لاستقبال التفاعلات.",
  token_invalid:
    "رمز الوصول لحساب ميتا غير مقبول. أعد ربط الحساب من شاشة المصادر.",
  token_unavailable:
    "لا يوجد رمز وصول محفوظ لهذا الحساب. أعد ربط حساب ميتا من شاشة المصادر.",
  permissions_missing:
    "الحساب لا يمنح الصلاحيات المطلوبة لاستقبال التفاعلات. أعد الربط ووافق على الصلاحيات الظاهرة في نافذة ميتا.",
  webhook_not_configured:
    "ويب هوك ميتا غير مهيأ على الخادم (MENA_META_WEBHOOK_VERIFY_TOKEN). تواصل مع الدعم لإكمال الإعداد.",
  network_error:
    "تعذّر الوصول إلى خوادم ميتا أثناء تفعيل الاشتراك. أعد المحاولة بعد قليل.",
  subscription_failed:
    "رفضت ميتا تفعيل اشتراك التفاعلات. أعد المحاولة، وإن تكرر الخطأ فأعد ربط الحساب.",
};

/**
 * Explains a subscription failure code, or returns null when there is none.
 * Graph refusals (`graph_<code>`) are described generically with the number
 * preserved, since the number is what Meta's own error table is keyed by.
 */
export function describeMetaSubscriptionFailure(
  code: string | null | undefined,
): string | null {
  const normalized = code?.trim();
  if (!normalized) return null;
  const key = normalized.toLowerCase();
  const known = SUBSCRIPTION_FAILURE_MESSAGES[key];
  if (known) return known;
  if (key.startsWith("graph_")) {
    const detail = normalized.slice("graph_".length);
    return `رفضت ميتا الاشتراك بالرمز ${detail}. تحقق من صلاحيات الحساب أو أعد ربطه، وراجع جدول أخطاء ميتا لهذا الرمز.`;
  }
  return `تعذّر تفعيل اشتراك التفاعلات (${normalized}). أعد المحاولة، وإذا تكرر الخطأ فتواصل مع الدعم.`;
}
