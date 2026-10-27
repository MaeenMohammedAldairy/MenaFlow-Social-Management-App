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
import { useColors } from "@/hooks/useColors";
import { WhatsAppMessageGroupCard } from "./WhatsAppMessageGroupCard";
import type { DisplayedWhatsAppMessageGroup } from "@/lib/source-message-groups";
import type { WhatsAppGroupMessagesResponse } from "@workspace/api-client-react";

interface WhatsAppGroupMessagesModalProps {
  visible: boolean;
  activeGroupJid: string | null;
  activeGroupName: string;
  loading: boolean;
  error: string;
  messagesData: WhatsAppGroupMessagesResponse | null;
  displayedMessageGroups: DisplayedWhatsAppMessageGroup[];
  page: number;
  convertingMessageIds?: Record<string, boolean>;
  associationDecisionPending?: string | null;
  associationError?: string;
  onClose: () => void;
  onPreview: (url: string) => void;
  onConvert: (messageId: string) => void;
  onAssociationDecision: (
    sourceMessageId: string,
    candidateMessageId: string,
    decision: "accepted" | "rejected",
  ) => void;
  onLoadPage: (jid: string, page: number) => void;
}

export function WhatsAppGroupMessagesModal({
  visible,
  activeGroupJid,
  activeGroupName,
  loading,
  error,
  messagesData,
  displayedMessageGroups,
  page,
  convertingMessageIds,
  associationDecisionPending,
  associationError,
  onClose,
  onPreview,
  onConvert,
  onAssociationDecision,
  onLoadPage,
}: WhatsAppGroupMessagesModalProps) {
  const colors = useColors();
  const hasCurrentGroupData = messagesData?.groupJid === activeGroupJid;

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
          <View style={styles.syncStatusHeader}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[
                styles.disconnectButton,
                { borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.disconnectLabel, { color: colors.foreground }]}
              >
                إغلاق
              </Text>
            </Pressable>
            <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
              {activeGroupName || activeGroupJid || "رسائل واتساب"}
            </Text>
          </View>

          {loading && !hasCurrentGroupData ? (
            <View style={styles.groupsLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text
                style={[styles.loadingLabel, { color: colors.foreground }]}
              >
                جارٍ جلب الرسائل…
              </Text>
            </View>
          ) : error && !hasCurrentGroupData ? (
            <View style={styles.setupEmptyState}>
              <Text
                style={[styles.emptyMessage, { color: colors.destructive }]}
              >
                {error}
              </Text>
              {activeGroupJid ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onLoadPage(activeGroupJid, page || 1)}
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
              ) : null}
            </View>
          ) : !hasCurrentGroupData ||
            (messagesData?.messages ?? []).length === 0 ? (
            <View style={styles.setupEmptyState}>
              {error ? (
                <Text
                  style={[
                    styles.emptyMessage,
                    { color: colors.destructive },
                  ]}
                >
                  {error}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.emptyMessage,
                  { color: colors.mutedForeground },
                ]}
              >
                لا توجد رسائل محفوظة في هذه المجموعة حتى الآن.
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={[
                  styles.dialogDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                عدد الرسائل المحفوظة: {messagesData?.totalCount ?? 0}
              </Text>
              {associationError ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.emptyMessage,
                    { color: colors.destructive, marginBottom: 8 },
                  ]}
                >
                  {associationError}
                </Text>
              ) : null}
              {error ? (
                <Text
                  style={[
                    styles.emptyMessage,
                    { color: colors.destructive, marginBottom: 8 },
                  ]}
                >
                  {error}
                </Text>
              ) : null}
              <ScrollView
                style={{ maxHeight: 430 }}
                contentContainerStyle={{ gap: 10 }}
              >
                {displayedMessageGroups.map((messageGroup) => (
                  <WhatsAppMessageGroupCard
                    key={messageGroup.key}
                    group={messageGroup}
                    convertingMessageIds={convertingMessageIds ?? {}}
                    associationDecisionPending={associationDecisionPending ?? null}
                    onPreview={onPreview}
                    onConvert={(messageId) => onConvert(messageId)}
                    onAssociationDecision={onAssociationDecision}
                  />
                ))}
              </ScrollView>
              <View style={styles.dialogActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    !messagesData ||
                    !messagesData.hasNextPage ||
                    loading
                  }
                  onPress={() =>
                    activeGroupJid &&
                    onLoadPage(activeGroupJid, (page || 1) + 1)
                  }
                  style={[
                    styles.dialogButton,
                    {
                      borderColor: colors.border,
                      opacity:
                        !messagesData ||
                        !messagesData.hasNextPage ||
                        loading
                          ? 0.5
                          : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dialogButtonLabel,
                      { color: colors.foreground },
                    ]}
                  >
                    الصفحة التالية
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={page <= 1 || loading}
                  onPress={() =>
                    activeGroupJid &&
                    onLoadPage(activeGroupJid, Math.max(1, page - 1))
                  }
                  style={[
                    styles.dialogButton,
                    {
                      borderColor: colors.border,
                      opacity: page <= 1 || loading ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dialogButtonLabel,
                      { color: colors.foreground },
                    ]}
                  >
                    السابق
                  </Text>
                </Pressable>
              </View>
            </>
          )}
          {activeGroupJid ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => onLoadPage(activeGroupJid, page || 1)}
              style={[
                styles.secondaryAction,
                {
                  borderColor: colors.border,
                  alignSelf: "flex-end",
                  opacity: loading ? 0.5 : 1,
                },
              ]}
            >
              {loading ? (
                <ActivityIndicator size={15} color={colors.primary} />
              ) : (
                <Icon name="refresh-cw" size={15} color={colors.primary} />
              )}
              <Text
                style={[
                  styles.secondaryActionLabel,
                  { color: colors.primary },
                ]}
              >
                تحديث الرسائل
              </Text>
            </Pressable>
          ) : null}
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
  syncStatusHeader: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "right" },
  disconnectButton: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectLabel: { fontSize: 12, fontWeight: "700" },
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
