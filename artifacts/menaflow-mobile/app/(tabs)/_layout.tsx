import React from "react";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { OwnerGuard } from "@/components/OwnerGuard";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import {
  getGetSocialConnectionsQueryKey,
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  getSocialConnections,
} from "@workspace/api-client-react";
import { isLocalAuthDisabled } from "@/constants/auth";

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
// NativeTabs intentionally does NOT use custom design tokens — liquid glass
// is a system-level appearance provided by iOS and cannot be overridden.
// Custom brand colors are applied only on the ClassicTabLayout path (older iOS / Android / web).
function NativeTabLayout({ hidden }: { hidden: boolean }) {
  return (
    <NativeTabs hidden={hidden}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
        <NativeTabs.Trigger.Label>الرئيسية</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="content">
        <NativeTabs.Trigger.Icon sf="doc.text" md="article" />
        <NativeTabs.Trigger.Label>المحتوى</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="forum" />
        <NativeTabs.Trigger.Label>الوارد</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sources">
        <NativeTabs.Trigger.Icon
          sf="point.3.connected.trianglepath.dotted"
          md="hub"
        />
        <NativeTabs.Trigger.Label>المصادر</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reports">
        <NativeTabs.Trigger.Icon sf="chart.bar" md="bar_chart" />
        <NativeTabs.Trigger.Label>التقارير</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>الإعدادات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ hidden }: { hidden: boolean }) {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: "Cairo_700Bold" },
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
          ...(hidden ? { display: "none" as const } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "الرئيسية",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Icon name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: "المحتوى",
          tabBarIcon: ({ color }) => (
            <Icon name="file-text" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "الوارد",
          tabBarIcon: ({ color }) => (
            <Icon name="message-square" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sources"
        options={{
          title: "المصادر",
          tabBarIcon: ({ color }) => (
            <Icon name="share-2" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "التقارير",
          tabBarIcon: ({ color }) => (
            <Icon name="bar-chart-2" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "الإعدادات",
          tabBarIcon: ({ color }) => (
            <Icon name="settings" size={21} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <OwnerGuard>
      {isLocalAuthDisabled ? (
        <TabNavigation hidden={false} />
      ) : (
        <AuthenticatedTabNavigation />
      )}
    </OwnerGuard>
  );
}

function AuthenticatedTabNavigation() {
  const { userId } = useAuth();
  const onboarding = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId ?? null),
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(userId),
    retry: false,
  });
  const connections = useQuery({
    queryKey: [...getGetSocialConnectionsQueryKey(), userId ?? "signed-out"],
    queryFn: () => getSocialConnections(),
    enabled: Boolean(userId),
    retry: false,
  });
  const hasConnectedSocialAccount = Boolean(
    connections.data?.facebook ||
    connections.data?.instagram ||
    connections.data?.whatsapp?.connectionState === "connected",
  );
  const setupIncomplete =
    onboarding.data?.completed === true &&
    !onboarding.data.socialAccountsCompleted;

  return (
    <TabNavigation
      hidden={
        setupIncomplete && (connections.isPending || !hasConnectedSocialAccount)
      }
    />
  );
}

function TabNavigation({ hidden }: { hidden: boolean }) {
  return isLiquidGlassAvailable() ? (
    <NativeTabLayout hidden={hidden} />
  ) : (
    <ClassicTabLayout hidden={hidden} />
  );
}
