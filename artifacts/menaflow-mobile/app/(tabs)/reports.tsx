import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';

export default function ReportsScreen() {
  const colors = useColors();
  const { posts } = useStudio();
  const published = posts.filter((post) => post.status === 'published').length;
  const draft = posts.filter((post) => post.status === 'draft').length;
  const review = posts.filter((post) => post.status === 'review').length;

  return (
    <Page>
      <BrandHeader />
      <PageTitle title="التقارير" subtitle="ملخص نشاط مساحة العمل ونتائج القنوات." />
      <Panel style={{ backgroundColor: colors.accent }}>
        <View style={styles.reportHeader}>
          <View style={[styles.reportIcon, { backgroundColor: colors.card }]}><Feather name="bar-chart-2" size={20} color={colors.primary} /></View>
          <View style={styles.reportCopy}>
            <Text style={[styles.reportTitle, { color: colors.foreground }]}>ملخص محلي</Text>
            <Text style={[styles.reportDescription, { color: colors.mutedForeground }]}>هذه الأعداد من المنشورات المحفوظة على جهازك فقط.</Text>
          </View>
        </View>
      </Panel>
      <View style={styles.statsGrid}>
        {[
          { label: 'كل المنشورات', value: posts.length, icon: 'file-text' as const },
          { label: 'مسودات', value: draft, icon: 'edit-3' as const },
          { label: 'قيد المراجعة', value: review, icon: 'eye' as const },
          { label: 'منشورة', value: published, icon: 'send' as const },
        ].map((item) => (
          <Panel key={item.label} style={styles.statCard}>
            <Feather name={item.icon} size={18} color={colors.primary} />
            <Text style={[styles.statValue, { color: colors.foreground }]}>{item.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
          </Panel>
        ))}
      </View>
      <Panel>
        <SectionTitle title="أداء المنصات" />
        <EmptyState icon="link-2" title="اربط حساباتك لعرض الأداء" body="الوصول والوصول العضوي والتفاعل ستظهر بعد تفعيل الربط ومزامنة بيانات الحساب." />
      </Panel>
      <Panel>
        <SectionTitle title="حالة سير العمل" />
        {[
          { label: 'المسودات', value: draft, tint: colors.blue },
          { label: 'قيد المراجعة', value: review, tint: colors.warning },
          { label: 'منشورة محلياً', value: published, tint: colors.primary },
        ].map((item) => (
          <View key={item.label} style={styles.progressRow}>
            <View style={styles.progressLabelLine}>
              <Text style={[styles.progressValue, { color: item.tint }]}>{item.value}</Text>
              <Text style={[styles.progressLabel, { color: colors.foreground }]}>{item.label}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.secondary }]}>
              <View style={[styles.bar, { backgroundColor: item.tint, width: `${posts.length ? Math.min(100, (item.value / posts.length) * 100) : 0}%` }]} />
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
  progressRow: { gap: 7 },
  progressLabelLine: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  progressValue: { fontSize: 13, fontWeight: '800' },
  progressLabel: { fontSize: 12, fontWeight: '700' },
  track: { height: 8, borderRadius: 5, overflow: 'hidden', alignItems: 'flex-end' },
  bar: { height: 8, borderRadius: 5 },
});
