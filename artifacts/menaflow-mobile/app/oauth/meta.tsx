import { Feather } from '@expo/vector-icons';
import { getGetSocialConnectionsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Page, Panel } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';

export default function MetaOAuthResultScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const connected = status === 'connected' || status === 'facebook_connected';

  useEffect(() => {
    if (connected) {
      void queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
    }
  }, [connected, queryClient]);

  return (
    <Page>
      <Panel style={styles.panel}>
        <Feather
          name={connected ? 'check-circle' : 'alert-circle'}
          size={42}
          color={connected ? colors.primary : colors.mutedForeground}
        />
        <Text style={[styles.title, { color: colors.foreground }]}>
          {connected ? 'اكتمل ربط الحساب' : 'لم يكتمل ربط الحساب'}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {connected
            ? 'يمكنك العودة إلى مصادر المحتوى لمراجعة حالة حساباتك.'
            : 'ارجع إلى التطبيق وتحقق من إعدادات OAuth وصلاحيات Meta.'}
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
