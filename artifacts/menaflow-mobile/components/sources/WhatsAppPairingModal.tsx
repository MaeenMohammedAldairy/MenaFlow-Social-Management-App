import React from "react";
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
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
  formattedInternationalPhone?: string;
  parsedCallingCode?: string;
  onChangeInput: (updater: (prev: WhatsAppInputState | null) => WhatsAppInputState | null) => void;
  onOpenCountryPicker: () => void;
  onSubmit: (requestNewCode?: boolean) => void;
  onClose: () => void;
}

export function WhatsAppPairingModal({
  input,
  phoneCountry,
  isExistingConnection,
  busy,
  error,
  formattedInternationalPhone,
  parsedCallingCode,
  onChangeInput,
  onOpenCountryPicker,
  onSubmit,
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
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.whatsappDialog,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
            {isExistingConnection ? "إعادة ربط واتساب" : "ربط واتساب"}
          </Text>
          {input.pairingCode ? (
            <>
              <Text
                style={[
                  styles.dialogDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                من تطبيق واتساب على هاتفك، افتح «الإعدادات» ثم «الأجهزة
                المرتبطة» واختر «ربط جهاز» ثم «الربط برقم الهاتف». أدخل الرمز
                التالي هناك، وسنتحقق تلقائيًا عند تأكيد الربط.
              </Text>
              <Text
                selectable
                style={[
                  styles.pairingCode,
                  { color: colors.primary, backgroundColor: colors.accent },
                ]}
              >
                {input.pairingCode}
              </Text>
              <Text
                style={[
                  styles.pairingPhoneNumber,
                  { color: colors.mutedForeground },
                ]}
              >
                هذا الرمز مخصص لرقم واتساب{" "}
                {formattedInternationalPhone || input.phoneNumber}
                . أدخله للحساب نفسه على هاتفك.
              </Text>
              <Text
                style={[styles.connectionProgress, { color: colors.primary }]}
              >
                بانتظار تأكيد الربط من واتساب…
              </Text>
              {input.qrCodeBase64 ? (
                <>
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
                      <Text
                        style={[
                          styles.pairingPhoneNumber,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        امسح الرمز من واتساب على هاتفك عبر «الأجهزة
                        المرتبطة» ثم «ربط جهاز». اعرض هذه الصفحة على جهاز
                        آخر.
                      </Text>
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
                style={styles.pairingRefresh}
              >
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.primary },
                  ]}
                >
                  الرقم غير صحيح؟ غيّره قبل طلب الرمز
                </Text>
              </Pressable>
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
                    : "لم يعمل الرمز؟ اطلب رمزًا جديدًا"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.dialogDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                {isExistingConnection
                  ? "أعد ربط حساب واتساب باستخدام الرقم المحفوظ، مع الاحتفاظ بإعداداتك ومجموعاتك."
                  : "اختر بلد الرقم واكتب رقم واتساب المحلي، ثم نعرض لك خطوات إكمال الربط."}
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
                {`مفتاح الدولة ${parsedCallingCode || `+${getCountryCallingCode(phoneCountry)}`} محدد. أدخل الرقم المحلي من دون المفتاح.`}
              </Text>
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
                {input.pairingCode ? "إغلاق" : "إلغاء"}
              </Text>
            </Pressable>
            {!input.pairingCode ? (
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
                  {busy ? "جارٍ الربط…" : "الحصول على رمز الربط"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
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
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogDescription: { fontSize: 12, lineHeight: 19, textAlign: "right" },
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
  phoneFieldRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  countryCodeButton: {
    minWidth: 92,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  countryCodeLabel: { fontSize: 14, fontWeight: "800" },
  dialogInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    textAlign: "right",
    fontSize: 14,
  },
  phoneInput: { flex: 1, textAlign: "right", writingDirection: "rtl" },
  phoneNumberHint: { fontSize: 11, lineHeight: 17, textAlign: "right" },
  dialogError: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  dialogActions: { flexDirection: "row-reverse", gap: 10, marginTop: 4 },
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
