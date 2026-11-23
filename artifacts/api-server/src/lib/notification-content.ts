/**
 * Notification wording, deep links and dedupe keys.
 *
 * Pure on purpose: no database, no HTTP, no environment. `lib/db/src/index.ts`
 * throws at import time without a Supabase `DATABASE_URL`, and CI has no
 * database, so anything imported by a test must stay free of that dependency.
 *
 * The strings are Arabic because the whole merchant app is Arabic-first —
 * screens hardcode Arabic with no i18n layer, and the bundle declares `ar` as
 * its only localization.
 */

export const NOTIFICATION_EVENT_TYPES = [
  "customer_message",
  "publish_failure",
  "new_order",
  "quota_exhausted",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/**
 * Android truncates a title around 65 characters and a body around 240, and
 * iOS around 178 for the body. These limits are deliberately tighter so the
 * text survives on a lock screen instead of ending mid-word.
 */
export const MAX_TITLE_LENGTH = 60;
export const MAX_BODY_LENGTH = 140;

/** Expo rejects a message whose payload exceeds 4 KB. */
export const MAX_DATA_JSON_LENGTH = 1024;

export type NotificationDraft =
  | {
      eventType: "customer_message";
      /** Meta person id. Absent for a WhatsApp conversation. */
      conversationId?: string | null;
      /** `facebook` or `instagram`; only meaningful with a conversationId. */
      platform?: string | null;
      customerName?: string | null;
      preview?: string | null;
      at: Date;
    }
  | {
      eventType: "publish_failure";
      productName: string;
      reason?: string | null;
      jobId?: string | null;
      at: Date;
    }
  | {
      eventType: "new_order";
      orderId: string;
      customerName?: string | null;
      /** Pre-formatted for display, including its currency symbol. */
      totalLabel?: string | null;
      at: Date;
    }
  | {
      eventType: "quota_exhausted";
      meter: SubscriptionMeterName;
      used: number;
      limit: number;
      /** Billing period the limit belongs to, e.g. `2026-11`. */
      periodKey: string;
      at: Date;
    };

export type NotificationContent = {
  eventType: NotificationEventType;
  title: string;
  body: string;
  /**
   * Deep link for the mobile app. Expo requires every value in `data` to be a
   * string, so ids and numbers are stringified here rather than at the call
   * site.
   */
  data: Record<string, string>;
  dedupeKey: string;
};

const GENERIC_CUSTOMER = "عميل";

export type SubscriptionMeterName = "aiGenerations" | "postsCreated";

const METER_LABELS: Record<SubscriptionMeterName, string> = {
  aiGenerations: "توليد المحتوى بالذكاء الاصطناعي",
  postsCreated: "إنشاء المنشورات",
};

/**
 * Publication failure reasons are machine codes produced by
 * `product-publishing.ts` and `isProductPublicationActionRequired`.
 *
 * They are translated here rather than shown raw: the app is Arabic-first and
 * `INSTAGRAM_MEDIA_REQUIRED` is not something to put on a merchant's lock
 * screen. An unrecognised reason — including verbatim Meta API errors — falls
 * back to the generic wording instead of leaking a code, and the raw value
 * still reaches `last_error` and the logs for whoever debugs it.
 */
const PUBLISH_FAILURE_REASONS: Record<string, string> = {
  PRODUCT_NOT_AVAILABLE: "المنتج غير متاح أو غير مُعتمد",
  PRODUCT_POST_SOURCE_UNAVAILABLE: "مصدر منشور المنتج غير متاح",
  PRODUCT_POST_CONTENT_REQUIRED: "محتوى المنشور مطلوب",
  PRODUCT_MEDIA_UNAVAILABLE: "وسائط المنتج غير متاحة",
  PRODUCT_EXTERNAL_MEDIA_NOT_SUPPORTED: "الوسائط الخارجية غير مدعومة",
  META_ACCOUNT_NOT_CONNECTED: "حساب التواصل غير متصل",
  INSTAGRAM_MEDIA_REQUIRED: "إنستغرام يتطلب صورة أو فيديو",
  INSTAGRAM_CAROUSEL_REQUIRES_2_TO_10_ITEMS: "الألبوم في إنستغرام يتطلب من 2 إلى 10 عناصر",
  INSTAGRAM_MEDIA_TYPE_UNSUPPORTED: "نوع الوسائط غير مدعوم في إنستغرام",
  INSTAGRAM_IMAGE_JPEG_REQUIRED: "إنستغرام يتطلب صورة بصيغة JPEG",
  INSTAGRAM_VIDEO_MP4_REQUIRED: "إنستغرام يتطلب فيديو بصيغة MP4",
  FACEBOOK_NO_SUPPORTED_MEDIA: "لا توجد وسائط مدعومة لفيسبوك",
  WHATSAPP_POST_MEDIA_UNAVAILABLE: "وسائط منشور واتساب غير متاحة",
  PUBLISH_RESULT_UNCERTAIN: "نتيجة النشر غير مؤكدة، تحقّق من الحساب",
  META_PUBLISH_RESULT_MISSING: "لم تصل نتيجة النشر من المنصة",
  META_PUBLISH_FAILED: "رفضت المنصة إتمام النشر",
  PRODUCT_PUBLISH_FAILED: "تعذّر إتمام النشر",
};

/**
 * Translates a publication failure reason for display, or returns null when the
 * reason is not one this server produced.
 */
export function publishFailureLabel(reason: string | null | undefined): string | null {
  const key = reason?.trim();
  if (!key) return null;
  return PUBLISH_FAILURE_REASONS[key] ?? null;
}

/**
 * Meta auto-reply outcomes that mean **no alert is owed**.
 *
 * These are the codes where telling the merchant "a customer is waiting for
 * your reply" would be false:
 *
 *   ITEM_ALREADY_REPLIED        the answer already went out
 *   MANUAL_REPLY_IN_PROGRESS    a human is typing it right now
 *   OWN_COMMENT                 the merchant's own comment, not a customer's
 *   COMMENT_ACTOR_UNAVAILABLE   nobody identifiable to answer
 *   META_MESSAGE_WINDOW_EXPIRED Meta no longer permits a reply, and the message
 *                               is old; the alert would be unactionable
 *
 * Deliberately a denylist rather than an allowlist: a failure code added later
 * should alert by default, because staying silent about a new way of not
 * answering is the worse error.
 */
const META_OUTCOMES_NEEDING_NO_ALERT = new Set([
  "ITEM_ALREADY_REPLIED",
  "MANUAL_REPLY_IN_PROGRESS",
  "OWN_COMMENT",
  "COMMENT_ACTOR_UNAVAILABLE",
  "META_MESSAGE_WINDOW_EXPIRED",
]);

/**
 * Whether a Meta auto-reply outcome leaves a customer genuinely unanswered.
 *
 * `unknown` is excluded on purpose. It means the send result could not be
 * determined, so the reply may well have arrived; a merchant who opens the app
 * to find the customer already answered stops trusting every later alert.
 */
export function isUnansweredMetaReply(
  status: "sent" | "failed" | "skipped" | "unknown",
  errorCode: string | null,
): boolean {
  if (status === "sent" || status === "unknown") return false;
  const code = errorCode?.trim();
  return code ? !META_OUTCOMES_NEEDING_NO_ALERT.has(code) : true;
}

/**
 * Truncates on a character boundary and strips a trailing partial word, so an
 * Arabic body never ends in the middle of a letter join.
 */
export function truncateText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if ([...trimmed].length <= maxLength) return trimmed;

  const slice = [...trimmed].slice(0, maxLength - 1).join("");
  const lastSpace = slice.lastIndexOf(" ");
  // Only honour the word boundary when it leaves enough of the text to read.
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Collapses the `at` timestamp into a one-hour bucket in UTC, used to throttle
 * repeating alerts.
 *
 * A merchant with a busy inbox would otherwise receive one push per message.
 * Bucketing by hour keeps the first message of each hour and silently drops
 * the rest, which is the difference between an alert and a reason to uninstall.
 */
export function hourBucket(at: Date): string {
  const year = at.getUTCFullYear();
  const month = `${at.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${at.getUTCDate()}`.padStart(2, "0");
  const hour = `${at.getUTCHours()}`.padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}

/**
 * Guards the payload against Expo's 4 KB message limit by dropping optional
 * keys, largest first, until it fits.
 */
function fitData(data: Record<string, string>): Record<string, string> {
  const encoded = JSON.stringify(data);
  if (encoded.length <= MAX_DATA_JSON_LENGTH) return data;

  // `preview` is the only long free-text field; everything else is an id.
  const { preview: _preview, ...rest } = data;
  return JSON.stringify(rest).length <= MAX_DATA_JSON_LENGTH ? rest : { route: data.route ?? "" };
}

export function buildNotificationContent(
  draft: NotificationDraft,
): NotificationContent {
  switch (draft.eventType) {
    case "customer_message": {
      const who = draft.customerName?.trim() || GENERIC_CUSTOMER;
      // A Meta conversation deep-links to the thread; WhatsApp has no
      // per-conversation route yet, so it lands on the WhatsApp inbox.
      const route =
        draft.conversationId && draft.platform
          ? `/inbox/${encodeURIComponent(draft.conversationId)}?platform=${encodeURIComponent(draft.platform)}`
          : "/inbox/whatsapp";

      const data: Record<string, string> = {
        route,
        eventType: draft.eventType,
      };
      if (draft.conversationId) data.conversationId = draft.conversationId;
      if (draft.platform) data.platform = draft.platform;
      if (draft.preview?.trim()) data.preview = draft.preview.trim();

      return {
        eventType: draft.eventType,
        title: truncateText("رسالة عميل بانتظار ردّك", MAX_TITLE_LENGTH),
        body: truncateText(
          draft.preview?.trim() ? `${who}: ${draft.preview.trim()}` : `${who} أرسل لك رسالة.`,
          MAX_BODY_LENGTH,
        ),
        data: fitData(data),
        // One alert per conversation per hour.
        dedupeKey: `${draft.conversationId ?? draft.platform ?? "inbox"}:${hourBucket(draft.at)}`,
      };
    }

    case "publish_failure": {
      const reason = publishFailureLabel(draft.reason);
      return {
        eventType: draft.eventType,
        title: truncateText("فشل نشر منتج", MAX_TITLE_LENGTH),
        body: truncateText(
          reason
            ? `«${draft.productName}» لم يُنشر: ${reason}`
            : `«${draft.productName}» لم يُنشر. افتح المنتجات للمحاولة مجددًا.`,
          MAX_BODY_LENGTH,
        ),
        data: fitData({
          route: "/(tabs)/products",
          eventType: draft.eventType,
          ...(draft.jobId ? { jobId: draft.jobId } : {}),
        }),
        // One alert per job per hour: a job that fails, is retried and fails
        // again should not fire on every attempt.
        dedupeKey: `${draft.jobId ?? draft.productName}:${hourBucket(draft.at)}`,
      };
    }

    case "new_order": {
      const who = draft.customerName?.trim() || GENERIC_CUSTOMER;
      const total = draft.totalLabel?.trim();
      return {
        eventType: draft.eventType,
        title: truncateText("طلب جديد", MAX_TITLE_LENGTH),
        body: truncateText(
          total ? `طلب من ${who} بقيمة ${total}` : `طلب جديد من ${who} بانتظار تأكيدك`,
          MAX_BODY_LENGTH,
        ),
        data: fitData({
          route: "/(tabs)/more/orders",
          eventType: draft.eventType,
          orderId: draft.orderId,
        }),
        // No time bucket: an order id is already unique, and this is what makes
        // a retried enqueue idempotent instead of announcing the order twice.
        dedupeKey: draft.orderId,
      };
    }

    case "quota_exhausted": {
      const meterLabel = METER_LABELS[draft.meter];
      return {
        eventType: draft.eventType,
        title: truncateText("انتهت حصتك", MAX_TITLE_LENGTH),
        body: truncateText(
          `بلغت حدّ ${meterLabel} (${draft.used}/${draft.limit}) لهذه الفترة. رقِّ خطتك للمتابعة.`,
          MAX_BODY_LENGTH,
        ),
        data: fitData({
          route: "/(tabs)/more/settings",
          eventType: draft.eventType,
          meter: draft.meter,
        }),
        // Exactly one alert per meter per billing period. Without the period
        // key every subsequent blocked action would push another notification,
        // which is the fastest way to get the app uninstalled.
        dedupeKey: `${draft.meter}:${draft.periodKey}`,
      };
    }
  }
}
