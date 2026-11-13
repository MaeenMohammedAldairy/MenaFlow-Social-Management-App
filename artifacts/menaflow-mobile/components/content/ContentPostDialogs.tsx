import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { showAppNotice } from "@/components/AppFeedback";
import { Image } from "expo-image";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { confirmDiscardChanges } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import type { Channel, Post } from "@/context/StudioContext";
import {
  mediaPreviewUrl,
  platformLabel,
  publishReasonLabel,
  postMediaType,
} from "@/lib/content-utils";
import { styles } from "./content-styles";

type MetaChannel = Extract<Channel, "facebook" | "instagram">;
type PublishOutcome = "success" | "partial" | "uncertain" | "failed";
type PublishChannelResult = {
  channel: MetaChannel;
  status: string;
  url?: string | null;
  reason?: string;
};
type ContentPostDialogsProps = {
  posts: Post[];
  mediaPreviewUrls: Record<string, string>;
  editingPostId: string | null;
  setEditingPostId: Dispatch<SetStateAction<string | null>>;
  editingBody: string;
  setEditingBody: Dispatch<SetStateAction<string>>;
  editingMediaUrls: string[];
  setEditingMediaUrls: Dispatch<SetStateAction<string[]>>;
  updatePost: (
    id: string,
    patch: Partial<Omit<Post, "id" | "createdAt">>,
  ) => Promise<void>;
  publishDialogPostId: string | null;
  setPublishDialogPostId: Dispatch<SetStateAction<string | null>>;
  publishMessage: string | null;
  setPublishMessage: Dispatch<SetStateAction<string | null>>;
  publishOutcome: PublishOutcome | null;
  setPublishOutcome: Dispatch<SetStateAction<PublishOutcome | null>>;
  publishChannelResults: PublishChannelResult[];
  setPublishChannelResults: Dispatch<SetStateAction<PublishChannelResult[]>>;
  onRetryFailedChannel: (channel: MetaChannel) => void;
  selectedPublishChannels: MetaChannel[];
  setSelectedPublishChannels: Dispatch<SetStateAction<MetaChannel[]>>;
  onTogglePublishChannel: (channel: MetaChannel) => void;
  connectedChannels: MetaChannel[];
  connectionsLoaded: boolean;
  publishing: boolean;
  publishAndShowResult: (
    postId: string,
    channels: MetaChannel[],
    retryUncertain?: boolean,
  ) => Promise<void>;
  retryChannels: MetaChannel[];
  setRetryChannels: Dispatch<SetStateAction<MetaChannel[]>>;
  retryConfirmationVisible: boolean;
  setRetryConfirmationVisible: Dispatch<SetStateAction<boolean>>;
};

