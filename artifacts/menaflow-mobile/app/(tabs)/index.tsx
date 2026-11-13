import { router, type Href } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { CairoText as Text } from "@/components/CairoTypography";
import {
  LucideIcon as Icon,
  type LucideIconName,
} from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { useStudio, type Post } from "@/context/StudioContext";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
  StatusPill,
} from "@/components/Ui";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { isLocalAuthDisabled } from "@/constants/auth";
import { formatArabicDate, formatArabicDateTime } from "@/lib/formatting";
import {
  getActivityPostMeta,
  getActivityPostStatusLabel,
  getActivityPostStatusTone,
  getActivityPostTitle,
} from "@/lib/activity-formatting";
import { getMetaInbox, metaInboxPersonId } from "@/lib/meta-inbox-api";
import { getOrderSummary } from "@/lib/orders-api";
import { getProductCatalog } from "@/lib/product-catalog-api";
import { mediaUrlForApp, postMediaType } from "@/lib/content-utils";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";

export default function HomeScreen() {
  if (isLocalAuthDisabled) return <HomeScreenContent userId={null} />;
  return <AuthenticatedHomeScreen />;
}

function AuthenticatedHomeScreen() {
  const { userId } = useAuth();
  return <HomeScreenContent userId={userId ?? null} />;
}

function postThumbnailUrl(post: Post): string | null {
  const mediaIndex = (post.mediaUrls ?? []).findIndex(
    (mediaUrl) => postMediaType(post, mediaUrl) === "image",
  );
  return mediaIndex < 0
    ? null
    : post.mediaPreviewUrls?.[mediaIndex] ?? post.mediaUrls?.[mediaIndex] ?? null;
}

function ActivityMediaThumbnail({ uri }: { uri: string }) {
  const colors = useColors();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const resolvedUri = mediaUrlForApp(uri);
  if (failedUri === resolvedUri) {
    return (
      <View
        style={[
          styles.activityThumbnailFallback,
          { backgroundColor: colors.secondary },
        ]}
      >
        <Icon name="image" size={18} color={colors.mutedForeground} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: resolvedUri }}
      style={styles.activityThumbnail}
      contentFit="cover"
      cachePolicy="disk"
      accessibilityLabel="صورة مصغرة لوسائط النشاط"
      onError={() => setFailedUri(resolvedUri)}
    />
  );
}

function HomeScreenContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { posts, refreshPosts, syncing, ready, storageError } = useStudio();
  const [refreshing, setRefreshing] = useState(false);
  const [retryingHeroConnections, setRetryingHeroConnections] = useState(false);
  const [retryingConnectionsFor, setRetryingConnectionsFor] = useState<
    Partial<Record<"facebook" | "instagram" | "whatsapp", boolean>>
  >({});
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 1024;

  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
  });
  const connections = connectionsQuery.data;

  const inboxQuery = useQuery({
    queryKey: ["meta-inbox", userId ?? "local"],
    queryFn: () => getMetaInbox(),
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const catalogQuery = useQuery({
    queryKey: ["product-catalog", userId ?? "local"],
    queryFn: () => getProductCatalog(false),
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const orderSummaryQuery = useQuery({
    queryKey: ["order-summary", userId ?? "local"],
    queryFn: getOrderSummary,
    enabled: isLocalAuthDisabled || Boolean(userId),
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const conversationCount = inboxQuery.data
    ? new Set(
        inboxQuery.data.items.map(
          (item) => `${item.platform}:person:${metaInboxPersonId(item)}`,
        ),
      ).size
    : null;
  const activeProductCount = catalogQuery.data
    ? catalogQuery.data.filter((product) => product.status === "active").length
    : null;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshPosts(),
        connectionsQuery.refetch(),
        inboxQuery.refetch(),
        catalogQuery.refetch(),
        orderSummaryQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const retryConnections = async (
    platform: "facebook" | "instagram" | "whatsapp",
  ) => {
    setRetryingConnectionsFor((current) => ({ ...current, [platform]: true }));
    try {
      await connectionsQuery.refetch();
    } finally {
      setRetryingConnectionsFor((current) => ({
        ...current,
        [platform]: false,
      }));
    }
  };

  const channelsData = [
    {
      platform: "instagram" as const,
      name: "إنستغرام",
      accountName: connections?.instagram?.accountName
        ? `@${connections.instagram.accountName}`
        : null,
      connected: connections?.instagram?.authorizationStatus === "ready",
      needsReauthorization:
        connections?.instagram?.authorizationStatus === "needs_reauthorization",
      needsReconnection: false,
      isConnecting: false,
      isUnavailable: false,
    },
    {
      platform: "facebook" as const,
      name: "فيسبوك",
      accountName: connections?.facebook?.accountName || null,
      connected: connections?.facebook?.authorizationStatus === "ready",
      needsReauthorization:
        connections?.facebook?.authorizationStatus === "needs_reauthorization",
      needsReconnection: false,
      isConnecting: false,
      isUnavailable: false,
    },
    {
      platform: "whatsapp" as const,
      name: "واتساب",
      accountName: connections?.whatsapp?.accountName || null,
      connected: connections?.whatsapp?.connectionState === "connected",
      needsReauthorization: false,
      needsReconnection: Boolean(
        connections?.whatsapp &&
        connections.whatsapp.connectionState !== "connected" &&
        connections.whatsapp.connectionState !== "connecting" &&
        connections.whatsapp.connectionState !== "unavailable",
      ),
      isConnecting: connections?.whatsapp?.connectionState === "connecting",
      isUnavailable: connections?.whatsapp?.connectionState === "unavailable",
    },
  ];
  const connectionsUnavailable =
    connectionsQuery.isError ||
    (connectionsQuery.isFetched &&
      connectionsQuery.isFetching &&
      !connectionsQuery.data);
  const hasAnyConnection =
    !connectionsUnavailable &&
    channelsData.some((channel) => channel.connected);
  const connectionsLoading =
    connectionsQuery.isPending && !connectionsQuery.isFetched;
  const whatsappUnavailable = channelsData.some(
    (channel) => channel.isUnavailable,
  );
  const accountNeedingReauthorization = channelsData.find(
    (channel) => channel.needsReauthorization,
  );
  const whatsappConnecting = channelsData.some(
    (channel) => channel.platform === "whatsapp" && channel.isConnecting,
  );
  const whatsappNeedsReconnection = channelsData.some(
    (channel) => channel.platform === "whatsapp" && channel.needsReconnection,
  );
  const pendingPost =
    posts.find((post) => post.status === "failed") ??
    posts.find((post) => post.status === "review") ??
    posts.find((post) => post.status === "draft");
  const recentActivities = [
    ...posts.map((post) => ({
      type: "post" as const,
      id: post.id,
      timestamp: post.updatedAt ?? post.createdAt,
      post,
    })),
    ...(catalogQuery.data ?? []).map((product) => ({
      type: "product" as const,
      id: product.id,
      timestamp: product.createdAt,
      product,
    })),
    ...(inboxQuery.data?.items ?? []).map((item) => ({
      type: "inbox" as const,
      id: item.id,
      timestamp: item.occurredAt,
      item,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 4);

  const openPublishing = () =>
    router.push({
      pathname: "/(tabs)/more/sources",
      params: { view: "publishing" },
    });
  const openReconnect = (
    platform: "facebook" | "instagram" | "whatsapp",
    reconnect = false,
  ) =>
    router.push({
      pathname: "/(tabs)/more/sources",
      params: {
        connect: platform,
        ...(reconnect ? { reconnect: "true" } : {}),
      },
    });
  const createContent = () => router.push("/compose");

  let heroEyebrow = "خطوتك التالية";
  let heroTitle = "تابع محتواك";
  let heroBody = "حساباتك متصلة. أنشئ محتوى جديدًا وابدأ النشر.";
  let heroPrimary: {
    label: string;
    icon: LucideIconName;
    onPress: () => void;
    disabled: boolean;
  } = {
    label: "إنشاء محتوى",
    icon: "plus" as const,
    onPress: createContent,
    disabled: false,
  };
  if (connectionsLoading) {
    heroEyebrow = "جارٍ التحقق";
    heroTitle = "نجهز مساحة عملك";
    heroBody = "نتحقق من حالة حساباتك.";
  } else if (connectionsUnavailable) {
    heroEyebrow = "حالة الحسابات";
    heroTitle = "تعذر التحقق";
    heroBody = "تحقق من الإنترنت ثم أعد المحاولة.";
    heroPrimary = {
      label: retryingHeroConnections ? "جارٍ التحقق…" : "إعادة المحاولة",
      icon: "refresh-cw",
      onPress: () => {
        setRetryingHeroConnections(true);
        void connectionsQuery.refetch().finally(() => {
          setRetryingHeroConnections(false);
        });
      },
      disabled: retryingHeroConnections || connectionsQuery.isFetching,
    };
  } else if (accountNeedingReauthorization) {
    heroEyebrow = "إجراء مطلوب";
    heroTitle = `أعد تفويض حساب ${accountNeedingReauthorization.name}`;
    heroBody = "أعد التفويض لاستعادة النشر والتحقق من صلاحيات الحساب.";
    heroPrimary = {
      label: "إعادة التفويض",
      icon: "refresh-cw",
      onPress: () =>
        openReconnect(accountNeedingReauthorization.platform, true),
      disabled: false,
    };
  } else if (whatsappConnecting) {
    heroEyebrow = "جارٍ الاتصال";
    heroTitle = "واتساب قيد الاتصال";
    heroBody = "جارٍ استعادة الاتصال بواتساب.";
    heroPrimary = {
      label: "متابعة إعداد واتساب",
      icon: "link-2",
      onPress: openPublishing,
      disabled: false,
    };
  } else if (whatsappUnavailable || whatsappNeedsReconnection) {
    heroEyebrow = whatsappUnavailable ? "واتساب غير متاح" : "إجراء مطلوب";
    heroTitle = whatsappUnavailable
      ? "تعذر الوصول إلى خدمة واتساب"
      : "أعد اتصال واتساب";
    heroBody = whatsappUnavailable
      ? "تحقق من إعدادات واتساب."
      : "أعد اتصال واتساب لمتابعة النشر.";
    heroPrimary = {
      label: whatsappUnavailable ? "إدارة واتساب" : "إعادة الاتصال",
      icon: whatsappUnavailable ? "settings" : "refresh-cw",
      onPress: whatsappUnavailable
        ? openPublishing
        : () => openReconnect("whatsapp", true),
      disabled: false,
    };
  } else if (!hasAnyConnection) {
    heroEyebrow = "ابدأ من هنا";
    heroTitle = "اربط حسابًا للنشر";
    heroBody = "اربط حسابًا لتبدأ النشر من لوحة التحكم.";
    heroPrimary = {
      label: "ربط حساب",
      icon: "link-2",
      onPress: openPublishing,
      disabled: false,
    };
  } else if (!ready) {
    heroEyebrow = "حساباتك متصلة";
    heroTitle = "جارٍ تحميل محتواك";
    heroBody = "نحمّل بيانات مساحة العمل.";
  } else if (posts.length === 0) {
    heroEyebrow = "حساباتك جاهزة";
    heroTitle = "أنشئ أول منشور";
    heroBody = "ابدأ بكتابة محتواك الأول.";
    heroPrimary = {
      label: "إنشاء أول منشور",
      icon: "plus",
      onPress: createContent,
      disabled: false,
    };
  } else if (pendingPost) {
    const pendingPostLabel =
      pendingPost.status === "failed"
        ? "منشور تعذّر نشره"
        : pendingPost.status === "review"
          ? "منشور بانتظار المراجعة"
          : "لديك مسودة للمتابعة";
    heroEyebrow = "متابعة المحتوى";
    heroTitle = pendingPostLabel;
    heroBody =
      pendingPost.status === "failed"
        ? "راجع تفاصيل المنشور لمعرفة سبب تعذر النشر."
        : pendingPost.status === "review"
          ? "أكمل مراجعة المنشور قبل نشره."
          : "تابع تحرير المسودة.";
    heroPrimary = {
      label:
        pendingPost.status === "failed"
          ? "مراجعة المنشور"
          : pendingPost.status === "review"
            ? "مراجعة المنشورات"
            : "متابعة المسودات",
      icon: "file-text",
      onPress: () =>
        router.push({
          pathname: "/(tabs)/content",
          params: { status: pendingPost.status },
        }),
      disabled: false,
    };
  } else {
    heroEyebrow = "مساحة عملك";
    heroTitle = "حساباتك جاهزة للنشر";
    heroBody = "حساباتك متصلة وجاهزة للنشر.";
  }

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={refreshing || syncing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
      contentMaxWidth={1280}
    >
      <BrandHeader showBell />
      {orderSummaryQuery.data?.metaDrafts ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${orderSummaryQuery.data.metaDrafts} مسودة طلب من محادثات Meta بانتظار المراجعة. افتح الطلبات.`}
          onPress={() => router.push("/(tabs)/more/orders")}
          style={({ pressed }) => [
            styles.orderNotification,
            {
              backgroundColor: colors.accent,
              borderColor: colors.primary,
              opacity: pressed ? 0.78 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.orderNotificationIcon,
              { backgroundColor: colors.card },
            ]}
          >
            <Icon name="shopping-bag" size={18} color={colors.primary} />
          </View>
          <View style={styles.orderNotificationCopy}>
            <Text
              style={[
                styles.orderNotificationTitle,
                { color: colors.foreground },
              ]}
            >
              طلبات جديدة بانتظار المراجعة
            </Text>
            <Text
              style={[
                styles.orderNotificationText,
                { color: colors.mutedForeground },
              ]}
            >
              {orderSummaryQuery.data.metaDrafts} مسودة من محادثات Meta. راجع
              التفاصيل وأكّد الطلبات من صفحة الطلبات.
            </Text>
          </View>
          <Icon name="chevron-left" size={18} color={colors.primary} />
        </Pressable>
      ) : null}
      {orderSummaryQuery.data?.whatsappDrafts ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${orderSummaryQuery.data.whatsappDrafts} مسودة طلب من محادثات WhatsApp بانتظار المراجعة. افتح الطلبات.`}
          onPress={() => router.push("/(tabs)/more/orders")}
          style={({ pressed }) => [
            styles.orderNotification,
            {
              backgroundColor: colors.greenSoft,
              borderColor: colors.whatsapp,
              opacity: pressed ? 0.78 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.orderNotificationIcon,
              { backgroundColor: colors.card },
            ]}
          >
            <Icon name="whatsapp" size={18} color={colors.whatsapp} />
          </View>
          <View style={styles.orderNotificationCopy}>
            <Text
              style={[
                styles.orderNotificationTitle,
                { color: colors.foreground },
              ]}
            >
              طلبات WhatsApp بانتظار المراجعة
            </Text>
            <Text
              style={[
                styles.orderNotificationText,
                { color: colors.mutedForeground },
              ]}
            >
              {orderSummaryQuery.data.whatsappDrafts} مسودة. راجع البيانات وأكّد
              الطلب قبل إرسال تأكيد WhatsApp.
            </Text>
          </View>
          <Icon name="chevron-left" size={18} color={colors.whatsapp} />
        </Pressable>
      ) : null}
      <View
        style={[
          styles.hero,
          width < 420 && styles.heroPhone,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.heroContent,
            width < 420 && styles.heroContentPhone,
            width < 360 && styles.heroContentCompact,
          ]}
        >
          <View style={styles.heroText}>
            {width >= 420 ? (
              <Text style={[styles.heroEyebrow, { color: colors.primary }]}>
                {heroEyebrow}
              </Text>
            ) : null}
            <Text
              style={[
                styles.heroTitle,
                width >= 360 && width < 420 && styles.heroTitlePhone,
                width < 360 && styles.heroTitleCompact,
                { color: colors.foreground },
              ]}
            >
              {heroTitle}
            </Text>
            <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
              {heroBody}
            </Text>
          </View>
          <ActionButton
            label={heroPrimary.label}
            icon={heroPrimary.icon}
            onPress={heroPrimary.onPress}
            disabled={heroPrimary.disabled}
            compact={width < 420}
          />
        </View>
      </View>

      <View style={styles.metricsRow}>
        {[
          {
            label: "المحادثات",
            description: inboxQuery.isError
              ? "تعذر تحميل البيانات"
              : "من الوارد المتاح",
            icon: "message-circle" as const,
            value:
              conversationCount === null
                ? inboxQuery.isError
                  ? "—"
                  : "…"
                : conversationCount,
            href: "/(tabs)/inbox" as const,
            disabled: false,
          },
          {
            label: "المنشورات",
            description: ready ? "ضمن المحتوى المتاح" : "جارٍ تحميل المحتوى",
            icon: "file-text" as const,
            value: ready ? posts.length : "…",
            href: "/(tabs)/content" as const,
            disabled: false,
          },
          {
            label: "منتجات فعّالة",
            description: catalogQuery.isError
              ? "تعذر تحميل البيانات"
              : catalogQuery.data
                ? `من أصل ${catalogQuery.data.length} منتج`
                : "جارٍ تحميل البيانات",
            icon: "package" as const,
            value:
              activeProductCount === null
                ? catalogQuery.isError
                  ? "—"
                  : "…"
                : activeProductCount,
            href: "/(tabs)/products" as const,
            disabled: false,
          },
          {
            label: "الطلبات",
            description: orderSummaryQuery.isError
              ? "تعذّر تحميل ملخص الطلبات"
              : orderSummaryQuery.data
                ? `${orderSummaryQuery.data.draft + orderSummaryQuery.data.confirmed + orderSummaryQuery.data.preparing} بحاجة إلى متابعة`
                : "جارٍ تحميل الطلبات",
            icon: "shopping-bag" as const,
            value: orderSummaryQuery.isLoading
              ? "…"
              : orderSummaryQuery.isError
                ? "—"
                : (orderSummaryQuery.data?.total ?? 0),
            href: "/(tabs)/more/orders" as const,
            disabled: false,
          },
        ].map((metric) => (
          <Pressable
            key={metric.label}
            accessibilityRole="button"
            accessibilityLabel={`${metric.label}: ${metric.value}. ${metric.description}`}
            accessibilityState={{ disabled: metric.disabled }}
            disabled={metric.disabled}
            onPress={() => {
              if (metric.href) router.push(metric.href);
            }}
            style={({ pressed }) => [
              styles.metricPressable,
              width >= 520 && styles.metricPressableWide,
              { opacity: pressed && !metric.disabled ? 0.78 : 1 },
            ]}
          >
            <View
              style={[
                styles.metricCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[styles.metricIcon, { backgroundColor: colors.accent }]}
              >
                <Icon name={metric.icon} size={17} color={colors.primary} />
              </View>
              <Text style={[styles.metricNumber, { color: colors.foreground }]}>
                {metric.value}
              </Text>
              <View style={styles.metricCopy}>
                <Text
                  style={[styles.metricLabel, { color: colors.foreground }]}
                >
                  {metric.label}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.metricDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {metric.description}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      <View
        style={[
          styles.contentGrid,
          width < 480 && styles.contentGridPhone,
          isWideScreen && styles.contentGridWide,
        ]}
      >
        <View
          style={[
            styles.contentColumn,
            isWideScreen && styles.contentColumnWide,
          ]}
        >
          <Panel>
            <View style={styles.channelHeading}>
              <SectionTitle
                title="حساباتك الاجتماعية"
                action={
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/more/sources",
                        params: { view: "publishing" },
                      })
                    }
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={[styles.link, { color: colors.primary }]}>
                      إدارة حسابات النشر
                    </Text>
                  </Pressable>
                }
              />
              <Text
                style={[
                  styles.channelSectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                حالة ربط منصاتك في لمحة واحدة
              </Text>
            </View>
            <View
              style={[styles.channelRow, width < 480 && styles.channelRowPhone]}
            >
              {channelsData.map((channel) => {
                const isRetrying =
                  retryingConnectionsFor[channel.platform] === true;
                const status = connectionsLoading
                  ? {
                      label: "جارٍ التحقق",
                      icon: "clock" as const,
                      color: colors.mutedForeground,
                      background: colors.secondary,
                    }
                  : connectionsUnavailable
                    ? {
                        label: isRetrying ? "جارٍ التحقق" : "إعادة المحاولة",
                        icon: isRetrying
                          ? ("clock" as const)
                          : ("refresh-cw" as const),
                        color: colors.blue,
                        background: colors.blueSoft,
                      }
                    : channel.isConnecting
                      ? {
                          label: "جارٍ الاتصال",
                          icon: "clock" as const,
                          color: colors.primary,
                          background: colors.accent,
                        }
                      : channel.isUnavailable
                        ? {
                            label: "الخدمة غير متاحة",
                            icon: "alert-circle" as const,
                            color: colors.warning,
                            background: colors.secondary,
                          }
                        : channel.connected
                          ? {
                              label: "متصل",
                              icon: "check-circle" as const,
                              color: colors.green,
                              background: colors.accent,
                            }
                          : channel.needsReauthorization
                            ? {
                                label: "أعد التفويض",
                                icon: "refresh-cw" as const,
                                color: colors.warning,
                                background: colors.secondary,
                              }
                            : channel.needsReconnection
                              ? {
                                  label: "أعد الاتصال",
                                  icon: "link-2" as const,
                                  color: colors.primary,
                                  background: colors.accent,
                                }
                              : {
                                  label: "ربط الحساب",
                                  icon: "plus" as const,
                                  color: colors.primary,
                                  background: colors.accent,
                                };

                return (
                  <Pressable
                    key={channel.name}
                    accessibilityRole="button"
                    accessibilityHint={
                      connectionsUnavailable
                        ? "اضغط لإعادة التحقق من حالة هذا الحساب"
                        : undefined
                    }
                    accessibilityLabel={
                      connectionsLoading
                        ? `جارٍ التحقق من حالة حساب ${channel.name}`
                        : connectionsUnavailable
                          ? retryingConnectionsFor[channel.platform]
                            ? `جارٍ إعادة التحقق من حساب ${channel.name}`
                            : `تعذر التحقق من حساب ${channel.name}. إعادة المحاولة`
                          : channel.connected
                            ? `حساب ${channel.name} متصل${channel.accountName ? `: ${channel.accountName}` : ""}. عرض التفاصيل`
                            : channel.needsReauthorization
                              ? `إعادة تفويض حساب ${channel.name}`
                              : channel.isConnecting
                                ? `جارٍ الاتصال بحساب ${channel.name}`
                                : channel.isUnavailable
                                  ? "فتح إعدادات واتساب"
                                  : channel.needsReconnection
                                    ? `إعادة اتصال حساب ${channel.name}`
                                    : `ربط حساب ${channel.name}`
                    }
                    accessibilityState={{
                      disabled: connectionsLoading || isRetrying,
                      busy:
                        connectionsLoading ||
                        retryingConnectionsFor[channel.platform] === true,
                    }}
                    disabled={connectionsLoading || isRetrying}
                    onPress={() => {
                      if (connectionsUnavailable) {
                        void retryConnections(channel.platform);
                        return;
                      }
                      if (channel.platform === "whatsapp") {
                        router.push({
                          pathname: "/(tabs)/more/sources",
                          params: { view: "publishing" },
                        });
                        return;
                      }
                      if (channel.connected) {
                        router.push({
                          pathname: "/account/[platform]",
                          params: { platform: channel.platform },
                        });
                        return;
                      }
                      router.push({
                        pathname: "/(tabs)/more/sources",
                        ...(channel.isConnecting || channel.isUnavailable
                          ? {}
                          : {
                              params: {
                                connect: channel.platform,
                                ...(channel.needsReauthorization
                                  ? { reconnect: "true" }
                                  : {}),
                              },
                            }),
                      });
                    }}
                    style={({ pressed }) => [
                      styles.channelTile,
                      width < 480 && styles.channelTilePhone,
                      {
                        borderColor: connectionsUnavailable
                          ? colors.blue
                          : channel.needsReauthorization ||
                              channel.isUnavailable
                            ? colors.warning
                            : channel.connected
                              ? colors.greenSoft
                              : colors.border,
                        backgroundColor: colors.card,
                        opacity: pressed ? 0.82 : 1,
                        transform: [{ scale: pressed ? 0.99 : 1 }],
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.channelIdentity,
                        width < 480 && styles.channelIdentityPhone,
                      ]}
                    >
                      <View style={styles.channelIdentityTitle}>
                        <SocialPlatformIcon
                          platform={channel.platform}
                          size={24}
                        />
                        <Text
                          style={[
                            styles.channelName,
                            { color: colors.foreground },
                          ]}
                        >
                          {channel.name}
                        </Text>
                      </View>
                      {channel.connected && channel.accountName ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.channelAccount,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {channel.accountName}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.channelDetails,
                        width < 480 && styles.channelDetailsPhone,
                        { backgroundColor: status.background },
                      ]}
                    >
                      <Icon name={status.icon} size={13} color={status.color} />
                      <Text
                        numberOfLines={1}
                        style={[styles.channelState, { color: status.color }]}
                      >
                        {status.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {connectionsUnavailable ? (
              <View
                style={[
                  styles.channelHint,
                  { backgroundColor: colors.blueSoft },
                ]}
              >
                <Icon name="info" size={16} color={colors.blue} />
                <Text style={[styles.channelHintText, { color: colors.blue }]}>
                  تحقق من اتصال الإنترنت، ثم أعد المحاولة.
                </Text>
              </View>
            ) : whatsappUnavailable ? (
              <View
                style={[
                  styles.channelHint,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Icon name="alert-circle" size={16} color={colors.warning} />
                <Text
                  style={[
                    styles.channelHintText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  راجع إعدادات واتساب من إدارة حسابات النشر.
                </Text>
              </View>
            ) : null}
          </Panel>
        </View>

        <View
          style={[
            styles.contentColumn,
            isWideScreen && styles.contentColumnWide,
          ]}
        >
          <Panel>
            <SectionTitle
              title="أحدث الأنشطة"
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/activities" as Href)}
                >
                  <Text style={[styles.link, { color: colors.primary }]}>
                    عرض الكل
                  </Text>
                </Pressable>
              }
            />
            {inboxQuery.isError || catalogQuery.isError ? (
              <View style={styles.activityError}>
                <Text
                  style={[
                    styles.activityErrorText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  تعذّر تحميل {inboxQuery.isError ? "الرسائل والتعليقات" : null}
                  {inboxQuery.isError && catalogQuery.isError ? " و" : null}
                  {catalogQuery.isError ? "المنتجات" : null}. قد تظهر الأنشطة
                  جزئيًا.
                </Text>
                <ActionButton
                  label="إعادة المحاولة"
                  icon="refresh-cw"
                  secondary
                  compact
                  disabled={
                    (inboxQuery.isError && inboxQuery.isFetching) ||
                    (catalogQuery.isError && catalogQuery.isFetching)
                  }
                  onPress={() => {
                    void Promise.all([
                      inboxQuery.isError ? inboxQuery.refetch() : undefined,
                      catalogQuery.isError ? catalogQuery.refetch() : undefined,
                    ]);
                  }}
                />
              </View>
            ) : null}
            {!ready ? (
              <EmptyState
                icon={storageError ? "alert-circle" : "clock"}
                title={storageError ? "محتواك غير جاهز" : "جارٍ تحميل المحتوى"}
                body={
                  storageError || "نحمّل بيانات مساحة العمل قبل عرض المنشورات."
                }
              />
            ) : recentActivities.length === 0 &&
              ((catalogQuery.isPending && !catalogQuery.isFetched) ||
                (inboxQuery.isPending && !inboxQuery.isFetched)) ? (
              <EmptyState
                icon="clock"
                title="جارٍ تحميل الأنشطة"
                body="نحمّل أحدث الرسائل والمنشورات والمنتجات في مساحة العمل."
              />
            ) : recentActivities.length === 0 ? (
              <EmptyState
                icon={
                  catalogQuery.isError || inboxQuery.isError
                    ? "alert-circle"
                    : "bell"
                }
                title={
                  catalogQuery.isError || inboxQuery.isError
                    ? "تعذر تحميل الأنشطة"
                    : "لا توجد أنشطة بعد"
                }
                body={
                  catalogQuery.isError || inboxQuery.isError
                    ? "تعذر تحميل بعض الأنشطة. اسحب للأسفل لإعادة المحاولة."
                    : "ستظهر هنا أحدث الرسائل والتعليقات والمنتجات والمنشورات في مساحة عملك."
                }
              />
            ) : (
              <View style={styles.activityList}>
                {recentActivities.map((activity) => {
                  if (activity.type === "inbox") {
                    const media = activity.item.media.find(
                      (item) =>
                        item.thumbnailUrl ||
                        (item.type === "image" && item.url),
                    );
                    const thumbnailUrl = media?.thumbnailUrl ?? media?.url;
                    const label =
                      activity.item.kind === "comment"
                        ? "تعليق جديد"
                        : "رسالة جديدة";
                    const platformLabel =
                      activity.item.platform === "facebook"
                        ? "فيسبوك"
                        : "إنستغرام";
                    const actorName = activity.item.actorName || "اسم غير متاح";
                    const itemDate = formatArabicDateTime(
                      activity.item.occurredAt,
                    );
                    return (
                      <Pressable
                        key={`inbox-${activity.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${label} من ${actorName} على ${platformLabel}`}
                        accessibilityHint="فتح المحادثة المرتبطة بهذا النشاط"
                        onPress={() =>
                          router.push({
                            pathname: "/inbox/[conversationId]",
                            params: {
                              conversationId: metaInboxPersonId(activity.item),
                              platform: activity.item.platform,
                            },
                          })
                        }
                        style={({ pressed }) => [
                          styles.activityRow,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                            opacity: pressed ? 0.72 : 1,
                          },
                        ]}
                      >
                        {thumbnailUrl ? (
                          <ActivityMediaThumbnail uri={thumbnailUrl} />
                        ) : (
                          <View
                            style={[
                              styles.activityIcon,
                              { backgroundColor: colors.blueSoft },
                            ]}
                          >
                            <Icon
                              name={
                                activity.item.kind === "comment"
                                  ? "message-circle"
                                  : "message-square"
                              }
                              size={19}
                              color={colors.blue}
                            />
                          </View>
                        )}
                        <View style={styles.activityCopy}>
                          <View style={styles.activityTopline}>
                            <StatusPill
                              style={styles.activityStatus}
                              label={label}
                              tone="blue"
                            />
                            {itemDate ? (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.activityDate,
                                  { color: colors.mutedForeground },
                                ]}
                              >
                                {itemDate}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.activityTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {actorName}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.activityDescription,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {activity.item.text || "عنصر بدون نص"}
                          </Text>
                          <View style={styles.activityPlatform}>
                            <SocialPlatformIcon
                              platform={activity.item.platform}
                              size={14}
                            />
                            <Text
                              style={[
                                styles.activityDate,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              {platformLabel}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  }

                  if (activity.type === "product") {
                    const thumbnailUrl = activity.product.mediaPreviews.find(
                      (media) => media.mediaType === "image",
                    )?.url;
                    const productDate = formatArabicDateTime(
                      activity.product.createdAt,
                    );
                    return (
                      <Pressable
                        key={`product-${activity.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`تمت إضافة المنتج: ${activity.product.name}`}
                        accessibilityHint="عرض كتالوج المنتجات"
                        onPress={() => router.push("/(tabs)/products")}
                        style={({ pressed }) => [
                          styles.activityRow,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                            opacity: pressed ? 0.72 : 1,
                          },
                        ]}
                      >
                        {thumbnailUrl ? (
                          <ActivityMediaThumbnail uri={thumbnailUrl} />
                        ) : (
                          <View
                            style={[
                              styles.activityIcon,
                              { backgroundColor: colors.greenSoft },
                            ]}
                          >
                            <Icon name="package" size={19} color={colors.green} />
                          </View>
                        )}
                        <View style={styles.activityCopy}>
                          <View style={styles.activityTopline}>
                            <StatusPill
                              style={styles.activityStatus}
                              label="منتج جديد"
                              tone="green"
                            />
                            {productDate ? (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.activityDate,
                                  { color: colors.mutedForeground },
                                ]}
                              >
                                {productDate}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.activityTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {activity.product.name}
                          </Text>
                          <Text
                            style={[
                              styles.activityDescription,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            أُضيف إلى كتالوج المنتجات
                          </Text>
                        </View>
                      </Pressable>
                    );
                  }

                  const { post } = activity;
                  const displayTitle = getActivityPostTitle(post);
                  const statusLabel = getActivityPostStatusLabel(post);
                  const statusTone = getActivityPostStatusTone(post);
                  const statusColor =
                    statusTone === "green"
                      ? colors.green
                      : statusTone === "amber"
                        ? colors.warning
                        : statusTone === "blue"
                          ? colors.blue
                          : colors.mutedForeground;
                  const statusBackground =
                    statusTone === "green"
                      ? colors.greenSoft
                      : statusTone === "blue"
                        ? colors.blueSoft
                        : colors.secondary;
                  const thumbnailUrl = postThumbnailUrl(post);
                  return (
                    <Pressable
                      key={post.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${statusLabel}: ${displayTitle}`}
                      accessibilityHint="عرض المحتوى المرتبط بهذا النشاط"
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/content",
                          params: { status: post.status },
                        })
                      }
                      style={({ pressed }) => [
                        styles.activityRow,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      {thumbnailUrl ? (
                        <ActivityMediaThumbnail uri={thumbnailUrl} />
                      ) : (
                        <View
                          style={[
                            styles.activityIcon,
                            { backgroundColor: statusBackground },
                          ]}
                        >
                          <Icon name="file-text" size={19} color={statusColor} />
                        </View>
                      )}
                      <View style={styles.activityCopy}>
                        <View style={styles.activityTopline}>
                          <StatusPill
                            style={styles.activityStatus}
                            label={statusLabel}
                            tone={statusTone}
                          />
                        </View>
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.activityTitle,
                            { color: colors.foreground },
                          ]}
                        >
                          {displayTitle}
                        </Text>
                        <Text
                          style={[
                            styles.activityDescription,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {getActivityPostMeta(post)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {!ready && storageError ? (
              <ActionButton
                label="إعادة المحاولة"
                icon="refresh-cw"
                secondary
                onPress={() => void onRefresh()}
              />
            ) : null}
          </Panel>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  orderNotification: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  orderNotificationIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  orderNotificationCopy: { flex: 1, minWidth: 0, gap: 4 },
  orderNotificationTitle: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  orderNotificationText: { fontSize: 11, lineHeight: 17, textAlign: "right" },
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  heroPhone: { padding: 12 },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  heroContentPhone: {
    gap: 10,
  },
  heroContentCompact: {
    gap: 8,
  },
  heroText: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 4 },
  heroEyebrow: { fontSize: 11, fontWeight: "700" },
  heroTitle: { fontSize: 22, fontWeight: "800", textAlign: "right" },
  heroTitlePhone: { fontSize: 16 },
  heroTitleCompact: { fontSize: 15 },
  heroBody: {
    alignSelf: "stretch",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "right",
    maxWidth: 560,
  },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  contentGrid: { gap: 18 },
  contentGridPhone: { gap: 10 },
  contentGridWide: { flexDirection: "row", alignItems: "flex-start" },
  contentColumn: { minWidth: 0 },
  contentColumnWide: { flex: 1 },
  metricPressable: { flexBasis: "48%", flexGrow: 0, minWidth: 0 },
  metricPressableWide: { flexBasis: "23%", flexGrow: 1 },
  metricCard: {
    minHeight: 140,
    alignItems: "stretch",
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
    gap: 7,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
  },
  metricNumber: { fontSize: 27, fontWeight: "800", textAlign: "right" },
  metricCopy: { alignItems: "stretch", gap: 2 },
  metricLabel: { fontSize: 13, textAlign: "right", fontWeight: "700" },
  metricDescription: { fontSize: 10, lineHeight: 15, textAlign: "right" },
  link: { fontSize: 12, fontWeight: "700" },
  channelHeading: { gap: 3 },
  channelSectionSubtitle: { fontSize: 11, lineHeight: 16, textAlign: "right" },
  channelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "stretch",
  },
  channelRowPhone: {
    flexDirection: "column",
    rowGap: 6,
  },
  channelTile: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 180,
    minHeight: 76,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  channelTilePhone: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "100%",
    minHeight: 56,
    paddingVertical: 7,
  },
  channelIdentity: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 4,
  },
  channelIdentityPhone: {
    flexShrink: 1,
  },
  channelIdentityTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  channelDetails: {
    minHeight: 32,
    maxWidth: "55%",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 9,
    gap: 5,
  },
  channelDetailsPhone: {
    flexShrink: 1,
  },
  channelName: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  channelState: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    flexShrink: 1,
  },
  channelHint: {
    minHeight: 38,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 10,
  },
  channelHintText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "right",
  },
  channelAccount: {
    maxWidth: "100%",
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 16,
  },
  activityList: { gap: 10 },
  activityIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  activityThumbnail: {
    width: 54,
    height: 54,
    borderRadius: 13,
    overflow: "hidden",
  },
  activityThumbnailFallback: {
    width: 54,
    height: 54,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  activityCopy: { flex: 1, minWidth: 0, alignItems: "stretch", gap: 5 },
  activityTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  activityStatus: { alignSelf: "flex-start" },
  activityTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  activityDescription: { fontSize: 11, lineHeight: 16, textAlign: "right" },
  activityPlatform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  activityDate: { fontSize: 10, lineHeight: 15, textAlign: "right" },
  activityError: { gap: 8, paddingVertical: 10 },
  activityErrorText: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  reviewButton: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  reviewButtonLabel: { fontSize: 11, fontWeight: "700" },
});
