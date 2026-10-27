import { useClerk, useAuth } from "@clerk/expo";
import {
  getGetOwnerAccessQueryKey,
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  useGetOwnerAccess,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, usePathname } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { useColors } from "@/hooks/useColors";
import { isLocalAuthDisabled } from "@/constants/auth";

export function OwnerGuard({ children }: { children: React.ReactNode }) {
  if (isLocalAuthDisabled) return <>{children}</>;
  return <ClerkOwnerGuard>{children}</ClerkOwnerGuard>;
}

function ClerkOwnerGuard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const pathname = usePathname();
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
  const onboarding = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId ?? null),
    queryFn: () => getOnboardingStatus(),
    enabled:
      isLoaded && Boolean(isSignedIn) && access.data?.authorized === true,
    retry: false,
  });
  if (
    !isLoaded ||
    (isSignedIn &&
      (access.isPending || (access.data?.authorized && onboarding.isPending)))
  ) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          جارٍ التحقق من صلاحية الحساب…
        </Text>
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  if (access.isError || !access.data) {
    return (
      <GateMessage
        title="تعذر التحقق من الحساب"
        description="تحقق من اتصال الإنترنت ثم أعد المحاولة."
        actionLabel="إعادة المحاولة"
        onPress={() => void access.refetch()}
      />
    );
  }

  if (!access.data.authorized) {
    return (
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
              await signOut();
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
  }

  if (onboarding.isError || !onboarding.data) {
    return (
      <GateMessage
        title="تعذر تحميل الإعداد الأولي"
        description="تحقق من اتصال الإنترنت ثم أعد المحاولة."
        actionLabel="إعادة المحاولة"
        onPress={() => void onboarding.refetch()}
      />
    );
  }

  if (!onboarding.data.completed) return <Redirect href="/onboarding" />;
  if (
    !onboarding.data.socialAccountsCompleted &&
    !pathname.endsWith("/sources") &&
    !pathname.endsWith("/whatsapp-setup")
  ) {
    return <Redirect href="/(tabs)/sources" />;
  }

  return <>{children}</>;
}

function GateMessage({
  title,
  description,
  actionLabel,
  onPress,
  busy = false,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  message: { fontSize: 13, lineHeight: 21, textAlign: "right" },
  button: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    marginTop: 5,
  },
  buttonText: { fontSize: 13, fontWeight: "800" },
});
