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
  Clock3,
  MessageCircle,
  Send,
  Sparkles,
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
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocalAuthDisabled } from "@/constants/auth";

const slides = [
  {
    title: "منصتك الذكية لإدارة حساباتك الاجتماعية",
    description: "كل أدواتك في مكان واحد، لتوفر وقتك وجهدك وتزيد من تأثيرك.",
    artwork: "dashboard",
  },
  {
    title: "مساعدك الذكي لمحتوى علامتك",
    description:
      "أنشئ أفكارًا ومسودات لمحتواك بسهولة، وابدأ بخطوتك الإبداعية التالية.",
    artwork: "assistant",
  },
  {
    title: "محتواك ومنصاتك في مساحة واحدة",
    description: "جهّز منشوراتك وتابع حساباتك الاجتماعية من لوحة تحكم موحدة.",
    artwork: "publishing",
  },
] as const;

export default function OnboardingRoute() {
  if (isLocalAuthDisabled) return <Redirect href="/(tabs)" />;
  return <AuthenticatedOnboarding />;
}

function AuthenticatedOnboarding() {
  const colors = useColors();
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
  const compact = height < 760 || width < 380;
  const slide = status.data?.currentStep ?? 0;
  const currentSlide = slides[Math.min(slide, slides.length - 1)];
  const slideNumber = ["١", "٢", "٣"][Math.min(slide, slides.length - 1)];
  const background = colors.background;
  const completed = status.data?.completed === true;
  const continueToWorkspace = (socialSetupComplete: boolean) => {
    router.replace(
      socialSetupComplete ? "/(tabs)" : "/connect-accounts",
    );
  };
  const submitProgress = async (action: OnboardingAction) => {
    if (progress.isPending) return;
    try {
      const next = await progress.mutateAsync(action);
      if (next.completed) continueToWorkspace(next.socialAccountsCompleted);
    } catch {
      // The mutation state exposes a localized retry message below.
    }
  };

  if (!isLoaded) return <LoadingScreen />;
  if (status.isLoading) return <LoadingScreen />;
  if (status.isError || !status.data) {
    return (
      <MessageScreen
        title="تعذر تحميل الإعداد الأولي"
        description="تعذّر الاتصال بخادم التطبيق لاستعادة تقدمك. تأكد من تشغيل خادم API واتصالك بالشبكة، ثم أعد المحاولة."
        actionLabel="إعادة المحاولة"
        onPress={() => void status.refetch()}
        busy={status.isFetching}
      />
    );
  }
  if (completed) {
    return (
      <MessageScreen
        title="اكتمل الإعداد الأولي"
        description={
          status.data.socialAccountsCompleted
            ? "أصبحت مساحة العمل جاهزة. انتقل إلى لوحة التحكم للبدء."
            : "خطوة أخيرة: اربط حساباتك الاجتماعية لإكمال إعداد مساحة العمل."
        }
        actionLabel={
          status.data.socialAccountsCompleted
            ? "الانتقال إلى لوحة التحكم"
            : "ربط الحسابات الاجتماعية"
        }
        onPress={() => continueToWorkspace(status.data.socialAccountsCompleted)}
        busy={false}
      />
    );
  }

  const errorMessage = progress.isError
    ? "تعذر حفظ تقدمك. تحقق من اتصال الإنترنت وحاول مرة أخرى."
    : null;

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          styles.glowTop,
          { backgroundColor: colors.accent },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          styles.glowBottom,
          { backgroundColor: colors.greenSoft },
        ]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: Math.max(height, 680),
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              minHeight: compact ? 620 : 660,
            },
          ]}
        >
          <View style={styles.brand}>
            <View style={styles.brandIdentity}>
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="شعار MenaFlow"
              />
              <Text style={[styles.brandName, { color: colors.foreground }]}>
                MenaFlow
              </Text>
            </View>
            <View
              style={[
                styles.stepBadge,
                { backgroundColor: colors.accent, borderColor: colors.border },
              ]}
              accessibilityLabel={`الشريحة ${slide + 1} من ${slides.length}`}
            >
              <Text style={[styles.stepNumber, { color: colors.primary }]}>
                {slideNumber}
              </Text>
              <View
                style={[styles.stepDivider, { backgroundColor: colors.border }]}
              />
              <Text style={[styles.stepTotal, { color: colors.mutedForeground }]}>
                ٣
              </Text>
            </View>
          </View>

          <SlideArtwork kind={currentSlide.artwork} />

          <View style={styles.copy}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              {currentSlide.title}
            </Text>
            <Text
              style={[styles.description, { color: colors.mutedForeground }]}
            >
              {currentSlide.description}
            </Text>
          </View>

          <View
            style={styles.dots}
            accessibilityLabel={`الخطوة ${slide + 1} من ${slides.length}`}
          >
            {slides.map((item, index) => (
              <View
                key={item.artwork}
                accessibilityLabel={
                  index === slide ? "الخطوة الحالية" : undefined
                }
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === slide ? colors.primary : colors.border,
                  },
                  index === slide && styles.activeDot,
                ]}
              />
            ))}
          </View>

          {errorMessage ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.destructive }]}
            >
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: progress.isPending,
              busy: progress.isPending,
            }}
            disabled={progress.isPending}
            onPress={() => submitProgress("advance")}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.primary,
                opacity: progress.isPending ? 0.7 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {progress.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Text
                  style={[
                    styles.primaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {slide === slides.length - 1 ? "ابدأ الآن" : "التالي"}
                </Text>
                <ArrowLeft size={18} color={colors.primaryForeground} />
              </>
            )}
          </Pressable>

          <View style={styles.secondaryActions}>
            {slide > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="الخطوة السابقة"
                disabled={progress.isPending}
                onPress={() => submitProgress("back")}
                style={styles.backButton}
              >
                <ArrowRight size={16} color={colors.mutedForeground} />
                <Text
                  style={[styles.skipText, { color: colors.mutedForeground }]}
                >
                  السابق
                </Text>
              </Pressable>
            ) : (
              <View style={styles.backButton} />
            )}
            <Pressable
              accessibilityRole="button"
              disabled={progress.isPending}
              onPress={() => submitProgress("skip")}
              style={styles.skipButton}
            >
              <Text
                style={[styles.skipText, { color: colors.mutedForeground }]}
              >
                تخطي
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SlideArtwork({ kind }: { kind: (typeof slides)[number]["artwork"] }) {
  const colors = useColors();
  return (
    <View
      accessibilityLabel={
        kind === "dashboard"
          ? "لوحة تعرض حسابات التواصل وإحصاءات المحتوى"
          : kind === "assistant"
            ? "مساعد MenaFlow الذكي وأدوات إنشاء المحتوى"
            : "معاينة منشور وحسابات اجتماعية متصلة"
      }
      accessible
      style={[
        styles.artwork,
        { backgroundColor: colors.secondary, borderColor: colors.border },
      ]}
    >
      <View style={[styles.artHalo, { backgroundColor: colors.accent }]} />
      <View style={[styles.artOrbit, { borderColor: colors.border }]} />
      {kind === "dashboard" ? (
        <View style={styles.socialOrbit}>
          <PlatformBubble
            label="f"
            color="#3978D6"
            style={styles.platformFacebook}
          />
          <PlatformBubble
            label="◎"
            color="#C54898"
            style={styles.platformInstagram}
          />
          <PlatformBubble
            label="✦"
            color="#10A982"
            style={styles.platformWhatsapp}
          />
          <DashboardCard />
        </View>
      ) : kind === "assistant" ? (
        <View style={styles.assistantStage}>
          <View
            style={[
              styles.messageFloat,
              styles.messageFloatLeft,
              { backgroundColor: colors.card },
            ]}
          >
            <MessageCircle size={22} color={colors.primary} />
          </View>
          <View
            style={[styles.clockBadge, { backgroundColor: colors.primary }]}
          >
            <Clock3 size={25} color="#FFFFFF" />
            <Text style={styles.clockText}>AI</Text>
          </View>
          <RobotIllustration />
          <View
            style={[
              styles.messageFloat,
              styles.messageFloatRight,
              { backgroundColor: colors.card },
            ]}
          >
            <Sparkles size={22} color={colors.primary} />
          </View>
        </View>
      ) : (
        <View style={styles.phoneStage}>
          <PlatformBubble
            label="f"
            color="#3978D6"
            style={styles.phoneFacebook}
          />
          <PlatformBubble
            label="◎"
            color="#C54898"
            style={styles.phoneInstagram}
          />
          <PlatformBubble
            label="↗"
            color="#10A982"
            style={styles.phoneWhatsapp}
          />
          <View
            style={[
              styles.phone,
              { backgroundColor: colors.card, borderColor: colors.foreground },
            ]}
          >
            <View
              style={[
                styles.phoneSpeaker,
                { backgroundColor: colors.foreground },
              ]}
            />
            <View
              style={[styles.postImage, { backgroundColor: colors.accent }]}
            >
              <View style={styles.postImageSun} />
              <View
                style={[styles.postHillBack, { backgroundColor: "#76D9B7" }]}
              />
              <View
                style={[
                  styles.postHillFront,
                  { backgroundColor: colors.primary },
                ]}
              />
            </View>
            <View
              style={[styles.postLine, { backgroundColor: colors.border }]}
            />
            <View
              style={[styles.postLineShort, { backgroundColor: colors.border }]}
            />
            <View
              style={[styles.postAction, { backgroundColor: colors.primary }]}
            >
              <Send size={15} color="#FFFFFF" />
              <Text style={styles.postActionText}>منشور جاهز</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function PlatformBubble({
  label,
  color,
  style,
}: {
  label: string;
  color: string;
  style: object;
}) {
  return (
    <View style={[styles.platformBubble, style, { backgroundColor: color }]}>
      <Text style={styles.platformLabel}>{label}</Text>
    </View>
  );
}

function DashboardCard() {
  const colors = useColors();
  return (
    <View
      style={[
        styles.dashboard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.dashboardHeader, { backgroundColor: colors.accent }]}
      >
        <View
          style={[styles.dashboardLogo, { backgroundColor: colors.primary }]}
        >
          <Sparkles size={17} color="#FFFFFF" />
        </View>
        <View style={styles.dashboardTitleLines}>
          <View
            style={[
              styles.dashboardLine,
              { backgroundColor: colors.foreground },
            ]}
          />
          <View
            style={[
              styles.dashboardLineSmall,
              { backgroundColor: colors.mutedForeground },
            ]}
          />
        </View>
        <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
          <Check size={14} color="#FFFFFF" />
        </View>
      </View>
      <View style={styles.chartRow}>
        <View
          style={[
            styles.chartBar,
            { height: 32, backgroundColor: colors.accent },
          ]}
        />
        <View
          style={[
            styles.chartBar,
            { height: 48, backgroundColor: colors.primary },
          ]}
        />
        <View
          style={[
            styles.chartBar,
            { height: 38, backgroundColor: colors.accent },
          ]}
        />
        <View
          style={[
            styles.chartBar,
            { height: 64, backgroundColor: colors.primary },
          ]}
        />
        <View
          style={[
            styles.chartBar,
            { height: 52, backgroundColor: colors.accent },
          ]}
        />
        <BarChart3 size={22} color={colors.primary} />
      </View>
    </View>
  );
}

function RobotIllustration() {
  const colors = useColors();
  return (
    <LinearGradient
      colors={[colors.accent, colors.greenSoft]}
      style={styles.robotHalo}
    >
      <View style={[styles.robotEar, styles.robotEarLeft]} />
      <View style={[styles.robotEar, styles.robotEarRight]} />
      <View style={styles.robotHead}>
        <View style={styles.robotEyes}>
          <View style={styles.robotEye} />
          <View style={styles.robotEye} />
        </View>
        <View style={styles.robotSmile} />
      </View>
      <View style={[styles.robotBody, { backgroundColor: colors.primary }]}>
        <Sparkles size={21} color="#FFFFFF" />
      </View>
    </LinearGradient>
  );
}

function LoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.messageRoot, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text
        style={[styles.messageDescription, { color: colors.mutedForeground }]}
      >
        جارٍ استعادة تقدم الإعداد…
      </Text>
    </View>
  );
}

function MessageScreen({
  title,
  description,
  actionLabel,
  onPress,
  busy,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
  busy: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.messageRoot, { backgroundColor: colors.background }]}>
      <Text style={[styles.messageTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text
        style={[styles.messageDescription, { color: colors.mutedForeground }]}
      >
        {description}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={onPress}
        style={[
          styles.primaryButton,
          { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  glow: {
    position: "absolute",
    width: 350,
    height: 350,
    borderRadius: 175,
  },
  glowTop: { top: -235, left: -130 },
  glowBottom: { bottom: -250, right: -125 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    paddingHorizontal: 22,
    paddingTop: 15,
    paddingBottom: 22,
    borderWidth: 1,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    shadowColor: "#2B7899",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  brand: {
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  brandIdentity: { flexDirection: "row", alignItems: "center", gap: 7 },
  logo: { width: 43, height: 38 },
  brandName: { fontSize: 18, fontWeight: "900" },
  stepBadge: {
    minWidth: 58,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  stepNumber: { fontSize: 12, fontWeight: "900" },
  stepDivider: { width: 1, height: 13 },
  stepTotal: { fontSize: 11, fontWeight: "700" },
  artwork: {
    width: "100%",
    minHeight: 245,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
    borderRadius: 26,
    borderWidth: 1,
    overflow: "hidden",
  },
  artHalo: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 115,
    opacity: 0.78,
  },
  artOrbit: {
    position: "absolute",
    width: 195,
    height: 195,
    borderRadius: 98,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  socialOrbit: {
    width: 250,
    height: 225,
    alignItems: "center",
    justifyContent: "center",
  },
  platformBubble: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#10356A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
  platformLabel: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  platformFacebook: { top: 21, left: 0 },
  platformInstagram: { top: 0, right: 41 },
  platformWhatsapp: { bottom: 4, right: 6 },
  dashboard: {
    width: 190,
    height: 142,
    borderWidth: 1,
    borderRadius: 22,
    padding: 12,
    justifyContent: "space-between",
    transform: [{ rotate: "-5deg" }],
    shadowColor: "#174E4A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 4,
  },
  dashboardHeader: {
    height: 50,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
  },
  dashboardLogo: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dashboardTitleLines: { flex: 1, gap: 5 },
  dashboardLine: { width: 64, height: 5, borderRadius: 4 },
  dashboardLineSmall: { width: 43, height: 4, borderRadius: 4, opacity: 0.65 },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chartRow: {
    height: 60,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    gap: 6,
  },
  chartBar: { width: 15, borderRadius: 6 },
  assistantStage: {
    width: 260,
    height: 235,
    alignItems: "center",
    justifyContent: "center",
  },
  robotHalo: {
    width: 166,
    height: 166,
    borderRadius: 83,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#20C995",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 4,
  },
  robotEar: {
    position: "absolute",
    top: 55,
    width: 20,
    height: 31,
    borderRadius: 11,
    backgroundColor: "#07B984",
    borderColor: "#8DE8CC",
    borderWidth: 4,
  },
  robotEarLeft: { left: 28 },
  robotEarRight: { right: 28 },
  robotHead: {
    width: 97,
    height: 75,
    borderRadius: 27,
    borderColor: "#FFFFFF",
    borderWidth: 4,
    backgroundColor: "#123266",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    zIndex: 1,
  },
  robotEyes: { flexDirection: "row", gap: 24 },
  robotEye: {
    width: 8,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#67F5D0",
  },
  robotSmile: {
    width: 17,
    height: 7,
    borderBottomWidth: 2,
    borderColor: "#67F5D0",
    borderRadius: 9,
  },
  robotBody: {
    width: 80,
    height: 45,
    marginTop: -10,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  messageFloat: {
    position: "absolute",
    width: 51,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#174E4A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  messageFloatLeft: { top: 42, left: 8 },
  messageFloatRight: { right: 3, bottom: 43 },
  clockBadge: {
    position: "absolute",
    top: 4,
    right: 45,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    borderWidth: 4,
    borderColor: "#FFFFFF",
  },
  clockText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    marginTop: -3,
  },
  phoneStage: {
    width: 260,
    height: 235,
    alignItems: "center",
    justifyContent: "center",
  },
  phone: {
    width: 137,
    height: 213,
    borderRadius: 27,
    borderWidth: 4,
    padding: 11,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 9,
    transform: [{ rotate: "5deg" }],
    shadowColor: "#123266",
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.13,
    shadowRadius: 13,
    elevation: 4,
  },
  phoneSpeaker: { width: 38, height: 5, borderRadius: 4, marginBottom: 3 },
  postImage: {
    width: "100%",
    height: 83,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    padding: 9,
  },
  postImageSun: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F7D879",
  },
  postHillBack: {
    position: "absolute",
    width: 84,
    height: 46,
    borderRadius: 22,
    bottom: -20,
    left: -5,
    transform: [{ rotate: "-18deg" }],
  },
  postHillFront: {
    position: "absolute",
    width: 87,
    height: 38,
    borderRadius: 20,
    bottom: -19,
    right: -13,
    transform: [{ rotate: "13deg" }],
  },
  postLine: {
    width: "91%",
    height: 5,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  postLineShort: {
    width: "58%",
    height: 5,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  postAction: {
    width: "100%",
    height: 30,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 2,
  },
  postActionText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  phoneFacebook: { top: 44, left: 3 },
  phoneInstagram: { top: 6, right: 28 },
  phoneWhatsapp: { bottom: 20, right: 7 },
  copy: {
    width: "100%",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 8,
    paddingTop: 3,
  },
  title: {
    fontSize: 21,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
  },
  description: {
    alignSelf: "stretch",
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 320,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginVertical: 17,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  activeDot: { width: 11, height: 11 },
  error: { fontSize: 12, lineHeight: 19, textAlign: "left", marginBottom: 8 },
  primaryButton: {
    width: "100%",
    minHeight: 48,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#07865F",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.17,
    shadowRadius: 9,
    elevation: 3,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  secondaryActions: {
    width: "100%",
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    minWidth: 60,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  skipButton: {
    minWidth: 60,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { fontSize: 13, fontWeight: "600" },
  messageRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 15,
  },
  messageTitle: { fontSize: 21, fontWeight: "900", textAlign: "center" },
  messageDescription: { fontSize: 13, lineHeight: 21, textAlign: "left" },
});
