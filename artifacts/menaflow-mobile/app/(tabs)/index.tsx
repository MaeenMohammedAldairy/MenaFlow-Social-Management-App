import { router } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { useStudio } from "@/context/StudioContext";
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
import { formatArabicDate } from "@/lib/formatting";

const metrics = [
  { label: "مسودات", icon: "edit-3" as const, status: "draft" },
  { label: "بانتظار المراجعة", icon: "eye" as const, status: "review" },
  { label: "منشورة", icon: "send" as const, status: "published" },
];

export default function HomeScreen() {
  if (isLocalAuthDisabled) return <HomeScreenContent userId={null} />;
  return <AuthenticatedHomeScreen />;
}

function AuthenticatedHomeScreen() {
  const { userId } = useAuth();
  return <HomeScreenContent userId={userId ?? null} />;
}

function HomeScreenContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { posts, refreshPosts, syncing } = useStudio();
  const [refreshing, setRefreshing] = useState(false);
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

  const count = (status: string) =>
    posts.filter((post) => post.status === status).length;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshPosts(), connectionsQuery.refetch()]);
    setRefreshing(false);
  };

  const hasAnyConnection = Boolean(
    connections?.facebook || connections?.instagram || connections?.whatsapp,
  );

  const channelsData = [
    {
      platform: "instagram" as const,
      name: "إنستغرام",
      icon: "instagram" as const,
      tint: colors.instagram,
      connected: Boolean(connections?.instagram),
      detail: connections?.instagram?.accountName
        ? `@${connections.instagram.accountName}`
        : connections?.instagram
          ? "مربوط"
          : "غير مربوط",
    },
    {
      platform: "facebook" as const,
      name: "فيسبوك",
      icon: "facebook" as const,
      tint: colors.facebook,
      connected: Boolean(connections?.facebook),
      detail:
        connections?.facebook?.accountName ||
        (connections?.facebook ? "مربوط" : "غير مربوط"),
    },
    {
      platform: "whatsapp" as const,
      name: "واتساب",
      icon: "message-circle" as const,
      tint: colors.whatsapp,
      connected: Boolean(
        connections?.whatsapp?.connected ?? connections?.whatsapp,
      ),
      detail:
        connections?.whatsapp?.accountName ||
        (connections?.whatsapp ? "مربوط" : "غير مربوط"),
    },
  ];

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
      <PageTitle
        title="مرحباً بك في MenaFlow"
        subtitle="إدارة محتواك وحساباتك من مكان واحد."
      />
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
            <Text style={[styles.heroEyebrow, { color: colors.primary }]}>
              مساحة عملك
            </Text>
            <Text
              style={[
                styles.heroTitle,
                width >= 360 && width < 420 && styles.heroTitlePhone,
                { color: colors.foreground },
              ]}
            >
              ابدأ بخطوة بسيطة
            </Text>
            <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
              {hasAnyConnection
                ? "حساباتك متصلة ومستعدة. أنشئ محتواك وانشره بنقرة واحدة."
                : "أنشئ مسودة، راجعها، ثم اربط قنواتك للنشر المباشر."}
            </Text>
          </View>
          <ActionButton
            label="إنشاء محتوى"
            icon="plus"
            onPress={() => router.push("/compose")}
          />
        </View>
      </View>

      <View style={styles.metricsRow}>
        {metrics.map((metric) => (
          <Pressable
            key={metric.status}
            accessibilityRole="button"
            accessibilityLabel={`${metric.label}: ${count(metric.status)}`}
            onPress={() =>
              router.push({
                pathname: "/(tabs)/content",
                params: { status: metric.status },
              })
            }
            style={styles.metricPressable}
          >
            <Panel style={styles.metricCard}>
              <View
                style={[styles.metricIcon, { backgroundColor: colors.accent }]}
              >
                <Icon name={metric.icon} size={17} color={colors.primary} />
              </View>
              <Text style={[styles.metricNumber, { color: colors.foreground }]}>
                {count(metric.status)}
              </Text>
              <Text
                style={[styles.metricLabel, { color: colors.mutedForeground }]}
              >
                {metric.label}
              </Text>
            </Panel>
          </Pressable>
        ))}
      </View>

      <View
        style={[
          styles.contentGrid,
          isWideScreen && styles.contentGridWide,
        ]}
      >
        <View style={styles.contentColumn}>
          <Panel>
            <SectionTitle
              title="حساباتك الاجتماعية"
              action={
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/more/sources",
                      params: { view: "publishing" },
                    })
                  }
                >
                  <Text style={[styles.link, { color: colors.primary }]}>
                    إدارة حسابات النشر
                  </Text>
                </Pressable>
              }
            />
            <View style={styles.channelRow}>
              {channelsData.map((channel) => (
                <Pressable
                  key={channel.name}
                  accessibilityRole="button"
                  accessibilityLabel={
                    channel.connected
                      ? `تفاصيل حساب ${channel.name}`
                      : `ربط ${channel.name}`
                  }
                  onPress={() =>
                    channel.connected
                      ? router.push({
                          pathname: "/account/[platform]",
                          params: { platform: channel.platform },
                        })
                      : router.push({
                          pathname: "/(tabs)/more/sources",
                          params: { connect: channel.platform },
                        })
                  }
                  style={[
                    styles.channelTile,
                    {
                      borderColor: channel.connected
                        ? colors.primary
                        : colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Icon name={channel.icon} size={23} color={channel.tint} />
                  <Text style={[styles.channelName, { color: colors.foreground }]}>
                    {channel.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.channelState,
                      {
                        color: channel.connected
                          ? colors.green
                          : colors.mutedForeground,
                        fontWeight: channel.connected ? "700" : "400",
                      },
                    ]}
                  >
                    {channel.detail}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.helperNote, { color: colors.mutedForeground }]}>
              {hasAnyConnection
                ? "حساباتك متصلة بالخادم. يتم تحديث بيانات النشر والوصول دورياً."
                : "لن تظهر بيانات الأداء حتى تربط حساباتك في صفحة المصادر."}
            </Text>
          </Panel>
        </View>

        <View style={styles.contentColumn}>
          <Panel>
            <SectionTitle
              title="أحدث المحتوى"
              action={
                <Pressable onPress={() => router.push("/(tabs)/content")}>
                  <Text style={[styles.link, { color: colors.primary }]}>
                    عرض الكل
                  </Text>
                </Pressable>
              }
            />
            {posts.length === 0 ? (
              <EmptyState
                icon="file-text"
                title="مساحة المحتوى جاهزة"
                body="ابدأ بكتابة أول منشور. ستتم مزامنة المحتوى تلقائياً مع الخادم."
              />
            ) : (
              posts.slice(0, 4).map((post) => {
                const title = post.title.trim();
                const displayTitle =
                  title &&
                  ![
                    "محتوى يحتاج إلى مراجعة",
                    "محتوى من واتساب",
                    "منشور بدون عنوان",
                  ].includes(title)
                    ? title
                    : post.body
                        .trim()
                        .split(/\r?\n/)
                        .find(Boolean)
                        ?.replace(/^[*#\s]+/, "")
                        .slice(0, 72) || "منشور بدون عنوان";
                const statusLabel =
                  post.status === "review"
                    ? "بانتظار المراجعة"
                    : post.status === "draft"
                      ? "مسودة"
                      : post.status === "scheduled"
                        ? "مجدول"
                        : post.status === "publishing"
                          ? "قيد الإرسال"
                          : post.status === "failed"
                            ? "فشل النشر"
                            : post.status === "approved"
                              ? "معتمد للنشر"
                              : "منشور";
                const postDate = formatArabicDate(
                  post.sourceMessageDate ?? post.createdAt,
                );
                return (
                  <View
                    key={post.id}
                    style={[
                      styles.activityRow,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <StatusPill
                      style={styles.activityStatus}
                      label={statusLabel}
                      tone={
                        post.status === "review"
                          ? "amber"
                          : post.status === "published"
                            ? "green"
                            : "muted"
                      }
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`عرض ${displayTitle}`}
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/content",
                          params: { status: post.status },
                        })
                      }
                      style={styles.activityCopy}
                    >
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
                        numberOfLines={1}
                        style={[
                          styles.activityMeta,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {post.channels
                          .map((channel) =>
                            channel === "instagram"
                              ? "إنستغرام"
                              : channel === "facebook"
                                ? "فيسبوك"
                                : "واتساب",
                          )
                          .join("، ") || "بدون قنوات"}
                        {postDate ? ` · ${postDate}` : ""}
                      </Text>
                    </Pressable>
                    {post.status === "review" ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`مراجعة ${displayTitle}`}
                        onPress={() =>
                          router.push({
                            pathname: "/(tabs)/content",
                            params: { status: "review" },
                          })
                        }
                        style={[
                          styles.reviewButton,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <Text
                          style={[
                            styles.reviewButtonLabel,
                            { color: colors.primary },
                          ]}
                        >
                          مراجعة
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            )}
          </Panel>
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  heroPhone: { padding: 16 },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  heroContentPhone: { gap: 8 },
  heroContentCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
  },
  heroText: { flex: 1, alignItems: "flex-start", gap: 6 },
  heroEyebrow: { fontSize: 12, fontWeight: "700" },
  heroTitle: { fontSize: 22, fontWeight: "800", textAlign: "right" },
  heroTitlePhone: { fontSize: 18 },
  heroBody: {
    alignSelf: "stretch",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
    maxWidth: 560,
  },
  metricsRow: { flexDirection: "row", gap: 8 },
  contentGrid: { gap: 18 },
  contentGridWide: { flexDirection: "row", alignItems: "flex-start" },
  contentColumn: { flex: 1, minWidth: 0 },
  metricPressable: { flex: 1 },
  metricCard: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 13,
    gap: 5,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  metricNumber: { fontSize: 21, fontWeight: "800" },
  metricLabel: { fontSize: 10, textAlign: "center", fontWeight: "600" },
  link: { fontSize: 12, fontWeight: "700" },
  channelRow: { flexDirection: "row", gap: 8 },
  channelTile: {
    flex: 1,
    minHeight: 90,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  channelName: { fontSize: 12, fontWeight: "700" },
  channelState: { fontSize: 10, textAlign: "center", maxWidth: 85 },
  helperNote: {
    alignSelf: "stretch",
    fontSize: 11,
    textAlign: "right",
    writingDirection: "rtl",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activityCopy: { flex: 1, alignItems: "flex-start", gap: 4 },
  activityStatus: { alignSelf: "center" },
  activityTitle: { fontSize: 13, fontWeight: "700" },
  activityMeta: { fontSize: 11, textAlign: "left" },
  reviewButton: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  reviewButtonLabel: { fontSize: 11, fontWeight: "700" },
});
