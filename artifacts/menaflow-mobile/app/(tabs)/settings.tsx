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
import { BrandHeader, Page, PageTitle, Panel } from "@/components/Ui";
import { useStudio } from "@/context/StudioContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useColors } from "@/hooks/useColors";
import { Redirect, router } from "expo-router";
import { useClerk, useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { isLocalAuthDisabled } from "@/constants/auth";
import { signOutAndClearQueryCache } from "@/lib/sign-out";
import {
  getGetSubscriptionQueryKey,
  fetchApiResponse,
  useGetSubscription,
} from "@workspace/api-client-react";
import {
  readAppearanceMode,
  saveAppearanceMode,
  type AppearanceMode,
} from "@/lib/appearance";

async function hasWorkspaceDeletionRequest(
  response: Response,
): Promise<boolean> {
  if (!response.ok) throw new Error("WORKSPACE_DELETION_REQUEST_FAILED");
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("request" in payload)
  ) {
    throw new Error("INVALID_WORKSPACE_DELETION_REQUEST_RESPONSE");
  }
  const request = payload.request;
  if (request === null) return false;
  if (
    typeof request !== "object" ||
    request === null ||
    !("status" in request) ||
    request.status !== "pending"
  ) {
    throw new Error("INVALID_WORKSPACE_DELETION_REQUEST_RESPONSE");
  }
  return true;
}

function SettingRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  danger = false,
  busy = false,
  showChevron = false,
  last = false,
}: {
  icon: LucideIconName;
  title: string;
  subtitle?: string;
  value?: boolean;
  onValueChange?: (next: boolean) => void;
  danger?: boolean;
  busy?: boolean;
  showChevron?: boolean;
  last?: boolean;
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
    <View
      style={[
        styles.settingRow,
        { borderBottomColor: colors.border },
        last && styles.settingRowLast,
      ]}
    >
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
          accessibilityLabel={title}
          accessibilityHint={subtitle}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.card}
        />
      ) : busy ? (
        <ActivityIndicator size="small" color={colors.destructive} />
      ) : showChevron ? (
        <Icon name="chevron-left" size={18} color={colors.mutedForeground} />
      ) : null}
    </View>
  );
}

function SettingsSectionTitle({
  icon,
  title,
}: {
  icon: LucideIconName;
  title: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeading}>
      <View style={[styles.sectionIcon, { backgroundColor: colors.accent }]}>
        <Icon name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {title}
      </Text>
    </View>
  );
}

