import React from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { Link } from 'expo-router';
import { CairoText as Text } from '@/components/CairoTypography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

type AuthMode = 'sign-in' | 'sign-up';

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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        pointerEvents="none"
        style={[styles.backgroundGlowTop, { backgroundColor: colors.accent }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.backgroundGlowBottom,
          { backgroundColor: colors.greenSoft },
        ]}
      />
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
        <View
          style={[
            styles.surface,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.foreground,
            },
          ]}
        >
          <View style={styles.formColumn}>
            <View style={styles.brand}>
              {mode === 'sign-up' ? (
                <Link href="/(auth)/sign-in" asChild>
                  <Pressable accessibilityLabel="العودة إلى تسجيل الدخول" style={styles.backButton}>
                    <ArrowRight size={18} color={colors.foreground} />
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

            <View style={styles.headingRow}>
              <View style={styles.heading}>
                <Text
                  style={[
                    styles.title,
                    mode === 'sign-in' && styles.signInTitle,
                    { color: colors.foreground },
                  ]}
                >
                  {title}
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    mode === 'sign-in' && styles.signInSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {subtitle}
                </Text>
              </View>
            </View>

            {children}
            <Text style={[styles.footer, { color: colors.mutedForeground }]}>
              دخول آمن إلى مساحة نشاطك الخاصة
            </Text>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  card: { width: '100%', gap: 10 },
  label: { fontSize: 14, textAlign: 'right', fontWeight: '700' },
  inputRow: {
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputFocused: {
    borderWidth: 2,
    shadowColor: '#069969',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    minHeight: 44,
    flex: 1,
    paddingHorizontal: 2,
    fontSize: 16,
    textAlign: 'right',
    writingDirection: 'rtl',
    outlineStyle: 'none',
  } as never,
  ltrInput: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
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
  secondaryText: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 14, lineHeight: 21, textAlign: 'left' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 3,
  },
  linkText: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 14, lineHeight: 21, textAlign: 'left' },
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
    top: -215,
    right: -115,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    width: 520,
    height: 220,
    borderRadius: 260,
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
  formColumn: {
    width: '100%',
    alignSelf: 'center',
    gap: 17,
    maxWidth: 430,
    paddingHorizontal: 2,
    paddingTop: 8,
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
    start: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FC',
  },
  headingRow: { width: '100%' },
  heading: { alignItems: 'center', gap: 4, width: '100%' },
  title: { fontSize: 22, fontWeight: '900', textAlign: 'center', lineHeight: 32 },
  subtitle: {
    alignSelf: 'stretch',
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'left',
    maxWidth: 300,
  },
  signInTitle: { alignSelf: 'stretch', textAlign: 'right' },
  signInSubtitle: { alignSelf: 'stretch', textAlign: 'left' },
  footer: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 1 },
});
