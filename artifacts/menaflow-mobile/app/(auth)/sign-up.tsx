import { useSignUp } from '@clerk/expo';
import { Link, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { useColors } from '@/hooks/useColors';
import { getAuthErrorMessage } from '@/lib/auth-error-message';

export default function SignUpScreen() {
  const colors = useColors();
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
  const [successMessage, setSuccessMessage] = useState('');
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const loading = fetchStatus === 'fetching';
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canCreate =
    username.trim().length > 0 &&
    emailAddress.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword &&
    acceptedTerms &&
    !loading;
  const inputRowStyle = (field: string, borderColor = colors.border) => [
    authStyles.inputRow,
    {
      borderColor: focusedField === field ? colors.primary : borderColor,
      backgroundColor: colors.background,
    },
    focusedField === field && authStyles.inputFocused,
  ];
  const inputFocusProps = (field: string) => ({
    onFocus: () => setFocusedField(field),
    onBlur: () =>
      setFocusedField((current) => (current === field ? null : current)),
    selectionColor: colors.primary,
  });

  const finalizeVerifiedSignUp = async (): Promise<boolean> => {
    if (signUp.verifications.emailAddress.status !== 'verified') return false;
    if (signUp.status !== 'complete') {
      setErrorMessage('تم تأكيد البريد، لكن لم تكتمل متطلبات الحساب. تحقق من بياناتك وحاول مرة أخرى.');
      return true;
    }

    await signUp.finalize({
      navigate: () => router.replace('/'),
    });
    return true;
  };

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
      if (await finalizeVerifiedSignUp()) return;
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
      if (await finalizeVerifiedSignUp()) return;
      const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, 'رمز التحقق غير صحيح أو انتهت صلاحيته. تحقق منه أو اطلب رمزاً جديداً.'));
        return;
      }
      if (await finalizeVerifiedSignUp()) return;
      setErrorMessage('لم يتم تأكيد البريد الإلكتروني بعد. تحقق من الرمز ثم حاول مرة أخرى.');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر تأكيد البريد الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const resendCode = async () => {
    if (loading || isResendingCode) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsResendingCode(true);
    try {
      if (await finalizeVerifiedSignUp()) return;
      const result = await signUp.verifications.sendEmailCode();
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر إرسال رمز جديد. حاول مرة أخرى بعد قليل.'));
      } else {
        setSuccessMessage('تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز جديد الآن. تحقق من اتصالك وحاول مجدداً.'));
    } finally {
      setIsResendingCode(false);
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
            <View style={inputRowStyle('verification-code')}>
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
                {...inputFocusProps('verification-code')}
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
              accessibilityState={{
                disabled: loading || isResendingCode,
                busy: loading || isResendingCode,
              }}
              onPress={() => void resendCode()}
              disabled={loading || isResendingCode}
              style={[authStyles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Mail size={15} color={colors.primary} />
              <Text style={[authStyles.secondaryText, { color: colors.primary }]}>
                {loading || isResendingCode ? 'جارٍ إرسال الرمز…' : 'إرسال رمز جديد'}
              </Text>
            </Pressable>
            {successMessage ? (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[authStyles.hint, { color: colors.primary, textAlign: 'center' }]}
              >
                {successMessage}
              </Text>
            ) : null}
            <Text style={[authStyles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>
              لم يصلك الرمز؟ تحقق من مجلد البريد غير الهام ثم أعد الإرسال.
            </Text>
          </>
        ) : (
          <>
            <Text style={[authStyles.label, { color: colors.foreground }]}>اسم المستخدم</Text>
            <View style={inputRowStyle('username')}>
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
                {...inputFocusProps('username')}
              />
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>البريد الإلكتروني</Text>
            <View style={inputRowStyle('email')}>
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
                {...inputFocusProps('email')}
              />
            </View>
            <Text style={[authStyles.label, { color: colors.foreground }]}>كلمة المرور</Text>
            <View style={inputRowStyle('password')}>
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
                {...inputFocusProps('password')}
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
                ...inputRowStyle(
                  'confirm-password',
                  passwordMismatch ? colors.destructive : colors.border,
                ),
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
                {...inputFocusProps('confirm-password')}
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
            <View style={styles.termsRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="الموافقة على الشروط والأحكام وسياسة الخصوصية"
                accessibilityState={{ checked: acceptedTerms }}
                onPress={() => setAcceptedTerms((accepted) => !accepted)}
                style={styles.checkboxButton}
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
              </Pressable>
              <Text
                style={[authStyles.hint, styles.termsText, { color: colors.mutedForeground }]}
              >
                أوافق على{" "}
                <Text
                  accessibilityRole="link"
                  accessibilityLabel="قراءة الشروط والأحكام، مسودة غير معتمدة"
                  onPress={() => router.push("/(auth)/terms")}
                  style={[styles.legalLink, { color: colors.primary }]}
                >
                  الشروط والأحكام
                </Text>
                {" و"}
                <Text
                  accessibilityRole="link"
                  accessibilityLabel="قراءة سياسة الخصوصية، مسودة غير معتمدة"
                  onPress={() => router.push("/(auth)/privacy")}
                  style={[styles.legalLink, { color: colors.primary }]}
                >
                  سياسة الخصوصية
                </Text>
                .
              </Text>
            </View>
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
  emailCaption: { fontSize: 14, lineHeight: 21 },
  emailAddress: { fontSize: 14, fontWeight: '700', textAlign: 'left', writingDirection: 'ltr' },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 1,
  },
  checkboxButton: { padding: 2 },
  termsText: { flex: 1 },
  legalLink: { fontWeight: '700', textDecorationLine: 'underline' },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
