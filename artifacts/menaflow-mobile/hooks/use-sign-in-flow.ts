import { useSignIn, useSSO } from "@clerk/expo";
import { router } from "expo-router";
import { useState } from "react";
import { authStyles } from "@/components/AuthFrame";
import { useColors } from "@/hooks/useColors";
import { activateOAuthSession } from "@/lib/activate-oauth-session";
import { getAuthErrorMessage } from "@/lib/auth-error-message";

export type SecondFactorStrategy = "totp" | "backup_code" | "email_code" | "phone_code";
export type ResetStep = "email" | "code" | "new-password" | null;

const passwordResetRequestMessage =
  "إذا كان هذا البريد مسجلاً، فستصلك تعليمات استعادة كلمة المرور.";

function isUnknownIdentifier(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("errors" in error)) {
    return false;
  }
  const errors = error.errors;
  return (
    Array.isArray(errors) &&
    errors.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "code" in item &&
        item.code === "form_identifier_not_found",
    )
  );
}

export function useSignInFlow() {
  const colors = useColors();
  const { signIn, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [secondFactor, setSecondFactor] =
    useState<SecondFactorStrategy | null>(null);
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [socialLoading, setSocialLoading] = useState<
    "google" | "facebook" | null
  >(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const loading = fetchStatus === "fetching";
  const busy = loading || socialLoading !== null;
  const inputRowStyle = (field: string) => [
    authStyles.inputRow,
    {
      borderColor: focusedField === field ? colors.primary : colors.border,
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
  const requiresSecondFactor =
    signIn.status === "needs_second_factor" ||
    signIn.status === "needs_client_trust";
  const availableFactors = signIn.supportedSecondFactors.filter(
    (factor): factor is typeof factor & { strategy: SecondFactorStrategy } =>
      factor.strategy === "totp" ||
      factor.strategy === "backup_code" ||
      factor.strategy === "email_code" ||
      factor.strategy === "phone_code",
  );

  const finalizeSignIn = async () => {
    await signIn.finalize({
      navigate: () => router.replace("/"),
    });
  };

  const submit = async () => {
    setErrorMessage("");
    try {
      const { error } = await signIn.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (error) {
        setErrorMessage(
          getAuthErrorMessage(
            error,
            "تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.",
          ),
        );
        return;
      }
      if (signIn.status === "complete") {
        await finalizeSignIn();
      } else if (
        signIn.status !== "needs_second_factor" &&
        signIn.status !== "needs_client_trust"
      ) {
        setErrorMessage("تعذر إكمال تسجيل الدخول. حاول مرة أخرى.");
      } else {
        setVerificationCode("");
        setSecondFactor(null);
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(error, "تعذر تسجيل الدخول الآن. حاول مرة أخرى."),
      );
    }
  };

  const selectSecondFactor = async (strategy: SecondFactorStrategy) => {
    setErrorMessage("");
    setSuccessMessage("");
    setSecondFactor(strategy);
    setVerificationCode("");

    try {
      const result =
        strategy === "email_code"
          ? await signIn.mfa.sendEmailCode()
          : strategy === "phone_code"
            ? await signIn.mfa.sendPhoneCode()
            : { error: null };

      if (result.error) {
        setErrorMessage(
          getAuthErrorMessage(result.error, "تعذر إرسال رمز التحقق. حاول مرة أخرى."),
        );
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "تعذر إرسال رمز التحقق. تحقق من اتصالك وحاول مجدداً.",
        ),
      );
    }
  };

  const resendSecondFactor = async () => {
    if (secondFactor !== "email_code" && secondFactor !== "phone_code") return;
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result =
        secondFactor === "email_code"
          ? await signIn.mfa.sendEmailCode()
          : await signIn.mfa.sendPhoneCode();
      if (result.error) {
        setErrorMessage(
          getAuthErrorMessage(result.error, "تعذر إرسال رمز جديد. حاول مرة أخرى."),
        );
      } else {
        setSuccessMessage("تم إرسال رمز تحقق جديد.");
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "تعذر إرسال رمز جديد الآن. تحقق من اتصالك وحاول مجدداً.",
        ),
      );
    }
  };

  const restartSignIn = async () => {
    if (!emailAddress.trim()) {
      setErrorMessage("أدخل البريد الإلكتروني للعودة إلى خيارات تسجيل الدخول.");
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await signIn.create({ identifier: emailAddress.trim() });
      if (result.error) {
        setErrorMessage(
          getAuthErrorMessage(
            result.error,
            "تعذر بدء محاولة تسجيل دخول جديدة. حاول مرة أخرى.",
          ),
        );
        return;
      }
      setSecondFactor(null);
      setVerificationCode("");
      setPassword("");
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "تعذر بدء محاولة تسجيل دخول جديدة. تحقق من اتصالك وحاول مجدداً.",
        ),
      );
    }
  };

  const verifySecondFactor = async () => {
    if (!secondFactor || !verificationCode.trim()) return;
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const params = { code: verificationCode.trim() };
      const result =
        secondFactor === "totp"
          ? await signIn.mfa.verifyTOTP(params)
          : secondFactor === "backup_code"
            ? await signIn.mfa.verifyBackupCode(params)
            : secondFactor === "email_code"
              ? await signIn.mfa.verifyEmailCode(params)
              : await signIn.mfa.verifyPhoneCode(params);

      if (result.error) {
        setErrorMessage(
          getAuthErrorMessage(
            result.error,
            "رمز التحقق غير صحيح أو انتهت صلاحيته. تحقق منه أو اطلب رمزاً جديداً.",
          ),
        );
        return;
      }
      if (signIn.status === "complete") {
        await finalizeSignIn();
        return;
      }
      setErrorMessage("لم يكتمل التحقق. تأكد من الرمز ثم حاول مرة أخرى.");
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(error, "تعذر التحقق من الرمز الآن. حاول مرة أخرى."),
      );
    }
  };

  const startPasswordReset = async () => {
    if (!emailAddress.trim()) {
      setErrorMessage(
        "أدخل بريدك الإلكتروني أولاً لإرسال رمز إعادة تعيين كلمة المرور.",
      );
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const created = await signIn.create({ identifier: emailAddress.trim() });
      if (created.error) {
        if (isUnknownIdentifier(created.error)) {
          setVerificationCode("");
          setResetStep("code");
          setSuccessMessage(passwordResetRequestMessage);
          return;
        }
        setErrorMessage(
          getAuthErrorMessage(
            created.error,
            "تعذر بدء استعادة كلمة المرور. تحقق من البريد الإلكتروني.",
          ),
        );
        return;
      }
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        if (isUnknownIdentifier(sent.error)) {
          setVerificationCode("");
          setResetStep("code");
          setSuccessMessage(passwordResetRequestMessage);
          return;
        }
        setErrorMessage(
          getAuthErrorMessage(
            sent.error,
            "تعذر إرسال رمز الاستعادة. حاول مرة أخرى.",
          ),
        );
        return;
      }
      setVerificationCode("");
      setResetStep("code");
      setSuccessMessage(passwordResetRequestMessage);
    } catch (error) {
      if (isUnknownIdentifier(error)) {
        setVerificationCode("");
        setResetStep("code");
        setSuccessMessage(passwordResetRequestMessage);
      } else {
        setErrorMessage(
          getAuthErrorMessage(
            error,
            "تعذر إرسال رمز الاستعادة الآن. تحقق من اتصالك وحاول مجدداً.",
          ),
        );
      }
    }
  };

  const resendPasswordResetCode = async () => {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) {
        if (isUnknownIdentifier(result.error)) {
          setSuccessMessage(passwordResetRequestMessage);
        } else {
          setErrorMessage(
            getAuthErrorMessage(
              result.error,
              "تعذر إرسال رمز استعادة جديد. حاول مرة أخرى.",
            ),
          );
        }
      } else {
        setSuccessMessage(passwordResetRequestMessage);
      }
    } catch (error) {
      if (isUnknownIdentifier(error)) {
        setSuccessMessage(passwordResetRequestMessage);
      } else {
        setErrorMessage(
          getAuthErrorMessage(
            error,
            "تعذر إرسال رمز الاستعادة الآن. تحقق من اتصالك وحاول مجدداً.",
          ),
        );
      }
    }
  };

  const verifyPasswordResetCode = async () => {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({
        code: verificationCode.trim(),
      });
      if (result.error) {
        setErrorMessage(
          "تعذر تأكيد الرمز. تحقق منه أو اطلب رمزاً جديداً ثم حاول مرة أخرى.",
        );
        return;
      }
      if (signIn.status === "needs_new_password") {
        setErrorMessage("");
        setResetStep("new-password");
      } else {
        setErrorMessage("تعذر التحقق من الرمز. اطلب رمزاً جديداً وحاول مرة أخرى.");
      }
    } catch {
      setErrorMessage(
        "تعذر تأكيد الرمز. تحقق منه أو اطلب رمزاً جديداً ثم حاول مرة أخرى.",
      );
    }
  };

  const finishPasswordReset = async () => {
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
      });
      if (result.error) {
        setErrorMessage(
          isUnknownIdentifier(result.error)
            ? "تعذر إكمال استعادة كلمة المرور. راجع البيانات وحاول مرة أخرى."
            : getAuthErrorMessage(
                result.error,
                "تعذر إكمال استعادة كلمة المرور. راجع البيانات وحاول مرة أخرى.",
              ),
        );
        return;
      }
      if (signIn.status === "complete") {
        await finalizeSignIn();
      } else {
        setErrorMessage(
          "تم تحديث كلمة المرور، لكن تعذر إكمال تسجيل الدخول. ارجع وسجّل الدخول مجدداً.",
        );
      }
    } catch (error) {
      setErrorMessage(
        isUnknownIdentifier(error)
          ? "تعذر إكمال استعادة كلمة المرور. راجع البيانات وحاول مرة أخرى."
          : getAuthErrorMessage(
              error,
              "تعذر إكمال استعادة كلمة المرور. راجع البيانات وحاول مرة أخرى.",
            ),
      );
    }
  };

  const signInWithProvider = async (
    strategy: "oauth_google" | "oauth_facebook",
  ) => {
    setErrorMessage("");
    setSuccessMessage("");
    const provider = strategy === "oauth_google" ? "google" : "facebook";
    setSocialLoading(provider);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy });
      const activated = await activateOAuthSession(
        createdSessionId,
        setActive,
        () => router.replace("/"),
      );
      if (!activated) {
        setErrorMessage("تم إيقاف تسجيل الدخول قبل اكتماله.");
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "تعذر تسجيل الدخول عبر مزود الخدمة. تحقق من اتصالك وحاول مرة أخرى.",
        ),
      );
    } finally {
      setSocialLoading(null);
    }
  };

  const secondFactorLabel = (strategy: SecondFactorStrategy) => {
    switch (strategy) {
      case "totp":
        return "تطبيق المصادقة";
      case "backup_code":
        return "رمز احتياطي";
      case "email_code":
        return "رمز عبر البريد الإلكتروني";
      case "phone_code":
        return "رمز عبر الهاتف";
    }
  };

  const title = requiresSecondFactor
    ? "تحقق من هويتك"
    : resetStep
      ? resetStep === "new-password"
        ? "كلمة مرور جديدة"
        : "استعادة كلمة المرور"
      : "مرحباً بعودتك";
  const subtitle = requiresSecondFactor
    ? "أكمل خطوة التحقق الإضافية للمتابعة."
    : resetStep
      ? resetStep === "new-password"
        ? "اختر كلمة مرور جديدة لحسابك."
        : `سنساعدك على استعادة الوصول${emailAddress ? ` إلى ${emailAddress}` : ""}.`
      : "سجّل الدخول للوصول إلى مساحة عملك.";

  return {
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
    focusedField,
    setFocusedField,
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
  };
}
