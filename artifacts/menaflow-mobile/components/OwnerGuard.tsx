import { useClerk, useAuth } from "@clerk/expo";
import {
  getGetOwnerAccessQueryKey,
  useGetOwnerAccess,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";
import { signOutAndClearQueryCache } from "@/lib/sign-out";

export function OwnerGuard({ children }: { children: React.ReactNode }) {
  if (isLocalAuthDisabled) return <>{children}</>;
  return <ClerkOwnerGuard>{children}</ClerkOwnerGuard>;
}

function ClerkOwnerGuard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutFailed, setSignOutFailed] = React.useState(false);
  const access = useGetOwnerAccess({
    query: {
      queryKey: [...getGetOwnerAccessQueryKey(), userId ?? "signed-out"],
      enabled: isLoaded && Boolean(isSignedIn),
      staleTime: 60_000,
      retry: false,
    },
  });
  const isCheckingAccess = !isLoaded || (isSignedIn && access.isPending);
  const isAccessError = access.isError || !access.data;
  const onboarding = access.data?.onboarding;
  const isAuthorized = access.data?.authorized === true;
  const onboardingComplete = onboarding?.completed === true;
  const socialAccountsComplete =
    onboarding?.socialAccountsCompleted === true;
  const allowedDuringSocialSetup =
    pathname.endsWith("/connect-accounts") ||
    pathname.endsWith("/more/sources") ||
    pathname.endsWith("/whatsapp-setup");

  React.useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      if (!pathname.endsWith("/sign-in")) router.replace("/(auth)/sign-in");
      return;
    }
    if (access.isPending || access.isError || !access.data?.authorized) return;
    if (!onboarding) return;
    if (!onboarding.completed) {
      if (!pathname.endsWith("/onboarding")) router.replace("/onboarding");
      return;
    }
    if (!onboarding.socialAccountsCompleted && !allowedDuringSocialSetup) {
      router.replace("/connect-accounts");
    }
  }, [
    access.data,
    access.isError,
    access.isPending,
    allowedDuringSocialSetup,
    isLoaded,
    isSignedIn,
    onboarding,
    pathname,
  ]);

  let gate: React.ReactNode = null;
  if (isCheckingAccess || !isSignedIn) {
    gate = (
      <GateMessage
        loading
        title="جارٍ التحقق من صلاحية الحساب…"
      />
    );
  } else if (isAccessError) {
    gate = (
      <GateMessage
        title="تعذر تحميل بيانات الحساب"
        description="تحقق من اتصال الإنترنت ثم أعد المحاولة."
        actionLabel="إعادة المحاولة"
        onPress={() => void access.refetch()}
      />
    );
  } else if (!isAuthorized) {
    gate = (
      <GateMessage
        title={signOutFailed ? "تعذر تسجيل الخروج" : "هذا الحساب غير مخوّل"}
        description={
          signOutFailed
            ? "لم يكتمل إنهاء الجلسة. تحقق من الاتصال ثم حاول مرة أخرى."
            : "مساحة MenaFlow مخصصة لحساب مالك النشاط. سجّل الخروج ثم استخدم البريد المعتمد."
        }
        actionLabel={signingOut ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
        busy={signingOut}
        onPress={() => {
          if (signingOut) return;
          setSigningOut(true);
          setSignOutFailed(false);
          void (async () => {
            try {
              await signOutAndClearQueryCache(queryClient, signOut);
              router.replace("/(auth)/sign-in");
            } catch {
              setSignOutFailed(true);
            } finally {
              setSigningOut(false);
            }
          })();
        }}
      />
    );
  } else if (
    !onboardingComplete ||
    (!socialAccountsComplete && !allowedDuringSocialSetup)
  ) {
    gate = (
      <GateMessage
        loading
        title={
          !onboardingComplete
            ? "جارٍ فتح الإعداد الأولي…"
            : "جارٍ فتح إعداد الحسابات الاجتماعية…"
        }
      />
    );
  }

  return (
    <View style={styles.root}>
      {children}
      {gate}
    </View>
  );
}

function GateMessage({
  title,
  description,
  actionLabel,
  onPress,
  busy = false,
  loading = false,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onPress?: () => void;
  busy?: boolean;
  loading?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.center,
        styles.overlay,
        { backgroundColor: colors.background },
      ]}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={[styles.message, { color: colors.mutedForeground }]}>
              {description}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={onPress}
              style={[
                styles.button,
                { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 },
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.primaryForeground }]}
              >
                {actionLabel}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1 },
  center: {
    flex: 1,
    minHeight: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: 12,
    borderWidth: 1,
    borderRadius: 22,
    padding: 22,
  },
  title: { fontSize: 20, fontWeight: "900", textAlign: "right" },
  message: { fontSize: 13, lineHeight: 21, textAlign: "left" },
  button: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    marginTop: 5,
  },
  buttonText: { fontSize: 13, fontWeight: "800" },
});
