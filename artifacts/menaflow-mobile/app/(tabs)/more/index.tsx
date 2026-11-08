import { Pressable, StyleSheet, View } from "react-native";
import { Link } from "expo-router";
import {
  BrandHeader,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon, type LucideIconName } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";

const destinations: Array<{
  title: string;
  description: string;
  icon: LucideIconName;
  accent: "primary" | "blue" | "purple";
  path:
    | "/(tabs)/more/sources"
    | "/(tabs)/more/reports"
    | "/(tabs)/more/settings";
}> = [
  {
    title: "المصادر والحسابات",
    description: "إدارة حسابات التواصل ومزامنة مصادر المحتوى",
    icon: "share-2",
    accent: "primary",
    path: "/(tabs)/more/sources",
  },
  {
    title: "التقارير",
    description: "مراجعة أداء المحتوى والمنشورات",
    icon: "bar-chart-2",
    accent: "blue",
    path: "/(tabs)/more/reports",
  },
  {
    title: "الإعدادات",
    description: "تفضيلات التطبيق والخصوصية والحساب",
    icon: "settings",
    accent: "purple",
    path: "/(tabs)/more/settings",
  },
];

export default function MoreScreen() {
  const colors = useColors();

  return (
    <Page>
      <BrandHeader />
      <PageTitle title="المزيد" subtitle="إدارة التطبيق وحساباتك." />
      <Panel style={styles.managementPanel}>
        <View style={styles.sectionHeading}>
          <View
            style={[styles.sectionIcon, { backgroundColor: colors.accent }]}
          >
            <Icon name="more-horizontal" size={17} color={colors.primary} />
          </View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            الإدارة
          </Text>
          <View style={[styles.countBadge, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.countText, { color: colors.foreground }]}>
              {destinations.length}
            </Text>
          </View>
        </View>
        <View style={styles.destinations}>
          {destinations.map((destination, index) => (
            <Link key={destination.path} href={destination.path} asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${destination.title}: ${destination.description}`}
                style={({ pressed }) => StyleSheet.flatten([
                  styles.destination,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    opacity: pressed ? 0.78 : 1,
                  },
                  index === 0 && styles.destinationFirst,
                  index === destinations.length - 1 && styles.destinationLast,
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
    </Page>
  );
}

const styles = StyleSheet.create({
  managementPanel: { gap: 14 },
  sectionHeading: {
    flexDirection: "row-reverse",
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
  countText: { fontSize: 11, fontWeight: "800" },
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
    flexDirection: "row-reverse",
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
    fontSize: 11,
    lineHeight: 17,
    textAlign: "right",
  },
});
