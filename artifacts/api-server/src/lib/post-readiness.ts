export type PostReadinessIssue =
  | "POST_TEXT_REQUIRED"
  | "POST_MEDIA_REQUIRED"
  | "POST_MEDIA_UNAVAILABLE"
  | "POST_MEDIA_INCOMPLETE";

export function postReadinessMessage(issue: PostReadinessIssue): string {
  switch (issue) {
    case "POST_TEXT_REQUIRED":
      return "أضف نصاً للمنشور قبل اعتماده أو نشره.";
    case "POST_MEDIA_REQUIRED":
      return "أضف وسيطاً واحداً على الأقل قبل اعتماده أو نشره.";
    case "POST_MEDIA_UNAVAILABLE":
      return "هناك وسيط غير محفوظ أو غير متاح في مساحة العمل.";
    case "POST_MEDIA_INCOMPLETE":
      return "لم يكتمل تحميل وسائط المصدر أو لا يطابق العدد المتوقع.";
  }
}

export function postReadinessIssue(input: {
  title: string;
  body: string;
  sourceType: string;
  mediaUrls: string[];
  availableMediaIds: ReadonlySet<string>;
  sourceMediaComplete?: boolean;
  expectedMediaCount?: number;
  removedSourceMediaIds?: string[];
}): PostReadinessIssue | null {
  const text = input.sourceType === "whatsapp"
    ? input.body.trim()
    : input.body.trim() || input.title.trim();
  if (!text) return "POST_TEXT_REQUIRED";

  if (input.mediaUrls.length === 0) return "POST_MEDIA_REQUIRED";
  if (
    input.sourceType === "whatsapp" &&
    input.mediaUrls.some((mediaUrl) => /^https?:\/\//i.test(mediaUrl))
  ) {
    return "POST_MEDIA_UNAVAILABLE";
  }
  const localMediaIds = input.mediaUrls.filter(
    (mediaUrl) => !/^https?:\/\//i.test(mediaUrl),
  );
  if (localMediaIds.some((mediaId) => !input.availableMediaIds.has(mediaId))) {
    return "POST_MEDIA_UNAVAILABLE";
  }

  if (input.sourceMediaComplete === false) return "POST_MEDIA_INCOMPLETE";
  if (typeof input.expectedMediaCount === "number") {
    const removedMediaIds = new Set(input.removedSourceMediaIds ?? []);
    const remainingExpectedCount = Math.max(
      0,
      input.expectedMediaCount - removedMediaIds.size,
    );
    if (remainingExpectedCount > input.mediaUrls.length) {
      return "POST_MEDIA_INCOMPLETE";
    }
  }
  return null;
}