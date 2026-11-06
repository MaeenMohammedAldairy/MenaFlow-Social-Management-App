import { useAuth, useSignIn, useSSO } from '@clerk/expo';
import { Link, Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Eye, EyeOff, LockKeyhole, Mail, ArrowLeft } from 'lucide-react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { useColors } from '@/hooks/useColors';
import { getAuthErrorMessage } from '@/lib/auth-error-message';
import { activateOAuthSession } from '@/lib/activate-oauth-session';

type SecondFactorStrategy = 'totp' | 'backup_code' | 'email_code' | 'phone_code';
type ResetStep = 'email' | 'code' | 'new-password' | null;

export default function SignInScreen() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [secondFactor, setSecondFactor] = useState<SecondFactorStrategy | null>(null);
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [socialLoading, setSocialLoading] = useState(false);
  const loading = fetchStatus === 'fetching' || socialLoading;
  const requiresSecondFactor =
    signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust';
  const availableFactors = signIn.supportedSecondFactors.filter(
    (factor): factor is typeof factor & { strategy: SecondFactorStrategy } =>
      factor.strategy === 'totp' ||
      factor.strategy === 'backup_code' ||
      factor.strategy === 'email_code' ||
      factor.strategy === 'phone_code',
  );

  if (isSignedIn) return <Redirect href="/(tabs)" />;

  const finalizeSignIn = async () => {
    await signIn.finalize({
      navigate: () => router.replace('/(tabs)'),
    });
  };

  const submit = async () => {
    setErrorMessage('');
    try {
      const { error } = await signIn.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, 'تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.'));
        return;
      }
      if (signIn.status === 'complete') {
        await finalizeSignIn();
      } else if (signIn.status !== 'needs_second_factor' && signIn.status !== 'needs_client_trust') {
        setErrorMessage('تعذر إكمال تسجيل الدخول. حاول مرة أخرى.');
      } else {
        setVerificationCode('');
        setSecondFactor(null);
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر تسجيل الدخول الآن. حاول مرة أخرى.'));
    }
  };

  const selectSecondFactor = async (strategy: SecondFactorStrategy) => {
    setErrorMessage('');
    setSuccessMessage('');
    setSecondFactor(strategy);
    setVerificationCode('');

    try {
      const result =
        strategy === 'email_code'
          ? await signIn.mfa.sendEmailCode()
          : strategy === 'phone_code'
            ? await signIn.mfa.sendPhoneCode()
            : { error: null };

      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر إرسال رمز التحقق. حاول مرة أخرى.'));
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز التحقق. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const resendSecondFactor = async () => {
    if (secondFactor !== 'email_code' && secondFactor !== 'phone_code') return;
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const result =
        secondFactor === 'email_code'
          ? await signIn.mfa.sendEmailCode()
          : await signIn.mfa.sendPhoneCode();
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر إرسال رمز جديد. حاول مرة أخرى.'));
      } else {
        setSuccessMessage('تم إرسال رمز تحقق جديد.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز جديد الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const restartSignIn = async () => {
    if (!emailAddress.trim()) {
      setErrorMessage('أدخل البريد الإلكتروني للعودة إلى خيارات تسجيل الدخول.');
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const result = await signIn.create({ identifier: emailAddress.trim() });
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر بدء محاولة تسجيل دخول جديدة. حاول مرة أخرى.'));
        return;
      }
      setSecondFactor(null);
      setVerificationCode('');
      setPassword('');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر بدء محاولة تسجيل دخول جديدة. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const verifySecondFactor = async () => {
    if (!secondFactor || !verificationCode.trim()) return;
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const params = { code: verificationCode.trim() };
      const result =
        secondFactor === 'totp'
          ? await signIn.mfa.verifyTOTP(params)
          : secondFactor === 'backup_code'
            ? await signIn.mfa.verifyBackupCode(params)
            : secondFactor === 'email_code'
              ? await signIn.mfa.verifyEmailCode(params)
              : await signIn.mfa.verifyPhoneCode(params);

      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'رمز التحقق غير صحيح أو انتهت صلاحيته. تحقق منه أو اطلب رمزاً جديداً.'));
        return;
      }
      if (signIn.status === 'complete') {
        await finalizeSignIn();
        return;
      }
      setErrorMessage('لم يكتمل التحقق. تأكد من الرمز ثم حاول مرة أخرى.');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر التحقق من الرمز الآن. حاول مرة أخرى.'));
    }
  };

  const startPasswordReset = async () => {
    if (!emailAddress.trim()) {
      setErrorMessage('أدخل بريدك الإلكتروني أولاً لإرسال رمز إعادة تعيين كلمة المرور.');
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const created = await signIn.create({ identifier: emailAddress.trim() });
      if (created.error) {
        setErrorMessage(getAuthErrorMessage(created.error, 'تعذر بدء استعادة كلمة المرور. تحقق من البريد الإلكتروني.'));
        return;
      }
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        setErrorMessage(getAuthErrorMessage(sent.error, 'تعذر إرسال رمز الاستعادة. حاول مرة أخرى.'));
        return;
      }
      setVerificationCode('');
      setResetStep('code');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز الاستعادة الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const resendPasswordResetCode = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر إرسال رمز استعادة جديد. حاول مرة أخرى.'));
      } else {
        setSuccessMessage('تم إرسال رمز استعادة جديد إلى بريدك.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر إرسال رمز الاستعادة الآن. تحقق من اتصالك وحاول مجدداً.'));
    }
  };

  const verifyPasswordResetCode = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: verificationCode.trim() });
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'رمز التحقق غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.'));
        return;
      }
      if (signIn.status === 'needs_new_password') {
        setErrorMessage('');
        setResetStep('new-password');
      } else {
        setErrorMessage('تعذر التحقق من الرمز. اطلب رمزاً جديداً وحاول مرة أخرى.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر التحقق من الرمز الآن. حاول مرة أخرى.'));
    }
  };

  const finishPasswordReset = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({ password: newPassword });
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, 'تعذر حفظ كلمة المرور الجديدة. اختر كلمة مرور أخرى وحاول مجدداً.'));
        return;
      }
      if (signIn.status === 'complete') {
        await finalizeSignIn();
      } else {
        setErrorMessage('تم تحديث كلمة المرور، لكن تعذر إكمال تسجيل الدخول. ارجع وسجّل الدخول مجدداً.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر حفظ كلمة المرور الآن. حاول مرة أخرى.'));
    }
  };

  const signInWithProvider = async (strategy: 'oauth_google' | 'oauth_facebook') => {
    setErrorMessage('');
    setSuccessMessage('');
    setSocialLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy });
      const activated = await activateOAuthSession(
        createdSessionId,
        setActive,
        () => router.replace('/(tabs)'),
      );
      if (!activated) {
        setErrorMessage('تم إيقاف تسجيل الدخول قبل اكتماله.');
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, 'تعذر تسجيل الدخول عبر مزود الخدمة. تحقق من اتصالك وحاول مرة أخرى.'));
    } finally {
      setSocialLoading(false);
    }
  };

  const secondFactorLabel = (strategy: SecondFactorStrategy) => {
    switch (strategy) {
      case 'totp':
        return 'تطبيق المصادقة';
      case 'backup_code':
        return 'رمز احتياطي';
      case 'email_code':
        return 'رمز عبر البريد الإلكتروني';
      case 'phone_code':
        return 'رمز عبر الهاتف';
    }
  };

  const title = requiresSecondFactor
    ? 'تحقق من هويتك'
    : resetStep
      ? resetStep === 'new-password'
        ? 'كلمة مرور جديدة'
        : 'استعادة كلمة المرور'
      : 'مرحباً بعودتك';
  const subtitle = requiresSecondFactor
    ? 'أكمل خطوة التحقق الإضافية للمتابعة.'
    : resetStep
      ? resetStep === 'new-password'
        ? 'اختر كلمة مرور جديدة لحسابك.'
        : `سنساعدك على استعادة الوصول${emailAddress ? ` إلى ${emailAddress}` : ''}.`
      : 'سجّل الدخول للوصول إلى مساحة عملك.';

  return (
    <AuthFrame mode="sign-in" title={title} subtitle={subtitle}>
      <View style={[authStyles.card, styles.panel]}>
        {requiresSecondFactor ? (
          <>
            <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>
              {signIn.status === 'needs_client_trust'
                ? 'تحقق من هويتك لتأكيد تسجيل الدخول من هذا الجهاز.'
                : 'اختر وسيلة التحقق لإكمال تسجيل الدخول.'}
            </Text>
            {availableFactors.map((factor) => (
              <Pressable
                key={factor.strategy}
                accessibilityRole="button"
                onPress={() => void selectSecondFactor(factor.strategy)}
                disabled={loading}
                style={[
                  authStyles.secondaryButton,
                  {
                    borderColor: secondFactor === factor.strategy ? colors.primary : colors.border,
                    backgroundColor: secondFactor === factor.strategy ? colors.accent : colors.card,
                    opacity: loading ? 0.55 : 1,
                  },
                ]}
              >
                <Text style={[authStyles.secondaryText, { color: colors.primary }]}>
                  {secondFactorLabel(factor.strategy)}
                  {factor.strategy === 'email_code' || factor.strategy === 'phone_code'
                    ? ` (${factor.safeIdentifier})`
                    : ''}
                </Text>
              </Pressable>
            ))}
            {availableFactors.length === 0 ? (
              <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>
                لا توجد وسيلة تحقق إضافية مهيأة لهذا الحساب. أعد إعداد عوامل التحقق في لوحة Clerk أو استخدم طريقة تسجيل دخول أخرى.
              </Text>
            ) : null}
            {secondFactor ? (
              <>
                <Text style={[authStyles.label, { color: colors.foreground }]}>رمز التحقق</Text>
                <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Mail size={17} color={colors.mutedForeground} />
                  <TextInput
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    placeholder="أدخل الرمز"
                    placeholderTextColor={colors.mutedForeground}
                    style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                    accessibilityLabel="رمز التحقق"
                    onSubmitEditing={verifySecondFactor}
                    returnKeyType="go"
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={verifySecondFactor}
                  disabled={!verificationCode.trim() || loading}
                  style={[authStyles.button, { backgroundColor: colors.primary, opacity: !verificationCode.trim() || loading ? 0.55 : 1 }]}
                >
                  <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                    {loading ? 'جارٍ التحقق…' : 'تأكيد الرمز'}
                  </Text>
                </Pressable>
                {secondFactor === 'email_code' || secondFactor === 'phone_code' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, busy: loading }}
                    onPress={() => void resendSecondFactor()}
                    disabled={loading}
                  >
                    <Text style={[authStyles.linkText, { color: colors.primary, textAlign: 'center' }]}>
                      {loading ? 'جارٍ إرسال الرمز…' : 'إعادة إرسال رمز التحقق'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </>
        ) : resetStep ? (
          <>
            {resetStep === 'code' ? (
              <>
                <Text style={[authStyles.label, { color: colors.foreground }]}>رمز الاستعادة</Text>
                <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Mail size={17} color={colors.mutedForeground} />
                  <TextInput
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    placeholder="أدخل الرمز المرسل لبريدك"
                    placeholderTextColor={colors.mutedForeground}
                    style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                    accessibilityLabel="رمز استعادة كلمة المرور"
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void verifyPasswordResetCode()}
                  disabled={!verificationCode.trim() || loading}
                  style={[authStyles.button, { backgroundColor: colors.primary, opacity: !verificationCode.trim() || loading ? 0.55 : 1 }]}
                >
                  <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                    {loading ? 'جارٍ التحقق…' : 'التحقق من الرمز'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loading, busy: loading }}
                  onPress={() => void resendPasswordResetCode()}
                  disabled={loading}
                >
                  <Text style={[authStyles.linkText, { color: colors.primary, textAlign: 'center' }]}>
                    {loading ? 'جارٍ إرسال الرمز…' : 'إعادة إرسال رمز الاستعادة'}
                  </Text>
                </Pressable>
              </>
            ) : resetStep === 'new-password' ? (
              <>
                <Text style={[authStyles.label, { color: colors.foreground }]}>كلمة المرور الجديدة</Text>
                <View style={[authStyles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <LockKeyhole size={17} color={colors.mutedForeground} />
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    secureTextEntry={!showNewPassword}
                    placeholder="أدخل كلمة مرور جديدة"
                    placeholderTextColor={colors.mutedForeground}
                    style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                    accessibilityLabel="كلمة المرور الجديدة"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    onPress={() => setShowNewPassword((visible) => !visible)}
                    hitSlop={8}
                  >
                    {showNewPassword ? <EyeOff size={17} color={colors.mutedForeground} /> : <Eye size={17} color={colors.mutedForeground} />}
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void finishPasswordReset()}
                  disabled={newPassword.length < 8 || loading}
                  style={[authStyles.button, { backgroundColor: colors.primary, opacity: newPassword.length < 8 || loading ? 0.55 : 1 }]}
                >
                  <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                    {loading ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
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
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void startPasswordReset()}
                  disabled={!emailAddress.trim() || loading}
                  style={[authStyles.button, { backgroundColor: colors.primary, opacity: !emailAddress.trim() || loading ? 0.55 : 1 }]}
                >
                  <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                    {loading ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
                  </Text>
                </Pressable>
              </>
            )}
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => { setResetStep(null); setErrorMessage(''); setSuccessMessage(''); }}>
              <Text style={[authStyles.linkText, { color: colors.primary, textAlign: 'center' }]}>العودة لتسجيل الدخول</Text>
            </Pressable>
          </>
        ) : (
          <>
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
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry={!showPassword}
                placeholder="أدخل كلمة المرور"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="كلمة المرور"
                onSubmitEditing={submit}
                returnKeyType="go"
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
            <View style={styles.formLinks}>
              <Pressable accessibilityRole="button" onPress={() => { setResetStep('email'); setErrorMessage(''); }}>
                <Text style={[authStyles.linkText, { color: colors.primary }]}>نسيت كلمة المرور؟</Text>
              </Pressable>
              <View style={[styles.secureBadge, { backgroundColor: colors.accent }]}>
                <LockKeyhole size={12} color={colors.primary} />
                <Text style={[authStyles.hint, { color: colors.primary }]}>دخول آمن</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={submit}
              disabled={!emailAddress.trim() || !password || loading}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: !emailAddress.trim() || !password || loading ? 0.55 : 1 }]}
            >
              <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
                {loading ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
              </Text>
              <ArrowLeft size={17} color={colors.primaryForeground} />
            </Pressable>

            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>أو سجّل الدخول باستخدام</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>
            <View style={styles.socialRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signInWithProvider('oauth_google')}
                disabled={loading}
                style={[authStyles.secondaryButton, styles.socialButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Text style={[styles.googleMark, { color: '#4285F4' }]}>G</Text>
                <Text style={[authStyles.secondaryText, { color: colors.foreground }]}>Google</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signInWithProvider('oauth_facebook')}
                disabled={loading}
                style={[authStyles.secondaryButton, styles.socialButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Text style={[styles.facebookMark, { color: colors.facebook }]}>f</Text>
                <Text style={[authStyles.secondaryText, { color: colors.foreground }]}>Facebook</Text>
              </Pressable>
            </View>
          </>
        )}
        {errorMessage ? (
          <Text accessibilityRole="alert" style={[authStyles.error, { color: colors.destructive }]}>
            {errorMessage}
          </Text>
        ) : null}
        {successMessage ? (
          <Text accessibilityRole="alert" style={[authStyles.hint, { color: colors.primary, textAlign: 'center' }]}>
            {successMessage}
          </Text>
        ) : null}
        <View style={authStyles.linkRow}>
          {requiresSecondFactor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading || !emailAddress.trim(), busy: loading }}
              disabled={loading || !emailAddress.trim()}
              onPress={() => void restartSignIn()}
            >
              <Text style={[authStyles.linkText, { color: colors.primary }]}>
                {loading ? 'جارٍ الرجوع…' : 'العودة لاختيار حساب أو طريقة دخول أخرى'}
              </Text>
            </Pressable>
          ) : resetStep ? null : (
            <>
              <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>ليس لديك حساب؟</Text>
              <Link href="/(auth)/sign-up" asChild>
                <Pressable>
                  <Text style={[authStyles.linkText, { color: colors.primary }]}>أنشئ حسابك الآن</Text>
                </Pressable>
              </Link>
            </>
          )}
        </View>
      </View>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  formLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: 1 },
  dividerLine: { flex: 1, height: 1 },
  socialRow: { flexDirection: 'row', gap: 10 },
  socialButton: { flex: 1, minHeight: 43 },
  googleMark: { fontSize: 18, fontWeight: '900' },
  facebookMark: { fontSize: 21, lineHeight: 23, fontWeight: '900' },
});
