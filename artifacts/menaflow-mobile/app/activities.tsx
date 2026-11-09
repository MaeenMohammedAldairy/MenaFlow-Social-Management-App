import React, { useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { useStudio } from "@/context/StudioContext";
import { formatArabicDate } from "@/lib/formatting";
import {
  getMetaInbox,
  metaInboxPersonId,
} from "@/lib/meta-inbox-api";
import { getProductCatalog } from "@/lib/product-catalog-api";

type Activity =
  | {
      type: "inbox";
      id: string;
      timestamp: string;
      item: Awaited<ReturnType<typeof getMetaInbox>>["items"][number];
    }
  | {
      type: "product";
      id: string;
      timestamp: string;
      product: NonNullable<Awaited<ReturnType<typeof getProductCatalog>>[number]>;
    }
  | {
      type: "post";
      id: string;
      timestamp: string;
      post: ReturnType<typeof useStudio>["posts"][number];
    };

export default function ActivitiesScreen() {
  if (isLocalAuthDisabled) return <ActivitiesContent userId={null} />;
  return <AuthenticatedActivitiesScreen />;
}

function AuthenticatedActivitiesScreen() {
  const { userId } = useAuth();
  return <ActivitiesContent userId={userId ?? null} />;
}

function ActivitiesContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { posts, refreshPosts, ready, storageError } = useStudio();
  const [refreshing, setRefreshing] = useState(false);
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

  const activities: Activity[] = [
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
  ].sort(
    (first, second) =>
      new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshPosts(),
        inboxQuery.refetch(),
        catalogQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={
            refreshing ||
            inboxQuery.isRefetching ||
            catalogQuery.isRefetching
          }
          onRefresh={() => void onRefresh()}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle
        title="الأنشطة"
        subtitle="آخر الرسائل والتعليقات والمنشورات والمنتجات في مساحة عملك."
        back={{ href: "/", label: "العودة إلى الرئيسية" }}
      />

      {inboxQuery.isError || catalogQuery.isError ? (
        <Panel style={styles.errorPanel}>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            تعذّر تحميل بعض الأنشطة. يمكنك إعادة المحاولة دون مغادرة الصفحة.
          </Text>
          <ActionButton
            label="إعادة المحاولة"
            icon="refresh-cw"
            secondary
            disabled={inboxQuery.isFetching || catalogQuery.isFetching}
            onPress={() => {
              void Promise.all([inboxQuery.refetch(), catalogQuery.refetch()]);
            }}
          />
        </Panel>
      ) : null}

      {!ready && !storageError ? (
        <EmptyState
          icon="clock"
          title="جارٍ تحميل الأنشطة"
          body="نحمّل أحدث عناصر مساحة العمل."
        />
      ) : activities.length === 0 &&
        (inboxQuery.isPending || catalogQuery.isPending) ? (
        <EmptyState
          icon="clock"
          title="جارٍ تحميل الأنشطة"
          body="نحمّل أحدث الرسائل والمنشورات والمنتجات."
        />
      ) : activities.length === 0 ? (
        <EmptyState
          icon="bell"
          title="لا توجد أنشطة بعد"
          body="ستظهر هنا أحدث الرسائل والتعليقات والمنشورات والمنتجات."
        />
      ) : (
        <Panel style={styles.activityList}>
          {activities.map((activity) => {
            if (activity.type === "inbox") {
              const label =
                activity.item.kind === "comment" ? "تعليق جديد" : "رسالة جديدة";
              const platformLabel =
                activity.item.platform === "facebook" ? "فيسبوك" : "إنستغرام";
              const title = activity.item.actorName || "اسم غير متاح";
              const date = formatArabicDate(activity.timestamp);
              return (
                <Pressable
                  key={`inbox-${activity.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} من ${title} على ${platformLabel}`}
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
                      borderBottomColor: colors.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <StatusPill label={label} tone="blue" style={styles.activityStatus} />
                  <View style={styles.activityCopy}>
                    <Text
                      numberOfLines={1}
                      style={[styles.activityTitle, { color: colors.foreground }]}
                    >
                      {title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.activityDescription, { color: colors.mutedForeground }]}
                    >
                      {activity.item.text || "عنصر بدون نص"}
                    </Text>
                    <View style={styles.activityMeta}>
                      <SocialPlatformIcon platform={activity.item.platform} size={14} />
                      <Text style={[styles.activityDate, { color: colors.mutedForeground }]}>
                        {platformLabel}{date ? ` · ${date}` : ""}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            }

            if (activity.type === "product") {
              const date = formatArabicDate(activity.timestamp);
              return (
                <Pressable
                  key={`product-${activity.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`منتج جديد: ${activity.product.name}`}
                  onPress={() => router.push("/(tabs)/products")}
                  style={({ pressed }) => [
                    styles.activityRow,
                    {
                      borderBottomColor: colors.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <StatusPill label="منتج جديد" tone="green" style={styles.activityStatus} />
                  <View style={styles.activityCopy}>
                    <Text numberOfLines={2} style={[styles.activityTitle, { color: colors.foreground }]}>
                      {activity.product.name}
                    </Text>
                    <Text style={[styles.activityDate, { color: colors.mutedForeground }]}>
                      الكتالوج{date ? ` · ${date}` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            }

            const post = activity.post;
            const title =
              post.title.trim() ||
              post.body.trim().split(/\r?\n/).find(Boolean)?.slice(0, 72) ||
              "منشور بدون عنوان";
            const channelNames = post.channels.map((channel) =>
              channel === "instagram"
                ? "إنستغرام"
                : channel === "facebook"
                  ? "فيسبوك"
                  : "واتساب",
            );
            const statusLabel =
              post.status === "review"
                ? "بانتظار المراجعة"
                : post.status === "draft"
                  ? "حُفظت كمسودة"
                  : post.status === "scheduled"
                    ? "تمت الجدولة"
                    : post.status === "publishing"
                      ? "جارٍ النشر"
                      : post.status === "failed"
                        ? "تعذّر النشر"
                        : post.status === "approved"
                          ? "تم الاعتماد"
                          : "تم النشر";
            return (
              <Pressable
                key={`post-${activity.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${statusLabel}: ${title}`}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/content",
                    params: { status: post.status },
                  })
                }
                style={({ pressed }) => [
                  styles.activityRow,
                  {
                    borderBottomColor: colors.border,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <StatusPill
                  label={statusLabel}
                  tone={post.status === "published" ? "green" : post.status === "failed" ? "amber" : "muted"}
                  style={styles.activityStatus}
                />
                <View style={styles.activityCopy}>
                  <Text numberOfLines={2} style={[styles.activityTitle, { color: colors.foreground }]}>
                    {title}
                  </Text>
                  <Text style={[styles.activityDate, { color: colors.mutedForeground }]}>
                    {channelNames.join("، ") || "بدون قنوات"}
                    {formatArabicDate(activity.timestamp)
                      ? ` · ${formatArabicDate(activity.timestamp)}`
                      : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Panel>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  errorPanel: { gap: 10 },
  errorText: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  activityList: { gap: 0 },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activityStatus: { minWidth: 90 },
  activityCopy: { flex: 1, minWidth: 0, gap: 4, alignItems: "flex-start" },
  activityTitle: { width: "100%", fontSize: 13, fontWeight: "700", textAlign: "right" },
  activityDescription: { width: "100%", fontSize: 11, textAlign: "right" },
  activityMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  activityDate: { fontSize: 10, textAlign: "right" },
});