export function ContentPostDialogs({
  posts,
  mediaPreviewUrls,
  editingPostId,
  setEditingPostId,
  editingBody,
  setEditingBody,
  editingMediaUrls,
  setEditingMediaUrls,
  updatePost,
  publishDialogPostId,
  setPublishDialogPostId,
  publishMessage,
  setPublishMessage,
  publishOutcome,
  setPublishOutcome,
  publishChannelResults,
  setPublishChannelResults,
  onRetryFailedChannel,
  selectedPublishChannels,
  setSelectedPublishChannels,
  onTogglePublishChannel,
  connectedChannels,
  connectionsLoaded,
  publishing,
  publishAndShowResult,
  retryChannels,
  setRetryChannels,
  retryConfirmationVisible,
  setRetryConfirmationVisible,
}: ContentPostDialogsProps) {
  const colors = useColors();
  const publishDialogPost = posts.find((post) => post.id === publishDialogPostId);
  const alreadyPublishedChannels = new Set(
    publishDialogPost?.channels.filter((channel) => {
      const result = publishDialogPost.publishResults?.[channel];
      return (
        result !== null &&
        typeof result === "object" &&
        "status" in result &&
        result.status === "published"
      );
    }) ?? [],
  );
  const selectablePublishChannels = connectedChannels.filter(
    (channel) => !alreadyPublishedChannels.has(channel),
  );
  const [saving, setSaving] = useState(false);
  const editingBaseline = useRef<{
    postId: string;
    body: string;
    mediaUrls: string[];
  } | null>(null);
  useEffect(() => {
    editingBaseline.current = editingPostId
      ? {
          postId: editingPostId,
          body: editingBody,
          mediaUrls: editingMediaUrls,
        }
      : null;
  }, [editingPostId]);
  const requestEditClose = () => {
    if (saving) return;
    const baseline = editingBaseline.current;
    const hasChanges =
      baseline?.postId === editingPostId &&
      (baseline.body !== editingBody ||
        JSON.stringify(baseline.mediaUrls) !== JSON.stringify(editingMediaUrls));
    if (!hasChanges) {
      setEditingPostId(null);
      return;
    }
    confirmDiscardChanges(
      () => setEditingPostId(null),
      "تعديلات المنشور لم تُحفظ. هل تريد تجاهلها؟",
    );
  };
  const hasPublishResult = Boolean(
    publishMessage || publishChannelResults.length > 0,
  );
  const outcomePresentation = publishOutcome
    ? {
        success: {
          icon: "check-circle" as const,
          title: "تم النشر بنجاح",
          color: colors.green,
        },
        partial: {
          icon: "alert-circle" as const,
          title: "تم النشر على بعض المنصات فقط",
          color: colors.primary,
        },
        uncertain: {
          icon: "alert-circle" as const,
          title: "نتيجة النشر غير مؤكدة",
          color: colors.primary,
        },
        failed: {
          icon: "x-circle" as const,
          title: "تعذر النشر",
          color: colors.destructive,
        },
      }[publishOutcome]
    : null;
  const publishStatusLabel = (status: string) =>
    status === "published"
      ? "تم النشر"
      : status === "unknown"
        ? "غير مؤكدة"
        : status === "publishing"
          ? "قيد الإرسال"
          : "فشل";
  const publishStatusColor = (status: string) =>
    status === "published"
      ? colors.green
      : status === "unknown" || status === "publishing"
        ? colors.primary
        : colors.destructive;
  return (
    <>
      <Modal
        visible={editingPostId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          requestEditClose();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.editModal,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.postTitle, { color: colors.foreground }]}>
              تعديل نص المنشور
            </Text>
            <TextInput
              value={editingBody}
              onChangeText={setEditingBody}
              multiline
              textAlign="right"
              style={[
                styles.editInput,
                { color: colors.foreground, borderColor: colors.border },
              ]}
            />
            {editingMediaUrls.length > 0 ? (
              <>
                <Text
                  style={[styles.mediaLabel, { color: colors.mutedForeground }]}
                >
                  ترتيب الوسائط وحذفها
                </Text>
                <ScrollView
                  style={styles.editMediaScroll}
                  contentContainerStyle={styles.editMediaList}
                >
                  {editingMediaUrls.map((mediaUrl, index) => {
                    const editingPost = posts.find(
                      (post) => post.id === editingPostId,
                    );
                    const mediaType = editingPost
                      ? postMediaType(editingPost, mediaUrl)
                      : "image";
                    return (
                      <View
                        key={`${mediaUrl}-${index}`}
                        style={[
                          styles.editMediaItem,
                          { borderColor: colors.border },
                        ]}
                      >
                        {mediaType === "image" ? (
                          <Image
                            source={{
                              uri: mediaPreviewUrl(
                                mediaUrl,
                                editingPost?.mediaPreviewUrls?.[index],
                                mediaPreviewUrls,
                              ),
                            }}
                            style={styles.editMediaThumbnail}
                            contentFit="cover"
                            cachePolicy="disk"
                            priority="low"
                          />
                        ) : (
                          <View
                            style={[
                              styles.editMediaThumbnail,
                              styles.editMediaPlaceholder,
                              { backgroundColor: colors.accent },
                            ]}
                          >
                            <Text
                              style={[
                                styles.mediaVideoLabel,
                                { color: colors.primary },
                              ]}
                            >
                              {mediaType === "video" ? "فيديو" : "مستند"}
                            </Text>
                          </View>
                        )}
                        <Text
                          style={[
                            styles.editMediaOrder,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {index + 1}
                        </Text>
                        <View style={styles.editMediaActions}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="تحريك الوسيط للأعلى"
                            disabled={index === 0}
                            onPress={() =>
                              setEditingMediaUrls((current) => {
                                const reordered = [...current];
                                [reordered[index - 1], reordered[index]] = [
                                  reordered[index],
                                  reordered[index - 1],
                                ];
                                return reordered;
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.editMediaAction,
                                {
                                  color:
                                    index === 0
                                      ? colors.mutedForeground
                                      : colors.primary,
                                },
                              ]}
                            >
                              ↑
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="تحريك الوسيط للأسفل"
                            disabled={index === editingMediaUrls.length - 1}
                            onPress={() =>
                              setEditingMediaUrls((current) => {
                                const reordered = [...current];
                                [reordered[index], reordered[index + 1]] = [
                                  reordered[index + 1],
                                  reordered[index],
                                ];
                                return reordered;
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.editMediaAction,
                                {
                                  color:
                                    index === editingMediaUrls.length - 1
                                      ? colors.mutedForeground
                                      : colors.primary,
                                },
                              ]}
                            >
                              ↓
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="حذف الوسيط من المنشور"
                            onPress={() =>
                              setEditingMediaUrls((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            <Text
                              style={[
                                styles.editMediaAction,
                                { color: colors.destructive },
                              ]}
                            >
                              حذف
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                disabled={saving}
                onPress={requestEditClose}
              >
                <Text
                  style={[
                    styles.reviewAction,
                    { color: colors.mutedForeground },
                  ]}
                >
                  إلغاء
                </Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={async () => {
                  const body = editingBody.trim();
                  const editingPost = posts.find(
                    (post) => post.id === editingPostId,
                  );
                  if (!editingPostId) return;
                  if (
                    !body &&
                    !editingPost?.title.trim() &&
                    editingMediaUrls.length === 0
                  ) {
                    showAppNotice({ title: "المنشور فارغ", message: "أضف نصاً أو وسيطاً قبل حفظ التعديل.", tone: "error" });
                    return;
                  }
                  setSaving(true);
                  try {
                    await updatePost(editingPostId, {
                      body,
                      mediaUrls: editingMediaUrls,
                      status:
                        editingPost?.status === "approved" ||
                        editingPost?.status === "failed"
                          ? "review"
                          : editingPost?.status ?? "review",
                    });
                    setEditingPostId(null);
                  } catch (error) {
                    showAppNotice({
                      title: "تعذر حفظ التعديل",
                      message:
                        error instanceof Error
                          ? error.message
                          : "تحقق من اتصال الخادم ثم أعد المحاولة.",
                      tone: "error",
                    });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Text style={[styles.reviewAction, { color: colors.primary }]}>
                  {saving ? "جارٍ الحفظ…" : "حفظ التعديل"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={publishDialogPostId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!publishing) {
            setPublishDialogPostId(null);
            setPublishMessage(null);
            setPublishOutcome(null);
            setPublishChannelResults([]);
            setSelectedPublishChannels([]);
            setRetryChannels([]);
            setRetryConfirmationVisible(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.editModal,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.postTitle, { color: colors.foreground }]}>
              {hasPublishResult ? "نتيجة النشر" : "النشر اليدوي"}
            </Text>
            {hasPublishResult ? (
              <>
                {outcomePresentation ? (
                  <View
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.publishOutcome,
                      {
                        borderColor: outcomePresentation.color,
                        backgroundColor: colors.accent,
                      },
                    ]}
                  >
                    <Icon
                      name={outcomePresentation.icon}
                      size={20}
                      color={outcomePresentation.color}
                    />
                    <Text
                      style={[
                        styles.reviewAction,
                        { color: outcomePresentation.color },
                      ]}
                    >
                      {outcomePresentation.title}
                    </Text>
                  </View>
                ) : null}
                {publishMessage ? (
                  <Text
                    accessibilityRole="alert"
                    selectable
                    style={[styles.publishMessage, { color: colors.foreground }]}
                  >
                    {publishMessage}
                  </Text>
                ) : (
                  <View style={styles.publishChannelResults}>
                    {publishChannelResults.map((result) => (
                      <View
                        key={result.channel}
                        style={[
                          styles.publishChannelResult,
                          { borderColor: colors.border },
                        ]}
                      >
                        <SocialPlatformIcon platform={result.channel} size={22} />
                        <View style={styles.publishChannelResultContent}>
                          <View style={styles.publishChannelResultHeader}>
                            <Text
                              style={[
                                styles.reviewAction,
                                { color: colors.foreground },
                              ]}
                            >
                              {platformLabel(result.channel)}
                            </Text>
                            <Text
                              style={[
                                styles.publishChannelStatus,
                                { color: publishStatusColor(result.status) },
                              ]}
                            >
                              {publishStatusLabel(result.status)}
                            </Text>
                          </View>
                          {result.reason ? (
                            <Text
                              style={[
                                styles.publishMessage,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              {publishReasonLabel(result.reason) ??
                                "تعذّر النشر على هذه المنصة. راجع إعدادات الحساب ثم أعد المحاولة."}
                            </Text>
                          ) : null}
                          {result.status === "failed" ? (
                            <View style={styles.publishLinkRow}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`إعادة محاولة النشر على ${platformLabel(result.channel)}`}
                                disabled={publishing}
                                accessibilityState={{ busy: publishing, disabled: publishing }}
                                onPress={() => onRetryFailedChannel(result.channel)}
                                style={styles.publishLinkButton}
                              >
                                <Icon name="refresh-cw" size={15} color={colors.primary} />
                                <Text
                                  style={[
                                    styles.reviewAction,
                                    { color: colors.primary },
                                  ]}
                                >
                                  إعادة المحاولة
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text
                  style={[
                    styles.publishMessage,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {connectionsLoaded
                    ? "حدد منصة واحدة أو أكثر. لن يبدأ النشر حتى تضغط زر النشر."
                    : "جارٍ التحقق من المنصات المرتبطة…"}
                </Text>
                <View style={styles.publishOptions}>
                  {selectablePublishChannels.map((channel) => {
                    const selected = selectedPublishChannels.includes(channel);
                    return (
                      <Pressable
                        key={channel}
                        accessibilityRole="button"
                        accessibilityLabel={platformLabel(channel)}
                        accessibilityState={{ selected, disabled: publishing || !connectionsLoaded }}
                        disabled={publishing || !connectionsLoaded}
                        onPress={() => onTogglePublishChannel(channel)}
                        style={[
                          styles.publishOption,
                          {
                            backgroundColor: selected ? colors.accent : colors.background,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <SocialPlatformIcon platform={channel} size={22} />
                        <Text
                          style={[
                            styles.reviewAction,
                            { color: colors.foreground },
                          ]}
                        >
                          {platformLabel(channel)}
                        </Text>
                        {selected ? (
                          <Icon name="check-circle" size={17} color={colors.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {connectionsLoaded && selectablePublishChannels.length === 0 ? (
                    <Text
                      style={[
                        styles.publishMessage,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {alreadyPublishedChannels.size > 0
                        ? "سبق نشر المنشور على القنوات الناجحة. لا توجد قنوات أخرى متاحة لإعادة النشر."
                        : "لا توجد منصة Meta مرتبطة. اربط فيسبوك أو إنستغرام أولاً."}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    publishing ||
                    !connectionsLoaded ||
                    selectedPublishChannels.length === 0
                  }
                  accessibilityState={{
                    disabled:
                      publishing ||
                      !connectionsLoaded ||
                      selectedPublishChannels.length === 0,
                    busy: publishing,
                  }}
                  onPress={() =>
                    publishDialogPostId &&
                    selectedPublishChannels.length > 0 &&
                    void publishAndShowResult(
                      publishDialogPostId,
                      selectedPublishChannels,
                    )
                  }
                  style={[
                    styles.publishNowButton,
                    {
                      backgroundColor:
                        selectedPublishChannels.length > 0
                          ? colors.primary
                          : colors.secondary,
                      opacity: publishing || selectedPublishChannels.length === 0
                        ? 0.6
                        : 1,
                    },
                  ]}
                >
                  {publishing ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Icon
                      name="send"
                      size={16}
                      color={
                        selectedPublishChannels.length > 0
                          ? colors.primaryForeground
                          : colors.mutedForeground
                      }
                    />
                  )}
                  <Text
                    style={[
                      styles.reviewAction,
                      {
                        color:
                          selectedPublishChannels.length > 0
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {publishing
                      ? "جارٍ النشر والتحقق…"
                      : selectedPublishChannels.length > 0
                        ? `نشر على ${selectedPublishChannels.map(platformLabel).join(" و")}`
                        : "اختر منصة للنشر"}
                  </Text>
                </Pressable>
              </>
            )}
            {retryChannels.length > 0 && !publishing ? (
              retryConfirmationVisible ? (
                <View
                  style={[
                    styles.retryConfirmation,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Text
                    style={[
                      styles.publishMessage,
                      { color: colors.foreground },
                    ]}
                  >
                    تحقّق أولاً من أن المنشور غير موجود على الصفحة. قد تظهر نسخة
                    مكررة إذا كانت المحاولة السابقة قد نجحت.
                  </Text>
                  <View style={styles.modalActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setRetryConfirmationVisible(false)}
                    >
                      <Text
                        style={[
                          styles.reviewAction,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        إلغاء
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setRetryConfirmationVisible(false);
                        if (publishDialogPostId) {
                          void publishAndShowResult(
                            publishDialogPostId,
                            retryChannels,
                            true,
                          );
                        }
                      }}
                    >
                      <Text
                        style={[styles.reviewAction, { color: colors.primary }]}
                      >
                        تأكيد وإعادة المحاولة
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetryConfirmationVisible(true)}
                >
                  <Text
                    style={[styles.reviewAction, { color: colors.primary }]}
                  >
                    لم يظهر على الصفحة؟ أعد المحاولة
                  </Text>
                </Pressable>
              )
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={publishing}
                onPress={() => {
                  setPublishDialogPostId(null);
                  setPublishMessage(null);
                  setPublishOutcome(null);
                  setPublishChannelResults([]);
                  setSelectedPublishChannels([]);
                  setRetryChannels([]);
                  setRetryConfirmationVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.reviewAction,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {hasPublishResult ? "إغلاق" : "إلغاء"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
