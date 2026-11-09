import type { Post } from "@/context/StudioContext";
import { formatArabicDateTime } from "@/lib/formatting";

export function getActivityPostTitle(post: Post): string {
  const title = post.title.trim();
  if (
    title &&
    !["محتوى يحتاج إلى مراجعة", "محتوى من واتساب", "منشور بدون عنوان"].includes(
      title,
    )
  ) {
    return title;
  }

  return (
    post.body
      .trim()
      .split(/\r?\n/)
      .find(Boolean)
      ?.replace(/^[*#\s]+/, "")
      .slice(0, 72) || "منشور بدون عنوان"
  );
}

export function getActivityPostStatusLabel(post: Post): string {
  switch (post.status) {
    case "review":
      return "بانتظار المراجعة";
    case "draft":
      return "حُفظت كمسودة";
    case "scheduled":
      return "تمت الجدولة";
    case "publishing":
      return "جارٍ النشر";
    case "failed":
      return "تعذّر النشر";
    case "approved":
      return "تم الاعتماد";
    case "published":
      return "تم النشر";
  }
}

export function getActivityPostStatusTone(
  post: Post,
): "green" | "amber" | "blue" | "muted" {
  if (post.status === "published") return "green";
  if (post.status === "failed" || post.status === "review") return "amber";
  if (
    post.status === "scheduled" ||
    post.status === "publishing" ||
    post.status === "approved"
  ) {
    return "blue";
  }
  return "muted";
}

export function getActivityPostMeta(post: Post): string {
  const channels = post.channels.map((channel) =>
    channel === "instagram"
      ? "إنستغرام"
      : channel === "facebook"
        ? "فيسبوك"
        : "واتساب",
  );
  const timestamp = formatArabicDateTime(post.updatedAt ?? post.createdAt);
  const timeLabel = post.updatedAt ? "آخر تحديث" : "تاريخ الإنشاء";

  return [
    channels.join("، ") || "بدون قنوات",
    timestamp ? `${timeLabel}: ${timestamp}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
