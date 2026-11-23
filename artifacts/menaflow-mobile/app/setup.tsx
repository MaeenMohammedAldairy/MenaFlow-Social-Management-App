import { useAuth } from "@clerk/expo";
import {
  getOnboardingStatus,
  getSocialConnections,
  markSocialAccountsSetupComplete,
  getOnboardingStatusQueryKey,
  saveOnboardingProgress,
  updateWorkspaceCurrent,
  type OnboardingStatus,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Info,
  LayoutDashboard,
  Radio,
  Store,
  X,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BrandMark } from "@/components/BrandMark";
import { OfflineBanner } from "@/components/OfflineBanner";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { hasEligibleSocialConnection } from "@workspace/api-zod";
import { CairoText as Text } from "@/components/CairoTypography";
import { useAuthTheme } from "@/hooks/useAuthTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocalAuthDisabled } from "@/constants/auth";
import { useWorkspace } from "@/context/WorkspaceContext";
import { canEditBusinessInfo } from "@/lib/setup-flow";
import { CountryPickerModal } from "@/components/sources/CountryPickerModal";
import { getCountries, type CountryCode } from "libphonenumber-js";

/** Setup reuses server onboarding progress and the existing account-linking flow. */
const BUSINESS_TYPES = [
  "مطعم أو كافيه",
  "متجر إلكتروني",
  "ملابس وأزياء",
  "صالون تجميل",
  "خدمات",
  "عقارات",
  "تعليم",
  "صحة",
  "سياحة وسفر",
  "أخرى",
] as const;

type StepKey = "business" | "channel" | "automation" | "success";

export default function SetupRoute() {
  const { activeWorkspaceId } = useWorkspace();
  if (isLocalAuthDisabled) return <Redirect href="/(tabs)" />;
  // Do not carry edited values or restoration state into a different workspace.
  return <AuthenticatedSetup key={activeWorkspaceId ?? "no-workspace"} />;
}

