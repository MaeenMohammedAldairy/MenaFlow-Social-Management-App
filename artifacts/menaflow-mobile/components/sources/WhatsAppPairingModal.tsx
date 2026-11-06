import React from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  ScrollView,
  View,
} from "react-native";
import { CairoText as Text, CairoTextInput } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export type WhatsAppInputState = {
  phoneNumber: string;
  pairingCode?: string;
  qrCodeBase64?: string;
  showQrCode?: boolean;
};

interface WhatsAppPairingModalProps {
  input: WhatsAppInputState | null;
  phoneCountry: CountryCode;
  isExistingConnection: boolean;
  busy: boolean;
  error?: string;
  pairingTimedOut: boolean;
  formattedInternationalPhone?: string;
  parsedCallingCode?: string;
  onChangeInput: (updater: (prev: WhatsAppInputState | null) => WhatsAppInputState | null) => void;
  onOpenCountryPicker: () => void;
  onSubmit: (requestNewCode?: boolean) => void;
  onCheckAgain: () => void;
  onClose: () => void;
}

export function WhatsAppPairingModal({
  input,
  phoneCountry,
  isExistingConnection,
  busy,
  error,
  pairingTimedOut,
  formattedInternationalPhone,
  parsedCallingCode,
  onChangeInput,
  onOpenCountryPicker,
  onSubmit,
  onCheckAgain,
  onClose,
}: WhatsAppPairingModalProps) {
  const colors = useColors();

  if (!input) return null;

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalOverlay}
      >
        <View
          style={[
            styles.whatsappDialog,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.dialogContent}
          >
            <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
              {input.pairingCode || input.qrCodeBase64
                ? "تأكيد الربط"
                : isExistingConnection
                  ? "إعادة ربط واتساب"
                  : "ربط واتساب"}
            </Text>
          {input.pairingCode || input.qrCodeBase64 ? (
            <>
              <Text
                style={[
                  styles.dialogDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                {input.pairingCode
                  ? "من واتساب: الإعدادات ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف."
                  : "من واتساب: الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز."}
              </Text>
              {input.pairingCode ? (
                <Text
                  selectable
                  style={[
                    styles.pairingCode,
                    { color: colors.primary, backgroundColor: colors.accent },
                  ]}
                >
                  {input.pairingCode}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.pairingPhoneNumber,
                  { color: colors.mutedForeground },
                ]}
              >
                {`رقم واتساب: ${formattedInternationalPhone || input.phoneNumber}`}
              </Text>
              <Text
                style={[
                  styles.connectionProgress,
                  {
                    color: pairingTimedOut
                      ? colors.warning
                      : colors.primary,
                  },
                ]}
              >
                {pairingTimedOut
                  ? "لم يصل تأكيد الربط بعد."
                  : "بانتظار التأكيد…"}
              </Text>
              {input.qrCodeBase64 ? (
                <>
                  {input.pairingCode ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        onChangeInput((current) =>
                          current
                            ? { ...current, showQrCode: !current.showQrCode }
                            : current,
                        )
                      }
                      style={styles.pairingRefresh}
                    >
                      <Text
                        style={[
                          styles.secondaryActionLabel,
                          { color: colors.primary },
                        ]}
                      >
                        {input.showQrCode
                          ? "إخفاء رمز QR"
                          : "تعذّر إدخال الرمز؟ استخدم رمز QR"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {input.showQrCode ? (
                    <>
                      <Image
                        accessibilityLabel="رمز QR لربط واتساب"
                        source={{
                          uri: input.qrCodeBase64.startsWith("data:")
                            ? input.qrCodeBase64
                            : `data:image/png;base64,${input.qrCodeBase64}`,
                        }}
                        resizeMode="contain"
                        style={styles.pairingQr}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  onChangeInput((current) =>
                    current
                      ? {
                          phoneNumber: current.phoneNumber,
                        }
                      : current,
                  );
                }}
                style={[styles.pairingRefresh, { opacity: busy ? 0.6 : 1 }]}
              >
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.primary },
                  ]}
                >
                  تعديل الرقم
                </Text>
              </Pressable>
              {pairingTimedOut ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onCheckAgain}
                  style={[
                    styles.pairingRefresh,
                    { opacity: busy ? 0.6 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryActionLabel,
                      { color: colors.primary },
                    ]}
                  >
                    {busy ? "جارٍ التحقق…" : "التحقق من حالة الربط مجددًا"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onSubmit(true)}
                style={[
                  styles.pairingRefresh,
                  { opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.primary },
                  ]}
                >
                  {busy
                    ? "جارٍ إصدار رمز جديد…"
                    : pairingTimedOut
                      ? "إصدار رمز جديد"
                      : input.pairingCode
                        ? "لم يعمل الرمز؟ اطلب رمزًا جديدًا"
                        : "تعذّر المسح؟ اطلب رمزًا جديدًا"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.dialogDescription, { color: colors.mutedForeground }]}>
                {isExistingConnection
                  ? "أعد ربط الرقم الحالي أو أدخل رقمًا آخر."
                  : "اختر البلد وأدخل رقم واتساب."}
              </Text>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                رقم واتساب
              </Text>
              <View style={styles.phoneFieldRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`اختيار البلد، مفتاح الدولة +${getCountryCallingCode(phoneCountry)}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onOpenCountryPicker}
                  style={[
                    styles.countryCodeButton,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Icon
                    name="globe"
                    size={15}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.countryCodeLabel,
                      { color: colors.foreground },
                    ]}
                  >
                    +{getCountryCallingCode(phoneCountry)}
                  </Text>
                </Pressable>
                <CairoTextInput
                  accessibilityLabel="رقم هاتف واتساب"
                  placeholder="اكتب رقم الهاتف"
                  placeholderTextColor={colors.mutedForeground}
                  value={input.phoneNumber ?? ""}
                  onChangeText={(phoneNumber) =>
                    onChangeInput((current) =>
                      current ? { ...current, phoneNumber } : current,
                    )
                  }
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  style={[
                    styles.dialogInput,
                    styles.phoneInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.phoneNumberHint,
                  { color: colors.mutedForeground },
                ]}
              >
                {`الرقم المحلي فقط · ${parsedCallingCode || `+${getCountryCallingCode(phoneCountry)}`}`}
              </Text>
              <View
                style={[
                  styles.existingNumberNote,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Text
                  style={[
                    styles.existingNumberNoteText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  الرقم المرتبط بحساب آخر لا يُنقل تلقائيًا؛ افصله من الحساب
                  السابق أولًا.
                </Text>
              </View>
            </>
          )}
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.dialogError, { color: colors.destructive }]}
            >
              {error}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={[
                styles.dialogButton,
                { borderColor: colors.border, opacity: busy ? 0.6 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.dialogButtonLabel,
                  { color: colors.foreground },
                ]}
              >
                {busy
                  ? "جارٍ التنفيذ…"
                  : input.pairingCode
                    ? "إلغاء المحاولة"
                    : "إلغاء"}
              </Text>
            </Pressable>
            {!input.pairingCode && !input.qrCodeBase64 ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onSubmit(false)}
                style={[
                  styles.dialogButton,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dialogButtonLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {busy ? "جارٍ الإرسال…" : "إرسال الرمز"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  whatsappDialog: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "90%",
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  dialogContent: { gap: 12, padding: 20 },
  fieldLabel: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  pairingCode: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    textAlign: "center",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 3,
  },
  pairingPhoneNumber: { fontSize: 12, lineHeight: 19, textAlign: "center" },
  pairingQr: {
    width: 220,
    height: 220,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
  },
  pairingRefresh: { alignSelf: "center", paddingVertical: 8 },
  connectionProgress: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  phoneFieldRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  countryCodeButton: {
    minWidth: 92,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  countryCodeLabel: { fontSize: 14, fontWeight: "800", writingDirection: "ltr" },
  dialogInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    textAlign: "right",
    fontSize: 14,
  },
  phoneInput: { flex: 1, textAlign: "left", writingDirection: "ltr" },
  phoneNumberHint: { fontSize: 11, lineHeight: 17, textAlign: "left" },
  existingNumberNote: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  existingNumberNoteText: { fontSize: 11, lineHeight: 17, textAlign: "right" },
  dialogError: { fontSize: 12, lineHeight: 18, textAlign: "left" },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  dialogButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogButtonLabel: { fontSize: 13, fontWeight: "800" },
  secondaryActionLabel: { fontSize: 12, fontWeight: "700" },
});
