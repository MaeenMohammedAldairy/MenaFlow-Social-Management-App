import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { EmptyState, StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import type { Post, PostStatus } from "@/context/StudioContext";
import {
  mediaPreviewUrl,
  platformLabel,
  postMediaType,
  publishReasonLabel,
  statusInfo,
} from "@/lib/content-utils";
import { styles } from "./content-styles";

type ContentPostListProps = {
  visiblePosts: Post[];
  groupedPosts: Array<{ key: string; title: string; posts: Post[] }>;
  filter: PostStatus | "all";
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  loadingMorePosts: boolean;
  mediaPreviewUrls: Record<string, string>;
  verifyingPostId: string | null;
  verificationFeedback: Record<string, string>;
  onVerifyFacebookStatus: (postId: string) => void;
  onEdit: (post: Post) => void;
  onPublish: (post: Post) => void;
  onApprove: (post: Post) => Promise<void>;
  updatePostStatus: (postId: string, status: PostStatus) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
};

type MetaChannel = Extract<Post["channels"][number], "facebook" | "instagram">;

function previewChannels(post: Post): MetaChannel[] {
  const configuredChannels = post.channels.filter(
    (channel): channel is MetaChannel =>
      channel === "facebook" || channel === "instagram",
  );
  return configuredChannels.length > 0
    ? configuredChannels
    : ["facebook", "instagram"];
}

function previewText(post: Post, channel: MetaChannel): string {
  if (
    channel === "instagram" &&
    typeof post.metadata?.instagramBody === "string" &&
    post.metadata.instagramBody.trim()
  ) {
    return post.metadata.instagramBody;
  }
  return post.body || post.title || "لا يوجد نص للمنشور";
}

function formatPreviewText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*\*+\s*$/gm, "")
    .replace(/\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function previewTextLines(text: string) {
  return formatPreviewText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.match(/^[•\-]\s*(.+)$/);
      return {
        text: bullet?.[1] ?? line,
        isBullet: Boolean(bullet),
        isHeading: !bullet && /[:：]\s*$/.test(line),
      };
    });
}

