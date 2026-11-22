import { useAuth } from "@clerk/expo";
import {
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  saveOnboardingProgress,
  type OnboardingAction,
} from "@workspace/api-client-react";
import type { OnboardingStatus } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Headphones,
  ShieldCheck,
  Zap,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BrandMark } from "@/components/BrandMark";
import { CairoText as Text } from "@/components/CairoTypography";
import { useAuthTheme } from "@/hooks/useAuthTheme";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocalAuthDisabled } from "@/constants/auth";

/**
 * Onboarding intro, shown to a brand-new account right after the email is
 * confirmed. The three slides, the server-side progress sync and the hand-off to
 * the account connection screen are unchanged — only the presentation follows the
 * MenaFlow onboarding artwork (stepper, mascot illustrations, mint surfaces).
 */
const slides = [
  {
    title: "قنواتك ومحادثاتك في مساحة واحدة",
    description:
      "فيسبوك وإنستغرام وواتساب: المحتوى والرسائل والطلبات تُدار من مكان واحد.",
    artwork: "space",
    stepLabel: "مساحة العمل",
    image: require("../assets/images/onboarding-space.png"),
    accessibilityLabel: "شخصية MenaFlow تحييك أمام حاسوبها",
  },
  {
    title: "رسالة عميل… تصبح محتوى جاهزًا",
    description:
      "حوّل رسالة أو تعليقًا إلى مسودة منشور، واستعن بالمساعد الذكي لصياغتها.",
    artwork: "content",
    stepLabel: "المحتوى الذكي",
    image: require("../assets/images/onboarding-content.png"),
    accessibilityLabel: "شخصية MenaFlow تصل الحسابات وتربط المحادثات",
  },
  {
    title: "خطوة واحدة تفصلك عن البدء",
    description:
      "اربط صفحتك أو واتساب أعمال، وسنحوّل أول رسالة إلى مسودة جاهزة للمراجعة.",
    artwork: "ready",
    stepLabel: "الربط والانطلاق",
    image: require("../assets/images/onboarding-ready.png"),
    accessibilityLabel: "شخصية MenaFlow تحتفل بإتمام الإعداد",
  },
] as const;

const trustItems = [
  { label: "أمان عالٍ\nوحماية بياناتك", icon: ShieldCheck },
  { label: "دعم عبر واتساب\nمن فريق حقيقي", icon: Headphones },
  { label: "إعداد سريع\nفي دقائق", icon: Zap },
  { label: "منصة متكاملة\nلنمو أعمالك", icon: BarChart3 },
] as const;

export default function OnboardingRoute() {
  if (isLocalAuthDisabled) return <Redirect href="/(tabs)" />;
  return <AuthenticatedOnboarding />;
}

