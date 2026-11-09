import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { MarketingLandingPage } from '@/components/MarketingLandingPage';
import {
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { isLocalAuthDisabled } from '@/constants/auth';

function onboardingErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      /timeout|timed out/i.test(error.message))
  ) {
    return 'استغرق تحميل حالة الإعداد وقتًا أطول من المتوقع. تحقق من اتصالك ثم أعد المحاولة.';
  }
  if (error instanceof TypeError) {
    return 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.';
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 500
  ) {
    return 'الخادم غير متاح مؤقتًا. إعداداتك لم تتغير؛ أعد المحاولة بعد قليل.';
  }
  return 'تعذر تحميل حالة إعداد حسابك. لم يتم تغيير إعداداتك؛ أعد المحاولة.';
}

export default function AppIndex() {
  if (isLocalAuthDisabled) {
    return <Redirect href="/(tabs)" />;
  }

  return <RoutedAppIndex />;
}

function RoutedAppIndex() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingState />;
  if (isSignedIn) return <AuthenticatedAppIndex />;
  return Platform.OS === 'web' ? (
    <MarketingLandingPage />
  ) : (
    <Redirect href="/(auth)/sign-in" />
  );
}

function AuthenticatedAppIndex() {
  const colors = useColors();
  const { userId } = useAuth();
  const onboarding = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId ?? null),
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(userId),
    retry: false,
  });

  if (onboarding.isError) {
    return (
      <View style={[styles.state, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>
          تعذر تحميل حالة الحساب
        </Text>
        <Text
          accessibilityRole="alert"
          style={[styles.errorMessage, { color: colors.mutedForeground }]}
        >
          {onboardingErrorMessage(onboarding.error)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            busy: onboarding.isFetching,
            disabled: onboarding.isFetching,
          }}
          disabled={onboarding.isFetching}
          onPress={() => void onboarding.refetch()}
          style={[
            styles.retryButton,
            {
              backgroundColor: colors.primary,
              opacity: onboarding.isFetching ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
            {onboarding.isFetching ? 'جارٍ إعادة المحاولة…' : 'إعادة المحاولة'}
          </Text>
        </Pressable>
      </View>
    );
  }
  if (onboarding.data) {
    return (
      <Redirect href={onboarding.data.completed ? '/(tabs)' : '/onboarding'} />
    );
  }

  return <LoadingState />;
}

function LoadingState() {
  const colors = useColors();
  return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  errorTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  errorMessage: { maxWidth: 420, fontSize: 15, lineHeight: 24, textAlign: 'center' },
  retryButton: {
    minHeight: 46,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 18,
  },
  retryText: { fontSize: 14, fontWeight: '800' },
});
