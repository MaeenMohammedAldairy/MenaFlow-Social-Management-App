import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";

export type DisconnectPlatform = "facebook" | "instagram" | "whatsapp";

export type DisconnectDialogState = {
  platform: DisconnectPlatform;
  accountName: string;
  status: "confirm" | "pending" | "success" | "error";
  message?: string;
};

interface DisconnectConfirmModalProps {
  dialog: DisconnectDialogState | null;
  hasInstagramConnected?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DisconnectConfirmModal({
  dialog,
  hasInstagramConnected,
  onConfirm,
  onClose,
}: DisconnectConfirmModalProps) {
  const colors = useColors();

  if (!dialog) return null;

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (dialog.status !== "pending") onClose();
      }}
    >
      <View style={styles.modalOverlay}>
        <View
          accessibilityViewIsModal
          style={[
            styles.whatsappDialog,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
            {dialog.status === "success"
              ? "تم إلغاء الربط"
              : dialog.status === "error"
                ? "تعذر إلغاء الربط"
                : `إلغاء ربط ${
                    dialog.platform === "facebook"
                      ? "فيسبوك"
                      : dialog.platform === "instagram"
                        ? "إنستغرام"
                        : "واتساب"
                  }`}
          </Text>
          {dialog.status === "confirm" ? (
            <Text
              style={[
                styles.dialogDescription,
                { color: colors.mutedForeground },
              ]}
            >
              سيتم فصل حساب {dialog.accountName} من مساحة عملك.
              {dialog.platform === "facebook" && hasInstagramConnected
                ? " وسيُفصل حساب إنستغرام المرتبط به أيضًا."
                : null}
              {dialog.platform === "whatsapp"
                ? " ستنتهي جلسة WhatsApp لدى Evolution، مع الاحتفاظ بالرسائل والبيانات المحفوظة."
                : null}
            </Text>
          ) : null}
          {dialog.status === "pending" ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={[styles.loadingLabel, { color: colors.foreground }]}
              >
                جارٍ تنفيذ طلب الفصل…
              </Text>
            </View>
          ) : null}
          {dialog.message ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.dialogDescription,
                {
                  color:
                    dialog.status === "error"
                      ? colors.destructive
                      : colors.mutedForeground,
                },
              ]}
            >
              {dialog.message}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            {dialog.status === "confirm" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="تأكيد إلغاء الربط"
                onPress={onConfirm}
                style={[
                  styles.disconnectConfirmButton,
                  { backgroundColor: colors.destructive },
                ]}
              >
                <Text
                  style={[styles.dialogButtonLabel, { color: "#ffffff" }]}
                >
                  تأكيد إلغاء الربط
                </Text>
              </Pressable>
            ) : dialog.status === "error" ? (
              <Pressable
                accessibilityRole="button"
                onPress={onConfirm}
                style={[
                  styles.disconnectConfirmButton,
                  { backgroundColor: colors.destructive },
                ]}
              >
                <Text
                  style={[styles.dialogButtonLabel, { color: "#ffffff" }]}
                >
                  إعادة المحاولة
                </Text>
              </Pressable>
            ) : null}
            {dialog.status !== "pending" ? (
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
                  {dialog.status === "confirm" ? "تراجع" : "إغلاق"}
                </Text>
              </Pressable>
            ) : null}
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
  whatsappDialog: {
    width: "100%",
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },
  loadingLabel: { fontSize: 13, fontWeight: "700" },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  disconnectConfirmButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  dialogButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogButtonLabel: { fontSize: 13, fontWeight: "800" },
});
