import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Platform,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import {
  LucideIcon as Icon,
  type LucideIconName,
} from "@/components/LucideIcon";
import {
  BrandHeader,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
} from "@/components/Ui";
import { useStudio } from "@/context/StudioContext";
import { useColors } from "@/hooks/useColors";
import { router } from "expo-router";
import { useClerk, useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { isLocalAuthDisabled } from "@/constants/auth";
import { signOutAndClearQueryCache } from "@/lib/sign-out";
import {
  getGetSubscriptionQueryKey,
  useGetSubscription,
} from "@workspace/api-client-react";
import {
  readAppearanceMode,
  saveAppearanceMode,
  type AppearanceMode,
} from "@/lib/appearance";

function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  danger = false,
  busy = false,
}: {
  icon: LucideIconName;
  title: string;
  subtitle?: string;
  value?: boolean;
  onValueChange?: (next: boolean) => void;
  danger?: boolean;
  busy?: boolean;
}) {
  const colors = useColors();
  const settingIcon = (
    <View
      style={[
        styles.settingIcon,
        { backgroundColor: danger ? colors.secondary : colors.accent },
      ]}
    >
      <Icon
        name={icon}
        size={16}
        color={danger ? colors.destructive : colors.primary}
      />
    </View>
  );
  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      {settingIcon}
      <View style={styles.settingCopy}>
        <Text
          style={[
            styles.settingTitle,
            { color: danger ? colors.destructive : colors.foreground },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.settingSubtitle, { color: colors.mutedForeground }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onValueChange ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
        />
      ) : busy ? (
        <ActivityIndicator size="small" color={colors.destructive} />
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  if (isLocalAuthDisabled) {
    return (
      <SettingsContent
        userName="وضع التطوير المحلي"
        userEmail="المصادقة معطّلة على هذا الجهاز"
      />
    );
  }

  return <AuthenticatedSettingsScreen />;
}

function AuthenticatedSettingsScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const profileDisplayName =
    typeof user?.unsafeMetadata.displayName === "string"
      ? user.unsafeMetadata.displayName
      : "";
  return (
    <SettingsContent
      userId={user?.id}
      userName={user?.fullName || profileDisplayName || "الملف الشخصي"}
      userEmail={user?.primaryEmailAddress?.emailAddress || "حساب مالك النشاط"}
      onSignOut={async () => {
        await signOutAndClearQueryCache(queryClient, signOut);
        router.replace("/(auth)/sign-in");
      }}
    />
  );
}

function SettingsContent({
  userId,
  userName,
  userEmail,
  onSignOut,
}: {
  userId?: string | null;
  userName: string;
  userEmail: string;
  onSignOut?: () => Promise<void>;
}) {
  const colors = useColors();
  const { preferences, updatePreference } = useStudio();
  const [signingOut, setSigningOut] = useState(false);
  const [appearanceMode, setAppearanceMode] =
    useState<AppearanceMode>("system");
  const [appearancePickerVisible, setAppearancePickerVisible] = useState(false);
  const subscriptionQuery = useGetSubscription({
    query: {
      queryKey: [...getGetSubscriptionQueryKey(), userId ?? "local"],
      enabled: Boolean(onSignOut),
      retry: false,
    },
  });
  const subscription = subscriptionQuery.data;
  const currentPlan = subscription?.plans.find(
    (plan) => plan.id === subscription.planId,
  );
  const trialDaysLeft = subscription?.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(subscription.trialEndsAt).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : 0;
  const signOutInFlightRef = useRef(false);
  useEffect(() => {
    let active = true;
    readAppearanceMode()
      .then((mode) => {
        if (active) setAppearanceMode(mode);
      })
      .catch((error) => {
        console.error("Unable to load appearance preference:", error);
      });
    return () => {
      active = false;
    };
  }, []);
  const selectAppearanceMode = async (mode: AppearanceMode) => {
    try {
      await saveAppearanceMode(mode);
      setAppearanceMode(mode);
      setAppearancePickerVisible(false);
    } catch (error) {
      console.error("Unable to save appearance preference:", error);
      Alert.alert(
        "تعذر تغيير المظهر",
        "لم نتمكن من حفظ إعداد المظهر. تحقق من مساحة التخزين وحاول مرة أخرى.",
      );
    }
  };
  const confirmSignOut = () => {
    if (!onSignOut || signOutInFlightRef.current || signingOut) return;
    const performSignOut = async () => {
      if (signOutInFlightRef.current || signingOut) return;
      signOutInFlightRef.current = true;
      setSigningOut(true);
      try {
        await onSignOut();
      } catch {
        const message = "لم يكتمل إنهاء الجلسة. تحقق من الاتصال وحاول مرة أخرى.";
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert(`تعذر تسجيل الخروج\n\n${message}`);
        } else {
          Alert.alert("تعذر تسجيل الخروج", message);
        }
      } finally {
        signOutInFlightRef.current = false;
        setSigningOut(false);
      }
    };

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm("هل تريد إنهاء جلستك على هذا الجهاز؟")) {
        void performSignOut();
      }
      return;
    }
    Alert.alert("تسجيل الخروج", "هل تريد إنهاء جلستك على هذا الجهاز؟", [
      { text: "البقاء في الحساب", style: "cancel" },
      { text: "تسجيل الخروج", style: "destructive", onPress: () => void performSignOut() },
    ]);
  };
  return (
    <Page>
      <BrandHeader />
      <PageTitle title="الإعدادات" subtitle="تحكم في تفضيلات مساحة عملك." />
      <Panel>
        <SectionTitle title="الحساب" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تعديل الملف الشخصي وإكمال الإعداد"
          onPress={() => router.push("/account/profile")}
        >
          <SettingRow
            icon="user"
            title={userName}
            subtitle={`${userEmail} · تعديل الملف الشخصي`}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/more/sources",
              params: { view: "publishing" },
            })
          }
        >
          <SettingRow
            icon="link-2"
            title="حسابات النشر"
            subtitle="إدارة حسابات فيسبوك وإنستغرام"
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/product-catalog")}
        >
          <SettingRow
            icon="file-text"
            title="كتالوج المنتجات"
            subtitle="إدارة المنتجات ومعلوماتها المعتمدة للرد الآلي"
          />
        </Pressable>
      </Panel>
      {onSignOut ? (
        <Panel>
          <SectionTitle title="الخطة والاشتراك" />
          {subscriptionQuery.isLoading ? (
            <ActivityIndicator
              accessibilityLabel="جارٍ تحميل الخطة والاستخدام"
              color={colors.primary}
              style={styles.subscriptionLoading}
            />
          ) : subscriptionQuery.isError ? (
            <View style={styles.subscriptionMessage}>
              <Text
                accessibilityRole="alert"
                style={[styles.settingSubtitle, { color: colors.destructive }]}
              >
                تعذر تحميل بيانات الاشتراك. تحقق من اتصالك ثم أعد المحاولة.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void subscriptionQuery.refetch()}
              >
                <Text style={[styles.subscriptionLink, { color: colors.primary }]}>
                  إعادة المحاولة
                </Text>
              </Pressable>
            </View>
          ) : subscription ? (
            <>
              <View style={[styles.subscriptionSummary, { borderColor: colors.border }]}>
                <View style={styles.subscriptionCopy}>
                  <Text style={[styles.subscriptionPlan, { color: colors.foreground }]}>
                    {subscription.planName}
                  </Text>
                  <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                    {subscription.status === "trialing"
                      ? `فترة تجريبية · ${trialDaysLeft} يوم متبقٍ`
                      : subscription.planId === "free"
                        ? "الخطة المجانية"
                      : subscription.status === "active"
                        ? "الخطة نشطة"
                        : "الخطة المجانية"}
                  </Text>
                </View>
                {currentPlan ? (
                  <Text style={[styles.subscriptionPrice, { color: colors.primary }]}>
                    {currentPlan.monthlyPriceUsd === 0
                      ? "مجانًا"
                      : `$${currentPlan.monthlyPriceUsd} / شهر`}
                  </Text>
                ) : null}
              </View>
              {currentPlan ? (
                <View style={styles.subscriptionUsage}>
                  {[
                    {
                      label: "المنشورات هذا الشهر",
                      used: subscription.usage.postsCreated,
                      limit: currentPlan.limits.postsCreated,
                    },
                    {
                      label: "توليدات الذكاء الاصطناعي",
                      used: subscription.usage.aiGenerations,
                      limit: currentPlan.limits.aiGenerations,
                    },
                    {
                      label: "القنوات المرتبطة",
                      used: subscription.usage.channels,
                      limit: currentPlan.limits.channels,
                    },
                  ].map((item) => (
                    <View key={item.label} style={styles.subscriptionUsageRow}>
                      <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                        {item.label}
                      </Text>
                      <Text style={[styles.settingSubtitle, { color: colors.foreground }]}>
                        {item.used} / {item.limit}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                الخطط المتاحة
              </Text>
              {subscription.plans.map((plan) => (
                <View
                  key={plan.id}
                  style={[styles.planOption, { borderColor: colors.border }]}
                >
                  <Text style={[styles.settingTitle, { color: colors.foreground }]}>
                    {plan.name}
                  </Text>
                  <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                    {plan.monthlyPriceUsd === 0 ? "مجانًا" : `$${plan.monthlyPriceUsd} شهريًا`}
                    {" · "}
                    {plan.limits.postsCreated} منشور
                    {" · "}
                    {plan.limits.aiGenerations} توليد AI
                  </Text>
                </View>
              ))}
              <Text style={[styles.subscriptionNotice, { color: colors.mutedForeground }]}>
                الترقية والتحصيل غير متاحين حاليًا؛ سيتم تفعيلهما بعد ربط بوابة الدفع.
              </Text>
            </>
          ) : null}
        </Panel>
      ) : null}
      <Panel>
        <SectionTitle title="التنبيهات وسير العمل" />
        <SettingRow
          icon="bell"
          title="تنبيهات داخل التطبيق"
          subtitle="تفضيل محلي على هذا الجهاز"
          value={preferences.inAppAlerts}
          onValueChange={(value) => updatePreference("inAppAlerts", value)}
        />
        <SettingRow
          icon="check-circle"
          title="مراجعة قبل النشر"
          subtitle="احتفظ بالمحتوى للموافقة قبل النشر"
          value={preferences.reviewBeforePublishing}
          onValueChange={(value) =>
            updatePreference("reviewBeforePublishing", value)
          }
        />
      </Panel>
      <Panel>
        <SectionTitle title="المظهر واللغة" />
        <SettingRow icon="globe" title="لغة التطبيق" subtitle="العربية" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تغيير مظهر التطبيق"
          accessibilityState={{ expanded: appearancePickerVisible }}
          onPress={() => setAppearancePickerVisible((visible) => !visible)}
        >
          <SettingRow
            icon={appearanceMode === "dark" ? "moon" : "sun"}
            title="المظهر"
            subtitle={
              appearanceMode === "system"
                ? "يتبع إعداد الجهاز"
                : appearanceMode === "dark"
                  ? "داكن"
                  : "فاتح"
            }
          />
        </Pressable>
        {appearancePickerVisible ? (
          <View style={[styles.appearanceOptions, { borderColor: colors.border }]}>
            {(
              [
                ["system", "يتبع إعداد الجهاز"],
                ["light", "فاتح"],
                ["dark", "داكن"],
              ] as const
            ).map(([mode, label]) => (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: appearanceMode === mode }}
                onPress={() => void selectAppearanceMode(mode)}
                style={[
                  styles.appearanceOption,
                  { borderColor: colors.border },
                ]}
              >
                <Text style={{ color: colors.foreground }}>{label}</Text>
                {appearanceMode === mode ? (
                  <Icon name="check" size={18} color={colors.primary} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </Panel>
      <Panel>
        <SectionTitle title="الدعم والأمان" />
        <Pressable
          onPress={() =>
            Alert.alert(
              "مركز المساعدة",
              "تواصل مع فريق MenaFlow عبر البريد المخصص للدعم في إعدادات حسابك.",
            )
          }
        >
          <SettingRow icon="help-circle" title="مركز المساعدة" />
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert(
              "الخصوصية",
              "تُخزّن المسودات الحالية على هذا الجهاز. لا يتم إرسالها إلى منصات التواصل من دون ربط الحساب والموافقة.",
            )
          }
        >
          <SettingRow icon="shield" title="الخصوصية والأمان" />
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert(
              "حول التطبيق",
              "MenaFlow — مساحة عربية لإدارة المحتوى والحسابات الاجتماعية.",
            )
          }
        >
          <SettingRow icon="info" title="حول MenaFlow" />
        </Pressable>
      </Panel>
      {onSignOut ? (
        <Panel>
          <SectionTitle title="الجلسة" />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: signingOut, busy: signingOut }}
            disabled={signingOut}
            onPress={confirmSignOut}
            style={{ opacity: signingOut ? 0.6 : 1 }}
          >
            <SettingRow
              icon="log-out"
              title={signingOut ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
              subtitle="إنهاء الجلسة على هذا الجهاز"
              danger
              busy={signingOut}
            />
          </Pressable>
        </Panel>
      ) : null}
      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        MenaFlow · الإصدار 1.0
      </Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  settingRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  settingCopy: { flex: 1, alignItems: "flex-start", gap: 3 },
  settingTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  settingSubtitle: { fontSize: 10, textAlign: "left" },
  settingIcon: {
    width: 33,
    height: 33,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  version: { textAlign: "center", fontSize: 11 },
  appearanceOptions: {
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 4,
  },
  appearanceOption: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
  },
  subscriptionLoading: { paddingVertical: 18 },
  subscriptionMessage: { gap: 10, paddingVertical: 8 },
  subscriptionSummary: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  subscriptionCopy: { flex: 1, gap: 4 },
  subscriptionPlan: { fontSize: 15, fontWeight: "700" },
  subscriptionPrice: { fontSize: 12, fontWeight: "700" },
  subscriptionUsage: { gap: 8, paddingVertical: 12 },
  subscriptionUsageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  planOption: {
    gap: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  subscriptionNotice: { fontSize: 10, lineHeight: 16, paddingTop: 8 },
  subscriptionLink: { fontSize: 12, fontWeight: "700" },
});
