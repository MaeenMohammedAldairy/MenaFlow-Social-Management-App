import { useSignIn, useAuth } from '@clerk/expo';
import { Link, Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { Panel } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const loading = fetchStatus === 'fetching';

  if (isSignedIn) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    setErrorMessage('');
    const { error } = await signIn.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (error) {
      setErrorMessage(error.message || 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مجدداً.');
      return;
    }
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: () => router.replace('/(tabs)'),
      });
    } else if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') {
      setErrorMessage('يتطلب هذا الحساب خطوة تحقق إضافية. أكمل التحقق من إعدادات الحساب ثم أعد المحاولة.');
    }
  };

  return (
    <AuthFrame title="مرحباً بعودتك" subtitle="سجّل الدخول للوصول إلى مساحة عملك.">
      <Panel style={[authStyles.card, styles.panel]}>
        <Text style={[authStyles.label, { color: colors.foreground }]}>البريد الإلكتروني</Text>
        <TextInput
          value={emailAddress}
          onChangeText={setEmailAddress}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="name@example.com"
          placeholderTextColor={colors.mutedForeground}
          style={[authStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          accessibilityLabel="البريد الإلكتروني"
        />
        <Text style={[authStyles.label, { color: colors.foreground }]}>كلمة المرور</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry
          placeholder="أدخل كلمة المرور"
          placeholderTextColor={colors.mutedForeground}
          style={[authStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          accessibilityLabel="كلمة المرور"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {errorMessage ? <Text accessibilityRole="alert" style={[authStyles.error, { color: colors.destructive }]}>{errorMessage}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!emailAddress.trim() || !password || loading}
          style={[authStyles.button, { backgroundColor: colors.primary, opacity: !emailAddress.trim() || !password || loading ? 0.55 : 1 }]}
        >
          <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>{loading ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}</Text>
        </Pressable>
        <View style={authStyles.linkRow}>
          <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>أول مرة تستخدم التطبيق؟</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable><Text style={[authStyles.linkText, { color: colors.primary }]}>إنشاء حساب المالك</Text></Pressable>
          </Link>
        </View>
      </Panel>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 11 },
});
