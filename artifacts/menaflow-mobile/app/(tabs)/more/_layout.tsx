import { useEffect } from "react";
import { Stack, useNavigation } from "expo-router";

export default function MoreStackLayout() {
  const navigation = useNavigation("/(tabs)/more");

  useEffect(() => {
    const tabsNavigation = navigation.getParent();
    if (!tabsNavigation) return;

    return tabsNavigation.addListener("blur", () => {
      if ((navigation.getState()?.index ?? 0) > 0) {
        navigation.dispatch({ type: "POP_TO_TOP" });
      }
    });
  }, [navigation]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
