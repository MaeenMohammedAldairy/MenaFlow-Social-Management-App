import React from "react";
import { StyleSheet, View } from "react-native";
import { CircleAlert, CircleCheck } from "lucide-react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useAuthTheme } from "@/hooks/useAuthTheme";

/**
 * Inline banner for an auth form result.
 *
 * The screens used to render the message as a bare line of coloured text at the
 * bottom of the card, below the primary button — easy to miss and detached from
 * the fields it is about. This keeps it above the call to action, in a tinted
 * bordered box with an icon.
 */
export function AuthAlert({
  message,
  tone = "error",
}: {
  message: string;
  tone?: "error" | "success";
}) {
  const theme = useAuthTheme();
  const isError = tone === "error";
  const Icon = isError ? CircleAlert : CircleCheck;
  const accent = isError ? theme.destructive : theme.primary;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: isError ? theme.dangerSurface : theme.primarySoft,
          borderColor: isError ? theme.dangerBorder : theme.border,
        },
      ]}
    >
      <Icon size={17} color={accent} />
      <Text style={[styles.text, { color: accent }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "right",
  },
});
