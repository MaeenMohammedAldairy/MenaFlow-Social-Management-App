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
import { useGenerateAiContent } from '@workspace/api-client-react';
import { OwnerGuard } from '@/components/OwnerGuard';

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
  const [idea, setIdea] = useState('');
  const [businessContext, setBusinessContext] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [tone, setTone] = useState<'professional' | 'friendly' | 'promotional' | 'concise'>('friendly');
  const [aiError, setAiError] = useState('');
  const aiGeneration = useGenerateAiContent();

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

  const generateDraft = async () => {
    if (idea.trim().length < 3) {
      setAiError('اكتب فكرة قصيرة من ثلاثة أحرف على الأقل.');
      return;
    }
    setAiError('');
    try {
      const result = await aiGeneration.mutateAsync({
        data: {
          idea: idea.trim(),
          businessContext: businessContext.trim() || undefined,
          provider,
          tone,
          channel: selected[0] ?? 'instagram',
        },
      });
      setBody(result.content);
      if (!title.trim()) setTitle(idea.trim().slice(0, 60));
      await Haptics.selectionAsync();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'تعذر إنشاء المسودة. حاول مرة أخرى.');
    }
  };

  return (
    <OwnerGuard>
      <KeyboardAwareScrollViewCompat
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 67) + 8 : insets.top + 8, paddingBottom: Math.max(insets.bottom, 20) }]}
        bottomOffset={72}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <BrandHeader />
      <PageTitle title="منشور جديد" subtitle="اكتب المحتوى وحدد القنوات المقصودة." action={<Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={() => router.back()} style={styles.closeButton}><Feather name="x" size={20} color={colors.foreground} /></Pressable>} />
      <Panel style={styles.aiPanel}>
        <SectionTitle title="اكتبها بالذكاء الاصطناعي" />
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>أدخل فكرة بسيطة، وسيُنشئ لك مسودة عربية قابلة للتعديل.</Text>
        <TextInput
          value={idea}
          onChangeText={setIdea}
          placeholder="مثال: عرض نهاية الأسبوع على منتجاتنا الجديدة"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          accessibilityLabel="فكرة المنشور"
        />
        <TextInput
          value={businessContext}
          onChangeText={setBusinessContext}
          placeholder="معلومة اختيارية عن النشاط أو العرض"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          accessibilityLabel="معلومات إضافية عن النشاط"
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>مزود الذكاء الاصطناعي</Text>
        <View style={styles.channelChips}>
          {([
            ['gemini', 'Gemini'],
            ['openai', 'OpenAI'],
          ] as const).map(([value, label]) => {
            const active = provider === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setProvider(value)}
                style={[styles.channelChip, { backgroundColor: active ? colors.accent : colors.background, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={[styles.chipLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>نبرة الكتابة</Text>
        <View style={styles.channelChips}>
          {([
            ['friendly', 'ودودة'],
            ['professional', 'احترافية'],
            ['promotional', 'تسويقية'],
            ['concise', 'مختصرة'],
          ] as const).map(([value, label]) => {
            const active = tone === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setTone(value)}
                style={[styles.channelChip, { backgroundColor: active ? colors.accent : colors.background, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={[styles.chipLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {aiError ? <Text accessibilityRole="alert" style={[styles.aiError, { color: colors.destructive }]}>{aiError}</Text> : null}
        <ActionButton
          label={aiGeneration.isPending ? 'جارٍ إنشاء المسودة…' : 'أنشئ مسودة'}
          icon="zap"
          onPress={generateDraft}
          disabled={idea.trim().length < 3 || aiGeneration.isPending}
        />
      </Panel>
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
    </OwnerGuard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  aiPanel: { gap: 11 },
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
  helper: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  aiError: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
});
