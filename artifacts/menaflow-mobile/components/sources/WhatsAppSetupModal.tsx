import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import type { WhatsAppGroupOption } from "@workspace/api-client-react";

interface WhatsAppSetupModalProps {
  visible: boolean;
  loading: boolean;
  loadError?: string;
  groups: WhatsAppGroupOption[];
  initialized: boolean;
  busy: boolean;
  setupError?: string;
  onRetryLoading: () => void;
  onRemoveGroup: (jid: string) => void;
  onOpenGroupPicker: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function WhatsAppSetupModal({
  visible,
  loading,
  loadError,
  groups,
  initialized,
  busy,
  setupError,
  onRetryLoading,
  onRemoveGroup,
  onOpenGroupPicker,
  onSave,
  onClose,
}: WhatsAppSetupModalProps) {
  const colors = useColors();

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.whatsappSetupDialog,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
            إكمال إعداد واتساب
          </Text>
          <Text
            style={[
              styles.dialogDescription,
              { color: colors.mutedForeground },
            ]}
          >
            اختر مجموعات واتساب التي تريد ربطها بحسابك. قد تمنع إعدادات بعض
            المجموعات إرسال الرسائل.
          </Text>
          <Text
            style={[styles.setupSectionTitle, { color: colors.foreground }]}
          >
            مصدر البيانات والنشر
          </Text>
          <Text
            style={[
              styles.dialogDescription,
              { color: colors.mutedForeground },
            ]}
          >
            مصادر البيانات المحددة
          </Text>
          {loading || !initialized ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={[
                  styles.loadingLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                جارٍ تحميل إعدادات مجموعاتك…
              </Text>
            </View>
          ) : loadError ? (
            <View style={styles.setupEmptyState}>
              <Text
                style={[styles.emptyMessage, { color: colors.destructive }]}
              >
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onRetryLoading}
                style={[
                  styles.secondaryAction,
                  { borderColor: colors.border },
                ]}
              >
                <Icon name="refresh-cw" size={15} color={colors.primary} />
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.primary },
                  ]}
                >
                  إعادة المحاولة
                </Text>
              </Pressable>
            </View>
          ) : groups.length === 0 ? (
            <Text
              style={[styles.emptyMessage, { color: colors.mutedForeground }]}
            >
              لم يتم اختيار مجموعات بعد.
            </Text>
          ) : (
            <ScrollView style={styles.selectedGroupList} nestedScrollEnabled>
              {groups.map((group) => (
                <View
                  key={group.groupJid}
                  style={[
                    styles.selectedGroupCard,
                    { borderColor: colors.border },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`إزالة ${group.name} من الاختيار`}
                    onPress={() => onRemoveGroup(group.groupJid)}
                    style={styles.removeGroupButton}
                  >
                    <Icon name="x" size={16} color={colors.destructive} />
                  </Pressable>
                  <View style={styles.selectedGroupCopy}>
                    <Text
                      style={[
                        styles.selectedGroupName,
                        { color: colors.foreground },
                      ]}
                    >
                      {group.name}
                    </Text>
                    <StatusPill label="النشر متاح (آخر تحقق)" tone="green" />
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!initialized || loading}
            onPress={onOpenGroupPicker}
            style={[
              styles.primaryAction,
              {
                backgroundColor: colors.primary,
                opacity: !initialized || loading ? 0.5 : 1,
              },
            ]}
          >
            <Icon name="plus" size={16} color={colors.primaryForeground} />
            <Text
              style={[
                styles.primaryActionLabel,
                { color: colors.primaryForeground },
              ]}
            >
              اختر مصدر البيانات
            </Text>
          </Pressable>
          {setupError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.dialogError, { color: colors.destructive }]}
            >
              {setupError}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={[
                styles.dialogButton,
                { borderColor: colors.border, opacity: busy ? 0.6 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.dialogButtonLabel,
                  { color: colors.foreground },
                ]}
              >
                إغلاق
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || !initialized || loading}
              onPress={onSave}
              style={[
                styles.dialogButton,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                  opacity: busy || !initialized || loading ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.dialogButtonLabel,
                  { color: colors.primaryForeground },
                ]}
              >
                {busy ? "جارٍ الحفظ…" : "حفظ إعدادات واتساب"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  whatsappSetupDialog: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  setupSectionTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },
  loadingLabel: { fontSize: 13, fontWeight: "700" },
  setupEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 10,
  },
  emptyMessage: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  secondaryAction: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secondaryActionLabel: { fontSize: 12, fontWeight: "700" },
  selectedGroupList: { maxHeight: 220 },
  selectedGroupCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  selectedGroupCopy: { flex: 1, alignItems: "flex-start", gap: 4 },
  selectedGroupName: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  removeGroupButton: { padding: 6 },
  primaryAction: {
    minHeight: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryActionLabel: { fontSize: 14, fontWeight: "800" },
  dialogError: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  dialogButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogButtonLabel: { fontSize: 13, fontWeight: "800" },
});
