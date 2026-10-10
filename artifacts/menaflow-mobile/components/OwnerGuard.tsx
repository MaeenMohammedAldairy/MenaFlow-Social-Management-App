import { useClerk, useAuth } from '@clerk/expo';
import { getGetOwnerAccessQueryKey, useGetOwnerAccess } from '@workspace/api-client-react';
import { Redirect, router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function OwnerGuard({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const access = useGetOwnerAccess({
    query: {
      queryKey: getGetOwnerAccessQueryKey(),
      enabled: isLoaded && Boolean(isSignedIn),
      retry: false,
    },
  });

  if (!isLoaded || (isSignedIn && access.isPending)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.message, { color: colors.mutedForeground }]}>جارٍ التحقق من صلاحية الحساب…</Text>
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
        title="هذا الحساب غير مخوّل"
        description="مساحة MenaFlow مخصصة لحساب مالك النشاط. سجّل الخروج ثم استخدم البريد المعتمد."
        actionLabel="تسجيل الخروج"
        onPress={() => {
          void (async () => {
            await signOut();
            router.replace('/(auth)/sign-in');
          })();
        }}
      />
    );
  }

  return <>{children}</>;
}

function GateMessage({
  title,
  description,
  actionLabel,
  onPress,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>{description}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, gap: 12, borderWidth: 1, borderRadius: 22, padding: 22 },
  title: { fontSize: 20, fontWeight: '900', textAlign: 'right' },
  message: { fontSize: 13, lineHeight: 21, textAlign: 'right' },
  button: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, marginTop: 5 },
  buttonText: { fontSize: 13, fontWeight: '800' },
});
