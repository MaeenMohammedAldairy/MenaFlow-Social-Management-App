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
import {
  getMetaAutoReplySettings,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";
import { MetaAutoReplySettingsPanel } from "@/components/inbox/MetaAutoReplySettingsPanel";
import { WhatsAppReplyPanel } from "../whatsapp-setup";

type ReplyChannel = MetaInboxPlatform | "whatsapp";
type ChannelStatus = { label: string; tone: "green" | "amber" | "muted" };
type ChannelCardState = { status: ChannelStatus; hint: string };

function platformLabel(platform: MetaInboxPlatform): string {
  return platform === "facebook" ? "فيسبوك" : "إنستغرام";
}

const channelOrder: ReplyChannel[] = ["facebook", "instagram", "whatsapp"];

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

function ReplySettingsContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const params = useLocalSearchParams<{
    channel?: string;
    tab?: string;
    returnTo?: string;
  }>();
  // Older links use ?tab=whatsapp | ?tab=meta; both open a channel card.
  const requested = params.channel ?? params.tab;
  const [openChannel, setOpenChannel] = useState<ReplyChannel | null>(
    requested === "whatsapp"
      ? "whatsapp"
      : requested === "facebook" || requested === "instagram"
        ? requested
        : requested === "meta"
          ? "facebook"
          : null,
  );

  useEffect(() => {
    if (requested === "whatsapp" || requested === "facebook" || requested === "instagram") {
      setOpenChannel(requested);
    } else if (requested === "meta") {
      setOpenChannel("facebook");
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

  const metaCardState = (platform: MetaInboxPlatform): ChannelCardState => {
    const data = metaSettings.data;
    const enabled =
      platform === "facebook"
        ? Boolean(
            data?.settings.facebookMessagesEnabled ||
              data?.settings.facebookCommentsEnabled,
          )
        : Boolean(
            data?.settings.instagramMessagesEnabled ||
              data?.settings.instagramCommentsEnabled,
          );
    const connected = data?.readiness[platform].connected === true;
    const label = platformLabel(platform);
    if (metaSettings.isPending) {
      return { status: { label: "جارٍ التحقق", tone: "muted" }, hint: `جارٍ التحقق من حالة ${label}.` };
    }
    if (metaSettings.isError) {
      return {
        status: { label: "تعذر التحقق", tone: "amber" },
        hint: `تعذر التحقق من حالة ${label}.`,
      };
    }
    if (!connected) {
      return {
        status: { label: "غير متصل", tone: "amber" },
        hint: `اربط حساب ${label} من شاشة القنوات قبل إعداد الردود.`,
      };
    }
    return enabled
      ? {
          status: { label: "مفعّل", tone: "green" },
          hint: `الرد على رسائل وتعليقات ${label} مفعّل.`,
        }
      : { status: { label: "متوقف", tone: "muted" }, hint: "الرد الآلي متوقف." };
  };

  const whatsAppConnected = whatsAppSettings.data?.connected === true;
  const whatsAppCardState: ChannelCardState = whatsAppSettings.isPending
    ? {
        status: { label: "جارٍ التحقق", tone: "muted" },
        hint: "جارٍ التحقق من حالة واتساب.",
      }
    : whatsAppSettings.isError
      ? {
          status: { label: "تعذر التحقق", tone: "amber" },
          hint: "تعذر التحقق من حالة واتساب.",
        }
      : !whatsAppConnected
        ? {
            status: { label: "غير متصل", tone: "amber" },
            hint: "اربط حساب واتساب من شاشة القنوات قبل إعداد الردود.",
          }
        : whatsAppSettings.data?.settings.enabled
          ? {
              status: { label: "مفعّل", tone: "green" },
              hint: "الرد الآلي مفعّل على الرسائل الفردية.",
            }
          : {
              status: { label: "متوقف", tone: "muted" },
              hint: "الرد الآلي متوقف.",
            };

  const toggleChannel = (channel: ReplyChannel) =>
    setOpenChannel((current) => (current === channel ? null : channel));

  return (
    <Page>
      <BrandHeader
        title="الرد الآلي"
        back={
          // Arriving from the connect-accounts flow must not drop the user in the inbox.
          params.returnTo === "connect-accounts"
            ? { href: "/connect-accounts", label: "العودة إلى الإعداد الأولي" }
            : { href: "/(tabs)/inbox", label: "العودة إلى المحادثات" }
        }
      />

      {channelOrder.map((channel) => {
        const card =
          channel === "whatsapp"
            ? {
                title: "واتساب",
                platforms: ["whatsapp"] as const,
                state: whatsAppCardState,
                note: whatsAppSettings.data?.phoneNumber ?? null,
              }
            : {
                title: platformLabel(channel),
                platforms: [channel] as const,
                state: metaCardState(channel),
                note: null,
              };
        return (
          <View key={channel} style={styles.channel}>
            <ChannelCard
              title={card.title}
              platforms={[...card.platforms]}
              status={card.state.status}
              note={card.note}
              expanded={openChannel === channel}
              onToggle={() => toggleChannel(channel)}
              hint={card.state.hint}
            >
              {channel === "whatsapp" ? (
                <WhatsAppReplyPanel returnTo={params.returnTo} />
              ) : (
                <MetaAutoReplySettingsPanel userId={userId} platform={channel} />
              )}
            </ChannelCard>
          </View>
        );
      })}
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
  children,
}: {
  title: string;
  platforms: Array<"facebook" | "instagram" | "whatsapp">;
  status: ChannelStatus;
  note?: string | null;
  expanded: boolean;
  onToggle: () => void;
  hint: string;
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
          {/* StatusPill aligns itself to the start of its parent; inside this
              centred header row that pins it to the top of the card. */}
          <StatusPill
            label={status.label}
            tone={status.tone}
            style={styles.cardStatus}
          />
          <Icon
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
      </Panel>
      <Text
        style={[styles.statusLine, { color: colors.mutedForeground }]}
      >
        {hint}
      </Text>
      {/* One editor at a time: each Meta editor drafts the whole shared object. */}
      {expanded ? <View style={styles.cardBody}>{children}</View> : null}
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
  cardStatus: { alignSelf: "center" },
  cardIcons: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardCopy: { flexShrink: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  cardNote: { fontSize: 13.5, textAlign: "right" },
  cardBody: { gap: 10 },
  statusLine: {
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
  },
});
