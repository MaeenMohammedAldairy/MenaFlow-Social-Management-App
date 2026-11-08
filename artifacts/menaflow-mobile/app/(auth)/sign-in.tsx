import { Link } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Eye, EyeOff, LockKeyhole, Mail, ArrowLeft } from 'lucide-react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { AuthFrame, authStyles } from '@/components/AuthFrame';
import { PasswordResetForm, SecondFactorForm } from '@/components/SignInAdditionalForms';
import { useColors } from '@/hooks/useColors';
import { useSignInFlow } from '@/hooks/use-sign-in-flow';

export default function SignInScreen() {
  const colors = useColors();
  const {
    signIn,
    emailAddress,
    setEmailAddress,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    verificationCode,
    setVerificationCode,
    secondFactor,
    resetStep,
    setResetStep,
    newPassword,
    setNewPassword,
    showNewPassword,
    setShowNewPassword,
    errorMessage,
    setErrorMessage,
    successMessage,
    setSuccessMessage,
    socialLoading,
    loading,
    busy,
    inputRowStyle,
    inputFocusProps,
    requiresSecondFactor,
    availableFactors,
    submit,
    selectSecondFactor,
    resendSecondFactor,
    restartSignIn,
    verifySecondFactor,
    startPasswordReset,
    resendPasswordResetCode,
    verifyPasswordResetCode,
    finishPasswordReset,
    signInWithProvider,
    secondFactorLabel,
    title,
    subtitle,
  } = useSignInFlow();
  return (
    <AuthFrame mode="sign-in" title={title} subtitle={subtitle}>
      <View style={[authStyles.card, styles.panel]}>
        {requiresSecondFactor ? (
          <SecondFactorForm
            signInStatus={signIn.status}
            availableFactors={availableFactors}
            secondFactor={secondFactor}
            verificationCode={verificationCode}
            setVerificationCode={setVerificationCode}
            selectSecondFactor={selectSecondFactor}
            verifySecondFactor={verifySecondFactor}
            resendSecondFactor={resendSecondFactor}
            secondFactorLabel={secondFactorLabel}
            inputRowStyle={inputRowStyle}
            inputFocusProps={inputFocusProps}
            loading={loading}
          />
        ) : resetStep ? (
          <PasswordResetForm
            resetStep={resetStep}
            emailAddress={emailAddress}
            setEmailAddress={setEmailAddress}
            verificationCode={verificationCode}
            setVerificationCode={setVerificationCode}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            showNewPassword={showNewPassword}
            setShowNewPassword={setShowNewPassword}
            setResetStep={setResetStep}
            setErrorMessage={setErrorMessage}
            setSuccessMessage={setSuccessMessage}
            startPasswordReset={startPasswordReset}
            resendPasswordResetCode={resendPasswordResetCode}
            verifyPasswordResetCode={verifyPasswordResetCode}
            finishPasswordReset={finishPasswordReset}
            inputRowStyle={inputRowStyle}
            inputFocusProps={inputFocusProps}
            loading={loading}
          />
        ) : (
          <>
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
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry={!showPassword}
                placeholder="أدخل كلمة المرور"
                placeholderTextColor={colors.mutedForeground}
                style={[authStyles.input, authStyles.ltrInput, { color: colors.foreground }]}
                accessibilityLabel="كلمة المرور"
                {...inputFocusProps('password')}
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
              disabled={!emailAddress.trim() || !password || busy}
              style={[authStyles.button, { backgroundColor: colors.primary, opacity: !emailAddress.trim() || !password || busy ? 0.55 : 1 }]}
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
                accessibilityState={{ disabled: busy, busy: socialLoading === 'google' }}
                disabled={busy}
                style={[authStyles.secondaryButton, styles.socialButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: busy && socialLoading !== 'google' ? 0.55 : 1 }]}
              >
                <Text style={[styles.googleMark, { color: '#4285F4' }]}>G</Text>
                <Text style={[authStyles.secondaryText, { color: colors.foreground }]}>
                  {socialLoading === 'google' ? 'جارٍ المتابعة مع Google…' : 'Google'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signInWithProvider('oauth_facebook')}
                accessibilityState={{ disabled: busy, busy: socialLoading === 'facebook' }}
                disabled={busy}
                style={[authStyles.secondaryButton, styles.socialButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: busy && socialLoading !== 'facebook' ? 0.55 : 1 }]}
              >
                <Text style={[styles.facebookMark, { color: colors.facebook }]}>f</Text>
                <Text style={[authStyles.secondaryText, { color: colors.foreground }]}>
                  {socialLoading === 'facebook' ? 'جارٍ المتابعة مع Facebook…' : 'Facebook'}
                </Text>
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
