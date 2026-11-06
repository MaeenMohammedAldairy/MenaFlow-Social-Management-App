import { useAuth, useSignUp } from '@clerk/expo';
import { Link, Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { useColors } from '@/hooks/useColors';
import { getAuthErrorMessage } from '@/lib/auth-error-message';

export default function SignUpScreen() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const { signUp, fetchStatus } = useSignUp();
  const [username, setUsername] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [code, setCode] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const loading = fetchStatus === 'fetching';
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canCreate =
    username.trim().length > 0 &&
    emailAddress.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword &&
    acceptedTerms &&
    !loading;

  if (isSignedIn) return <Redirect href="/" />;

  const startSignUp = async () => {
    setErrorMessage('');
    if (password !== confirmPassword) {
      setErrorMessage('كلمتا المرور غير متطابقتين.');
      return;
    }
    if (!acceptedTerms) {
      setErrorMessage('يرجى الموافقة على الشروط وسياسة الخصوصية للمتابعة.');
      return;
    }
    try {
      const { error } = await signUp.password({
        emailAddress: emailAddress.trim(),
        password,
        legalAccepted: true,
        unsafeMetadata: { displayName: username.trim() },
        ...(signUp.requiredFields.includes('username') || signUp.optionalFields.includes('username')
          ? { username: username.trim() }
          : {}),
      });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, 'تعذر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى.'));
        return;
      }
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) {
        setErrorMessage(getAuthErrorMessage(sent.error, 'تعذر إرسال رمز التحقق إلى بريدك. حاول مرة أخرى.'));
        return;
      }
      setVerificationSent(true);
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إنشاء الحساب الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const verifyCode = async () => {
    setErrorMessage('');
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, 'رمز التحقق غير صحيح أو انتهت صلاحيته. تحقق منه أو اطلب رمزاً جديداً.'));
        return;
      }
      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: () => router.replace('/'),
        });
      } else {
        setErrorMessage('لم يكتمل التحقق. أعد المحاولة أو اطلب رمزاً جديداً.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر تأكيد البريد الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const resendCode = async () => {
    setErrorMessage('');
    try {
      const result = await signUp.verifications.sendEmailCode();
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر إرسال رمز جديد. حاول مرة أخرى بعد قليل.'));
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز جديد الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  return (
    <AuthFrame
      mode="sign-up"
      title={verificationSent ? 'تأكيد البريد الإلكتروني' : 'أنشئ حسابك'}
      subtitle={
        verificationSent
          ? 'أرسلنا رمز التحقق إلى البريد التالي.'
          : 'ابدأ بإدارة محتواك من مساحة واحدة.'
      }
    >
      <View style={[authStyles.card, styles.panel]}>
        {verificationSent ? (
          <>
            <View style={[styles.emailNotice, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <View style={[styles.emailIcon, { backgroundColor: colors.card }]}>
                <Mail size={18} color={colors.primary} />
              </View>
              <View style={styles.emailCopy}>
                <Text style={[styles.emailCaption, { color: colors.mutedForeground }]}>رمز التفعيل مرسل إلى</Text>
                <Text style={[styles.emailAddress, { color: colors.foreground }]}>{emailAddress.trim()}</Text>
              </View>
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>رمز التحقق</Text>
            <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Mail size={17} color={colors.mutedForeground} />
              <TextInput
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholder="أدخل الرمز المرسل إلى بريدك"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="رمز التحقق"
                onSubmitEditing={verifyCode}
                returnKeyType="go"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={verifyCode}
              disabled={!code.trim() || loading}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: !code.trim() || loading ? 0.55 : 1 }]}
            >
              <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                {loading ? 'جارٍ التحقق…' : 'تأكيد البريد'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              onPress={() => void resendCode()}
              disabled={loading}
              style={[authStyles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Mail size={15} color={colors.primary} />
              <Text style={[authStyles.secondaryText, { color: colors.primary }]}>
                {loading ? 'جارٍ إرسال الرمز…' : 'إرسال رمز جديد'}
              </Text>
            </Pressable>
            <Text style={[authStyles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>
              لم يصلك الرمز؟ تحقق من مجلد البريد غير الهام ثم أعد الإرسال.
            </Text>
          </>
        ) : (
          <>
            <Text style={[authStyles.label, { color: colors.foreground }]}>اسم المستخدم</Text>
            <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <UserRound size={17} color={colors.mutedForeground} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoComplete="username"
                textContentType="username"
                placeholder="كيف نناديك؟"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, { color: colors.foreground }]}
                accessibilityLabel="اسم المستخدم"
              />
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>البريد الإلكتروني</Text>
            <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Mail size={17} color={colors.mutedForeground} />
              <TextInput
                value={emailAddress}
                onChangeText={setEmailAddress}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="name@example.com"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="البريد الإلكتروني"
              />
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>كلمة المرور</Text>
            <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <LockKeyhole size={17} color={colors.mutedForeground} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry={!showPassword}
                placeholder="أنشئ كلمة مرور قوية"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="كلمة المرور"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                onPress={() => setShowPassword((visible) => !visible)}
                hitSlop={8}
              >
                {showPassword ? <EyeOff size={17} color={colors.mutedForeground} /> : <Eye size={17} color={colors.mutedForeground} />}
              </Pressable>
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>تأكيد كلمة المرور</Text>
            <View
              style={[
                authStyles.inputRow,
                {
                  borderColor: passwordMismatch ? colors.destructive : colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            >
              <LockKeyhole size={17} color={colors.mutedForeground} />
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry={!showConfirmPassword}
                placeholder="أعد كتابة كلمة المرور"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="تأكيد كلمة المرور"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showConfirmPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                onPress={() => setShowConfirmPassword((visible) => !visible)}
                hitSlop={8}
              >
                {showConfirmPassword ? <EyeOff size={17} color={colors.mutedForeground} /> : <Eye size={17} color={colors.mutedForeground} />}
              </Pressable>
            </View>
            {passwordMismatch ? (
              <Text style={[authStyles.hint, { color: colors.destructive }]}>كلمتا المرور غير متطابقتين.</Text>
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedTerms }}
              onPress={() => setAcceptedTerms((accepted) => !accepted)}
              style={styles.termsRow}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: acceptedTerms ? colors.primary : colors.border,
                    backgroundColor: acceptedTerms ? colors.primary : colors.card,
                  },
                ]}
              >
                {acceptedTerms ? <Check size={13} color={colors.primaryForeground} /> : null}
              </View>
              <Text style={[authStyles.hint, styles.termsText, { color: colors.mutedForeground }]}>
                أوافق على الشروط والأحكام وسياسة الخصوصية.
              </Text>
            </Pressable>
            <View nativeID="clerk-captcha" />
            <Pressable
              accessibilityRole="button"
              onPress={startSignUp}
              disabled={!canCreate}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: canCreate ? 1 : 0.55 }]}
            >
              <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                {loading ? 'جارٍ إنشاء الحساب…' : 'إنشاء حسابي'}
              </Text>
            </Pressable>
            <Text style={[authStyles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>
              سنرسل رمز تحقق إلى بريدك قبل تفعيل الحساب.
            </Text>
          </>
        )}
        {errorMessage ? (
          <Text accessibilityRole="alert" style={[authStyles.error, { color: colors.destructive }]}>
            {errorMessage}
          </Text>
        ) : null}
        <View style={authStyles.linkRow}>
          <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>لديك حساب بالفعل؟</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable disabled={loading}>
              <Text style={[authStyles.linkText, { color: colors.primary }]}>تسجيل الدخول</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 9 },
  emailNotice: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1,
  },
  emailIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailCopy: { flex: 1, gap: 2 },
  emailCaption: { fontSize: 10 },
  emailAddress: { fontSize: 12, fontWeight: '700', textAlign: 'left', writingDirection: 'ltr' },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 1,
  },
  termsText: { flex: 1 },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
