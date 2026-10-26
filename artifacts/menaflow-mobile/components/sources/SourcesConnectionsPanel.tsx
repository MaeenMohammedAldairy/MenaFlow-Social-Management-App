import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { SocialConnectionsResponse } from "@workspace/api-client-react";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, Panel, SectionTitle, StatusPill } from "@/components/Ui";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { useColors } from "@/hooks/useColors";

export type SourceKey = "instagram" | "facebook" | "whatsapp";

type SourceDefinition = {
  key: SourceKey;
  name: string;
  provider: string;
  description: string;
};

const sources: SourceDefinition[] = [
  {
    key: "facebook",
    name: "فيسبوك",
    provider: "Meta Business",
    description:
      "اربط صفحة أعمال من حساب Meta الخاص بك. سيُطلب منك تسجيل الدخول بحساب فيسبوك لمنح الصلاحيات اللازمة.",
  },
  {
    key: "instagram",
    name: "إنستغرام",
    provider: "Instagram Business",
    description:
      "ربط Instagram غير مشمول في تدفق ربط Facebook الحالي، ولا يلزم لربط صفحة Facebook.",
  },
  {
    key: "whatsapp",
    name: "واتساب",
    provider: "WhatsApp Business API",
    description:
      "اربط خادم WhatsApp Business API لإدارة مجموعاتك ومزامنة محتواها ونشر المحتوى عليها.",
  },
];

interface SourcesConnectionsPanelProps {
  compactLayout: boolean;
  connections?: SocialConnectionsResponse;
  busySources: Record<SourceKey, boolean>;
  disconnectingSource: SourceKey | null;
  connectionError: string | null;
  isConnected: (key: SourceKey) => boolean;
  sourceStatus: (key: SourceKey) => string;
  buttonLabel: (key: SourceKey) => string;
  onSourceCardPress: (key: SourceKey) => void;
  onSourceAction: (key: SourceKey) => void;
  onOpenWhatsAppSetup: () => void;
  onConnectWhatsApp: () => void;
  onDisconnectWhatsApp: () => void;
  onRefresh: () => void;
}

