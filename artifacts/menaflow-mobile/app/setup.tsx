import { useAuth } from "@clerk/expo";
import {
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  saveOnboardingProgress,
  updateWorkspaceCurrent,
  type OnboardingStatus,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutDashboard,
  Radio,
  Store,
  X,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BrandMark } from "@/components/BrandMark";
import { CairoText as Text } from "@/components/CairoTypography";
import { useAuthTheme } from "@/hooks/useAuthTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocalAuthDisabled } from "@/constants/auth";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import {
  canEditBusinessInfo,
  shouldArmSkipRetry,
  shouldReplayPendingSkip,
} from "@/lib/setup-flow";

/**
 * The concise post-signup setup that replaced the three intro slides.
 *
 * Step 1 collects the business name and type (saved through
 * `PATCH /workspaces/current` into the existing `mena_workspaces` columns).
 * Step 2 hands off to the channel funnel — with two exits, because setup must
 * never wall the product off: "اربط حسابك الآن" goes to `/connect-accounts`,
 * and "ادخل لوحة التحكم" goes straight to the dashboard. Both exits mark the
 * server-side onboarding completed through the existing `skip` action, so the
 * backend state machine (`mena_workspace_onboarding`) is untouched by this
 * redesign and the remaining setup lives in the dashboard checklist.
 *
 * The same screen doubles as the checklist's edit path: when onboarding is
 * already completed it shows only the business-info form.
 */
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

const steps = [
  { key: "business", label: "بيانات النشاط", icon: Store },
  { key: "channel", label: "ربط القنوات", icon: Radio },
] as const;

type StepKey = (typeof steps)[number]["key"];

export default function SetupRoute() {
  if (isLocalAuthDisabled) return <Redirect href="/(tabs)" />;
  return <AuthenticatedSetup />;
}

