import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function AppIndex() {
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded) {
    return (
      <Redirect
        href={isSignedIn ? '/(tabs)' : '/(auth)/sign-in'}
      />
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
