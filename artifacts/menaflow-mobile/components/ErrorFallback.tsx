import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon } from '@/components/LucideIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { reloadAppAsync } from 'expo';

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const handleRestart = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error('Failed to restart app:', restartError);
      setIsRestarting(false);
      resetError();
    }
  };

  const formatErrorDetails = (): string => {
    let details = `الخطأ: ${error.message}\n\n`;
    if (error.stack) {
      details += `مكدس الاستدعاء:\n${error.stack}`;
    }
    return details;
  };

  const monoFont = Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  });

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      {__DEV__ ? (
        <Pressable
          onPress={() => setIsModalVisible(true)}
          accessibilityLabel="عرض تفاصيل الخطأ"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.topButton,
            {
              top: insets.top + 16,
              backgroundColor: colors.card,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Icon name="alert-circle" size={20} color={colors.foreground} />
        </Pressable>
      ) : null}

      <View
        accessibilityRole="alert"
        style={[
          styles.content,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.errorIcon,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="alert-circle" size={28} color={colors.destructive} />
        </View>
        <View style={styles.messageGroup}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            حدث خطأ غير متوقع
          </Text>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            تعذر متابعة استخدام التطبيق. أعد المحاولة للمتابعة.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRestarting ? 'جارٍ إعادة تحميل التطبيق' : 'إعادة تحميل التطبيق'}
          accessibilityState={{ disabled: isRestarting, busy: isRestarting }}
          disabled={isRestarting}
          onPress={() => void handleRestart()}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: isRestarting ? 0.7 : pressed ? 0.88 : 1,
            },
          ]}
        >
          <Icon
            name={isRestarting ? 'clock' : 'refresh-cw'}
            size={18}
            color={colors.primaryForeground}
          />
          <Text
            style={[styles.buttonText, { color: colors.primaryForeground }]}
          >
            {isRestarting ? 'جارٍ إعادة التحميل…' : 'أعد المحاولة'}
          </Text>
        </Pressable>
      </View>

      {__DEV__ ? (
        <Modal
          visible={isModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setIsModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContainer,
                { backgroundColor: colors.background },
              ]}
            >
              <View
                style={[
                  styles.modalHeader,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  تفاصيل الخطأ
                </Text>
                <Pressable
                  onPress={() => setIsModalVisible(false)}
                  accessibilityLabel="إغلاق تفاصيل الخطأ"
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.closeButton,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Icon name="x" size={24} color={colors.foreground} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={[
                  styles.modalScrollContent,
                  { paddingBottom: insets.bottom + 16 },
                ]}
                showsVerticalScrollIndicator
              >
                <View
                  style={[
                    styles.errorContainer,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.errorText,
                      {
                        color: colors.foreground,
                        fontFamily: monoFont,
                      },
                    ]}
                    selectable
                  >
                    {formatErrorDetails()}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  content: {
    alignItems: 'center',
    gap: 22,
    width: '100%',
    maxWidth: 480,
    padding: 32,
    borderWidth: 1,
    borderRadius: 28,
    shadowColor: '#0A2540',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  messageGroup: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 34,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 340,
  },
  topButton: {
    position: 'absolute',
    start: 16,
    width: 44,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  button: {
    minHeight: 52,
    alignSelf: 'stretch',
    borderRadius: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  buttonText: {
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    width: '100%',
    height: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
  },
  errorContainer: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    padding: 16,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    width: '100%',
    writingDirection: 'ltr',
  },
});
