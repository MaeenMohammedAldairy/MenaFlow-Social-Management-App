import { getGetSocialConnectionsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { Page, Panel } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { metaOAuthErrorMessage } from '@/constants/meta-oauth';

export default function MetaOAuthResultScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { status, reason, detail } = useLocalSearchParams<{
    status?: string;
    reason?: string;
    detail?: string;
  }>();
  const connected = status === 'facebook_connected';

  useEffect(() => {
    if (connected) {
      void queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
    }
  }, [connected, queryClient]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !status || !window.opener) {
      return;
    }
    window.opener.postMessage(
      { type: 'menaflow-meta-oauth', status, reason, detail },
      window.location.origin,
    );
    window.setTimeout(() => window.close(), 500);
  }, [reason, status]);

  return (
    <Page>
      <Panel style={styles.panel}>
        <Icon
          name={connected ? 'check-circle' : 'alert-circle'}
          size={42}
          color={connected ? colors.primary : colors.mutedForeground}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>
          {connected ? 'اكتمل ربط الحساب' : 'لم يكتمل ربط الحساب'}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {connected
            ? detail || 'يمكنك العودة إلى مصادر المحتوى لمراجعة حالة حساباتك.'
            : metaOAuthErrorMessage(reason, detail)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/(tabs)/sources')}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            العودة إلى مصادر المحتوى
          </Text>
        </Pressable>
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  panel: { alignItems: 'center', gap: 14, marginTop: 36 },
  title: { fontSize: 19, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  button: { borderRadius: 15, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { fontSize: 13, fontWeight: '800' },
});
