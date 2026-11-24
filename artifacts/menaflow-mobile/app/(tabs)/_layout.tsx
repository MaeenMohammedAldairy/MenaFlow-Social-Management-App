import React, { useEffect } from "react";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView } from "expo-symbols";
import { LucideIcon as Icon } from "@/components/LucideIcon";

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
// NativeTabs intentionally does NOT use custom design tokens — liquid glass
// is a system-level appearance provided by iOS and cannot be overridden.
// Custom brand colors are applied only on the ClassicTabLayout path (older iOS / Android / web).
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
        <NativeTabs.Trigger.Label>الرئيسية</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Icon sf="shippingbox" md="inventory_2" />
        <NativeTabs.Trigger.Label>المنتجات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="content">
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit_note" />
        <NativeTabs.Trigger.Label>المنشورات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="forum" />
        <NativeTabs.Trigger.Label>المحادثات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf="ellipsis" md="more_horiz" />
        <NativeTabs.Trigger.Label>المزيد</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  useEffect(() => {
    if (!isWeb || typeof document === "undefined") return;

    const tabList = document.querySelector<HTMLElement>('[role="tablist"]');
    if (!tabList) return;

    const previousDirection = tabList.getAttribute("dir");
    tabList.setAttribute("dir", "rtl");

    return () => {
      if (previousDirection === null) {
        tabList.removeAttribute("dir");
      } else {
        tabList.setAttribute("dir", previousDirection);
      }
    };
  }, [isWeb]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: "Cairo_700Bold", fontSize: 12 },
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
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
        name="products"
        options={{
          title: "المنتجات",
          tabBarIcon: ({ color }) => (
            <Icon name="package" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: "المنشورات",
          tabBarIcon: ({ color }) => (
            <Icon name="file-text" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "المحادثات",
          tabBarIcon: ({ color }) => (
            <Icon name="message-square" size={21} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "المزيد",
          tabBarIcon: ({ color }) => (
            <Icon name="more-horizontal" size={21} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

/**
 * The tab bar is always visible, for every signed-in state.
 *
 * It used to hide while a merchant still owed a connected platform (onboarding
 * completed, `socialAccountsCompleted` false, no eligible connection). That
 * predates the concise-setup redesign and contradicts its core promise: the
 * product stays usable before setup is complete, with the dashboard checklist
 * ("خطوات البدء") doing the guiding instead of a wall. Hiding navigation blocked
 * المنتجات/المنشورات/المحادثات/المزيد outright — screens that need no connection
 * at all — so the bar lost the prop that hid it rather than keeping a dead one
 * that reads as if hiding were still possible.
 */
export default function TabLayout() {
  // The dev-mode auth bypass (`isLocalAuthDisabled`) reaches this layout the same
  // way a signed-in merchant does, and nothing in the tab tree differs between
  // them — the two branches of the old conditional rendered the same element.
  return <TabNavigation />;
}

function TabNavigation() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
