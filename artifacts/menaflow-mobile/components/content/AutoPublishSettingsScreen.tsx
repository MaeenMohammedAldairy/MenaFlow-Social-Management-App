import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  Switch,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import {
  BrandHeader,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { useStudio, type Channel } from "@/context/StudioContext";
import { isLocalAuthDisabled } from "@/constants/auth";
import { platformLabel } from "@/lib/content-utils";
import { styles } from "@/components/content/content-styles";

export default function AutoPublishSettingsScreen() {
  if (isLocalAuthDisabled) {
    return <AutoPublishSettingsContent userId={null} />;
  }
  return <AuthenticatedAutoPublishSettings />;
}

function AuthenticatedAutoPublishSettings() {
  const { userId } = useAuth();
  return <AutoPublishSettingsContent userId={userId ?? null} />;
}

function AutoPublishSettingsContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { autoPublishSettings, updateAutoPublishSettings } = useStudio();
  const [autoPublish, setAutoPublish] = useState(autoPublishSettings.enabled);
  const [autoPublishChannels, setAutoPublishChannels] = useState<Channel[]>(
    autoPublishSettings.channels,
  );
  const [connectedChannels, setConnectedChannels] = useState<
    Array<Extract<Channel, "facebook" | "instagram">>
  >([]);
  const [connectionLoadError, setConnectionLoadError] = useState<string | null>(
    null,
  );
  const [autoPublishError, setAutoPublishError] = useState<string | null>(null);
  const [autoPublishNotice, setAutoPublishNotice] = useState<string | null>(
    null,
  );
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const connectionsQuery = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: 2,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const connectionsLoaded =
    connectionsQuery.isSuccess || connectionsQuery.isError;

  useEffect(() => {
    setAutoPublish(autoPublishSettings.enabled);
    setAutoPublishChannels(
      autoPublishSettings.channels.filter(
        (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
          channel === "facebook" || channel === "instagram",
      ),
    );
  }, [autoPublishSettings]);

  useEffect(() => {
    if (connectionsQuery.data) {
      const linked = [
        ...(connectionsQuery.data.facebook ? ["facebook" as const] : []),
        ...(connectionsQuery.data.instagram ? ["instagram" as const] : []),
      ];
      setConnectedChannels(linked);
      setAutoPublishChannels((current) =>
        current.filter(
          (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
            channel !== "whatsapp" && linked.includes(channel),
        ),
      );
      setConnectionLoadError(null);
    } else if (connectionsQuery.isError) {
      console.warn(
        "Unable to load connected social platforms:",
        connectionsQuery.error,
      );
      setConnectionLoadError(
        "تعذّر تحميل المنصات المرتبطة. أعد المحاولة أو تحقّق من اتصال الخادم.",
      );
    }
  }, [connectionsQuery.data, connectionsQuery.error, connectionsQuery.isError]);

  const saveSettings = async (enabled: boolean, channels: Channel[]) => {
    const linkedChannels = channels.filter(
      (channel): channel is Extract<Channel, "facebook" | "instagram"> =>
        channel !== "whatsapp" && connectedChannels.includes(channel),
    );
    if (enabled && linkedChannels.length === 0) {
      setAutoPublishError(
        "اربط فيسبوك أو إنستغرام أولاً ثم اختر منصة للنشر التلقائي.",
      );
      return null;
    }
    try {
      const saved = await updateAutoPublishSettings(enabled, linkedChannels);
      setAutoPublishError(null);
      return saved;
    } catch (error) {
      setAutoPublishError(
        error instanceof Error
          ? error.message
          : "تعذّر حفظ إعدادات النشر التلقائي على الخادم.",
      );
      return null;
    }
  };

  const persistAutoPublishChange = async (enabled: boolean) => {
    setSaving(true);
    setAutoPublishError(null);
    setAutoPublishNotice(null);
    try {
      const saved = await saveSettings(enabled, autoPublishChannels);
      if (saved) {
        setAutoPublish(enabled);
        const report = saved.initialPublish;
        if (enabled && report) {
          setAutoPublishNotice(
            report.processed > 0
              ? `تمت معالجة ${report.processed} منشورًا معتمدًا للنشر التلقائي. نُشر ${report.published} بنجاح، وفشل ${report.failed}.`
              : "لا توجد منشورات معتمدة للنشر التلقائي الآن.",
          );
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const onAutoPublishChange = (enabled: boolean) => {
    if (enabled && autoPublishChannels.length === 0) {
      setAutoPublishError(
        "اختر منصة مرتبطة واحدة على الأقل قبل تفعيل النشر التلقائي.",
      );
      return;
    }
    if (enabled) {
      setAutoPublishError(null);
      setAutoPublishNotice(null);
      setConfirmationVisible(true);
      return;
    }
    void persistAutoPublishChange(false);
  };

  const toggleAutoChannel = (channel: "facebook" | "instagram") => {
    if (!connectedChannels.includes(channel)) return;
    const channels = autoPublishChannels.includes(channel)
      ? autoPublishChannels.filter((item) => item !== channel)
      : [...autoPublishChannels, channel];
    if (autoPublish && channels.length === 0) {
      setAutoPublishError(
        "يجب اختيار فيسبوك أو إنستغرام عند تفعيل النشر التلقائي.",
      );
      return;
    }
    const previous = autoPublishChannels;
    setAutoPublishChannels(channels);
    void saveSettings(autoPublish, channels).then((saved) => {
      if (!saved) setAutoPublishChannels(previous);
    });
  };

  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="إعدادات النشر التلقائي"
        subtitle="حدد الحسابات التي تستقبل المنشورات المعتمدة تلقائيًا."
        back={{ href: "/(tabs)/content", label: "العودة إلى المنشورات" }}
      />
      <Panel style={styles.autoPublishPanel}>
        <View
          style={[
            styles.autoPublishHeader,
            { backgroundColor: colors.background },
          ]}
        >
          <View style={styles.autoPublishTitleGroup}>
            <View
              style={[
                styles.autoPublishIcon,
                { backgroundColor: colors.accent },
              ]}
            >
              <Icon name="zap" size={17} color={colors.primary} />
            </View>
            <View style={styles.autoPublishTitleCopy}>
              <Text style={[styles.autoLabel, { color: colors.foreground }]}>
                النشر التلقائي
              </Text>
              <Text
                style={[
                  styles.autoPublishDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                {autoPublish
                  ? `المنشورات المعتمدة تُنشر على ${
                      autoPublishChannels.map(platformLabel).join(" و") ||
                      "المنصات المختارة"
                    }`
                  : "يجب اعتماد المنشور قبل نشره تلقائيًا"}
              </Text>
            </View>
          </View>
          <Switch
            accessibilityLabel="تفعيل النشر التلقائي"
            value={autoPublish}
            disabled={
              !connectionsLoaded ||
              connectedChannels.length === 0 ||
              saving
            }
            onValueChange={onAutoPublishChange}
          />
        </View>

        <Text style={[styles.autoLabel, { color: colors.mutedForeground }]}>
          المنصات المستهدفة
        </Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          لا يتغير هذا الإعداد عن مراجعة المنشورات أو اعتمادها؛ فهو يحدد فقط
          أين تُنشر المنشورات المعتمدة تلقائيًا.
        </Text>
        <View style={styles.channelChips}>
          {connectedChannels.map((channel) => {
            const selected = autoPublishChannels.includes(channel);
            return (
              <Pressable
                key={channel}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => toggleAutoChannel(channel)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    backgroundColor: selected
                      ? colors.primary
                      : colors.secondary,
                    opacity: pressed ? 0.78 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    {
                      color: selected
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {platformLabel(channel)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {!connectionsLoaded ? (
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            جارٍ التحقق من المنصات المرتبطة…
          </Text>
        ) : connectionLoadError ? null : connectedChannels.length === 0 ? (
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            اربط صفحة فيسبوك أو إنستغرام من صفحة حسابات النشر لتفعيل النشر.
          </Text>
        ) : null}
        {connectionLoadError ? (
          <View
            style={[
              styles.connectionLoadError,
              { backgroundColor: colors.secondary },
            ]}
          >
            <Text
              accessibilityRole="alert"
              style={[styles.intro, { color: colors.destructive }]}
            >
              {connectionLoadError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: connectionsQuery.isFetching }}
              disabled={connectionsQuery.isFetching}
              onPress={() => void connectionsQuery.refetch()}
              style={({ pressed }) => [
                styles.historyButton,
                {
                  backgroundColor: colors.secondary,
                  opacity: connectionsQuery.isFetching
                    ? 0.6
                    : pressed
                      ? 0.76
                      : 1,
                },
              ]}
            >
              <Text style={[styles.filterLabel, { color: colors.foreground }]}>
                {connectionsQuery.isFetching
                  ? "جارٍ التحقق…"
                  : "إعادة المحاولة"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {autoPublishError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.intro, { color: colors.destructive }]}
          >
            {autoPublishError}
          </Text>
        ) : null}
        {saving ? (
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            جارٍ حفظ إعدادات النشر التلقائي…
          </Text>
        ) : null}
        {autoPublishNotice ? (
          <Text style={[styles.intro, { color: colors.primary }]}>
            {autoPublishNotice}
          </Text>
        ) : null}
      </Panel>
      <Modal
        visible={confirmationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmationVisible(false)}
      >
        <View style={styles.autoPublishModalOverlay}>
          <View
            accessibilityViewIsModal
            style={[
              styles.autoPublishModal,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.autoPublishModalTitle,
                { color: colors.foreground },
              ]}
            >
              تفعيل النشر التلقائي؟
            </Text>
            <Text
              style={[
                styles.intro,
                { color: colors.mutedForeground, textAlign: "left" },
              ]}
            >
              سيتم إرسال المنشورات المعتمدة إلى{" "}
              {autoPublishChannels.map(platformLabel).join(" و")} الآن.
            </Text>
            <View style={styles.autoPublishModalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmationVisible(false)}
                style={[
                  styles.autoPublishModalButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.filterLabel, { color: colors.foreground }]}
                >
                  إلغاء
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setConfirmationVisible(false);
                  void persistAutoPublishChange(true);
                }}
                style={[
                  styles.autoPublishModalButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  تفعيل والنشر
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}
