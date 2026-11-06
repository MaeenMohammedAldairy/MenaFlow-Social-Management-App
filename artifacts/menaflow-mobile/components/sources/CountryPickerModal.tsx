import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { CairoText as Text, CairoTextInput } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";
import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

interface CountryPickerModalProps {
  visible: boolean;
  selectedCountry: CountryCode;
  onSelectCountry: (country: CountryCode) => void;
  onClose: () => void;
}

export function CountryPickerModal({
  visible,
  selectedCountry,
  onSelectCountry,
  onClose,
}: CountryPickerModalProps) {
  const colors = useColors();
  const [countrySearch, setCountrySearch] = useState("");

  const countryNames = useMemo(
    () =>
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["ar"], { type: "region" })
        : null,
    [],
  );

  const phoneCountries = useMemo(
    () =>
      getCountries()
        .map((country) => ({
          country,
          name: countryNames?.of(country) ?? country,
          callingCode: getCountryCallingCode(country),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "ar")),
    [countryNames],
  );

  const visiblePhoneCountries = useMemo(() => {
    const search = countrySearch.trim().toLocaleLowerCase("ar");
    if (!search) return phoneCountries;
    return phoneCountries.filter(
      ({ country, name, callingCode }) =>
        name.toLocaleLowerCase("ar").includes(search) ||
        country.toLowerCase().includes(search) ||
        `+${callingCode}`.includes(search),
    );
  }, [countrySearch, phoneCountries]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.countryPickerDialog,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
            اختر بلد رقم واتساب
          </Text>
          <CairoTextInput
            accessibilityLabel="البحث عن بلد"
            placeholder="ابحث عن البلد أو مفتاح الدولة"
            placeholderTextColor={colors.mutedForeground}
            value={countrySearch}
            onChangeText={setCountrySearch}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.dialogInput,
              styles.countrySearchInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.countryList}
            contentContainerStyle={styles.countryListContent}
          >
            {visiblePhoneCountries.map(({ country, name, callingCode }) => {
              const selected = country === selectedCountry;
              return (
                <Pressable
                  key={country}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onSelectCountry(country);
                    setCountrySearch("");
                    onClose();
                  }}
                  style={[
                    styles.countryOption,
                    {
                      backgroundColor: selected
                        ? colors.accent
                        : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.countryCallingCode,
                      { color: colors.primary },
                    ]}
                  >
                    +{callingCode}
                  </Text>
                  <Text
                    style={[
                      styles.countryName,
                      { color: colors.foreground },
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              );
            })}
            {visiblePhoneCountries.length === 0 ? (
              <Text
                style={[
                  styles.phoneNumberHint,
                  { color: colors.mutedForeground },
                ]}
              >
                لا توجد نتائج مطابقة.
              </Text>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[
              styles.dialogButton,
              { borderColor: colors.border, marginTop: 4 },
            ]}
          >
            <Text
              style={[
                styles.dialogButtonLabel,
                { color: colors.foreground },
              ]}
            >
              إغلاق
            </Text>
          </Pressable>
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
  countryPickerDialog: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "80%",
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  dialogTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" },
  dialogInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    textAlign: "right",
    fontSize: 14,
  },
  countrySearchInput: { textAlign: "right" },
  countryList: { minHeight: 160, maxHeight: 360 },
  countryListContent: { gap: 7, paddingVertical: 2 },
  countryOption: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  countryName: { flex: 1, fontSize: 13, textAlign: "right" },
  countryCallingCode: {
    minWidth: 48,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "left",
    writingDirection: "ltr",
  },
  phoneNumberHint: { fontSize: 11, lineHeight: 17, textAlign: "right" },
  dialogButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogButtonLabel: { fontSize: 13, fontWeight: "800" },
});
