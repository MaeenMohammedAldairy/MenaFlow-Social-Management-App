import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, Panel, SectionTitle } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import {
  getMetaAutoReplySettings,
  saveMetaAutoReplySettings,
  type MetaAutoReplySettings,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";

const initialSettings: MetaAutoReplySettings = {
  enabled: false,
  facebookMessagesEnabled: false,
  facebookCommentsEnabled: false,
  instagramMessagesEnabled: false,
  instagramCommentsEnabled: false,
  language: "ar",
  tone: "friendly_professional",
  instructions: "",
};

const platforms: Array<{
  key: MetaInboxPlatform;
  label: string;
  messagesKey: "facebookMessagesEnabled" | "instagramMessagesEnabled";
  commentsKey: "facebookCommentsEnabled" | "instagramCommentsEnabled";
}> = [
  {
    key: "facebook",
    label: "فيسبوك",
    messagesKey: "facebookMessagesEnabled",
    commentsKey: "facebookCommentsEnabled",
  },
  {
    key: "instagram",
    label: "إنستغرام",
    messagesKey: "instagramMessagesEnabled",
    commentsKey: "instagramCommentsEnabled",
  },
];

const tones: Array<{
  value: MetaAutoReplySettings["tone"];
  label: string;
}> = [
  { value: "friendly_professional", label: "ودود ومهني" },
  { value: "concise", label: "مختصر" },
  { value: "formal", label: "رسمي" },
];

function readinessMessage(
  readiness: {
    connected: boolean;
    tokenReady: boolean;
    webhookConfigured: boolean;
    messagesSubscriptionReady: boolean;
    commentsSubscriptionReady: boolean;
    aiConfigured: boolean;
    missingPermissions: string[];
  },
  kind: "message" | "comment",
): string | null {
  if (!readiness.connected) return "اربط حساب المنصة أولًا.";
  if (!readiness.tokenReady) {
    return "تحقق من صلاحيات الحساب أو أعد ربطه من صفحة المصادر.";
  }
  if (!readiness.webhookConfigured) {
    return "أضف MENA_META_WEBHOOK_VERIFY_TOKEN إلى الخادم وأعد تشغيل API.";
  }
  if (
    kind === "message"
      ? !readiness.messagesSubscriptionReady
      : !readiness.commentsSubscriptionReady
  ) {
    return "فعّل Webhook للحساب من لوحة Meta ثم فعّل اشتراك الحسابات في الوارد.";
  }
  if (!readiness.aiConfigured) {
    return "أضف مفتاح OpenAI أو Gemini إلى إعدادات الخادم.";
  }
  const required =
    kind === "message"
      ? readiness.missingPermissions.find((permission) =>
          ["pages_messaging", "instagram_manage_messages"].includes(permission),
        )
      : readiness.missingPermissions.find((permission) =>
          ["pages_manage_engagement", "instagram_manage_comments"].includes(
            permission,
          ),
        );
  if (required) return `الصلاحية ${required} غير ممنوحة للحساب.`;
  return null;
}

export function MetaAutoReplySettingsPanel({
  userId,
}: {
  userId: string | null;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const queryKey = ["meta-auto-reply-settings", userId ?? "local"] as const;
  const query = useQuery({
    queryKey,
    queryFn: getMetaAutoReplySettings,
    retry: false,
  });
  const [settings, setSettings] =
    useState<MetaAutoReplySettings>(initialSettings);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const hasSelectedChannel = platforms.some(
    ({ messagesKey, commentsKey }) =>
      settings[messagesKey] || settings[commentsKey],
  );
  const canSave =
    hasSelectedChannel ||
    Boolean(query.data?.settings.enabled && !settings.enabled);

  useEffect(() => {
    if (query.data) setSettings(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: saveMetaAutoReplySettings,
    onSuccess: async (saved) => {
      setSettings(saved);
      setError("");
      setIsModalOpen(false);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause) => {
      if (query.data) setSettings(query.data.settings);
      setError(
        cause instanceof Error ? cause.message : "تعذر حفظ إعدادات الرد الآلي.",
      );
    },
  });

  const update = (changes: Partial<MetaAutoReplySettings>) => {
    setSettings((current) => {
      const next = { ...current, ...changes };
      next.enabled = platforms.some(
        ({ messagesKey, commentsKey }) =>
          next[messagesKey] || next[commentsKey],
      );
      return next;
    });
    setError("");
  };

  const closeModal = () => {
    if (query.data) setSettings(query.data.settings);
    setError("");
    setIsModalOpen(false);
  };

  return (
    <>
      <Panel style={styles.panel}>
        <View style={styles.summary}>
          <SectionTitle title="الرد الآلي بالذكاء الاصطناعي" />
          <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
            {query.isPending
              ? "جارٍ تحميل الإعدادات..."
              : settings.enabled
                ? "الرد الآلي مفعّل."
                : "الرد الآلي متوقف."}
          </Text>
          <ActionButton
            label={
              query.isPending ? "جارٍ تحميل الإعدادات..." : "إعداد الرد الآلي"
            }
            icon="settings"
            disabled={query.isPending || save.isPending}
            onPress={() => setIsModalOpen(true)}
          />
        </View>
      </Panel>

      <Modal
        visible={isModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <View style={styles.modalHeading}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  إعداد الرد الآلي بالذكاء الاصطناعي
                </Text>
                <Text
                  style={[styles.bodySmall, { color: colors.mutedForeground }]}
                >
                  اختر القنوات وطريقة الرد المناسبة.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق إعدادات الرد الآلي"
                disabled={save.isPending}
                onPress={closeModal}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.background },
                ]}
              >
                <Icon name="x" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                اختر أنواع الردود التي تريد تفعيلها لكل منصة. تُحفظ الاختيارات
                عند الضغط على «حفظ»، وإيقاف جميعها يوقف الرد الآلي.
              </Text>

              {query.isError ? (
                <Text style={[styles.body, { color: colors.destructive }]}>
                  {query.error instanceof Error
                    ? query.error.message
                    : "تعذر تحميل إعدادات الرد الآلي."}
                </Text>
              ) : null}

              {query.data ? (
                <>
                  {platforms.map((platform) => {
                    const readiness = query.data.readiness[platform.key];
                    const messageBlock = readinessMessage(readiness, "message");
                    const commentBlock = readinessMessage(readiness, "comment");
                    return (
                      <View
                        key={platform.key}
                        style={[
                          styles.platform,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.platformHeader,
                            { borderBottomColor: colors.border },
                          ]}
                        >
                          <View style={styles.platformHeading}>
                            <PlatformIcon platform={platform.key} />
                            <Text
                              style={[
                                styles.platformTitle,
                                { color: colors.foreground },
                              ]}
                            >
                              {platform.label}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.platformState,
                              {
                                color:
                                  settings[platform.messagesKey] ||
                                  settings[platform.commentsKey]
                                    ? colors.primary
                                    : colors.mutedForeground,
                              },
                            ]}
                          >
                            {settings[platform.messagesKey] ||
                            settings[platform.commentsKey]
                              ? "مفعّل"
                              : "متوقف"}
                          </Text>
                        </View>
                        <SettingSwitch
                          label="الرد تلقائيًا على الرسائل الخاصة"
                          enabled={settings[platform.messagesKey]}
                          busy={save.isPending}
                          disabled={
                            !settings[platform.messagesKey] &&
                            Boolean(messageBlock)
                          }
                          reason={messageBlock}
                          onChange={(value) =>
                            update({ [platform.messagesKey]: value })
                          }
                        />
                        <SettingSwitch
                          label="الرد علنًا على التعليقات"
                          enabled={settings[platform.commentsKey]}
                          busy={save.isPending}
                          disabled={
                            !settings[platform.commentsKey] &&
                            Boolean(commentBlock)
                          }
                          reason={commentBlock}
                          onChange={(value) =>
                            update({ [platform.commentsKey]: value })
                          }
                        />
                      </View>
                    );
                  })}

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      لغة الرد
                    </Text>
                    <View style={styles.choiceRow}>
                      {[
                        { value: "ar" as const, label: "العربية" },
                        {
                          value: "match_customer" as const,
                          label: "لغة العميل",
                        },
                      ].map((option) => (
                        <Text
                          key={option.value}
                          accessibilityRole="button"
                          onPress={() => update({ language: option.value })}
                          style={[
                            styles.choice,
                            {
                              color:
                                settings.language === option.value
                                  ? colors.primaryForeground
                                  : colors.foreground,
                              backgroundColor:
                                settings.language === option.value
                                  ? colors.primary
                                  : colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      ))}
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground }]}>
                      أسلوب الرد
                    </Text>
                    <View style={styles.choiceRow}>
                      {tones.map((option) => (
                        <Text
                          key={option.value}
                          accessibilityRole="button"
                          onPress={() => update({ tone: option.value })}
                          style={[
                            styles.choice,
                            {
                              color:
                                settings.tone === option.value
                                  ? colors.primaryForeground
                                  : colors.foreground,
                              backgroundColor:
                                settings.tone === option.value
                                  ? colors.primary
                                  : colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      ))}
                    </View>
                  </View>

                  {error ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: colors.destructive }}
                    >
                      {error}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </ScrollView>

            <View
              style={[styles.modalFooter, { borderTopColor: colors.border }]}
            >
              <ActionButton
                label="إلغاء"
                icon="x"
                secondary
                disabled={save.isPending}
                onPress={closeModal}
              />
              <ActionButton
                label={
                  save.isPending ? "جارٍ الحفظ..." : "حفظ إعدادات الرد الآلي"
                }
                icon={save.isPending ? "refresh-cw" : "save"}
                disabled={
                  save.isPending || query.isPending || query.isError || !canSave
                }
                onPress={() => save.mutate(settings)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SettingSwitch({
  label,
  enabled,
  busy,
  disabled,
  reason,
  onChange,
}: {
  label: string;
  enabled: boolean;
  busy: boolean;
  disabled: boolean;
  reason: string | null;
  onChange: (enabled: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.switchBlock}>
      <View style={styles.switchRow}>
        <Text style={[styles.body, { color: colors.foreground }]}>{label}</Text>
        <Switch
          accessibilityLabel={label}
          value={enabled}
          disabled={disabled || busy}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
        />
      </View>
      {!enabled && reason ? (
        <Text style={[styles.bodySmall, { color: colors.mutedForeground }]}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

function PlatformIcon({ platform }: { platform: MetaInboxPlatform }) {
  const isFacebook = platform === "facebook";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.platformIcon,
        { backgroundColor: isFacebook ? "#1877F2" : "#C13584" },
      ]}
    >
      {isFacebook ? (
        <Text style={styles.facebookGlyph}>f</Text>
      ) : (
        <Icon name="instagram" size={17} color="#FFFFFF" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  summary: { gap: 10 },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(10, 37, 64, 0.55)",
  },
  dialog: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "92%",
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalHeading: { flex: 1, gap: 4, alignItems: "flex-end" },
  modalTitle: { fontSize: 17, fontWeight: "700", textAlign: "right" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScroll: { flexShrink: 1 },
  modalContent: { gap: 16, padding: 20 },
  modalFooter: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  body: { fontSize: 13, lineHeight: 21, textAlign: "right" },
  bodySmall: { fontSize: 12, lineHeight: 19, textAlign: "right" },
  platform: {
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  platformHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  platformHeading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  platformIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  facebookGlyph: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "800",
    lineHeight: 26,
  },
  platformTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  platformState: { fontSize: 12, fontWeight: "600" },
  switchBlock: { gap: 3 },
  switchRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  choiceRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  choice: {
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 13,
  },
});
