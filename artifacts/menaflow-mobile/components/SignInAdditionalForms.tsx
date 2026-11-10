import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type TextInputProps, type ViewStyle, View } from 'react-native';
import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, RefreshCw } from 'lucide-react-native';
import { CairoText as Text, CairoTextInput as TextInput } from '@/components/CairoTypography';
import { authStyles } from '@/components/AuthFrame';
import { useColors } from '@/hooks/useColors';
import type { ResetStep, SecondFactorStrategy } from '@/hooks/use-sign-in-flow';

type InputFocusProps = Pick<TextInputProps, 'onFocus' | 'onBlur' | 'selectionColor'>;

type SharedFormProps = {
  inputRowStyle: (field: string) => StyleProp<ViewStyle>;
  inputFocusProps: (field: string) => InputFocusProps;
  loading: boolean;
};

export function SecondFactorForm({
  signInStatus,
  availableFactors,
  secondFactor,
  verificationCode,
  setVerificationCode,
  selectSecondFactor,
  verifySecondFactor,
  resendSecondFactor,
  secondFactorLabel,
  inputRowStyle,
  inputFocusProps,
  loading,
}: SharedFormProps & {
  signInStatus: string;
  availableFactors: Array<{
    strategy: SecondFactorStrategy;
    safeIdentifier?: string | null;
  }>;
  secondFactor: SecondFactorStrategy | null;
  verificationCode: string;
  setVerificationCode: (value: string) => void;
  selectSecondFactor: (strategy: SecondFactorStrategy) => void | Promise<void>;
  verifySecondFactor: () => void;
  resendSecondFactor: () => void | Promise<void>;
  secondFactorLabel: (strategy: SecondFactorStrategy) => string;
}) {
  const colors = useColors();

  return (
    <>
      <Text style={[authStyles.hint, { color: colors.mutedForeground }]}>
        {signInStatus === 'needs_client_trust'
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
          <View style={inputRowStyle('second-factor')}>
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
              style={[
                authStyles.input,
                authStyles.ltrInput,
                !verificationCode && { textAlign: 'right' },
                { color: colors.foreground },
              ]}
              accessibilityLabel="رمز التحقق"
              {...inputFocusProps('second-factor')}
              onSubmitEditing={verifySecondFactor}
              returnKeyType="go"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={verifySecondFactor}
            disabled={!verificationCode.trim() || loading}
            style={[
              authStyles.button,
              {
                backgroundColor: colors.primary,
                opacity: !verificationCode.trim() || loading ? 0.55 : 1,
              },
            ]}
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
  );
}

export function PasswordResetForm({
  resetStep,
  emailAddress,
  setEmailAddress,
  verificationCode,
  setVerificationCode,
  newPassword,
  setNewPassword,
  showNewPassword,
  setShowNewPassword,
  setResetStep,
  setErrorMessage,
  setSuccessMessage,
  startPasswordReset,
  resendPasswordResetCode,
  verifyPasswordResetCode,
  finishPasswordReset,
  inputRowStyle,
  inputFocusProps,
  loading,
}: SharedFormProps & {
  resetStep: Exclude<ResetStep, null>;
  emailAddress: string;
  setEmailAddress: (value: string) => void;
  verificationCode: string;
  setVerificationCode: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  showNewPassword: boolean;
  setShowNewPassword: (value: boolean | ((current: boolean) => boolean)) => void;
  setResetStep: (step: ResetStep) => void;
  setErrorMessage: (message: string) => void;
  setSuccessMessage: (message: string) => void;
  startPasswordReset: () => void;
  resendPasswordResetCode: () => void;
  verifyPasswordResetCode: () => void;
  finishPasswordReset: () => void;
}) {
  const colors = useColors();

  return (
    <>
      {resetStep === 'code' ? (
        <>
          <View
            style={[
              styles.resetInfo,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <View style={[styles.resetIcon, { backgroundColor: colors.card }]}>
              <Mail size={20} color={colors.primary} />
            </View>
            <View style={styles.resetCopy}>
              <Text style={[styles.resetTitle, { color: colors.foreground }]}>
                تحقق من بريدك الإلكتروني
              </Text>
              <Text style={[styles.resetDescription, { color: colors.mutedForeground }]}>
                إذا كان البريد مسجلاً، فسيصلك رمز لإكمال الاستعادة.
              </Text>
            </View>
          </View>
          <Text style={[authStyles.label, { color: colors.foreground }]}>رمز الاستعادة</Text>
          <View style={inputRowStyle('reset-code')}>
            <Mail size={17} color={colors.mutedForeground} />
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              autoCapitalize="none"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="أدخل الرمز المرسل لبريدك"
              placeholderTextColor={colors.mutedForeground}
              style={[
                authStyles.input,
                authStyles.ltrInput,
                styles.resetCodeInput,
                { color: colors.foreground },
              ]}
              accessibilityLabel="رمز استعادة كلمة المرور"
              {...inputFocusProps('reset-code')}
              onSubmitEditing={() => void verifyPasswordResetCode()}
              returnKeyType="go"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void verifyPasswordResetCode()}
            disabled={!verificationCode.trim() || loading}
            style={[
              authStyles.button,
              {
                backgroundColor: colors.primary,
                opacity: !verificationCode.trim() || loading ? 0.55 : 1,
              },
            ]}
          >
            <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
              {loading ? 'جارٍ التحقق…' : 'التحقق من الرمز'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة إرسال رمز الاستعادة إلى البريد الإلكتروني"
            accessibilityState={{ disabled: loading, busy: loading }}
            onPress={() => void resendPasswordResetCode()}
            disabled={loading}
            style={({ pressed }) => [
              styles.resendButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: loading ? 0.55 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <RefreshCw size={15} color={colors.primary} />
            <Text style={[authStyles.secondaryText, { color: colors.primary }]}>
              {loading ? 'جارٍ إرسال الرمز…' : 'إعادة إرسال رمز الاستعادة'}
            </Text>
          </Pressable>
        </>
      ) : resetStep === 'new-password' ? (
        <>
          <Text style={[authStyles.label, { color: colors.foreground }]}>كلمة المرور الجديدة</Text>
          <View style={inputRowStyle('new-password')}>
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
              style={[
                authStyles.input,
                authStyles.ltrInput,
                !newPassword && { textAlign: 'right' },
                { color: colors.foreground },
              ]}
              accessibilityLabel="كلمة المرور الجديدة"
              {...inputFocusProps('new-password')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showNewPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              onPress={() => setShowNewPassword((visible) => !visible)}
              hitSlop={8}
            >
              {showNewPassword ? (
                <EyeOff size={17} color={colors.mutedForeground} />
              ) : (
                <Eye size={17} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void finishPasswordReset()}
            disabled={newPassword.length < 8 || loading}
            style={[
              authStyles.button,
              {
                backgroundColor: colors.primary,
                opacity: newPassword.length < 8 || loading ? 0.55 : 1,
              },
            ]}
          >
            <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
              {loading ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View
            style={[
              styles.resetInfo,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <View style={[styles.resetIcon, { backgroundColor: colors.card }]}>
              <KeyRound size={20} color={colors.primary} />
            </View>
            <View style={styles.resetCopy}>
              <Text style={[styles.resetTitle, { color: colors.foreground }]}>
                استعادة آمنة
              </Text>
              <Text style={[styles.resetDescription, { color: colors.mutedForeground }]}>
                أرسل رمز تحقق لإعادة تعيين كلمة المرور.
              </Text>
            </View>
          </View>
          <Text style={[authStyles.label, { color: colors.foreground }]}>البريد الإلكتروني</Text>
          <View style={inputRowStyle('reset-email')}>
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
              style={[
                authStyles.input,
                authStyles.ltrInput,
                !emailAddress && { textAlign: 'right' },
                { color: colors.foreground },
              ]}
              accessibilityLabel="البريد الإلكتروني"
              {...inputFocusProps('reset-email')}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void startPasswordReset()}
            disabled={!emailAddress.trim() || loading}
            style={[
              authStyles.button,
              {
                backgroundColor: colors.primary,
                opacity: !emailAddress.trim() || loading ? 0.55 : 1,
              },
            ]}
          >
            <Text style={[authStyles.buttonText, { color: colors.primaryForeground }]}>
              {loading ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
            </Text>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={() => {
          setResetStep(null);
          setErrorMessage('');
          setSuccessMessage('');
        }}
      >
        <Text style={[authStyles.linkText, { color: colors.primary, textAlign: 'center' }]}>
          العودة لتسجيل الدخول
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  resetInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  resetIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetCopy: { flex: 1, gap: 2 },
  resetTitle: { fontSize: 14, fontWeight: '800', textAlign: 'right' },
  resetDescription: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  resetCodeInput: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 5,
    textAlign: 'center',
  },
  resendButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
});
