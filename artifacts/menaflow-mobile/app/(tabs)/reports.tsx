import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle, StatusPill } from '@/components/Ui';
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

  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? 'local',
    ] as const,
    queryFn: getSocialConnections,
  });
  const connections = connectionsQuery.data;

  const published = posts.filter((post) => post.status === 'published').length;
  const draft = posts.filter((post) => post.status === 'draft').length;
  const review = posts.filter((post) => post.status === 'review').length;
  const scheduled = posts.filter((post) => post.status === 'scheduled').length;

  const igPosts = posts.filter((p) => p.channels.includes('instagram')).length;
  const fbPosts = posts.filter((p) => p.channels.includes('facebook')).length;
  const waPosts = posts.filter((p) => p.channels.includes('whatsapp')).length;

  const hasConnections = Boolean(connections?.facebook || connections?.instagram);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshPosts(), connectionsQuery.refetch()]);
    setRefreshing(false);
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
      <PageTitle title="التقارير" subtitle="ملخص نشاط مساحة العمل ونتائج القنوات والمزامنة." />

      <Panel style={{ backgroundColor: colors.accent }}>
        <View style={styles.reportHeader}>
          <View style={[styles.reportIcon, { backgroundColor: colors.card }]}>
            <Icon name="bar-chart-2" size={20} color={colors.primary} />
          </View>
          <View style={styles.reportCopy}>
            <Text style={[styles.reportTitle, { color: colors.foreground }]}>
              {syncing ? 'جارٍ المزامنة السحابية...' : 'بيانات مساحة العمل المتزامنة'}
            </Text>
            <Text style={[styles.reportDescription, { color: colors.mutedForeground }]}>
              {hasConnections
                ? 'الحسابات مرتبطة بالخادم وقاعدة البيانات، والمنشورات متزامنة لحظياً.'
                : 'المنشورات متزامنة سحابياً. اربط حساباتك الاجتماعية لتفعيل النشر والتحليلات.'}
            </Text>
          </View>
        </View>
      </Panel>

      <View style={styles.statsGrid}>
        {[
          { label: 'إجمالي المحتوى', value: posts.length, icon: 'file-text' as const },
          { label: 'مسودات جاهزة', value: draft, icon: 'edit-3' as const },
          { label: 'قيد المراجعة', value: review, icon: 'eye' as const },
          { label: 'منشورة بنجاح', value: published, icon: 'send' as const },
        ].map((item) => (
          <Panel key={item.label} style={styles.statCard}>
            <Icon name={item.icon} size={18} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{item.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
          </Panel>
        ))}
      </View>

      <Panel>
        <SectionTitle
          title="أداء المنصات والقنوات"
          action={
            <Pressable onPress={() => router.push('/(tabs)/sources')}>
              <Text style={[styles.link, { color: colors.primary }]}>إدارة القنوات</Text>
            </Pressable>
          }
        />
        {!hasConnections ? (
          <EmptyState
            icon="link-2"
            title="اربط حساباتك لعرض التحليلات المباشرة"
            body="اربط صفحة فيسبوك وحساب إنستغرام الاحترافي لبدء جدولة المحتوى ورصد الأداء."
          />
        ) : (
          <View style={styles.channelsList}>
            {connections?.instagram && (
              <View style={[styles.channelItem, { borderColor: colors.border }]}>
                <View style={styles.channelMeta}>
                  <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                    <Icon name="instagram" size={18} color={colors.instagram} />
                  </View>
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelTitle, { color: colors.foreground }]}>
                      إنستغرام (@{connections.instagram.accountName})
                    </Text>
                    <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                      {igPosts} منشور مخصص لهذه القناة
                    </Text>
                  </View>
                </View>
                <StatusPill label="متصل" tone="green" />
              </View>
            )}

            {connections?.facebook && (
              <View style={[styles.channelItem, { borderColor: colors.border }]}>
                <View style={styles.channelMeta}>
                  <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                    <Icon name="facebook" size={18} color={colors.facebook} />
                  </View>
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelTitle, { color: colors.foreground }]}>
                      فيسبوك ({connections.facebook.accountName})
                    </Text>
                    <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                      {fbPosts} منشور مخصص لهذه القناة
                    </Text>
                  </View>
                </View>
                <StatusPill label="متصل" tone="green" />
              </View>
            )}

            <View style={[styles.channelItem, { borderColor: colors.border }]}>
              <View style={styles.channelMeta}>
                <View style={[styles.channelIconWrap, { backgroundColor: colors.accent }]}>
                  <Icon name="message-circle" size={18} color={colors.whatsapp} />
                </View>
                <View style={styles.channelInfo}>
                  <Text style={[styles.channelTitle, { color: colors.foreground }]}>واتساب للأعمال</Text>
                  <Text style={[styles.channelSub, { color: colors.mutedForeground }]}>
                    {waPosts} رسالة/منشور مخصص
                  </Text>
                </View>
              </View>
              <StatusPill label="غير مربوط" tone="muted" />
            </View>
          </View>
        )}
      </Panel>

      <Panel>
        <SectionTitle title="حالة سير العمل والمحتوى" />
        {[
          { label: 'المسودات', value: draft, tint: colors.blue },
          { label: 'قيد المراجعة', value: review, tint: colors.warning },
          { label: 'مجدولة', value: scheduled, tint: colors.instagram },
          { label: 'منشورة فعلياً', value: published, tint: colors.primary },
        ].map((item) => (
          <View key={item.label} style={styles.progressRow}>
            <View style={styles.progressLabelLine}>
              <Text style={[styles.progressValue, { color: item.tint }]}>{item.value}</Text>
              <Text style={[styles.progressLabel, { color: colors.foreground }]}>{item.label}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.secondary }]}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: item.tint,
                    width: `${posts.length ? Math.min(100, (item.value / posts.length) * 100) : 0}%`,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  reportHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  reportIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reportCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  reportTitle: { fontSize: 15, fontWeight: '800' },
  reportDescription: { fontSize: 11, textAlign: 'right', lineHeight: 17 },
  statsGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 9 },
  statCard: { width: '48%', alignItems: 'center', paddingVertical: 15, gap: 7 },
  statValue: { fontSize: 23, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '700' },
  channelsList: { gap: 10, marginTop: 4 },
  channelItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  channelMeta: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  channelIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  channelInfo: { alignItems: 'flex-end', gap: 2 },
  channelTitle: { fontSize: 13, fontWeight: '700' },
  channelSub: { fontSize: 11 },
  progressRow: { gap: 7, marginTop: 8 },
  progressLabelLine: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  progressValue: { fontSize: 13, fontWeight: '800' },
  progressLabel: { fontSize: 12, fontWeight: '700' },
  track: { height: 8, borderRadius: 5, overflow: 'hidden', alignItems: 'flex-end' },
  bar: { height: 8, borderRadius: 5 },
});
