import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { ActionButton, BrandHeader, EmptyState, Page, Panel, SectionTitle } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import { getGetSocialConnectionsQueryKey, getPostReportSummary, getSocialConnections } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { isLocalAuthDisabled } from '@/constants/auth';
import { getProductExtractionMetrics, type ProductExtractionMetrics } from '@/lib/product-catalog-api';

export function ReportsScreen() {
  if (isLocalAuthDisabled) return <ReportsScreenContent userId={null} />;
  return <AuthenticatedReportsScreen />;
}

function AuthenticatedReportsScreen() {
  const { userId } = useAuth();
  return <ReportsScreenContent userId={userId ?? null} />;
}

function ReportsScreenContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<"all" | "7" | "30">("30");

  const reportSummaryQuery = useQuery({
    queryKey: ['posts', 'report-summary', userId ?? 'local', dateRange],
    queryFn: () => getPostReportSummary({ range: dateRange }),
  });
  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? 'local',
    ] as const,
    queryFn: getSocialConnections,
  });
  const extractionMetricsQuery = useQuery({
    queryKey: ['product-extraction-metrics', userId ?? 'local'],
    queryFn: getProductExtractionMetrics,
  });
  const connections = connectionsQuery.data;

  const summary = reportSummaryQuery.data;
  const published = summary?.published ?? 0;
  const draft = summary?.draft ?? 0;
  const review = summary?.review ?? 0;
  const scheduled = summary?.scheduled ?? 0;
  const approved = summary?.approved ?? 0;
  const publishing = summary?.publishing ?? 0;
  const failed = summary?.failed ?? 0;
  const igPosts = summary?.instagram ?? 0;
  const fbPosts = summary?.facebook ?? 0;
  const waPosts = summary?.whatsapp ?? 0;
  const totalPosts = summary?.total ?? 0;
  const displayCount = (value: number) => summary ? value : "—";

  const hasConnections = Boolean(connections?.facebook || connections?.instagram);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        reportSummaryQuery.refetch(),
        connectionsQuery.refetch(),
        extractionMetricsQuery.refetch(),
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
            reportSummaryQuery.isFetching ||
            connectionsQuery.isFetching
          }
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader
        title="التقارير"
        subtitle="ملخص المحتوى وحالاته وتوزيعه على القنوات."
        back={{ href: "/(tabs)/more", label: "العودة إلى المزيد" }}
      />

      <SectionTitle title="استخراج المنتجات من الرسائل" />
      <ExtractionMetricsPanel
        metrics={extractionMetricsQuery.data}
        loading={extractionMetricsQuery.isLoading}
        error={extractionMetricsQuery.isError}
        onRetry={() => void extractionMetricsQuery.refetch()}
      />

      {reportSummaryQuery.isError ? (
        <Panel style={styles.connectionNotice}>
          <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
            تعذّر تحميل أرقام التقرير كاملة من الخادم.
          </Text>
          <ActionButton
            label={reportSummaryQuery.isFetching ? "جارٍ التحميل…" : "إعادة المحاولة"}
            icon={reportSummaryQuery.isFetching ? "clock" : "refresh-cw"}
            secondary
            disabled={reportSummaryQuery.isFetching}
            onPress={() => void reportSummaryQuery.refetch()}
          />
        </Panel>
      ) : reportSummaryQuery.isLoading ? (
        <Text style={[styles.rangeHint, { color: colors.mutedForeground }]}>
          جارٍ تحميل ملخص جميع المنشورات…
        </Text>
      ) : null}

      <Panel style={styles.rangeSection}>
        <View style={styles.rangeHeading}>
          <View style={styles.rangeTitleGroup}>
            <View
              style={[styles.rangeIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="clock" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.rangeTitle, { color: colors.foreground }]}>
              فترة التقرير
            </Text>
          </View>
          <View
            style={[styles.rangeBadge, { backgroundColor: colors.secondary }]}
          >
            <Text style={[styles.rangeBadgeText, { color: colors.foreground }]}>
              {dateRange === "all"
                ? "كل الفترات"
                : dateRange === "7"
                  ? "7 أيام"
                  : "30 يوماً"}
            </Text>
          </View>
        </View>
        <View style={styles.rangeOptions}>
          {[
            { value: "7" as const, label: "آخر 7 أيام" },
            { value: "30" as const, label: "آخر 30 يوماً" },
            { value: "all" as const, label: "كل الفترات" },
          ].map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected: dateRange === item.value }}
              onPress={() => setDateRange(item.value)}
              style={[
                styles.rangeChip,
                {
                  backgroundColor:
                    dateRange === item.value ? colors.primary : colors.secondary,
                  borderColor:
                    dateRange === item.value ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.rangeChipText,
                  {
                    color:
                      dateRange === item.value
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
        <Text style={[styles.rangeHint, { color: colors.mutedForeground }]}>
          تُحتسب العناصر حسب تاريخ الرسالة المصدر، أو تاريخ إنشاء المحتوى عند عدم توفره. هذه مؤشرات حجم وليست بيانات الوصول أو التفاعل.
        </Text>
      </Panel>

      <View style={styles.statsGrid}>
        {[
          { label: 'إجمالي المحتوى', value: displayCount(totalPosts), icon: 'file-text' as const, tint: colors.primary, status: 'all' },
          { label: 'مسودات', value: displayCount(draft), icon: 'edit-3' as const, tint: colors.blue, status: 'draft' },
          { label: 'قيد المراجعة', value: displayCount(review), icon: 'eye' as const, tint: colors.warning, status: 'review' },
          { label: 'منشورات منشورة', value: displayCount(published), icon: 'send' as const, tint: colors.green, status: 'published' },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={`عرض ${item.label} في المحتوى`}
            onPress={() =>
              router.push({
                pathname: "/(tabs)/content",
                params: {
                  status: item.status,
                  date: dateRange,
                },
              })
            }
            style={({ pressed }) => [
              styles.statCardPressable,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Panel style={styles.statCard}>
              <View style={styles.statCardHeading}>
                <View
                  style={[
                    styles.statIcon,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  <Icon name={item.icon} size={17} color={item.tint} />
                </View>
                <Text style={[styles.statValue, { color: item.tint }]}>
                  {item.value}
                </Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {item.label}
              </Text>
            </Panel>
          </Pressable>
        ))}
      </View>

      <Panel>
        <SectionTitle
          title="المحتوى المخصص لكل قناة"
          action={
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push("/(tabs)/more/accounts")
              }
              hitSlop={10}
            >
              <Text style={[styles.link, { color: colors.primary }]}>حسابات النشر</Text>
            </Pressable>
          }
        />
        <View style={styles.channelsList}>
          <View style={[styles.channelItem, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="instagram" size={18} color={colors.instagram} />
              </View>
              <View style={styles.channelInfo}>
                <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.channelTitle, { color: colors.foreground }]}>
                  {connections?.instagram
                    ? `إنستغرام (@${connections.instagram.accountName})`
                    : "إنستغرام"}
                </Text>
                <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                  محتوى مخصص للقناة
                </Text>
              </View>
            </View>
            <View style={[styles.channelCount, { backgroundColor: colors.accent }]}>
              <Text style={[styles.channelCountText, { color: colors.instagram }]}>{displayCount(igPosts)}</Text>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="facebook" size={18} color={colors.facebook} />
              </View>
              <View style={styles.channelInfo}>
                <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.channelTitle, { color: colors.foreground }]}>
                  {connections?.facebook
                    ? `فيسبوك (${connections.facebook.accountName})`
                    : "فيسبوك"}
                </Text>
                <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                  محتوى مخصص للقناة
                </Text>
              </View>
            </View>
            <View style={[styles.channelCount, { backgroundColor: colors.accent }]}>
              <Text style={[styles.channelCountText, { color: colors.facebook }]}>{displayCount(fbPosts)}</Text>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="whatsapp" size={18} color={colors.whatsapp} />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelTitle, { color: colors.foreground }]}>
                  واتساب
                </Text>
                <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                  محتوى مخصص للقناة
                </Text>
              </View>
            </View>
            <View style={[styles.channelCount, { backgroundColor: colors.accent }]}>
              <Text style={[styles.channelCountText, { color: colors.whatsapp }]}>{displayCount(waPosts)}</Text>
            </View>
          </View>
        </View>
        {connectionsQuery.isError ? (
          <View style={styles.connectionNotice}>
            <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
              تعذّر التحقق من ربط حسابات النشر. أعداد المحتوى أعلاه مستقلة عن حالة الربط.
            </Text>
            <ActionButton
              label={connectionsQuery.isFetching ? "جارٍ التحقق…" : "إعادة المحاولة"}
              icon={connectionsQuery.isFetching ? "clock" : "refresh-cw"}
              secondary
              disabled={connectionsQuery.isFetching}
              onPress={() => void connectionsQuery.refetch()}
            />
          </View>
        ) : !connectionsQuery.isLoading && !hasConnections ? (
          <View style={styles.connectionNotice}>
            <EmptyState
              icon="link-2"
              title="لا توجد حسابات نشر مرتبطة"
              body="يمكنك ربط فيسبوك وإنستغرام من قسم حسابات النشر."
            />
            <ActionButton
              label="إدارة حسابات النشر"
              icon="link"
              onPress={() =>
                router.push("/(tabs)/more/accounts")
              }
            />
          </View>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle title="حالة سير العمل والمحتوى" />
        <View style={styles.workflowList}>
          {[
            { label: 'المسودات', value: displayCount(draft), tint: colors.blue, status: 'draft' },
            { label: 'قيد المراجعة', value: displayCount(review), tint: colors.warning, status: 'review' },
            { label: 'معتمدة', value: displayCount(approved), tint: colors.blue, status: 'approved' },
            { label: 'مجدولة', value: displayCount(scheduled), tint: colors.instagram, status: 'scheduled' },
            { label: 'قيد النشر', value: displayCount(publishing), tint: colors.blue, status: 'publishing' },
            { label: 'تعذّر نشرها', value: displayCount(failed), tint: colors.warning, status: 'failed' },
            { label: 'منشورة', value: displayCount(published), tint: colors.primary, status: 'published' },
          ].map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={`عرض ${item.label} في المحتوى`}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/content",
                  params: {
                    status: item.status,
                    date: dateRange,
                  },
                })
              }
              style={({ pressed }) => [
                styles.progressRow,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View style={styles.progressContent}>
                <View style={styles.progressLabelLine}>
                  <View style={styles.progressLabelGroup}>
                    <View
                      style={[
                        styles.progressDot,
                        { backgroundColor: item.tint },
                      ]}
                    />
                    <Text
                      style={[
                        styles.progressLabel,
                        { color: colors.foreground },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </View>
                  <Text style={[styles.progressValue, { color: item.tint }]}>
                    {item.value}
                  </Text>
                </View>
                <View
                  style={[styles.track, { backgroundColor: colors.secondary }]}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: item.tint,
                        width: `${summary && totalPosts ? Math.min(100, (Number(item.value) / totalPosts) * 100) : 0}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      </Panel>
    </Page>
  );
}

function ExtractionMetricsPanel({
  metrics,
  loading,
  error,
  onRetry,
}: {
  metrics: ProductExtractionMetrics | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const colors = useColors();
  if (loading) {
    return (
      <Panel style={styles.connectionNotice}>
        <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
          جارٍ تحميل مؤشرات الاستخراج…
        </Text>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel style={styles.connectionNotice}>
        <Text style={[styles.connectionNoticeText, { color: colors.warning }]}>
          تعذّر تحميل مؤشرات الاستخراج. أعد المحاولة بالتحديث.
        </Text>
        <ActionButton label="إعادة المحاولة" icon="refresh-cw" secondary onPress={onRetry} />
      </Panel>
    );
  }
  if (!metrics) return null;
  const suggestionRows = metrics.suggestions ?? [];
  const productSuggestions = suggestionRows
    .filter((row) => row.classification === "product")
    .reduce((sum, row) => sum + row.total, 0);
  const draftsCreated = suggestionRows
    .filter((row) => row.status === "draft_created")
    .reduce((sum, row) => sum + row.total, 0);
  const funnelSteps = [
    { label: "رسائل عولجت", value: metrics.extractionSucceeded + metrics.extractionFailed },
    { label: "استخراج ناجح", value: metrics.extractionSucceeded },
    { label: "اقتراحات منتج", value: productSuggestions },
    { label: "مسودات أُنشئت", value: draftsCreated },
    { label: "تحديثات معتمدة", value: metrics.proposalsAccepted },
  ];
  const maxFunnel = Math.max(1, ...funnelSteps.map((step) => step.value));
  const dailyByDay = new Map<string, { succeeded: number; failed: number }>();
  for (const row of metrics.daily ?? []) {
    const current = dailyByDay.get(row.day) ?? { succeeded: 0, failed: 0 };
    if (row.event === "EXTRACTION_SUCCEEDED") current.succeeded += row.total;
    if (row.event === "EXTRACTION_FAILED") current.failed += row.total;
    dailyByDay.set(row.day, current);
  }
  const trend = [...dailyByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7);
  const maxTrend = Math.max(
    1,
    ...trend.flatMap(([, value]) => [value.succeeded, value.failed]),
  );
  const metricCards = [
    {
      label: "استخراج ناجح",
      value: metrics.extractionSucceeded,
      filter: "pending",
    },
    {
      label: "تحديثات مقبولة",
      value: metrics.proposalsAccepted,
      filter: "updates",
    },
    {
      label: "مسودات أُنشئت",
      value: draftsCreated,
      filter: "processed",
    },
    {
      label: "نسبة التحويل",
      value: `${Math.round(metrics.conversionRate * 100)}%`,
      filter: "processed",
    },
  ];
  return (
    <View style={styles.extractionMetrics}>
      <View style={styles.extractionMetricGrid}>
        {metricCards.map((card) => (
          <Pressable
            key={card.label}
            accessibilityRole="button"
            accessibilityLabel={`عرض ${card.label} في المراجعة`}
            onPress={() =>
              router.push({
                pathname: "/(tabs)/products",
                params: { tab: "extractions", filter: card.filter },
              })
            }
            style={({ pressed }) => [
              styles.extractionMetricCard,
              { borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={[styles.extractionMetricValue, { color: colors.primary }]}>
              {typeof card.value === "number" ? String(card.value) : card.value}
            </Text>
            <Text style={[styles.extractionMetricLabel, { color: colors.mutedForeground }]}>
              {card.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Panel style={styles.connectionNotice}>
        <Text style={[styles.connectionNoticeText, { color: colors.foreground }]}>
          مسار التحويل خلال آخر 7 أيام
        </Text>
        {funnelSteps.map((step, index) => (
          <View key={step.label} style={styles.funnelStep}>
            <View style={styles.progressLabelLine}>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                {index + 1}. {step.label}
              </Text>
              <Text style={[styles.progressValue, { color: colors.foreground }]}>
                {step.value}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.secondary }]}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${Math.round((step.value / maxFunnel) * 100)}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
          </View>
        ))}
        <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
          فاشل: {metrics.extractionFailed} · أُعيد تحليلها: {metrics.reprocessed}
        </Text>
      </Panel>
      <Panel style={styles.connectionNotice}>
        <Text style={[styles.connectionNoticeText, { color: colors.foreground }]}>
          اتجاه الاستخراج خلال آخر 7 أيام
        </Text>
        {trend.length ? (
          <View style={styles.trendRows}>
            {trend.map(([day, value]) => (
              <View key={day} style={styles.trendRow}>
                <Text style={[styles.trendDay, { color: colors.mutedForeground }]}>
                  {day.slice(5)}
                </Text>
                <View style={[styles.track, { backgroundColor: colors.secondary }]}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${Math.round((value.succeeded / maxTrend) * 100)}%`,
                        backgroundColor: colors.green,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.trendValue, { color: colors.foreground }]}>
                  {value.succeeded}/{value.failed}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
            لا توجد أحداث استخراج في آخر 7 أيام.
          </Text>
        )}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  rangeSection: { gap: 12 },
  rangeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rangeTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  rangeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeBadge: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rangeBadgeText: { fontSize: 12.5, fontWeight: '700' },
  rangeTitle: { fontSize: 14, fontWeight: '800', textAlign: 'right' },
  rangeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rangeChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 11,
    borderWidth: 1,
  },
  rangeChipText: { fontSize: 13, fontWeight: '700' },
  rangeHint: { fontSize: 13, lineHeight: 19, textAlign: 'right' },
  extractionMetrics: { gap: 9 },
  extractionMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  extractionMetricCard: {
    flexGrow: 1,
    minWidth: 120,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  extractionMetricValue: { fontSize: 22, fontWeight: '800' },
  extractionMetricLabel: { fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  funnelStep: { gap: 4, paddingVertical: 4 },
  trendRows: { gap: 6 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trendDay: { width: 42, fontSize: 12, textAlign: 'right' },
  trendValue: { minWidth: 46, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  connectionNotice: { gap: 10, marginTop: 12, padding: 12, borderRadius: 14 },
  connectionNoticeText: { fontSize: 13.5, lineHeight: 20, textAlign: 'right' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  statCardPressable: { width: '48%', minWidth: 135 },
  statCard: { gap: 12, padding: 14, minHeight: 104, justifyContent: 'space-between' },
  statCardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 25, fontWeight: '800' },
  statLabel: { fontSize: 13.5, fontWeight: '600' },
  link: { fontSize: 13.5, fontWeight: '700' },
  channelsList: { gap: 9, marginTop: 12 },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 68,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 15,
  },
  channelMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelIconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  channelInfo: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 3 },
  channelTitle: { maxWidth: '100%', fontSize: 14, fontWeight: '700', textAlign: 'right' },
  channelSub: { fontSize: 13, textAlign: 'right' },
  channelCount: { minWidth: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 8 },
  channelCountText: { fontSize: 14, fontWeight: '800' },
  workflowList: { gap: 4, marginTop: 8 },
  progressRow: { borderRadius: 12, paddingHorizontal: 10 },
  progressContent: { gap: 8, paddingVertical: 10 },
  progressLabelLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressValue: { fontSize: 14, fontWeight: '800' },
  progressLabel: { fontSize: 13.5, fontWeight: '700' },
  track: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'flex-end',
  },
  bar: { height: 7, borderRadius: 4 },
});
