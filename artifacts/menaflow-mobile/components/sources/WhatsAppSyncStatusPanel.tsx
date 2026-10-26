import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import {
  type WhatsAppSyncStatusEntry,
  type WhatsAppSyncStatusResponse,
} from "@workspace/api-client-react";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { Panel, SectionTitle, StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";

export type WhatsAppSyncSettingKey =
  | "autoSyncEnabled"
  | "syncMessagesEnabled"
  | "syncImagesEnabled"
  | "syncVideosEnabled";

interface WhatsAppSyncStatusPanelProps {
  status?: WhatsAppSyncStatusResponse;
  groups: WhatsAppSyncStatusEntry[];
  loading: boolean;
  hasError: boolean;
  autoSyncSaving: Record<WhatsAppSyncSettingKey, boolean>;
  syncing: boolean;
  syncNotice?: string | null;
  syncPreviousMessages: boolean;
  onSyncPreviousMessagesChange: (enabled: boolean) => void;
  onUpdateSetting: (setting: WhatsAppSyncSettingKey, enabled: boolean) => void;
  onOpenGroupMessages: (groupJid: string, groupName: string) => void;
  onRunSync: () => void;
}

const syncSettings = [
  ["syncMessagesEnabled", "مزامنة الرسائل"],
  ["syncImagesEnabled", "مزامنة الصور"],
  ["syncVideosEnabled", "مزامنة الفيديوهات"],
] as const satisfies readonly [WhatsAppSyncSettingKey, string][];

export function WhatsAppSyncStatusPanel({
  status,
  groups,
  loading,
  hasError,
  autoSyncSaving,
  syncing,
  syncNotice,
  syncPreviousMessages,
  onSyncPreviousMessagesChange,
  onUpdateSetting,
  onOpenGroupMessages,
  onRunSync,
}: WhatsAppSyncStatusPanelProps) {
  const colors = useColors();

  const renderSetting = (
    setting: WhatsAppSyncSettingKey,
    label: string,
    value: boolean,
  ) => (
    <View key={setting} style={styles.autoSyncToggleRow}>
      <Text style={[styles.autoSyncToggleLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <View style={styles.autoSyncSwitch}>
        <Switch
          accessibilityLabel={label}
          value={value}
          disabled={loading || hasError || syncing || autoSyncSaving[setting]}
          onValueChange={(enabled) => onUpdateSetting(setting, enabled)}
          trackColor={{
            false: colors.border,
            true: colors.primary,
          }}
          thumbColor={colors.card}
        />
      </View>
    </View>
  );

  return (
    <Panel>
      <SectionTitle title="حالة مزامنة واتساب" />
      {renderSetting(
        "autoSyncEnabled",
        status?.autoSyncEnabled === false
          ? "المزامنة التلقائية متوقفة"
          : "المزامنة التلقائية مفعلة",
        status?.autoSyncEnabled ?? true,
      )}
      {syncSettings.map(([setting, label]) =>
        renderSetting(setting, label, status?.[setting] ?? true),
      )}
      <View style={styles.autoSyncToggleRow}>
        <Text
          style={[styles.autoSyncToggleLabel, { color: colors.foreground }]}
        >
          مزامنة الرسائل السابقة
        </Text>
        <View style={styles.autoSyncSwitch}>
          <Switch
            accessibilityLabel="مزامنة الرسائل السابقة"
            value={syncPreviousMessages}
            disabled={syncing}
            onValueChange={onSyncPreviousMessagesChange}
            trackColor={{
              false: colors.border,
              true: colors.primary,
            }}
            thumbColor={colors.card}
          />
        </View>
      </View>
      <Text style={[styles.syncStatusText, { color: colors.mutedForeground }]}>
        {syncPreviousMessages
          ? "عند التفعيل، تستورد الرسائل السابقة من المجموعات المحددة حسب خيارات الرسائل والوسائط أعلاه."
          : "عند الإيقاف، تُزامَن الرسائل الجديدة فقط؛ لن تظهر الرسائل الأقدم إلا عند تفعيل هذا الخيار."}
      </Text>
      <Text style={[styles.syncStatusText, { color: colors.mutedForeground }]}>
        {hasError
          ? "تعذّر تحميل إعداد المزامنة التلقائية."
          : status?.autoSyncEnabled === false
            ? "المزامنة التلقائية متوقفة؛ يمكنك بدء مزامنة يدوية متى شئت."
            : "تستقبل المزامنة التلقائية الأنواع المحددة أعلاه من المجموعات المختارة."}
      </Text>
      <Text style={[styles.syncStatusText, { color: colors.mutedForeground }]}>
        الرسائل النصية تشمل النصوص والتعليقات؛ تُحفظ الصور والفيديوهات وفق
        اختياراتهما.
      </Text>
      {loading ? (
        <View style={styles.syncStatusLine}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text
            style={[styles.syncStatusText, { color: colors.mutedForeground }]}
          >
            جارٍ تحميل حالة المزامنة…
          </Text>
        </View>
      ) : hasError ? (
        <Text style={[styles.error, { color: colors.destructive }]}>
          تعذّر تحميل حالة المزامنة من الخادم.
        </Text>
      ) : groups.length === 0 ? (
        <Text
          style={[styles.syncStatusText, { color: colors.mutedForeground }]}
        >
          لا توجد سجلات مزامنة تحتوي على رسائل مستوردة.
        </Text>
      ) : (
        <View style={styles.syncStatusList}>
          {groups.map((group) => {
            const groupName = group.groupName || group.groupJid;
            return (
              <View
                key={group.groupJid}
                style={[styles.syncStatusItem, { borderColor: colors.border }]}
              >
                <View style={styles.syncStatusHeader}>
                  <Text
                    style={[
                      styles.syncStatusGroup,
                      { color: colors.foreground },
                    ]}
                  >
                    {groupName}
                  </Text>
                  <StatusPill
                    label={syncGroupStatusLabel(group.status)}
                    tone={syncGroupStatusTone(group.status)}
                  />
                </View>
                <Text
                  style={[
                    styles.syncStatusText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  المحفوظة: {group.savedMessageCount} • آخر مزامنة:{" "}
                  {group.lastSyncedAt
                    ? new Date(group.lastSyncedAt).toLocaleString("ar-EG")
                    : "لا توجد"}
                </Text>
                {group.lastError ? (
                  <Text
                    style={[
                      styles.syncStatusError,
                      { color: colors.destructive },
                    ]}
                  >
                    {syncGroupErrorMessage(group.lastError)}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpenGroupMessages(group.groupJid, groupName)}
                  style={[
                    styles.secondaryAction,
                    { borderColor: colors.border, alignSelf: "flex-end" },
                  ]}
                >
                  <Icon
                    name="message-circle"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.secondaryActionLabel,
                      { color: colors.primary },
                    ]}
                  >
                    عرض الرسائل
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          busy: syncing,
          disabled: syncing || loading || hasError,
        }}
        disabled={syncing || loading || hasError}
        onPress={onRunSync}
        style={[
          styles.secondaryAction,
          {
            borderColor: colors.border,
            opacity: syncing || loading || hasError ? 0.6 : 1,
          },
        ]}
      >
        {syncing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="refresh-cw" size={15} color={colors.primary} />
        )}
        <Text style={[styles.secondaryActionLabel, { color: colors.primary }]}>
          {syncing ? "جارٍ المزامنة…" : "مزامنة الآن حسب الخيارات"}
        </Text>
      </Pressable>
      {syncNotice ? (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.error, { color: colors.destructive }]}>
            {syncNotice}
          </Text>
        </View>
      ) : null}
    </Panel>
  );
}

function syncGroupStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "جارٍ الاستيراد";
    case "complete":
      return "اكتملت المزامنة";
    case "failed":
      return "فشلت المزامنة";
    case "partial":
      return "اكتملت جزئيًا";
    case "cancelled":
      return "أُلغيت";
    case "empty":
      return "لا توجد رسائل محفوظة";
    default:
      return status || "لم تبدأ";
  }
}

function syncGroupStatusTone(
  status: string,
): "green" | "blue" | "amber" | "muted" {
  if (status === "complete") return "green";
  if (status === "running") return "blue";
  if (status === "failed" || status === "partial" || status === "empty") {
    return "amber";
  }
  return "muted";
}

function syncGroupErrorMessage(error: string): string {
  if (error === "WHATSAPP_DATABASE_UNAVAILABLE") {
    return "تعذّر الاتصال بقاعدة البيانات أثناء حفظ الرسائل. انتظر حتى استقرار الاتصال ثم أعد المزامنة.";
  }
  if (error === "WHATSAPP_MESSAGE_IMPORT_FAILED") {
    return "تعذّر حفظ بعض الرسائل. أعد المزامنة، وإذا تكرر الخطأ فتواصل مع الدعم.";
  }
  if (error === "EVOLUTION_HISTORY_EMPTY") {
    return "لم يعثر الخادم على رسائل سابقة لهذه المجموعة في سجل واتساب المتاح. تحقّق من توفر سجل المحادثة في خدمة الربط، ثم جرّب المزامنة مرة أخرى.";
  }
  if (error === "EVOLUTION_HISTORY_MESSAGES_SKIPPED") {
    return "وصلت رسائل لهذه المجموعة، لكن تعذّر حفظها كلها. أعد المزامنة، وإذا تكرر الأمر فتواصل مع الدعم.";
  }
  return error;
}

const styles = StyleSheet.create({
  autoSyncToggleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  autoSyncToggleLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  autoSyncSwitch: {
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryAction: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryActionLabel: { fontSize: 11, fontWeight: "800" },
  error: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  syncStatusLine: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  syncStatusText: { fontSize: 11, lineHeight: 17, textAlign: "right" },
  syncStatusList: { gap: 8 },
  syncStatusItem: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  syncStatusHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  syncStatusGroup: {
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    flexShrink: 1,
  },
  syncStatusError: { fontSize: 10, lineHeight: 15, textAlign: "right" },
});
