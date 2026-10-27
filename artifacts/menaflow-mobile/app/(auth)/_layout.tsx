import React from 'react';
import { Stack } from 'expo-router';
import { Redirect } from 'expo-router';
import { isLocalAuthDisabled } from '@/constants/auth';

export default function AuthLayout() {
  if (isLocalAuthDisabled) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
