import type { Channel, Post, PostStatus } from "@/context/StudioContext";

export function statusInfo(status: PostStatus): {
  label: string;
  tone: "amber" | "green" | "muted";
} {
  switch (status) {
    case "draft":
      return { label: "مسودة", tone: "muted" };
    case "review":
      return { label: "جاهز للمراجعة", tone: "amber" };
    case "approved":
      return { label: "معتمد للنشر التلقائي", tone: "green" };
    case "scheduled":
      return { label: "بانتظار النشر", tone: "amber" };
    case "publishing":
      return { label: "قيد الإرسال", tone: "amber" };
    case "published":
      return { label: "تم النشر", tone: "green" };
    case "failed":
      return { label: "فشل النشر", tone: "muted" };
  }
}

export function platformLabel(channel: Channel): string {
  switch (channel) {
    case "instagram":
      return "إنستغرام";
    case "facebook":
      return "فيسبوك";
    default:
      return "واتساب";
  }
}

export function publishReasonLabel(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const normalizedReason = reason.trim().toLowerCase();
  if (
    normalizedReason.includes(
      "only photo or video can be accepted as media type",
    )
  ) {
    return "إنستغرام يقبل الصور والفيديو فقط. احذف الملف غير المدعوم ثم أعد المحاولة.";
  }
  if (reason === "INSTAGRAM_MEDIA_REQUIRED") {
    return "إنستغرام يتطلب صورة أو فيديو واحداً على الأقل.";
  }
  if (reason === "INSTAGRAM_MEDIA_TYPE_UNSUPPORTED") {
    return "نوع أحد الملفات غير مدعوم على إنستغرام. استخدم صورة أو فيديو متوافقاً.";
  }
  if (reason === "INSTAGRAM_IMAGE_JPEG_REQUIRED") {
    return "إنستغرام يتطلب صور JPEG. حوّل الصورة ثم أعد المحاولة.";
  }
  if (reason === "INSTAGRAM_CAROUSEL_REQUIRES_2_TO_10_ITEMS") {
    return "ألبوم إنستغرام يحتاج من صورتين إلى 10 صور أو فيديوهات.";
  }
  if (reason === "INSTAGRAM_MEDIA_PROCESSING_TIMEOUT") {
    return "تأخر إنستغرام في معالجة الوسائط. انتظر قليلاً ثم أعد المحاولة.";
  }
  if (reason === "POST_TEXT_REQUIRED") {
    return "أضف نصاً للمنشور قبل اعتماده أو نشره.";
  }
  if (reason === "POST_MEDIA_REQUIRED") {
    return "أضف وسيطاً واحداً على الأقل قبل اعتماده أو نشره.";
  }
  if (reason === "POST_MEDIA_UNAVAILABLE") {
    return "هناك وسيط غير محفوظ أو غير متاح في مساحة العمل.";
  }
  if (reason === "POST_MEDIA_INCOMPLETE") {
    return "لم يكتمل تحميل وسائط المصدر أو لا يطابق العدد المتوقع.";
  }
  if (reason === "WHATSAPP_ORIGINAL_CONTENT_REQUIRES_REVIEW") {
    return "راجع النص والوسائط قبل اعتماد المنشور للنشر.";
  }
  if (reason.startsWith("META_GRAPH_NETWORK_FAILED:")) {
    const stage = reason.split(":")[1];
    const stageLabel =
      stage === "media_creation"
        ? "إنشاء حاوية الوسائط"
        : stage === "container_status"
          ? "فحص جاهزية الوسائط"
          : stage === "media_publish"
            ? "إرسال المنشور النهائي"
            : "التواصل مع Meta";
    const followUp =
      stage === "media_publish"
        ? "تحقّق من حساب إنستغرام قبل إعادة المحاولة لتجنب نشر نسخة مكررة."
        : "تحقّق من اتصال الخادم بالإنترنت ثم أعد المحاولة.";
    return `انقطع الاتصال بخدمة Meta أثناء ${stageLabel}. ${followUp}`;
  }
  const omittedFacebookMedia = reason.match(
    /^FACEBOOK_UNSUPPORTED_MEDIA_OMITTED:(\d+)$/,
  );
  if (omittedFacebookMedia) {
    return `نُشر ألبوم الصور على فيسبوك، لكن لم تُرفق ${omittedFacebookMedia[1]} وسائط غير مدعومة. يدعم ألبوم فيسبوك صور JPEG أو PNG فقط.`;
  }
  if (reason === "FACEBOOK_NO_SUPPORTED_MEDIA") {
    return "لا توجد وسائط متوافقة للنشر على فيسبوك. استخدم صور JPEG أو PNG أو فيديو MP4 واحدًا.";
  }
  if (reason === "PREVIOUS_RESULT_UNCERTAIN") {
    return "تعذّر التأكد من نتيجة المحاولة السابقة. لم نكرر النشر لتجنب منشور مكرر.";
  }
  if (reason === "FACEBOOK_RESULT_CANNOT_BE_VERIFIED") {
    return "تعذّر التحقق من منشورات صفحة فيسبوك. لم نُعِد النشر لتجنب التكرار؛ تحقق من صلاحيات الصفحة وحاول لاحقاً.";
  }
  if (reason === "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED") {
    return "تعذّر التحقق لأن فيسبوك رفض إذن pages_read_engagement. أعد ربط صفحة فيسبوك ووافق على إذن قراءة تفاعل الصفحة، ثم أعد التحقق. لن تتم إعادة النشر قبل نجاح التحقق.";
  }
  if (reason === "PUBLIC_MEDIA_BASE_URL_REQUIRED") {
    return "يتطلب نشر الوسائط على إنستغرام رابط HTTPS عاماً حتى تتمكن Meta من الوصول إلى الصور والفيديوهات. اضبط MENA_PUBLIC_MEDIA_BASE_URL على عنوان الخادم العام، وليس localhost، ثم أعد النشر.";
  }
  if (reason === "PUBLIC_MEDIA_BASE_URL_INVALID") {
    return "عنوان الخادم العام لإتاحة الوسائط غير صالح. تحقّق من قيمة MENA_PUBLIC_MEDIA_BASE_URL ثم أعد النشر.";
  }
  if (reason === "PUBLIC_MEDIA_URL_MUST_USE_HTTPS") {
    return "يجب أن يستخدم عنوان الخادم العام HTTPS حتى يتمكن إنستغرام من جلب الوسائط. حدّث MENA_PUBLIC_MEDIA_BASE_URL ثم أعد النشر.";
  }
  return reason;
}

