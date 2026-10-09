import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/context/StudioContext';
import { ActionButton, BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle, StatusPill } from '@/components/Ui';

const metrics = [
  { label: 'مسودات', icon: 'edit-3' as const, status: 'draft' },
  { label: 'بانتظار المراجعة', icon: 'eye' as const, status: 'review' },
  { label: 'منشورة', icon: 'send' as const, status: 'published' },
];

export default function HomeScreen() {
  const colors = useColors();
  const { posts } = useStudio();
  const count = (status: string) => posts.filter((post) => post.status === status).length;

  return (
    <Page>
      <BrandHeader showBell />
      <PageTitle title="مرحباً بك في MenaFlow" subtitle="إدارة محتواك وحساباتك من مكان واحد." />
      <View style={[styles.hero, { backgroundColor: colors.accent }]}>
        <View style={[styles.heroOrb, { backgroundColor: colors.primary }]} />
        <View style={styles.heroText}>
          <Text style={[styles.heroEyebrow, { color: colors.primary }]}>مساحة عملك</Text>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>ابدأ بخطوة بسيطة</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>أنشئ مسودة، راجعها، ثم اربط قنواتك للنشر.</Text>
          <ActionButton label="إنشاء محتوى" icon="plus" onPress={() => router.push('/(tabs)/content')} />
        </View>
        <View style={[styles.heroIllustration, { backgroundColor: colors.card }]}>
          <Feather name="send" size={32} color={colors.primary} />
          <View style={[styles.heroMiniBadge, { backgroundColor: colors.blueSoft }]}>
            <Feather name="check" size={14} color={colors.blue} />
          </View>
        </View>
      </View>
      <View style={styles.metricsRow}>
        {metrics.map((metric) => (
          <Panel key={metric.status} style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.accent }]}>
              <Feather name={metric.icon} size={17} color={colors.primary} />
            </View>
            <Text style={[styles.metricNumber, { color: colors.foreground }]}>{count(metric.status)}</Text>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{metric.label}</Text>
          </Panel>
        ))}
      </View>
      <Panel>
        <SectionTitle title="حساباتك الاجتماعية" action={<Pressable onPress={() => router.push('/(tabs)/sources')}><Text style={[styles.link, { color: colors.primary }]}>إدارة الحسابات</Text></Pressable>} />
        <View style={styles.channelRow}>
          {[
            { name: 'إنستغرام', icon: 'instagram' as const, tint: colors.instagram },
            { name: 'فيسبوك', icon: 'facebook' as const, tint: colors.facebook },
            { name: 'واتساب', icon: 'message-circle' as const, tint: colors.whatsapp },
          ].map((channel) => (
            <Pressable key={channel.name} onPress={() => router.push('/(tabs)/sources')} style={[styles.channelTile, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Feather name={channel.icon} size={23} color={channel.tint} />
              <Text style={[styles.channelName, { color: colors.foreground }]}>{channel.name}</Text>
              <Text style={[styles.channelState, { color: colors.mutedForeground }]}>غير مربوط</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.helperNote, { color: colors.mutedForeground }]}>لن تظهر بيانات الأداء حتى تربط حساباتك.</Text>
      </Panel>
      <Panel>
        <SectionTitle title="أحدث المحتوى" action={<Pressable onPress={() => router.push('/(tabs)/content')}><Text style={[styles.link, { color: colors.primary }]}>عرض الكل</Text></Pressable>} />
        {posts.length === 0 ? (
          <EmptyState icon="file-text" title="مساحة المحتوى جاهزة" body="ابدأ بكتابة أول منشور. ستحفظ المسودات على هذا الجهاز." />
        ) : posts.slice(0, 3).map((post) => (
          <View key={post.id} style={[styles.activityRow, { borderBottomColor: colors.border }]}>
            <View style={styles.activityCopy}>
              <Text numberOfLines={1} style={[styles.activityTitle, { color: colors.foreground }]}>{post.title || post.body}</Text>
              <Text numberOfLines={1} style={[styles.activityMeta, { color: colors.mutedForeground }]}>{post.channels.map((channel) => channel === 'instagram' ? 'إنستغرام' : channel === 'facebook' ? 'فيسبوك' : 'واتساب').join('، ') || 'بدون قنوات'}</Text>
            </View>
            <StatusPill label={post.status === 'review' ? 'مراجعة' : post.status === 'draft' ? 'مسودة' : post.status === 'scheduled' ? 'مجدول' : 'منشور'} tone={post.status === 'review' ? 'amber' : post.status === 'published' ? 'green' : 'muted'} />
          </View>
        ))}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 214, borderRadius: 24, padding: 18, overflow: 'hidden', flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  heroOrb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, opacity: 0.08, left: -76, bottom: -115 },
  heroText: { flex: 1, alignItems: 'flex-end', gap: 10, zIndex: 1 },
  heroEyebrow: { fontSize: 12, fontWeight: '800' },
  heroTitle: { fontSize: 20, fontWeight: '800', textAlign: 'right' },
  heroBody: { fontSize: 13, lineHeight: 19, textAlign: 'right', maxWidth: 220 },
  heroIllustration: { width: 82, height: 82, borderRadius: 26, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  heroMiniBadge: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', position: 'absolute', top: -5, right: -5 },
  metricsRow: { flexDirection: 'row-reverse', gap: 8 },
  metricCard: { flex: 1, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 13, gap: 5 },
  metricIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  metricNumber: { fontSize: 21, fontWeight: '800' },
  metricLabel: { fontSize: 10, textAlign: 'center', fontWeight: '600' },
  link: { fontSize: 12, fontWeight: '700' },
  channelRow: { flexDirection: 'row-reverse', gap: 8 },
  channelTile: { flex: 1, minHeight: 90, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  channelName: { fontSize: 12, fontWeight: '700' },
  channelState: { fontSize: 10 },
  helperNote: { fontSize: 11, textAlign: 'right' },
  activityRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  activityCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  activityTitle: { fontSize: 13, fontWeight: '700' },
  activityMeta: { fontSize: 11 },
});
