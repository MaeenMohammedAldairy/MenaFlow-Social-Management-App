import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
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
import type { Channel, PostStatus } from "@/context/StudioContext";
import { formatArabicDateTime, formatArabicNumber } from "@/lib/formatting";
import {
  getActivityPostMeta,
  getActivityPostStatusLabel,
  getActivityPostStatusTone,
  getActivityPostTitle,
} from "@/lib/activity-formatting";
import { getMetaInbox, metaInboxPersonId } from "@/lib/meta-inbox-api";
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
      product: NonNullable<
        Awaited<ReturnType<typeof getProductCatalog>>[number]
      >;
    }
  | {
      type: "post";
      id: string;
      timestamp: string;
      post: ReturnType<typeof useStudio>["posts"][number];
    };

type ActivityTypeFilter = "all" | "inbox" | "post" | "product";
type ActivityPlatformFilter = "all" | Channel;

const activityTypeOptions: FilterOption<ActivityTypeFilter>[] = [
  { value: "all", label: "الكل" },
  { value: "inbox", label: "الرسائل والتعليقات" },
  { value: "post", label: "المنشورات" },
  { value: "product", label: "المنتجات" },
];

const activityPlatformOptions: FilterOption<ActivityPlatformFilter>[] = [
  { value: "all", label: "كل المنصات" },
  { value: "facebook", label: "فيسبوك" },
  { value: "instagram", label: "إنستغرام" },
  { value: "whatsapp", label: "واتساب" },
];

const activityStatusOptions: FilterOption<PostStatus | "all">[] = [
  { value: "all", label: "كل الحالات" },
  { value: "draft", label: "مسودة" },
  { value: "review", label: "بانتظار المراجعة" },
  { value: "approved", label: "معتمد" },
  { value: "scheduled", label: "مجدول" },
  { value: "publishing", label: "قيد النشر" },
  { value: "published", label: "تم النشر" },
  { value: "failed", label: "تعذّر النشر" },
];