export function SourcesConnectionsPanel({
  compactLayout,
  connections,
  busySources,
  disconnectingSource,
  connectionError,
  isConnected,
  sourceStatus,
  buttonLabel,
  onSourceCardPress,
  onSourceAction,
  onOpenWhatsAppSetup,
  onConnectWhatsApp,
  onDisconnectWhatsApp,
  onRefresh,
}: SourcesConnectionsPanelProps) {
  const colors = useColors();

  return (
    <Panel>
      <SectionTitle title="المنصات المتاحة" />
      {connectionError ? (
        <Text style={[styles.error, { color: colors.destructive }]}>
          {connectionError}
        </Text>
      ) : null}

      {sources.map((source) => {
        const connected = isConnected(source.key);
        const sourceBusy =
          busySources[source.key] || disconnectingSource === source.key;
        const whatsappRestoring =
          source.key === "whatsapp" &&
          connections?.whatsapp?.connectionState === "connecting";
        const reauthorizationRequired =
          source.key === "facebook"
            ? connections?.facebook?.authorizationStatus ===
              "needs_reauthorization"
            : source.key === "instagram" &&
              connections?.instagram?.authorizationStatus ===
                "needs_reauthorization";

        return (
          <View
            key={source.key}
            style={[
              styles.sourceCard,
              compactLayout && styles.sourceCardCompact,
              { borderColor: connected ? colors.primary : colors.border },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                connected ? `تفاصيل حساب ${source.name}` : `ربط ${source.name}`
              }
              onPress={() => onSourceCardPress(source.key)}
              disabled={sourceBusy || whatsappRestoring}
              style={[
                styles.sourceIdentity,
                compactLayout && styles.sourceIdentityCompact,
                (sourceBusy || whatsappRestoring) && styles.disabledSource,
              ]}
            >
              <View
                style={[styles.sourceIcon, { backgroundColor: colors.accent }]}
              >
                <SocialPlatformIcon platform={source.key} size={28} />
              </View>
              <View style={styles.sourceCopy}>
                <View style={styles.sourceTitleLine}>
                  <Text
                    style={[styles.sourceName, { color: colors.foreground }]}
                  >
                    {source.name}
                  </Text>
                  <StatusPill
                    label={sourceStatus(source.key)}
                    tone={connected && !reauthorizationRequired ? "green" : "muted"}
                  />
                </View>
                <Text
                  style={[
                    styles.providerName,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {source.provider}
                </Text>
                <Text
                  style={[
                    styles.sourceDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {source.description}
                </Text>
              </View>
            </Pressable>

            {source.key === "whatsapp" && connections?.whatsapp ? (
              <View style={styles.whatsappCardActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    connected ? "إعدادات حساب واتساب" : "إعادة المحاولة"
                  }
                  disabled={sourceBusy}
                  onPress={connected ? onOpenWhatsAppSetup : onConnectWhatsApp}
                  style={[
                    styles.connectButton,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary,
                      opacity: sourceBusy ? 0.6 : 1,
                    },
                  ]}
                >
                  {busySources.whatsapp &&
                  disconnectingSource !== "whatsapp" ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primaryForeground}
                    />
                  ) : (
                    <Icon
                      name={connected ? "settings" : "link-2"}
                      size={14}
                      color={colors.primaryForeground}
                    />
                  )}
                  <Text
                    style={[
                      styles.connectLabel,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {busySources.whatsapp
                      ? "جارٍ الربط…"
                      : connected
                        ? "إعدادات الحساب"
                        : "إعادة المحاولة"}
                  </Text>
                </Pressable>
                {connected ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="إلغاء ربط واتساب"
                    disabled={sourceBusy}
                    onPress={onDisconnectWhatsApp}
                    style={[
                      styles.disconnectButton,
                      {
                        borderColor: colors.border,
                        opacity: sourceBusy ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Icon
                      name="x-circle"
                      size={15}
                      color={colors.destructive}
                    />
                    <Text
                      style={[
                        styles.disconnectLabel,
                        { color: colors.destructive },
                      ]}
                    >
                      إلغاء الربط
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  reauthorizationRequired
                    ? `إعادة تفويض ${source.name}`
                    : `${connected ? "إلغاء ربط" : "ربط"} ${source.name}`
                }
                disabled={sourceBusy || whatsappRestoring}
                onPress={() => onSourceAction(source.key)}
                style={[
                  styles.connectButton,
                  {
                    borderColor: connected && !reauthorizationRequired
                      ? colors.destructive
                      : colors.primary,
                    backgroundColor: connected && !reauthorizationRequired
                      ? colors.secondary
                      : colors.primary,
                    opacity: sourceBusy || whatsappRestoring ? 0.6 : 1,
                  },
                ]}
              >
                {sourceBusy ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      disconnectingSource === source.key
                        ? colors.destructive
                        : colors.primaryForeground
                    }
                  />
                ) : (
                  <Icon
                    name={
                      connected && !reauthorizationRequired
                        ? "x-circle"
                        : "link"
                    }
                    size={14}
                    color={
                      connected && !reauthorizationRequired
                        ? colors.destructive
                        : colors.primaryForeground
                    }
                  />
                )}
                <Text
                  style={[
                    styles.connectLabel,
                    {
                      color: connected && !reauthorizationRequired
                        ? colors.destructive
                        : colors.primaryForeground,
                    },
                  ]}
                >
                  {disconnectingSource === source.key
                    ? "جارٍ الفصل…"
                    : buttonLabel(source.key)}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <ActionButton
        label="تحديث حالة الحسابات"
        icon="refresh-cw"
        secondary
        onPress={onRefresh}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  sourceCard: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },
  sourceCardCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 12,
  },
  sourceIdentity: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },
  sourceIdentityCompact: { width: "100%" },
  disabledSource: { opacity: 0.6 },
  sourceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceCopy: { flex: 1, alignItems: "flex-end", gap: 3 },
  sourceTitleLine: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  sourceName: { fontSize: 14, fontWeight: "800" },
  providerName: { fontSize: 11, fontWeight: "600" },
  sourceDescription: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  whatsappCardActions: { gap: 7, alignItems: "stretch" },
  connectButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
  },
  connectLabel: { fontSize: 12, fontWeight: "800" },
  disconnectButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  disconnectLabel: { fontSize: 10, fontWeight: "700" },
  error: { fontSize: 12, lineHeight: 18, textAlign: "right" },
});