export function whatsappMediaIdFromUrl(mediaUrl: string): string | null {
  try {
    const url = new URL(mediaUrl);
    const match = url.pathname.match(
      /\/api\/social\/whatsapp\/public-media\/([^/]+)$/,
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function whatsappMediaExpiryFromUrl(mediaUrl: string): number | null {
  try {
    const value = new URL(mediaUrl).searchParams.get("expires");
    if (!value) return null;
    const expires = Number(value);
    return Number.isSafeInteger(expires) ? expires * 1000 : null;
  } catch {
    return null;
  }
}

export function mediaUrlForApp(mediaUrl: string): string {
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!configuredDomain) return mediaUrl;

  try {
    const mediaUrlObject = new URL(mediaUrl);
    if (
      !/^\/api\/social\/(?:whatsapp|products)\/public-media\/[^/]+$/.test(
        mediaUrlObject.pathname,
      )
    ) {
      return mediaUrl;
    }
    const hasProtocol = /^https?:\/\//i.test(configuredDomain);
    const apiUrl = new URL(
      hasProtocol ? configuredDomain : `https://${configuredDomain}`,
    );
    if (
      !hasProtocol &&
      ["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname)
    ) {
      apiUrl.protocol = "http:";
    }
    mediaUrlObject.host = apiUrl.host;
    mediaUrlObject.protocol = apiUrl.protocol;
    return mediaUrlObject.toString();
  } catch {
    return mediaUrl;
  }
}

export function mediaPreviewUrl(
  mediaUrl: string,
  thumbnailUrl: string | undefined,
  previewUrls: Record<string, string>,
): string {
  const mediaId = whatsappMediaIdFromUrl(mediaUrl);
  const previewUrl = (
    (mediaId ? previewUrls[`${mediaId}:thumbnail`] : undefined) ??
    thumbnailUrl ??
    mediaUrl
  );
  return mediaUrlForApp(previewUrl);
}

export function postMediaType(post: Post, mediaUrl: string): string {
  const mediaId = whatsappMediaIdFromUrl(mediaUrl);
  const sourceMedia = post.metadata?.sourceMedia;
  if (!mediaId || !Array.isArray(sourceMedia)) return "image";
  const metadata = sourceMedia.find(
    (item) =>
      item && typeof item === "object" && "id" in item && item.id === mediaId,
  );
  return metadata &&
    typeof metadata === "object" &&
    "mediaType" in metadata &&
    typeof metadata.mediaType === "string"
    ? metadata.mediaType
    : "image";
}
