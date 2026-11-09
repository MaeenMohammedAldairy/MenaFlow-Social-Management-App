import React from 'react';
import { Pressable, type StyleProp, type TextInputProps, type ViewStyle, View } from 'react-native';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react-native';
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
          <Text style={[authStyles.label, { color: colors.foreground }]}>رمز الاستعادة</Text>
          <View style={inputRowStyle('reset-code')}>
            <Mail size={17} color={colors.mutedForeground} />
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              autoCapitalize="none"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="أدخل الرمز المرسل لبريدك"
              placeholderTextColor={colors.mutedForeground}
              style={[
                authStyles.input,
                authStyles.ltrInput,
                !verificationCode && { textAlign: 'right' },
                { color: colors.foreground },
              ]}
              accessibilityLabel="رمز استعادة كلمة المرور"
              {...inputFocusProps('reset-code')}
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