function AuthenticatedOnboarding() {
  const theme = useAuthTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = getOnboardingStatusQueryKey(userId ?? null);
  const status = useQuery({
    queryKey,
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(userId),
    retry: false,
  });
  const progress = useMutation({
    mutationFn: (action: OnboardingAction) => saveOnboardingProgress(action),
    onSuccess: (next: OnboardingStatus) => {
      queryClient.setQueryData(queryKey, next);
    },
  });
  const compact = width < 400 || height < 700;
  const wide = width >= 900;
  const offline = useNetworkStatus();
  // The intro is static content, so it advances locally and syncs in the
  // background; a flaky connection must never trap the user on slide one.
  const [localStep, setLocalStep] = React.useState<number | null>(null);
  const [pendingAction, setPendingAction] =
    React.useState<OnboardingAction | null>(null);
  const statusUnavailable = status.isError || !status.data;
  const serverStep = status.data?.currentStep ?? 0;
  const slide = Math.min(localStep ?? serverStep, slides.length - 1);
  const currentSlide = slides[slide];
  const completed = status.data?.completed === true;
  const continueToWorkspace = (socialSetupComplete: boolean) => {
    router.replace(
      socialSetupComplete ? "/(tabs)" : "/connect-accounts",
    );
  };
  const syncProgress = async (action: OnboardingAction) => {
    setPendingAction(action);
    try {
      const next = await progress.mutateAsync(action);
      setPendingAction(null);
      if (next.completed) {
        continueToWorkspace(next.socialAccountsCompleted);
        return;
      }
      setLocalStep(next.currentStep);
    } catch {
      // Keep the local step and retry once connectivity returns.
    }
  };
  const goToStep = (nextStep: number) => {
    setLocalStep(Math.max(0, Math.min(nextStep, slides.length - 1)));
  };
  // The API only accepts deltas, so presses are queued: two fast taps must
  // reach the server in order instead of racing and skipping a slide.
  const syncChain = React.useRef<Promise<void>>(Promise.resolve());
  const queueSync = (action: OnboardingAction) => {
    syncChain.current = syncChain.current.then(() => syncProgress(action));
  };
  const handleAdvance = () => {
    if (slide < slides.length - 1) goToStep(slide + 1);
    queueSync("advance");
  };
  const handleBack = () => {
    goToStep(slide - 1);
    queueSync("back");
  };
  const handleSkip = () => {
    continueToWorkspace(status.data?.socialAccountsCompleted ?? false);
    queueSync("skip");
  };
  React.useEffect(() => {
    if (offline || !pendingAction) return;
    queueSync(pendingAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  if (!isLoaded) return <LoadingScreen />;
  if (status.isLoading) return <LoadingScreen />;
  if (completed) {
    return (
      <Redirect
        href={
          status.data?.socialAccountsCompleted ? "/(tabs)" : "/connect-accounts"
        }
      />
    );
  }

  const errorMessage = statusUnavailable
    ? "تعذّر تحميل تقدّمك من الخادم. يمكنك متابعة المقدمة الآن وستُزامَن لاحقًا."
    : pendingAction
      ? "لم يُحفظ تقدّمك على الخادم بعد؛ سنعيد المحاولة عند عودة الاتصال."
      : null;

  const primaryLabel =
    slide === slides.length - 1
      ? status.data?.socialAccountsCompleted
        ? "ابدأ الآن"
        : "ربط حساباتك"
      : "التالي";

  // Short phones get a smaller illustration so the primary action stays above
  // the fold on a 640pt-tall screen.
  const artworkSize = height < 640 ? 150 : compact ? 190 : wide ? 260 : 225;

  return (
    <LinearGradient
      colors={[theme.card, theme.background]}
      style={styles.root}
    >
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

          <View
            style={[
              styles.card,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.counter, { color: theme.mutedForeground }]}>
              الخطوة {slide + 1} من {slides.length}
            </Text>

            <Stepper activeIndex={slide} />

            <Image
              source={currentSlide.image}
              style={{ width: artworkSize, height: artworkSize * 1.03 }}
              resizeMode="contain"
              accessibilityLabel={currentSlide.accessibilityLabel}
            />

            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.foreground }]}
            >
              {currentSlide.title}
            </Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>
              {currentSlide.description}
            </Text>

            {errorMessage ? (
              <Text
                accessibilityRole="alert"
                style={[styles.error, { color: theme.destructive }]}
              >
                {errorMessage}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={handleAdvance}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.88 : 1,
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
                {primaryLabel}
              </Text>
              <ArrowLeft size={18} color={theme.primaryForeground} />
            </Pressable>

            <View style={styles.secondaryActions}>
              {slide > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="الخطوة السابقة"
                  onPress={handleBack}
                  style={({ pressed }) => [
                    styles.backButton,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <ArrowRight size={16} color={theme.mutedForeground} />
                  <Text style={[styles.backText, { color: theme.mutedForeground }]}>
                    السابق
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.backPlaceholder} />
              )}
              <Pressable
                accessibilityRole="button"
                onPress={handleSkip}
                style={styles.skipButton}
                hitSlop={6}
              >
                <Text style={[styles.skipText, { color: theme.link }]}>
                  تخطي المقدمة
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.trustBar, compact && styles.trustBarCompact]}>
            {trustItems.map((item) => (
              <View
                key={item.label}
                style={[
                  styles.trustItem,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                  compact && styles.trustItemCompact,
                ]}
              >
                <View style={[styles.trustIcon, { backgroundColor: theme.accent }]}>
                  <item.icon size={18} color={theme.accentForeground} />
                </View>
                <Text style={[styles.trustLabel, { color: theme.foreground }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

/**
 * Numbered journey rail: completed steps become green ticks, the current step is
 * filled, upcoming steps stay neutral. Mirrors the reference artwork and stays
 * readable from three steps up.
 */
function Stepper({ activeIndex }: { activeIndex: number }) {
  const theme = useAuthTheme();
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`الخطوة ${activeIndex + 1} من ${slides.length}`}
      accessibilityValue={{
        min: 1,
        max: slides.length,
        now: activeIndex + 1,
        text: `الخطوة ${activeIndex + 1} من ${slides.length}`,
      }}
    >
      {slides.map((item, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <React.Fragment key={item.artwork}>
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
                {item.stepLabel}
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
        جارٍ استعادة تقدم الإعداد…
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
  blob: {
    position: "absolute",
    borderRadius: 400,
  },
  blobTop: {
    width: 420,
    height: 420,
    top: -260,
    end: -150,
    opacity: 0.9,
  },
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
  counter: { fontSize: 12.5, fontWeight: "600" },
  stepper: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  stepItem: { alignItems: "center", gap: 5, width: 74 },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumber: { fontSize: 13, fontWeight: "800" },
  stepLabel: { fontSize: 10.5, lineHeight: 15, textAlign: "center" },
  connector: {
    flex: 1,
    minWidth: 12,
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
    maxWidth: 330,
  },
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
  secondaryActions: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  backText: { fontSize: 13, fontWeight: "700" },
  backPlaceholder: { width: 1 },
  skipButton: { paddingVertical: 8, paddingHorizontal: 4 },
  skipText: { fontSize: 13, fontWeight: "800" },
  trustBar: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  trustBarCompact: { flexWrap: "wrap" },
  trustItem: {
    flex: 1,
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  trustItemCompact: { flexBasis: "47%", flexGrow: 1, flexShrink: 0 },
  trustIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  trustLabel: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
