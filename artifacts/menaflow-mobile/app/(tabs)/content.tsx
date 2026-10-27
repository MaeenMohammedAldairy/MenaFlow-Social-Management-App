import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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
  fetchApiResponse,
  verifyFacebookPostStatus,
} from "@workspace/api-client-react";
import { isLocalAuthDisabled } from "@/constants/auth";
import { ContentPostDialogs } from "@/components/content/ContentPostDialogs";
import { ContentPostList } from "@/components/content/ContentPostList";
import { styles } from "@/components/content/content-styles";
import {
  platformLabel,
  publishReasonLabel,
  whatsappMediaExpiryFromUrl,
  whatsappMediaIdFromUrl,
} from "@/lib/content-utils";

type MetaChannel = Extract<Channel, "facebook" | "instagram">;
type PublishOutcome = "success" | "partial" | "uncertain" | "failed";
type PublishChannelResult = {
  channel: MetaChannel;
  status: string;
  url?: string | null;
  reason?: string;
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
    analyzeWhatsAppBacklog,
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
  const [search, setSearch] = useState("");
  const [processingHistory, setProcessingHistory] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingMediaUrls, setEditingMediaUrls] = useState<string[]>([]);
  const [publishDialogPostId, setPublishDialogPostId] = useState<string | null>(
    null,
  );
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishOutcome, setPublishOutcome] = useState<PublishOutcome | null>(null);
  const [publishChannelResults, setPublishChannelResults] = useState<PublishChannelResult[]>([]);
  const [selectedPublishChannels, setSelectedPublishChannels] = useState<MetaChannel[]>([]);
  const [retryChannels, setRetryChannels] = useState<
    Array<Extract<Channel, "facebook" | "instagram">>
  >([]);
  const [retryConfirmationVisible, setRetryConfirmationVisible] =
    useState(false);
  const [verifyingPostId, setVerifyingPostId] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<
    Record<string, string>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const [connectedChannels, setConnectedChannels] = useState<
    Array<Extract<Channel, "facebook" | "instagram">>
  >([]);
  const [connectionLoadError, setConnectionLoadError] = useState<string | null>(
    null,
  );
  const [autoPublishError, setAutoPublishError] = useState<string | null>(null);
  const [mediaPreviewUrls, setMediaPreviewUrls] = useState<
    Record<string, string>
  >({});
  const mediaRefreshRetryAtRef = useRef(new Map<string, number>());
  const [mediaRetryScheduleVersion, setMediaRetryScheduleVersion] = useState(0);
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
    let active = true;
    const mediaById = new Map<string, string>();
    const thumbnailMediaIds = new Set<string>();
    for (const post of posts) {
      for (const [index, mediaUrl] of (post.mediaUrls ?? []).entries()) {
        const mediaId = whatsappMediaIdFromUrl(mediaUrl);
        if (mediaId) {
          mediaById.set(mediaId, mediaPreviewUrls[mediaId] ?? mediaUrl);
          if (index < 3) thumbnailMediaIds.add(mediaId);
        }
      }
    }
    const nextRefreshAt = [...mediaById].reduce<number | null>(
      (soonest, [mediaId, mediaUrl]) => {
        const expiresAt = whatsappMediaExpiryFromUrl(mediaUrl);
        if (!expiresAt) return soonest;
        const retryAt = mediaRefreshRetryAtRef.current.get(mediaId) ?? 0;
        const refreshAt = Math.max(expiresAt - 5 * 60 * 1000, retryAt);
        return soonest === null || refreshAt < soonest ? refreshAt : soonest;
      },
      null,
    );
    if (nextRefreshAt === null) return;

    const refreshTimer = setTimeout(
      async () => {
        const now = Date.now();
        const dueMedia = [...mediaById].filter(([mediaId, mediaUrl]) => {
          const expiresAt = whatsappMediaExpiryFromUrl(mediaUrl);
          const retryAt = mediaRefreshRetryAtRef.current.get(mediaId) ?? 0;
          return (
            expiresAt !== null &&
            expiresAt <= now + 5 * 60 * 1000 &&
            retryAt <= now
          );
        });
        let hasFailure = false;
        const refreshedEntries = await Promise.all(
          dueMedia.map(async ([mediaId]) => {
            try {
              const originalResponse = await fetchApiResponse(
                `/api/social/whatsapp/media/${encodeURIComponent(mediaId)}/url`,
              );
              if (!originalResponse.ok)
                throw new Error("Media URL refresh failed.");
              const originalResult = (await originalResponse.json()) as {
                url?: unknown;
              };
              const refreshedUrl = originalResult.url;
              if (typeof refreshedUrl !== "string" || !refreshedUrl) {
                throw new Error("Media URL refresh returned no URL.");
              }
              let refreshedThumbnailUrl: string | undefined;
              if (thumbnailMediaIds.has(mediaId)) {
                const thumbnailResponse = await fetchApiResponse(
                  `/api/social/whatsapp/media/${encodeURIComponent(mediaId)}/url?variant=thumbnail`,
                );
                if (!thumbnailResponse.ok)
                  throw new Error("Thumbnail URL refresh failed.");
                const thumbnailResult = (await thumbnailResponse.json()) as {
                  url?: unknown;
                };
                if (
                  typeof thumbnailResult.url !== "string" ||
                  !thumbnailResult.url
                ) {
                  throw new Error("Thumbnail URL refresh returned no URL.");
                }
                refreshedThumbnailUrl = thumbnailResult.url;
              }
              mediaRefreshRetryAtRef.current.delete(mediaId);
              return {
                mediaId,
                originalUrl: refreshedUrl,
                thumbnailUrl: refreshedThumbnailUrl,
              };
            } catch (error) {
              console.warn(
                "Unable to refresh a WhatsApp media preview URL:",
                error,
              );
              mediaRefreshRetryAtRef.current.set(mediaId, Date.now() + 60_000);
              hasFailure = true;
              return null;
            }
          }),
        );
        if (!active) return;
        const refreshed: Record<string, string> = {};
        for (const entry of refreshedEntries) {
          if (!entry) continue;
          refreshed[entry.mediaId] = entry.originalUrl;
          if (entry.thumbnailUrl) {
            refreshed[`${entry.mediaId}:thumbnail`] = entry.thumbnailUrl;
          }
        }
        if (Object.keys(refreshed).length > 0) {
          setMediaPreviewUrls((current) => ({
            ...current,
            ...refreshed,
          }));
        }
        if (hasFailure) setMediaRetryScheduleVersion((version) => version + 1);
      },
      Math.max(0, nextRefreshAt - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(refreshTimer);
    };
  }, [posts, mediaPreviewUrls, mediaRetryScheduleVersion]);

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

  const visiblePosts = posts.filter((post) => {
    if (filter !== "all" && post.status !== filter) return false;
    if (platformFilter !== "all" && !post.channels.includes(platformFilter))
      return false;
    if (dateFilter !== "all") {
      const created = new Date(
        post.sourceMessageDate || post.createdAt,
      ).getTime();
      if (
        !Number.isFinite(created) ||
        Date.now() - created > Number(dateFilter) * 24 * 60 * 60 * 1000
      )
        return false;
    }
    const searchText =
      `${post.title} ${post.body} ${post.sourceText ?? ""} ${post.sourceGroupName ?? ""}`.toLocaleLowerCase();
    return (
      !search.trim() || searchText.includes(search.trim().toLocaleLowerCase())
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

  const onPublish = async (post: (typeof posts)[number]) => {
    setPublishMessage(null);
    setPublishOutcome(null);
    setPublishChannelResults([]);
    setSelectedPublishChannels([]);
    setRetryChannels([]);
    setRetryConfirmationVisible(false);
    setPublishDialogPostId(post.id);
  };

  const togglePublishChannel = (channel: MetaChannel) => {
    setSelectedPublishChannels((current) =>
      current.includes(channel)
        ? current.filter((selected) => selected !== channel)
        : [...current, channel],
    );
  };

  const onApprove = async (post: Post) => {
    try {
      await updatePostStatus(post.id, "approved");
      await refreshPosts();
      Alert.alert(
        "تم اعتماد المنشور",
        autoPublish
          ? "تم اعتماد المنشور، وسيبدأ نشره على المنصات المختارة."
          : "حُفظ ضمن المنشورات المعتمدة، وسيُنشر عند تفعيل النشر التلقائي.",
      );
    } catch (error) {
      Alert.alert(
        "تعذر اعتماد المنشور",
        error instanceof Error ? error.message : "تحقق من النص والوسائط ثم أعد المحاولة.",
      );
    }
  };

  const onVerifyFacebookStatus = async (postId: string) => {
    setVerifyingPostId(postId);
    setVerificationFeedback((current) => ({ ...current, [postId]: "" }));
    try {
      const result = await verifyFacebookPostStatus(postId);
      await refreshPosts();
      const message =
        result.status === "found"
          ? "تأكدنا أن المنشور موجود على فيسبوك. تم تحديث حالته دون إعادة نشره."
          : result.status === "not-found"
            ? "لم يُعثر على المنشور في سجلات فيسبوك بعد فحص موجز الصفحة. لم تتم إعادة إرساله؛ يمكنك اختيار إعادة المحاولة يدويًا."
            : (publishReasonLabel(result.reason) ??
              "تعذّر التحقق من فيسبوك. لم تتم إعادة إرسال المنشور. تحقق من اتصال Meta وصلاحيات الصفحة ثم أعد الفحص.");
      setVerificationFeedback((current) => ({ ...current, [postId]: message }));
    } catch (error) {
      setVerificationFeedback((current) => ({
        ...current,
        [postId]:
          error instanceof Error
            ? error.message
            : "تعذّر التحقق من حالة المنشور على فيسبوك.",
      }));
    } finally {
      setVerifyingPostId(null);
    }
  };

  const publishAndShowResult = async (
    postId: string,
    channels: MetaChannel[],
    retryUncertain = false,
  ) => {
    setPublishing(true);
    setPublishMessage(null);
    setPublishOutcome(null);
    setPublishChannelResults([]);
    setRetryChannels([]);
    setRetryConfirmationVisible(false);
    try {
      const result = await publishPost(postId, channels, retryUncertain);
      const uncertainChannels = Object.entries(result.results)
        .filter(([, value]) => value.status === "unknown")
        .map(([platform]) => platform)
        .filter(
          (platform): platform is Extract<Channel, "facebook" | "instagram"> =>
            platform === "facebook" || platform === "instagram",
        );
      setRetryChannels(uncertainChannels);
      const publishChannelResults = Object.entries(result.results)
        .filter(([platform]) => platform === "facebook" || platform === "instagram")
        .map(([platform, value]) => ({
          channel: platform as MetaChannel,
          status: value.status,
          url: value.url,
          reason: value.reason,
        }));
      setPublishChannelResults(publishChannelResults);
      const channelResults = Object.values(result.results);
      const publishedCount = channelResults.filter(
        (value) => value.status === "published",
      ).length;
      setPublishOutcome(
        uncertainChannels.length > 0
          ? "uncertain"
          : channelResults.length > 0 && publishedCount === channelResults.length
            ? "success"
            : publishedCount > 0
              ? "partial"
              : "failed",
      );
      setPublishMessage(
        publishChannelResults.length === 0
          ? result.post.error || "لم يُرجع الخادم تفاصيل عن نتيجة النشر."
          : null,
      );
    } catch (error) {
      setPublishOutcome("failed");
      setPublishChannelResults([]);
      setPublishMessage(
        error instanceof Error
          ? error.message
          : "تعذر النشر. تحقق من اتصال Meta وصلاحيات النشر.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const onAnalyzeHistory = async () => {
    setProcessingHistory(true);
    try {
      const result = await analyzeWhatsAppBacklog();
      Alert.alert(
        "اكتمل تحليل الرسائل",
        `تم فحص ${result.scanned} رسالة؛ أُنشئت ${result.created} للمراجعة، وتجاوز ${result.skipped}.`,
      );
    } catch (error) {
      Alert.alert(
        "تعذر تحليل الرسائل",
        error instanceof Error
          ? error.message
          : "تحقق من اتصال واتساب والخادم.",
      );
    } finally {
      setProcessingHistory(false);
    }
  };

  const onAutoPublishChange = async (enabled: boolean) => {
    if (enabled && autoPublishChannels.length === 0) {
      setAutoPublishError(
        "اختر منصة مرتبطة واحدة على الأقل قبل تفعيل النشر التلقائي.",
      );
      return;
    }
    const approvedCount = posts.filter((post) => post.status === "approved").length;
    if (enabled && approvedCount > 0) {
      Alert.alert(
        "تفعيل النشر التلقائي؟",
        `سيتم إرسال ${approvedCount} منشوراً معتمداً إلى ${autoPublishChannels.map(platformLabel).join(" و")} الآن.`,
        [
          { text: "إلغاء", style: "cancel" },
          {
            text: "تفعيل والنشر",
            onPress: () => void persistAutoPublishChange(enabled),
          },
        ],
      );
      return;
    }
    await persistAutoPublishChange(enabled);
  };

  const persistAutoPublishChange = async (enabled: boolean) => {
    const saved = await saveAutoPublish(enabled, autoPublishChannels);
    if (saved) {
      setAutoPublish(enabled);
      const report = saved.initialPublish;
      if (enabled && report) {
        Alert.alert(
          "نتيجة النشر التلقائي",
          report.processed > 0
            ? `تمت معالجة ${report.processed} منشورًا معتمدًا للنشر التلقائي. نُشر ${report.published} بنجاح، وفشل ${report.failed}.`
            : "لا توجد منشورات معتمدة للنشر التلقائي الآن.",
        );
      }
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
      <PageTitle
        title="المحتوى"
        subtitle="أنشئ المسودات وراجعها وقم بالتسويق والنشر على المنصات المختارة."
        action={
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/compose")}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Icon name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        }
      />

      <Panel>
        <View style={styles.autoToggleRow}>
          <Text style={[styles.autoLabel, { color: colors.foreground }]}>
            النشر التلقائي
          </Text>
          <Switch
            value={autoPublish}
            disabled={!connectionsLoaded || connectedChannels.length === 0}
            onValueChange={(value) => void onAutoPublishChange(value)}
          />
        </View>
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
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: selected
                      ? colors.primary
                      : colors.secondary,
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
        {connectionLoadError ? (
          <View style={styles.connectionLoadError}>
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
              style={[
                styles.historyButton,
                {
                  backgroundColor: colors.secondary,
                  opacity: connectionsQuery.isFetching ? 0.6 : 1,
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
        <Pressable
          accessibilityRole="button"
          disabled={processingHistory}
          onPress={() => void onAnalyzeHistory()}
          style={[styles.historyButton, { backgroundColor: colors.secondary }]}
        >
          <Text style={[styles.filterLabel, { color: colors.foreground }]}>
            {processingHistory
              ? "جارٍ تحليل الرسائل القديمة…"
              : "تحليل رسائل واتساب القديمة"}
          </Text>
        </Pressable>
        <SectionTitle title="مساحة النشر وإدارة المنشورات" />
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          الرسائل والوسائط المزامنة تُحوّل إلى منشورات متاحة للمراجعة والنشر
          اليدوي أو التلقائي.
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
            { key: "review" as const, label: "بانتظار المراجعة" },
            { key: "approved" as const, label: "معتمد للنشر التلقائي" },
            { key: "scheduled" as const, label: "بانتظار النشر" },
            { key: "published" as const, label: "تم النشر" },
            { key: "publishing" as const, label: "قيد الإرسال" },
            { key: "failed" as const, label: "فشل النشر" },
          ].map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === item.key }}
              onPress={() => setFilter(item.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    filter === item.key ? colors.primary : colors.secondary,
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
        <View style={[styles.searchRow, { borderColor: colors.border }]}>
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
            >
              <Icon name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          {[
            { value: "all" as const, label: "كل المنصات" },
            { value: "facebook" as const, label: "فيسبوك" },
            { value: "instagram" as const, label: "إنستغرام" },
          ].map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected: platformFilter === item.value }}
              onPress={() => setPlatformFilter(item.value)}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    platformFilter === item.value
                      ? colors.primary
                      : colors.secondary,
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
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    dateFilter === item.value
                      ? colors.primary
                      : colors.secondary,
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
        <View style={styles.resultsSummary}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            المنشورات المطابقة المحمّلة: {visiblePosts.length}
          </Text>
          {hasActiveFilters ? (
            <Pressable
              accessibilityRole="button"
              onPress={clearContentFilters}
            >
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
          const channelsToRetry = selectedPublishChannels.includes(failedChannel)
            ? selectedPublishChannels
            : [failedChannel];
          void publishAndShowResult(publishDialogPostId, channelsToRetry);
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
    </Page>
  );
}
