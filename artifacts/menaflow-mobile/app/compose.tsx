import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, usePreventRemove } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { LucideIcon as Icon, type LucideIconName } from '@/components/LucideIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { ActionButton, BrandHeader, confirmDiscardChanges, navigateBack, PageTitle, Panel, SectionTitle } from '@/components/Ui';
import { useStudio, type Channel } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';
import { useGenerateAiContent } from '@workspace/api-client-react';

const channelOptions: { key: Channel; label: string; icon: LucideIconName }[] = [
  { key: 'instagram', label: 'إنستغرام', icon: 'instagram' },
  { key: 'facebook', label: 'فيسبوك', icon: 'facebook' },
  { key: 'whatsapp', label: 'واتساب', icon: 'message-circle' },
];

export default function ComposeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addPost } = useStudio();
  const { channel: initialChannel } = useLocalSearchParams<{ channel?: string }>();
  const initialSelected: Channel[] =
    initialChannel === 'facebook' ||
    initialChannel === 'instagram' ||
    initialChannel === 'whatsapp'
      ? [initialChannel]
      : ['instagram'];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [aiProviderUsed, setAiProviderUsed] = useState<'gemini' | 'openai' | null>(null);
  const [selected, setSelected] = useState<Channel[]>(initialSelected);
  const [idea, setIdea] = useState('');
  const [businessContext, setBusinessContext] = useState('');
  const [tone, setTone] = useState<'professional' | 'friendly' | 'promotional' | 'concise'>('friendly');
  const [aiError, setAiError] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const allowRemovalRef = useRef(false);
  const aiGeneration = useGenerateAiContent();

  usePreventRemove(hasUnsavedChanges, ({ repeat }) => {
    if (allowRemovalRef.current) {
      allowRemovalRef.current = false;
      repeat();
      return;
    }
    confirmDiscardChanges(() => {
      allowRemovalRef.current = true;
      setHasUnsavedChanges(false);
      repeat();
    });
  });

  const toggleChannel = (channel: Channel) => {
    setHasUnsavedChanges(true);
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
    await addPost({
      title: title.trim(),
      body: body.trim(),
      channels: selected,
      status,
      ...(aiGeneratedAt
        ? {
            metadata: {
              aiGenerated: true,
              aiProvider: aiProviderUsed,
              aiGeneratedAt,
            },
          }
        : {}),
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    allowRemovalRef.current = true;
    setHasUnsavedChanges(false);
    navigateBack('/(tabs)/content');
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
          provider: 'gemini',
          tone,
          channel: selected[0] ?? 'instagram',
        },
      });
      setBody(result.content);
      setAiGeneratedAt(new Date().toISOString());
      setAiProviderUsed('gemini');
      if (!title.trim()) setTitle(idea.trim().slice(0, 60));
      await Haptics.selectionAsync();
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'تعذر إنشاء المسودة. حاول مرة أخرى.');
    }
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
      <PageTitle
        title="منشور جديد"
        subtitle="اكتب المحتوى وحدد القنوات المقصودة."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            onPress={() => navigateBack('/(tabs)/content')}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: colors.secondary,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Icon name="x" size={19} color={colors.foreground} />
          </Pressable>
        }
      />
      <Panel style={styles.aiPanel}>
        <View style={styles.sectionHeading}>
          <View style={[styles.sectionIcon, { backgroundColor: colors.accent }]}>
            <Icon name="zap" size={17} color={colors.primary} />
          </View>
          <SectionTitle title="اكتبها بالذكاء الاصطناعي" />
        </View>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>أدخل فكرة بسيطة، وسيُنشئ لك مسودة عربية قابلة للتعديل.</Text>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
          فكرة المنشور
        </Text>
        <TextInput
          value={idea}
          onChangeText={(value) => {
            setIdea(value);
            setHasUnsavedChanges(true);
          }}
          placeholder="مثال: عرض نهاية الأسبوع على منتجاتنا الجديدة"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          accessibilityLabel="فكرة المنشور"
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
          سياق إضافي <Text style={{ color: colors.mutedForeground, fontWeight: '400' }}>(اختياري)</Text>
        </Text>
        <TextInput
          value={businessContext}
          onChangeText={(value) => {
            setBusinessContext(value);
            setHasUnsavedChanges(true);
          }}
          placeholder="معلومة اختيارية عن النشاط أو العرض"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          accessibilityLabel="معلومات إضافية عن النشاط"
        />
        <View style={styles.optionHeading}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>نبرة الكتابة</Text>
          <Text style={[styles.optionHint, { color: colors.mutedForeground }]}>كيف يبدو أسلوب المنشور؟</Text>
        </View>
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
        {aiError ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.aiErrorBox,
              { backgroundColor: colors.secondary, borderColor: colors.destructive },
            ]}
          >
            <Icon name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[styles.aiError, { color: colors.destructive }]}>
              {aiError}
            </Text>
          </View>
        ) : null}
        <ActionButton
          label={aiGeneration.isPending ? 'جارٍ إنشاء المسودة…' : 'أنشئ مسودة'}
          icon="zap"
          onPress={generateDraft}
          disabled={idea.trim().length < 3 || aiGeneration.isPending}
        />
      </Panel>
      <Panel style={styles.contentPanel}>
        <View style={styles.sectionHeading}>
          <View style={[styles.sectionIcon, { backgroundColor: colors.accent }]}>
            <Icon name="file-text" size={17} color={colors.primary} />
          </View>
          <SectionTitle title="محتوى المنشور" />
        </View>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
          عنوان المنشور <Text style={{ color: colors.mutedForeground, fontWeight: '400' }}>(اختياري)</Text>
        </Text>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setHasUnsavedChanges(true);
          }}
          placeholder="عنوان اختياري"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
          returnKeyType="next"
        />
        <View style={styles.bodyField}>
          <View style={styles.bodyFieldHeading}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              نص المنشور
            </Text>
            <Text style={[styles.characterCount, { color: colors.mutedForeground }]}>
              {body.length} حرف
            </Text>
          </View>
          <TextInput
            value={body}
            onChangeText={(value) => {
              setBody(value);
              setHasUnsavedChanges(true);
            }}
            placeholder="اكتب فكرة منشورك هنا..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
            style={[styles.bodyInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            testID="post-body-input"
          />
        </View>
        <View style={styles.channelsHeading}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            القنوات المستهدفة
          </Text>
          <View style={[styles.selectionBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.selectionBadgeText, { color: colors.primary }]}>
              {selected.length} محددة
            </Text>
          </View>
        </View>
        <View style={styles.channelChips}>
          {channelOptions.map((channel) => {
            const active = selected.includes(channel.key);
            return (
              <Pressable
                key={channel.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => toggleChannel(channel.key)}
                style={[styles.channelChip, { backgroundColor: active ? colors.accent : colors.background, borderColor: active ? colors.primary : colors.border }]}
              >
                <Icon name={channel.icon} size={15} color={active ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.chipLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{channel.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.formActions}>
          <ActionButton label="حفظ كمسودة" icon="save" secondary onPress={() => submit('draft')} disabled={!body.trim()} />
          <ActionButton label="إرسال للمراجعة" icon="check" onPress={() => submit('review')} disabled={!body.trim()} />
        </View>
        <View style={[styles.disclaimerBox, { backgroundColor: colors.secondary }]}>
          <Icon name="info" size={15} color={colors.mutedForeground} />
          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            تُحفظ المسودات على هذا الجهاز. النشر إلى المنصات غير متاح قبل اكتمال الربط والتفويض.
          </Text>
        </View>
      </Panel>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  aiPanel: { gap: 12 },
  contentPanel: { gap: 13 },
  content: { flexGrow: 1, paddingHorizontal: 18, gap: 18 },
  closeButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  sectionIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, fontSize: 14 },
  bodyField: { gap: 7 },
  bodyFieldHeading: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  bodyInput: { minHeight: 175, borderWidth: 1, borderRadius: 15, padding: 14, fontSize: 14, lineHeight: 23 },
  fieldLabel: { fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  optionHeading: { flexDirection: 'row-reverse', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 },
  optionHint: { fontSize: 10, textAlign: 'right' },
  characterCount: { fontSize: 10, textAlign: 'left' },
  channelsHeading: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  selectionBadge: { minHeight: 24, justifyContent: 'center', borderRadius: 9, paddingHorizontal: 8 },
  selectionBadgeText: { fontSize: 10, fontWeight: '700' },
  channelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  channelChip: { minHeight: 38, flexDirection: 'row-reverse', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel: { fontSize: 11, fontWeight: '700' },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disclaimerBox: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 11 },
  disclaimer: { flex: 1, fontSize: 10, textAlign: 'right', lineHeight: 17 },
  helper: { fontSize: 11, lineHeight: 18, textAlign: 'right' },
  aiErrorBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  aiError: { flex: 1, fontSize: 11, lineHeight: 17, textAlign: 'right' },
});
