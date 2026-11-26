import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { showAppNotice } from "@/components/AppFeedback";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { MediaPreviewModal } from "@/components/sources/MediaPreviewModal";
import { useColors } from "@/hooks/useColors";
import {
  whatsappDirectAttachmentStatusLabel,
  type WhatsAppDirectMessageAttachment,
} from "@/lib/whatsapp-direct-inbox-api";

function secureUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function attachmentIcon(mediaType: string): "image" | "play" | "file-text" {
  switch (mediaType) {
    case "image":
      return "image";
    case "video":
    case "audio":
      return "play";
    default:
      return "file-text";
  }
}

function attachmentLabel(mediaType: string): string {
  switch (mediaType) {
    case "image":
      return "صورة مرفقة";
    case "video":
      return "فيديو مرفق";
    case "audio":
      return "رسالة صوتية مرفقة";
    case "document":
      return "ملف مرفق";
    case "sticker":
      return "ملصق مرفق";
    case "album":
      return "ألبوم وسائط مرفق";
    default:
      return "مرفق";
  }
}

/**
 * Renders attachments returned by the direct inbox API. Video and audio are
 * opened in the OS player through the short-lived signed URL; images use the
 * same preview modal as the Meta inbox. The caption is rendered by the caller
 * as ordinary message text, separately from this component.
 */
export function WhatsAppDirectMedia({
  attachments,
}: {
  attachments: WhatsAppDirectMessageAttachment[];
}) {
  const colors = useColors();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(
    () => new Set(),
  );

  if (attachments.length === 0) return null;

  const open = (url: string) => {
    void Linking.openURL(url).catch(() =>
      showAppNotice({
        title: "تعذر فتح المرفق",
        message: "حاول فتح الرابط مرة أخرى.",
        tone: "error",
      }),
    );
  };

  return (
    <>
      <View style={styles.mediaList}>
        {attachments.map((attachment) => {
          const key = `${attachment.id}-${attachment.mediaIndex}`;
          const url = secureUrl(attachment.url);
          const thumbnailUrl = secureUrl(attachment.thumbnailUrl);
          const isImage = attachment.mediaType === "image";
          const isVideo = attachment.mediaType === "video";
          const preview = isImage ? url : isVideo ? thumbnailUrl : null;

          if (attachment.downloadStatus !== "stored") {
            return (
              <View
                key={key}
                style={[styles.filePreview, { backgroundColor: colors.accent }]}
              >
                <Icon
                  name={attachmentIcon(attachment.mediaType)}
                  size={18}
                  color={colors.primary}
                />
                <Text style={{ color: colors.foreground }}>
                  {whatsappDirectAttachmentStatusLabel(attachment)}
                </Text>
              </View>
            );
          }

          if (preview && !failedPreviews.has(preview)) {
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={isVideo ? "تشغيل الفيديو" : "عرض الصورة"}
                onPress={() => (isVideo && url ? open(url) : setPreviewUrl(preview))}
                style={styles.previewWrap}
              >
                <Image
                  source={{ uri: preview }}
                  style={styles.preview}
                  contentFit="cover"
                  cachePolicy="disk"
                  onError={() =>
                    setFailedPreviews((current) => new Set(current).add(preview))
                  }
                />
                {isVideo ? (
                  <View
                    style={[
                      styles.videoBadge,
                      { backgroundColor: colors.mediaOverlay },
                    ]}
                  >
                    <Icon
                      name="play"
                      size={20}
                      color={colors.mediaOverlayForeground}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          }

          if (!url) {
            return (
              <View
                key={key}
                style={[styles.filePreview, { backgroundColor: colors.accent }]}
              >
                <Icon
                  name={attachmentIcon(attachment.mediaType)}
                  size={18}
                  color={colors.primary}
                />
                <Text style={{ color: colors.foreground }}>
                  {whatsappDirectAttachmentStatusLabel(attachment)}
                </Text>
              </View>
            );
          }

          return (
            <Pressable
              key={key}
              accessibilityRole="link"
              accessibilityLabel={
                isVideo
                  ? "تشغيل الفيديو"
                  : attachment.mediaType === "audio"
                    ? "تشغيل الرسالة الصوتية"
                    : `فتح ${attachmentLabel(attachment.mediaType)}`
              }
              onPress={() => open(url)}
              style={[styles.filePreview, { backgroundColor: colors.accent }]}
            >
              <Icon
                name={attachmentIcon(attachment.mediaType)}
                size={18}
                color={colors.primary}
              />
              <Text style={{ color: colors.foreground }}>
                {isVideo
                  ? "تشغيل الفيديو"
                  : attachment.mediaType === "audio"
                    ? "تشغيل الرسالة الصوتية"
                    : attachmentLabel(attachment.mediaType)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <MediaPreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  mediaList: { gap: 8, marginTop: 6 },
  previewWrap: {
    width: "100%",
    maxWidth: 420,
    height: 200,
    overflow: "hidden",
    borderRadius: 12,
    alignSelf: "flex-end",
  },
  preview: { width: "100%", height: "100%" },
  videoBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreview: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
