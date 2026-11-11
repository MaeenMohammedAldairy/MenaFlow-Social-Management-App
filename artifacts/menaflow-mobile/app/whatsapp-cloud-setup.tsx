import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { fetchApiResponse } from "@workspace/api-client-react";
import { CairoText as Text, CairoTextInput as TextInput } from "@/components/CairoTypography";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";

type CloudPhoneNumber = {
  id: string;
  metaPhoneNumberId: string;
  phoneNumber: string;
  verifiedName: string | null;
  codeVerificationStatus: string | null;
  qualityRating: string | null;
  platformType: string | null;
};

type CloudMessagingAccount = {
  id: string;
  metaMessagingAccountId: string;
  displayName: string | null;
  phoneNumbers: CloudPhoneNumber[];
};

type CloudConnection = {
  id: string;
  environment: "test" | "production";
  onboardingMethod: "developer_test" | "embedded_signup_v4";
  status: "connected" | "reauthorization_required" | "disconnected" | "failed";
  lastCheckedAt: string | null;
  lastCheckStatus: "passed" | "failed" | null;
  lastErrorCode: string | null;
  createdAt: string;
  messagingAccounts: CloudMessagingAccount[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhoneNumber(value: unknown): value is CloudPhoneNumber {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.metaPhoneNumberId === "string" &&
    typeof value.phoneNumber === "string" &&
    (typeof value.verifiedName === "string" || value.verifiedName === null) &&
    (typeof value.codeVerificationStatus === "string" ||
      value.codeVerificationStatus === null) &&
    (typeof value.qualityRating === "string" ||
      value.qualityRating === null) &&
    (typeof value.platformType === "string" || value.platformType === null)
  );
}

function isConnection(value: unknown): value is CloudConnection {
  if (!isRecord(value) || !Array.isArray(value.messagingAccounts)) return false;
  return (
    typeof value.id === "string" &&
    (value.environment === "test" || value.environment === "production") &&
    (value.onboardingMethod === "developer_test" ||
      value.onboardingMethod === "embedded_signup_v4") &&
    (value.status === "connected" ||
      value.status === "reauthorization_required" ||
      value.status === "disconnected" ||
      value.status === "failed") &&
    (typeof value.lastCheckedAt === "string" || value.lastCheckedAt === null) &&
    (value.lastCheckStatus === "passed" ||
      value.lastCheckStatus === "failed" ||
      value.lastCheckStatus === null) &&
    (typeof value.lastErrorCode === "string" || value.lastErrorCode === null) &&
    typeof value.createdAt === "string" &&
    value.messagingAccounts.every(
      (account) =>
        isRecord(account) &&
        typeof account.id === "string" &&
        typeof account.metaMessagingAccountId === "string" &&
        (typeof account.displayName === "string" ||
          account.displayName === null) &&
        Array.isArray(account.phoneNumbers) &&
        account.phoneNumbers.every(isPhoneNumber),
    )
  );
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    return "تعذر قراءة استجابة الخادم.";
  }
  return "تعذر إكمال الطلب. حاول مرة أخرى.";
}

function connectionStatus(connection: CloudConnection): {
  label: string;
  tone: "green" | "amber" | "muted";
} {
  if (connection.status === "connected") return { label: "متصل", tone: "green" };
  if (connection.status === "reauthorization_required") {
    return { label: "يحتاج إلى تفويض", tone: "amber" };
  }
  if (connection.status === "failed") return { label: "تعذر التحقق", tone: "amber" };
  return { label: "مفصول", tone: "muted" };
}

