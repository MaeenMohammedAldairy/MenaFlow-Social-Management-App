import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

export function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop:
            Platform.OS === 'web'
              ? Math.max(insets.top, 38) + 18
              : insets.top + 18,
          paddingBottom: Math.max(insets.bottom, 24) + 18,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bottomOffset={32}
    >
      <View style={styles.brand}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="شعار MenaFlow"
        />
        <Text style={[styles.brandName, { color: colors.foreground }]}>MenaFlow</Text>
      </View>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      {children}
      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        دخول آمن إلى مساحة نشاطك الخاصة
      </Text>
    </KeyboardAwareScrollViewCompat>
  );
}

export const authStyles = StyleSheet.create({
  card: { width: '100%', gap: 12 },
  label: { fontSize: 12, textAlign: 'right', fontWeight: '700' },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 14,
    textAlign: 'right',
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  secondaryText: { fontSize: 12, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  linkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 4,
  },
  linkText: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 22,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  brand: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8 },
  logo: { width: 39, height: 39, borderRadius: 12 },
  brandName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.6 },
  heading: { alignItems: 'center', gap: 7 },
  title: { fontSize: 23, fontWeight: '900', textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  footer: { fontSize: 11, textAlign: 'center' },
});
