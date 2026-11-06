import { Pressable, StyleSheet, View } from "react-native";
import { Link } from "expo-router";
import {
  BrandHeader,
  Page,
  PageTitle,
  Panel,
  SectionTitle,
} from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon, type LucideIconName } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";

const destinations: Array<{
  title: string;
  description: string;
  icon: LucideIconName;
  path:
    | "/(tabs)/more/sources"
    | "/(tabs)/more/reports"
    | "/(tabs)/more/settings";
}> = [
  {
    title: "المصادر والحسابات",
    description: "إدارة حسابات التواصل ومزامنة مصادر المحتوى",
    icon: "share-2",
    path: "/(tabs)/more/sources",
  },
  {
    title: "التقارير",
    description: "مراجعة أداء المحتوى والمنشورات",
    icon: "bar-chart-2",
    path: "/(tabs)/more/reports",
  },
  {
    title: "الإعدادات",
    description: "تفضيلات التطبيق والخصوصية والحساب",
    icon: "settings",
    path: "/(tabs)/more/settings",
  },
];

export default function MoreScreen() {
  const colors = useColors();

  return (
    <Page>
      <BrandHeader />
      <PageTitle title="المزيد" subtitle="إدارة التطبيق وحساباتك." />
      <Panel>
        <SectionTitle title="الإدارة" />
        <View style={styles.destinations}>
          {destinations.map((destination) => (
            <Link key={destination.path} href={destination.path} asChild>
              <Pressable
                accessibilityRole="button"
                style={StyleSheet.flatten([
                  styles.destination,
                  { borderBottomColor: colors.border },
                ])}
              >
                <View pointerEvents="none" style={styles.destinationContent}>
                  <View
                    style={[
                      styles.destinationIcon,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    <Icon
                      name={destination.icon}
                      size={18}
                      color={colors.primary}
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
                    color={colors.mutedForeground}
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
  destinations: {
    gap: 2,
  },
  destination: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  destinationContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  destinationIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  destinationCopy: {
    flex: 1,
    alignItems: "flex-start",
    gap: 3,
  },
  destinationTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  destinationDescription: {
    fontSize: 11,
    textAlign: "right",
  },
});
