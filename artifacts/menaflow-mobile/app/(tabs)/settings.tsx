import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BrandHeader, Page, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';
import { router } from 'expo-router';
import { useClerk, useUser } from '@clerk/expo';

function SettingRow({ icon, title, subtitle, value, onValueChange }: { icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string; value?: boolean; onValueChange?: (next: boolean) => void }) {
  const colors = useColors();
  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      {onValueChange ? <Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.card} /> : <Feather name="chevron-left" size={17} color={colors.mutedForeground} />}
      <View style={styles.settingCopy}>
        <Text style={[styles.settingTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.settingIcon, { backgroundColor: colors.accent }]}><Feather name={icon} size={16} color={colors.primary} /></View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const { preferences, updatePreference } = useStudio();
  const { user } = useUser();
  const { signOut } = useClerk();
  return (
    <Page>
      <BrandHeader />
      <PageTitle title="الإعدادات" subtitle="تحكم في تفضيلات مساحة عملك." />
      <Panel>
        <SectionTitle title="الحساب" />
        <SettingRow icon="user" title={user?.fullName || 'الملف الشخصي'} subtitle={user?.primaryEmailAddress?.emailAddress || 'حساب مالك النشاط'} />
        <Pressable onPress={() => router.push('/(tabs)/sources')}><SettingRow icon="link-2" title="الحسابات المرتبطة" subtitle="إدارة منصات التواصل" /></Pressable>
      </Panel>
      <Panel>
        <SectionTitle title="التنبيهات وسير العمل" />
        <SettingRow icon="bell" title="تنبيهات داخل التطبيق" subtitle="تفضيل محلي على هذا الجهاز" value={preferences.inAppAlerts} onValueChange={(value) => updatePreference('inAppAlerts', value)} />
        <SettingRow icon="check-circle" title="مراجعة قبل النشر" subtitle="احتفظ بالمحتوى للموافقة قبل النشر" value={preferences.reviewBeforePublishing} onValueChange={(value) => updatePreference('reviewBeforePublishing', value)} />
      </Panel>
      <Panel>
        <SectionTitle title="المظهر واللغة" />
        <SettingRow icon="globe" title="لغة التطبيق" subtitle="العربية" />
        <SettingRow icon="sun" title="المظهر" subtitle="يتبع إعداد الجهاز" />
      </Panel>
      <Panel>
        <SectionTitle title="الدعم والأمان" />
        <Pressable onPress={() => Alert.alert('مركز المساعدة', 'تواصل مع فريق MenaFlow عبر البريد المخصص للدعم في إعدادات حسابك.')}><SettingRow icon="help-circle" title="مركز المساعدة" /></Pressable>
        <Pressable onPress={() => Alert.alert('الخصوصية', 'تُخزّن المسودات الحالية على هذا الجهاز. لا يتم إرسالها إلى منصات التواصل من دون ربط الحساب والموافقة.')}><SettingRow icon="shield" title="الخصوصية والأمان" /></Pressable>
        <Pressable onPress={async () => { await signOut(); router.replace('/(auth)/sign-in'); }}><SettingRow icon="log-out" title="تسجيل الخروج" subtitle="إنهاء الجلسة على هذا الجهاز" /></Pressable>
        <Pressable onPress={() => Alert.alert('حول التطبيق', 'MenaFlow — مساحة عربية لإدارة المحتوى والحسابات الاجتماعية.')}><SettingRow icon="info" title="حول MenaFlow" /></Pressable>
      </Panel>
      <Text style={[styles.version, { color: colors.mutedForeground }]}>MenaFlow · الإصدار 1.0</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  settingRow: { minHeight: 58, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  settingCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  settingTitle: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  settingSubtitle: { fontSize: 10, textAlign: 'right' },
  settingIcon: { width: 33, height: 33, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  version: { textAlign: 'center', fontSize: 11 },
});