type FilterOption<T extends string> = { value: T; label: string };

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
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>("all");
  const [platformFilter, setPlatformFilter] =
    useState<ActivityPlatformFilter>("all");
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all");
  const [visibleCount, setVisibleCount] = useState(20);
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
      new Date(second.timestamp).getTime() -
      new Date(first.timestamp).getTime(),
  );
  const filteredActivities = activities.filter((activity) => {
    if (typeFilter !== "all" && activity.type !== typeFilter) return false;
    if (
      platformFilter !== "all" &&
      (activity.type === "product" ||
        (activity.type === "inbox" &&
          activity.item.platform !== platformFilter) ||
        (activity.type === "post" &&
          !activity.post.channels.includes(platformFilter)))
    ) {
      return false;
    }
    return (
      statusFilter === "all" ||
      (activity.type === "post" && activity.post.status === statusFilter)
    );
  });
  const visibleActivities = filteredActivities.slice(0, visibleCount);

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
            refreshing || inboxQuery.isRefetching || catalogQuery.isRefetching
          }
          onRefresh={() => void onRefresh()}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle
        title="الأنشطة"
        subtitle="وقت استلام الرسائل والتعليقات، وآخر تحديث للمنشورات، وتاريخ إضافة المنتجات."
        back={{ href: "/", label: "العودة إلى الرئيسية" }}
      />

      {inboxQuery.isError || catalogQuery.isError ? (
        <Panel style={styles.errorPanel}>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            تعذّر تحميل{" "}
            {[
              inboxQuery.isError ? "الرسائل والتعليقات" : null,
              catalogQuery.isError ? "المنتجات" : null,
            ]
              .filter(Boolean)
              .join(" وال")}
            . قد تظهر الأنشطة جزئيًا.
          </Text>
          <View style={styles.retryButtons}>
            {inboxQuery.isError ? (
              <ActionButton
                label="إعادة تحميل الرسائل"
                icon="refresh-cw"
                secondary
                compact
                disabled={inboxQuery.isFetching}
                onPress={() => void inboxQuery.refetch()}
              />
            ) : null}
            {catalogQuery.isError ? (
              <ActionButton
                label="إعادة تحميل المنتجات"
                icon="refresh-cw"
                secondary
                compact
                disabled={catalogQuery.isFetching}
                onPress={() => void catalogQuery.refetch()}
              />
            ) : null}
          </View>
        </Panel>
      ) : null}

      {!ready ? (
        <EmptyState
          icon={storageError ? "alert-circle" : "clock"}
          title={storageError ? "تعذّر تحميل المنشورات" : "جارٍ تحميل الأنشطة"}
          body={storageError || "نحمّل أحدث عناصر مساحة العمل."}
        />
      ) : null}
      {!ready && storageError ? (
        <ActionButton
          label="إعادة المحاولة"
          icon="refresh-cw"
          secondary
          onPress={() => void onRefresh()}
        />
      ) : null}

      {ready &&
      activities.length === 0 &&
      (inboxQuery.isPending || catalogQuery.isPending) ? (
        <EmptyState
          icon="clock"
          title="جارٍ تحميل الأنشطة"
          body="نحمّل أحدث الرسائل والمنشورات والمنتجات."
        />
      ) : ready &&
        activities.length === 0 &&
        (inboxQuery.isError || catalogQuery.isError) ? (
        <EmptyState
          icon="alert-circle"
          title="تعذّر تحميل الأنشطة"
          body="تعذّر تحميل الرسائل أو المنتجات. أعد المحاولة من التنبيه أعلاه."
        />
      ) : ready && activities.length === 0 ? (
        <EmptyState
          icon="bell"
          title="لا توجد أنشطة بعد"
          body="ستظهر هنا أحدث الرسائل والتعليقات والمنشورات والمنتجات."
        />
      ) : ready ? (
        <>
          <Panel style={styles.filtersPanel}>
            <ActivityFilterRow
              label="نوع النشاط"
              options={activityTypeOptions}
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value);
                setVisibleCount(20);
                if (value !== "post") setStatusFilter("all");
                if (value === "product") setPlatformFilter("all");
              }}
            />
            {typeFilter !== "product" ? (
              <ActivityFilterRow
                label="المنصة"
                options={activityPlatformOptions}
                value={platformFilter}
                onChange={(value) => {
                  setPlatformFilter(value);
                  setVisibleCount(20);
                }}
              />
            ) : null}
            {typeFilter === "post" ? (
              <ActivityFilterRow
                label="حالة المنشور"
                options={activityStatusOptions}
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value);
                  setVisibleCount(20);
                }}
              />
            ) : null}
          </Panel>
          <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
            عرض {formatArabicNumber(visibleActivities.length)} من{" "}
            {formatArabicNumber(filteredActivities.length)}
          </Text>
          {filteredActivities.length === 0 ? (
            <EmptyState
              icon="filter"
              title="لا توجد نتائج"
              body="جرّب تغيير نوع النشاط أو المنصة أو حالة المنشور."
            />
          ) : (
            <Panel style={styles.activityList}>
              {visibleActivities.map((activity) => {
                if (activity.type === "inbox") {
                  const label =
                    activity.item.kind === "comment"
                      ? "تعليق جديد"
                      : "رسالة جديدة";
                  const platformLabel =
                    activity.item.platform === "facebook"
                      ? "فيسبوك"
                      : "إنستغرام";
                  const title = activity.item.actorName || "اسم غير متاح";
                  const date = formatArabicDateTime(activity.timestamp);
                  return (
                    <Pressable
                      key={`inbox-${activity.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} من ${title} على ${platformLabel}`}
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
                          borderBottomColor: colors.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <StatusPill
                        label={label}
                        tone="blue"
                        style={styles.activityStatus}
                      />
                      <View style={styles.activityCopy}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.activityTitle,
                            { color: colors.foreground },
                          ]}
                        >
                          {title}
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
                        <View style={styles.activityMeta}>
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
                            {date ? ` · تاريخ الاستلام: ${date}` : ""}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                }

                if (activity.type === "product") {
                  const date = formatArabicDateTime(activity.timestamp);
                  return (
                    <Pressable
                      key={`product-${activity.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`منتج جديد: ${activity.product.name}`}
                      accessibilityHint="عرض كتالوج المنتجات"
                      onPress={() => router.push("/(tabs)/products")}
                      style={({ pressed }) => [
                        styles.activityRow,
                        {
                          borderBottomColor: colors.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <StatusPill
                        label="منتج جديد"
                        tone="green"
                        style={styles.activityStatus}
                      />
                      <View style={styles.activityCopy}>
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
                            styles.activityDate,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          تاريخ الإضافة إلى الكتالوج{date ? `: ${date}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }

                const post = activity.post;
                const title = getActivityPostTitle(post);
                const statusLabel = getActivityPostStatusLabel(post);
                return (
                  <Pressable
                    key={`post-${activity.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${statusLabel}: ${title}`}
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
                        borderBottomColor: colors.border,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <StatusPill
                      label={statusLabel}
                      tone={getActivityPostStatusTone(post)}
                      style={styles.activityStatus}
                    />
                    <View style={styles.activityCopy}>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.activityTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {title}
                      </Text>
                      <Text
                        style={[
                          styles.activityDate,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {getActivityPostMeta(post)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Panel>
          )}
          {visibleActivities.length < filteredActivities.length ? (
            <ActionButton
              label="عرض المزيد"
              icon="chevron-down"
              secondary
              onPress={() => setVisibleCount((count) => count + 20)}
            />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

function ActivityFilterRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.filterGroup}>
      <Text style={[styles.filterHeading, { color: colors.foreground }]}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterOptions}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.filterOption,
                {
                  backgroundColor: selected
                    ? colors.primary
                    : colors.background,
                  borderColor: selected ? colors.primary : colors.border,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterOptionText,
                  {
                    color: selected
                      ? colors.primaryForeground
                      : colors.foreground,
                  },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  errorPanel: { gap: 10 },
  errorText: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  retryButtons: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  filtersPanel: { gap: 14 },
  filterGroup: { gap: 8 },
  filterHeading: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  filterOptions: { flexDirection: "row-reverse", gap: 8, paddingVertical: 2 },
  filterOption: {
    minHeight: 36,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
  },
  filterOptionText: { fontSize: 12, fontWeight: "600" },
  resultCount: { fontSize: 12, textAlign: "right" },
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
  activityTitle: {
    width: "100%",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  activityDescription: { width: "100%", fontSize: 11, textAlign: "right" },
  activityMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  activityDate: { fontSize: 11, lineHeight: 17, textAlign: "right" },
});
