import { useSignUp } from "@clerk/expo";
import { AuthAlert } from "@/components/AuthAlert";
import { Link, router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react-native";
import { CairoText as Text, CairoTextInput as TextInput } from "@/components/CairoTypography";
import { AuthFrame, authStyles } from "@/components/AuthFrame";
import { useAuthTheme } from "@/hooks/useAuthTheme";
import { getAuthErrorMessage } from "@/lib/auth-error-message";

export default function SignUpScreen() {
  const theme = useAuthTheme();
  const { signUp, fetchStatus } = useSignUp();
  const [username, setUsername] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [code, setCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const loading = fetchStatus === "fetching";
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canCreate =
    username.trim().length > 0 &&
    emailAddress.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword &&
    acceptedTerms &&
    !loading;
  const inputRowStyle = (field: string, borderColor = theme.border) => [
    authStyles.inputRow,
    {
      borderColor: focusedField === field ? theme.primary : borderColor,
      backgroundColor: theme.inputSurface,
    },
    focusedField === field && authStyles.inputFocused,
  ];
  const inputFocusProps = (field: string) => ({
    onFocus: () => setFocusedField(field),
    onBlur: () =>
      setFocusedField((current) => (current === field ? null : current)),
    selectionColor: theme.primary,
  });

  const finalizeVerifiedSignUp = async (): Promise<boolean> => {
    if (signUp.verifications.emailAddress.status !== "verified") return false;
    if (signUp.status !== "complete") {
      setErrorMessage("تم تأكيد البريد، لكن لم تكتمل متطلبات الحساب. تحقق من بياناتك وحاول مرة أخرى.");
      return true;
    }

    await signUp.finalize({
      navigate: () => router.replace("/"),
    });
    return true;
  };

  const startSignUp = async () => {
    setErrorMessage("");
    if (password !== confirmPassword) {
      setErrorMessage("كلمتا المرور غير متطابقتين.");
      return;
    }
    if (!acceptedTerms) {
      setErrorMessage("يرجى الموافقة على الشروط وسياسة الخصوصية للمتابعة.");
      return;
    }
    try {
      const { error } = await signUp.password({
        emailAddress: emailAddress.trim(),
        password,
        legalAccepted: true,
        unsafeMetadata: { displayName: username.trim() },
        ...(signUp.requiredFields.includes("username") || signUp.optionalFields.includes("username")
          ? { username: username.trim() }
          : {}),
      });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, "تعذر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى."));
        return;
      }
      if (await finalizeVerifiedSignUp()) return;
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) {
        setErrorMessage(getAuthErrorMessage(sent.error, "تعذر إرسال رمز التحقق إلى بريدك. حاول مرة أخرى."));
        return;
      }
      setVerificationSent(true);
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, "تعذر إنشاء الحساب الآن. تحقق من اتصالك وحاول مجدداً."));
    }
  };

  const verifyCode = async () => {
    setErrorMessage("");
    try {
      if (await finalizeVerifiedSignUp()) return;
      const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (error) {
        setErrorMessage(getAuthErrorMessage(error, "رمز التحقق غير صحيح أو انتهت صلاحيته. تحقق منه أو اطلب رمزاً جديداً."));
        return;
      }
      if (await finalizeVerifiedSignUp()) return;
      setErrorMessage("لم يتم تأكيد البريد الإلكتروني بعد. تحقق من الرمز ثم حاول مرة أخرى.");
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, "تعذر تأكيد البريد الآن. تحقق من اتصالك وحاول مجدداً."));
    }
  };

  const resendCode = async () => {
    if (loading || isResendingCode) return;
    setErrorMessage("");
    setSuccessMessage("");
    setIsResendingCode(true);
    try {
      if (await finalizeVerifiedSignUp()) return;
      const result = await signUp.verifications.sendEmailCode();
      if (result.error) {
        setErrorMessage(getAuthErrorMessage(result.error, "تعذر إرسال رمز جديد. حاول مرة أخرى بعد قليل."));
      } else {
        setSuccessMessage("تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.");
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error, "تعذر إرسال رمز جديد الآن. تحقق من اتصالك وحاول مجدداً."));
    } finally {
      setIsResendingCode(false);
    }
  };

  return (
    <AuthFrame
      mode="sign-up"
      title={verificationSent ? "تأكيد البريد الإلكتروني" : "إنشاء حساب جديد"}
      subtitle={
        verificationSent
          ? "أرسلنا رمز التحقق إلى البريد التالي."
          : "ابدأ رحلتك نحو إدارة وسائل التواصل الاجتماعي بذكاء واحترافية"
      }
    >
      <View style={[authStyles.card, styles.panel]}>
        {verificationSent ? (
          <>
            <View
              style={[
                styles.emailNotice,
                { backgroundColor: theme.primarySoft, borderColor: theme.border },
              ]}
            >
              <View style={[styles.emailIcon, { backgroundColor: theme.card }]}>
                <Mail size={18} color={theme.primary} />
              </View>
              <View style={styles.emailCopy}>
                <Text style={[styles.emailCaption, { color: theme.mutedForeground }]}>
                  رمز التفعيل مرسل إلى
                </Text>
                <Text style={[styles.emailAddress, { color: theme.foreground }]}>
                  {emailAddress.trim()}
                </Text>
              </View>
            </View>
            <Text style={[authStyles.label, { color: theme.foreground }]}>رمز التحقق</Text>
            <View style={inputRowStyle("verification-code")}>
              <Mail size={18} color={theme.icon} />
              <TextInput
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholder="أدخل الرمز المرسل إلى بريدك"
                placeholderTextColor={theme.mutedForeground}
                style={[
                  authStyles.input,
                  authStyles.ltrInput,
                  !code && { textAlign: "right" },
                  { color: theme.foreground },
                ]}
                accessibilityLabel="رمز التحقق"
                {...inputFocusProps("verification-code")}
                onSubmitEditing={verifyCode}
                returnKeyType="go"
              />
            </View>
            {errorMessage ? <AuthAlert message={errorMessage} /> : null}

            <Pressable
              accessibilityRole="button"
              onPress={verifyCode}
              disabled={!code.trim() || loading}
              style={[
                authStyles.button,
                {
                  backgroundColor: theme.primary,
                  opacity: !code.trim() || loading ? 0.55 : 1,
                },
              ]}
            >
              <Text style={[authStyles.buttonText, { color: theme.primaryForeground }]}>
                {loading ? "جارٍ التحقق…" : "تأكيد البريد"}
              </Text>
              <ArrowLeft size={18} color={theme.primaryForeground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: loading || isResendingCode,
                busy: loading || isResendingCode,
              }}
              onPress={() => void resendCode()}
              disabled={loading || isResendingCode}
              style={[
                authStyles.secondaryButton,
                { borderColor: theme.border, backgroundColor: theme.card },
              ]}
            >
              <Mail size={16} color={theme.primary} />
              <Text style={[authStyles.secondaryText, { color: theme.primary }]}>
                {loading || isResendingCode ? "جارٍ إرسال الرمز…" : "إرسال رمز جديد"}
              </Text>
            </Pressable>
            {successMessage ? (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[authStyles.hint, { color: theme.primary, textAlign: "center" }]}
              >
                {successMessage}
              </Text>
            ) : null}
            <Text style={[authStyles.hint, { color: theme.mutedForeground, textAlign: "center" }]}>
              لم يصلك الرمز؟ تحقق من مجلد البريد غير الهام ثم أعد الإرسال.
            </Text>
          </>
        ) : (
          <>
            <Text style={[authStyles.label, { color: theme.foreground }]}>اسم المستخدم</Text>
            <View style={inputRowStyle("username")}>
              <UserRound size={18} color={theme.icon} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoComplete="username"
                textContentType="username"
                placeholder="أدخل اسم المستخدم"
                placeholderTextColor={theme.mutedForeground}
                style={[authStyles.input, { color: theme.foreground }]}
                accessibilityLabel="اسم المستخدم"
                {...inputFocusProps("username")}
              />
            </View>

            <Text style={[authStyles.label, { color: theme.foreground }]}>البريد الإلكتروني</Text>
            <View style={inputRowStyle("email")}>
              <Mail size={18} color={theme.icon} />
              <TextInput
                value={emailAddress}
                onChangeText={setEmailAddress}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="أدخل بريدك الإلكتروني"
                placeholderTextColor={theme.mutedForeground}
                style={[
                  authStyles.input,
                  authStyles.ltrInput,
                  !emailAddress && { textAlign: "right" },
                  { color: theme.foreground },
                ]}
                accessibilityLabel="البريد الإلكتروني"
                {...inputFocusProps("email")}
              />
            </View>

            <Text style={[authStyles.label, { color: theme.foreground }]}>كلمة المرور</Text>
            <View style={inputRowStyle("password")}>
              <LockKeyhole size={18} color={theme.icon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry={!showPassword}
                placeholder="أدخل كلمة المرور"
                placeholderTextColor={theme.mutedForeground}
                style={[
                  authStyles.input,
                  authStyles.ltrInput,
                  !password && { textAlign: "right" },
                  { color: theme.foreground },
                ]}
                accessibilityLabel="كلمة المرور"
                {...inputFocusProps("password")}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                onPress={() => setShowPassword((visible) => !visible)}
                hitSlop={8}
              >
                {showPassword ? (
                  <EyeOff size={18} color={theme.mutedForeground} />
                ) : (
                  <Eye size={18} color={theme.mutedForeground} />
                )}
              </Pressable>
            </View>

            <Text style={[authStyles.label, { color: theme.foreground }]}>
              إعادة إدخال كلمة المرور
            </Text>
            <View
              style={[
                ...inputRowStyle(
                  "confirm-password",
                  passwordMismatch ? theme.destructive : theme.border,
                ),
              ]}
            >
              <LockKeyhole size={18} color={theme.icon} />
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry={!showConfirmPassword}
                placeholder="أعد إدخال كلمة المرور"
                placeholderTextColor={theme.mutedForeground}
                style={[
                  authStyles.input,
                  authStyles.ltrInput,
                  !confirmPassword && { textAlign: "right" },
                  { color: theme.foreground },
                ]}
                accessibilityLabel="إعادة إدخال كلمة المرور"
                {...inputFocusProps("confirm-password")}
                onSubmitEditing={startSignUp}
                returnKeyType="go"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showConfirmPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                onPress={() => setShowConfirmPassword((visible) => !visible)}
                hitSlop={8}
              >
                {showConfirmPassword ? (
                  <EyeOff size={18} color={theme.mutedForeground} />
                ) : (
                  <Eye size={18} color={theme.mutedForeground} />
                )}
              </Pressable>
            </View>
            {passwordMismatch ? (
              <Text style={[authStyles.hint, { color: theme.destructive }]}>
                كلمتا المرور غير متطابقتين.
              </Text>
            ) : null}

            <View style={styles.termsRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="الموافقة على الشروط والأحكام وسياسة الخصوصية"
                accessibilityState={{ checked: acceptedTerms }}
                onPress={() => setAcceptedTerms((accepted) => !accepted)}
                style={styles.checkboxButton}
                hitSlop={6}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: acceptedTerms ? theme.primary : theme.border,
                      backgroundColor: acceptedTerms ? theme.primary : theme.inputSurface,
                    },
                  ]}
                >
                  {acceptedTerms ? (
                    <Check size={12} color={theme.primaryForeground} strokeWidth={3} />
                  ) : null}
                </View>
              </Pressable>
              <Text style={[styles.termsText, { color: theme.mutedForeground }]}>
                أوافق على{" "}
                <Text
                  accessibilityRole="link"
                  accessibilityLabel="قراءة الشروط والأحكام"
                  onPress={() => router.push("/(auth)/terms")}
                  style={[styles.legalLink, { color: theme.link }]}
                >
                  الشروط والأحكام
                </Text>
                {" و"}
                <Text
                  accessibilityRole="link"
                  accessibilityLabel="قراءة سياسة الخصوصية"
                  onPress={() => router.push("/(auth)/privacy")}
                  style={[styles.legalLink, { color: theme.link }]}
                >
                  سياسة الخصوصية
                </Text>
              </Text>
            </View>

            <View nativeID="clerk-captcha" />

            {errorMessage ? <AuthAlert message={errorMessage} /> : null}

            <Pressable
              accessibilityRole="button"
              onPress={startSignUp}
              disabled={!canCreate}
              style={[
                authStyles.button,
                { backgroundColor: theme.primary, opacity: canCreate ? 1 : 0.55 },
              ]}
            >
              <Text style={[authStyles.buttonText, { color: theme.primaryForeground }]}>
                {loading ? "جارٍ إنشاء الحساب…" : "إنشاء حساب"}
              </Text>
              <ArrowLeft size={18} color={theme.primaryForeground} />
            </Pressable>
          </>
        )}

        <View style={authStyles.linkRow}>
          <Text style={[styles.footerHint, { color: theme.mutedForeground }]}>
            لديك حساب بالفعل؟
          </Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable disabled={loading}>
              <Text style={[styles.footerLink, { color: theme.link }]}>تسجيل الدخول</Text>
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
    flexDirection: "row",
    alignItems: "center",
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
    alignItems: "center",
    justifyContent: "center",
  },
  emailCopy: { flex: 1, gap: 2 },
  emailCaption: { fontSize: 12.5, lineHeight: 19 },
  emailAddress: {
    fontSize: 13.5,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "ltr",
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 4,
    marginBottom: 2,
  },
  checkboxButton: { paddingTop: 1 },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  termsText: { flex: 1, fontSize: 12.5, lineHeight: 20, textAlign: "right" },
  legalLink: { fontWeight: "800" },
  footerHint: { fontSize: 13.5 },
  footerLink: { fontSize: 13.5, fontWeight: "800" },
});
