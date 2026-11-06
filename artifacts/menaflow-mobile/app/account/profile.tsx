import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useUser } from "@clerk/expo";
import { CairoText as Text } from "@/components/CairoTypography";
import { ActionButton, BrandHeader, Page, PageTitle, Panel, SectionTitle } from "@/components/Ui";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { isLocalAuthDisabled } from "@/constants/auth";
import { useColors } from "@/hooks/useColors";
import { formatArabicDate } from "@/lib/formatting";

export default function ProfileScreen() {
  if (isLocalAuthDisabled) return <LocalProfileScreen />;
  return <AuthenticatedProfileScreen />;
}

function LocalProfileScreen() {
  const colors = useColors();

  return (
    <Page>
      <BrandHeader />
      <PageTitle title="الملف الشخصي" subtitle="إعداد حساب المستخدم." />
      <Panel style={styles.panel}>
        <SectionTitle title="وضع التطوير المحلي" />
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          لا توجد جلسة مستخدم موثقة في وضع التطوير المحلي. سجّل الدخول عبر Clerk لتعديل ملفك الشخصي وحفظ الإعداد.
        </Text>
        <ActionButton
          label="العودة إلى الإعدادات"
          icon="settings"
          secondary
          onPress={() => router.replace("/(tabs)/settings")}
        />
      </Panel>
    </Page>
  );
}