function AuthenticatedSetup() {
  const theme = useAuthTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  const {
    workspaces,
    activeWorkspaceId,
    isLoading: workspacesLoading,
    isError: workspacesError,
  } = useWorkspace();
  const isOffline = useNetworkStatus();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;

  const onboardingKey = getOnboardingStatusQueryKey(userId ?? null);
  const status = useQuery({
    queryKey: onboardingKey,
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(userId),
    retry: false,
  });
  const completed = status.data?.completed === true;

  const [step, setStep] = React.useState<StepKey>("business");
  const [name, setName] = React.useState("");
  const [businessType, setBusinessType] = React.useState<string | null>(null);
  const [nameTouched, setNameTouched] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  // Which exit the pending "skip" action should navigate to on success. It is
  // kept on failure too, so an automatic retry still knows where to land.
  const [pendingExit, setPendingExit] = React.useState<
    "connect" | "dashboard" | null
  >(null);
  // Set when `skip` failed *while offline*: the guard holds the merchant on
  // this screen until it lands, so the error copy promising an automatic retry
  // has to be true.
  const [awaitingRetry, setAwaitingRetry] = React.useState(false);

  // Prefill from the workspace once the list arrives; never overwrite input
  // the merchant already typed.
  React.useEffect(() => {
    if (!activeWorkspace) return;
    if (!nameTouched) setName(activeWorkspace.name ?? "");
    setBusinessType((current) => current ?? activeWorkspace.businessType ?? null);
  }, [activeWorkspace, nameTouched]);

  const invalidateWorkspaceList = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["workspace-list", userId ?? null],
    });
  }, [queryClient, userId]);

  // The form prefills from the workspace row (name + business type). While
  // that row is still on its way — or if the list query failed — an empty
  // form with an enabled-looking Save button is a trap: it looks as if the
  // merchant's business info had vanished. Show the honest state instead.
  const prefillPending = !activeWorkspace && workspacesLoading;
  const prefillFailed = !activeWorkspace && workspacesError;
  const retryWorkspaceList = React.useCallback(() => {
    setFormError(null);
    invalidateWorkspaceList();
  }, [invalidateWorkspaceList]);

  const save = useMutation({
    mutationFn: () =>
      updateWorkspaceCurrent({
        name: name.trim(),
        ...(businessType ? { businessType } : {}),
      }),
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
    },
    onError: () => {
      setFormError(
        "تعذّر حفظ بيانات النشاط. تحقق من اتصالك ثم أعد المحاولة.",
      );
    },
  });

  const finishSetup = useMutation({
    mutationFn: () => saveOnboardingProgress("skip"),
    onSuccess: (next: OnboardingStatus) => {
      queryClient.setQueryData(onboardingKey, next);
      invalidateWorkspaceList();
      const exit = pendingExit;
      setPendingExit(null);
      router.replace(exit === "connect" ? "/connect-accounts" : "/(tabs)");
    },
    onError: () => {
      // Only an offline failure is retried automatically — a server rejection
      // while online would otherwise retry in a loop. The exit buttons stay
      // enabled as the manual retry path in that case.
      setAwaitingRetry(shouldArmSkipRetry(isOffline));
      setFormError(
        isOffline
          ? "لا يوجد اتصال الآن. سنُكمل الإعداد تلقائيًا فور عودة الشبكة؛ بياناتك لم تتغير."
          : "تعذّر إنهاء الإعداد على الخادم. اضغط الزر مرة أخرى للمحاولة؛ بياناتك لم تتغير.",
      );
    },
  });

  // Honour that promise: replay the pending exit once the device comes back.
  const wasOffline = React.useRef(false);
  React.useEffect(() => {
    if (isOffline) {
      wasOffline.current = true;
      return;
    }
    const replay = shouldReplayPendingSkip({
      isOffline: false,
      wasOffline: wasOffline.current,
      awaitingRetry,
      pendingExit,
      requestInFlight: finishSetup.isPending,
    });
    if (!replay) {
      // A manual retry may already be in flight — keep the transition armed so
      // this effect replays it when that request settles. Drop the flag only
      // once there is genuinely nothing left to replay, so it cannot fire
      // spuriously much later.
      if (!finishSetup.isPending && !awaitingRetry) wasOffline.current = false;
      return;
    }
    wasOffline.current = false;
    setAwaitingRetry(false);
    setFormError(null);
    finishSetup.mutate();
  }, [isOffline, awaitingRetry, pendingExit, finishSetup]);

  if (!isLoaded || status.isLoading) return <LoadingScreen />;

  const compact = width < 400 || height < 700;
  const wide = width >= 900;
  const trimmedName = name.trim();
  // `PATCH /workspaces/current` is owner-only. The checklist step is hidden
  // from members, but `/setup` is reachable by path too — say so plainly
  // instead of letting the save fail with a generic server error.
  const readOnly = !canEditBusinessInfo(activeWorkspace);
  const canSave =
    trimmedName.length > 0 &&
    trimmedName.length <= 80 &&
    !save.isPending &&
    !readOnly;
  // In edit mode (onboarding already completed) only the form is shown.
  const activeIndex = completed ? 0 : step === "business" ? 0 : 1;
  const busy = save.isPending || finishSetup.isPending;

  // Edit mode is pushed from the dashboard checklist, and nothing on screen
  // said so: the only way out was the Save button or the system gesture.
  const handleCloseEdit = () => {
    if (busy) return;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const handleExit = (exit: "connect" | "dashboard") => {
    if (busy) return;
    setFormError(null);
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
          <View style={styles.brand}>
            <BrandMark height={compact ? 26 : 30} />
            <Text style={[styles.brandName, { color: theme.foreground }]}>
              MenaFlow
            </Text>
          </View>

          {completed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق بيانات النشاط"
              disabled={busy}
              onPress={handleCloseEdit}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeRow,
                {
                  backgroundColor: pressed ? theme.background : theme.card,
                  borderColor: theme.border,
                },
              ]}
            >
              <X size={15} color={theme.foreground} />
              <Text style={[styles.closeRowText, { color: theme.foreground }]}>
                إغلاق
              </Text>
            </Pressable>
          ) : null}

          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            {!completed ? <Stepper activeIndex={activeIndex} /> : null}

            {activeIndex === 0 ? (
              <View style={styles.formStep}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.foreground }]}
                >
                  {completed ? "بيانات نشاطك" : "أهلًا بك! لنجهّز نشاطك"}
                </Text>
                <Text
                  style={[styles.description, { color: theme.mutedForeground }]}
                >
                  {completed
                    ? "يمكنك تعديل اسم النشاط ونوعه في أي وقت."
                    : "خطوتان فقط: أخبرنا عن نشاطك، ثم اربط قناتك الأولى أو ادخل مباشرة."}
                </Text>

                {prefillPending ? (
                  <View style={styles.prefillState}>
                    <ActivityIndicator size="small" color={theme.primary} />
                    <Text
                      style={[
                        styles.prefillText,
                        { color: theme.mutedForeground },
                      ]}
                    >
                      جارٍ تحميل بيانات نشاطك…
                    </Text>
                  </View>
                ) : prefillFailed ? (
                  <View style={styles.prefillState}>
                    <Text
                      accessibilityRole="alert"
                      style={[styles.prefillText, { color: theme.destructive }]}
                    >
                      تعذّر تحميل بيانات نشاطك. تحقق من اتصالك ثم أعد المحاولة.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="إعادة محاولة تحميل بيانات النشاط"
                      onPress={retryWorkspaceList}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.secondaryButtonText,
                          { color: theme.foreground },
                        ]}
                      >
                        إعادة المحاولة
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {readOnly ? (
                      <Text
                        accessibilityRole="alert"
                        style={[
                          styles.prefillText,
                          { color: theme.mutedForeground },
                        ]}
                      >
                        تعديل بيانات النشاط متاح لمالك المساحة فقط.
                      </Text>
                    ) : null}

                    <View style={styles.field}>
                      <Text style={[styles.fieldLabel, { color: theme.foreground }]}>
                        اسم النشاط
                      </Text>
                      <TextInput
                        value={name}
                        onChangeText={(next) => {
                          setNameTouched(true);
                          setName(next);
                        }}
                        maxLength={80}
                        placeholder="مثال: كافيه الريحان"
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
                    </View>

                    <View style={styles.field}>
                      <Text style={[styles.fieldLabel, { color: theme.foreground }]}>
                        نوع النشاط
                      </Text>
                      <View style={styles.chips}>
                        {BUSINESS_TYPES.map((type) => {
                          const selected = businessType === type;
                          return (
                            <Pressable
                              key={type}
                              accessibilityRole="button"
                              accessibilityState={{
                                selected,
                                disabled: busy || readOnly,
                              }}
                              disabled={busy || readOnly}
                              onPress={() => setBusinessType(type)}
                              style={[
                                styles.chip,
                                {
                                  backgroundColor: selected
                                    ? theme.primary
                                    : theme.background,
                                  borderColor: selected
                                    ? theme.primary
                                    : theme.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  {
                                    color: selected
                                      ? theme.primaryForeground
                                      : theme.foreground,
                                  },
                                ]}
                              >
                                {type}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
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
                      accessibilityLabel={
                        readOnly
                          ? "حفظ التغييرات (متاح للمالك فقط)"
                          : "حفظ بيانات النشاط"
                      }
                      disabled={!canSave}
                      onPress={() => {
                        setFormError(null);
                        save.mutate();
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        {
                          backgroundColor: theme.primary,
                          opacity: !canSave ? 0.55 : pressed ? 0.88 : 1,
                          shadowColor: theme.primary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.primaryButtonText,
                          { color: theme.primaryForeground },
                        ]}
                      >
                        {save.isPending
                          ? "جارٍ الحفظ…"
                          : completed
                            ? "حفظ التغييرات"
                            : "حفظ ومتابعة"}
                      </Text>
                      <ArrowLeft size={18} color={theme.primaryForeground} />
                    </Pressable>
                  </>
                )}
              </View>
            ) : (
              <View style={styles.formStep}>
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
                      backgroundColor: theme.primary,
                      opacity: busy ? 0.55 : pressed ? 0.88 : 1,
                      shadowColor: theme.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: theme.primaryForeground },
                    ]}
                  >
                    ربط الآن
                  </Text>
                  <ArrowLeft size={18} color={theme.primaryForeground} />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: finishSetup.isPending }}
                  disabled={busy}
                  onPress={() => handleExit("dashboard")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.border,
                      opacity: busy ? 0.55 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <LayoutDashboard size={17} color={theme.foreground} />
                  <Text style={[styles.secondaryButtonText, { color: theme.foreground }]}>
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
            )}
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

