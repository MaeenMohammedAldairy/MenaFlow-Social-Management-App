import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getWhatsAppAutoReplySettings,
  saveWhatsAppAutoReplySettings,
} from "@workspace/api-client-react";
import { BrandHeader, Page, Panel, StatusPill } from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";
import {
  getMetaAutoReplySettings,
  saveMetaAutoReplySettings,
  type MetaAutoReplySettings,
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
  const queryClient = useQueryClient();
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

  const metaQueryKey = ["meta-auto-reply-settings", userId ?? "local"] as const;
  const whatsAppQueryKey = [
    "whatsappAutoReplySettings",
    userId ?? "local",
  ] as const;
  const metaSettings = useQuery({
    queryKey: metaQueryKey,
    queryFn: getMetaAutoReplySettings,
    retry: false,
  });
  const whatsAppSettings = useQuery({
    queryKey: whatsAppQueryKey,
    queryFn: getWhatsAppAutoReplySettings,
    retry: false,
  });

  const [savingChannel, setSavingChannel] = useState<ReplyChannel | null>(null);
  const [channelError, setChannelError] = useState<{
    channel: ReplyChannel;
    message: string;
  } | null>(null);
  const [dirtyChannel, setDirtyChannel] = useState<ReplyChannel | null>(null);
  const [pendingOff, setPendingOff] = useState<ReplyChannel | null>(null);
  const [whatsAppNotice, setWhatsAppNotice] = useState("");

  const metaEnabled = (platform: MetaInboxPlatform) => {
    const data = metaSettings.data?.settings;
    return platform === "facebook"
      ? Boolean(
          data?.facebookMessagesEnabled || data?.facebookCommentsEnabled,
        )
      : Boolean(
          data?.instagramMessagesEnabled || data?.instagramCommentsEnabled,
        );
  };
  const channelEnabled = (channel: ReplyChannel) =>
    channel === "whatsapp"
      ? whatsAppSettings.data?.settings.enabled === true
      : metaEnabled(channel);

  const metaCardState = (platform: MetaInboxPlatform): ChannelCardState => {
    const data = metaSettings.data;
    const label = platformLabel(platform);
    const connected = data?.readiness[platform].connected === true;
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
    return metaEnabled(platform)
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
        : channelEnabled("whatsapp")
          ? {
              status: { label: "مفعّل", tone: "green" },
              hint: "الرد الآلي مفعّل على الرسائل الفردية.",
            }
          : {
              status: { label: "متوقف", tone: "muted" },
              hint: "الرد الآلي متوقف — اختبر الرد واحفظه للتفعيل.",
            };

  /** The switch can only move when the channel is usable right now. */
  const channelReady = (channel: ReplyChannel) => {
    if (channel === "whatsapp") {
      return (
        whatsAppConnected &&
        !whatsAppSettings.isPending &&
        !whatsAppSettings.isError
      );
    }
    return (
      metaSettings.data?.readiness[channel].connected === true &&
      !metaSettings.isPending &&
      !metaSettings.isError
    );
  };

  const toggleExpanded = (channel: ReplyChannel) => {
    setOpenChannel((current) => (current === channel ? null : channel));
    setDirtyChannel((current) => (current === channel ? null : current));
  };

  /** Persists the platform switch. Turning off closes the card's editor. */
  const setChannelEnabled = async (
    channel: ReplyChannel,
    enabled: boolean,
  ) => {
    setChannelError(null);
    setPendingOff(null);
    setSavingChannel(channel);
    try {
      if (channel === "whatsapp") {
        const current = whatsAppSettings.data?.settings;
        if (!current) throw new Error("تعذّر تحميل إعدادات واتساب.");
        await saveWhatsAppAutoReplySettings({ ...current, enabled });
        await queryClient.invalidateQueries({ queryKey: whatsAppQueryKey });
      } else {
        const current = metaSettings.data?.settings;
        if (!current) throw new Error("تعذّر تحميل إعدادات الرد الآلي.");
        const next: MetaAutoReplySettings = {
          ...current,
          ...(channel === "facebook"
            ? {
                facebookMessagesEnabled: enabled,
                facebookCommentsEnabled: enabled,
              }
            : {
                instagramMessagesEnabled: enabled,
                instagramCommentsEnabled: enabled,
              }),
        };
        next.enabled =
          next.facebookMessagesEnabled ||
          next.facebookCommentsEnabled ||
          next.instagramMessagesEnabled ||
          next.instagramCommentsEnabled;
        await saveMetaAutoReplySettings(next);
        await queryClient.invalidateQueries({ queryKey: metaQueryKey });
      }
      setOpenChannel((current) => {
        if (enabled) return channel;
        return current === channel ? null : current;
      });
      setDirtyChannel((current) => (current === channel ? null : current));
    } catch (error) {
      setChannelError({
        channel,
        message:
          error instanceof Error
            ? error.message
            : "تعذّر تحديث حالة الرد الآلي. تحقق من الاتصال وأعد المحاولة.",
      });
    } finally {
      setSavingChannel(null);
    }
  };

  const handleSwitch = (channel: ReplyChannel, enabled: boolean) => {
    setChannelError(null);
    setWhatsAppNotice("");
    if (!enabled) {
      // An open editor may hold edits that only live in the form.
      if (openChannel === channel && dirtyChannel === channel) {
        setPendingOff(channel);
        return;
      }
      void setChannelEnabled(channel, false);
      return;
    }
    if (channel === "whatsapp") {
      // WhatsApp refuses to enable an untested reply, so the switch opens the
      // form instead of writing a state the screen cannot honour.
      setOpenChannel("whatsapp");
      setWhatsAppNotice(
        "اختبر الرد ثم احفظ الإعدادات لتفعيل الرد التلقائي على واتساب.",
      );
      return;
    }
    void setChannelEnabled(channel, true);
  };

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
        const enabled = channelEnabled(channel);
        const busy = savingChannel === channel;
        return (
          <View key={channel} style={styles.channel}>
            <ChannelCard
              title={card.title}
              platforms={[...card.platforms]}
              status={card.state.status}
              note={card.note}
              expanded={openChannel === channel}
              onToggle={() => toggleExpanded(channel)}
              hint={card.state.hint}
              enabled={enabled}
              switchDisabled={!channelReady(channel) || busy}
              switchBusy={busy}
              onSwitchChange={(next) => handleSwitch(channel, next)}
              error={channelError?.channel === channel ? channelError.message : null}
              notice={
                channel === "whatsapp" && !enabled ? whatsAppNotice : null
              }
              confirmingOff={pendingOff === channel}
              onConfirmOff={() => void setChannelEnabled(channel, false)}
              onCancelOff={() => setPendingOff(null)}
            >
              {channel === "whatsapp" ? (
                <WhatsAppReplyPanel
                  returnTo={params.returnTo}
                  onDirtyChange={(dirty) =>
                    setDirtyChannel((current) =>
                      dirty ? channel : current === channel ? null : current,
                    )
                  }
                />
              ) : (
                <MetaAutoReplySettingsPanel
                  userId={userId}
                  platform={channel}
                  onDirtyChange={(dirty) =>
                    setDirtyChannel((current) =>
                      dirty ? channel : current === channel ? null : current,
                    )
                  }
                />
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
  enabled,
  switchDisabled,
  switchBusy,
  onSwitchChange,
  error,
  notice,
  confirmingOff,
  onConfirmOff,
  onCancelOff,
  children,
}: {
  title: string;
  platforms: Array<"facebook" | "instagram" | "whatsapp">;
  status: ChannelStatus;
  note?: string | null;
  expanded: boolean;
  onToggle: () => void;
  hint: string;
  enabled: boolean;
  switchDisabled: boolean;
  switchBusy: boolean;
  onSwitchChange: (next: boolean) => void;
  error: string | null;
  notice: string | null;
  confirmingOff: boolean;
  onConfirmOff: () => void;
  onCancelOff: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  // The switch is the state; the pill only carries a reason it cannot move.
  const showPill = status.label !== "مفعّل" && status.label !== "متوقف";
  return (
    <>
      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? "طي" : "إظهار"} إعدادات ${title}`}
            accessibilityState={{ expanded }}
            onPress={onToggle}
            style={styles.cardHeading}
          >
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
          </Pressable>
          {showPill ? <StatusPill label={status.label} tone={status.tone} /> : null}
          <Switch
            accessibilityLabel={`تفعيل الرد الآلي على ${title}`}
            accessibilityRole="switch"
            accessibilityState={{
              checked: enabled,
              disabled: switchDisabled,
              busy: switchBusy,
            }}
            value={enabled}
            onValueChange={onSwitchChange}
            disabled={switchDisabled}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.card}
          />
        </View>

        {confirmingOff ? (
          <View style={[styles.confirmRow, { borderColor: colors.border }]}>
            <Text style={[styles.confirmText, { color: colors.foreground }]}>
              سيُغلق النموذج وتُفقد التغييرات غير المحفوظة.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`إيقاف الرد الآلي على ${title}`}
                onPress={onConfirmOff}
                style={[styles.confirmPrimary, { backgroundColor: colors.destructive }]}
              >
                <Text
                  style={[
                    styles.confirmPrimaryText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  إيقاف
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="تراجع عن الإيقاف"
                onPress={onCancelOff}
                style={[styles.confirmSecondary, { borderColor: colors.border }]}
              >
                <Text style={[styles.confirmSecondaryText, { color: colors.foreground }]}>
                  تراجع
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Panel>
      <Text style={[styles.statusLine, { color: colors.mutedForeground }]}>
        {hint}
      </Text>
      {notice ? (
        <Text style={[styles.statusLine, { color: colors.primary }]}>
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.statusLine, { color: colors.destructive }]}
        >
          {error}
        </Text>
      ) : null}
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
  cardHeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardIcons: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardCopy: { flexShrink: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  cardNote: { fontSize: 12, textAlign: "right" },
  cardBody: { gap: 10 },
  statusLine: {
    paddingHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
  },
  confirmRow: { gap: 8, borderTopWidth: 1, paddingTop: 10, paddingBottom: 6 },
  confirmText: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  confirmPrimary: {
    minHeight: 34,
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  confirmPrimaryText: { fontSize: 12, fontWeight: "800" },
  confirmSecondary: {
    minHeight: 34,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  confirmSecondaryText: { fontSize: 12, fontWeight: "700" },
});
