import { Pressable, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { useColors } from "@/hooks/useColors";

export type InboxPlatform = "all" | "whatsapp" | "facebook" | "instagram";

const tabs: Array<{ key: InboxPlatform; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "whatsapp", label: "واتساب" },
  { key: "facebook", label: "فيسبوك" },
  { key: "instagram", label: "إنستغرام" },
];

export function InboxPlatformTabs({
  activePlatform,
  onSelect,
}: {
  activePlatform: InboxPlatform;
  onSelect: (platform: InboxPlatform) => void;
}) {
  const colors = useColors();

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.tabs, { backgroundColor: colors.secondary }]}
    >
      {tabs.map((tab) => {
        const selected = tab.key === activePlatform;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: selected ? colors.card : "transparent",
                borderColor: selected ? colors.border : "transparent",
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            {tab.key !== "all" ? (
              <SocialPlatformIcon platform={tab.key} size={16} />
            ) : (
              <Icon
                name="message-square"
                size={16}
                color={selected ? colors.primary : colors.mutedForeground}
              />
            )}
            <Text
              numberOfLines={1}
              style={[
                styles.tabLabel,
                {
                  color: selected ? colors.foreground : colors.mutedForeground,
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 3,
    padding: 4,
    borderRadius: 13,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  tabLabel: { fontSize: 10, fontWeight: "700" },
});