function Stepper({ activeIndex }: { activeIndex: number }) {
  const theme = useAuthTheme();
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`الخطوة ${activeIndex + 1} من ${steps.length}`}
      accessibilityValue={{
        min: 1,
        max: steps.length,
        now: activeIndex + 1,
        text: `الخطوة ${activeIndex + 1} من ${steps.length}`,
      }}
    >
      {steps.map((item, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <React.Fragment key={item.key}>
            {index > 0 ? (
              <View
                style={[
                  styles.connector,
                  {
                    backgroundColor:
                      index <= activeIndex ? theme.primary : theme.border,
                  },
                ]}
              />
            ) : null}
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  done || current
                    ? { backgroundColor: theme.primary, borderColor: theme.primary }
                    : { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                {done ? (
                  <Check size={14} color={theme.primaryForeground} strokeWidth={3.2} />
                ) : (
                  <Text
                    style={[
                      styles.stepNumber,
                      {
                        color: current
                          ? theme.primaryForeground
                          : theme.mutedForeground,
                      },
                    ]}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: done || current ? theme.foreground : theme.mutedForeground,
                    fontWeight: current ? "800" : "600",
                  },
                ]}
                numberOfLines={2}
              >
                {item.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
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
  brandName: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  card: {
    width: "100%",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: "#0A2A63",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 6,
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
  stepLabel: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  connector: {
    flex: 1,
    minWidth: 24,
    height: 2,
    marginTop: 14,
    borderRadius: 1,
  },
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
  fieldLabel: { fontSize: 13.5, fontWeight: "800" },
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { fontSize: 13, fontWeight: "700" },
  error: { fontSize: 12.5, lineHeight: 20, textAlign: "center" },
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
  closeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  closeRowText: {
    fontFamily: "Cairo_600SemiBold",
    fontSize: 13,
  },
  prefillState: {
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 6,
  },
  prefillText: {
    fontFamily: "Cairo_500Medium",
    fontSize: 13,
    lineHeight: 21,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  backText: { fontSize: 13, fontWeight: "700" },
});
