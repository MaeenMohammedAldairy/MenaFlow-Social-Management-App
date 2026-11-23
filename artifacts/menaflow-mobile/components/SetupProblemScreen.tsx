import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";

export type SetupProblem = {
  title: string;
  detail: string;
  /** Environment variables or dashboard settings that must be fixed. */
  hints: string[];
};

/**
 * Full-screen message shown when the build is missing configuration instead of
 * throwing from the root layout.
 *
 * A thrown error at that point is not caught by our ErrorBoundary, so the app
 * used to die with a blank screen and no explanation. This screen names the
 * missing pieces (never their values) and offers a reload.
 */
export function SetupProblemScreen({ problem }: { problem: SetupProblem }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const reload = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: colors.secondary }]}>
            <Icon name="settings" size={26} color={colors.primary} />
          </View>
          <Text accessibilityRole="alert" style={[styles.title, { color: colors.foreground }]}>
            {problem.title}
          </Text>
          <Text style={[styles.detail, { color: colors.mutedForeground }]}>
            {problem.detail}
          </Text>

          <View style={[styles.hints, { borderColor: colors.border }]}>
            <Text style={[styles.hintsTitle, { color: colors.foreground }]}>
              المطلوب ضبطه
            </Text>
            {problem.hints.map((hint) => (
              <View key={hint} style={styles.hintRow}>
                <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                <Text
                  selectable
                  style={[styles.hintText, { color: colors.mutedForeground }]}
                >
                  {hint}
                </Text>
              </View>
            ))}
          </View>

          {Platform.OS === "web" ? (
            <Pressable
              accessibilityRole="button"
              onPress={reload}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Icon name="refresh-cw" size={17} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                أعد المحاولة بعد التصحيح
              </Text>
            </Pressable>
          ) : null}

          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            هذه الشاشة تظهر فقط عند نقص إعدادات البناء، ولا تُعرض للمستخدمين عند
            ضبط متغيّرات البيئة بشكل صحيح.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 24,
    borderWidth: 1,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, lineHeight: 30, fontWeight: "800", textAlign: "center" },
  detail: { fontSize: 14, lineHeight: 23, textAlign: "center" },
  hints: {
    width: "100%",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  hintsTitle: { fontSize: 14, fontWeight: "800", textAlign: "right" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bullet: { width: 6, height: 6, borderRadius: 3 },
  hintText: { flex: 1, fontSize: 13.5, lineHeight: 21, textAlign: "right" },
  button: {
    width: "100%",
    minHeight: 48,
    marginTop: 4,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { fontSize: 14, fontWeight: "800" },
  footnote: { fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 2 },
});
