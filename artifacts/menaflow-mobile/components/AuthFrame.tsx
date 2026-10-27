import React from 'react';
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpRight, ChartNoAxesColumnIncreasing, MessageCircle, Sparkles } from 'lucide-react-native';
import { Link } from 'expo-router';
import { CairoText as Text } from '@/components/CairoTypography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

type AuthMode = 'sign-in' | 'sign-up';

function AuthArtwork({ compact = false }: { compact?: boolean }) {
  const colors = useColors();

  return (
    <View
      accessibilityLabel="مساعد MenaFlow الذكي"
      accessible
      style={[styles.artwork, compact && styles.compactArtwork]}
    >
      <View style={[styles.orbit, compact && styles.compactOrbit]} />
      <View style={[styles.orbitInner, compact && styles.compactOrbitInner]} />
      <View style={[styles.sparkle, styles.sparkleTop]}>
        <Sparkles size={compact ? 14 : 20} color={colors.primary} />
      </View>
      <View style={[styles.floatCard, styles.chartFloat, compact && styles.compactFloat]}>
        <ChartNoAxesColumnIncreasing size={compact ? 15 : 19} color={colors.primary} />
      </View>
      <View style={[styles.floatCard, styles.messageFloat, compact && styles.compactFloat]}>
        <MessageCircle size={compact ? 15 : 19} color={colors.primary} fill={colors.accent} />
      </View>
      <LinearGradient
        colors={['#E5FFF6', '#BDF6E4']}
        style={[styles.robotHalo, compact && styles.compactRobotHalo]}
      >
        <View style={[styles.robotEar, styles.robotEarLeft, compact && styles.compactRobotEar]} />
        <View style={[styles.robotEar, styles.robotEarRight, compact && styles.compactRobotEar]} />
        <View style={[styles.robotHead, compact && styles.compactRobotHead]}>
          <View style={[styles.robotFace, compact && styles.compactRobotFace]}>
            <View style={styles.robotEyes}>
              <View style={[styles.robotEye, compact && styles.compactRobotEye]} />
              <View style={[styles.robotEye, compact && styles.compactRobotEye]} />
            </View>
            <View style={[styles.robotSmile, compact && styles.compactRobotSmile]} />
          </View>
        </View>
        <View style={[styles.robotBody, compact && styles.compactRobotBody]}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.robotLogo}
            resizeMode="contain"
          />
        </View>
      </LinearGradient>
      {!compact ? (
        <View style={styles.artworkCaption}>
          <Text style={[styles.artworkCaptionTitle, { color: colors.foreground }]}>
            كل قنواتك، في مكان واحد
          </Text>
          <Text style={[styles.artworkCaptionText, { color: colors.mutedForeground }]}>
            خطّط لمحتواك وتابع أداءك بسهولة.
          </Text>
          <View style={styles.captionArrow}>
            <ArrowUpRight size={17} color={colors.primary} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function AuthFrame({
  mode,
  title,
  subtitle,
  children,
}: {
  mode: AuthMode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 760;

  return (
    <View style={[styles.root, { backgroundColor: '#F1FAFB' }]}>
      <View pointerEvents="none" style={styles.backgroundGlowTop} />
      <View pointerEvents="none" style={styles.backgroundGlowBottom} />
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 18 : 8) + 12,
            paddingBottom: Math.max(insets.bottom, 22) + 12,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={32}
      >
        <View style={[styles.surface, wide && styles.wideSurface]}>
          <View style={[styles.formColumn, wide && styles.wideFormColumn]}>
            <View style={styles.brand}>
              {mode === 'sign-up' ? (
                <Link href="/(auth)/sign-in" asChild>
                  <Pressable accessibilityLabel="العودة إلى تسجيل الدخول" style={styles.backButton}>
                    <ArrowUpRight size={18} color={colors.foreground} />
                  </Pressable>
                </Link>
              ) : null}
              <Image
                source={require('../assets/images/icon.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="شعار MenaFlow"
              />
              <Text style={[styles.brandName, { color: colors.foreground }]}>MenaFlow</Text>
            </View>

            <View style={[styles.headingRow, mode === 'sign-in' && styles.signInHeadingRow]}>
              <View style={[styles.heading, mode === 'sign-in' && styles.signInHeading]}>
                <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
              </View>
              {mode === 'sign-in' && !wide ? <AuthArtwork compact /> : null}
            </View>

            {children}
            <Text style={[styles.footer, { color: colors.mutedForeground }]}>
              دخول آمن إلى مساحة نشاطك الخاصة
            </Text>
          </View>

          {wide ? (
            <LinearGradient
              colors={['#F2FFFB', '#D9FBF0', '#C2F7E8']}
              style={styles.wideArtworkPanel}
            >
              <AuthArtwork />
            </LinearGradient>
          ) : null}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  card: { width: '100%', gap: 10 },
  label: { fontSize: 12, textAlign: 'right', fontWeight: '700' },
  inputRow: {
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    minHeight: 44,
    flex: 1,
    paddingHorizontal: 2,
    fontSize: 13,
    textAlign: 'right',
    outlineStyle: 'none',
  } as never,
  button: {
    minHeight: 47,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 16,
    marginTop: 3,
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#069969',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
  },
  secondaryText: { fontSize: 12, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  linkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 3,
  },
  linkText: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  backgroundGlowTop: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: '#E1F7F8',
    top: -215,
    right: -115,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    width: 520,
    height: 220,
    borderRadius: 260,
    backgroundColor: '#D5FFF0',
    bottom: -160,
    left: -170,
    transform: [{ rotate: '-12deg' }],
  },
  surface: {
    width: '100%',
    maxWidth: 465,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    backgroundColor: 'rgba(255,255,255,0.88)',
    shadowColor: '#487B81',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    elevation: 7,
  },
  wideSurface: {
    maxWidth: 1040,
    minHeight: 620,
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 12,
    borderRadius: 34,
  },
  formColumn: {
    width: '100%',
    alignSelf: 'center',
    gap: 17,
    maxWidth: 430,
    paddingHorizontal: 2,
    paddingTop: 8,
  },
  wideFormColumn: {
    flex: 1,
    maxWidth: 500,
    paddingHorizontal: 34,
    paddingVertical: 30,
    justifyContent: 'center',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 52,
  },
  logo: { width: 47, height: 42, borderRadius: 11 },
  brandName: { fontSize: 23, fontWeight: '900', letterSpacing: -0.7 },
  backButton: {
    position: 'absolute',
    left: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FC',
  },
  headingRow: { width: '100%' },
  signInHeadingRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 142,
  },
  heading: { alignItems: 'center', gap: 4, width: '100%' },
  signInHeading: { flex: 1, alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: '900', textAlign: 'center', lineHeight: 32 },
  subtitle: { fontSize: 12, lineHeight: 19, textAlign: 'center', maxWidth: 300 },
  artwork: {
    flex: 1,
    minHeight: 440,
    maxWidth: 460,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactArtwork: { flex: 0, width: 128, minHeight: 138, height: 138, marginRight: -2 },
  orbit: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  compactOrbit: { width: 124, height: 124, borderRadius: 62 },
  orbitInner: {
    position: 'absolute',
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 1,
    borderColor: 'rgba(10,167,122,0.13)',
  },
  compactOrbitInner: { width: 94, height: 94, borderRadius: 47 },
  robotHalo: {
    width: 206,
    height: 206,
    borderRadius: 103,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#20C995',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 4,
  },
  compactRobotHalo: { width: 104, height: 104, borderRadius: 52 },
  robotHead: {
    width: 116,
    height: 89,
    borderRadius: 29,
    backgroundColor: '#F9FFFD',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#128D70',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 1,
  },
  compactRobotHead: { width: 62, height: 49, borderRadius: 17, borderWidth: 2 },
  robotFace: {
    width: 83,
    height: 59,
    borderRadius: 19,
    backgroundColor: '#123266',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  compactRobotFace: { width: 45, height: 34, borderRadius: 12, gap: 4 },
  robotEyes: { flexDirection: 'row', gap: 19 },
  robotEye: { width: 7, height: 9, borderRadius: 5, backgroundColor: '#67F5D0' },
  compactRobotEye: { width: 4, height: 5 },
  robotSmile: {
    width: 14,
    height: 5,
    borderBottomWidth: 2,
    borderColor: '#67F5D0',
    borderRadius: 8,
  },
  compactRobotSmile: { width: 8, height: 3, borderBottomWidth: 1 },
  robotEar: {
    position: 'absolute',
    width: 23,
    height: 34,
    borderRadius: 12,
    top: 63,
    backgroundColor: '#07B984',
    borderWidth: 4,
    borderColor: '#8DE8CC',
  },
  compactRobotEar: {
    width: 12,
    height: 20,
    top: 33,
    borderRadius: 7,
    borderWidth: 2,
  },
  robotEarLeft: { left: 45 },
  robotEarRight: { right: 45 },
  robotBody: {
    width: 83,
    height: 50,
    marginTop: -9,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#D9F7EC',
  },
  compactRobotBody: { width: 48, height: 29, marginTop: -5, borderRadius: 16, borderWidth: 1 },
  robotLogo: { width: 29, height: 24 },
  sparkle: {
    position: 'absolute',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleTop: { top: '20%', right: '20%' },
  floatCard: {
    position: 'absolute',
    zIndex: 2,
    width: 48,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#E4F6F0',
    shadowColor: '#397B6A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  compactFloat: { width: 30, height: 28, borderRadius: 9 },
  chartFloat: { left: '12%', top: '37%' },
  messageFloat: { right: '10%', top: '28%' },
  artworkCaption: {
    position: 'absolute',
    bottom: 12,
    alignItems: 'center',
    gap: 3,
  },
  artworkCaptionTitle: { fontSize: 19, fontWeight: '800' },
  artworkCaptionText: { fontSize: 12 },
  captionArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideArtworkPanel: {
    flex: 1,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  footer: { fontSize: 10, textAlign: 'center', marginTop: 1 },
});
