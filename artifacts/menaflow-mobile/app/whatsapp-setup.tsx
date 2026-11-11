import {
  getWhatsAppAutoReplySettings,
  getGetSocialConnectionsQueryKey,
  getWhatsAppGroupSelections,
  getWhatsAppGroups,
  getSocialConnections,
  saveWhatsAppAutoReplySettings,
  saveWhatsAppGroupSelections,
  testWhatsAppAutoReply,
  type WhatsAppAutoReplySettings,
  type WhatsAppAutoReplyTone,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { router, type Href, useLocalSearchParams } from "expo-router";
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
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  navigateBack,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";

const defaultSettings: WhatsAppAutoReplySettings = {
  enabled: false,
  language: "ar",
  tone: "friendly_professional",
  instructions: "",
};

const tones: Array<{ value: WhatsAppAutoReplyTone; label: string }> = [
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

export default function WhatsAppSetupScreen() {
  if (isLocalAuthDisabled) return <WhatsAppSetupContent userId={null} />;
  return <AuthenticatedWhatsAppSetup />;
}

function AuthenticatedWhatsAppSetup() {
  const { userId } = useAuth();
  return <WhatsAppSetupContent userId={userId ?? null} />;
}

function WhatsAppSetupContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const queryKey = ["whatsappAutoReplySettings", userId ?? "local"];
  const connectionsQueryKey = [
    ...getGetSocialConnectionsQueryKey(),
    userId ?? "local",
  ] as const;
  const [groupsFetchEnabled, setGroupsFetchEnabled] = useState(false);
  const [showAvailableGroups, setShowAvailableGroups] = useState(false);
  const settingsQuery = useQuery({
    queryKey,
    queryFn: getWhatsAppAutoReplySettings,
    retry: false,
  });
  const connectionsQuery = useQuery({
    queryKey: connectionsQueryKey,
    queryFn: getSocialConnections,
    staleTime: 30_000,
  });
  const connected = settingsQuery.data?.connected === true;
  const instanceName = connectionsQuery.data?.whatsapp?.instanceName;
  const selectionQueryKey = [
    "whatsappGroupSelections",
    userId ?? "local",
    instanceName ?? "no-connection",
  ] as const;
  const groupsQueryKey = [
    "whatsappGroups",
    userId ?? "local",
    instanceName ?? "no-connection",
  ] as const;
  const groupSelectionsQuery = useQuery({
    queryKey: selectionQueryKey,
    queryFn: getWhatsAppGroupSelections,
    enabled: connected && Boolean(instanceName),
    retry: false,
  });
  const groupsQuery = useQuery({
    queryKey: groupsQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await getWhatsAppGroups({ signal });
      } catch (error) {
        setGroupsFetchEnabled(false);
        throw error;
      }
    },
    enabled:
      connected &&
      showAvailableGroups &&
      groupsFetchEnabled &&
      Boolean(instanceName),
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
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
  const [selectedGroupJids, setSelectedGroupJids] = useState<string[]>([]);
  const [groupsInitialized, setGroupsInitialized] = useState(false);
  const [groupsError, setGroupsError] = useState("");
  const [savingGroups, setSavingGroups] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data || settingsInitialized.current) return;
    const loadedSettings = settingsQuery.data.settings;
    setSettings(loadedSettings);
    if (loadedSettings.enabled) {
      setTestedSettings(settingsFingerprint(loadedSettings));
    }
    settingsInitialized.current = true;
  }, [settingsQuery.data]);

  useEffect(() => {
    if (
      !groupSelectionsQuery.data ||
      groupSelectionsQuery.isFetching ||
      groupsInitialized
    )
      return;
    setSelectedGroupJids(
      groupSelectionsQuery.data.groups.map((group) => group.groupJid),
    );
    setGroupsInitialized(true);
  }, [
    groupSelectionsQuery.data,
    groupSelectionsQuery.isFetching,
    groupsInitialized,
  ]);

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

  const saveGroups = async () => {
    if (savingGroups) return;
    setSavingGroups(true);
    setGroupsError("");
    try {
      const saved = await saveWhatsAppGroupSelections({
        groupJids: selectedGroupJids,
      });
      setSelectedGroupJids(saved.groups.map((group) => group.groupJid));
      queryClient.setQueryData(selectionQueryKey, saved);
      setGroupsError("");
    } catch (error) {
      setGroupsError(
        errorMessage(error, "تعذّر حفظ مجموعات واتساب. حاول مرة أخرى."),
      );
    } finally {
      setSavingGroups(false);
    }
  };

  const toggleGroup = (groupJid: string) => {
    setSelectedGroupJids((current) =>
      current.includes(groupJid)
        ? current.filter((jid) => jid !== groupJid)
        : [...current, groupJid],
    );
  };

  const retrySettings = () => void settingsQuery.refetch();
  const returnToSources = () =>
    navigateBack(
      returnTo === "connect-accounts"
        ? "/connect-accounts"
        : "/(tabs)/more/sources",
    );

  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="إعداد حساب واتساب"
        subtitle="أكمل إعدادات حسابك لتبدأ إدارة الرسائل عبر MenaFlow."
        back={{
          href:
            returnTo === "connect-accounts"
              ? "/connect-accounts"
              : "/(tabs)/more/sources",
          label:
            returnTo === "connect-accounts"
              ? "العودة إلى الإعداد الأولي"
              : "العودة إلى المصادر",
        }}
      />
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
            icon="message-circle"
            title="حساب واتساب غير متصل"
            body="تعذّر تأكيد الاتصال من الخادم. ارجع إلى صفحة المصادر وأعد ربط الحساب قبل إعداد الردود."
          />
          <ActionButton
            label="العودة إلى ربط الحسابات"
            icon="chevron-right"
            onPress={returnToSources}
          />
        </Panel>
      ) : (
        <>
          <Panel style={styles.connectedPanel}>
            <View style={styles.connectedHeader}>
              <View style={[styles.whatsappIcon, { backgroundColor: colors.accent }]}>
                <Icon name="message-circle" size={23} color={colors.primary} />
              </View>
              <StatusPill label="متصل" tone="green" />
            </View>
            <Text style={[styles.connectedTitle, { color: colors.foreground }]}>
              تم ربط حسابك بنجاح
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              حساب واتساب متصل. يمكنك الآن ضبط طريقة التعامل مع الرسائل الواردة.
            </Text>
            <View style={[styles.accountRow, { borderColor: colors.border }]}>
              <View style={styles.accountCopy}>
                <Text style={[styles.accountTitle, { color: colors.foreground }]}>
                  حساب واتساب المرتبط
                </Text>
                <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
                  {settingsQuery.data?.phoneNumber || "الرقم المرتبط"}
                </Text>
              </View>
              <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
                متصل عبر Evolution API
              </Text>
            </View>
            <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
              حالة الاتصال معروضة بعد التحقق المباشر من الخادم.
            </Text>
          </Panel>

          <Panel>
            <SectionTitle title="إعداد الردود التلقائية" />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              اضبط أسلوب الرد على رسائل العملاء في المحادثات الفردية. لا تُرسل الردود تلقائيًا إلا بعد اختبارها ثم تفعيلها يدويًا.
            </Text>
            <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
              عند التفعيل، يُرسل نص الرسالة الفردية إلى مزود الذكاء الاصطناعي المهيأ على الخادم لإنشاء الرد. لا تُستخدم رسائل المجموعات للرد الآلي.
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
            <SectionTitle title="مصادر البيانات والمجموعات" />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              اختر مجموعات واتساب التي تريد استيراد رسائلها وإعداد محتواها. هذا الاختيار منفصل عن الردود الآلية، التي تعمل على المحادثات الفردية فقط.
            </Text>
            {groupSelectionsQuery.isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  جارٍ تحميل المجموعات المختارة…
                </Text>
              </View>
            ) : groupSelectionsQuery.isError ? (
              <View style={styles.errorBlock}>
                <Text style={[styles.body, { color: colors.destructive }]}>
                  {errorMessage(groupSelectionsQuery.error, "تعذّر تحميل المجموعات المختارة.")}
                </Text>
                <ActionButton
                  label="إعادة المحاولة"
                  icon="refresh-cw"
                  secondary
                  onPress={() => void groupSelectionsQuery.refetch()}
                />
              </View>
            ) : (
              <>
                {selectedGroupJids.length > 0 ? (
                  <View style={styles.groupList}>
                    {selectedGroupJids.map((groupJid) => {
                      const group =
                        groupsQuery.data?.groups.find(
                          (item) => item.groupJid === groupJid,
                        ) ??
                        groupSelectionsQuery.data?.groups.find(
                          (item) => item.groupJid === groupJid,
                        );
                      return (
                        <View
                          key={groupJid}
                          style={[
                            styles.groupRow,
                            { borderColor: colors.border },
                          ]}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`إزالة ${group?.name ?? "المجموعة"} من الاختيار`}
                            onPress={() => toggleGroup(groupJid)}
                            style={styles.removeGroupButton}
                          >
                            <Icon name="x" size={16} color={colors.destructive} />
                          </Pressable>
                          <View style={styles.groupCopy}>
                            <Text
                              style={[
                                styles.fieldTitle,
                                { color: colors.foreground },
                              ]}
                            >
                              {group?.name ?? "مجموعة واتساب"}
                            </Text>
                            <Text
                              style={[
                                styles.bodySmall,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              {group
                                ? "مجموعة إعلانات"
                                : "المجموعة المختارة"}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <EmptyState
                    icon="message-circle"
                    title="لم تختر أي مجموعات بعد"
                    body="أضف مجموعة واتساب لبدء استيراد رسائلها وإعداد محتواها."
                  />
                )}

                <ActionButton
                  label={showAvailableGroups ? "إخفاء المجموعات" : "إضافة مجموعة جديدة"}
                  icon={showAvailableGroups ? "chevron-left" : "plus"}
                  secondary
                  onPress={() => {
                    const opening = !showAvailableGroups;
                    setShowAvailableGroups(opening);
                    setGroupsFetchEnabled(opening);
                  }}
                />

                {showAvailableGroups ? (
                  groupsQuery.isLoading ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color={colors.primary} />
                      <Text
                        style={[
                          styles.body,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        جارٍ تحميل المجموعات المتاحة…
                      </Text>
                    </View>
                  ) : groupsQuery.isError ? (
                    <View style={styles.errorBlock}>
                      <Text style={[styles.body, { color: colors.destructive }]}>
                        {errorMessage(
                          groupsQuery.error,
                          "تعذّر تحميل المجموعات المتاحة.",
                        )}
                      </Text>
                      <ActionButton
                        label="إعادة المحاولة"
                        icon="refresh-cw"
                        secondary
                        onPress={() => {
                          setGroupsFetchEnabled(true);
                          void groupsQuery.refetch();
                        }}
                      />
                    </View>
                  ) : groupsQuery.data?.groups.length ? (
                    <View style={styles.groupList}>
                      {groupsQuery.data.groups
                        .filter(
                          (group) =>
                            !selectedGroupJids.includes(group.groupJid),
                        )
                        .map((group) => (
                          <Pressable
                            key={group.groupJid}
                            accessibilityRole="button"
                            accessibilityLabel={`إضافة مجموعة ${group.name}`}
                            onPress={() => toggleGroup(group.groupJid)}
                            style={[
                              styles.groupRow,
                              { borderColor: colors.border },
                            ]}
                          >
                            <Icon name="plus" size={17} color={colors.primary} />
                            <View style={styles.groupCopy}>
                              <Text
                                style={[
                                  styles.fieldTitle,
                                  { color: colors.foreground },
                                ]}
                              >
                                {group.name}
                              </Text>
                              <Text
                                style={[
                                  styles.bodySmall,
                                  { color: colors.mutedForeground },
                                ]}
                              >
                                "مجموعة إعلانات"
                              </Text>
                            </View>
                          </Pressable>
                        ))}
                      {groupsQuery.data.groups.every((group) =>
                        selectedGroupJids.includes(group.groupJid),
                      ) ? (
                        <Text
                          style={[
                            styles.bodySmall,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          أُضيفت جميع المجموعات المتاحة.
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <EmptyState
                      icon="message-circle"
                      title="لا توجد مجموعات متاحة"
                      body="تحقق من اتصال واتساب أو حدّث قائمة المجموعات."
                    />
                  )
                ) : null}
              </>
            )}
            {groupsError ? (
              <Text accessibilityRole="alert" style={[styles.notice, { color: colors.destructive }]}>
                {groupsError}
              </Text>
            ) : null}
            <ActionButton
              label={savingGroups ? "جارٍ حفظ المجموعات…" : "حفظ إعدادات المجموعات"}
              icon={savingGroups ? "refresh-cw" : "save"}
              secondary
              disabled={
                savingGroups ||
                !groupsInitialized ||
                groupSelectionsQuery.isLoading
              }
              onPress={() => void saveGroups()}
            />
          </Panel>

        </>
      )}
      <Panel>
        <ActionButton
          label="اختبار WhatsApp Cloud API"
          icon="shield"
          secondary
          onPress={() => router.push("/whatsapp-cloud-setup" as Href)}
        />
      </Panel>
    </Page>
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
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  body: { fontSize: 13, lineHeight: 21, textAlign: "left" },
  bodySmall: { fontSize: 11, lineHeight: 18, textAlign: "left" },
  connectedPanel: { gap: 12 },
  connectedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  whatsappIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  connectedTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  accountCopy: { flex: 1, gap: 2, alignItems: "flex-start" },
  accountTitle: { fontSize: 13, fontWeight: "800", textAlign: "right" },
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
  fieldTitle: { fontSize: 13, fontWeight: "800", textAlign: "right" },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceLabel: { fontSize: 12, fontWeight: "700" },
  textInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    textAlignVertical: "top",
    writingDirection: "rtl",
    fontSize: 13,
    lineHeight: 21,
  },
  testMessageInput: { minHeight: 70 },
  previewCard: { borderRadius: 14, padding: 13, gap: 7 },
  notice: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  errorBlock: { gap: 12 },
  groupList: { gap: 8 },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
  },
  removeGroupButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCopy: { flex: 1, alignItems: "flex-start", gap: 2 },
});
