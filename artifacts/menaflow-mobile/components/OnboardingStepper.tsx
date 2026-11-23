import React from "react";
import { StyleSheet, View } from "react-native";
import { Check } from "lucide-react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useAuthTheme } from "@/hooks/useAuthTheme";

const labels = ["النشاط التجاري", "ربط الحسابات", "الأتمتة والردود", "الانطلاق"];

export function OnboardingStepper({ activeIndex }: { activeIndex: number }) {
  const theme = useAuthTheme();
  return (
    <View style={styles.row} accessible accessibilityRole="progressbar"
      accessibilityLabel={`الخطوة ${activeIndex + 1} من 4`}
      accessibilityValue={{ min: 1, max: 4, now: activeIndex + 1 }}>
      {labels.map((label, index) => (
        <React.Fragment key={label}>
          {index > 0 && <View style={[styles.line, { backgroundColor: index <= activeIndex ? theme.primary : theme.border }]} />}
          <View style={styles.item}>
            <View style={[styles.circle, { backgroundColor: index <= activeIndex ? theme.primary : theme.card, borderColor: index <= activeIndex ? theme.primary : theme.border }]}>
              {index < activeIndex ? <Check size={14} color={theme.primaryForeground} strokeWidth={3} /> : <Text style={{ color: index === activeIndex ? theme.primaryForeground : theme.mutedForeground, fontWeight: "800" }}>{index + 1}</Text>}
            </View>
            <Text numberOfLines={2} style={[styles.label, { color: index <= activeIndex ? theme.foreground : theme.mutedForeground }]}>{label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  item: { flex: 1, alignItems: "center", gap: 4 },
  line: { width: 12, height: 2, marginTop: 15 },
  circle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 10, lineHeight: 15, textAlign: "center", fontWeight: "700" },
});
