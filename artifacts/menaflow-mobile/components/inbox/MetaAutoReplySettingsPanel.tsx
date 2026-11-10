import { useEffect, useState } from "react";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CairoText as Text,
  CairoTextInput,
} from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, Panel, SectionTitle } from "@/components/Ui";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { formatArabicDateTime, formatArabicNumber } from "@/lib/formatting";
import { useColors } from "@/hooks/useColors";
import {
  getMetaAutoReplySettings,
  getMetaAutoReplyHistoricalPosts,
  queueMetaAutoReplyHistoricalComments,
  saveMetaAutoReplySettings,
  type MetaAutoReplySettings,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";

const initialSettings: MetaAutoReplySettings = {
  enabled: false,
  facebookMessagesEnabled: false,
  facebookCommentsEnabled: false,
  instagramMessagesEnabled: false,
  instagramCommentsEnabled: false,
  language: "ar",
  tone: "friendly_professional",
  instructions: "",
};

const platforms: Array<{
  key: MetaInboxPlatform;
  label: string;
  messagesKey: "facebookMessagesEnabled" | "instagramMessagesEnabled";
  commentsKey: "facebookCommentsEnabled" | "instagramCommentsEnabled";
}> = [
  {
    key: "facebook",
    label: "فيسبوك",
    messagesKey: "facebookMessagesEnabled",
    commentsKey: "facebookCommentsEnabled",
  },
  {
    key: "instagram",
    label: "إنستغرام",
    messagesKey: "instagramMessagesEnabled",
    commentsKey: "instagramCommentsEnabled",
  },
];

const tones: Array<{
  value: MetaAutoReplySettings["tone"];
  label: string;
}> = [
  { value: "friendly_professional", label: "ودود ومهني" },
  { value: "concise", label: "مختصر" },
  { value: "formal", label: "رسمي" },
];

function readinessMessage(
  readiness: {
    connected: boolean;
    tokenReady: boolean;
    messagesSubscriptionReady: boolean;
    commentsSubscriptionReady: boolean;
    aiConfigured: boolean;
    missingPermissions: string[];
  },
  kind: "message" | "comment",
): string | null {
  if (!readiness.connected) return "اربط حساب المنصة أولًا.";
  if (!readiness.tokenReady) {
    return "تحقق من صلاحيات الحساب أو أعد ربطه من صفحة المصادر.";
  }
  if (
    kind === "message"
      ? !readiness.messagesSubscriptionReady
      : !readiness.commentsSubscriptionReady
  ) {
    return "فعّل اشتراك استقبال التفاعلات لهذا الحساب من صندوق الوارد.";
  }
  if (!readiness.aiConfigured) {
    return "أضف مفتاح OpenAI أو Gemini إلى إعدادات الخادم.";
  }
  const required =
    kind === "message"
      ? readiness.missingPermissions.find((permission) =>
          ["pages_messaging", "instagram_manage_messages"].includes(permission),
        )
      : readiness.missingPermissions.find((permission) =>
          ["pages_manage_engagement", "instagram_manage_comments"].includes(
            permission,
          ),
        );
  if (required) return `الصلاحية ${required} غير ممنوحة للحساب.`;
  return null;
}

export function MetaAutoReplySettingsPanel({
  userId,
}: {
  userId: string | null;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const queryKey = ["meta-auto-reply-settings", userId ?? "local"] as const;
  const query = useQuery({
    queryKey,
    queryFn: getMetaAutoReplySettings,
    retry: false,
  });
  const [settings, setSettings] =
    useState<MetaAutoReplySettings>(initialSettings);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHistoricalModalOpen, setIsHistoricalModalOpen] = useState(false);
  const [isHistoricalConfirmationOpen, setIsHistoricalConfirmationOpen] =
    useState(false);
  const [historicalPlatform, setHistoricalPlatform] =
    useState<MetaInboxPlatform>("facebook");
  const [historicalSelectionMode, setHistoricalSelectionMode] = useState<
    "selected" | "all"
  >("selected");
  const [selectedHistoricalPostIds, setSelectedHistoricalPostIds] = useState<
    Set<string>
  >(new Set());
  const [error, setError] = useState("");
  const [historicalQueueMessage, setHistoricalQueueMessage] = useState("");
  const historicalQueryKey = [
    "meta-auto-reply-historical-comments",
    userId ?? "local",
  ] as const;
  const historicalPosts = useQuery({
    queryKey: historicalQueryKey,
    queryFn: getMetaAutoReplyHistoricalPosts,
    enabled: isHistoricalModalOpen,
    retry: false,
  });
  const connections = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
    enabled: isHistoricalModalOpen,
    retry: false,
  });
  const hasSelectedChannel = platforms.some(
    ({ messagesKey, commentsKey }) =>
      settings[messagesKey] || settings[commentsKey],
  );
  const canSave =
    hasSelectedChannel ||
    Boolean(query.data?.settings.enabled && !settings.enabled);

  useEffect(() => {
    if (query.data) setSettings(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: saveMetaAutoReplySettings,
    onSuccess: async (saved) => {
      setSettings(saved);
      setError("");
      setIsModalOpen(false);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause) => {
      if (query.data) setSettings(query.data.settings);
      setError(
        cause instanceof Error ? cause.message : "تعذر حفظ إعدادات الرد الآلي.",
      );
    },
  });
  const queueHistoricalComments = useMutation({
    mutationFn: queueMetaAutoReplyHistoricalComments,
    onSuccess: async ({ queuedCount, batchCount }) => {
      setIsHistoricalModalOpen(false);
      setIsHistoricalConfirmationOpen(false);
      setSelectedHistoricalPostIds(new Set());
      setHistoricalQueueMessage(
        queuedCount
          ? `تمت إضافة ${formatArabicNumber(queuedCount)} تعليق إلى طابور الرد على ${formatArabicNumber(batchCount)} دفعة (20 تعليقًا كحد أقصى للدفعة). راجع حالة كل تعليق في صندوق الوارد.`
          : "لم تعد هناك تعليقات مؤهلة للرد.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: historicalQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["meta-inbox", userId ?? "local"],
        }),
      ]);
    },
    onError: (cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر جدولة الرد على التعليقات السابقة.",
      );
    },
  });

  const update = (changes: Partial<MetaAutoReplySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...changes };
      next.enabled = platforms.some(
        ({ messagesKey, commentsKey }) =>
          next[messagesKey] || next[commentsKey],
      );
      return next;
    });
    setError("");
  };

  const closeModal = () => {
    if (query.data) setSettings(query.data.settings);
    setError("");
    setIsModalOpen(false);
  };
  const historicalPlatformData =
    historicalPosts.data?.platforms[historicalPlatform];
  const allEligibleHistoricalPosts =
    historicalPlatformData?.posts.filter(
      (post) => post.eligibleCommentCount > 0,
    ) ?? [];
  const selectedHistoricalPosts =
    historicalSelectionMode === "all"
      ? allEligibleHistoricalPosts
      : (historicalPlatformData?.posts.filter((post) =>
          selectedHistoricalPostIds.has(post.id),
        ) ?? []);
  const selectedHistoricalCommentCount = selectedHistoricalPosts.reduce(
    (total, post) => total + post.eligibleCommentCount,
    0,
  );
  const historicalBatchCount = Math.ceil(selectedHistoricalCommentCount / 20);
  const toggleHistoricalPost = (postId: string) => {
    const post = historicalPlatformData?.posts.find(
      (candidate) => candidate.id === postId,
    );
    if (!post) return;
    setSelectedHistoricalPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        const selectedCount = (historicalPlatformData?.posts ?? [])
          .filter((candidate) => next.has(candidate.id))
          .reduce(
            (total, selectedPost) => total + selectedPost.eligibleCommentCount,
            0,
          );
        if (selectedCount + post.eligibleCommentCount > 20) return current;
        next.add(postId);
      }
      return next;
    });
  };
  const selectAvailableHistoricalPosts = () => {
    const next = new Set<string>();
    let remaining = 20;
    for (const post of historicalPlatformData?.posts ?? []) {
      if (
        post.eligibleCommentCount <= 0 ||
        post.eligibleCommentCount > remaining
      ) {
        continue;
      }
      next.add(post.id);
      remaining -= post.eligibleCommentCount;
    }
    setSelectedHistoricalPostIds(next);
  };
  const confirmHistoricalQueue = () => {
    if (
      !historicalPlatformData?.ready ||
      (historicalSelectionMode === "all"
        ? !allEligibleHistoricalPosts.length
        : !selectedHistoricalPostIds.size) ||
      queueHistoricalComments.isPending
    ) {
      return;
    }
    setError("");
    setIsHistoricalConfirmationOpen(true);
  };

  return (
    <>
      <Panel style={styles.panel}>
        <View style={styles.summary}>
          <SectionTitle title="الرد الآلي بالذكاء الاصطناعي" />
          <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
            {query.isPending
              ? "جارٍ تحميل الإعدادات..."
              : settings.enabled
                ? "الرد الآلي مفعّل."
                : "الرد الآلي متوقف."}
          </Text>
          <ActionButton
            label={
              query.isPending ? "جارٍ تحميل الإعدادات..." : "إعداد الرد الآلي"
            }
            icon="settings"
            disabled={query.isPending || save.isPending}
            onPress={() => setIsModalOpen(true)}
          />
          <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
            يمكنك جدولة الرد على التعليقات السابقة المحفوظة في صندوق الوارد ضمن
            نافذة الرد المسموحة.
          </Text>
          <SettingSwitch
            label="الرد على التعليقات السابقة"
            enabled={isHistoricalModalOpen}
            busy={queueHistoricalComments.isPending}
            disabled={query.isPending || query.isError}
            reason="عند التفعيل، اختر المنصة والمنشورات ثم أكد جدولة الردود."
            onChange={(enabled) => {
              if (!enabled) return;
              setError("");
              setHistoricalQueueMessage("");
              setSelectedHistoricalPostIds(new Set());
              setHistoricalSelectionMode("selected");
              setHistoricalPlatform("facebook");
              setIsHistoricalModalOpen(true);
            }}
          />
        </View>
      </Panel>
      {historicalQueueMessage ? (
        <Text
          accessibilityRole="alert"
          style={[styles.body, { color: colors.primary }]}
        >
          {historicalQueueMessage}
        </Text>
      ) : null}

      <Modal
        visible={isHistoricalModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!queueHistoricalComments.isPending) {
            setIsHistoricalModalOpen(false);
            setError("");
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <View style={styles.modalHeading}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  الرد على التعليقات السابقة
                </Text>
                <Text
                  style={[styles.bodySmall, { color: colors.mutedForeground }]}
                >
                  اختر منصة ومنشورات مرتبطة بمنتجات فعالة وموثقة.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق اختيار المنشورات"
                disabled={queueHistoricalComments.isPending}
                onPress={() => {
                  setIsHistoricalModalOpen(false);
                  setError("");
                }}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.background },
                ]}
              >
                <Icon name="x" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={[styles.bodySmall, { color: colors.destructive }]}>
                ستظهر التعليقات المحفوظة مسبقًا في صندوق الوارد فقط، والواقعة
                ضمن نافذة الرد الحالية (24 ساعة). لا يجلب هذا الإجراء تعليقات
                قديمة غير محفوظة.
              </Text>
              <View style={styles.choiceRow}>
                {platforms.map(({ key, label }) => {
                  const data = historicalPosts.data?.platforms[key];
                  const selected = historicalPlatform === key;
                  const accountName =
                    connections.data?.[key]?.accountName ?? "الحساب غير متاح";
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: !data?.ready,
                      }}
                      disabled={
                        !data?.ready || queueHistoricalComments.isPending
                      }
                      onPress={() => {
                        setHistoricalPlatform(key);
                        setSelectedHistoricalPostIds(new Set());
                        setError("");
                      }}
                      style={[
                        styles.platformOption,
                        {
                          backgroundColor: selected
                            ? colors.primary
                            : colors.background,
                          borderColor: colors.border,
                          opacity: data?.ready ? 1 : 0.55,
                        },
                      ]}
                    >
                      <SocialPlatformIcon platform={key} size={22} />
                      <View style={styles.platformChoiceCopy}>
                        <Text
                          style={[
                            styles.platformChoiceLabel,
                            {
                              color: selected
                                ? colors.primaryForeground
                                : colors.foreground,
                            },
                          ]}
                        >
                          {label}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.bodySmall,
                            {
                              color: selected
                                ? colors.primaryForeground
                                : colors.mutedForeground,
                            },
                          ]}
                        >
                          {accountName}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {connections.isError ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.bodySmall, { color: colors.destructive }]}
                  >
                    تعذر تحميل اسم الحساب المتصل.
                  </Text>
                ) : null}
              </View>
              <View style={styles.choiceRow}>
                {(
                  [
                    ["selected", "منشورات محددة"],
                    ["all", "جميع التعليقات المؤهلة"],
                  ] as const
                ).map(([mode, label]) => {
                  const selected = historicalSelectionMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      disabled={queueHistoricalComments.isPending}
                      onPress={() => {
                        setHistoricalSelectionMode(mode);
                        setError("");
                      }}
                      style={[
                        styles.historicalModeOption,
                        {
                          backgroundColor: selected
                            ? colors.primary
                            : colors.background,
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.platformChoiceLabel,
                          {
                            color: selected
                              ? colors.primaryForeground
                              : colors.foreground,
                          },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text
                style={[styles.bodySmall, { color: colors.mutedForeground }]}
              >
                خيار جميع التعليقات يعالج كل تعليق مؤهل محفوظ في صندوق الوارد
                خلال آخر 24 ساعة، ويضيفها إلى الطابور على دفعات بحد أقصى 20
                تعليقًا لكل دفعة.
              </Text>
              {historicalPosts.isPending ? (
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  جارٍ تحميل المنشورات والتعليقات المؤهلة...
                </Text>
              ) : null}
              {historicalPosts.isError ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.body, { color: colors.destructive }]}
                >
                  {historicalPosts.error instanceof Error
                    ? historicalPosts.error.message
                    : "تعذر تحميل المنشورات المؤهلة."}
                </Text>
              ) : null}
              {historicalPlatformData?.reason ? (
                <Text style={[styles.bodySmall, { color: colors.warning }]}>
                  {historicalPlatformData.reason}
                </Text>
              ) : null}
              {historicalSelectionMode === "selected" &&
              selectedHistoricalCommentCount > 20 ? (
                <Text style={[styles.bodySmall, { color: colors.warning }]}>
                  الحد الأقصى للدفعة 20 تعليقًا. أزل بعض المنشورات للمتابعة أو
                  اختر جميع التعليقات المؤهلة.
                </Text>
              ) : null}
              {historicalPlatformData?.posts.length ? (
                <View style={styles.historicalSelectionHeader}>
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.body, { color: colors.foreground }]}
                  >
                    {historicalSelectionMode === "all"
                      ? "جميع التعليقات المؤهلة: "
                      : "المحدد للدفعة: "}
                    {formatArabicNumber(selectedHistoricalCommentCount)}
                    {historicalSelectionMode === "selected" ? " / 20" : ""}
                    {" تعليقًا"}
                  </Text>
                  <View style={styles.historicalSelectionActions}>
                    {historicalSelectionMode === "selected" ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={queueHistoricalComments.isPending}
                        onPress={selectAvailableHistoricalPosts}
                      >
                        <Text style={{ color: colors.primary }}>
                          تحديد دفعة حتى 20
                        </Text>
                      </Pressable>
                    ) : null}
                    {historicalSelectionMode === "selected" &&
                    selectedHistoricalPostIds.size ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={queueHistoricalComments.isPending}
                        onPress={() => setSelectedHistoricalPostIds(new Set())}
                      >
                        <Text style={{ color: colors.primary }}>
                          إلغاء التحديد
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {historicalPlatformData?.posts.map((post) => {
                const checked =
                  historicalSelectionMode === "all"
                    ? post.eligibleCommentCount > 0
                    : selectedHistoricalPostIds.has(post.id);
                const disabled =
                  post.eligibleCommentCount === 0 ||
                  historicalSelectionMode === "all" ||
                  (!checked &&
                    selectedHistoricalCommentCount + post.eligibleCommentCount >
                      20) ||
                  queueHistoricalComments.isPending;
                return (
                  <Pressable
                    key={post.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled }}
                    disabled={disabled}
                    onPress={() => toggleHistoricalPost(post.id)}
                    style={[
                      styles.historicalPost,
                      {
                        backgroundColor: colors.background,
                        borderColor: checked ? colors.primary : colors.border,
                        opacity: disabled ? 0.55 : 1,
                      },
                    ]}
                  >
                    {post.imageUrl ? (
                      <Image
                        source={{ uri: post.imageUrl }}
                        style={styles.historicalPostImage}
                        contentFit="cover"
                        cachePolicy="disk"
                        accessibilityLabel="معاينة صورة المنشور"
                      />
                    ) : (
                      <View
                        style={[
                          styles.historicalPostImage,
                          styles.historicalPostImagePlaceholder,
                          { backgroundColor: colors.accent },
                        ]}
                        accessibilityLabel="لا توجد صورة معاينة"
                      >
                        <Icon
                          name="image"
                          size={20}
                          color={colors.mutedForeground}
                        />
                      </View>
                    )}
                    <View style={styles.historicalPostCopy}>
                      <Text style={[styles.body, { color: colors.foreground }]}>
                        {post.title || "منشور بدون عنوان"}
                      </Text>
                      {post.body.trim() ? (
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.bodySmall,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {post.body}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.bodySmall,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        نُشر:{" "}
                        {formatArabicDateTime(post.createdAt) ??
                          "التاريخ غير متاح"}
                      </Text>
                      <Text
                        style={[
                          styles.bodySmall,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        المنتجات الفعالة: {post.products.join("، ")}
                      </Text>
                      <Text
                        style={[
                          styles.bodySmall,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        تعليقات مؤهلة للرد: {post.eligibleCommentCount}
                      </Text>
                      {post.eligibleCommentCount === 0 ? (
                        <Text
                          style={[
                            styles.bodySmall,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          لا توجد تعليقات جديدة مؤهلة على هذا المنشور.
                        </Text>
                      ) : post.eligibleCommentCount > 20 ? (
                        <Text
                          style={[styles.bodySmall, { color: colors.warning }]}
                        >
                          يتجاوز عدد التعليقات حد الدفعة؛ اختر «جميع التعليقات
                          المؤهلة» لمعالجتها على دفعات.
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.historicalCheckbox,
                        {
                          borderColor: checked
                            ? colors.primary
                            : colors.mutedForeground,
                          backgroundColor: checked
                            ? colors.primary
                            : "transparent",
                        },
                      ]}
                    >
                      {checked ? (
                        <Icon
                          name="check"
                          size={13}
                          color={colors.primaryForeground}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {historicalPlatformData?.ready &&
              historicalPlatformData.posts.length === 0 ? (
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  لا توجد منشورات مؤهلة مرتبطة بمنتجات فعالة وموثقة.
                </Text>
              ) : null}
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.body, { color: colors.destructive }]}
                >
                  {error}
                </Text>
              ) : null}
            </ScrollView>

            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <ActionButton
                label="إغلاق"
                icon="x"
                secondary
                disabled={queueHistoricalComments.isPending}
                onPress={() => {
                  setIsHistoricalModalOpen(false);
                  setError("");
                }}
              />
              <ActionButton
                label={
                  queueHistoricalComments.isPending
                    ? "جارٍ الجدولة..."
                    : `جدولة ${selectedHistoricalCommentCount} تعليقًا`
                }
                icon="send"
                disabled={
                  queueHistoricalComments.isPending ||
                  !historicalPlatformData?.ready ||
                  selectedHistoricalCommentCount === 0 ||
                  selectedHistoricalCommentCount > 20
                }
                onPress={confirmHistoricalQueue}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isHistoricalConfirmationOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!queueHistoricalComments.isPending) {
            setIsHistoricalConfirmationOpen(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            accessibilityRole="alert"
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <View style={styles.modalHeading}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  تأكيد جدولة الردود
                </Text>
                <Text
                  style={[styles.bodySmall, { color: colors.mutedForeground }]}
                >
                  راجع تفاصيل الإرسال قبل التأكيد.
                </Text>
              </View>
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContent}
            >
              <View style={styles.confirmationPlatform}>
                <SocialPlatformIcon platform={historicalPlatform} size={28} />
                <View style={styles.platformChoiceCopy}>
                  <Text
                    style={[
                      styles.platformChoiceLabel,
                      { color: colors.foreground },
                    ]}
                  >
                    {historicalPlatform === "facebook" ? "فيسبوك" : "إنستغرام"}
                  </Text>
                  <Text
                    style={[
                      styles.bodySmall,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {connections.data?.[historicalPlatform]?.accountName ??
                      "الحساب المتصل"}
                  </Text>
                </View>
              </View>
              <Text style={[styles.body, { color: colors.foreground }]}>
                {historicalSelectionMode === "all"
                  ? `ستتم معالجة جميع التعليقات المؤهلة (${formatArabicNumber(selectedHistoricalCommentCount)}) على ${formatArabicNumber(selectedHistoricalPosts.length)} منشور.`
                  : `سيتم إضافة ${formatArabicNumber(selectedHistoricalCommentCount)} تعليقًا من ${formatArabicNumber(selectedHistoricalPosts.length)} منشور.`}
                {" وتُضاف إلى الطابور على "}
                {formatArabicNumber(historicalBatchCount)}
                {" دفعة، بحد أقصى 20 تعليقًا للدفعة."}
              </Text>
              {selectedHistoricalPosts.slice(0, 5).map((post) => (
                <View key={post.id} style={styles.confirmationPost}>
                  <Text
                    style={[styles.bodySmall, { color: colors.foreground }]}
                  >
                    • {post.title || "منشور بدون عنوان"}
                  </Text>
                  <Text
                    style={[
                      styles.bodySmall,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {formatArabicNumber(post.eligibleCommentCount)} تعليق
                  </Text>
                </View>
              ))}
              {selectedHistoricalPosts.length > 5 ? (
                <Text
                  style={[styles.bodySmall, { color: colors.mutedForeground }]}
                >
                  ومنشورات أخرى:{" "}
                  {formatArabicNumber(selectedHistoricalPosts.length - 5)}.
                </Text>
              ) : null}
              <Text style={[styles.bodySmall, { color: colors.warning }]}>
                بعد التأكيد، قد ينشئ الذكاء الاصطناعي ردودًا تُنشر علنًا أسفل
                التعليقات. لا يمكن التراجع عن الرد بعد إرساله.
              </Text>
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.bodySmall, { color: colors.destructive }]}
                >
                  {error}
                </Text>
              ) : null}
            </ScrollView>
            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <ActionButton
                label="إلغاء"
                icon="x"
                secondary
                disabled={queueHistoricalComments.isPending}
                onPress={() => setIsHistoricalConfirmationOpen(false)}
              />
              <ActionButton
                label={
                  queueHistoricalComments.isPending
                    ? "جارٍ الإضافة للطابور..."
                    : "تأكيد وإرسال الردود"
                }
                icon={queueHistoricalComments.isPending ? "clock" : "send"}
                disabled={queueHistoricalComments.isPending}
                onPress={() =>
                  queueHistoricalComments.mutate({
                    platform: historicalPlatform,
                    ...(historicalSelectionMode === "all"
                      ? { allEligible: true }
                      : {
                          postIds: selectedHistoricalPosts.map(
                            (post) => post.id,
                          ),
                        }),
                  })
                }
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <View style={styles.modalHeading}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  إعداد الرد الآلي بالذكاء الاصطناعي
                </Text>
                <Text
                  style={[styles.bodySmall, { color: colors.mutedForeground }]}
                >
                  اختر القنوات وطريقة الرد المناسبة.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق إعدادات الرد الآلي"
                disabled={save.isPending}
                onPress={closeModal}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.background },
                ]}
              >
                <Icon name="x" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                اختر أنواع الردود التي تريد تفعيلها لكل منصة. تُحفظ الاختيارات
                عند الضغط على «حفظ»، وإيقاف جميعها يوقف الرد الآلي.
              </Text>

              {query.isError ? (
                <Text style={[styles.body, { color: colors.destructive }]}>
                  {query.error instanceof Error
                    ? query.error.message
                    : "تعذر تحميل إعدادات الرد الآلي."}
                </Text>
              ) : null}

              {query.data ? (
                <>
                  {platforms.map((platform) => {
                    const readiness = query.data.readiness[platform.key];
                    const messageBlock = readinessMessage(readiness, "message");
                    const commentBlock = readinessMessage(readiness, "comment");
                    return (
                      <View
                        key={platform.key}
                        style={[
                          styles.platform,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.platformHeader,
                            { borderBottomColor: colors.border },
                          ]}
                        >
                          <View style={styles.platformHeading}>
                            <PlatformIcon platform={platform.key} />
                            <Text
                              style={[
                                styles.platformTitle,
                                { color: colors.foreground },
                              ]}
                            >
                              {platform.label}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.platformState,
                              {
                                color:
                                  settings[platform.messagesKey] ||
                                  settings[platform.commentsKey]
                                    ? colors.primary
                                    : colors.mutedForeground,
                              },
                            ]}
                          >
                            {settings[platform.messagesKey] ||
                            settings[platform.commentsKey]
                              ? "مفعّل"
                              : "متوقف"}
                          </Text>
                        </View>
                        <SettingSwitch
                          label="الرد تلقائيًا على الرسائل الخاصة"
                          enabled={settings[platform.messagesKey]}
                          busy={save.isPending}
                          disabled={
                            !settings[platform.messagesKey] &&
                            Boolean(messageBlock)
                          }
                          reason={messageBlock}
                          onChange={(value) =>
                            update({ [platform.messagesKey]: value })
                          }
                        />
                        <SettingSwitch
                          label="الرد علنًا على التعليقات"
                          enabled={settings[platform.commentsKey]}
                          busy={save.isPending}
                          disabled={
                            !settings[platform.commentsKey] &&
                            Boolean(commentBlock)
                          }
                          reason={commentBlock}
                          onChange={(value) =>
                            update({ [platform.commentsKey]: value })
                          }
                        />
                      </View>
                    );
                  })}

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      معلومات النشاط والمنتجات
                    </Text>
                    <Text
                      style={[
                        styles.bodySmall,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      أضف معلومات مؤكدة فقط، مثل أسماء المنتجات وأسعارها وتوفرها
                      وسياسة التوصيل وبيانات التواصل. لن يخمّن الرد الآلي
                      المعلومات غير المذكورة.
                    </Text>
                    <CairoTextInput
                      accessibilityLabel="معلومات النشاط والمنتجات"
                      value={settings.instructions}
                      onChangeText={(instructions) => update({ instructions })}
                      placeholder="مثال: ساعات رجالية متوفرة، السعر 150 ريال. التوصيل خلال يومين..."
                      placeholderTextColor={colors.mutedForeground}
                      maxLength={2000}
                      multiline
                      textAlign="right"
                      textAlignVertical="top"
                      editable={!save.isPending}
                      style={[
                        styles.instructionsInput,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.bodySmall,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {settings.instructions.length}/2000
                    </Text>
                  </View>

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      لغة الرد
                    </Text>
                    <View style={styles.choiceRow}>
                      {[
                        { value: "ar" as const, label: "العربية" },
                        {
                          value: "match_customer" as const,
                          label: "لغة العميل",
                        },
                      ].map((option) => (
                        <Text
                          key={option.value}
                          accessibilityRole="button"
                          onPress={() => update({ language: option.value })}
                          style={[
                            styles.choice,
                            {
                              color:
                                settings.language === option.value
                                  ? colors.primaryForeground
                                  : colors.foreground,
                              backgroundColor:
                                settings.language === option.value
                                  ? colors.primary
                                  : colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      ))}
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      أسلوب الرد
                    </Text>
                    <View style={styles.choiceRow}>
                      {tones.map((option) => (
                        <Text
                          key={option.value}
                          accessibilityRole="button"
                          onPress={() => update({ tone: option.value })}
                          style={[
                            styles.choice,
                            {
                              color:
                                settings.tone === option.value
                                  ? colors.primaryForeground
                                  : colors.foreground,
                              backgroundColor:
                                settings.tone === option.value
                                  ? colors.primary
                                  : colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      ))}
                    </View>
                  </View>

                  {error ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: colors.destructive }}
                    >
                      {error}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </ScrollView>

            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <ActionButton
                label="إلغاء"
                icon="x"
                secondary
                disabled={save.isPending}
                onPress={closeModal}
              />
              <ActionButton
                label={
                  save.isPending ? "جارٍ الحفظ..." : "حفظ إعدادات الرد الآلي"
                }
                icon={save.isPending ? "refresh-cw" : "save"}
                disabled={
                  save.isPending || query.isPending || query.isError || !canSave
                }
                onPress={() => save.mutate(settings)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SettingSwitch({
  label,
  enabled,
  busy,
  disabled,
  reason,
  onChange,
}: {
  label: string;
  enabled: boolean;
  busy: boolean;
  disabled: boolean;
  reason: string | null;
  onChange: (enabled: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.switchBlock}>
      <View style={styles.switchRow}>
        <Text style={[styles.body, { color: colors.foreground }]}>{label}</Text>
        <Switch
          accessibilityLabel={label}
          value={enabled}
          disabled={disabled || busy}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
        />
      </View>
      {!enabled && reason ? (
        <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

function PlatformIcon({ platform }: { platform: MetaInboxPlatform }) {
  return <SocialPlatformIcon platform={platform} size={28} />;
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  summary: { gap: 10 },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(10, 37, 64, 0.55)",
  },
  dialog: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "92%",
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalHeading: { flex: 1, gap: 4, alignItems: "flex-start" },
  modalTitle: { fontSize: 17, fontWeight: "700", textAlign: "right" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScroll: { flexShrink: 1 },
  modalContent: { gap: 16, padding: 20 },
  confirmationPlatform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  confirmationPost: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  modalFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  body: { fontSize: 13, lineHeight: 21, textAlign: "left" },
  bodySmall: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  platform: {
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  platformHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  platformHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  platformChoiceCopy: { flex: 1, gap: 2, alignItems: "flex-start" },
  platformChoiceLabel: { fontSize: 13, fontWeight: "600" },
  platformTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  platformState: { fontSize: 12, fontWeight: "600" },
  switchBlock: { gap: 3 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  instructionsInput: {
    minHeight: 112,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 22,
  },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  historicalModeOption: {
    flex: 1,
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  platformOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  historicalPost: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  historicalPostImage: {
    width: 68,
    height: 68,
    borderRadius: 9,
    overflow: "hidden",
  },
  historicalPostImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  historicalPostCopy: { flex: 1, gap: 4 },
  historicalSelectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  historicalSelectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  historicalCheckbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  choice: {
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 13,
  },
});
