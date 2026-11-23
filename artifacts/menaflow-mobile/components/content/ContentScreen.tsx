import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { CairoText as Text } from "@/components/CairoTypography";
import { Skeleton } from "@/components/Skeleton";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  FilterBar,
  FilterChipGroup,
  FilterSheet,
} from "@/components/FilterBar";
import { useColors } from "@/hooks/useColors";
import {
  useStudio,
  type Channel,
  type Post,
  type PostStatus,
} from "@/context/StudioContext";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
} from "@/components/Ui";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import { isLocalAuthDisabled } from "@/constants/auth";
import { ContentPostDialogs } from "@/components/content/ContentPostDialogs";
import { ContentPostList } from "@/components/content/ContentPostList";
import { styles } from "@/components/content/content-styles";
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
    ready,
    storageError,
    loadMorePosts,
    loadingMorePosts,
    hasMorePosts,
    updatePostStatus,
    updatePost,
    publishPost,
    deletePost,
    refreshPosts,
    syncing,
    syncError,
    autoPublishSettings,
  } = useStudio();
  const [filter, setFilter] = useState<PostStatus | "all">("all");
  const [autoPublish, setAutoPublish] = useState(autoPublishSettings.enabled);
  const [autoPublishChannels, setAutoPublishChannels] = useState<Channel[]>(
    autoPublishSettings.channels,
  );
  const [platformFilter, setPlatformFilter] = useState<
    "all" | "facebook" | "instagram"
  >("all");
  const [dateFilter, setDateFilter] = useState<"all" | "7" | "30">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"priority" | "newest" | "oldest">(
    "priority",
  );
  const [search, setSearch] = useState("");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingMediaUrls, setEditingMediaUrls] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [connectedChannels, setConnectedChannels] = useState<
    Array<Extract<Channel, "facebook" | "instagram">>
  >([]);
  const [connectionLoadError, setConnectionLoadError] = useState<string | null>(
    null,
  );
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
    setFiltersOpen(false);
  };
  const activeFilterCount =
    (filter !== "all" ? 1 : 0) +
    (platformFilter !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0) +
    (sortMode !== "priority" ? 1 : 0);
  const statusCounts = posts.reduce<Record<string, number>>((counts, post) => {
    counts[post.status] = (counts[post.status] ?? 0) + 1;
    return counts;
  }, {});

  const loadMoreContent = useCallback(
    async (retry = false) => {
      if (!hasMorePosts || loadingMorePosts || (loadMoreError && !retry))
        return;
      setLoadMoreError(null);
      try {
        await loadMorePosts();
      } catch (error) {
        console.warn("Unable to load more posts:", error);
        setLoadMoreError(
          "تعذّر تحميل المزيد من المنشورات. تحقق من اتصالك ثم أعد المحاولة.",
        );
      }
    },
    [hasMorePosts, loadMoreError, loadMorePosts, loadingMorePosts],
  );

  useEffect(() => {
    if (
      ready &&
      !loadMoreError &&
      visiblePosts.length === 0 &&
      hasMorePosts &&
      !loadingMorePosts
    ) {
      void loadMoreContent();
    }
  }, [
    hasMorePosts,
    loadMoreContent,
    loadMoreError,
    loadingMorePosts,
    ready,
    visiblePosts.length,
  ]);
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
    try {
      await refreshPosts();
    } finally {
      setRefreshing(false);
    }
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

  return (
    <Page scroll={false}>
      <ContentPostList
        ready={ready}
        header={
          <>
            <View style={styles.listHeaderStack}>
      <BrandHeader
        title="المنشورات"
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
            <Icon name="plus" size={18} color={colors.primaryForeground} />
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

        <FilterBar
          activeCount={activeFilterCount}
          onOpenFilters={() => setFiltersOpen(true)}
        >
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
        </FilterBar>

      {connectionLoadError ? (
        <View
          style={[
            styles.connectionLoadError,
            {
              backgroundColor: colors.card,
              borderColor: colors.destructive,
              borderWidth: 1,
            },
          ]}
        >
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.destructive }]}
          >
            {connectionLoadError}
          </Text>
          <ActionButton
            label={
              connectionsQuery.isFetching ? "جارٍ التحقق…" : "إعادة المحاولة"
            }
            icon={connectionsQuery.isFetching ? "clock" : "refresh-cw"}
            secondary
            disabled={connectionsQuery.isFetching}
            onPress={() => void connectionsQuery.refetch()}
          />
        </View>
      ) : null}

      {visiblePosts.length === 0 ? (
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          الرسائل والوسائط المزامنة تُحوّل إلى منشورات متاحة للمراجعة والنشر
          اليدوي أو التلقائي.
        </Text>
      ) : null}
      {syncError ? (
        <View
          style={[
            styles.connectionLoadError,
            {
              backgroundColor: colors.card,
              borderColor: colors.destructive,
              borderWidth: 1,
            },
          ]}
        >
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.destructive }]}
          >
            {syncError}
          </Text>
          <ActionButton
            label={syncing ? "جارٍ إعادة المزامنة…" : "إعادة المزامنة"}
            icon={syncing ? "clock" : "refresh-cw"}
            secondary
            disabled={syncing}
            onPress={() => void refreshPosts()}
          />
        </View>
      ) : null}
      <View style={styles.resultsSummary}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          المنشورات المطابقة المحمّلة: {visiblePosts.length}
        </Text>
        <View style={styles.resultsSummaryActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`النشر التلقائي، ${autoPublish ? "مفعّل" : "متوقف"}. افتح الإعدادات`}
            onPress={() => router.push("/publishing-settings")}
            style={({ pressed }) => [
              styles.autoPublishChip,
              {
                backgroundColor: autoPublish ? colors.accent : "transparent",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Icon
              name="zap"
              size={13}
              color={autoPublish ? colors.primary : colors.mutedForeground}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.autoPublishChipText,
                {
                  color: autoPublish
                    ? colors.primary
                    : colors.mutedForeground,
                },
              ]}
            >
              {autoPublish ? "النشر التلقائي مفعّل" : "النشر التلقائي متوقف"}
            </Text>
          </Pressable>
          {hasActiveFilters ? (
            <Pressable accessibilityRole="button" onPress={clearContentFilters}>
              <Text style={[styles.reviewAction, { color: colors.primary }]}>
                مسح التصفية
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
          {!ready ? (
          storageError ? (
            <EmptyState
              icon="alert-circle"
              title="تعذّر تحميل المنشورات"
              body={storageError}
            />
          ) : (
            <View
              accessible
              accessibilityLabel="جارٍ تحميل المنشورات"
              style={styles.postGroup}
            >
              {[0, 1].map((index) => (
                <View
                  key={`post-skeleton-${index}`}
                  style={[styles.postCard, { borderColor: colors.border }]}
                >
                  <View style={styles.skeletonHeader}>
                    <Skeleton width={72} height={20} radius={10} />
                    <Skeleton width={150} height={14} radius={6} />
                  </View>
                  <Skeleton width="100%" height={10} radius={5} />
                  <Skeleton width="92%" height={10} radius={5} />
                  <Skeleton width="58%" height={10} radius={5} />
                  <View style={styles.skeletonActions}>
                    <Skeleton width={96} height={30} radius={10} />
                    <Skeleton width={64} height={30} radius={10} />
                  </View>
                </View>
              ))}
            </View>
          )
          ) : null}
            </View>
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing || syncing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          if (
            contentOffset.y + layoutMeasurement.height >=
            contentSize.height - 900
          ) {
            void loadMoreContent();
          }
        }}
            visiblePosts={visiblePosts}
            groupedPosts={groupedPosts}
            filter={filter}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearContentFilters}
            onCreatePost={() => router.push("/compose")}
            loadingMorePosts={loadingMorePosts}
            loadMoreError={loadMoreError}
            onRetryLoadMore={() => void loadMoreContent(true)}
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
      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onClear={clearContentFilters}
      >
        <FilterChipGroup
          title="بحاجة إلى متابعة"
          selected={filter}
          onSelect={(key) => setFilter(key as PostStatus | "all")}
          options={[
            {
              key: "review",
              label: "بانتظار المراجعة",
              count: statusCounts.review ?? 0,
            },
            {
              key: "failed",
              label: "فشل النشر",
              count: statusCounts.failed ?? 0,
            },
            {
              key: "scheduled",
              label: "مجدولة",
              count: statusCounts.scheduled ?? 0,
            },
          ]}
        />
        <FilterChipGroup
          title="الحالة"
          selected={filter}
          onSelect={(key) => setFilter(key as PostStatus | "all")}
          options={[
            { key: "all", label: "الكل" },
            { key: "draft", label: "مسودات" },
            { key: "approved", label: "معتمد للنشر التلقائي" },
            { key: "published", label: "تم النشر" },
            { key: "publishing", label: "قيد الإرسال" },
          ]}
        />
        <FilterChipGroup
          title="المنصة"
          selected={platformFilter}
          onSelect={(key) =>
            setPlatformFilter(key as "all" | "facebook" | "instagram")
          }
          options={[
            { key: "all", label: "كل المنصات" },
            { key: "facebook", label: "فيسبوك" },
            { key: "instagram", label: "إنستغرام" },
          ]}
        />
        <FilterChipGroup
          title="الفترة"
          selected={dateFilter}
          onSelect={(key) => setDateFilter(key as "all" | "7" | "30")}
          options={[
            { key: "all", label: "كل التواريخ" },
            { key: "7", label: "7 أيام" },
            { key: "30", label: "30 يوماً" },
          ]}
        />
        <FilterChipGroup
          title="الترتيب"
          selected={sortMode}
          onSelect={(key) =>
            setSortMode(key as "priority" | "newest" | "oldest")
          }
          options={[
            { key: "priority", label: "الأولوية" },
            { key: "newest", label: "الأحدث" },
            { key: "oldest", label: "الأقدم" },
          ]}
        />
      </FilterSheet>
    </Page>
  );
}
