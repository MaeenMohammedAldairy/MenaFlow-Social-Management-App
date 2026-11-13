import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  MutationCache,
  QueryClient,
  QueryCache,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import {
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
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
import { router, Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ClerkLoaded, ClerkProvider, useAuth, useClerk } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  getGetSocialConnectionsQueryKey,
  getGetOnboardingStatusQueryKey,
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  fetchApiResponse,
  setAuthTokenGetter,
  setBaseUrl,
  setWorkspaceIdGetter,
} from "@workspace/api-client-react";
import { StudioProvider } from "@/context/StudioContext";
import {
  WorkspaceContext,
  type WorkspaceSummary,
} from "@/context/WorkspaceContext";
import { Platform, I18nManager } from "react-native";
import { isLocalAuthDisabled } from "@/constants/auth";
import { applyAppearanceMode, readAppearanceMode } from "@/lib/appearance";
import { signOutAndClearQueryCache } from "@/lib/sign-out";
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";

if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

type ApiErrorNotice = {
  kind: "unauthorized" | "forbidden" | "server" | "network";
  retry?: () => Promise<void>;
  signOutFailed?: boolean;
};

let apiErrorListener: ((notice: ApiErrorNotice) => void) | null = null;
let queryClient: QueryClient;

function apiErrorStatus(error: unknown): number | null {
  if (
    error instanceof Error &&
    error.name === "ApiError" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return null;
}

function reportApiError(
  error: unknown,
  retry?: () => Promise<void>,
): void {
  const status = apiErrorStatus(error);
  if (status === 401) {
    apiErrorListener?.({ kind: "unauthorized" });
  } else if (status === 403) {
    apiErrorListener?.({ kind: "forbidden" });
  } else if (status !== null && status >= 500) {
    apiErrorListener?.({ kind: "server", retry });
  } else if (error instanceof TypeError) {
    apiErrorListener?.({ kind: "network", retry });
  }
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Record<string, unknown>;
  return (
    typeof workspace.id === "string" &&
    typeof workspace.name === "string" &&
    typeof workspace.role === "string"
  );
}

queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      reportApiError(error, () =>
        queryClient.refetchQueries({
          queryKey: query.queryKey,
          exact: true,
        }),
      );
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => reportApiError(error),
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = apiErrorStatus(error);
        if (status !== null && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
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

function AppNavigator({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <Stack screenOptions={{ headerBackTitle: "رجوع" }}>
      <Stack.Protected guard={!isSignedIn} redirectTo="/">
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={isSignedIn} redirectTo="/(auth)/sign-in">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="product-catalog" options={{ headerShown: false }} />
        <Stack.Screen name="activities" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="connect-accounts" options={{ headerShown: false }} />
        <Stack.Screen name="whatsapp-setup" options={{ headerShown: false }} />
        <Stack.Screen name="publishing-settings" options={{ headerShown: false }} />
        <Stack.Screen name="inbox/reply-settings" options={{ headerShown: false }} />
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
      </Stack.Protected>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sso-callback" options={{ headerShown: false }} />
    </Stack>
  );
}

function AuthenticatedAppNavigator() {
  const { getToken, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const getTokenRef = React.useRef(getToken);
  const [authTokenGetterReady, setAuthTokenGetterReady] = useState(false);
  const [apiErrorNotice, setApiErrorNotice] =
    useState<ApiErrorNotice | null>(null);
  const [workspaceSelection, setWorkspaceSelection] = useState<{
    userId: string;
    workspaceId: string | null;
  } | null>(null);
  getTokenRef.current = getToken;
  const activeWorkspaceId =
    workspaceSelection && workspaceSelection.userId === userId
      ? workspaceSelection.workspaceId
      : null;
  const activeWorkspaceIdRef = React.useRef<string | null>(null);
  activeWorkspaceIdRef.current = activeWorkspaceId;

  const workspaceListQuery = useQuery({
    queryKey: ["workspace-list", userId ?? null],
    queryFn: async (): Promise<WorkspaceSummary[]> => {
      const response = await fetchApiResponse("/api/workspaces");
      if (!response.ok) throw new Error("WORKSPACE_LIST_LOAD_FAILED");
      const payload = (await response.json()) as { workspaces?: unknown };
      return Array.isArray(payload.workspaces)
        ? payload.workspaces.filter(isWorkspaceSummary)
        : [];
    },
    enabled: Boolean(isSignedIn && userId && authTokenGetterReady),
    retry: false,
  });

  const onboarding = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId ?? null),
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(isSignedIn && userId && authTokenGetterReady),
    retry: false,
  });

  useEffect(() => {
    if (!userId || !onboarding.data) return;
    void queryClient.invalidateQueries({
      queryKey: ["workspace-list", userId],
    });
  }, [onboarding.data, queryClient, userId]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setWorkspaceSelection(null);
      return () => {
        active = false;
      };
    }

    setWorkspaceSelection(null);
    void AsyncStorage.getItem(`menaflow.active-workspace:${userId}`)
      .then((workspaceId) => {
        if (active) setWorkspaceSelection({ userId, workspaceId });
      })
      .catch((error) => {
        console.error("Unable to load active workspace:", error);
        if (active) setWorkspaceSelection({ userId, workspaceId: null });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (
      !userId ||
      workspaceSelection?.userId !== userId ||
      !workspaceListQuery.data
    ) {
      return;
    }
    if (workspaceListQuery.data.length === 0) {
      if (workspaceSelection.workspaceId !== null) {
        setWorkspaceSelection({ userId, workspaceId: null });
        void AsyncStorage.removeItem(`menaflow.active-workspace:${userId}`).catch(
          (error) => {
            console.error("Unable to clear active workspace:", error);
          },
        );
      }
      return;
    }
    const savedWorkspaceExists = workspaceListQuery.data.some(
      (workspace) => workspace.id === workspaceSelection.workspaceId,
    );
    if (savedWorkspaceExists) return;

    const firstWorkspaceId = workspaceListQuery.data[0]?.id ?? null;
    if (workspaceSelection.workspaceId === firstWorkspaceId) return;
    setWorkspaceSelection({ userId, workspaceId: firstWorkspaceId });
    if (firstWorkspaceId) {
      void AsyncStorage.setItem(
        `menaflow.active-workspace:${userId}`,
        firstWorkspaceId,
      ).catch((error) => {
        console.error("Unable to save active workspace:", error);
      });
    }
  }, [userId, workspaceSelection, workspaceListQuery.data]);

  const previousWorkspaceIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    if (previousWorkspaceId === activeWorkspaceId) return;
    previousWorkspaceIdRef.current = activeWorkspaceId;
    if (previousWorkspaceId) {
      queryClient.clear();
    } else if (activeWorkspaceId) {
      void queryClient.invalidateQueries();
    }
  }, [activeWorkspaceId, queryClient]);

  const selectWorkspace = async (workspaceId: string): Promise<void> => {
    if (
      !userId ||
      !workspaceListQuery.data?.some((workspace) => workspace.id === workspaceId)
    ) {
      return;
    }
    await AsyncStorage.setItem(
      `menaflow.active-workspace:${userId}`,
      workspaceId,
    );
    queryClient.clear();
    setWorkspaceSelection({ userId, workspaceId });
  };

  useEffect(() => {
    if (!isSignedIn || !onboarding.data) return;
    if (pathname === "/sso-callback" || pathname === "/oauth/meta") return;

    const onOnboarding = pathname.endsWith("/onboarding");
    const allowedDuringSocialSetup =
      pathname.endsWith("/connect-accounts") ||
      pathname.endsWith("/more/sources") ||
      pathname.endsWith("/whatsapp-setup");

    if (!onboarding.data.completed && !onOnboarding) {
      router.replace("/onboarding");
    } else if (
      onboarding.data.completed &&
      !onboarding.data.socialAccountsCompleted &&
      !allowedDuringSocialSetup
    ) {
      router.replace("/connect-accounts");
    }
  }, [isSignedIn, onboarding.data, pathname]);

  useEffect(() => {
    setAuthTokenGetter(() => getTokenRef.current());
    setAuthTokenGetterReady(true);
    return () => setAuthTokenGetter(null);
  }, []);

  useEffect(() => {
    setWorkspaceIdGetter(() => activeWorkspaceIdRef.current);
    return () => setWorkspaceIdGetter(null);
  }, []);

  useEffect(() => {
    apiErrorListener = setApiErrorNotice;
    return () => {
      apiErrorListener = null;
    };
  }, []);

  const reauthenticate = async () => {
    try {
      await signOutAndClearQueryCache(queryClient, signOut);
      router.replace("/(auth)/sign-in");
    } catch (error) {
      console.error("Unable to end the rejected session:", error);
      setApiErrorNotice((current) =>
        current?.kind === "unauthorized"
          ? { ...current, signOutFailed: true }
          : current,
      );
    }
  };

  if (!authTokenGetterReady) return null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces: workspaceListQuery.data ?? [],
        activeWorkspaceId,
        isLoading: workspaceListQuery.isLoading,
        isError: workspaceListQuery.isError,
        selectWorkspace,
      }}
    >
      <StudioProvider
        key={userId ?? "signed-out"}
        storageNamespace={userId ? `user:${userId}` : null}
      >
        <View style={styles.navigator}>
          <AppNavigator isSignedIn={Boolean(isSignedIn)} />
          {apiErrorNotice ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[
              styles.apiErrorNotice,
              {
                top: insets.top + 12,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.apiErrorText, { color: colors.foreground }]}>
              {apiErrorNotice.kind === "unauthorized"
                ? apiErrorNotice.signOutFailed
                  ? "تعذر إنهاء الجلسة. تحقق من اتصالك ثم حاول تسجيل الدخول مجددًا."
                  : "انتهت صلاحية الجلسة أو تعذر التحقق منها. سجّل الدخول مجددًا للمتابعة."
                : apiErrorNotice.kind === "forbidden"
                  ? "ليس لديك صلاحية لتنفيذ هذا الإجراء."
                  : apiErrorNotice.kind === "server"
                    ? "حدث خطأ في الخادم. حاول مرة أخرى لاحقًا."
                    : "تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مجددًا."}
            </Text>
            <View style={styles.apiErrorActions}>
              {apiErrorNotice.kind === "unauthorized" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void reauthenticate()}
                  style={[
                    styles.apiErrorButton,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.apiErrorButtonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    تسجيل الدخول مجددًا
                  </Text>
                </Pressable>
              ) : null}
              {apiErrorNotice.retry ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    const retry = apiErrorNotice.retry;
                    setApiErrorNotice(null);
                    if (retry) void retry();
                  }}
                  style={[
                    styles.apiErrorButton,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.apiErrorButtonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    إعادة المحاولة
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق رسالة الخطأ"
                onPress={() => setApiErrorNotice(null)}
                style={styles.apiErrorDismiss}
              >
                <Text style={{ color: colors.mutedForeground }}>إغلاق</Text>
              </Pressable>
            </View>
          </View>
          ) : null}
        </View>
      </StudioProvider>
    </WorkspaceContext.Provider>
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
                  <AppNavigator isSignedIn />
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

const styles = StyleSheet.create({
  navigator: { flex: 1 },
  apiErrorNotice: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  apiErrorText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
  },
  apiErrorActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  apiErrorButton: {
    minHeight: 38,
    borderRadius: 11,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  apiErrorButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  apiErrorDismiss: {
    minHeight: 38,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
});