function AuthenticatedSetup() {
  const theme = useAuthTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isLoaded, userId } = useAuth();
  const { result, edit } = useLocalSearchParams<{ result?: string; edit?: string }>();
  const queryClient = useQueryClient();
  const { workspaces, activeWorkspaceId, isLoading: workspaceLoading } = useWorkspace();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  const onboardingKey = getOnboardingStatusQueryKey(userId ?? null);
  const status = useQuery({
    queryKey: onboardingKey,
    queryFn: () => getOnboardingStatus({ timeoutMs: 20000 }),
    enabled: Boolean(userId && activeWorkspaceId),
    retry: false,
  });
  const completed = status.data?.completed === true;

  const [step, setStep] = React.useState<StepKey>("business");
  const [name, setName] = React.useState("");
  const [businessType, setBusinessType] = React.useState<string | null>(null);
  const [nameTouched, setNameTouched] = React.useState(false);
  const [typeOpen, setTypeOpen] = React.useState(false);
  const [country, setCountry] = React.useState<CountryCode>("YE");
  const [countryTouched, setCountryTouched] = React.useState(false);
  const [countryOpen, setCountryOpen] = React.useState(false);
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const actionLock = React.useRef(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  // Which exit the pending "skip" action should navigate to on success.
  const [pendingExit, setPendingExit] = React.useState<
    "connect" | "dashboard" | null
  >(null);

  // Restore only on initial load, not on subsequent query refreshes, so that
  // navigating back to edit the form is not overridden by the server status.
  const restoredWorkspace = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!activeWorkspaceId || !status.data || restoredWorkspace.current === activeWorkspaceId) return;
    restoredWorkspace.current = activeWorkspaceId;
    if (!status.data.completed && status.data.currentStep === 1 && edit !== "business") {
      setStep("channel");
      router.replace("/connect-accounts");
      return;
    }
    setStep(status.data.completed ? (result === "success" ? "success" : "business") : edit === "business" ? "business" : status.data.currentStep >= 2 ? "automation" : "business");
  }, [activeWorkspaceId, status.data, result, edit]);

  // Prefill from the workspace once the list arrives; never overwrite input
  // the merchant already typed.
  React.useEffect(() => {
    if (!activeWorkspace) return;
    if (!nameTouched) setName(activeWorkspace.name ?? "");
    setBusinessType((current) => current ?? activeWorkspace.businessType ?? null);
    if (!countryTouched && activeWorkspace.country && getCountries().includes(activeWorkspace.country as CountryCode)) {
      setCountry(activeWorkspace.country as CountryCode);
    }
  }, [activeWorkspace, nameTouched, countryTouched]);

  const invalidateWorkspaceList = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["workspace-list", userId ?? null],
    });
  }, [queryClient, userId]);

  const save = useMutation({
    mutationFn: async () => {
      await updateWorkspaceCurrent({
        name: name.trim(),
        country,
        ...(businessType ? { businessType } : {}),
      }, { timeoutMs: 20000 });
      if (!completed) {
        // Re-read before advancing: a previous request may have succeeded even
        // if its response was lost. Never advance twice on a retry.
        const current = await getOnboardingStatus({ timeoutMs: 20000 });
        const next = !current.completed && current.currentStep === 0
          ? await saveOnboardingProgress("advance", { timeoutMs: 20000 }, 0)
          : current;
        queryClient.setQueryData(onboardingKey, next);
      }
    },
    onSuccess: () => {
      setFormError(null);
      invalidateWorkspaceList();
      if (completed) {
        // Checklist edit path: no channel hand-off, just go back.
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)");
        return;
      }
      setStep("channel");
      router.replace("/connect-accounts");
    },
    onSettled: () => { actionLock.current = false; },
    onError: (error) => {
      setFormError(
        error instanceof Error && error.name === "TimeoutError"
          ? "استغرق الطلب وقتًا أطول من المتوقع. قد تكون البيانات حُفظت؛ أعد المحاولة للتحقق."
          : "تعذّر تأكيد حفظ البيانات أو التقدم. تحقق من اتصالك ثم أعد المحاولة.",
      );
    },
  });

  const finishSetup = useMutation({
    mutationFn: () => saveOnboardingProgress("skip", { timeoutMs: 20000 }),
    onSuccess: (next: OnboardingStatus) => {
      queryClient.setQueryData(onboardingKey, next);
      invalidateWorkspaceList();
      const exit = pendingExit;
      setPendingExit(null);
      router.replace(exit === "connect" ? "/connect-accounts" : "/(tabs)");
    },
    onSettled: () => { actionLock.current = false; },
    onError: (error) => {
      setPendingExit(null);
      setFormError(
        error instanceof Error && error.name === "TimeoutError"
          ? "استغرق الطلب وقتًا أطول من المتوقع. أعد المحاولة للتحقق من حالة الإعداد."
          : "تعذّر تأكيد إنهاء الإعداد. تحقق من اتصالك ثم أعد المحاولة.",
      );
    },
  });

  const finishAutomation = useMutation({
    mutationFn: async () => {
      let current = await getOnboardingStatus({ timeoutMs: 20000 });
      if (!current.completed) {
        if (current.currentStep < 2) throw new Error("Setup step is not ready");
        current = await saveOnboardingProgress("advance", { timeoutMs: 20000 }, 2);
      }
      if (!current.completed) throw new Error("Setup progress changed");
      // Preserve the existing server-side eligible-account check. A connection
      // may have expired while the user was on this screen.
      if (!current.socialAccountsCompleted) {
        const connections = await getSocialConnections({ timeoutMs: 20000 });
        if (hasEligibleSocialConnection(connections)) current = await markSocialAccountsSetupComplete({ timeoutMs: 20000 });
      }
      return current;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(onboardingKey, next);
      setFormError(null);
      setStep("success");
      router.setParams({ result: "success" });
    },
    onSettled: () => { actionLock.current = false; },
    onError: () => setFormError("تعذّر تأكيد إكمال الإعداد. تحقق من اتصالك ثم أعد المحاولة."),
  });

  if (!isLoaded || workspaceLoading || (!activeWorkspaceId && workspaces.length > 0) || (activeWorkspaceId && status.isLoading)) return <LoadingScreen />;
  if (!activeWorkspace) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <OfflineBanner />
        <Text accessibilityRole="alert" style={[styles.loadingText, { color: theme.foreground }]}>تعذّر تحميل مساحة العمل. تحقق من اتصالك ثم أعد المحاولة.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => invalidateWorkspaceList()}
          style={styles.retryInlineButton}
        >
          <Text style={[styles.retryInlineLabel, { color: theme.primary }]}>إعادة المحاولة</Text>
        </Pressable>
      </View>
    );
  }
  if (status.isError && !status.data) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <OfflineBanner />
        <Text accessibilityRole="alert" style={[styles.loadingText, { color: theme.foreground }]}>
          تعذّر تحميل حالة الإعداد. تحقق من اتصالك ثم أعد المحاولة.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void status.refetch()}
          style={styles.retryInlineButton}
        >
          <Text style={[styles.retryInlineLabel, { color: theme.primary }]}>إعادة المحاولة</Text>
        </Pressable>
      </View>
    );
  }

  const wide = width >= 900;
  const trimmedName = name.trim();
  // `PATCH /workspaces/current` is owner-only. The checklist step is hidden
  // from members, but `/setup` is reachable by path too — say so plainly
  // instead of letting the save fail with a generic server error.
  const readOnly = !canEditBusinessInfo(activeWorkspace);
  const canSave = trimmedName.length > 0 && trimmedName.length <= 80 && !save.isPending && !finishSetup.isPending && !readOnly;
  // In edit mode (onboarding already completed) only the form is shown.
  const activeIndex = step === "business" ? 0 : step === "channel" ? 1 : step === "automation" ? 2 : 3;
  const busy = save.isPending || finishSetup.isPending || finishAutomation.isPending;

  const handleExit = (exit: "connect" | "dashboard") => {
    if (busy || actionLock.current) return;
    setFormError(null);
    if (exit === "connect") {
      router.replace("/connect-accounts");
      return;
    }
    actionLock.current = true;
    setPendingExit(exit);
    finishSetup.mutate();
  };

  return (
    <LinearGradient colors={[theme.card, theme.background]} style={styles.root}>
      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobTop, { backgroundColor: theme.waveSoft }]}
      />
      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobBottom, { backgroundColor: theme.wave }]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.column, { maxWidth: wide ? 560 : 480 }]}>
          <OfflineBanner />
          <View style={styles.brand}>
            <BrandMark height={26} />
          </View>

          {completed && step === "business" ? (
            // Edit mode is pushed from the dashboard checklist (or from the
            // connection screen's "العودة إلى بيانات النشاط"), and nothing on
            // screen said so: the only way out was Save or a system gesture.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق بيانات النشاط"
              disabled={busy}
              onPress={() => {
                if (busy) return;
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)");
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeRow,
                {
                  backgroundColor: pressed ? theme.background : theme.card,
                  borderColor: theme.border,
                },
              ]}
            >
              <X size={15} color={theme.icon} />
              <Text style={[styles.closeRowText, { color: theme.foreground }]}>
                إغلاق
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.stepContent}>
            {(!completed || step === "success" || step === "automation") ? <OnboardingStepper activeIndex={activeIndex} /> : null}

            {activeIndex === 0 ? (
              <View style={styles.formStep}>
                <Image source={require("@/assets/images/setup-business.png")} style={styles.hero} resizeMode="contain" accessibilityIgnoresInvertColors />
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.foreground }]}
                >
                  {completed ? "بيانات نشاطك" : "لنجهّز منصتك"}
                </Text>
                <Text
                  style={[styles.description, { color: theme.mutedForeground }]}
                >
                  {completed
                    ? "يمكنك تعديل اسم النشاط ونوعه في أي وقت."
                    : "أخبرنا عن نشاطك لنساعدك في إعداد منصتك."}
                </Text>

                {readOnly ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.readOnlyNote, { color: theme.mutedForeground }]}
                  >
                    تعديل بيانات النشاط متاح لمالك المساحة فقط.
                  </Text>
                ) : null}

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: theme.foreground }]}>
                    اسم النشاط <Text accessibilityLabel="حقل إلزامي" style={{ color: theme.destructive }}>*</Text>
                  </Text>
                  <TextInput
                    value={name}
                    onChangeText={(next) => {
                      setNameTouched(true);
                      setName(next);
                    }}
                    maxLength={80}
                    placeholder="مثال: متجر للبرمجيات"
                    placeholderTextColor={theme.mutedForeground}
                    editable={!busy && !readOnly}
                    accessibilityLabel="اسم النشاط التجاري"
                    style={[
                      styles.input,
                      {
                        color: theme.foreground,
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                      },
                    ]}
                  />
                  {nameTouched && !trimmedName ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.destructive, textAlign: "right" }]}>يرجى إدخال اسم النشاط.</Text> : null}
                </View>

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: theme.foreground }]}>
                    نوع النشاط <Text style={{ color: theme.mutedForeground, fontWeight: "600" }}>(اختياري)</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="نوع النشاط"
                    accessibilityState={{ expanded: typeOpen, disabled: busy || readOnly }}
                    disabled={busy || readOnly}
                    onPress={() => setTypeOpen((open) => !open)}
                    style={[styles.select, { backgroundColor: theme.inputSurface, borderColor: theme.border }]}
                  >
                    <ChevronDown size={19} color={theme.icon} />
                    <Text style={[styles.selectText, { color: businessType ? theme.foreground : theme.mutedForeground }]}>
                      {businessType ?? "اختر مجال نشاطك"}
                    </Text>
                  </Pressable>
                  {typeOpen ? (
                    <View style={[styles.typeList, { backgroundColor: theme.inputSurface, borderColor: theme.border }]}>
                      {BUSINESS_TYPES.map((type) => (
                        <Pressable
                          key={type}
                          accessibilityRole="button"
                          accessibilityState={{ selected: businessType === type, disabled: busy || readOnly }}
                          disabled={busy || readOnly}
                          onPress={() => { setBusinessType(type); setTypeOpen(false); }}
                          style={styles.typeOption}
                        >
                          <Text style={[styles.selectText, { color: businessType === type ? theme.primary : theme.foreground }]}>{type}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: theme.foreground }]}>البلد</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="اختر بلد النشاط" disabled={busy || readOnly}
                    onPress={() => setCountryOpen(true)}
                    style={[styles.select, { backgroundColor: theme.inputSurface, borderColor: theme.border }]}>
                    <ChevronDown size={19} color={theme.icon} />
                    <Text style={[styles.selectText, { color: theme.foreground }]}>
                      {typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["ar"], { type: "region" }).of(country) : country} {String.fromCodePoint(...[...country].map((c) => 127397 + c.charCodeAt(0)))}
                    </Text>
                  </Pressable>
                </View>
                <CountryPickerModal visible={countryOpen} selectedCountry={country} businessCountry
                  onSelectCountry={(value) => { setCountryTouched(true); setCountry(value); }}
                  onClose={() => setCountryOpen(false)} />

                <View style={[styles.infoBanner, { backgroundColor: theme.primarySoft }]}>
                  <Info size={18} color={theme.primary} />
                  <Text style={[styles.infoText, { color: theme.foreground }]}>يمكنك تعديل هذه المعلومات لاحقًا من الإعدادات.</Text>
                </View>

                {formError ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: theme.destructive }]}
                  >
                    {formError}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: save.isPending, disabled: !canSave }}
                  disabled={!canSave}
                  onPress={() => {
                    if (actionLock.current) return;
                    actionLock.current = true;
                    setFormError(null);
                    save.mutate();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: !canSave ? theme.disabled : theme.primary,
                      opacity: canSave && pressed ? 0.88 : 1,
                      shadowColor: theme.primary,
                      shadowOpacity: !canSave ? 0 : 0.28,
                      elevation: !canSave ? 0 : 5,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      {
                        color: !canSave
                          ? theme.disabledForeground
                          : theme.primaryForeground,
                      },
                    ]}
                  >
                    {save.isPending
                      ? "جارٍ الحفظ…"
                      : completed
                        ? "حفظ التغييرات"
                        : "حفظ ومتابعة"}
                  </Text>
                  <ArrowLeft
                    size={18}
                    color={!canSave ? theme.disabledForeground : theme.primaryForeground}
                  />
                </Pressable>
                {!completed ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, busy: finishSetup.isPending }}
                    disabled={busy}
                    onPress={() => handleExit("dashboard")}
                    style={[
                      styles.secondaryButton,
                      {
                        borderColor: theme.border,
                        backgroundColor: busy ? theme.disabled : theme.card,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: busy ? theme.disabledForeground : theme.foreground },
                      ]}
                    >
                      إكمال لاحقًا
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : step === "channel" ? (
              <View style={styles.formStep}>
                <Image source={require("@/assets/images/setup-accounts.png")} style={styles.hero} resizeMode="contain" />
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.foreground }]}
                >
                  اربط قناتك الأولى
                </Text>
                <Text
                  style={[styles.description, { color: theme.mutedForeground }]}
                >
                  فيسبوك أو إنستغرام أو واتساب — يمكنك الربط الآن، أو الدخول
                  مباشرة ومتابعة الربط لاحقًا من لوحة التحكم.
                </Text>

                {formError ? (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: theme.destructive }]}
                  >
                    {formError}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: finishSetup.isPending }}
                  disabled={busy}
                  onPress={() => handleExit("connect")}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: busy ? theme.disabled : theme.primary,
                      opacity: !busy && pressed ? 0.88 : 1,
                      shadowColor: theme.primary,
                      shadowOpacity: busy ? 0 : 0.28,
                      elevation: busy ? 0 : 5,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: busy ? theme.disabledForeground : theme.primaryForeground },
                    ]}
                  >
                    ربط الآن
                  </Text>
                  <ArrowLeft size={18} color={busy ? theme.disabledForeground : theme.primaryForeground} />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: finishSetup.isPending }}
                  disabled={busy}
                  onPress={() => handleExit("dashboard")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor: busy ? theme.disabled : theme.card,
                      borderColor: theme.border,
                      opacity: !busy && pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <LayoutDashboard size={17} color={busy ? theme.disabledForeground : theme.foreground} />
                  <Text style={[styles.secondaryButtonText, { color: busy ? theme.disabledForeground : theme.foreground }]}>
                    ادخل لوحة التحكم
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="العودة إلى بيانات النشاط"
                  disabled={busy}
                  onPress={() => setStep("business")}
                  style={styles.backRow}
                  hitSlop={6}
                >
                  <ArrowRight size={16} color={theme.mutedForeground} />
                  <Text style={[styles.backText, { color: theme.mutedForeground }]}>
                    السابق
                  </Text>
                </Pressable>
              </View>
            ) : step === "automation" ? (
              <View style={styles.formStep}>
                <Image source={require("@/assets/images/setup-automation.png")} style={styles.hero} resizeMode="contain" />
                <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>الأتمتة والردود</Text>
                <Text style={[styles.description, { color: theme.mutedForeground }]}>يمكنك تخصيص إعدادات الردود من صفحة إعدادات المحادثات في أي وقت.</Text>
                {["الأسئلة الشائعة", "الردود الذكية", "إعدادات المحادثات"].map((label) => (
                  <Pressable key={label} accessibilityRole="button" onPress={() => router.push("/inbox/reply-settings")}
                    style={[styles.select, { width: "100%", borderColor: theme.border, backgroundColor: theme.inputSurface }]}>
                    <ArrowLeft size={17} color={theme.primary} />
                    <Text style={[styles.selectText, { color: theme.foreground }]}>{label}</Text>
                  </Pressable>
                ))}
                <View style={[styles.infoBanner, { backgroundColor: theme.primarySoft }]}><Info size={18} color={theme.primary} /><Text style={[styles.infoText, { color: theme.foreground }]}>يمكنك تخصيص الردود حسب المنصة المستخدمة.</Text></View>
                {formError ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.destructive }]}>{formError}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy: finishAutomation.isPending }} onPress={() => { if (actionLock.current) return; actionLock.current = true; setFormError(null); finishAutomation.mutate(); }}
                  style={[styles.primaryButton, { backgroundColor: busy ? theme.disabled : theme.primary, shadowColor: theme.primary, shadowOpacity: busy ? 0 : 0.28, elevation: busy ? 0 : 5 }]}>
                  <Text style={[styles.primaryButtonText, { color: busy ? theme.disabledForeground : theme.primaryForeground }]}>{finishAutomation.isPending ? "جارٍ الحفظ…" : "متابعة"}</Text><ArrowLeft size={18} color={busy ? theme.disabledForeground : theme.primaryForeground} />
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => handleExit("dashboard")} style={[styles.secondaryButton, { borderColor: theme.border }]}>
                  <Text style={[styles.secondaryButtonText, { color: theme.foreground }]}>إكمال لاحقًا</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace("/connect-accounts")} style={styles.backRow}>
                  <ArrowRight size={16} color={theme.mutedForeground} /><Text style={[styles.backText, { color: theme.mutedForeground }]}>السابق</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.formStep}>
                <Image source={require("@/assets/images/setup-launch.png")} style={styles.hero} resizeMode="contain" />
                <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>جاهز للانطلاق!</Text>
                <View style={[styles.infoBanner, { backgroundColor: theme.primarySoft }]}><Check size={20} color={theme.primary} /><Text style={[styles.infoText, { color: theme.foreground }]}>تم اكتمال الإعداد بنجاح</Text></View>
                {!status.data?.socialAccountsCompleted ? <Text style={[styles.description, { color: theme.mutedForeground }]}>يمكنك إكمال ربط حساب مؤهل لاحقًا من لوحة التحكم.</Text> : null}
                <Pressable accessibilityRole="button" onPress={() => router.replace("/(tabs)")} style={[styles.primaryButton, { backgroundColor: theme.primary }]}><Text style={[styles.primaryButtonText, { color: theme.primaryForeground }]}>الانتقال إلى لوحة التحكم</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: summaryOpen }} onPress={() => setSummaryOpen((open) => !open)} style={[styles.secondaryButton, { borderColor: theme.border }]}><Text style={[styles.secondaryButtonText, { color: theme.foreground }]}>مشاهدة ملخص الإعداد</Text></Pressable>
                {summaryOpen ? <View style={[styles.infoBanner, { backgroundColor: theme.inputSurface }]}><Text style={[styles.infoText, { color: theme.foreground }]}>{`النشاط: ${activeWorkspace?.name ?? name}
نوع النشاط: ${activeWorkspace?.businessType ?? businessType ?? "لم يُحدد"}
البلد: ${typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["ar"], { type: "region" }).of(activeWorkspace?.country ?? country) : (activeWorkspace?.country ?? country)}
الحسابات: ${status.data?.socialAccountsCompleted ? "مكتمل" : "يمكن إكمال الربط لاحقًا"}`}</Text></View> : null}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

