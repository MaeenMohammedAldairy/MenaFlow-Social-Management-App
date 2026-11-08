import {
  deleteMetaConnectionForPlatform,
  deleteWhatsAppConnection,
  getSocialAccountDetails,
  triggerWhatsAppSyncNow,
  type AccountPlatform,
  type SocialAccountDetails,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
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
import { useColors } from "@/hooks/useColors";
import { formatArabicDateTime, formatArabicNumber } from "@/lib/formatting";
import { isLocalAuthDisabled } from "@/constants/auth";

const platforms: Record<
  AccountPlatform,
  { name: string; icon: "facebook" | "instagram" | "message-circle"; tintKey: "facebook" | "instagram" | "whatsapp" }
> = {
  facebook: { name: "فيسبوك", icon: "facebook", tintKey: "facebook" },
  instagram: { name: "إنستغرام", icon: "instagram", tintKey: "instagram" },
  whatsapp: { name: "واتساب", icon: "message-circle", tintKey: "whatsapp" },
};

const permissionLabels: Record<string, string> = {
  pages_read_engagement: "قراءة تفاعل الصفحة",
  pages_manage_posts: "إدارة منشورات الصفحة",
  read_insights: "قراءة الإحصاءات",
  instagram_basic: "قراءة بيانات إنستغرام",
  instagram_manage_insights: "قراءة إحصاءات إنستغرام",
};

function platformFromParam(value: unknown): AccountPlatform | null {
  return value === "facebook" || value === "instagram" || value === "whatsapp"
    ? value
    : null;
}

function formatCount(value: number): string {
  return formatArabicNumber(value);
}

function formatDate(value: string | null | undefined): string {
  return formatArabicDateTime(value) ?? "لا توجد بيانات";
}

function accountErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/failed to fetch|fetch failed|network request failed/i.test(message)) {
    return "تعذّر الاتصال بخدمة Meta الآن. تحقق من الاتصال ثم أعد المحاولة.";
  }
  return message || fallback;
}

function activityLabel(eventType: string): string {
  const labels: Record<string, string> = {
    post_created: "تم إنشاء المنشور",
    post_edited: "تم تعديل المنشور",
    post_submitted_for_review: "بانتظار المراجعة",
    post_approved: "تمت الموافقة",
    post_scheduled: "تمت الجدولة",
    publish_attempt_started: "بدأت محاولة النشر",
    publish_succeeded: "تم النشر بنجاح",
    publish_verified: "تم التحقق من النشر",
    publish_failed: "فشل النشر",
    publish_uncertain: "نتيجة النشر غير مؤكدة",
  };
  return labels[eventType] ?? "تحديث على المنشور";
}

export default function AccountDetailsScreen() {
  if (isLocalAuthDisabled) return <AccountDetailsContent userId={null} />;
  return <AuthenticatedAccountDetails />;
}

function AuthenticatedAccountDetails() {
  const { userId } = useAuth();
  return <AccountDetailsContent userId={userId ?? null} />;
}

function AccountDetailsContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { platform: rawPlatform } = useLocalSearchParams<{ platform?: string }>();
  const platform = platformFromParam(rawPlatform);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [postFilter, setPostFilter] = useState<"all" | "with-image" | "text-only">("all");
  const queryKey = ["socialAccountDetails", userId ?? "local", platform];

  const detailsQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!platform) throw new Error("منصة الحساب غير صالحة.");
      return getSocialAccountDetails(platform, { signal });
    },
    enabled: platform !== null,
    retry: false,
  });
  const details: SocialAccountDetails | undefined = detailsQuery.data;
  const platformInfo = platform ? platforms[platform] : null;
  const visiblePosts = (details?.posts ?? []).filter((post) => {
    if (postFilter === "with-image") return Boolean(post.imageUrl);
    if (postFilter === "text-only") return !post.imageUrl;
    return true;
  });

  const refreshDetails = async () => {
    setActionError("");
    await detailsQuery.refetch();
  };

  const syncAccount = async () => {
    if (!platform) return;
    setActionBusy(true);
    setActionError("");
    try {
      if (platform === "whatsapp") await triggerWhatsAppSyncNow();
      await queryClient.invalidateQueries({ queryKey });
      await detailsQuery.refetch();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "تعذّر تحديث بيانات الحساب.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const disconnectAccount = () => {
    if (!platform || !details) return;
    Alert.alert(
      "فصل الحساب",
      `هل تريد فصل حساب ${platformInfo?.name} (${details.accountName})؟`,
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "فصل الحساب",
          style: "destructive",
          onPress: () => void confirmDisconnect(),
        },
      ],
    );
  };

  const relinkAccount = () => {
    if (!platform) return;
    router.push({
      pathname: "/(tabs)/more/sources",
      params: { connect: platform, reconnect: "true" },
    });
  };

  const confirmDisconnect = async () => {
    if (!platform) return;
    setActionBusy(true);
    setActionError("");
    try {
      if (platform === "whatsapp") await deleteWhatsAppConnection();
      else await deleteMetaConnectionForPlatform(platform);
      await queryClient.invalidateQueries();
      router.replace("/(tabs)/more/sources");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "تعذّر فصل الحساب.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  if (!platform || !platformInfo) {
    return (
      <Page>
        <BrandHeader />
        <EmptyState
          icon="alert-circle"
          title="الحساب غير معروف"
          body="تعذّر تحديد المنصة المطلوبة."
        />
        <ActionButton
          label="العودة إلى الحسابات"
          icon="chevron-right"
          secondary
          onPress={() => router.replace("/(tabs)/more/sources")}
        />
      </Page>
    );
  }

  const connected = details?.connectionState === "connected";
  const performance = platform === "facebook" ? details?.performance : undefined;

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={detailsQuery.isRefetching}
          onRefresh={() => void refreshDetails()}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle
        title={`تفاصيل حساب ${platformInfo.name}`}
        subtitle="بيانات الحساب وإحصاءاته من المنصة ومزامنة مساحة العمل."
        back={{
          href: "/(tabs)/more/sources",
          label: "العودة إلى الحسابات والمصادر",
        }}
      />

      {detailsQuery.isLoading ? (
        <Panel>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              جارٍ جلب بيانات الحساب من واجهة المنصة…
            </Text>
          </View>
        </Panel>
      ) : detailsQuery.isError ? (
        <Panel>
          <Text style={[styles.error, { color: colors.destructive }]}>
            {accountErrorMessage(detailsQuery.error, "تعذّر تحميل تفاصيل هذا الحساب.")}
          </Text>
          <View style={styles.actionRow}>
            <ActionButton
              label="إعادة المحاولة"
              icon="refresh-cw"
              secondary
              onPress={() => void refreshDetails()}
              disabled={actionBusy}
            />
            <ActionButton
              label="إدارة الحسابات"
              icon="settings"
              onPress={() => router.push("/(tabs)/more/sources")}
            />
          </View>
        </Panel>
      ) : details ? (
        <>
          <Panel>
            {platform === "facebook" ? (
              <View
                style={[
                  styles.facebookCover,
                  { backgroundColor: colors.blueSoft },
                ]}
              >
                {details.coverImageUrl ? (
                  <Image
                    source={{ uri: details.coverImageUrl }}
                    style={styles.facebookCoverImage}
                    resizeMode="cover"
                    accessibilityLabel={`غلاف صفحة ${details.accountName}`}
                  />
                ) : (
                  <Icon name="facebook" size={32} color={colors.facebook} />
                )}
              </View>
            ) : null}
            <View style={styles.profileHeader}>
              {details.profileImageUrl ? (
                <Image
                  source={{ uri: details.profileImageUrl }}
                  style={styles.profileImage}
                  accessibilityLabel={`صورة حساب ${details.accountName}`}
                />
              ) : (
                <View
                  style={[
                    styles.profilePlaceholder,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  <Icon
                    name={platformInfo.icon}
                    size={27}
                    color={colors[platformInfo.tintKey]}
                  />
                </View>
              )}
              <View style={styles.profileCopy}>
                {platform === "facebook" ? (
                  <View
                    style={[
                      styles.facebookPageBadge,
                      { backgroundColor: colors.blueSoft },
                    ]}
                  >
                    <Icon name="facebook" size={13} color={colors.facebook} />
                    <Text style={[styles.facebookPageLabel, { color: colors.facebook }]}>
                      صفحة فيسبوك
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.accountName, { color: colors.foreground }]}>
                  {details.accountName}
                </Text>
                {details.category || details.description ? (
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.bodyText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {details.category
                      ? details.description
                        ? `${details.category} · ${details.description}`
                        : details.category
                      : details.description}
                  </Text>
                ) : null}
                <StatusPill
                  label={
                    connected
                      ? "متصل"
                      : details.connectionState === "missing"
                        ? "غير موجود على الخادم"
                        : details.connectionState === "unavailable"
                          ? "تعذّر التحقق من الاتصال"
                        : "غير متصل"
                  }
                  tone={connected ? "green" : "amber"}
                />
              </View>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>
                تاريخ الربط
              </Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>
                {formatDate(details.connectedAt)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>
                آخر تحديث
              </Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>
                {formatDate(details.lastSyncedAt)}
              </Text>
            </View>
            {details.externalUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(details.externalUrl!)}
              >
                <Text style={[styles.link, { color: colors.primary }]}>
                  فتح الملف الشخصي على المنصة
                </Text>
              </Pressable>
            ) : null}
            {platform === "facebook" ? (
              <View style={styles.facebookQuickActions}>
                <ActionButton
                  label="إنشاء منشور"
                  icon="plus"
                  onPress={() =>
                    router.push({ pathname: "/compose", params: { channel: "facebook" } })
                  }
                  disabled={!connected}
                />
                {details.externalUrl ? (
                  <ActionButton
                    label="فتح صفحة فيسبوك"
                    icon="external-link"
                    secondary
                    onPress={() => void Linking.openURL(details.externalUrl!)}
                  />
                ) : null}
              </View>
            ) : null}
          </Panel>

          {performance ? (
            <Panel>
              <SectionTitle title="أداء النشر عبر MenaFlow" />
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                أرقام مستخرجة من سجل منشوراتك وعمليات النشر لهذا الحساب، وليست تحليلات Meta.
              </Text>
              <View style={styles.metricsGrid}>
                {[
                  { label: "منشورات منشورة", value: performance.publishedCount, tint: colors.facebook },
                  { label: "بانتظار موعد", value: performance.scheduledCount, tint: colors.primary },
                  { label: "بانتظار المراجعة", value: performance.reviewCount, tint: colors.warning },
                  { label: "تحتاج مراجعة", value: performance.failedCount, tint: colors.destructive },
                ].map(({ label, value, tint }) => (
                  <View
                    key={String(label)}
                    style={[
                      styles.performanceCard,
                      { borderColor: colors.border, backgroundColor: colors.background },
                    ]}
                  >
                    <Text style={[styles.metricValue, { color: tint }]}>
                      {formatCount(value)}
                    </Text>
                    <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.performanceSummary}>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  محاولات فريدة: {formatCount(performance.attemptedCount)}
                </Text>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  نسبة النجاح: {performance.successRate === null
                    ? "لا توجد محاولات"
                    : `${formatCount(performance.successRate)}٪`}
                </Text>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  منشورات مولّدة بالذكاء الاصطناعي ونُشرت: {formatCount(performance.aiPublishedCount)}
                </Text>
              </View>

              <View style={styles.performanceSection}>
                <Text style={[styles.performanceHeading, { color: colors.foreground }]}>
                  المنشورات المنشورة خلال آخر 30 يومًا
                </Text>
                {performance.weeklyPublished.map((week) => {
                  const maxCount = Math.max(
                    1,
                    ...performance.weeklyPublished.map((item) => item.count),
                  );
                  return (
                    <View key={week.label} style={styles.weekRow}>
                      <Text style={[styles.weekLabel, { color: colors.mutedForeground }]}>
                        {week.label}
                      </Text>
                      <View
                        style={[
                          styles.weekTrack,
                          { backgroundColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.weekBar,
                            {
                              backgroundColor: colors.facebook,
                              width: `${Math.max(week.count > 0 ? 4 : 0, (week.count / maxCount) * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.weekCount, { color: colors.foreground }]}>
                        {formatCount(week.count)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.performanceSection}>
                <Text style={[styles.performanceHeading, { color: colors.foreground }]}>
                  آخر النشاطات
                </Text>
                {performance.recentActivity.length > 0 ? (
                  performance.recentActivity.slice(0, 8).map((event) => (
                    <View
                      key={event.id}
                      style={[styles.activityCard, { borderColor: colors.border }]}
                    >
                      <View style={styles.activityTopRow}>
                        <Text style={[styles.activityTitle, { color: colors.foreground }]}>
                          {event.title || "منشور"}
                        </Text>
                        <Text style={[styles.activityStatus, {
                          color: event.eventType === "publish_failed" ||
                            event.eventType === "publish_uncertain"
                            ? colors.destructive
                            : event.eventType === "publish_succeeded" ||
                                event.eventType === "publish_verified"
                              ? colors.green
                              : colors.mutedForeground,
                        }]}>
                          {activityLabel(event.eventType)}
                        </Text>
                      </View>
                      <Text style={[styles.metaValue, { color: colors.mutedForeground }]}>
                        {formatDate(event.occurredAt)} · {event.actorLabel}
                        {event.attempt ? ` · المحاولة ${formatCount(event.attempt)}` : ""}
                      </Text>
                      {event.reason ? (
                        <Text style={[styles.activityReason, { color: colors.destructive }]}>
                          السبب: {event.reason}
                        </Text>
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                    لا توجد نشاطات مسجلة لهذا الحساب حتى الآن.
                  </Text>
                )}
              </View>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle title="التقارير والإحصائيات" />
            {details.metrics.length > 0 ? (
              <View style={styles.metricsGrid}>
                {details.metrics.map((metric) => (
                  <View
                    key={metric.key}
                    style={[
                      styles.metricCard,
                      { borderColor: colors.border, backgroundColor: colors.background },
                    ]}
                  >
                    <Text style={[styles.metricValue, { color: colors.foreground }]}>
                      {formatCount(metric.value)}
                    </Text>
                    <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
                      {metric.label}
                    </Text>
                    {metric.period ? (
                      <Text style={[styles.metricPeriod, { color: colors.mutedForeground }]}>
                        {metric.period}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                لا توفر واجهة المنصة إحصاءات لهذا الحساب أو أن الصلاحيات غير كافية.
              </Text>
            )}
            {details.issues.map((issue) => (
              <Text key={issue} style={[styles.issue, { color: colors.warning }]}>
                {issue}
              </Text>
            ))}
          </Panel>

          <Panel>
            <SectionTitle
              title={platform === "whatsapp" ? "حالة واتساب والرسائل" : "المنشورات المنشورة"}
            />
            {platform === "whatsapp" ? (
              <>
                <View style={styles.whatsappStatusRow}>
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    المزامنة التلقائية
                  </Text>
                  <StatusPill
                    label={details.autoSyncEnabled ? "مفعلة" : "متوقفة"}
                    tone={details.autoSyncEnabled ? "green" : "muted"}
                  />
                </View>
                {details.groups?.length ? (
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                    المجموعات المحددة: {details.groups.map((group) => group.groupName).join("، ")}
                  </Text>
                ) : null}
              </>
            ) : null}
            {details.posts && details.posts.length > 0 ? (
              <>
                {platform === "facebook" ? (
                  <>
                    <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                      {formatCount(details.posts.length)} منشورًا من أحدث منشورات الصفحة
                    </Text>
                    <View style={styles.filterRow}>
                      {([
                        ["all", "الكل"],
                        ["with-image", "بصور"],
                        ["text-only", "نصية"],
                      ] as const).map(([filter, label]) => {
                        const selected = postFilter === filter;
                        return (
                          <Pressable
                            key={filter}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            onPress={() => setPostFilter(filter)}
                            style={[
                              styles.filterChip,
                              {
                                backgroundColor: selected ? colors.blueSoft : colors.background,
                                borderColor: selected ? colors.facebook : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.filterLabel,
                                { color: selected ? colors.facebook : colors.mutedForeground },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {visiblePosts.length > 0 ? (
                  <View style={styles.list}>
                    {visiblePosts.map((post) => (
                  <View
                    key={post.id}
                    style={[styles.postCard, { borderColor: colors.border }]}
                  >
                    {platform === "facebook" ? (
                      <View style={styles.facebookPostHeader}>
                        <View
                          style={[
                            styles.facebookPostIcon,
                            { backgroundColor: colors.blueSoft },
                          ]}
                        >
                          <Icon name="facebook" size={15} color={colors.facebook} />
                        </View>
                        <View style={styles.facebookPostHeading}>
                          <Text
                            style={[
                              styles.facebookPostTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            منشور الصفحة
                          </Text>
                          <Text style={[styles.metaValue, { color: colors.mutedForeground }]}>
                            {formatDate(post.publishedAt)}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    <Text
                      numberOfLines={4}
                      style={[styles.postText, { color: colors.foreground }]}
                    >
                      {post.text || "منشور بدون نص"}
                    </Text>
                    {platform !== "facebook" ? (
                      <Text style={[styles.metaValue, { color: colors.mutedForeground }]}>
                        {formatDate(post.publishedAt)}
                      </Text>
                    ) : null}
                    {platform === "facebook" && post.imageUrl ? (
                      <Image
                        source={{ uri: post.imageUrl }}
                        style={styles.postImage}
                        resizeMode="cover"
                        accessibilityLabel="صورة مرفقة بمنشور فيسبوك"
                      />
                    ) : null}
                    <View style={styles.postStats}>
                      {post.likes !== null ? (
                        <View style={styles.postStat}>
                          <Icon name="heart" size={14} color={colors.facebook} />
                          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                            {formatCount(post.likes)} إعجاب
                          </Text>
                        </View>
                      ) : null}
                      {post.comments !== null ? (
                        <View style={styles.postStat}>
                          <Icon name="message-square" size={14} color={colors.mutedForeground} />
                          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                            {formatCount(post.comments)} تعليق
                          </Text>
                        </View>
                      ) : null}
                      {post.views !== null ? (
                        <View style={styles.postStat}>
                          <Icon name="eye" size={14} color={colors.mutedForeground} />
                          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                            {formatCount(post.views)} مشاهدة
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {post.url ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => void Linking.openURL(post.url!)}
                      >
                        <Text style={[styles.link, { color: colors.primary }]}>
                          فتح المنشور
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    icon="file-text"
                    title="لا توجد منشورات بهذا النوع"
                    body="اختر تصنيفًا آخر لعرض المنشورات المتاحة."
                  />
                )}
              </>
            ) : platform === "whatsapp" && details.messages?.length ? (
              <>
                <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                  {details.groups?.length ?? 0} مجموعة محددة · {formatCount(details.metrics.find((metric) => metric.key === "messages")?.value ?? 0)} رسالة محفوظة
                </Text>
                <View style={styles.list}>
                  {details.messages.map((message) => (
                    <View
                      key={message.id}
                      style={[styles.postCard, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.postText, { color: colors.foreground }]}>
                        {message.groupName}
                      </Text>
                      <Text
                        numberOfLines={4}
                        style={[styles.bodyText, { color: colors.mutedForeground }]}
                      >
                        {message.text || `رسالة ${message.messageType}`}
                      </Text>
                      <Text style={[styles.metaValue, { color: colors.mutedForeground }]}>
                        {formatDate(message.sentAt)}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : platform === "whatsapp" ? (
              <EmptyState
                icon="message-circle"
                title="لا توجد رسائل محفوظة"
                body="اختر مجموعات واتساب من صفحة المصادر، ثم ابدأ المزامنة لعرض الرسائل هنا."
              />
            ) : (
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                لا توجد منشورات متاحة للعرض من واجهة المنصة.
              </Text>
            )}
          </Panel>

        </>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  facebookCover: {
    width: "100%",
    height: 112,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  facebookCoverImage: { width: "100%", height: "100%" },
  facebookPageBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    gap: 5,
  },
  facebookPageLabel: { fontSize: 10, fontWeight: "700" },
  profileImage: { width: 64, height: 64, borderRadius: 32 },
  profilePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCopy: { flex: 1, alignItems: "flex-start", gap: 7 },
  accountName: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metaLabel: { fontSize: 11 },
  metaValue: { fontSize: 11, textAlign: "left" },
  bodyText: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricCard: {
    flexGrow: 1,
    flexBasis: "45%",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 5,
  },
  metricValue: { fontSize: 20, fontWeight: "800" },
  metricLabel: { fontSize: 11, textAlign: "center" },
  metricPeriod: { fontSize: 10, textAlign: "center" },
  performanceCard: {
    flexGrow: 1,
    flexBasis: "45%",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    gap: 5,
  },
  performanceSummary: { gap: 5 },
  performanceSection: { gap: 8 },
  performanceHeading: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  weekRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  weekLabel: { width: 58, fontSize: 10, textAlign: "right" },
  weekTrack: { flex: 1, height: 8, borderRadius: 5, overflow: "hidden" },
  weekBar: { height: "100%", borderRadius: 5, alignSelf: "flex-start" },
  weekCount: { width: 28, fontSize: 10, textAlign: "left" },
  activityCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 5 },
  activityTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  activityTitle: { flex: 1, fontSize: 12, fontWeight: "700", textAlign: "right" },
  activityStatus: { fontSize: 10, fontWeight: "700", textAlign: "right" },
  activityReason: { fontSize: 11, lineHeight: 17, textAlign: "left" },
  list: { gap: 8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterLabel: { fontSize: 11, fontWeight: "700" },
  postCard: { borderWidth: 1, borderRadius: 13, padding: 11, gap: 7 },
  facebookPostHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  facebookPostIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  facebookPostHeading: { flex: 1, alignItems: "flex-start", gap: 2 },
  facebookPostTitle: { fontSize: 11, fontWeight: "700", textAlign: "right" },
  postImage: { width: "100%", height: 190, borderRadius: 10, backgroundColor: "#EAF2FC" },
  postText: { fontSize: 12, lineHeight: 19, textAlign: "left", fontWeight: "700" },
  postStats: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  postStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  whatsappStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  issue: { fontSize: 11, lineHeight: 17, textAlign: "left" },
  permissionText: { fontSize: 11, textAlign: "left" },
  link: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  facebookQuickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  error: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  disconnectAction: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 13,
  },
  disconnectLabel: { fontSize: 12, fontWeight: "700" },
});
