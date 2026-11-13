import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useStudio } from "@/context/StudioContext";
import { useColors } from "@/hooks/useColors";

export type AppAlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type AlertRequest = {
  id: number;
  title: string;
  message: string;
  buttons: AppAlertButton[];
};

type NoticeRequest = {
  title: string;
  message: string;
  tone: "info" | "success" | "error";
};

type FeedbackEvent =
  | { type: "alert"; request: AlertRequest }
  | { type: "notice"; request: NoticeRequest };

const listeners = new Set<(event: FeedbackEvent) => void>();
let nextAlertId = 0;

function emit(event: FeedbackEvent) {
  for (const listener of listeners) listener(event);
}

export const AppAlert = {
  alert(title: string, message = "", buttons?: AppAlertButton[]) {
    emit({
      type: "alert",
      request: {
        id: ++nextAlertId,
        title,
        message,
        buttons: buttons?.length ? buttons : [{ text: "حسنًا" }],
      },
    });
  },
};

export function showAppNotice(request: NoticeRequest) {
  emit({ type: "notice", request });
}

export function AppFeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { preferences } = useStudio();
  const [alerts, setAlerts] = useState<AlertRequest[]>([]);
  const [notice, setNotice] = useState<NoticeRequest | null>(null);

  useEffect(() => {
    const listener = (event: FeedbackEvent) => {
      if (event.type === "alert") {
        setAlerts((current) => [...current, event.request]);
      } else if (preferences.inAppAlerts) {
        setNotice(event.request);
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [preferences.inAppAlerts]);

  useEffect(() => {
    if (!preferences.inAppAlerts) setNotice(null);
  }, [preferences.inAppAlerts]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const dismissAlert = (button?: AppAlertButton) => {
    setAlerts((current) => current.slice(1));
    button?.onPress?.();
  };
  const activeAlert = alerts[0];

  return (
    <View style={styles.root}>
      {children}
      {notice ? (
        <View
          accessibilityRole={notice.tone === "error" ? "alert" : "none"}
          accessibilityLiveRegion={notice.tone === "error" ? "assertive" : "polite"}
          style={[
            styles.notice,
            {
              top: insets.top + 10,
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon
            name={notice.tone === "success" ? "check-circle" : "alert-circle"}
            size={18}
            color={
              notice.tone === "error"
                ? colors.destructive
                : notice.tone === "success"
                  ? colors.green
                  : colors.primary
            }
          />
          <View style={styles.noticeCopy}>
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
              {notice.title}
            </Text>
            <Text style={[styles.noticeMessage, { color: colors.mutedForeground }]}>
              {notice.message}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق الإشعار"
            hitSlop={8}
            onPress={() => setNotice(null)}
          >
            <Icon name="x" size={17} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      <Modal
        visible={Boolean(activeAlert)}
        transparent
        animationType="fade"
        onRequestClose={() => dismissAlert()}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="إغلاق مربع الحوار"
            onPress={() => dismissAlert()}
            style={StyleSheet.absoluteFill}
          />
          {activeAlert ? (
            <View
              accessibilityViewIsModal
              accessibilityRole="alert"
              style={[
                styles.dialog,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
                {activeAlert.title}
              </Text>
              {activeAlert.message ? (
                <Text
                  style={[styles.dialogMessage, { color: colors.mutedForeground }]}
                >
                  {activeAlert.message}
                </Text>
              ) : null}
              <View style={styles.dialogActions}>
                {activeAlert.buttons.map((button, index) => {
                  const destructive = button.style === "destructive";
                  const cancel = button.style === "cancel";
                  return (
                    <Pressable
                      key={`${button.text}-${index}`}
                      accessibilityRole="button"
                      onPress={() => dismissAlert(button)}
                      style={({ pressed }) => [
                        styles.dialogButton,
                        {
                          backgroundColor: destructive
                            ? colors.destructive
                            : cancel
                              ? colors.secondary
                              : colors.primary,
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dialogButtonText,
                          {
                            color: destructive
                              ? colors.destructiveForeground
                              : cancel
                                ? colors.foreground
                                : colors.primaryForeground,
                          },
                        ]}
                      >
                        {button.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  notice: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1200,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  noticeCopy: { flex: 1, minWidth: 0, gap: 2 },
  noticeTitle: { fontSize: 13, fontWeight: "800", textAlign: "right" },
  noticeMessage: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  dialog: {
    width: "100%",
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    gap: 14,
  },
  dialogTitle: { fontSize: 17, fontWeight: "800", textAlign: "right" },
  dialogMessage: { fontSize: 14, lineHeight: 22, textAlign: "right" },
  dialogActions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 4,
  },
  dialogButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    paddingHorizontal: 10,
  },
  dialogButtonText: { fontSize: 13, fontWeight: "800", textAlign: "center" },
});