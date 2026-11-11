import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import {
  useStudio,
  type Channel,
  type Post,
  type PostStatus,
} from "@/context/StudioContext";
import {
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
} from "@/components/Ui";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import { isLocalAuthDisabled } from "@/constants/auth";
import { ContentPostDialogs } from "@/components/content/ContentPostDialogs";
import { ContentPostList } from "@/components/content/ContentPostList";
import { styles } from "@/components/content/content-styles";
import { platformLabel } from "@/lib/content-utils";
import {
  useContentPublishingWorkflow,
  type MetaChannel,
} from "@/hooks/use-content-publishing-workflow";
import { useWhatsAppMediaPreviewRefresh } from "@/hooks/use-whatsapp-media-preview-refresh";

function isPostStatus(value: string | undefined): value is PostStatus {
  return (
    value === "draft" ||
    value === "review" ||
    value === "approved" ||
    value === "scheduled" ||
    value === "published" ||
    value === "publishing" ||
    value === "failed"
  );
}

const postStatusPriority: Record<PostStatus, number> = {
  review: 0,
  failed: 1,
  scheduled: 2,
  publishing: 3,
  approved: 4,
  draft: 5,
  published: 6,
};

export default function ContentScreen() {
  if (isLocalAuthDisabled) return <ContentScreenContent userId={null} />;
  return <AuthenticatedContentScreen />;
}

function AuthenticatedContentScreen() {
  const { userId } = useAuth();
  return <ContentScreenContent userId={userId ?? null} />;
}

function ContentScreenContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { status: routeStatusParam, date: routeDateParam } =
    useLocalSearchParams<{ status?: string; date?: string }>();
  const routeStatus = Array.isArray(routeStatusParam)
    ? routeStatusParam[0]
    : routeStatusParam;
  const routeDate = Array.isArray(routeDateParam)
    ? routeDateParam[0]
    : routeDateParam;
  const {
    posts,
    loadMorePosts,
    loadingMorePosts,
    hasMorePosts,
    updatePostStatus,
    updatePost,
    publishPost,
    deletePost,
    refreshPosts,
    syncing,
    autoPublishSettings,
    updateAutoPublishSettings,
  } = useStudio();
  const [filter, setFilter] = useState<PostStatus | "all">("all");
  const [autoPublish, setAutoPublish] = useState(autoPublishSettings.enabled);
  const [autoPublishSettingsExpanded, setAutoPublishSettingsExpanded] =
    useState(false);
  const [autoPublishChannels, setAutoPublishChannels] = useState<Channel[]>(
    autoPublishSettings.channels,
  );
  const [platformFilter, setPlatformFilter] = useState<
    "all" | "facebook" | "instagram"
  >("all");
  const [dateFilter, setDateFilter] = useState<"all" | "7" | "30">("all");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [sortMode, setSortMode] = useState<"priority" | "newest" | "oldest">(
    "priority",
  );
  const [search, setSearch] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingMediaUrls, setEditingMediaUrls] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connectedChannels, setConnectedChannels] = useState<
    Array<Extract<Channel, "facebook" | "instagram">>
  >([]);
  const [connectionLoadError, setConnectionLoadError] = useState<string | null>(
    null,
  );
  const [autoPublishError, setAutoPublishError] = useState<string | null>(null);
  const [autoPublishNotice, setAutoPublishNotice] = useState<string | null>(
    null,
  );
  const [autoPublishConfirmationVisible, setAutoPublishConfirmationVisible] =
    useState(false);
  const [autoPublishSaving, setAutoPublishSaving] = useState(false);
  const mediaPreviewUrls = useWhatsAppMediaPreviewRefresh(posts);
  const publishingWorkflow = useContentPublishingWorkflow({
    autoPublish,
    autoPublishChannels,
    updatePostStatus,
    refreshPosts,
    publishPost,
  });
  const {
    publishDialogPostId,
    setPublishDialogPostId,
    publishing,
    publishMessage,
    setPublishMessage,
    publishOutcome,
    setPublishOutcome,
    publishChannelResults,
    setPublishChannelResults,
    selectedPublishChannels,
    setSelectedPublishChannels,
    retryChannels,
    setRetryChannels,
    retryConfirmationVisible,
    setRetryConfirmationVisible,
    verifyingPostId,
    verificationFeedback,
    onPublish,
    togglePublishChannel,
    onApprove,
    onVerifyFacebookStatus,
    publishAndShowResult,
  } = publishingWorkflow;
  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: 2,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const connectionsLoaded =
    connectionsQuery.isSuccess || connectionsQuery.isError;

  useEffect(() => {
    setAutoPublish(autoPublishSettings.enabled);
    setAutoPublishChannels(
      autoPublishSettings.channels.filter(
        (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
          channel === "facebook" || channel === "instagram",
      ),
    );
  }, [autoPublishSettings]);

  useEffect(() => {
    if (connectionsQuery.data) {
      const linked = [
        ...(connectionsQuery.data.facebook ? ["facebook" as const] : []),
        ...(connectionsQuery.data.instagram ? ["instagram" as const] : []),
      ];
      setConnectedChannels(linked);
      setAutoPublishChannels((current) =>
        current.filter(
          (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
            channel !== "whatsapp" && linked.includes(channel),
        ),
      );
      setConnectionLoadError(null);
    } else if (connectionsQuery.isError) {
      console.warn(
        "Unable to load connected social platforms:",
        connectionsQuery.error,
      );
      setConnectionLoadError(
        "تعذّر تحميل المنصات المرتبطة. أعد المحاولة أو تحقّق من اتصال الخادم.",
      );
    }
  }, [connectionsQuery.data, connectionsQuery.error, connectionsQuery.isError]);

  const visiblePosts = posts
    .filter((post) => {
      if (filter !== "all" && post.status !== filter) return false;
      if (platformFilter !== "all" && !post.channels.includes(platformFilter))
        return false;
      if (dateFilter !== "all") {
        const created = new Date(
          post.sourceMessageDate || post.createdAt,
        ).getTime();
        const age = Date.now() - created;
        if (
          !Number.isFinite(created) ||
          age < 0 ||
          age > Number(dateFilter) * 24 * 60 * 60 * 1000
        )
          return false;
      }
      const searchText =
        `${post.title} ${post.body} ${post.sourceText ?? ""} ${post.sourceGroupName ?? ""}`.toLocaleLowerCase();
      return (
        !search.trim() || searchText.includes(search.trim().toLocaleLowerCase())
      );
    })
    .sort((left, right) => {
      const leftDate = Date.parse(left.sourceMessageDate || left.createdAt);
      const rightDate = Date.parse(right.sourceMessageDate || right.createdAt);
      const normalizedLeftDate = Number.isFinite(leftDate) ? leftDate : 0;
      const normalizedRightDate = Number.isFinite(rightDate) ? rightDate : 0;

      if (sortMode === "newest")
        return normalizedRightDate - normalizedLeftDate;
      if (sortMode === "oldest")
        return normalizedLeftDate - normalizedRightDate;

      return (
        postStatusPriority[left.status] - postStatusPriority[right.status] ||
        normalizedRightDate - normalizedLeftDate
      );
    });
  const hasActiveFilters = Boolean(
    filter !== "all" ||
    platformFilter !== "all" ||
    dateFilter !== "all" ||
    search.trim(),
  );
  const clearContentFilters = () => {
    setFilter("all");
    setPlatformFilter("all");
    setDateFilter("all");
    setSearch("");
    setFiltersExpanded(false);
  };

  useEffect(() => {
    if (visiblePosts.length === 0 && hasMorePosts && !loadingMorePosts) {
      void loadMorePosts().catch((error) => {
        console.warn(
          "Unable to find more content matching the selected filters:",
          error,
        );
      });
    }
  }, [visiblePosts.length, hasMorePosts, loadingMorePosts, loadMorePosts]);
  const groupedPostsByKey = new Map<
    string,
    { key: string; title: string; posts: typeof visiblePosts }
  >();
  for (const post of visiblePosts) {
    const isWhatsAppSource =
      post.sourceType === "whatsapp" && Boolean(post.sourceGroupJid);
    const key = isWhatsAppSource ? post.sourceGroupJid! : "other";
    let group = groupedPostsByKey.get(key);
    if (!group) {
      group = {
        key,
        title: isWhatsAppSource
          ? post.sourceGroupName || `مجموعة واتساب (${post.sourceGroupJid})`
          : "منشورات أخرى",
        posts: [],
      };
      groupedPostsByKey.set(key, group);
    }
    group.posts.push(post);
  }
  const groupedPosts = [...groupedPostsByKey.values()];

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshPosts();
    setRefreshing(false);
  };

  const saveAutoPublish = async (enabled: boolean, channels: Channel[]) => {
    try {
      const linkedChannels = channels.filter(
        (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
          channel !== "whatsapp" && connectedChannels.includes(channel),
      );
      if (enabled && linkedChannels.length === 0) {
        setAutoPublishError(
          "اربط فيسبوك أو إنستغرام أولاً ثم اختر منصة للنشر التلقائي.",
        );
        return null;
      }
      const saved = await updateAutoPublishSettings(enabled, linkedChannels);
      setAutoPublishError(null);
      return saved;
    } catch (error) {
      setAutoPublishError(
        error instanceof Error
          ? error.message
          : "تعذّر حفظ إعدادات النشر التلقائي على الخادم.",
      );
      return null;
    }
  };

  const toggleAutoChannel = (channel: "facebook" | "instagram") => {
    if (!connectedChannels.includes(channel)) return;
    const channels = autoPublishChannels.includes(channel)
      ? autoPublishChannels.filter((item) => item !== channel)
      : [...autoPublishChannels, channel];
    if (autoPublish && channels.length === 0) {
      Alert.alert(
        "اختر منصة",
        "يجب اختيار فيسبوك أو إنستغرام عند تفعيل النشر التلقائي.",
      );
      return;
    }
    const previous = autoPublishChannels;
    setAutoPublishChannels(channels);
    void saveAutoPublish(autoPublish, channels).then((saved) => {
      if (!saved) setAutoPublishChannels(previous);
    });
  };

  const onEdit = (post: Post) => {
    setEditingPostId(post.id);
    setEditingBody(post.body);
    setEditingMediaUrls(post.mediaUrls ?? []);
  };

  useEffect(() => {
    if (routeStatus === "all" || isPostStatus(routeStatus)) {
      setFilter(routeStatus);
    }
  }, [routeStatus]);

  useEffect(() => {
    if (routeDate === "all" || routeDate === "7" || routeDate === "30") {
      setDateFilter(routeDate);
    }
  }, [routeDate]);

  const onAutoPublishChange = async (enabled: boolean) => {
    if (enabled && autoPublishChannels.length === 0) {
      setAutoPublishError(
        "اختر منصة مرتبطة واحدة على الأقل قبل تفعيل النشر التلقائي.",
      );
      return;
    }
    if (enabled) {
      setAutoPublishError(null);
      setAutoPublishNotice(null);
      setAutoPublishConfirmationVisible(true);
      return;
    }
    await persistAutoPublishChange(enabled);
  };

  const persistAutoPublishChange = async (enabled: boolean) => {
    setAutoPublishSaving(true);
    setAutoPublishError(null);
    setAutoPublishNotice(null);
    try {
      const saved = await saveAutoPublish(enabled, autoPublishChannels);
      if (saved) {
        setAutoPublish(enabled);
        const report = saved.initialPublish;
        if (enabled && report) {
          setAutoPublishNotice(
            report.processed > 0
              ? `تمت معالجة ${report.processed} منشورًا معتمدًا للنشر التلقائي. نُشر ${report.published} بنجاح، وفشل ${report.failed}.`
              : "لا توجد منشورات معتمدة للنشر التلقائي الآن.",
          );
        }
      }
    } finally {
      setAutoPublishSaving(false);
    }
  };

  return (
    <Page
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        if (
          contentOffset.y + layoutMeasurement.height >=
          contentSize.height - 900
        ) {
          void loadMorePosts().catch((error) => {
            console.warn("Unable to load the next content page:", error);
          });
        }
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing || syncing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <Panel style={styles.contentIntro}>
        <View
          style={[styles.contentEyebrow, { backgroundColor: colors.accent }]}
        >
          <Icon name="file-text" size={15} color={colors.primary} />
          <Text style={[styles.contentEyebrowText, { color: colors.primary }]}>
            استوديو المحتوى
          </Text>
        </View>
        <PageTitle
          title="المحتوى"
          subtitle="أنشئ المسودات وراجعها وقم بالتسويق والنشر على المنصات المختارة."
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إنشاء منشور"
              onPress={() => router.push("/compose")}
              style={({ pressed }) => [
                styles.addButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.84 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <Icon name="plus" size={19} color={colors.primaryForeground} />
              <Text
                style={[
                  styles.createPostLabel,
                  { color: colors.primaryForeground },
                ]}
              >
                منشور جديد
              </Text>
            </Pressable>
          }
        />
      </Panel>

      <Panel style={styles.autoPublishPanel}>
        <View
          style={[
            styles.autoPublishHeader,
            { backgroundColor: colors.background },
          ]}
        >
          <View style={styles.autoPublishTitleGroup}>
            <View
              style={[
                styles.autoPublishIcon,
                { backgroundColor: colors.accent },
              ]}
            >
              <Icon name="zap" size={17} color={colors.primary} />
            </View>
            <View style={styles.autoPublishTitleCopy}>
              <Text style={[styles.autoLabel, { color: colors.foreground }]}>
                النشر التلقائي
              </Text>
              <Text
                style={[
                  styles.autoPublishDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                {autoPublish
                  ? `المنشورات المعتمدة تُنشر على ${
                      autoPublishChannels.map(platformLabel).join(" و") ||
                      "المنصات المختارة"
                    }`
                  : "اختر منصاتك لنشر المحتوى المعتمد تلقائيًا"}
              </Text>
            </View>
          </View>
          <Switch
            accessibilityLabel="تفعيل النشر التلقائي"
            value={autoPublish}
            disabled={
              !connectionsLoaded ||
              connectedChannels.length === 0 ||
              autoPublishSaving
            }
            onValueChange={(value) => void onAutoPublishChange(value)}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: autoPublishSettingsExpanded }}
          onPress={() =>
            setAutoPublishSettingsExpanded((expanded) => !expanded)
          }
          style={({ pressed }) => [
            styles.advancedFilterToggle,
            {
              borderColor: colors.border,
              backgroundColor: autoPublishSettingsExpanded
                ? colors.accent
                : colors.card,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[styles.filterLabel, { color: colors.foreground }]}>
            {autoPublish
              ? `مفعّل على ${
                  autoPublishChannels.map(platformLabel).join(" و") ||
                  "المنصات المختارة"
                }`
              : "إعدادات المنصات والنشر التلقائي"}
          </Text>
          <Icon
            name={autoPublishSettingsExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.mutedForeground}
          />
        </Pressable>
        {autoPublishSettingsExpanded ? (
          <>
            <Text style={[styles.autoLabel, { color: colors.mutedForeground }]}>
              المنصات المستهدفة
            </Text>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>
              عند التفعيل، تُنشر المنشورات المعتمدة فقط إلى المنصات المختارة.
            </Text>
            <View style={styles.channelChips}>
              {connectedChannels.map((channel) => {
                const selected = autoPublishChannels.includes(channel);
                return (
                  <Pressable
                    key={channel}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggleAutoChannel(channel)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      {
                        backgroundColor: selected
                          ? colors.primary
                          : colors.secondary,
                        opacity: pressed ? 0.78 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterLabel,
                        {
                          color: selected
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {platformLabel(channel)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!connectionsLoaded ? (
              <Text style={[styles.intro, { color: colors.mutedForeground }]}>
                جارٍ التحقق من المنصات المرتبطة…
              </Text>
            ) : connectionLoadError ? null : connectedChannels.length === 0 ? (
              <Text style={[styles.intro, { color: colors.mutedForeground }]}>
                اربط صفحة فيسبوك أو إنستغرام من صفحة المصادر لتفعيل النشر.
              </Text>
            ) : null}
          </>
        ) : null}
        {connectionLoadError ? (
          <View
            style={[
              styles.connectionLoadError,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Text
              accessibilityRole="alert"
              style={[styles.intro, { color: colors.destructive }]}
            >
              {connectionLoadError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: connectionsQuery.isFetching }}
              disabled={connectionsQuery.isFetching}
              onPress={() => void connectionsQuery.refetch()}
              style={({ pressed }) => [
                styles.historyButton,
                {
                  backgroundColor: colors.secondary,
                  opacity: connectionsQuery.isFetching
                    ? 0.6
                    : pressed
                      ? 0.76
                      : 1,
                },
              ]}
            >
              <Text style={[styles.filterLabel, { color: colors.foreground }]}>
                {connectionsQuery.isFetching
                  ? "جارٍ التحقق…"
                  : "إعادة المحاولة"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {autoPublishError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.mutedForeground }]}
          >
            {autoPublishError}
          </Text>
        ) : null}
        {autoPublishSaving ? (
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.mutedForeground }]}
          >
            جارٍ حفظ إعدادات النشر التلقائي…
          </Text>
        ) : null}
        {autoPublishNotice ? (
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.primary }]}
          >
            {autoPublishNotice}
          </Text>
        ) : null}
      </Panel>

      <Panel style={styles.postWorkspace}>
        <SectionTitle title="مساحة النشر وإدارة المنشورات" />
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          الرسائل والوسائط المزامنة تُحوّل إلى منشورات متاحة للمراجعة والنشر
          اليدوي أو التلقائي.
        </Text>
        <View style={styles.prioritySectionHeading}>
          <View
            style={[
              styles.priorityHeadingIcon,
              { backgroundColor: colors.accent },
            ]}
          >
            <Icon name="clock" size={15} color={colors.primary} />
          </View>
          <Text style={[styles.priorityHeading, { color: colors.foreground }]}>
            تحتاج إلى متابعة
          </Text>
        </View>
        <View style={styles.priorityFilters}>
          {[
            {
              key: "review" as const,
              label: "بانتظار المراجعة",
              icon: "eye" as const,
              count: posts.filter((post) => post.status === "review").length,
            },
            {
              key: "failed" as const,
              label: "فشل النشر",
              icon: "alert-circle" as const,
              count: posts.filter((post) => post.status === "failed").length,
            },
            {
              key: "scheduled" as const,
              label: "مؤجلة (دون موعد)",
              icon: "clock" as const,
              count: posts.filter((post) => post.status === "scheduled").length,
            },
          ].map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}: ${item.count}`}
              accessibilityState={{ selected: filter === item.key }}
              onPress={() => setFilter(filter === item.key ? "all" : item.key)}
              style={({ pressed }) => [
                styles.priorityFilter,
                {
                  backgroundColor:
                    filter === item.key ? colors.primary : colors.secondary,
                  borderColor:
                    filter === item.key
                      ? colors.primary
                      : item.count > 0
                        ? colors.warning
                        : colors.border,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}
            >
              <Icon
                name={item.icon}
                size={15}
                color={
                  filter === item.key
                    ? colors.primaryForeground
                    : item.count > 0
                      ? colors.warning
                      : colors.mutedForeground
                }
              />
              <Text
                style={[
                  styles.filterLabel,
                  {
                    color:
                      filter === item.key
                        ? colors.primaryForeground
                        : colors.foreground,
                  },
                ]}
              >
                {item.label}
              </Text>
              <View
                style={[
                  styles.priorityCount,
                  {
                    backgroundColor:
                      filter === item.key ? colors.card : colors.background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.priorityCountText,
                    {
                      color:
                        filter === item.key
                          ? colors.primary
                          : item.count > 0
                            ? colors.warning
                            : colors.mutedForeground,
                    },
                  ]}
                >
                  {item.count}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.priorityHint, { color: colors.mutedForeground }]}>
          الأعداد تخص المنشورات المحمّلة حاليًا.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statusFilterScroll}
          contentContainerStyle={styles.statusFilterContent}
        >
          {[
            { key: "all" as const, label: "الكل" },
            { key: "draft" as const, label: "مسودات" },
            { key: "approved" as const, label: "معتمد للنشر التلقائي" },
            { key: "published" as const, label: "تم النشر" },
            { key: "publishing" as const, label: "قيد الإرسال" },
          ].map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === item.key }}
              onPress={() => setFilter(item.key)}
              style={({ pressed }) => [
                styles.filterChip,
                {
                  backgroundColor:
                    filter === item.key ? colors.primary : colors.secondary,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterLabel,
                  {
                    color:
                      filter === item.key
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersExpanded }}
          onPress={() => setFiltersExpanded((expanded) => !expanded)}
          style={({ pressed }) => [
            styles.advancedFilterToggle,
            {
              borderColor: colors.border,
              backgroundColor: filtersExpanded ? colors.accent : colors.card,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Icon
            name="filter"
            size={16}
            color={filtersExpanded ? colors.primary : colors.mutedForeground}
          />
          <Text style={[styles.filterLabel, { color: colors.foreground }]}>
            {platformFilter !== "all" || dateFilter !== "all"
              ? `التصفية: ${
                  platformFilter === "facebook"
                    ? "فيسبوك"
                    : platformFilter === "instagram"
                      ? "إنستغرام"
                      : ""
                }${
                  platformFilter !== "all" && dateFilter !== "all" ? " · " : ""
                }${
                  dateFilter === "7"
                    ? "آخر 7 أيام"
                    : dateFilter === "30"
                      ? "آخر 30 يوماً"
                      : ""
                }`
              : "تصفية حسب المنصة والتاريخ"}
          </Text>
          {platformFilter !== "all" || dateFilter !== "all" ? (
            <View
              style={[
                styles.activeFilterBadge,
                { backgroundColor: colors.accent },
              ]}
            >
              <Text
                style={[
                  styles.activeFilterBadgeText,
                  { color: colors.primary },
                ]}
              >
                {(platformFilter !== "all" ? 1 : 0) +
                  (dateFilter !== "all" ? 1 : 0)}
              </Text>
            </View>
          ) : null}
          <Icon
            name={filtersExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.mutedForeground}
          />
        </Pressable>
        <View
          style={[
            styles.searchRow,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            accessibilityLabel="ابحث في المنشورات"
            value={search}
            onChangeText={setSearch}
            placeholder="ابحث في المنشورات"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            textAlign="right"
            returnKeyType="search"
          />
          {search ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="مسح البحث"
              onPress={() => setSearch("")}
              style={styles.clearSearchButton}
              hitSlop={8}
            >
              <Icon name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        {filtersExpanded ? (
          <View style={styles.advancedFilters}>
            <Text
              style={[
                styles.filterGroupLabel,
                { color: colors.mutedForeground },
              ]}
            >
              المنصة
            </Text>
            <View style={styles.filterRow}>
              {[
                { value: "all" as const, label: "كل المنصات" },
                { value: "facebook" as const, label: "فيسبوك" },
                { value: "instagram" as const, label: "إنستغرام" },
              ].map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: platformFilter === item.value,
                  }}
                  onPress={() => setPlatformFilter(item.value)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor:
                        platformFilter === item.value
                          ? colors.primary
                          : colors.secondary,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterLabel,
                      {
                        color:
                          platformFilter === item.value
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text
              style={[
                styles.filterGroupLabel,
                { color: colors.mutedForeground },
              ]}
            >
              الفترة
            </Text>
            <View style={styles.filterRow}>
              {[
                { value: "all" as const, label: "كل التواريخ" },
                { value: "7" as const, label: "7 أيام" },
                { value: "30" as const, label: "30 يوماً" },
              ].map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: dateFilter === item.value }}
                  onPress={() => setDateFilter(item.value)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor:
                        dateFilter === item.value
                          ? colors.primary
                          : colors.secondary,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterLabel,
                      {
                        color:
                          dateFilter === item.value
                            ? colors.primaryForeground
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.sortRow}>
          <Text
            style={[styles.filterGroupLabel, { color: colors.mutedForeground }]}
          >
            ترتيب
          </Text>
          <View style={styles.filterRow}>
            {[
              { value: "priority" as const, label: "الأولوية" },
              { value: "newest" as const, label: "الأحدث" },
              { value: "oldest" as const, label: "الأقدم" },
            ].map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: sortMode === item.value }}
                onPress={() => setSortMode(item.value)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor:
                      sortMode === item.value
                        ? colors.accent
                        : colors.secondary,
                    opacity: pressed ? 0.78 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    {
                      color:
                        sortMode === item.value
                          ? colors.primary
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.resultsSummary}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            المنشورات المطابقة المحمّلة: {visiblePosts.length}
          </Text>
          {hasActiveFilters ? (
            <Pressable accessibilityRole="button" onPress={clearContentFilters}>
              <Text style={[styles.reviewAction, { color: colors.primary }]}>
                مسح التصفية
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ContentPostList
          visiblePosts={visiblePosts}
          groupedPosts={groupedPosts}
          filter={filter}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearContentFilters}
          loadingMorePosts={loadingMorePosts}
          mediaPreviewUrls={mediaPreviewUrls}
          onMediaError={() => void refreshPosts()}
          verifyingPostId={verifyingPostId}
          verificationFeedback={verificationFeedback}
          onVerifyFacebookStatus={onVerifyFacebookStatus}
          onEdit={onEdit}
          onPublish={onPublish}
          onApprove={onApprove}
          updatePostStatus={updatePostStatus}
          deletePost={deletePost}
        />
      </Panel>
      <ContentPostDialogs
        posts={posts}
        mediaPreviewUrls={mediaPreviewUrls}
        editingPostId={editingPostId}
        setEditingPostId={setEditingPostId}
        editingBody={editingBody}
        setEditingBody={setEditingBody}
        editingMediaUrls={editingMediaUrls}
        setEditingMediaUrls={setEditingMediaUrls}
        updatePost={updatePost}
        publishDialogPostId={publishDialogPostId}
        setPublishDialogPostId={setPublishDialogPostId}
        publishMessage={publishMessage}
        setPublishMessage={setPublishMessage}
        publishOutcome={publishOutcome}
        setPublishOutcome={setPublishOutcome}
        publishChannelResults={publishChannelResults}
        setPublishChannelResults={setPublishChannelResults}
        onRetryFailedChannel={(failedChannel) => {
          if (!publishDialogPostId) return;
          void publishAndShowResult(publishDialogPostId, [failedChannel]);
        }}
        selectedPublishChannels={selectedPublishChannels}
        setSelectedPublishChannels={setSelectedPublishChannels}
        onTogglePublishChannel={togglePublishChannel}
        connectedChannels={connectedChannels}
        connectionsLoaded={connectionsLoaded}
        publishing={publishing}
        publishAndShowResult={publishAndShowResult}
        retryChannels={retryChannels}
        setRetryChannels={setRetryChannels}
        retryConfirmationVisible={retryConfirmationVisible}
        setRetryConfirmationVisible={setRetryConfirmationVisible}
      />
      <Modal
        visible={autoPublishConfirmationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAutoPublishConfirmationVisible(false)}
      >
        <View style={styles.autoPublishModalOverlay}>
          <View
            accessibilityViewIsModal
            style={[
              styles.autoPublishModal,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.autoPublishModalTitle,
                { color: colors.foreground },
              ]}
            >
              تفعيل النشر التلقائي؟
            </Text>
            <Text
              style={[
                styles.intro,
                { color: colors.mutedForeground, textAlign: "left" },
              ]}
            >
              سيتم إرسال المنشورات المعتمدة إلى{" "}
              {autoPublishChannels.map(platformLabel).join(" و")} الآن.
            </Text>
            <View style={styles.autoPublishModalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAutoPublishConfirmationVisible(false)}
                style={[
                  styles.autoPublishModalButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.filterLabel, { color: colors.foreground }]}
                >
                  إلغاء
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setAutoPublishConfirmationVisible(false);
                  void persistAutoPublishChange(true);
                }}
                style={[
                  styles.autoPublishModalButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  تفعيل والنشر
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}
