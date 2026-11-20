import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { getWhatsAppAutoReplySettings } from "@workspace/api-client-react";
import { BrandHeader, Page, Panel, StatusPill } from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";
import { getMetaAutoReplySettings } from "@/lib/meta-inbox-api";
import { MetaAutoReplySettingsPanel } from "@/components/inbox/MetaAutoReplySettingsPanel";
import { WhatsAppReplyPanel } from "../whatsapp-setup";

type ReplyChannel = "meta" | "whatsapp";
type ChannelStatus = { label: string; tone: "green" | "amber" | "muted" };

const channelMeta: Record<
  ReplyChannel,
  { title: string; platforms: Array<"facebook" | "instagram" | "whatsapp"> }
> = {
  meta: { title: "فيسبوك وإنستغرام", platforms: ["facebook", "instagram"] },
  whatsapp: { title: "واتساب", platforms: ["whatsapp"] },
};

export default function ReplySettingsScreen() {
  if (isLocalAuthDisabled) {
    return <ReplySettingsContent userId={null} />;
  }
  return <AuthenticatedReplySettings />;
}

function AuthenticatedReplySettings() {
  const { userId } = useAuth();
  return <ReplySettingsContent userId={userId ?? null} />;
}

function requestStatus(
  pending: boolean,
  failed: boolean,
  enabled: boolean,
): ChannelStatus {
  if (pending) return { label: "جارٍ التحقق", tone: "muted" };
  if (failed) return { label: "تعذر التحقق", tone: "amber" };
  return enabled
    ? { label: "مفعّل", tone: "green" }
    : { label: "متوقف", tone: "muted" };
}

function ReplySettingsContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const params = useLocalSearchParams<{
    channel?: string;
    tab?: string;
    returnTo?: string;
  }>();
  // Older links use ?tab=; both open the matching channel card.
  const requested = params.channel ?? params.tab;
  const [openChannel, setOpenChannel] = useState<ReplyChannel | null>(
    requested === "whatsapp" ? "whatsapp" : requested === "meta" ? "meta" : null,
  );

  useEffect(() => {
    if (requested === "whatsapp" || requested === "meta") {
      setOpenChannel(requested);
    }
  }, [requested]);

  const metaSettings = useQuery({
    queryKey: ["meta-auto-reply-settings", userId ?? "local"],
    queryFn: getMetaAutoReplySettings,
    retry: false,
  });
  const whatsAppSettings = useQuery({
    queryKey: ["whatsappAutoReplySettings", userId ?? "local"],
    queryFn: getWhatsAppAutoReplySettings,
    retry: false,
  });

  const whatsAppConnected = whatsAppSettings.data?.connected === true;
  const metaStatus = requestStatus(
    metaSettings.isPending,
    metaSettings.isError,
    metaSettings.data?.settings.enabled === true,
  );
  const whatsAppStatus: ChannelStatus = whatsAppSettings.isPending
    ? { label: "جارٍ التحقق", tone: "muted" }
    : whatsAppSettings.isError
      ? { label: "تعذر التحقق", tone: "amber" }
      : !whatsAppConnected
        ? { label: "غير متصل", tone: "amber" }
        : requestStatus(false, false, whatsAppSettings.data?.settings.enabled === true);

  const toggleChannel = (channel: ReplyChannel) =>
    setOpenChannel((current) => (current === channel ? null : channel));

  return (
    <Page>
      <BrandHeader
        title="الرد الآلي"
        back={{ href: "/(tabs)/inbox", label: "العودة إلى المحادثات" }}
      />

      <View style={styles.channel}>
        <ChannelCard
          title={channelMeta.meta.title}
          platforms={channelMeta.meta.platforms}
          status={metaStatus}
          expanded={openChannel === "meta"}
          onToggle={() => toggleChannel("meta")}
          hint={
            metaSettings.isError
              ? "تعذر التحقق من حالة فيسبوك وإنستغرام."
              : metaSettings.data?.settings.enabled
                ? "الرد الآلي مفعّل على القنوات المختارة."
                : "الرد الآلي متوقف."
          }
          hintTone={metaSettings.isError ? colors.destructive : undefined}
        >
          <MetaAutoReplySettingsPanel userId={userId} />
        </ChannelCard>
      </View>

      <View style={styles.channel}>
        <ChannelCard
          title={channelMeta.whatsapp.title}
          platforms={channelMeta.whatsapp.platforms}
          status={whatsAppStatus}
          note={whatsAppSettings.data?.phoneNumber}
          expanded={openChannel === "whatsapp"}
          onToggle={() => toggleChannel("whatsapp")}
          hint={
            whatsAppSettings.isError
              ? "تعذر التحقق من حالة واتساب."
              : !whatsAppConnected
                ? "اربط حساب واتساب من شاشة القنوات قبل إعداد الردود."
                : whatsAppSettings.data?.settings.enabled
                  ? "الرد الآلي مفعّل على الرسائل الفردية."
                  : "الرد الآلي متوقف."
          }
          hintTone={whatsAppSettings.isError ? colors.destructive : undefined}
        >
          <WhatsAppReplyPanel returnTo={params.returnTo} />
        </ChannelCard>
      </View>
    </Page>
  );
}

function ChannelCard({
  title,
  platforms,
  status,
  note,
  expanded,
  onToggle,
  hint,
  hintTone,
  children,
}: {
  title: string;
  platforms: Array<"facebook" | "instagram" | "whatsapp">;
  status: ChannelStatus;
  note?: string | null;
  expanded: boolean;
  onToggle: () => void;
  hint: string;
  hintTone?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <>
      <Panel style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "طي" : "إظهار"} إعدادات ${title}`}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={styles.cardHeader}
        >
          <View style={styles.cardHeading}>
            <View style={styles.cardIcons}>
              {platforms.map((platform) => (
                <SocialPlatformIcon key={platform} platform={platform} size={22} />
              ))}
            </View>
            <View style={styles.cardCopy}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {title}
              </Text>
              {note ? (
                <Text
                  numberOfLines={1}
                  style={[styles.cardNote, { color: colors.mutedForeground }]}
                >
                  {note}
                </Text>
              ) : null}
            </View>
          </View>
          <StatusPill label={status.label} tone={status.tone} />
          <Icon
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
      </Panel>
      <Text
        style={[
          styles.statusLine,
          { color: hintTone ?? colors.mutedForeground },
        ]}
      >
        {hint}
      </Text>
      {/* Kept mounted so an unsaved channel keeps its draft while the other is open. */}
      <View style={expanded ? styles.cardBody : styles.cardBodyHidden}>
        {children}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  channel: { gap: 10 },
  card: { paddingVertical: 4 },
  cardHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  cardIcons: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardCopy: { flexShrink: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  cardNote: { fontSize: 12, textAlign: "right" },
  cardBody: { gap: 10 },
  cardBodyHidden: { display: "none" },
  statusLine: {
    paddingHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
  },
});
