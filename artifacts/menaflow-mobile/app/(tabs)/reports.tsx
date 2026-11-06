import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { ActionButton, BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import { getGetSocialConnectionsQueryKey, getSocialConnections } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { isLocalAuthDisabled } from '@/constants/auth';

export default function ReportsScreen() {
  if (isLocalAuthDisabled) return <ReportsScreenContent userId={null} />;
  return <AuthenticatedReportsScreen />;
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

      <View style={styles.rangeSection}>
        <Text style={[styles.rangeTitle, { color: colors.foreground }]}>
          فترة التقرير
        </Text>
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
      </View>

      <View style={styles.statsGrid}>
        {[
          { label: 'إجمالي المحتوى', value: reportPosts.length, icon: 'file-text' as const, status: 'all' },
          { label: 'مسودات', value: draft, icon: 'edit-3' as const, status: 'draft' },
          { label: 'قيد المراجعة', value: review, icon: 'eye' as const, status: 'review' },
          { label: 'منشورات منشورة', value: published, icon: 'send' as const, status: 'published' },
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
              <Icon name={item.icon} size={18} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>{item.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
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
          <View style={[styles.channelItem, { borderColor: colors.border }]}>
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
                  {igPosts} عنصر محتوى مخصص لهذه القناة
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border }]}>
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
                  {fbPosts} عنصر محتوى مخصص لهذه القناة
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.channelItem, { borderColor: colors.border }]}>
            <View style={styles.channelMeta}>
              <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                <Icon name="message-circle" size={18} color={colors.whatsapp} />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelTitle, { color: colors.foreground }]}>
                  واتساب
                </Text>
                <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                  {waPosts} عنصر محتوى مخصص لهذه القناة
                </Text>
              </View>
            </View>
          </View>
        </View>
        {connectionsQuery.isError ? (
          <View style={styles.connectionNotice}>
            <Text style={[styles.connectionNoticeText, { color: colors.mutedForeground }]}>
              تعذّر التحقق من ربط حسابات النشر. أعداد المحتوى أعلاه مستقلة عن حالة الربط.
            </Text>
            <ActionButton
              label="إعادة المحاولة"
              icon="refresh-cw"
              secondary
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
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <View style={styles.progressRow}>
              <View style={styles.progressLabelLine}>
                <Text style={[styles.progressValue, { color: item.tint }]}>
                  {item.value}
                </Text>
                <Text
                  style={[styles.progressLabel, { color: colors.foreground }]}
                >
                  {item.label}
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
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  rangeSection: { gap: 8 },
  rangeTitle: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  rangeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rangeChip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11 },
  rangeChipText: { fontSize: 11, fontWeight: '700' },
  rangeHint: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  connectionNotice: { gap: 10, marginTop: 12 },
  connectionNoticeText: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  statCardPressable: { width: '48%' },
  statCard: { alignItems: 'center', paddingVertical: 15, gap: 7 },
  statValue: { fontSize: 23, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '700' },
  channelsList: { gap: 10, marginTop: 4 },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  channelMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  channelInfo: { alignItems: 'flex-start', gap: 2 },
  channelTitle: { fontSize: 13, fontWeight: '700' },
  channelSub: { fontSize: 11, textAlign: 'left' },
  progressRow: { gap: 7, marginTop: 8 },
  progressLabelLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressValue: { fontSize: 13, fontWeight: '800' },
  progressLabel: { fontSize: 12, fontWeight: '700' },
  track: {
    height: 8,
    borderRadius: 5,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  bar: { height: 8, borderRadius: 5 },
});
