import { Pressable, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const offline = useNetworkStatus();
  const colors = useColors();
  const queryClient = useQueryClient();
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        { backgroundColor: colors.secondary, borderColor: colors.border },
      ]}
    >
      <Icon name="wifi-off" size={16} color={colors.destructive} />
      <Text style={[styles.message, { color: colors.foreground }]}>
        لا يوجد اتصال بالإنترنت. تُعرض آخر بيانات محفوظة.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إعادة محاولة الاتصال"
        onPress={() => void queryClient.refetchQueries({ type: "active" })}
        style={styles.retry}
        hitSlop={8}
      >
        <Text style={[styles.retryLabel, { color: colors.primary }]}>
          إعادة المحاولة
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  message: { flex: 1, fontSize: 13.5, textAlign: "right" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8, paddingVertical: 4 },
  retryLabel: { fontSize: 13.5, fontWeight: "700" },
});
