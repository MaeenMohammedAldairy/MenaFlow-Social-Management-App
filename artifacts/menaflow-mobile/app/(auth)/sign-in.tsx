import { Link } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Check, Eye, EyeOff, LockKeyhole, Mail, ArrowLeft } from "lucide-react-native";
import { CairoText as Text, CairoTextInput as TextInput } from "@/components/CairoTypography";
import { AuthFrame, authStyles } from "@/components/AuthFrame";
import { GoogleLogo } from "@/components/GoogleLogo";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { PasswordResetForm, SecondFactorForm } from "@/components/SignInAdditionalForms";
import { AuthAlert } from "@/components/AuthAlert";
import { useAuthTheme } from "@/hooks/useAuthTheme";
import { useSignInFlow } from "@/hooks/use-sign-in-flow";
import { readRememberedEmail, syncRememberedEmail } from "@/lib/remembered-email";

export default function SignInScreen() {
  const theme = useAuthTheme();
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

  const [remember, setRemember] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    void readRememberedEmail().then((stored) => {
      if (!active || !stored) return;
      setEmailAddress((current) => (current.trim().length > 0 ? current : stored));
    });
    return () => {
      active = false;
    };
  }, [setEmailAddress]);

  const handleSubmit = () => {
    void syncRememberedEmail(emailAddress, remember);
    submit();
  };

  return (
    <AuthFrame
      mode="sign-in"
      title={title}
      subtitle={subtitle}
      hero={!requiresSecondFactor && !resetStep}
    >
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
                placeholder="example@domain.com"
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
                autoComplete="current-password"
                textContentType="password"
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
                onSubmitEditing={handleSubmit}
                returnKeyType="go"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                onPress={() => setShowPassword((visible) => !visible)}
                hitSlop={12}
              >
                {showPassword ? (
                  <EyeOff size={18} color={theme.mutedForeground} />
                ) : (
                  <Eye size={18} color={theme.mutedForeground} />
                )}
              </Pressable>
            </View>

            <View style={styles.optionsRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="تذكرني في المرة القادمة"
                accessibilityState={{ checked: remember }}
                onPress={() => setRemember((value) => !value)}
                style={styles.rememberButton}
                hitSlop={8}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: remember ? theme.primary : theme.border,
                      backgroundColor: remember ? theme.primary : theme.inputSurface,
                    },
                  ]}
                >
                  {remember ? (
                    <Check size={12} color={theme.primaryForeground} strokeWidth={3} />
                  ) : null}
                </View>
                <Text style={[styles.rememberLabel, { color: theme.foreground }]}>تذكرني</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setResetStep("email");
                  setErrorMessage("");
                }}
                style={styles.inlineLinkButton}
                hitSlop={8}
              >
                <Text style={[styles.forgotLink, { color: theme.link }]}>نسيت كلمة المرور؟</Text>
              </Pressable>
            </View>

            {errorMessage ? <AuthAlert message={errorMessage} /> : null}

            {(() => {
              const submitDisabled = !emailAddress.trim() || !password || busy;
              const submitFg = submitDisabled ? theme.disabledForeground : theme.primaryForeground;
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSubmit}
                  disabled={submitDisabled}
                  style={[
                    authStyles.button,
                    {
                      backgroundColor: submitDisabled ? theme.disabled : theme.primary,
                    },
                  ]}
                >
                  <Text style={[authStyles.buttonText, { color: submitFg }]}>
                    {loading ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
                  </Text>
                  <ArrowLeft size={18} color={submitFg} />
                </Pressable>
              );
            })()}

            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
              <Text style={[styles.dividerText, { color: theme.mutedForeground }]}>
                أو سجل الدخول عبر
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            </View>

            <View style={styles.socialRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signInWithProvider("oauth_facebook")}
                accessibilityState={{ disabled: busy, busy: socialLoading === "facebook" }}
                disabled={busy}
                style={[
                  authStyles.secondaryButton,
                  styles.socialButton,
                  {
                    borderColor: theme.border,
                    backgroundColor:
                      busy && socialLoading !== "facebook" ? theme.disabled : theme.card,
                  },
                ]}
              >
                <SocialPlatformIcon platform="facebook" size={19} />
                <Text
                  style={[
                    authStyles.secondaryText,
                    {
                      color:
                        busy && socialLoading !== "facebook"
                          ? theme.disabledForeground
                          : theme.foreground,
                    },
                  ]}
                >
                  {socialLoading === "facebook" ? "جارٍ المتابعة…" : "Facebook"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signInWithProvider("oauth_google")}
                accessibilityState={{ disabled: busy, busy: socialLoading === "google" }}
                disabled={busy}
                style={[
                  authStyles.secondaryButton,
                  styles.socialButton,
                  {
                    borderColor: theme.border,
                    backgroundColor:
                      busy && socialLoading !== "google" ? theme.disabled : theme.card,
                  },
                ]}
              >
                <GoogleLogo size={19} />
                <Text
                  style={[
                    authStyles.secondaryText,
                    {
                      color:
                        busy && socialLoading !== "google"
                          ? theme.disabledForeground
                          : theme.foreground,
                    },
                  ]}
                >
                  {socialLoading === "google" ? "جارٍ المتابعة…" : "Google"}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {/* The main step shows the alert above its button; the second-factor and
            reset steps keep it here because their button lives inside the form. */}
        {errorMessage && (requiresSecondFactor || resetStep) ? (
          <AuthAlert message={errorMessage} />
        ) : null}
        {successMessage && !resetStep && requiresSecondFactor ? (
          <Text
            accessibilityRole="alert"
            style={[authStyles.hint, { color: theme.primary, textAlign: "center" }]}
          >
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
              style={styles.inlineLinkButton}
            >
              <Text style={[authStyles.linkText, { color: theme.link }]}>
                {loading ? "جارٍ الرجوع…" : "العودة لاختيار حساب أو طريقة دخول أخرى"}
              </Text>
            </Pressable>
          ) : resetStep ? null : (
            <>
              <Text style={[styles.footerHint, { color: theme.mutedForeground }]}>
                ليس لديك حساب؟
              </Text>
              <Link href="/(auth)/sign-up" asChild>
                <Pressable style={styles.inlineLinkButton}>
                  <Text style={[styles.footerLink, { color: theme.link }]}>إنشاء حساب جديد</Text>
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
  panel: { gap: 9 },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    marginBottom: 2,
  },
  rememberButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  inlineLinkButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rememberLabel: { fontSize: 13.5, fontWeight: "600" },
  forgotLink: { fontSize: 13.5, fontWeight: "800" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 3 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12.5 },
  socialRow: { flexDirection: "row", gap: 10 },
  // The brand names are Latin, so the mark sits to the left of the label even
  // inside the RTL row — exactly like the reference artwork.
  socialButton: { flex: 1, flexDirection: 'row-reverse' },
  footerHint: { fontSize: 13.5 },
  footerLink: { fontSize: 13.5, fontWeight: "800" },
});
