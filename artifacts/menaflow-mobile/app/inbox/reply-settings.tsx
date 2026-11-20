import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { BrandHeader, Page } from "@/components/Ui";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon, type LucideIconName } from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";
import { MetaAutoReplySettingsPanel } from "@/components/inbox/MetaAutoReplySettingsPanel";
import { WhatsAppReplyPanel } from "../whatsapp-setup";

type ReplyChannelTab = "meta" | "whatsapp";

const channelTabs: Array<{
  value: ReplyChannelTab;
  label: string;
  icon: LucideIconName;
}> = [
  { value: "meta", label: "فيسبوك وإنستغرام", icon: "facebook" },
  { value: "whatsapp", label: "واتساب", icon: "whatsapp" },
];

export default function ReplySettingsScreen() {
  if (isLocalAuthDisabled) {
    return <ReplySettingsContent userId={null} />;
  }
  return <AuthenticatedReplySettings />;
}

function AuthenticatedReplySettings() {
  const { userId } = useAuth();
  return <ReplySettingsContent userId={userId ?? null} />;
}

function ReplySettingsContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { tab, returnTo } = useLocalSearchParams<{
    tab?: string;
    returnTo?: string;
  }>();
  const [activeTab, setActiveTab] = useState<ReplyChannelTab>(
    tab === "whatsapp" ? "whatsapp" : "meta",
  );

  // Deep links such as /inbox/reply-settings?tab=whatsapp switch the tab
  // without remounting the screen from a different route.
  useEffect(() => {
    if (tab === "meta" || tab === "whatsapp") setActiveTab(tab);
  }, [tab]);

  return (
    <Page>
      <BrandHeader
        title="الرد الآلي"
        back={{ href: "/(tabs)/inbox", label: "العودة إلى المحادثات" }}
      />
      <View
        accessibilityRole="tablist"
        style={[
          styles.tabBar,
          { backgroundColor: colors.secondary, borderColor: colors.border },
        ]}
      >
        {channelTabs.map((item) => {
          const selected = activeTab === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="tab"
              accessibilityLabel={`إعدادات الرد الآلي على ${item.label}`}
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(item.value)}
              style={[
                styles.tab,
                selected && {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <LucideIcon
                name={item.icon}
                size={15}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  {
                    color: selected ? colors.primary : colors.mutedForeground,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "meta" ? (
        <MetaAutoReplySettingsPanel
          userId={userId}
          onOpenWhatsApp={() => setActiveTab("whatsapp")}
        />
      ) : (
        <WhatsAppReplyPanel returnTo={returnTo} />
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 11,
    paddingHorizontal: 8,
  },
  tabLabel: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
});
