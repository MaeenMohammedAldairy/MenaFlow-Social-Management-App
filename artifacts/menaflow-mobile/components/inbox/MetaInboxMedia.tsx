import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { MediaPreviewModal } from "@/components/sources/MediaPreviewModal";
import { useColors } from "@/hooks/useColors";
import type { MetaInboxMedia as MetaInboxMediaItem } from "@/lib/meta-inbox-api";

function secureUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MetaInboxMedia({ media }: { media: MetaInboxMediaItem[] }) {
  const colors = useColors();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(
    () => new Set(),
  );

  return (
    <>
      <View style={styles.mediaList}>
        {media.map((item, index) => {
          const url = secureUrl(item.url);
          const thumbnailUrl = secureUrl(item.thumbnailUrl);
          const imageUrl = item.type === "image" ? url : thumbnailUrl;
          const isVideo = item.type === "video";

          if (imageUrl && !failedPreviews.has(imageUrl)) {
            return (
              <Pressable
                key={`${item.type}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={
                  isVideo ? "فتح معاينة الفيديو" : "عرض الصورة"
                }
                onPress={() => {
                  if (isVideo && url) {
                    void Linking.openURL(url).catch(() =>
                      Alert.alert(
                        "تعذر فتح الوسائط",
                        "حاول فتح الرابط مرة أخرى.",
                      ),
                    );
                    return;
                  }
                  setPreviewUrl(imageUrl);
                }}
                style={styles.previewWrap}
              >
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.preview}
                  contentFit="cover"
                  cachePolicy="disk"
                  onError={() =>
                    setFailedPreviews((current) =>
                      new Set(current).add(imageUrl),
                    )
                  }
                />
                {isVideo ? (
                  <View style={styles.videoBadge}>
                    <Icon name="play" size={20} color="#FFFFFF" />
                  </View>
                ) : null}
              </Pressable>
            );
          }

          const openUrl = url ?? imageUrl;
          if (!openUrl) {
            return (
              <View
                key={`${item.type}-${index}`}
                style={[styles.filePreview, { backgroundColor: colors.accent }]}
              >
                <Icon name="file-text" size={18} color={colors.primary} />
                <Text style={{ color: colors.foreground }}>
                  {imageUrl
                    ? "تعذر تحميل معاينة الوسائط"
                    : isVideo
                      ? "فيديو مرفق"
                      : "مرفق"}
                </Text>
              </View>
            );
          }

          return (
            <Pressable
              key={`${item.type}-${index}`}
              accessibilityRole="link"
              accessibilityLabel={
                imageUrl
                  ? "فتح الوسائط بعد تعذر تحميل المعاينة"
                  : isVideo
                    ? "فتح الفيديو"
                    : "فتح المرفق"
              }
              onPress={() => {
                void Linking.openURL(openUrl).catch(() =>
                  Alert.alert("تعذر فتح الوسائط", "حاول فتح الرابط مرة أخرى."),
                );
              }}
              style={[styles.filePreview, { backgroundColor: colors.accent }]}
            >
              <Icon
                name={isVideo ? "play" : "file-text"}
                size={18}
                color={colors.primary}
              />
              <Text style={{ color: colors.foreground }}>
                {imageUrl
                  ? "تعذر عرض المعاينة · فتح الوسائط"
                  : isVideo
                    ? "فتح الفيديو"
                    : "فتح المرفق"}
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
  mediaList: { gap: 8 },
  previewWrap: {
    width: "100%",
    maxWidth: 420,
    height: 240,
    overflow: "hidden",
    borderRadius: 12,
    alignSelf: "flex-end",
  },
  preview: { width: "100%", height: "100%" },
  videoBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  filePreview: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
