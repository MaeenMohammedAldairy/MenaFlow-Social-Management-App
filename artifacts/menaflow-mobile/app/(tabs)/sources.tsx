import { Feather } from '@expo/vector-icons';
import {
  deleteMetaConnection,
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
  postMetaConnect,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, BrandHeader, Page, PageTitle, Panel, SectionTitle, StatusPill } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

const metaReturnUrl = 'menaflow-mobile://oauth/meta';
const sources = [
  { key: 'instagram', name: 'إنستغرام', provider: 'Instagram Business', icon: 'instagram' as const, color: 'instagram' as const, description: 'إدارة حساب الأعمال المرتبط بصفحة فيسبوك.' },
  { key: 'facebook', name: 'فيسبوك', provider: 'Meta Business', icon: 'facebook' as const, color: 'facebook' as const, description: 'ربط صفحة أعمال من حساب Meta.' },
  { key: 'whatsapp', name: 'واتساب', provider: 'WhatsApp Evolution API', icon: 'message-circle' as const, color: 'whatsapp' as const, description: 'يحتاج عنوان Evolution API عاماً يمكن للخادم الوصول إليه.' },
];

export default function SourcesScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [callbackUri, setCallbackUri] = useState('');
  const connectionsQuery = useQuery({
    queryKey: getGetSocialConnectionsQueryKey(),
    queryFn: getSocialConnections,
  });
  const connections = connectionsQuery.data;

  const connectMeta = async () => {
    setBusy(true);
    try {
      const setup = await postMetaConnect();
      setCallbackUri(setup.callbackUri);
      const result = await WebBrowser.openAuthSessionAsync(
        setup.authorizationUrl,
        metaReturnUrl,
      );
      if (result.type !== 'success') return;

      const status = new URL(result.url).searchParams.get('status');
      await queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
      if (status === 'connected' || status === 'facebook_connected') {
        Alert.alert(
          'تم ربط الحساب',
          status === 'connected'
            ? 'تم ربط صفحة فيسبوك وحساب إنستغرام الاحترافي.'
            : 'تم ربط صفحة فيسبوك. لم يُعثر على حساب إنستغرام احترافي مرتبط بها.',
        );
      } else {
        Alert.alert(
          'تعذر إكمال الربط',
          `تحقق من إعدادات تطبيق Meta وصلاحيات الصفحة، ثم أضف عنوان العودة التالي إلى إعدادات OAuth:\n\n${setup.callbackUri}`,
        );
      }
    } catch {
      Alert.alert(
        'تعذر بدء الربط',
        'تأكد من إعداد مفاتيح Meta وعنوان العودة على الخادم، ثم حاول مجدداً.',
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnectMeta = () => {
    Alert.alert(
      'إلغاء ربط Meta',
      'سيزيل MenaFlow بيانات الاتصال المحفوظة لهذا الحساب.',
      [
        { text: 'إبقاء الاتصال', style: 'cancel' },
        {
          text: 'إلغاء الربط',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteMetaConnection();
              await queryClient.invalidateQueries({
                queryKey: getGetSocialConnectionsQueryKey(),
              });
            } catch {
              Alert.alert('تعذر إلغاء الربط', 'حاول مرة أخرى بعد قليل.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const sourceStatus = (key: string) => {
    if (key === 'whatsapp') return 'يلزم عنوان الخادم';
    if (connectionsQuery.isLoading) return 'جارٍ التحقق';
    if (key === 'facebook') {
      return connections?.facebook
        ? `متصل: ${connections.facebook.accountName}`
        : 'غير مربوط';
    }
    if (key === 'instagram') {
      return connections?.instagram
        ? `متصل: @${connections.instagram.accountName}`
        : connections?.facebook
          ? 'لا يوجد حساب احترافي مرتبط'
          : 'غير مربوط';
    }
    return 'غير مربوط';
  };

  return (
    <Page>
      <BrandHeader showBell />
      <PageTitle title="مصادر المحتوى" subtitle="اربط قنواتك لتجهيز المحتوى ومتابعة الحسابات." />
      <Panel style={[styles.setupNotice, { backgroundColor: colors.accent }]}>
        <View style={[styles.noticeIcon, { backgroundColor: colors.accent }]}><Feather name="link-2" size={20} color={colors.primary} /></View>
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>ابدأ بربط حساباتك</Text>
          <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>يتم تفويض حساب Meta رسمياً. تحفظ رموز الوصول مشفرة على الخادم ولا تصل إلى تطبيق الهاتف.</Text>
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
        {connectionsQuery.isError && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            تعذر تحميل حالة الحسابات. تحقق من اتصال الشبكة وحاول التحديث.
          </Text>
        )}
        {sources.map((source) => {
          const connected =
            source.key === 'facebook'
              ? Boolean(connections?.facebook)
              : source.key === 'instagram'
                ? Boolean(connections?.instagram)
                : false;
          const metaSource = source.key !== 'whatsapp';
          return (
            <View key={source.name} style={[styles.sourceCard, { borderColor: colors.border }]}>
              <View style={[styles.sourceIcon, { backgroundColor: colors.accent }]}>
                <Feather name={source.icon} size={21} color={colors[source.color]} />
              </View>
              <View style={styles.sourceCopy}>
                <View style={styles.sourceTitleLine}>
                  <Text style={[styles.sourceName, { color: colors.foreground }]}>{source.name}</Text>
                  <StatusPill label={sourceStatus(source.key)} />
                </View>
                <Text style={[styles.providerName, { color: colors.mutedForeground }]}>{source.provider}</Text>
                <Text style={[styles.sourceDescription, { color: colors.mutedForeground }]}>{source.description}</Text>
              </View>
              {metaSource ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${connected ? 'إلغاء ربط' : 'ربط'} ${source.name}`}
                  disabled={busy || connectionsQuery.isLoading}
                  onPress={connected ? disconnectMeta : connectMeta}
                  style={[styles.connectButton, { borderColor: connected ? colors.border : colors.primary, opacity: busy ? 0.55 : 1 }]}
                >
                  <Feather name={connected ? 'check-circle' : 'link'} size={14} color={connected ? colors.mutedForeground : colors.primary} />
                  <Text style={[styles.connectLabel, { color: connected ? colors.mutedForeground : colors.primary }]}>{connected ? 'إلغاء الربط' : busy ? 'جارٍ...' : 'ربط'}</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="إعداد عنوان خادم واتساب"
                  onPress={() => Alert.alert('إعداد واتساب', 'أضف عنوان Evolution API عاماً في متغير WHATSAPP_EVOLUTION_BASE_URL. العنوان المحلي لا يمكن للخادم المنشور الوصول إليه.')}
                  style={[styles.connectButton, { borderColor: colors.border }]}
                >
                  <Feather name="info" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.connectLabel, { color: colors.mutedForeground }]}>إعداد مطلوب</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Panel>
      <Panel style={{ backgroundColor: colors.accent }}>
        <View style={styles.infoRow}>
          <Feather name="shield" size={19} color={colors.primary} />
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>حماية الوصول</Text>
        </View>
        <Text style={[styles.infoBody, { color: colors.mutedForeground }]}>تُحفظ رموز Meta مشفرة في قاعدة البيانات. يحتاج التطبيق إلى اعتماد صلاحيات Meta وعنوان OAuth عام قبل إتمام أول ربط.</Text>
        {callbackUri ? (
          <View style={styles.callbackHint}>
            <Text selectable style={[styles.infoBody, { color: colors.primary }]}>
              عنوان العودة: {callbackUri}
            </Text>
          </View>
        ) : null}
        <ActionButton
          label="تحديث حالة الحسابات"
          icon="refresh-cw"
          secondary
          onPress={() => connectionsQuery.refetch()}
        />
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
  sourceTitleLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sourceName: { fontSize: 13, fontWeight: '800' },
  providerName: { fontSize: 10, fontWeight: '600' },
  sourceDescription: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  connectButton: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  connectLabel: { fontSize: 10, fontWeight: '800' },
  error: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  infoRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  infoTitle: { fontSize: 14, fontWeight: '800' },
  infoBody: { fontSize: 12, lineHeight: 20, textAlign: 'right' },
  callbackHint: { paddingVertical: 3 },
});
