import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";

export default function SsoCallbackRoute() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.label, { color: colors.foreground }]}>
        جارٍ إكمال تسجيل الدخول...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  label: {
    fontSize: 16,
  },
});
