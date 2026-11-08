import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { ActionButton, BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';
import { Redirect, router } from 'expo-router';
import { getGetSocialConnectionsQueryKey, getSocialConnections } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { isLocalAuthDisabled } from '@/constants/auth';

export function ReportsScreen() {
  if (isLocalAuthDisabled) return <ReportsScreenContent userId={null} />;
  return <AuthenticatedReportsScreen />;
}

export default function ReportsRoute() {
  return <Redirect href="/(tabs)/more/reports" />;
}

function AuthenticatedReportsScreen() {
  const { userId } = useAuth();
  return <ReportsScreenContent userId={userId ?? null} />;
}

function ReportsScreenContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { posts, refreshPosts, syncing } = useStudio();
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<"all" | "7" | "30">("30");

  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? 'local',
    ] as const,
    queryFn: getSocialConnections,
  });
  const connections = connectionsQuery.data;

  const reportPosts = useMemo(() => {
    if (dateRange === "all") return posts;
    const cutoff = Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000;
    return posts.filter((post) => {
      const reportDate = Date.parse(post.sourceMessageDate || post.createdAt);
      return Number.isFinite(reportDate) && reportDate >= cutoff;
    });
  }, [dateRange, posts]);

  const published = reportPosts.filter((post) => post.status === 'published').length;
  const draft = reportPosts.filter((post) => post.status === 'draft').length;
  const review = reportPosts.filter((post) => post.status === 'review').length;
  const scheduled = reportPosts.filter((post) => post.status === 'scheduled').length;
  const approved = reportPosts.filter((post) => post.status === 'approved').length;
  const publishing = reportPosts.filter((post) => post.status === 'publishing').length;
  const failed = reportPosts.filter((post) => post.status === 'failed').length;

  const igPosts = reportPosts.filter((p) => p.channels.includes('instagram')).length;
  const fbPosts = reportPosts.filter((p) => p.channels.includes('facebook')).length;
  const waPosts = reportPosts.filter((p) => p.channels.includes('whatsapp')).length;

  const hasConnections = Boolean(connections?.facebook || connections?.instagram);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshPosts(), connectionsQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={refreshing || syncing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle title="التقارير" subtitle="ملخص المحتوى وحالاته وتوزيعه على القنوات." />

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
          { label: 'إجمالي المحتوى', value: reportPosts.length, icon: 'file-text' as const, tint: colors.primary, status: 'all' },
          { label: 'مسودات', value: draft, icon: 'edit-3' as const, tint: colors.blue, status: 'draft' },
          { label: 'قيد المراجعة', value: review, icon: 'eye' as const, tint: colors.warning, status: 'review' },
          { label: 'منشورات منشورة', value: published, icon: 'send' as const, tint: colors.green, status: 'published' },
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
                router.push({
                  pathname: "/(tabs)/more/sources",
                  params: { view: "publishing" },
                })
              }
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
                <Text style={[styles.channelTitle, { color: colors.foreground }]}>
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
              <Text style={[styles.channelCountText, { color: colors.instagram }]}>{igPosts}</Text>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="facebook" size={18} color={colors.facebook} />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelTitle, { color: colors.foreground }]}>
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
              <Text style={[styles.channelCountText, { color: colors.facebook }]}>{fbPosts}</Text>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="message-circle" size={18} color={colors.whatsapp} />
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
              <Text style={[styles.channelCountText, { color: colors.whatsapp }]}>{waPosts}</Text>
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
                router.push({
                  pathname: "/(tabs)/more/sources",
                  params: { view: "publishing" },
                })
              }
            />
          </View>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle title="حالة سير العمل والمحتوى" />
        <View style={styles.workflowList}>
          {[
            { label: 'المسودات', value: draft, tint: colors.blue, status: 'draft' },
            { label: 'قيد المراجعة', value: review, tint: colors.warning, status: 'review' },
            { label: 'معتمدة', value: approved, tint: colors.blue, status: 'approved' },
            { label: 'مجدولة', value: scheduled, tint: colors.instagram, status: 'scheduled' },
            { label: 'قيد النشر', value: publishing, tint: colors.blue, status: 'publishing' },
            { label: 'تعذّر نشرها', value: failed, tint: colors.warning, status: 'failed' },
            { label: 'منشورة', value: published, tint: colors.primary, status: 'published' },
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
                        width: `${reportPosts.length ? Math.min(100, (item.value / reportPosts.length) * 100) : 0}%`,
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

const styles = StyleSheet.create({
  rangeSection: { gap: 12 },
  rangeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rangeTitleGroup: {
    flexDirection: 'row-reverse',
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
  rangeBadgeText: { fontSize: 10, fontWeight: '700' },
  rangeTitle: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  rangeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rangeChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
  },
  rangeChipText: { fontSize: 11, fontWeight: '700' },
  rangeHint: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  connectionNotice: { gap: 10, marginTop: 12, padding: 12, borderRadius: 14 },
  connectionNoticeText: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  statCardPressable: { width: '48%', minWidth: 135 },
  statCard: { gap: 12, padding: 14, minHeight: 104, justifyContent: 'space-between' },
  statCardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 25, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '700' },
  channelsList: { gap: 9, marginTop: 12 },
  channelItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 68,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 15,
  },
  channelMeta: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  channelIconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  channelInfo: { alignItems: 'flex-start', gap: 3 },
  channelTitle: { fontSize: 13, fontWeight: '700' },
  channelSub: { fontSize: 10, textAlign: 'right' },
  channelCount: { minWidth: 36, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 8 },
  channelCountText: { fontSize: 14, fontWeight: '800' },
  workflowList: { gap: 4, marginTop: 8 },
  progressRow: { borderRadius: 12, paddingHorizontal: 10 },
  progressContent: { gap: 8, paddingVertical: 10 },
  progressLabelLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabelGroup: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressValue: { fontSize: 13, fontWeight: '800' },
  progressLabel: { fontSize: 12, fontWeight: '700' },
  track: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'flex-end',
  },
  bar: { height: 7, borderRadius: 4 },
});