function displayPostTitle(post: Post): string {
  const title = post.title.trim();
  if (
    title &&
    !["محتوى يحتاج إلى مراجعة", "محتوى من واتساب", "منشور بدون عنوان"].includes(title)
  ) {
    return title;
  }
  return (
    post.body
      .trim()
      .split(/\r?\n/)
      .find(Boolean)
      ?.replace(/^[*#\s]+/, "")
      .slice(0, 72) ||
    (post.sourceType === "whatsapp" ? "منشور واتساب" : "منشور بدون عنوان")
  );
}

export function ContentPostList({
  visiblePosts,
  groupedPosts,
  filter,
  hasActiveFilters,
  onClearFilters,
  loadingMorePosts,
  mediaPreviewUrls,
  verifyingPostId,
  verificationFeedback,
  onVerifyFacebookStatus,
  onEdit,
  onPublish,
  onApprove,
  updatePostStatus,
  deletePost,
}: ContentPostListProps) {
  const colors = useColors();
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [approvingPostId, setApprovingPostId] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [previewChannel, setPreviewChannel] = useState<MetaChannel>("facebook");
  const activePreviewChannels = previewPost ? previewChannels(previewPost) : [];

  const renderPreviewMedia = () => {
    if (!previewPost?.mediaUrls?.length) return null;
    return (
      <View style={styles.previewMediaSection}>
        <Text style={[styles.mediaLabel, { color: colors.primary }]}>
          الوسائط ({previewPost.mediaUrls.length})
        </Text>
        <View style={styles.previewMediaList}>
          {previewPost.mediaUrls.map((mediaUrl, index) => {
            const mediaType = postMediaType(previewPost, mediaUrl);
            return mediaType === "image" ? (
              <Image
                key={`${mediaUrl}-${index}`}
                source={{
                  uri: mediaPreviewUrl(
                    mediaUrl,
                    previewPost.mediaPreviewUrls?.[index],
                    mediaPreviewUrls,
                  ),
                }}
                style={styles.mediaImage}
                contentFit="cover"
                cachePolicy="disk"
                accessibilityLabel={`وسيط ${index + 1} للمنشور`}
              />
            ) : (
              <View
                key={`${mediaUrl}-${index}`}
                style={[
                  styles.previewMediaPlaceholder,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Icon
                  name={mediaType === "video" ? "play" : "file-text"}
                  size={18}
                  color={colors.primary}
                />
                <Text style={[styles.mediaVideoLabel, { color: colors.primary }]}>
                  {mediaType === "video" ? "فيديو" : "مستند"}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };
  return (
    <>
      {visiblePosts.length === 0 ? (
        <>
          <EmptyState
            icon="file-plus"
            title={
              !hasActiveFilters && filter === "all"
                ? "لا توجد منشورات بعد"
                : hasActiveFilters
                  ? "لا توجد نتائج"
                  : "لا توجد عناصر في هذا القسم"
            }
            body={
              !hasActiveFilters
                ? "أنشئ منشوراً جديداً أو قم بتحويل رسالة واتساب إلى محتوى تسويقي."
                : "لا توجد منشورات تطابق البحث والمرشحات الحالية."
            }
          />
          {hasActiveFilters ? (
            <Pressable
              accessibilityRole="button"
              onPress={onClearFilters}
              style={[styles.clearFiltersButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.reviewAction, { color: colors.primary }]}>
                مسح المرشحات
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        groupedPosts.map((group) => (
          <View key={group.key} style={styles.postGroup}>
            <Text style={[styles.postGroupTitle, { color: colors.foreground }]}>
              {group.title}
            </Text>
            {group.posts.map((post) => {
              const status = statusInfo(post.status);
              const displayTitle = displayPostTitle(post);
              const expanded = expandedPostIds.has(post.id);
              const sourceText = post.sourceText ?? "";
              const canExpand =
                post.body.length > 240 || sourceText.length > 160;
              const reviewReason =
                post.error ||
                (typeof post.metadata?.reviewReason === "string"
                  ? post.metadata.reviewReason
                  : null);
              const facebookResult = post.publishResults?.facebook;
              const facebookStatus =
                facebookResult && typeof facebookResult === "object"
                  ? (facebookResult as Record<string, unknown>).status
                  : null;
              return (
                <View
                  key={post.id}
                  style={[styles.postCard, { borderColor: colors.border }]}
                >
                  <View style={styles.postHeader}>
                    <StatusPill label={status.label} tone={status.tone} />
                    <View style={styles.postTitleWrap}>
                      <Text
                        style={[styles.postTitle, { color: colors.foreground }]}
                        numberOfLines={2}
                      >
                        {displayTitle}
                      </Text>
                      <Text
                        style={[
                          styles.postDate,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {post.sourceMessageDate
                          ? new Date(post.sourceMessageDate).toLocaleDateString(
                              "ar",
                            )
                          : new Date(post.createdAt).toLocaleDateString("ar")}
                      </Text>
                    </View>
                  </View>

                  {post.mediaUrls && post.mediaUrls.length > 0 && (
                    <View style={styles.mediaPreview}>
                      <View style={styles.mediaImages}>
                        {post.mediaUrls.slice(0, 3).map((mediaUrl, index) => {
                          const mediaType = postMediaType(post, mediaUrl);
                          return mediaType === "video" ? (
                            <View
                              key={`${mediaUrl}-${index}`}
                              style={[
                                styles.mediaVideo,
                                { backgroundColor: colors.accent },
                              ]}
                            >
                              <Icon
                                name="play"
                                size={22}
                                color={colors.primary}
                              />
                              <Text
                                style={[
                                  styles.mediaVideoLabel,
                                  { color: colors.primary },
                                ]}
                              >
                                فيديو
                              </Text>
                            </View>
                          ) : mediaType === "image" ? (
                            <Image
                              key={`${mediaUrl}-${index}`}
                              source={{
                                uri: mediaPreviewUrl(
                                  mediaUrl,
                                  post.mediaPreviewUrls?.[index],
                                  mediaPreviewUrls,
                                ),
                              }}
                              style={styles.mediaImage}
                              contentFit="cover"
                              cachePolicy="disk"
                              priority="low"
                                accessibilityLabel={`وسيط ${index + 1} للمنشور`}
                            />
                          ) : (
                            <View
                              key={`${mediaUrl}-${index}`}
                              style={[
                                styles.mediaVideo,
                                { backgroundColor: colors.accent },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.mediaVideoLabel,
                                  { color: colors.primary },
                                ]}
                              >
                                مستند
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                      <Text
                        style={[styles.mediaLabel, { color: colors.primary }]}
                      >
                        {post.mediaUrls.length} وسائط مرتبطة
                      </Text>
                    </View>
                  )}
                  {(!post.mediaUrls || post.mediaUrls.length === 0) ? (
                    <Text style={[styles.missingMedia, { color: colors.mutedForeground }]}>
                      لا توجد وسائط مرفقة
                    </Text>
                  ) : null}

                  <Text
                    style={[styles.postBody, { color: colors.mutedForeground }]}
                    numberOfLines={expanded ? undefined : 4}
                  >
                    {post.body || "لا يوجد نص للمنشور"}
                  </Text>

                  {post.sourceGroupName ? (
                    <Text
                      style={[styles.sourceText, { color: colors.primary }]}
                    >
                      مجموعة واتساب: {post.sourceGroupName}
                    </Text>
                  ) : null}
                  {post.sourceText?.trim() &&
                  post.sourceText.trim() !== post.body.trim() ? (
                    <Text
                      style={[
                        styles.sourceText,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={expanded ? 8 : 2}
                    >
                      {post.sourceType === "whatsapp"
                        ? "مصدر واتساب: "
                        : "المصدر: "}
                      {post.sourceText}
                    </Text>
                  ) : null}
                  {canExpand ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      onPress={() =>
                        setExpandedPostIds((current) => {
                          const next = new Set(current);
                          if (next.has(post.id)) next.delete(post.id);
                          else next.add(post.id);
                          return next;
                        })
                      }
                      style={styles.expandContentButton}
                    >
                      <Text style={[styles.reviewAction, { color: colors.primary }]}>
                        {expanded ? "عرض أقل" : "عرض النص كاملاً"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {reviewReason &&
                  (post.status === "review" || post.status === "failed") ? (
                    <Text
                      accessibilityRole="text"
                      style={[styles.sourceText, { color: colors.mutedForeground }]}
                    >
                      {post.status === "review" ? "سبب المراجعة: " : "سبب الفشل: "}
                      {publishReasonLabel(reviewReason) ?? reviewReason}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setPreviewChannel(previewChannels(post)[0] ?? "facebook");
                      setPreviewPost(post);
                    }}
                  >
                    <Text
                      style={[styles.reviewAction, { color: colors.primary }]}
                    >
                      معاينة المنشور والنتيجة
                    </Text>
                  </Pressable>
                  {facebookStatus === "unknown" ? (
                    <View style={{ gap: 6 }}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={verifyingPostId === post.id}
                        onPress={() => void onVerifyFacebookStatus(post.id)}
                      >
                        <Text
                          style={[
                            styles.reviewAction,
                            { color: colors.primary },
                          ]}
                        >
                          {verifyingPostId === post.id
                            ? "جارٍ التحقق من فيسبوك…"
                            : "تحقق من حالة النشر على فيسبوك"}
                        </Text>
                      </Pressable>
                      {verificationFeedback[post.id] ? (
                        <Text
                          accessibilityRole="text"
                          style={[
                            styles.publishMessage,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {verificationFeedback[post.id]}
                        </Text>
                      ) : null}
                      {facebookResult &&
                      typeof facebookResult === "object" &&
                      typeof (facebookResult as Record<string, unknown>)
                        .reason === "string" ? (
                        <Text
                          accessibilityRole="text"
                          style={[
                            styles.publishMessage,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {publishReasonLabel(
                            (facebookResult as Record<string, unknown>).reason,
                          )}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.postFooter}>
                    {post.channels.length > 0 ? (
                      <View style={styles.postChannels}>
                        {post.channels.map((channel) => (
                          <View
                            key={channel}
                            accessibilityLabel={`منصة ${platformLabel(channel)}`}
                            style={[styles.postChannelBadge, { borderColor: colors.border }]}
                          >
                            <SocialPlatformIcon platform={channel} size={16} />
                            <Text
                              style={[
                                styles.postChannel,
                                {
                                  color:
                                    channel === "facebook"
                                      ? colors.facebook
                                      : channel === "instagram"
                                        ? colors.instagram
                                        : colors.green,
                                },
                              ]}
                            >
                              {platformLabel(channel)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.postActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onEdit(post)}
                      >
                        <Text
                          style={[
                            styles.reviewAction,
                            { color: colors.primary },
                          ]}
                        >
                          تعديل
                        </Text>
                      </Pressable>
                      {post.status !== "published" &&
                        post.status !== "publishing" && (
                          <Pressable
                            accessibilityRole="button"
                            style={[styles.postActionButton, { borderColor: colors.border }]}
                            onPress={() => onPublish(post)}
                          >
                            <Text
                              style={[
                                styles.reviewAction,
                                { color: colors.green },
                              ]}
                            >
                              {post.status === "failed"
                                ? "إعادة محاولة النشر"
                                : post.status === "approved"
                                  ? "نشر الآن"
                                  : post.status === "review"
                                    ? "نشر يدوي"
                                    : "نشر"}
                            </Text>
                          </Pressable>
                        )}
                      {post.status === "review" ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={approvingPostId === post.id}
                          accessibilityLabel={`اعتماد ${post.title || "المنشور"} للنشر التلقائي`}
                          accessibilityState={{ busy: approvingPostId === post.id }}
                          style={[styles.postActionButton, { borderColor: colors.border }]}
                          onPress={async () => {
                            setApprovingPostId(post.id);
                            try {
                              await onApprove(post);
                            } finally {
                              setApprovingPostId(null);
                            }
                          }}
                        >
                          <Text
                            style={[styles.reviewAction, { color: colors.green }]}
                          >
                            {approvingPostId === post.id ? "جارٍ الاعتماد…" : "اعتماد للنشر التلقائي"}
                          </Text>
                        </Pressable>
                      ) : null}
                      {post.status === "draft" ? (
                        <Pressable
                          accessibilityRole="button"
                          style={[styles.postActionButton, { borderColor: colors.border }]}
                          onPress={() =>
                            void updatePostStatus(post.id, "review").catch((error) =>
                              Alert.alert(
                                "تعذر إرسال المنشور للمراجعة",
                                error instanceof Error
                                  ? error.message
                                  : "تعذر تحديث حالة المنشور.",
                              ),
                            )
                          }
                        >
                          <Text
                            style={[styles.reviewAction, { color: colors.primary }]}
                          >
                            إرسال للمراجعة
                          </Text>
                        </Pressable>
                      ) : null}
                      {post.status !== "published" &&
                      post.status !== "publishing" ? (
                        <Pressable
                          accessibilityRole="button"
                          style={[styles.postActionButton, { borderColor: colors.border }]}
                          onPress={() =>
                            void updatePostStatus(post.id, "draft").catch((error) =>
                              Alert.alert(
                                "تعذر حفظ المسودة",
                                error instanceof Error
                                  ? error.message
                                  : "تعذر تحديث حالة المنشور.",
                              ),
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.reviewAction,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            حفظ كمسودة
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="حذف المنشور"
                        style={styles.deleteActionButton}
                        onPress={() =>
                          Alert.alert(
                            "حذف المنشور؟",
                            post.status === "published"
                              ? "سيُحذف سجل المنشور من مساحة العمل والخادم فقط؛ وسيبقى المنشور على المنصة."
                              : "سيُحذف هذا المنشور نهائياً من مساحة العمل والخادم.",
                            [
                              { text: "إلغاء", style: "cancel" },
                              {
                                text: "حذف",
                                style: "destructive",
                                onPress: () =>
                                  void deletePost(post.id).catch((error) =>
                                    Alert.alert(
                                      "تعذر حذف المنشور",
                                      error instanceof Error
                                        ? error.message
                                        : "تعذر حذف المنشور من مساحة العمل.",
                                    ),
                                  ),
                              },
                            ],
                          )
                        }
                      >
                        <Icon
                          name="trash-2"
                          size={16}
                          color={colors.destructive}
                        />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}
      {loadingMorePosts ? (
        <Text
          style={[
            styles.intro,
            { color: colors.mutedForeground, textAlign: "center" },
          ]}
        >
          جارٍ تحميل المزيد…
        </Text>
      ) : null}
      <Modal
        visible={previewPost !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPost(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.previewModal,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            {previewPost ? (
              <>
                <View style={styles.previewHeader}>
                  <View style={styles.previewHeading}>
                    <Text style={[styles.postTitle, { color: colors.foreground }]}>
                      معاينة المنشور
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.previewTitle, { color: colors.mutedForeground }]}
                    >
                      {displayPostTitle(previewPost)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="إغلاق معاينة المنشور"
                    onPress={() => setPreviewPost(null)}
                    style={styles.previewCloseButton}
                  >
                    <Icon name="x" size={19} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <View style={styles.previewStatusRow}>
                  <StatusPill
                    label={statusInfo(previewPost.status).label}
                    tone={statusInfo(previewPost.status).tone}
                  />
                  <Text style={[styles.postDate, { color: colors.mutedForeground }]}>
                    {previewPost.sourceMessageDate
                      ? new Date(previewPost.sourceMessageDate).toLocaleString("ar")
                      : new Date(previewPost.createdAt).toLocaleString("ar")}
                  </Text>
                </View>
                <View style={styles.previewPlatformTabs}>
                  {activePreviewChannels.map((channel) => {
                    const selected = previewChannel === channel;
                    return (
                      <Pressable
                        key={channel}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setPreviewChannel(channel)}
                        style={[
                          styles.previewPlatformTab,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.accent : colors.background,
                          },
                        ]}
                      >
                        <SocialPlatformIcon platform={channel} size={18} />
                        <Text
                          style={[
                            styles.reviewAction,
                            { color: selected ? colors.primary : colors.mutedForeground },
                          ]}
                        >
                          {platformLabel(channel)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <ScrollView
                  style={styles.previewScroll}
                  contentContainerStyle={styles.previewScrollContent}
                >
                  <View
                    style={[
                      styles.previewBodyCard,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    {previewTextLines(previewText(previewPost, previewChannel)).map(
                      ({ text, isBullet, isHeading }, index) => (
                        <View
                          key={`${index}-${text}`}
                          style={[
                            isBullet ? styles.previewBulletRow : styles.previewLine,
                            isHeading && styles.previewSectionHeading,
                          ]}
                        >
                          {isBullet ? (
                            <Text style={[styles.previewBullet, { color: colors.primary }]}>
                              •
                            </Text>
                          ) : null}
                          <Text
                            selectable
                            style={[
                              styles.previewBody,
                              { color: colors.foreground },
                              isHeading && styles.previewHeadingText,
                            ]}
                          >
                            {text}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>
                  {previewPost.mediaUrls?.length ? (
                    <View style={styles.previewMediaSection}>
                      <Text style={[styles.mediaLabel, { color: colors.primary }]}>
                        الوسائط ({previewPost.mediaUrls.length})
                      </Text>
                      <View style={styles.previewMediaList}>
                        {previewPost.mediaUrls.map((mediaUrl, index) => {
                          const mediaType = postMediaType(previewPost, mediaUrl);
                          return mediaType === "image" ? (
                            <Image
                              key={`${mediaUrl}-${index}`}
                              source={{
                                uri: mediaPreviewUrl(
                                  mediaUrl,
                                  previewPost.mediaPreviewUrls?.[index],
                                  mediaPreviewUrls,
                                ),
                              }}
                              style={styles.mediaImage}
                              contentFit="cover"
                              cachePolicy="disk"
                              accessibilityLabel={`وسيط ${index + 1} للمنشور`}
                            />
                          ) : (
                            <View
                              key={`${mediaUrl}-${index}`}
                              style={[
                                styles.previewMediaPlaceholder,
                                { backgroundColor: colors.accent },
                              ]}
                            >
                              <Icon
                                name={mediaType === "video" ? "play" : "file-text"}
                                size={18}
                                color={colors.primary}
                              />
                              <Text style={[styles.mediaVideoLabel, { color: colors.primary }]}>
                                {mediaType === "video" ? "فيديو" : "مستند"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </ScrollView>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPreviewPost(null)}
                  style={styles.previewCloseAction}
                >
                  <Text style={[styles.reviewAction, { color: colors.primary }]}>
                    إغلاق
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}
