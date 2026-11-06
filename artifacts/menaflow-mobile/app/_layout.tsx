import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  useFonts,
  Cairo_200ExtraLight,
  Cairo_300Light,
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Cairo_900Black,
} from "@expo-google-fonts/cairo";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  getGetSocialConnectionsQueryKey,
  getGetOnboardingStatusQueryKey,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import { StudioProvider } from "@/context/StudioContext";
import { Platform, I18nManager } from "react-native";
import { isLocalAuthDisabled } from "@/constants/auth";
import { applyAppearanceMode, readAppearanceMode } from "@/lib/appearance";

if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
queryClient.setQueryDefaults(getGetSocialConnectionsQueryKey(), {
  staleTime: 30_000,
});
queryClient.setQueryDefaults(getGetOnboardingStatusQueryKey(), {
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});
const configuredPublicDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
const isPreviewBuild = process.env.EXPO_PUBLIC_APP_VARIANT === "preview";
if (!__DEV__ && !configuredPublicDomain) {
  throw new Error("Missing EXPO_PUBLIC_DOMAIN for a production API build.");
}
const publicDomain = configuredPublicDomain || "localhost:5000";
if (publicDomain) {
  const hasProtocol = /^https?:\/\//i.test(publicDomain);
  const apiUrl = new URL(
    hasProtocol ? publicDomain : `https://${publicDomain}`,
  );
  if (
    !__DEV__ &&
    !isPreviewBuild &&
    (apiUrl.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname))
  ) {
    throw new Error(
      "Production EXPO_PUBLIC_DOMAIN must use a public HTTPS API origin.",
    );
  }
  if (
    !hasProtocol &&
    (apiUrl.hostname === "localhost" ||
      apiUrl.hostname === "127.0.0.1" ||
      apiUrl.hostname === "[::1]")
  ) {
    apiUrl.protocol = "http:";
  }
  setBaseUrl(apiUrl.origin);
}

const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

function AppNavigator() {
  return (
    <Stack screenOptions={{ headerBackTitle: "رجوع" }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product-catalog" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="connect-accounts" options={{ headerShown: false }} />
      <Stack.Screen name="whatsapp-setup" options={{ headerShown: false }} />
      <Stack.Screen
        name="inbox/[conversationId]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="compose"
        options={{ headerShown: false, presentation: "modal" }}
      />
      <Stack.Screen name="account/profile" options={{ headerShown: false }} />
      <Stack.Screen name="account/[platform]" options={{ headerShown: false }} />
      <Stack.Screen name="oauth/meta" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthenticatedAppNavigator() {
  const { getToken, userId } = useAuth();
  const getTokenRef = React.useRef(getToken);
  const [authTokenGetterReady, setAuthTokenGetterReady] = useState(false);
  getTokenRef.current = getToken;

  useEffect(() => {
    setAuthTokenGetter(() => getTokenRef.current());
    setAuthTokenGetterReady(true);
    return () => setAuthTokenGetter(null);
  }, []);

  if (!authTokenGetterReady) return null;

  return (
    <StudioProvider
      key={userId ?? "signed-out"}
      storageNamespace={userId ? `user:${userId}` : null}
    >
      <AppNavigator />
    </StudioProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Cairo_200ExtraLight,
    Cairo_300Light,
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
    Cairo_800ExtraBold,
    Cairo_900Black,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    readAppearanceMode()
      .then((mode) => {
        if (active) {
          applyAppearanceMode(mode);
        }
      })
      .catch((error) => {
        console.error("Unable to load appearance preference:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;
  if (!isLocalAuthDisabled && !clerkPublishableKey) {
    throw new Error(
      "Missing Clerk publishable key. Check the secure Clerk setup.",
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1, direction: "rtl" }}>
            <KeyboardProvider>
              {isLocalAuthDisabled ? (
                <StudioProvider>
                  <AppNavigator />
                </StudioProvider>
              ) : (
                <ClerkProvider
                  publishableKey={clerkPublishableKey}
                  tokenCache={tokenCache}
                  proxyUrl={clerkProxyUrl}
                >
                  <ClerkLoaded>
                    <AuthenticatedAppNavigator />
                  </ClerkLoaded>
                </ClerkProvider>
              )}
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
