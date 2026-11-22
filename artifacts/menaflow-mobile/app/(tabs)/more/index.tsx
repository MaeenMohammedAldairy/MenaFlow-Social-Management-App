import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Link, useNavigation } from "expo-router";
import {
  BrandHeader,
  Page,
  Panel,
} from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon, type LucideIconName } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";

const destinationGroups: Array<{
  title: string;
  icon: LucideIconName;
  destinations: Array<{
  title: string;
  description: string;
  icon: LucideIconName;
  accent: "primary" | "blue" | "purple";
  params?: { returnTo: "settings" };
  path:
    | "/(tabs)/more/orders"
    | "/(tabs)/more/sources"
    | "/(tabs)/more/accounts"
    | "/(tabs)/more/channels"
    | "/(tabs)/more/reports"
    | "/(tabs)/more/settings"
    | "/inbox/reply-settings"
    | "/activities";
  }>;
}> = [
  {
    title: "إدارة الأعمال",
    icon: "shopping-bag",
    destinations: [
      {
        title: "الطلبات",
        description: "تسجيل طلبات العملاء ومتابعة تجهيزها",
        icon: "shopping-bag",
        accent: "primary",
        path: "/(tabs)/more/orders",
      },
      {
        title: "التقارير",
        description: "مراجعة حالات المحتوى وتوزيعه على القنوات",
        icon: "bar-chart-2",
        accent: "blue",
        path: "/(tabs)/more/reports",
      },
      {
        title: "سجل الأنشطة",
        description: "عرض الرسائل والتعليقات والمنشورات والمنتجات الأخيرة",
        icon: "clock",
        accent: "blue",
        path: "/activities",
      },
    ],
  },
  {
    title: "القنوات والإعداد",
    icon: "share-2",
    destinations: [
      {
        title: "القنوات",
        description:
          "حسابات النشر وواتساب والنشر التلقائي والرد الآلي في شاشة واحدة",
        icon: "share-2",
        accent: "primary",
        path: "/(tabs)/more/channels",
      },
    ],
  },
  {
    title: "الحساب والتفضيلات",
    icon: "user",
    destinations: [
      {
        title: "الإعدادات",
        description: "إدارة الحساب ومساحة العمل والاشتراك والتفضيلات",
        icon: "settings",
        accent: "purple",
        path: "/(tabs)/more/settings",
      },
    ],
  },
];

type TabNavigation = {
  addListener(type: "tabPress", listener: () => void): () => void;
};

export default function MoreScreen() {
  const colors = useColors();
  // Press feedback lives in state because <Link asChild> renders the card
  // through Radix Slot, which drops function styles (`{...fn}` is `{}`).
  const [pressedDestination, setPressedDestination] = useState<string | null>(
    null,
  );
  const navigation = useNavigation();

  useEffect(() => {
    const tabsNavigation = navigation.getParent<TabNavigation>();
    if (!tabsNavigation) return;

    return tabsNavigation.addListener("tabPress", () => {
      if ((navigation.getState()?.index ?? 0) > 0) {
        navigation.dispatch({ type: "POP_TO_TOP" });
      }
    });
  }, [navigation]);

  return (
    <Page>
      <BrandHeader title="المزيد" subtitle="إدارة التطبيق ومصادر بياناتك وحسابات النشر." />
      {destinationGroups.map((group) => (
        <Panel key={group.title} style={styles.managementPanel}>
          <View style={styles.sectionHeading}>
            <View
              style={[styles.sectionIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name={group.icon} size={17} color={colors.primary} />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {group.title}
            </Text>
            <View
              style={[styles.countBadge, { backgroundColor: colors.secondary }]}
            >
              <Text style={[styles.countText, { color: colors.foreground }]}>
                {group.destinations.length}
              </Text>
            </View>
          </View>
          <View style={styles.destinations}>
            {group.destinations.map((destination, index) => (
              <Link
                key={`${destination.title}-${destination.path}`}
                href={{
                  pathname: destination.path,
                  ...(destination.params ? { params: destination.params } : {}),
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${destination.title}: ${destination.description}`}
                  onPressIn={() =>
                    setPressedDestination(
                      `${destination.title}-${destination.path}`,
                    )
                  }
                  onPressOut={() => setPressedDestination(null)}
                  style={StyleSheet.flatten([
                    styles.destination,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      opacity:
                        pressedDestination ===
                        `${destination.title}-${destination.path}`
                          ? 0.78
                          : 1,
                    },
                    index === 0 && styles.destinationFirst,
                    index === group.destinations.length - 1 &&
                      styles.destinationLast,
                  ])}
                >
                  <View pointerEvents="none" style={styles.destinationContent}>
                    <View
                      style={[
                        styles.destinationIcon,
                        {
                          backgroundColor:
                            destination.accent === "blue"
                              ? colors.blueSoft
                              : destination.accent === "purple"
                                ? colors.secondary
                                : colors.accent,
                        },
                      ]}
                    >
                      <Icon
                        name={destination.icon}
                        size={18}
                        color={
                          destination.accent === "blue"
                            ? colors.blue
                            : destination.accent === "purple"
                              ? colors.foreground
                              : colors.primary
                        }
                      />
                    </View>
                    <View style={styles.destinationCopy}>
                      <Text
                        style={[
                          styles.destinationTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {destination.title}
                      </Text>
                      <Text
                        style={[
                          styles.destinationDescription,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {destination.description}
                      </Text>
                    </View>
                    <Icon
                      name="chevron-left"
                      size={18}
                      color={colors.primary}
                    />
                  </View>
                </Pressable>
              </Link>
            ))}
          </View>
        </Panel>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  managementPanel: { gap: 14 },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: "800", textAlign: "right" },
  countBadge: {
    minWidth: 27,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 7,
  },
  countText: { fontSize: 12, fontWeight: "800" },
  destinations: {
    gap: 9,
  },
  destination: {
    minHeight: 78,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  destinationFirst: { marginTop: 1 },
  destinationLast: { marginBottom: 1 },
  destinationContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  destinationIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  destinationCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 4,
  },
  destinationTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  destinationDescription: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "right",
  },
});