export function SettingsScreen() {
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
  const { workspaces, activeWorkspaceId, isLoading, isError, selectWorkspace } =
    useWorkspace();
  const activeWorkspace = workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  const canRequestWorkspaceDeletion =
    Boolean(onSignOut) && activeWorkspace?.role === "owner";
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [deletionRequestStatus, setDeletionRequestStatus] = useState<
    "loading" | "none" | "pending" | "error"
  >("loading");
  const [submittingDeletionRequest, setSubmittingDeletionRequest] =
    useState(false);
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
  useEffect(() => {
    if (!canRequestWorkspaceDeletion || !activeWorkspaceId) {
      setDeletionRequestStatus("none");
      return;
    }

    let active = true;
    setDeletionRequestStatus("loading");
    void fetchApiResponse("/api/workspaces/current/deletion-request")
      .then(hasWorkspaceDeletionRequest)
      .then((exists) => {
        if (active) setDeletionRequestStatus(exists ? "pending" : "none");
      })
      .catch((error: unknown) => {
        console.error("Unable to load workspace deletion request:", error);
        if (active) setDeletionRequestStatus("error");
      });
    return () => {
      active = false;
    };
  }, [activeWorkspaceId, canRequestWorkspaceDeletion]);
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
        const message =
          "لم يكتمل إنهاء الجلسة. تحقق من الاتصال وحاول مرة أخرى.";
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
      {
        text: "تسجيل الخروج",
        style: "destructive",
        onPress: () => void performSignOut(),
      },
    ]);
  };
  const submitWorkspaceDeletionRequest = async () => {
    if (!canRequestWorkspaceDeletion || submittingDeletionRequest) return;
    setSubmittingDeletionRequest(true);
    try {
      const exists = await hasWorkspaceDeletionRequest(
        await fetchApiResponse("/api/workspaces/current/deletion-request", {
          method: "POST",
        }),
      );
      if (!exists) throw new Error("WORKSPACE_DELETION_REQUEST_NOT_RECORDED");
      setDeletionRequestStatus("pending");
      Alert.alert(
        "تم تسجيل الطلب",
        "سُجل طلب حذف مساحة العمل. لم يبدأ حذف البيانات أو الوسائط.",
      );
    } catch (error) {
      console.error("Unable to submit workspace deletion request:", error);
      Alert.alert("تعذر تسجيل الطلب", "تحقق من اتصالك ثم حاول مرة أخرى.");
    } finally {
      setSubmittingDeletionRequest(false);
    }
  };
  const confirmWorkspaceDeletionRequest = () => {
    if (!canRequestWorkspaceDeletion || submittingDeletionRequest) return;
    const message =
      "سيُسجل طلب للمراجعة فقط. لن تُحذف البيانات أو الوسائط تلقائيًا.";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`طلب حذف مساحة العمل\n\n${message}`)) {
        void submitWorkspaceDeletionRequest();
      }
      return;
    }
    Alert.alert("طلب حذف مساحة العمل", message, [
      { text: "إلغاء", style: "cancel" },
      {
        text: "تسجيل الطلب",
        style: "destructive",
        onPress: () => void submitWorkspaceDeletionRequest(),
      },
    ]);
  };
  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="الإعدادات"
        subtitle="تحكم في تفضيلات مساحة عملك."
        back={{ href: "/(tabs)/more", label: "العودة إلى المزيد" }}
      />
      {onSignOut ? (
        <Panel style={styles.settingsPanel}>
          <SettingsSectionTitle icon="user" title="مساحات العمل" />
          {isLoading ? (
            <ActivityIndicator
              accessibilityLabel="جارٍ تحميل مساحات العمل"
              color={colors.primary}
              style={styles.workspaceLoading}
            />
          ) : isError ? (
            <View style={styles.workspaceMessage}>
              <Text
                accessibilityRole="alert"
                style={[styles.settingSubtitle, { color: colors.destructive }]}
              >
                تعذر تحميل مساحات العمل.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ["workspace-list", userId ?? null],
                  })
                }
              >
                <Text
                  style={[styles.subscriptionLink, { color: colors.primary }]}
                >
                  إعادة المحاولة
                </Text>
              </Pressable>
            </View>
          ) : workspaces.length === 0 ? (
            <Text
              style={[
                styles.settingSubtitle,
                { color: colors.mutedForeground },
              ]}
            >
              لا توجد مساحات مرتبطة بهذا الحساب.
            </Text>
          ) : (
            <View style={styles.workspaceOptions}>
              {workspaces.map((workspace, index) => {
                const selected = workspace.id === activeWorkspaceId;
                const roleLabel =
                  workspace.role === "owner"
                    ? "مالك"
                    : workspace.role === "admin"
                      ? "مسؤول"
                      : "عضو";
                return (
                  <Pressable
                    key={workspace.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`التبديل إلى ${workspace.name}، ${roleLabel}`}
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      void selectWorkspace(workspace.id).catch(() => {
                        Alert.alert(
                          "تعذر تبديل مساحة العمل",
                          "تحقق من اتصالك ثم حاول مرة أخرى.",
                        );
                      });
                    }}
                    style={({ pressed }) => [
                      styles.workspaceOption,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: selected
                          ? colors.accent
                          : "transparent",
                        opacity: pressed ? 0.72 : 1,
                      },
                      index === workspaces.length - 1 &&
                        styles.workspaceOptionLast,
                    ]}
                  >
                    <View style={styles.workspaceCopy}>
                      <Text
                        style={[
                          styles.settingTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {workspace.name}
                      </Text>
                      <Text
                        style={[
                          styles.settingSubtitle,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {roleLabel}
                      </Text>
                    </View>
                    {selected ? (
                      <Icon name="check" size={18} color={colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {canRequestWorkspaceDeletion ? (
            <View style={styles.deletionRequest}>
              <Text
                accessibilityRole={
                  deletionRequestStatus === "error" ? "alert" : undefined
                }
                style={[
                  styles.settingSubtitle,
                  {
                    color:
                      deletionRequestStatus === "error"
                        ? colors.destructive
                        : colors.mutedForeground,
                  },
                ]}
              >
                {deletionRequestStatus === "pending"
                  ? "تم تسجيل طلب الحذف. لا تُحذف البيانات أو الوسائط تلقائيًا."
                  : deletionRequestStatus === "loading"
                    ? "جارٍ التحقق من طلب الحذف السابق..."
                    : deletionRequestStatus === "error"
                      ? "تعذر التحقق من طلب سابق؛ يمكنك إعادة تسجيل الطلب بأمان."
                      : "تسجيل الطلب لا يحذف البيانات أو الوسائط تلقائيًا."}
              </Text>
              {deletionRequestStatus !== "pending" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled:
                      submittingDeletionRequest ||
                      deletionRequestStatus === "loading",
                    busy: submittingDeletionRequest,
                  }}
                  disabled={
                    submittingDeletionRequest ||
                    deletionRequestStatus === "loading"
                  }
                  onPress={confirmWorkspaceDeletionRequest}
                  style={({ pressed }) => ({
                    opacity:
                      submittingDeletionRequest ||
                      deletionRequestStatus === "loading"
                        ? 0.55
                        : pressed
                          ? 0.72
                          : 1,
                  })}
                >
                  <Text
                    style={[
                      styles.deletionRequestAction,
                      { color: colors.destructive },
                    ]}
                  >
                    {submittingDeletionRequest
                      ? "جارٍ تسجيل الطلب..."
                      : "تسجيل طلب حذف مساحة العمل"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Panel>
      ) : null}
      <Panel style={styles.settingsPanel}>
        <SettingsSectionTitle icon="user" title="الحساب" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تعديل الملف الشخصي وإكمال الإعداد"
          onPress={() => router.push("/account/profile")}
        >
          <SettingRow
            icon="user"
            title={userName}
            subtitle={`${userEmail} · تعديل الملف الشخصي`}
            showChevron
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/more/sources",
              params: { view: "publishing", returnTo: "settings" },
            })
          }
        >
          <SettingRow
            icon="link-2"
            title="حسابات النشر"
            subtitle="إدارة حسابات فيسبوك وإنستغرام"
            showChevron
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/product-catalog",
              params: { returnTo: "settings" },
            })
          }
        >
          <SettingRow
            icon="file-text"
            title="كتالوج المنتجات"
            subtitle="إدارة المنتجات ومعلوماتها المعتمدة للرد الآلي"
            showChevron
            last
          />
        </Pressable>
      </Panel>
      {onSignOut ? (
        <Panel style={styles.settingsPanel}>
          <SettingsSectionTitle icon="shopping-bag" title="الخطة والاشتراك" />
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
                <Text
                  style={[styles.subscriptionLink, { color: colors.primary }]}
                >
                  إعادة المحاولة
                </Text>
              </Pressable>
            </View>
          ) : subscription ? (
            <>
              <View
                style={[
                  styles.subscriptionSummary,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.accent,
                  },
                ]}
              >
                <View style={styles.subscriptionCopy}>
                  <Text
                    style={[
                      styles.subscriptionPlan,
                      { color: colors.foreground },
                    ]}
                  >
                    {subscription.planName}
                  </Text>
                  <Text
                    style={[
                      styles.settingSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
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
                  <Text
                    style={[
                      styles.subscriptionPrice,
                      { color: colors.primary },
                    ]}
                  >
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
                    <View
                      key={item.label}
                      style={[
                        styles.subscriptionUsageRow,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.settingSubtitle,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text
                        style={[
                          styles.settingSubtitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {item.used} / {item.limit}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text
                style={[styles.plansHeading, { color: colors.mutedForeground }]}
              >
                الخطط المتاحة
              </Text>
              {subscription.plans.map((plan) => (
                <View
                  key={plan.id}
                  style={[
                    styles.planOption,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                  ]}
                >
                  <Text
                    style={[styles.settingTitle, { color: colors.foreground }]}
                  >
                    {plan.name}
                  </Text>
                  <Text
                    style={[
                      styles.settingSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {plan.monthlyPriceUsd === 0
                      ? "مجانًا"
                      : `$${plan.monthlyPriceUsd} شهريًا`}
                    {" · "}
                    {plan.limits.postsCreated} منشور
                    {" · "}
                    {plan.limits.aiGenerations} توليد AI
                  </Text>
                </View>
              ))}
              <Text
                style={[
                  styles.subscriptionNotice,
                  { color: colors.mutedForeground },
                ]}
              >
                الترقية والتحصيل غير متاحين حاليًا؛ سيتم تفعيلهما بعد ربط بوابة
                الدفع.
              </Text>
            </>
          ) : null}
        </Panel>
      ) : null}
      <Panel style={styles.settingsPanel}>
        <SettingsSectionTitle icon="bell" title="التنبيهات وسير العمل" />
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
          last
        />
      </Panel>
      <Panel style={styles.settingsPanel}>
        <SettingsSectionTitle icon="sun" title="المظهر واللغة" />
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
            showChevron
            last
          />
        </Pressable>
        {appearancePickerVisible ? (
          <View
            style={[styles.appearanceOptions, { borderColor: colors.border }]}
          >
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
      <Panel style={styles.settingsPanel}>
        <SettingsSectionTitle icon="shield" title="الدعم والأمان" />
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            Alert.alert(
              "مركز المساعدة",
              "تواصل مع فريق MenaFlow عبر البريد المخصص للدعم في إعدادات حسابك.",
            )
          }
        >
          <SettingRow icon="help-circle" title="مركز المساعدة" showChevron />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            Alert.alert(
              "الخصوصية",
              "تُخزّن المسودات الحالية على هذا الجهاز. لا يتم إرسالها إلى منصات التواصل من دون ربط الحساب والموافقة.",
            )
          }
        >
          <SettingRow icon="shield" title="الخصوصية والأمان" showChevron />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            Alert.alert(
              "حول التطبيق",
              "MenaFlow — مساحة عربية لإدارة المحتوى والحسابات الاجتماعية.",
            )
          }
        >
          <SettingRow icon="info" title="حول MenaFlow" showChevron last />
        </Pressable>
      </Panel>
      {onSignOut ? (
        <Panel style={styles.settingsPanel}>
          <SettingsSectionTitle icon="user" title="الجلسة" />
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
              last
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
  settingsPanel: { gap: 8 },
  workspaceLoading: { paddingVertical: 16 },
  workspaceMessage: { gap: 10, paddingVertical: 8 },
  workspaceOptions: { gap: 2, borderTopWidth: StyleSheet.hairlineWidth },
  workspaceOption: {
    minHeight: 52,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  workspaceOptionLast: { borderBottomWidth: 0 },
  workspaceCopy: { flex: 1, minWidth: 0, gap: 3 },
  deletionRequest: { gap: 10, paddingTop: 16 },
  deletionRequestAction: { fontSize: 13, fontWeight: "700" },
  sectionHeading: {
    minHeight: 38,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    marginBottom: 2,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  settingRow: {
    minHeight: 64,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 4 },
  settingTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  settingSubtitle: { fontSize: 10, lineHeight: 16, textAlign: "right" },
  settingIcon: {
    width: 38,
    height: 38,
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
    minHeight: 72,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  subscriptionCopy: { flex: 1, gap: 4 },
  subscriptionPlan: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  subscriptionPrice: { fontSize: 12, fontWeight: "700" },
  subscriptionUsage: { gap: 0, paddingVertical: 8 },
  subscriptionUsageRow: {
    minHeight: 40,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  plansHeading: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
    paddingTop: 4,
  },
  planOption: {
    minHeight: 60,
    gap: 5,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 7,
  },
  subscriptionNotice: { fontSize: 10, lineHeight: 16, paddingTop: 8 },
  subscriptionLink: { fontSize: 12, fontWeight: "700" },
});

export default function SettingsRoute() {
  return <Redirect href="/(tabs)/more/settings" />;
}