function AuthenticatedProfileScreen() {
  const colors = useColors();
  const { user, isLoaded } = useUser();
  const legacyDisplayName =
    typeof user?.unsafeMetadata.displayName === "string"
      ? user.unsafeMetadata.displayName
      : "";
  const fallbackName = user?.fullName?.trim() || legacyDisplayName.trim();
  const fallbackParts = fallbackName.split(/\s+/).filter(Boolean);
  const initialFirstName = user?.firstName ?? fallbackParts[0] ?? "";
  const initialLastName = user?.lastName ?? fallbackParts.slice(1).join(" ");
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [savedFirstName, setSavedFirstName] = useState(initialFirstName);
  const [savedLastName, setSavedLastName] = useState(initialLastName);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const changed =
    firstName.trim() !== savedFirstName.trim() ||
    lastName.trim() !== savedLastName.trim();
  const emailAddress = user?.primaryEmailAddress;
  const emailVerified = emailAddress?.verification?.status === "verified";
  const accountCreatedAt = user?.createdAt
    ? formatArabicDate(user.createdAt, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }) ?? "غير متاح"
    : "غير متاح";

  useEffect(() => {
    setFirstName(initialFirstName);
    setLastName(initialLastName);
    setSavedFirstName(initialFirstName);
    setSavedLastName(initialLastName);
    setErrorMessage("");
    setSuccessMessage("");
  }, [user?.id, initialFirstName, initialLastName]);

  const saveProfile = async () => {
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    if (!user || saving) return;
    if (!normalizedFirstName) {
      setErrorMessage("الاسم الأول مطلوب.");
      setSuccessMessage("");
      return;
    }
    if (normalizedFirstName.length > 50 || normalizedLastName.length > 50) {
      setErrorMessage("يجب ألا يتجاوز كل جزء من الاسم 50 حرفاً.");
      setSuccessMessage("");
      return;
    }
    if (!changed) return;

    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await user.update({
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
      });
      setFirstName(normalizedFirstName);
      setLastName(normalizedLastName);
      setSavedFirstName(normalizedFirstName);
      setSavedLastName(normalizedLastName);
      setSuccessMessage("تم حفظ اسمك في حسابك.");
    } catch {
      setErrorMessage(
        "تعذر حفظ الاسم. تحقق من الاتصال ومن السماح بتعديل الاسم في إعدادات Clerk، ثم أعد المحاولة.",
      );
    } finally {
      setSaving(false);
    }
  };

  const resetChanges = () => {
    setFirstName(savedFirstName);
    setLastName(savedLastName);
    setErrorMessage("");
    setSuccessMessage("");
  };

  return (
    <Page>
      <BrandHeader />
      <PageTitle
        title="حساب المستخدم"
        subtitle="إدارة بيانات ملفك الشخصي ومعلومات تسجيل الدخول."
        action={
          <ActionButton
            label="الإعدادات"
            icon="settings"
            secondary
            onPress={() => router.replace("/(tabs)/settings")}
          />
        }
      />
      <Panel style={styles.panel}>
        <SectionTitle title="الملف الشخصي" />
        {!isLoaded ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.message, { color: colors.mutedForeground }]}>
              جارٍ تحميل بيانات الحساب…
            </Text>
          </View>
        ) : !user ? (
          <View style={styles.empty}>
            <Text style={[styles.message, { color: colors.mutedForeground }]}>
              لم نعثر على جلسة مستخدم نشطة. سجّل الدخول مجدداً لعرض بيانات حسابك.
            </Text>
            <ActionButton
              label="العودة إلى الإعدادات"
              icon="settings"
              secondary
              onPress={() => router.replace("/(tabs)/settings")}
            />
          </View>
        ) : (
          <>
            <View style={styles.identity}>
              {user.imageUrl ? (
                <Image
                  source={{ uri: user.imageUrl }}
                  accessibilityLabel="الصورة الشخصية"
                  style={[styles.avatar, { backgroundColor: colors.secondary }]}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accent }]}>
                  <Icon name="user" size={26} color={colors.primary} />
                </View>
              )}
              <View style={styles.identityCopy}>
                <Text style={[styles.identityName, { color: colors.foreground }]}>
                  {displayName || "أكمل اسمك"}
                </Text>
                <Text style={[styles.identityEmail, { color: colors.mutedForeground }]}>
                  {emailAddress?.emailAddress || "لا يوجد بريد إلكتروني"}
                </Text>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: displayName ? colors.primary : colors.warning },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusText,
                      { color: displayName ? colors.primary : colors.warning },
                    ]}
                  >
                    {displayName ? "الملف الشخصي مكتمل" : "أكمل اسمك"}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={[styles.label, { color: colors.foreground }]}>الاسم الأول</Text>
            <TextInput
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setSuccessMessage("");
              }}
              placeholder="أدخل اسمك الأول"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              maxLength={50}
              returnKeyType="next"
              accessibilityLabel="الاسم الأول"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>اسم العائلة (اختياري)</Text>
            <TextInput
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setSuccessMessage("");
              }}
              placeholder="أدخل اسم العائلة"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="familyName"
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={() => void saveProfile()}
              accessibilityLabel="اسم العائلة"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>البريد الإلكتروني</Text>
            <TextInput
              value={emailAddress?.emailAddress ?? "لا يوجد بريد إلكتروني"}
              editable={false}
              accessibilityHint="لإدارة البريد الإلكتروني، استخدم إعدادات تسجيل الدخول في Clerk."
              accessibilityLabel="البريد الإلكتروني"
              style={[
                styles.input,
                styles.emailInput,
                styles.readOnlyInput,
                {
                  color: colors.mutedForeground,
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                },
              ]}
            />
            <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>
                {emailVerified ? "تم التحقق من البريد" : "البريد غير موثق"}
              </Text>
              <View style={styles.infoLabel}>
                <Icon
                  name={emailVerified ? "check-circle" : "alert-circle"}
                  size={16}
                  color={emailVerified ? colors.primary : colors.warning}
                />
                <Text style={[styles.infoTitle, { color: colors.mutedForeground }]}>
                  حالة البريد
                </Text>
              </View>
            </View>
            <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>
                {accountCreatedAt}
              </Text>
              <View style={styles.infoLabel}>
                <Icon name="user" size={16} color={colors.mutedForeground} />
                <Text style={[styles.infoTitle, { color: colors.mutedForeground }]}>
                  تاريخ إنشاء الحساب
                </Text>
              </View>
            </View>
            {errorMessage ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                {errorMessage}
              </Text>
            ) : null}
            {successMessage ? (
              <Text accessibilityRole="text" style={[styles.success, { color: colors.primary }]}>
                {successMessage}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !changed || !firstName.trim() || saving, busy: saving }}
              disabled={!changed || !firstName.trim() || saving}
              onPress={() => void saveProfile()}
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: colors.primary,
                  opacity: !changed || !firstName.trim() || saving ? 0.55 : pressed ? 0.82 : 1,
                },
              ]}
            >
              {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
              <Text style={[styles.saveLabel, { color: colors.primaryForeground }]}>
                {saving ? "جارٍ حفظ التغييرات…" : "حفظ التغييرات"}
              </Text>
            </Pressable>
            {changed ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={resetChanges}
                style={({ pressed }) => [styles.cancelButton, { opacity: saving ? 0.5 : pressed ? 0.65 : 1 }]}
              >
                <Text style={[styles.cancelLabel, { color: colors.mutedForeground }]}>
                  استعادة الاسم المحفوظ
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  message: { fontSize: 12, lineHeight: 20, textAlign: "left" },
  loading: { flexDirection: "row", alignItems: "center", gap: 9 },
  empty: { gap: 14 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  identityCopy: { flex: 1, alignItems: "flex-start", gap: 4 },
  identityName: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  identityEmail: { fontSize: 11, textAlign: "left", writingDirection: "ltr" },
  avatar: { width: 62, height: 62, borderRadius: 31 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "700", textAlign: "left" },
  label: { fontSize: 12, fontWeight: "700", textAlign: "right", marginBottom: -8 },
  input: {
    minHeight: 46,
    width: "100%",
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    fontFamily: "Cairo_400Regular",
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
    outlineStyle: "none",
  } as never,
  emailInput: { textAlign: "left", writingDirection: "ltr" },
  readOnlyInput: { opacity: 0.86 },
  error: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  success: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  infoRow: {
    minHeight: 42,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  infoLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  infoTitle: { fontSize: 11, textAlign: "right" },
  infoValue: { flexShrink: 1, fontSize: 11, fontWeight: "700", textAlign: "left" },
  saveButton: {
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  },
  saveLabel: { fontSize: 13, fontWeight: "800" },
  cancelButton: { minHeight: 34, alignItems: "center", justifyContent: "center" },
  cancelLabel: { fontSize: 12, fontWeight: "700" },
});
