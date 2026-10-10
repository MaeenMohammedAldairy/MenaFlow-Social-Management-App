import { useAuth, useSignUp } from '@clerk/expo';
import { Link, Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { Panel } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

export default function SignUpScreen() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const { signUp, fetchStatus } = useSignUp();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const loading = fetchStatus === 'fetching';

  if (isSignedIn) return <Redirect href="/(tabs)" />;

  const startSignUp = async () => {
    setErrorMessage('');
    const { error } = await signUp.password({
      emailAddress: emailAddress.trim(),
      password,
    });
    if (error) {
      setErrorMessage(error.message || 'تعذر إنشاء الحساب. تحقق من البريد وكلمة المرور.');
      return;
    }
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) {
      setErrorMessage(sent.error.message || 'تعذر إرسال رمز التحقق إلى البريد.');
      return;
    }
    setVerificationSent(true);
  };

  const verifyCode = async () => {
    setErrorMessage('');
    const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (error) {
      setErrorMessage(error.message || 'رمز التحقق غير صحيح أو انتهت صلاحيته.');
      return;
    }
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: () => router.replace('/(tabs)'),
      });
    } else {
      setErrorMessage('لم يكتمل التحقق. أعد المحاولة أو اطلب رمزاً جديداً.');
    }
  };

  return (
    <AuthFrame
      title={verificationSent ? 'تحقق من بريدك' : 'إنشاء حساب المالك'}
      subtitle={verificationSent ? 'أدخل رمز التحقق الذي أرسلناه إلى بريدك الإلكتروني.' : 'أنشئ حساباً واحداً للوصول إلى مساحة نشاطك.'}
    >
      <Panel style={[authStyles.card, styles.panel]}>
        {verificationSent ? (
          <>
            <Text style={[authStyles.label, { color: colors.foreground }]}>رمز التحقق</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="أدخل الرمز"
              placeholderTextColor={colors.mutedForeground}
              style={[authStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityLabel="رمز التحقق"
            />
            <Pressable
              accessibilityRole="button"
              onPress={verifyCode}
              disabled={!code.trim() || loading}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: !code.trim() || loading ? 0.55 : 1 }]}
            >
              <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>{loading ? 'جارٍ التحقق…' : 'تأكيد البريد'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => signUp.verifications.sendEmailCode()} style={authStyles.secondaryButton}>
              <Text style={[authStyles.secondaryText, { color: colors.primary }]}>إرسال رمز جديد</Text>
            </Pressable>
          </>
        ) : (
          <>
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
              autoComplete="new-password"
              textContentType="newPassword"
              secureTextEntry
              placeholder="أنشئ كلمة مرور قوية"
              placeholderTextColor={colors.mutedForeground}
              style={[authStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              accessibilityLabel="كلمة المرور"
            />
            <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>سيُرسل رمز تأكيد إلى بريدك قبل تفعيل الحساب.</Text>
            <View nativeID="clerk-captcha" />
            <Pressable
              accessibilityRole="button"
              onPress={startSignUp}
              disabled={!emailAddress.trim() || password.length < 8 || loading}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: !emailAddress.trim() || password.length < 8 || loading ? 0.55 : 1 }]}
            >
              <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>{loading ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}</Text>
            </Pressable>
          </>
        )}
        {errorMessage ? <Text accessibilityRole="alert" style={[authStyles.error, { color: colors.destructive }]}>{errorMessage}</Text> : null}
        <View style={authStyles.linkRow}>
          <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>لديك حساب بالفعل؟</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable><Text style={[authStyles.linkText, { color: colors.primary }]}>تسجيل الدخول</Text></Pressable>
          </Link>
        </View>
      </Panel>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 11 },
});