function LoadingScreen() {
  const theme = useAuthTheme();
  return (
    <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.primary} size="large" />
      <Text style={[styles.loadingText, { color: theme.mutedForeground }]}>
        جارٍ تجهيز الإعداد…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  loadingText: { fontSize: 15, lineHeight: 24, textAlign: "center" },
  retryInlineButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  retryInlineLabel: { fontSize: 14, fontWeight: "700" },
  closeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  closeRowText: { fontSize: 13, fontWeight: "700" },
  readOnlyNote: { fontSize: 13, lineHeight: 21, fontWeight: "600" },
  blob: { position: "absolute", borderRadius: 400 },
  blobTop: { width: 420, height: 420, top: -260, end: -150, opacity: 0.9 },
  blobBottom: {
    width: 560,
    height: 300,
    bottom: -190,
    start: -180,
    opacity: 0.55,
    transform: [{ rotate: "-8deg" }],
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  column: { width: "100%", gap: 14 },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  stepContent: {
    width: "100%",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  formStep: { width: "100%", alignItems: "center", gap: 12 },
  stepper: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  stepItem: { alignItems: "center", gap: 5, width: 92 },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumber: { fontSize: 13, fontWeight: "800" },
  stepLabel: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  connector: {
    flex: 1,
    minWidth: 24,
    height: 2,
    marginTop: 14,
    borderRadius: 1,
  },
  hero: { width: 112, height: 92 },
  title: {
    fontSize: 23,
    lineHeight: 34,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 2,
  },
  description: {
    fontSize: 14,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 360,
  },
  field: { width: "100%", gap: 8 },
  fieldLabel: { fontSize: 14, fontWeight: "800" },
  input: {
    width: "100%",
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "right",
  },
  select: { minHeight: 50, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  selectText: { flex: 1, fontSize: 14, textAlign: "right" },
  typeList: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  typeOption: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  infoBanner: { width: "100%", borderRadius: 12, padding: 12, flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 21, textAlign: "right" },
  error: { fontSize: 13.5, lineHeight: 20, textAlign: "center" },
  primaryButton: {
    width: "100%",
    minHeight: 54,
    marginTop: 4,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 5,
  },
  primaryButtonText: { fontSize: 15.5, fontWeight: "800" },
  secondaryButton: {
    width: "100%",
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryButtonText: { fontSize: 14.5, fontWeight: "800" },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  backText: { fontSize: 14, fontWeight: "700" },
});
