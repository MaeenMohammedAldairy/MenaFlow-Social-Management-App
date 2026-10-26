import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { CairoText as Text, CairoTextInput } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import type { WhatsAppGroupsResponse } from "@workspace/api-client-react";

interface WhatsAppGroupPickerModalProps {
  visible: boolean;
  groupsData?: WhatsAppGroupsResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string;
  selection: string[];
  onToggleGroup: (jid: string) => void;
  onSetSelection: (jids: string[]) => void;
  onRefetch: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function WhatsAppGroupPickerModal({
  visible,
  groupsData,
  isLoading,
  isFetching,
  isError,
  errorMessage,
  selection,
  onToggleGroup,
  onSetSelection,
  onRefetch,
  onConfirm,
  onClose,
}: WhatsAppGroupPickerModalProps) {
  const colors = useColors();
  const [groupSearch, setGroupSearch] = useState("");

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
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
            اختيار مجموعات واتساب
          </Text>
          <Text
            style={[
              styles.dialogDescription,
              { color: colors.mutedForeground },
            ]}
          >
            مجموعات الإعلانات المرتبطة بحساب واتساب.
          </Text>
          {isLoading ? (
            <View style={styles.groupsLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text
                style={[styles.loadingLabel, { color: colors.foreground }]}
              >
                جارٍ جلب مجموعات الإعلانات…
              </Text>
              <Text
                style={[
                  styles.dialogDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                يتم جلب أسماء المجموعات فقط.
              </Text>
            </View>
          ) : isError ? (
            <View style={styles.setupEmptyState}>
              <Text
                style={[styles.emptyMessage, { color: colors.destructive }]}
              >
                {errorMessage || "تعذّر الاتصال بخدمة واتساب. تحقق من الاتصال وحاول مجدداً."}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isFetching}
                onPress={onRefetch}
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
          ) : groupsData ? (
            <>
              <View style={styles.groupCountsRow}>
                <StatusPill
                  label={`${groupsData.groups.length} مجموعة`}
                  tone="muted"
                />
                <StatusPill
                  label={`${selection.length} محددة`}
                  tone="blue"
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={isFetching}
                  onPress={onRefetch}
                  style={[
                    styles.refreshGroupsButton,
                    { borderColor: colors.border },
                  ]}
                >
                  {isFetching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Icon
                      name="refresh-cw"
                      size={15}
                      color={colors.primary}
                    />
                  )}
                  <Text
                    style={[
                      styles.secondaryActionLabel,
                      { color: colors.primary },
                    ]}
                  >
                    تحديث المجموعات
                  </Text>
                </Pressable>
              </View>
              <CairoTextInput
                accessibilityLabel="البحث في مجموعات واتساب"
                placeholder="ابحث باسم المجموعة"
                placeholderTextColor={colors.mutedForeground}
                value={groupSearch}
                onChangeText={setGroupSearch}
                style={[
                  styles.dialogInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked:
                    groupsData.groups.length > 0 &&
                    groupsData.groups.every((group) =>
                      selection.includes(group.groupJid),
                    ),
                }}
                disabled={groupsData.groups.length === 0}
                onPress={() => {
                  const groupJids = groupsData.groups.map(
                    (group) => group.groupJid,
                  );
                  const allSelected = groupJids.every((jid) =>
                    selection.includes(jid),
                  );
                  onSetSelection(allSelected ? [] : groupJids);
                }}
                style={[styles.selectAllRow, { borderColor: colors.border }]}
              >
                <View
                  style={[
                    styles.checkBox,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.accent,
                    },
                  ]}
                >
                  <Icon name="check" size={13} color={colors.primary} />
                </View>
                <Text
                  style={[
                    styles.groupCardTitle,
                    { color: colors.foreground },
                  ]}
                >
                  تحديد جميع المجموعات
                </Text>
              </Pressable>
              {groupsData.groups.length === 0 ? (
                <View style={styles.setupEmptyState}>
                  <Text
                    style={[
                      styles.emptyMessage,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    لم يُرجع خادم واتساب أي مجموعات لهذا الحساب.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={onRefetch}
                    style={[
                      styles.secondaryAction,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Icon
                      name="refresh-cw"
                      size={15}
                      color={colors.primary}
                    />
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
              ) : (
                <>
                  <ScrollView style={styles.groupList} nestedScrollEnabled>
                    {groupsData.groups
                      .filter((group) =>
                        group.name
                          .toLocaleLowerCase()
                          .includes(groupSearch.trim().toLocaleLowerCase()),
                      )
                      .map((group) => {
                        const selected = selection.includes(group.groupJid);
                        return (
                          <Pressable
                            key={group.groupJid}
                            accessibilityRole="checkbox"
                            accessibilityLabel={`${group.name}، مجموعة إعلانات`}
                            accessibilityState={{ checked: selected }}
                            onPress={() => onToggleGroup(group.groupJid)}
                            style={[
                              styles.groupCard,
                              {
                                borderColor: selected
                                  ? colors.primary
                                  : colors.border,
                                opacity: 1,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.checkBox,
                                {
                                  borderColor: selected
                                    ? colors.primary
                                    : colors.border,
                                  backgroundColor: selected
                                    ? colors.primary
                                    : colors.card,
                                },
                              ]}
                            >
                              {selected ? (
                                <Icon
                                  name="check"
                                  size={13}
                                  color={colors.primaryForeground}
                                />
                              ) : null}
                            </View>
                            <View
                              style={[
                                styles.groupPicturePlaceholder,
                                { backgroundColor: colors.accent },
                              ]}
                            >
                              <Icon
                                name="user"
                                size={17}
                                color={colors.primary}
                              />
                            </View>
                            <View style={styles.groupCardCopy}>
                              <Text
                                style={[
                                  styles.groupCardTitle,
                                  { color: colors.foreground },
                                ]}
                                numberOfLines={1}
                              >
                                {group.name}
                              </Text>
                              <StatusPill label="مجموعة إعلانات" tone="blue" />
                            </View>
                          </Pressable>
                        );
                      })}
                  </ScrollView>
                </>
              )}
            </>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.dialogButton, { borderColor: colors.border }]}
            >
              <Text
                style={[
                  styles.dialogButtonLabel,
                  { color: colors.foreground },
                ]}
              >
                إلغاء
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!groupsData || isFetching}
              onPress={onConfirm}
              style={[
                styles.dialogButton,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                  opacity: !groupsData || isFetching ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.dialogButtonLabel,
                  { color: colors.primaryForeground },
                ]}
              >
                تأكيد الاختيار
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
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "right" },
  groupsLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 8,
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
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
  },
  secondaryActionLabel: { fontSize: 12, fontWeight: "700" },
  groupCountsRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  refreshGroupsButton: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
  },
  dialogInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    textAlign: "right",
    fontSize: 14,
  },
  selectAllRow: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  groupList: { maxHeight: 360 },
  groupCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 8,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  groupPicturePlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCardCopy: { flex: 1, gap: 4, alignItems: "flex-end" },
  groupCardTitle: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  dialogActions: { flexDirection: "row-reverse", gap: 10, marginTop: 4 },
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
