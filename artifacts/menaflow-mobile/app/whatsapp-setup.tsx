import {
  getWhatsAppAutoReplySettings,
  saveWhatsAppAutoReplySettings,
  testWhatsAppAutoReply,
  type WhatsAppAutoReplySettings,
  type WhatsAppAutoReplySettingsTone,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { Redirect, router, type Href, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import {
  ActionButton,
  EmptyState,
  navigateBack,
  Panel,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";
import { whatsAppFunctionalStatus } from "@/lib/whatsapp-functional-status";

const defaultSettings: WhatsAppAutoReplySettings = {
  enabled: false,
  language: "ar",
  tone: "friendly_professional",
  instructions: "",
};

const tones: Array<{ value: WhatsAppAutoReplySettingsTone; label: string }> = [
  { value: "friendly_professional", label: "ودود واحترافي" },
  { value: "concise", label: "مختصر ومباشر" },
  { value: "formal", label: "رسمي" },
];

function settingsFingerprint(settings: WhatsAppAutoReplySettings): string {
  return JSON.stringify({
    language: settings.language,
    tone: settings.tone,
    instructions: settings.instructions.trim(),
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Kept so older links keep working; WhatsApp groups live on the sources screen. */
export default function WhatsAppSetupScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return (
    <Redirect
      href={{
        pathname: "/(tabs)/more/sources",
        params: { section: "connections", ...(returnTo ? { returnTo } : {}) },
      }}
    />
  );
}

export function WhatsAppReplyPanel({ returnTo }: { returnTo?: string }) {
  if (isLocalAuthDisabled) return <WhatsAppReplyContent userId={null} returnTo={returnTo} />;
  return <AuthenticatedWhatsAppReply returnTo={returnTo} />;
}

function AuthenticatedWhatsAppReply({ returnTo }: { returnTo?: string }) {
  const { userId } = useAuth();
  return <WhatsAppReplyContent userId={userId ?? null} returnTo={returnTo} />;
}

function WhatsAppReplyContent({
  userId,
  returnTo,
}: {
  userId: string | null;
  returnTo?: string;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const queryKey = ["whatsappAutoReplySettings", userId ?? "local"];
  const settingsQuery = useQuery({
    queryKey,
    queryFn: getWhatsAppAutoReplySettings,
    retry: false,
  });
  const connected = settingsQuery.data?.connected === true;
  const [settings, setSettings] =
    useState<WhatsAppAutoReplySettings>(defaultSettings);
  const settingsInitialized = useRef(false);
  const [testMessage, setTestMessage] = useState("");
  const [testReply, setTestReply] = useState("");
  const [testedSettings, setTestedSettings] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data || settingsInitialized.current) return;
    const loadedSettings = settingsQuery.data.settings;
    setSettings(loadedSettings);
    if (loadedSettings.enabled) {
      setTestedSettings(settingsFingerprint(loadedSettings));
    }
    settingsInitialized.current = true;
  }, [settingsQuery.data]);


  const testIsCurrent = useMemo(
    () => Boolean(testedSettings) && testedSettings === settingsFingerprint(settings),
    [settings, testedSettings],
  );

  const updateSettings = (update: Partial<WhatsAppAutoReplySettings>) => {
    setSettings((current) => ({ ...current, ...update }));
    setSettingsError("");
    setSettingsNotice("");
    setTestReply("");
  };

  const runReplyTest = async () => {
    if (!testMessage.trim() || testing) return;
    setTesting(true);
    setSettingsError("");
    setSettingsNotice("");
    setTestReply("");
    try {
      const result = await testWhatsAppAutoReply({
        language: settings.language,
        tone: settings.tone,
        instructions: settings.instructions,
        customerMessage: testMessage.trim(),
      });
      setTestReply(result.reply);
      setTestedSettings(settingsFingerprint(settings));
      setSettingsNotice("تم إنشاء رد تجريبي. لم يتم إرسال أي رسالة إلى العميل.");
    } catch (error) {
      setSettingsError(
        errorMessage(error, "تعذّر إنشاء الرد التجريبي. حاول مرة أخرى."),
      );
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (saving) return;
    if (settings.enabled && !testIsCurrent) {
      setSettingsError("اختبر الرد بهذه الإعدادات قبل تفعيل الإرسال الآلي.");
      return;
    }
    setSaving(true);
    setSettingsError("");
    setSettingsNotice("");
    try {
      const saved = await saveWhatsAppAutoReplySettings(settings);
      setSettings(saved);
      queryClient.setQueryData(queryKey, (current: typeof settingsQuery.data) =>
        current ? { ...current, settings: saved } : current,
      );
      setSettingsNotice("تم حفظ إعدادات الردود بنجاح.");
    } catch (error) {
      setSettingsError(
        errorMessage(error, "تعذّر حفظ إعدادات الردود. حاول مرة أخرى."),
      );
    } finally {
      setSaving(false);
    }
  };

  const functionalStatus = whatsAppFunctionalStatus({
    connected,
    inbound: settingsQuery.data?.inbound,
  });

  const retrySettings = () => void settingsQuery.refetch();
  const returnHref: Href =
    returnTo === "connect-accounts"
      ? "/connect-accounts"
      : returnTo === "inbox"
        ? "/(tabs)/inbox"
        : "/(tabs)/more/sources";
  const returnLabel =
    returnTo === "connect-accounts"
      ? "العودة إلى الإعداد الأولي"
      : returnTo === "inbox"
        ? "العودة إلى صندوق الوارد"
        : "العودة إلى المصادر";
  const returnToPreviousScreen = () => navigateBack(returnHref);

  return (
    <>
      {settingsQuery.isLoading ? (
        <Panel>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              جارٍ التحقق من اتصال واتساب…
            </Text>
          </View>
        </Panel>
      ) : settingsQuery.isError ? (
        <Panel>
          <Text style={[styles.body, { color: colors.destructive }]}>
            {errorMessage(settingsQuery.error, "تعذّر تحميل إعداد الحساب.")}
          </Text>
          <ActionButton
            label="إعادة المحاولة"
            icon="refresh-cw"
            secondary
            onPress={retrySettings}
          />
        </Panel>
      ) : !connected ? (
        <Panel>
          <EmptyState
            icon="whatsapp"
            title="حساب واتساب غير متصل"
            body="تعذّر تأكيد الاتصال من الخادم. ارجع إلى صفحة المصادر وأعد ربط الحساب قبل إعداد الردود."
          />
          <ActionButton
            label={returnLabel}
            icon="chevron-right"
            onPress={returnToPreviousScreen}
          />
        </Panel>
      ) : (
        <>
          <Panel>
            <View style={styles.requirementTitleRow}>
              <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                حالة واتساب
              </Text>
              <StatusPill label={functionalStatus.label} tone={functionalStatus.tone} />
            </View>
            <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
              {functionalStatus.message}
            </Text>
          </Panel>

          <Panel>
            <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
              يُرسل نص الرسالة الفردية إلى مزود الذكاء الاصطناعي المهيأ على الخادم
              لإنشاء الرد، ولا تُستخدم رسائل المجموعات. اختبر الرد قبل تفعيله.
            </Text>

            <View style={[styles.switchRow, { borderColor: colors.border }]}>
              <View style={styles.switchCopy}>
                <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                  الردود بالذكاء الاصطناعي
                </Text>
                <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
                  {settings.enabled ? "الرد التلقائي مفعّل" : "متوقف حتى تفعيله بعد الاختبار"}
                </Text>
              </View>
              <Switch
                accessibilityLabel="تفعيل الردود بالذكاء الاصطناعي"
                accessibilityRole="switch"
                accessibilityState={{ checked: settings.enabled, disabled: saving }}
                value={settings.enabled}
                onValueChange={(enabled) => updateSettings({ enabled })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.card}
                disabled={saving}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                لغة الردود
              </Text>
              <View style={styles.choiceRow}>
                <ChoiceButton
                  label="العربية تلقائيًا"
                  selected={settings.language === "ar"}
                  onPress={() => updateSettings({ language: "ar" })}
                />
                <ChoiceButton
                  label="لغة العميل"
                  selected={settings.language === "match_customer"}
                  onPress={() => updateSettings({ language: "match_customer" })}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                أسلوب الرد
              </Text>
              <View style={styles.choiceRow}>
                {tones.map((tone) => (
                  <ChoiceButton
                    key={tone.value}
                    label={tone.label}
                    selected={settings.tone === tone.value}
                    onPress={() => updateSettings({ tone: tone.value })}
                  />
                ))}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                تعليمات إضافية للذكاء الاصطناعي
              </Text>
              <TextInput
                accessibilityLabel="تعليمات إضافية للذكاء الاصطناعي"
                value={settings.instructions}
                onChangeText={(instructions) =>
                  updateSettings({ instructions: instructions.slice(0, 2000) })
                }
                placeholder="مثال: رحّب بالعميل، وأجب عن الأسعار اعتمادًا على المعلومات التي أضيفها هنا."
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={2000}
                textAlign="right"
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
              <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
                لا يوجد كتالوج منتجات في إعداد الردود الحالي؛ لا تكتب أسعارًا أو حقائق غير مؤكدة.
              </Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                اختبار الرد قبل التفعيل
              </Text>
              <View style={styles.presetChipsRow}>
                {[
                  { label: "سعر وتوفر", text: "كم سعر المنتج وهل متوفر الآن؟" },
                  { label: "مواصفات وألوان", text: "هل يتوفر منه ألوان أو مقاسات ثانية؟" },
                  { label: "طلب وشراء", text: "أريد طلب حبة، كيف طريقة الدفع والتوصيل؟" },
                  { label: "أوقات وعنوان", text: "أين موقعكم ومتى أوقات دوامكم؟" },
                ].map((preset) => (
                  <Text
                    key={preset.label}
                    accessibilityRole="button"
                    onPress={() => {
                      setTestMessage(preset.text);
                      setTestReply("");
                      setTestedSettings("");
                      setSettingsNotice("");
                    }}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        color: colors.foreground,
                      },
                    ]}
                  >
                    {preset.label}
                  </Text>
                ))}
              </View>
              <TextInput
                accessibilityLabel="رسالة عميل للاختبار"
                value={testMessage}
                onChangeText={(value) => {
                  setTestMessage(value.slice(0, 1000));
                  setTestReply("");
                  setTestedSettings("");
                  setSettingsNotice("");
                }}
                placeholder="مثال: هل يمكن معرفة مواعيد العمل؟"
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={1000}
                textAlign="right"
                style={[
                  styles.textInput,
                  styles.testMessageInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
              <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
                رسالة الاختبار تُرسل إلى مزود الذكاء الاصطناعي لإنتاج معاينة فقط، ولا تصل إلى واتساب.
              </Text>
              <ActionButton
                label={testing ? "جارٍ إنشاء المعاينة…" : "اختبار الرد"}
                icon={testing ? "refresh-cw" : "message-square"}
                secondary
                disabled={testing || !testMessage.trim()}
                onPress={() => void runReplyTest()}
              />
              {testReply ? (
                <View style={[styles.previewCard, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.fieldTitle, { color: colors.foreground }]}>
                    معاينة الرد
                  </Text>
                  <Text style={[styles.body, { color: colors.foreground }]}>
                    {testReply}
                  </Text>
                </View>
              ) : null}
              {testIsCurrent ? (
                <StatusPill label="تم اختبار الإعدادات الحالية" tone="green" />
              ) : null}
            </View>

            {settingsError ? (
              <Text accessibilityRole="alert" style={[styles.notice, { color: colors.destructive }]}>
                {settingsError}
              </Text>
            ) : null}
            {settingsNotice ? (
              <Text style={[styles.notice, { color: colors.primary }]}>
                {settingsNotice}
              </Text>
            ) : null}
            <ActionButton
              label={saving ? "جارٍ حفظ الإعدادات…" : "حفظ إعدادات الردود"}
              icon={saving ? "refresh-cw" : "save"}
              disabled={saving}
              onPress={() => void saveSettings()}
            />
          </Panel>

          <Panel>
            <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
              استيراد رسائل المجموعات ومزامنتها يُدار من شاشة القنوات، ولا علاقة
              له بالرد الآلي على المحادثات الفردية.
            </Text>
            <ActionButton
              label="إدارة المجموعات والمزامنة"
              icon="chevron-left"
              secondary
              onPress={() => router.push("/(tabs)/more/sources")}
            />
          </Panel>

        </>
      )}
    </>
  );
}

function ChoiceButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choiceButton,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.accent : colors.card,
        },
      ]}
    >
      <Text style={[styles.choiceLabel, { color: selected ? colors.primary : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  body: { fontSize: 14, lineHeight: 22, textAlign: "right" },
  bodySmall: { fontSize: 13.5, lineHeight: 20, textAlign: "right" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  switchCopy: { flex: 1, alignItems: "flex-start", gap: 3 },
  fieldGroup: { gap: 8 },
  fieldTitle: { fontSize: 14, fontWeight: "800", textAlign: "right" },
  requirementTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceLabel: { fontSize: 13.5, fontWeight: "700" },
  textInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    textAlignVertical: "top",
    writingDirection: "rtl",
    fontSize: 14,
    lineHeight: 22,
  },
  testMessageInput: { minHeight: 70 },
  previewCard: { borderRadius: 14, padding: 13, gap: 7 },
  notice: { fontSize: 13.5, lineHeight: 20, textAlign: "right" },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
});
