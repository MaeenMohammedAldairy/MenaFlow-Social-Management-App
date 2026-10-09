import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ActionButton, BrandHeader, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio, type Channel } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';

const channelOptions: { key: Channel; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'instagram', label: 'إنستغرام', icon: 'instagram' },
  { key: 'facebook', label: 'فيسبوك', icon: 'facebook' },
  { key: 'whatsapp', label: 'واتساب', icon: 'message-circle' },
];

export default function ComposeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addPost } = useStudio();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<Channel[]>(['instagram']);

  const toggleChannel = (channel: Channel) => {
    setSelected((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  };

  const submit = async (status: 'draft' | 'review') => {
    if (!body.trim()) {
      Alert.alert('أضف نص المنشور', 'اكتب محتوى قبل حفظ المسودة.');
      return;
    }
    if (selected.length === 0) {
      Alert.alert('اختر قناة', 'حدد قناة واحدة على الأقل لتوضيح وجهة المحتوى.');
      return;
    }
    addPost({ title: title.trim(), body: body.trim(), channels: selected, status });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 67) + 8 : insets.top + 8, paddingBottom: Math.max(insets.bottom, 20) }]}
      bottomOffset={72}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <BrandHeader />
      <PageTitle title="منشور جديد" subtitle="اكتب المحتوى وحدد القنوات المقصودة." action={<Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={() => router.back()} style={styles.closeButton}><Feather name="x" size={20} color={colors.foreground} /></Pressable>} />
      <Panel>
        <SectionTitle title="محتوى المنشور" />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="عنوان اختياري"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          returnKeyType="next"
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="اكتب فكرة منشورك هنا..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={[styles.bodyInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          testID="post-body-input"
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>القنوات المستهدفة</Text>
        <View style={styles.channelChips}>
          {channelOptions.map((channel) => {
            const active = selected.includes(channel.key);
            return (
              <Pressable key={channel.key} onPress={() => toggleChannel(channel.key)} style={[styles.channelChip, { backgroundColor: active ? colors.accent : colors.background, borderColor: active ? colors.primary : colors.border }]}>
                <Feather name={channel.icon} size={15} color={active ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.chipLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{channel.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.formActions}>
          <ActionButton label="حفظ كمسودة" icon="save" secondary onPress={() => submit('draft')} disabled={!body.trim()} />
          <ActionButton label="إرسال للمراجعة" icon="check" onPress={() => submit('review')} disabled={!body.trim()} />
        </View>
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>تُحفظ المسودات على هذا الجهاز. النشر إلى المنصات غير متاح قبل اكتمال الربط والتفويض.</Text>
      </Panel>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 18, gap: 18 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, fontSize: 14 },
  bodyInput: { minHeight: 160, borderWidth: 1, borderRadius: 14, padding: 13, fontSize: 14, lineHeight: 22 },
  fieldLabel: { fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  channelChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  channelChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8 },
  chipLabel: { fontSize: 11, fontWeight: '700' },
  formActions: { flexDirection: 'row-reverse', gap: 8 },
  disclaimer: { fontSize: 11, textAlign: 'right', lineHeight: 17 },
});
