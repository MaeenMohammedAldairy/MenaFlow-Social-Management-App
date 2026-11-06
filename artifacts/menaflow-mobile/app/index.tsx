import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { isLocalAuthDisabled } from '@/constants/auth';

export default function AppIndex() {
  if (isLocalAuthDisabled) {
    return <Redirect href="/(tabs)" />;
  }

  return <AuthenticatedAppIndex />;
}

function AuthenticatedAppIndex() {
  const colors = useColors();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const onboarding = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId ?? null),
    queryFn: () => getOnboardingStatus(),
    enabled: isLoaded && Boolean(isSignedIn),
    retry: false,
  });

  if (isLoaded && !isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (onboarding.isError) return <Redirect href="/onboarding" />;
  if (onboarding.data) {
    return (
      <Redirect href={onboarding.data.completed ? '/(tabs)' : '/onboarding'} />
    );
  }

  return (
    <View style={[styles.loading, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
