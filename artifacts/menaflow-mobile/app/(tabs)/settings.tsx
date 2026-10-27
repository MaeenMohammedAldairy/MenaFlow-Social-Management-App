import React, { useRef, useState } from "react";
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
  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      {onValueChange ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
        />
      ) : busy ? (
        <ActivityIndicator size="small" color={colors.destructive} />
      ) : (
        <Icon name="chevron-left" size={17} color={colors.mutedForeground} />
      )}
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
      userName={user?.fullName || profileDisplayName || "الملف الشخصي"}
      userEmail={user?.primaryEmailAddress?.emailAddress || "حساب مالك النشاط"}
      onSignOut={async () => {
        await signOut();
        queryClient.clear();
        router.replace("/(auth)/sign-in");
      }}
    />
  );
}

function SettingsContent({
  userName,
  userEmail,
  onSignOut,
}: {
  userName: string;
  userEmail: string;
  onSignOut?: () => Promise<void>;
}) {
  const colors = useColors();
  const { preferences, updatePreference } = useStudio();
  const [signingOut, setSigningOut] = useState(false);
  const signOutInFlightRef = useRef(false);
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
        <Pressable onPress={() => router.push("/(tabs)/sources")}>
          <SettingRow
            icon="link-2"
            title="الحسابات المرتبطة"
            subtitle="إدارة منصات التواصل"
          />
        </Pressable>
      </Panel>
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
        <SettingRow icon="sun" title="المظهر" subtitle="يتبع إعداد الجهاز" />
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
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  settingCopy: { flex: 1, alignItems: "flex-end", gap: 3 },
  settingTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  settingSubtitle: { fontSize: 10, textAlign: "right" },
  settingIcon: {
    width: 33,
    height: 33,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  version: { textAlign: "center", fontSize: 11 },
});
