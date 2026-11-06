import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import {
  type WhatsAppSyncStatusEntry,
  type WhatsAppSyncStatusResponse,
} from "@workspace/api-client-react";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  ActionButton,
  EmptyState,
  Panel,
  SectionTitle,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import {
  formatArabicDateTime,
  formatArabicNumber,
  normalizeArabicDigits,
} from "@/lib/formatting";

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
  historyMessageLimit: string;
  onHistoryMessageLimitChange: (value: string) => void;
  onUpdateSetting: (setting: WhatsAppSyncSettingKey, enabled: boolean) => void;
  onManageGroups: () => void;
  onRefresh: () => void;
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
  historyMessageLimit,
  onHistoryMessageLimitChange,
  onUpdateSetting,
  onManageGroups,
  onRefresh,
  onOpenGroupMessages,
  onRunSync,
}: WhatsAppSyncStatusPanelProps) {
  const colors = useColors();
  const savedMessageCount = groups.reduce(
    (total, group) => total + group.savedMessageCount,
    0,
  );
  const latestSyncAt = groups.reduce<string | null>((latest, group) => {
    if (!group.lastSyncedAt || !Number.isFinite(Date.parse(group.lastSyncedAt))) {
      return latest;
    }
    return !latest || Date.parse(group.lastSyncedAt) > Date.parse(latest)
      ? group.lastSyncedAt
      : latest;
  }, null);

  const renderSetting = (
    setting: WhatsAppSyncSettingKey,
    label: string,
    value: boolean | undefined,
  ) => (
    <View key={setting} style={styles.autoSyncToggleRow}>
      <Text style={[styles.autoSyncToggleLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <Text style={[styles.settingState, { color: colors.mutedForeground }]}>
        {loading
          ? "جارٍ التحميل"
          : hasError
            ? "غير متاح"
            : value
              ? "مفعّلة"
              : "متوقفة"}
      </Text>
      <View style={styles.autoSyncSwitch}>
        <Switch
          accessibilityLabel={label}
          value={value ?? true}
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
      <SectionTitle
        title="مزامنة المحتوى"
        action={
          <Pressable
            accessibilityRole="button"
            onPress={onManageGroups}
            style={[
              styles.manageGroupsButton,
              { borderColor: colors.border },
            ]}
          >
            <Icon name="settings" size={14} color={colors.primary} />
            <Text
              style={[styles.secondaryActionLabel, { color: colors.primary }]}
            >
              إدارة المجموعات
            </Text>
          </Pressable>
        }
      />
      {!loading && !hasError ? (
        <View style={styles.summaryRow}>
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Icon name="user" size={16} color={colors.primary} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {formatArabicNumber(groups.length)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              مجموعات بسجل
            </Text>
          </View>
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Icon name="message-circle" size={16} color={colors.primary} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {formatArabicNumber(savedMessageCount)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              رسائل محفوظة
            </Text>
          </View>
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Icon name="refresh-cw" size={16} color={colors.primary} />
            <Text style={[styles.summaryRecent, { color: colors.foreground }]}>
              {formatArabicDateTime(latestSyncAt) ?? "لا يوجد"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              آخر مزامنة
            </Text>
          </View>
        </View>
      ) : null}
      <Text style={[styles.sectionCaption, { color: colors.mutedForeground }]}>
        خيارات استيراد الرسائل والوسائط
      </Text>
      {renderSetting(
        "autoSyncEnabled",
        "المزامنة التلقائية",
        status?.autoSyncEnabled,
      )}
      {syncSettings.map(([setting, label]) =>
        renderSetting(setting, label, status?.[setting]),
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
      {syncPreviousMessages ? (
        <View style={styles.historyLimitContainer}>
          <Text style={[styles.autoSyncToggleLabel, { color: colors.foreground }]}>
            الحد الأقصى للرسائل السابقة لكل مجموعة
          </Text>
          <TextInput
            accessibilityLabel="عدد الرسائل السابقة لكل مجموعة"
            accessibilityHint="أدخل عدداً من 1 إلى 100000"
            editable={!syncing}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) =>
              onHistoryMessageLimitChange(
                normalizeArabicDigits(value).replace(/\D/g, ""),
              )
            }
            selectTextOnFocus
            style={[
              styles.historyLimitInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
            value={historyMessageLimit}
          />
          <Text style={[styles.syncStatusText, { color: colors.mutedForeground }]}>
            العدد حد أقصى لكل مجموعة. القيمة الافتراضية 500، ويمكن إدخال 1 إلى 100000.
          </Text>
        </View>
      ) : null}
      <Text style={[styles.sectionCaption, { color: colors.mutedForeground }]}>
        استيراد السجل السابق
      </Text>
      <Text style={[styles.syncStatusText, { color: colors.mutedForeground }]}>
        {syncPreviousMessages
          ? "عند التفعيل، تستورد الرسائل السابقة من المجموعات المحددة حسب خيارات الرسائل والوسائط أعلاه."
          : "عند الإيقاف، تُزامَن الرسائل الجديدة فقط؛ لن تظهر الرسائل الأقدم إلا عند تفعيل هذا الخيار."}
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
        <View style={styles.errorState}>
          <Text style={[styles.error, { color: colors.destructive }]}>
            تعذّر تحميل حالة المزامنة من الخادم.
          </Text>
          <ActionButton
            label="إعادة تحميل الحالة"
            icon="refresh-cw"
            secondary
            onPress={onRefresh}
          />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.emptySyncState}>
          <EmptyState
            icon="message-circle"
            title="لم تبدأ المزامنة بعد"
            body="اختر مجموعات واتساب، ثم ابدأ المزامنة لعرض الرسائل وحالتها هنا."
          />
          <ActionButton
            label="اختيار المجموعات"
            icon="user"
            onPress={onManageGroups}
          />
        </View>
      ) : (
        <View style={styles.syncStatusList}>
          <Text style={[styles.sectionCaption, { color: colors.mutedForeground }]}>
            سجل المجموعات
          </Text>
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
                  {formatArabicDateTime(group.lastSyncedAt) ?? "لا توجد"}
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
          style={[
            styles.notice,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Icon name="alert-circle" size={16} color={colors.warning} />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(127, 127, 127, 0.25)",
  },
  settingState: { fontSize: 10, fontWeight: "700" },
  manageGroupsButton: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  summaryCard: {
    flex: 1,
    minWidth: 96,
    minHeight: 86,
    borderWidth: 1,
    borderRadius: 13,
    padding: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
  },
  summaryValue: { fontSize: 17, fontWeight: "800" },
  summaryRecent: { fontSize: 10, fontWeight: "700", textAlign: "right" },
  summaryLabel: { fontSize: 9, fontWeight: "600" },
  sectionCaption: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 4,
  },
  emptySyncState: { gap: 12 },
  errorState: { gap: 10 },
  notice: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 17, textAlign: "right" },
  historyLimitContainer: { gap: 7 },
  historyLimitInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    textAlign: "right",
    writingDirection: "ltr",
    fontSize: 15,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryActionLabel: { fontSize: 11, fontWeight: "800" },
  error: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  syncStatusLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  syncStatusText: { fontSize: 11, lineHeight: 17, textAlign: "left" },
  syncStatusList: { gap: 8 },
  syncStatusItem: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  syncStatusHeader: {
    flexDirection: "row",
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
  syncStatusError: { fontSize: 10, lineHeight: 15, textAlign: "left" },
});
