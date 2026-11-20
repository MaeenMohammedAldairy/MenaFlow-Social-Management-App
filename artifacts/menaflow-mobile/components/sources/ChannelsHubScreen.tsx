import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
  getWhatsAppAutoReplySettings,
} from "@workspace/api-client-react";
import { BrandHeader, Page, Panel, StatusPill } from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { useColors } from "@/hooks/useColors";
import { useStudio } from "@/context/StudioContext";
import { isLocalAuthDisabled } from "@/constants/auth";
import { getMetaAutoReplySettings } from "@/lib/meta-inbox-api";
import { formatArabicNumber } from "@/lib/formatting";

/**
 * One door for everything that connects the workspace to a channel: publishing
 * accounts, the WhatsApp source, publishing automation, and replies. Each row
 * shows the live state next to the action, so the answer to "is WhatsApp
 * connected?" does not require walking three screens.
 */
export function ChannelsHubScreen() {
  if (isLocalAuthDisabled) return <ChannelsHubContent userId={null} />;
  return <AuthenticatedChannelsHub />;
}

function AuthenticatedChannelsHub() {
  const { userId } = useAuth();
  return <ChannelsHubContent userId={userId ?? null} />;
}

function ChannelsHubContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { autoPublishSettings } = useStudio();
  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
  });
  const metaReplyQuery = useQuery({
    queryKey: ["meta-auto-reply-settings", userId ?? "local"] as const,
    queryFn: getMetaAutoReplySettings,
    retry: false,
  });
  const whatsAppReplyQuery = useQuery({
    queryKey: ["whatsappAutoReplySettings", userId ?? "local"] as const,
    queryFn: getWhatsAppAutoReplySettings,
    retry: false,
  });

  const connections = connectionsQuery.data;
  const facebookReady = connections?.facebook?.authorizationStatus === "ready";
  const instagramReady =
    connections?.instagram?.authorizationStatus === "ready";
  const whatsAppConnected =
    connections?.whatsapp?.connectionState === "connected";
  const metaReplyEnabled = metaReplyQuery.data?.settings.enabled === true;
  const whatsAppReplyEnabled =
    whatsAppReplyQuery.data?.connected === true &&
    whatsAppReplyQuery.data?.settings.enabled === true;

  const readyCount = [
    facebookReady || instagramReady,
    whatsAppConnected,
    autoPublishSettings.enabled,
    metaReplyEnabled || whatsAppReplyEnabled,
  ].filter(Boolean).length;

  const open = (href: Parameters<typeof router.push>[0]) => router.push(href);

  return (
    <Page>
      <BrandHeader
        title="القنوات"
        back={{ href: "/(tabs)/more", label: "العودة إلى المزيد" }}
      />
      <Text style={[styles.progress, { color: colors.mutedForeground }]}>
        {`${formatArabicNumber(readyCount)} من 4 جاهزة`}
      </Text>

      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <View
              style={[styles.cardIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="share-2" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              حسابات النشر
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إدارة حسابات النشر"
            onPress={() => open("/(tabs)/more/accounts")}
          >
            <Text style={[styles.link, { color: colors.primary }]}>إدارة</Text>
          </Pressable>
        </View>
        <ChannelRow
          platform="facebook"
          label="فيسبوك"
          account={connections?.facebook?.accountName ?? null}
          connected={facebookReady}
          needsReconnect={
            connections?.facebook?.authorizationStatus ===
            "needs_reauthorization"
          }
        />
        <ChannelRow
          platform="instagram"
          label="إنستغرام"
          account={connections?.instagram?.accountName ?? null}
          connected={instagramReady}
          needsReconnect={
            connections?.instagram?.authorizationStatus ===
            "needs_reauthorization"
          }
        />
      </Panel>

      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <View
              style={[styles.cardIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="message-square" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              واتساب
            </Text>
          </View>
          <StatusPill
            label={whatsAppConnected ? "متصل" : "غير مرتبط"}
            tone={whatsAppConnected ? "green" : "amber"}
          />
        </View>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          {whatsAppConnected
            ? `المصدر: ${connections?.whatsapp?.accountName || "حساب واتساب"}. اختر المجموعات التي تُستورد رسائلها.`
            : "اربط واتساب لاستيراد رسائل المجموعات وتحويلها إلى منشورات."}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="الانتقال إلى مصدر واتساب والمزامنة"
            onPress={() =>
              open(
                whatsAppConnected
                  ? "/(tabs)/more/sources"
                  : {
                      pathname: "/(tabs)/more/sources",
                      params: { section: "connections" },
                    },
              )
            }
            style={[
              styles.secondaryButton,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
              {whatsAppConnected ? "المجموعات والمزامنة" : "ربط واتساب"}
            </Text>
            <Icon name="chevron-left" size={15} color={colors.primary} />
          </Pressable>
          {whatsAppConnected ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إدارة حساب واتساب"
              onPress={() =>
                open({
                  pathname: "/(tabs)/more/sources",
                  params: { section: "connections" },
                })
              }
              style={[
                styles.secondaryButton,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
                إدارة الحساب
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Panel>

      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <View
              style={[styles.cardIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="zap" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              النشر التلقائي
            </Text>
          </View>
          <StatusPill
            label={autoPublishSettings.enabled ? "مفعّل" : "متوقف"}
            tone={autoPublishSettings.enabled ? "green" : "amber"}
          />
        </View>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          {autoPublishSettings.enabled
            ? "المنشورات المعتمدة تُنشر تلقائيًا على القنوات المختارة."
            : "عند التفعيل، يُنشر المحتوى المعتمد دون تدخل يدوي."}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إدارة إعدادات النشر التلقائي"
            onPress={() => open("/publishing-settings")}
            style={[
              styles.secondaryButton,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
              {autoPublishSettings.enabled ? "إدارة الإعدادات" : "تفعيل النشر التلقائي"}
            </Text>
            <Icon name="chevron-left" size={15} color={colors.primary} />
          </Pressable>
        </View>
      </Panel>

      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <View
              style={[styles.cardIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="message-circle" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              الرد الآلي
            </Text>
          </View>
          <StatusPill
            label={
              metaReplyEnabled || whatsAppReplyEnabled ? "مفعّل" : "متوقف"
            }
            tone={
              metaReplyEnabled || whatsAppReplyEnabled ? "green" : "amber"
            }
          />
        </View>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          {`فيسبوك وإنستغرام: ${metaReplyEnabled ? "مفعّل" : "متوقف"} · واتساب: ${
            whatsAppReplyEnabled ? "مفعّل" : "متوقف"
          }`}
        </Text>
        <View style={styles.cardActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعداد الرد الآلي للقنوات"
            onPress={() => open("/inbox/reply-settings")}
            style={[
              styles.secondaryButton,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
              إعداد الردود
            </Text>
            <Icon name="chevron-left" size={15} color={colors.primary} />
          </Pressable>
        </View>
      </Panel>
    </Page>
  );
}

function ChannelRow({
  platform,
  label,
  account,
  connected,
  needsReconnect,
}: {
  platform: "facebook" | "instagram";
  label: string;
  account: string | null;
  connected: boolean;
  needsReconnect: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.channelRow, { borderColor: colors.border }]}>
      <SocialPlatformIcon platform={platform} size={20} />
      <View style={styles.channelCopy}>
        <Text style={[styles.channelName, { color: colors.foreground }]}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.channelAccount, { color: colors.mutedForeground }]}
        >
          {account ? `@${account}` : "لم يُربط بعد"}
        </Text>
      </View>
      <StatusPill
        label={connected ? "متصل" : needsReconnect ? "يحتاج ربطًا" : "غير مرتبط"}
        tone={connected ? "green" : "amber"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  card: { gap: 10 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitleGroup: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  cardTitle: { flexShrink: 1, fontSize: 15, fontWeight: "800" },
  cardBody: { fontSize: 12, lineHeight: 19, textAlign: "right" },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 8,
  },
  link: { fontSize: 13, fontWeight: "700" },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  channelCopy: { flex: 1, gap: 2 },
  channelName: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  channelAccount: { fontSize: 12, textAlign: "right" },
  secondaryButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  secondaryLabel: { fontSize: 13, fontWeight: "700" },
});
