import React from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { ArrowRight } from "lucide-react-native";
import { Link } from "expo-router";
import { CairoText as Text } from "@/components/CairoTypography";
import { BrandMark } from "@/components/BrandMark";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useAuthTheme } from "@/hooks/useAuthTheme";

type AuthMode = "sign-in" | "sign-up";

export function AuthFrame({
  mode,
  title,
  subtitle,
  hero = false,
  children,
}: {
  mode: AuthMode;
  title: string;
  subtitle: string;
  /** Shows the mascot beside the heading (sign-in only). */
  hero?: boolean;
  children: React.ReactNode;
}) {
  const theme = useAuthTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const withHero = mode === "sign-in" && hero;
  const compact = width < 430;
  const mascotWidth = width < 360 ? 96 : compact ? 118 : 150;

  const brandRow = (
    <View style={withHero ? styles.brandRowHero : styles.brandRowCentered}>
      <BrandMark height={withHero ? (compact ? 22 : 26) : 34} />
      <Text
        style={[
          withHero ? (compact ? styles.brandNameHeroCompact : styles.brandNameHero) : styles.brandName,
          { color: theme.foreground },
        ]}
      >
        MenaFlow
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View
        pointerEvents="none"
        style={[styles.glowTop, { backgroundColor: theme.waveSoft }]}
      />
      <View
        pointerEvents="none"
        style={[styles.waveBack, { backgroundColor: theme.waveSoft }]}
      />
      <View
        pointerEvents="none"
        style={[styles.waveFront, { backgroundColor: theme.wave }]}
      />
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Platform.OS === "web" ? 20 : 10) + 12,
            paddingBottom: Math.max(insets.bottom, 24) + 12,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={32}
      >
        <View
          style={[
            styles.surface,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              shadowColor: theme.shadow,
            },
          ]}
        >
          {mode === "sign-up" ? (
            <Link href="/(auth)/sign-in" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="العودة إلى تسجيل الدخول"
                style={({ pressed }) => [
                  styles.backButton,
                  {
                    backgroundColor: theme.accent,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ArrowRight size={18} color={theme.accentForeground} />
              </Pressable>
            </Link>
          ) : null}

          {withHero ? (
            <View style={styles.heroRow}>
              <Image
                source={require("../assets/images/auth-mascot.png")}
                style={[styles.mascot, { width: mascotWidth, height: mascotWidth * 1.07 }]}
                resizeMode="contain"
                accessibilityLabel="شخصية MenaFlow ترحب بك"
              />
              <View style={styles.heroCopy}>
                {brandRow}
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.heroTitle,
                    compact && styles.heroTitleCompact,
                    { color: theme.foreground },
                  ]}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text
                    style={[
                      styles.heroSubtitle,
                      compact && styles.heroSubtitleCompact,
                      { color: theme.subtitle },
                    ]}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.heading}>
              {brandRow}
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.foreground }]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: theme.subtitle }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          )}

          <OfflineBanner />
          {children}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  card: { width: "100%", gap: 12 },
  label: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
    fontWeight: "700",
    marginBottom: -4,
  },
  inputRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputFocused: {
    borderWidth: 1.5,
    shadowColor: "#02A362",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  input: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 15,
    textAlign: "right",
    writingDirection: "rtl",
    outlineStyle: "none",
  } as never,
  ltrInput: {
    textAlign: "right",
    writingDirection: "ltr",
  },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
    shadowColor: "#02A362",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
  },
  secondaryText: { fontSize: 14, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 20, textAlign: "right" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
  },
  linkText: { fontSize: 13, fontWeight: "800" },
  hint: { fontSize: 13, lineHeight: 20, textAlign: "right" },
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  glowTop: {
    position: "absolute",
    width: 380,
    height: 380,
    borderRadius: 190,
    top: -230,
    end: -120,
    opacity: 0.85,
  },
  waveBack: {
    position: "absolute",
    width: 640,
    height: 260,
    borderRadius: 320,
    bottom: -150,
    start: -180,
    transform: [{ rotate: "-10deg" }],
    opacity: 0.85,
  },
  waveFront: {
    position: "absolute",
    width: 500,
    height: 200,
    borderRadius: 250,
    bottom: -120,
    end: -140,
    transform: [{ rotate: "8deg" }],
    opacity: 0.75,
  },
  surface: {
    width: "100%",
    maxWidth: 465,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    borderRadius: 28,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 8,
    gap: 14,
  },
  backButton: {
    position: "absolute",
    start: 16,
    top: 16,
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mascot: { flexShrink: 0 },
  heroCopy: { flex: 1, gap: 4, flexShrink: 1 },
  brandRowHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  brandRowCentered: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  brandName: { fontSize: 26, fontWeight: "900", letterSpacing: -0.6 },
  brandNameHero: { fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  brandNameHeroCompact: { fontSize: 17, fontWeight: "900", letterSpacing: -0.4 },
  heading: { alignItems: "center", gap: 6 },
  title: {
    fontSize: 25,
    lineHeight: 36,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 330,
  },
  heroTitle: {
    fontSize: 25,
    lineHeight: 36,
    fontWeight: "900",
    textAlign: "right",
  },
  heroTitleCompact: { fontSize: 21, lineHeight: 30 },
  heroSubtitle: {
    fontSize: 13.5,
    lineHeight: 22,
    textAlign: "right",
  },
  heroSubtitleCompact: { fontSize: 12.5, lineHeight: 20 },
});