export default function WhatsAppCloudSetupScreen() {
  const colors = useColors();
  const [connections, setConnections] = useState<CloudConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [messagingAccountId, setMessagingAccountId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await fetchApiResponse(
        "/api/social/whatsapp-cloud/connections",
      );
      if (!response.ok) {
        setLoadError(await responseError(response));
        return;
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.connections) ||
        !payload.connections.every(isConnection)
      ) {
        setLoadError("استجابة اتصالات WhatsApp Cloud غير صالحة.");
        return;
      }
      setConnections(payload.connections);
    } catch {
      setLoadError("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const createTestConnection = async () => {
    if (
      isSubmitting ||
      !accessToken.trim() ||
      !messagingAccountId.trim() ||
      !phoneNumberId.trim()
    ) {
      return;
    }
    setIsSubmitting(true);
    setNotice("");
    try {
      const response = await fetchApiResponse(
        "/api/social/whatsapp-cloud/test-connections",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accessToken: accessToken.trim(),
            messagingAccountId: messagingAccountId.trim(),
            phoneNumberId: phoneNumberId.trim(),
          }),
        },
      );
      if (!response.ok) {
        setNotice(await responseError(response));
        return;
      }
      setAccessToken("");
      setNotice("تم التحقق من حساب الاختبار وحفظ رمزه مشفراً على الخادم.");
      await loadConnections();
    } catch {
      setNotice("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const testConnection = async (connectionId: string) => {
    if (busyConnectionId) return;
    setBusyConnectionId(connectionId);
    setNotice("");
    try {
      const response = await fetchApiResponse(
        `/api/social/whatsapp-cloud/connections/${encodeURIComponent(connectionId)}/test`,
        { method: "POST" },
      );
      if (!response.ok) setNotice(await responseError(response));
      else setNotice("نجح فحص الاتصال والصلاحيات لدى Meta.");
      await loadConnections();
    } catch {
      setNotice("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      setBusyConnectionId(null);
    }
  };

  const disconnect = async (connectionId: string) => {
    if (busyConnectionId) return;
    setBusyConnectionId(connectionId);
    setNotice("");
    try {
      const response = await fetchApiResponse(
        `/api/social/whatsapp-cloud/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) setNotice(await responseError(response));
      else setNotice("تم حذف الاتصال التجريبي وبيانات اعتماده من MenaFlow.");
      await loadConnections();
    } catch {
      setNotice("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.");
    } finally {
      setBusyConnectionId(null);
    }
  };

  const confirmDisconnect = (connectionId: string) => {
    const message =
      "سيُحذف الرمز والاتصال من MenaFlow فقط. لن يُلغى الوصول لدى Meta.";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(message)) void disconnect(connectionId);
      return;
    }
    Alert.alert("حذف اتصال الاختبار", message, [
      { text: "إلغاء", style: "cancel" },
      {
        text: "حذف الاتصال",
        style: "destructive",
        onPress: () => void disconnect(connectionId),
      },
    ]);
  };

  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="اختبار WhatsApp Cloud"
        subtitle="اربط حساب المطور التجريبي وافحص اتصال الخادم بـMeta."
        back={{ href: "/(tabs)/more/sources", label: "العودة إلى المصادر" }}
      />

      <Panel>
        <SectionTitle title="إضافة Test WABA" />
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          هذه الصفحة للاختبار فقط. استخدم رمز Test WABA من Meta Developers؛
          يجب أن يكون معرّف حساب المراسلة مسموحاً به على الخادم. لا تستخدم رمز
          عميل أو رقماً إنتاجياً. لن تُرسل رسائل ولن يُسجل رقم.
        </Text>
        <Text style={[styles.label, { color: colors.foreground }]}>
          رمز الوصول التجريبي
        </Text>
        <TextInput
          accessibilityLabel="رمز الوصول التجريبي"
          autoCapitalize="none"
          autoCorrect={false}
          importantForAutofill="no"
          secureTextEntry
          value={accessToken}
          onChangeText={setAccessToken}
          placeholder="الصق رمز Test WABA"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
        />
        <Text style={[styles.label, { color: colors.foreground }]}>
          معرّف Messaging Account ‏(waba_id)
        </Text>
        <TextInput
          accessibilityLabel="معرّف Messaging Account"
          autoCapitalize="none"
          autoCorrect={false}
          value={messagingAccountId}
          onChangeText={setMessagingAccountId}
          placeholder="معرّف حساب المراسلة"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            styles.externalIdInput,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
        />
        <Text style={[styles.label, { color: colors.foreground }]}>
          معرّف رقم الهاتف
        </Text>
        <TextInput
          accessibilityLabel="معرّف رقم الهاتف"
          autoCapitalize="none"
          autoCorrect={false}
          value={phoneNumberId}
          onChangeText={setPhoneNumberId}
          placeholder="Phone Number ID"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            styles.externalIdInput,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
        />
        <ActionButton
          label={isSubmitting ? "جارٍ التحقق والحفظ…" : "تحقق واحفظ اتصال الاختبار"}
          icon="shield"
          disabled={
            isSubmitting ||
            !accessToken.trim() ||
            !messagingAccountId.trim() ||
            !phoneNumberId.trim()
          }
          onPress={() => void createTestConnection()}
        />
        {notice ? (
          <Text
            accessibilityRole="alert"
            style={[
              styles.notice,
              { color: notice.startsWith("تم") || notice.startsWith("نجح")
                  ? colors.primary
                  : colors.destructive },
            ]}
          >
            {notice}
          </Text>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle title="اتصالات مساحة العمل" />
        {isLoading ? (
          <ActivityIndicator
            accessibilityLabel="جارٍ تحميل اتصالات WhatsApp Cloud"
            color={colors.primary}
          />
        ) : loadError ? (
          <>
            <Text
              accessibilityRole="alert"
              style={[styles.description, { color: colors.destructive }]}
            >
              {loadError}
            </Text>
            <ActionButton
              label="إعادة المحاولة"
              icon="refresh-cw"
              secondary
              onPress={() => void loadConnections()}
            />
          </>
        ) : connections.length === 0 ? (
          <EmptyState
            icon="message-circle"
            title="لا توجد اتصالات Cloud"
            body="أضف بيانات Test WABA للتحقق من الاتصال. ربط حسابات العملاء غير متاح في هذه المرحلة."
          />
        ) : (
          connections.map((connection) => {
            const status = connectionStatus(connection);
            return (
              <View
                key={connection.id}
                style={[
                  styles.connectionCard,
                  { borderColor: colors.border, backgroundColor: colors.background },
                ]}
              >
                <View style={styles.connectionHeader}>
                  <Text
                    style={[styles.connectionTitle, { color: colors.foreground }]}
                  >
                    حساب WhatsApp التجريبي
                  </Text>
                  <StatusPill label={status.label} tone={status.tone} />
                </View>
                <Text style={[styles.metaId, { color: colors.mutedForeground }]}>
                  Messaging Account:{" "}
                  {connection.messagingAccounts[0]?.metaMessagingAccountId ??
                    "غير متاح"}
                </Text>
                {connection.messagingAccounts.flatMap((account) =>
                  account.phoneNumbers.map((phone) => (
                    <View key={phone.id} style={styles.phoneRow}>
                      <Text
                        style={[styles.phoneNumber, { color: colors.foreground }]}
                      >
                        {phone.phoneNumber}
                      </Text>
                      <Text
                        style={[styles.description, { color: colors.mutedForeground }]}
                      >
                        {phone.verifiedName ?? "اسم العرض غير متاح"}
                        {phone.qualityRating
                          ? ` · الجودة ${phone.qualityRating}`
                          : ""}
                      </Text>
                    </View>
                  )),
                )}
                <Text style={[styles.description, { color: colors.mutedForeground }]}>
                  آخر فحص:{" "}
                  {connection.lastCheckedAt
                    ? new Date(connection.lastCheckedAt).toLocaleString("ar")
                    : "لم يُفحص"}
                </Text>
                <View style={styles.actions}>
                  <ActionButton
                    label={
                      busyConnectionId === connection.id
                        ? "جارٍ الفحص…"
                        : "اختبار الاتصال"
                    }
                    icon="refresh-cw"
                    compact
                    secondary
                    disabled={busyConnectionId !== null}
                    onPress={() => void testConnection(connection.id)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="حذف اتصال WhatsApp Cloud التجريبي"
                    disabled={busyConnectionId !== null}
                    onPress={() => confirmDisconnect(connection.id)}
                    style={({ pressed }) => [
                      styles.deleteButton,
                      {
                        borderColor: colors.border,
                        opacity: busyConnectionId !== null ? 0.5 : pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.deleteLabel, { color: colors.destructive }]}>
                      حذف
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  description: { fontSize: 13, lineHeight: 20, textAlign: "right" },
  label: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    writingDirection: "rtl",
    textAlign: "right",
  },
  externalIdInput: { writingDirection: "ltr", textAlign: "left" },
  notice: { fontSize: 13, lineHeight: 20, textAlign: "right" },
  connectionCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  connectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  connectionTitle: { flex: 1, fontSize: 15, fontWeight: "800", textAlign: "right" },
  metaId: { fontSize: 11, textAlign: "left", writingDirection: "ltr" },
  phoneRow: { gap: 2 },
  phoneNumber: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deleteButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  deleteLabel: { fontSize: 13, fontWeight: "700" },
});
