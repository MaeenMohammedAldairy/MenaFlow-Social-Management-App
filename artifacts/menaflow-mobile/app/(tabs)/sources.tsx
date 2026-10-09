import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, BrandHeader, Page, PageTitle, Panel, SectionTitle, StatusPill } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

const sources = [
  { name: 'إنستغرام', provider: 'Instagram Business', icon: 'instagram' as const, color: 'instagram' as const, description: 'إدارة المنشورات ومتابعة التفاعل.' },
  { name: 'فيسبوك', provider: 'Meta Business', icon: 'facebook' as const, color: 'facebook' as const, description: 'إدارة صفحات الأعمال والمحتوى.' },
  { name: 'واتساب', provider: 'WhatsApp Business', icon: 'message-circle' as const, color: 'whatsapp' as const, description: 'إدارة محادثات العملاء ومجموعات العمل.' },
];

export default function SourcesScreen() {
  const colors = useColors();
  const explainSetup = (name: string) => Alert.alert('ربط ' + name, 'الربط المباشر غير مفعّل بعد. يلزم ضبط بيانات OAuth ووجهة العودة في إعدادات الخادم، ثم تفويض الحساب من مالكه. لم يتم إنشاء اتصال تجريبي.');

  return (
    <Page>
      <BrandHeader showBell />
      <PageTitle title="مصادر المحتوى" subtitle="اربط قنواتك لتجهيز المحتوى ومتابعة الحسابات." />
      <Panel style={[styles.setupNotice, { backgroundColor: colors.accent }]}>
        <View style={[styles.noticeIcon, { backgroundColor: colors.accent }]}><Feather name="link-2" size={20} color={colors.primary} /></View>
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>ابدأ بربط حساباتك</Text>
          <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>ستحتاج صلاحية مالك الحساب وتفويضاً رسمياً من المنصة.</Text>
        </View>
      </Panel>
      <View style={styles.stepRow}>
        {['المصدر', 'المعالجة', 'النشر'].map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepNumber, { backgroundColor: index === 0 ? colors.primary : colors.secondary }]}><Text style={{ color: index === 0 ? colors.primaryForeground : colors.mutedForeground, fontWeight: '800', fontSize: 12 }}>{index + 1}</Text></View>
            <Text style={[styles.stepLabel, { color: index === 0 ? colors.primary : colors.mutedForeground }]}>{step}</Text>
          </View>
        ))}
      </View>
      <Panel>
        <SectionTitle title="المنصات المتاحة" />
        {sources.map((source) => (
          <View key={source.name} style={[styles.sourceCard, { borderColor: colors.border }]}>
            <View style={[styles.sourceIcon, { backgroundColor: colors.accent }]}>
              <Feather name={source.icon} size={21} color={colors[source.color]} />
            </View>
            <View style={styles.sourceCopy}>
              <View style={styles.sourceTitleLine}>
                <Text style={[styles.sourceName, { color: colors.foreground }]}>{source.name}</Text>
                <StatusPill label="غير مربوط" />
              </View>
              <Text style={[styles.providerName, { color: colors.mutedForeground }]}>{source.provider}</Text>
              <Text style={[styles.sourceDescription, { color: colors.mutedForeground }]}>{source.description}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`ربط ${source.name}`} onPress={() => explainSetup(source.name)} style={[styles.connectButton, { borderColor: colors.primary }]}>
              <Feather name="link" size={14} color={colors.primary} />
              <Text style={[styles.connectLabel, { color: colors.primary }]}>ربط</Text>
            </Pressable>
          </View>
        ))}
      </Panel>
      <Panel style={{ backgroundColor: colors.accent }}>
        <View style={styles.infoRow}>
          <Feather name="shield" size={19} color={colors.primary} />
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>حماية الوصول</Text>
        </View>
        <Text style={[styles.infoBody, { color: colors.mutedForeground }]}>لن نعرض المنصة كمتصلة قبل اكتمال التفويض الحقيقي. مفاتيح التطبيقات تحفظ على الخادم ولا تُضمّن داخل تطبيق الهاتف.</Text>
        <ActionButton label="إعداد الربط الآمن" icon="settings" secondary onPress={() => explainSetup('المنصات')} />
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  setupNotice: { flexDirection: 'row-reverse', alignItems: 'center' },
  noticeIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  noticeCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  noticeTitle: { fontSize: 14, fontWeight: '800' },
  noticeBody: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  stepRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-around', paddingVertical: 4 },
  step: { alignItems: 'center', gap: 5 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: 10, fontWeight: '700' },
  sourceCard: { borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  sourceIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sourceCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  sourceTitleLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  sourceName: { fontSize: 13, fontWeight: '800' },
  providerName: { fontSize: 10, fontWeight: '600' },
  sourceDescription: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  connectButton: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  connectLabel: { fontSize: 11, fontWeight: '800' },
  infoRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  infoTitle: { fontSize: 14, fontWeight: '800' },
  infoBody: { fontSize: 12, lineHeight: 20, textAlign: 'right' },
});
