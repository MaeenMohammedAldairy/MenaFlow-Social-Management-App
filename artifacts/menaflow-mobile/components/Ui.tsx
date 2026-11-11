import React from 'react';
import { Alert, Image, Platform, Pressable, RefreshControlProps, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon, type LucideIconName } from '@/components/LucideIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/context/StudioContext';
import { router, type Href } from 'expo-router';

export function navigateBack(fallbackHref: Href) {
  router.replace(fallbackHref);
}

export function confirmDiscardChanges(
  onDiscard: () => void,
  message = 'لديك تغييرات غير محفوظة. هل تريد تجاهلها؟',
) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(message)) onDiscard();
    return;
  }

  Alert.alert('تجاهل التغييرات؟', message, [
    { text: 'متابعة التحرير', style: 'cancel' },
    { text: 'تجاهل', style: 'destructive', onPress: onDiscard },
  ]);
}

export function Page({
  children,
  scroll = true,
  refreshControl,
  bottomPadding,
  onScroll,
  contentMaxWidth,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  bottomPadding?: number;
  onScroll?: ScrollViewProps['onScroll'];
  contentMaxWidth?: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { storageError } = useStudio();
  const content = (
    <View
      style={[
        styles.pageContent,
        contentMaxWidth ? styles.constrainedContent : null,
        contentMaxWidth ? { maxWidth: contentMaxWidth } : null,
        {
          paddingTop:
            Platform.OS === 'web'
              ? Math.max(insets.top, 67) + 8
              : insets.top + 8,
          paddingBottom:
            bottomPadding === undefined
              ? Platform.OS === 'web'
                ? 112
                : 112 + insets.bottom
              : bottomPadding + insets.bottom,
        },
      ]}
    >
      {storageError ? <View style={[styles.errorBanner, { backgroundColor: colors.secondary }]}><Text style={[styles.errorText, { color: colors.destructive }]}>{storageError}</Text></View> : null}
      {children}
    </View>
  );
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      {scroll ? (
        <ScrollView
          refreshControl={refreshControl}
          onScroll={onScroll}
          scrollEventThrottle={onScroll ? 250 : undefined}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {content}
        </ScrollView>
      ) : content}
    </View>
  );
}

export function BrandHeader({ showBell = false }: { showBell?: boolean }) {
  const colors = useColors();
  const { posts } = useStudio();
  const pendingReview = posts.filter((p) => p.status === 'review').length;

  const handleNotifications = () => {
    const message =
      pendingReview > 0
        ? `لديك ${pendingReview} ${pendingReview === 1 ? "منشور بانتظار" : "منشورات بانتظار"} المراجعة.`
        : "لا توجد تنبيهات جديدة. جميع مساحات العمل والربط بحالة مستقرة.";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`مركز التنبيهات\n\n${message}`);
    } else {
      Alert.alert(
        'مركز التنبيهات',
        message
      );
    }
  };

  return (
    <View
      style={[
        styles.brandHeader,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.headerActions}>
        {showBell ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              pendingReview > 0
                ? `الإشعارات، لديك ${pendingReview} من المنشورات بانتظار المراجعة`
                : 'الإشعارات'
            }
            testID="notifications-button"
            onPress={handleNotifications}
            style={({ pressed }) => [
              styles.headerIconButton,
              { backgroundColor: colors.background, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Icon name="bell" size={18} color={colors.foreground} />
            {pendingReview > 0 ? (
              <View
                style={[
                  styles.notificationDot,
                  { backgroundColor: colors.primary },
                ]}
              />
            ) : null}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="الملف الشخصي وإكمال الإعداد"
          testID="profile-button"
          onPress={() => router.push('/account/profile')}
          style={({ pressed }) => [
            styles.headerIconButton,
            { backgroundColor: colors.accent, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Icon name="user" size={18} color={colors.primary} />
        </Pressable>
      </View>
      <View style={styles.brandLockup}>
        <Image source={require('../assets/images/icon.png')} style={styles.brandMark} />
        <Text style={[styles.brandName, { color: colors.foreground }]}>MenaFlow</Text>
      </View>
    </View>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: { href: Href; label: string };
}) {
  const colors = useColors();
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleCopy}>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.titleActions}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={back.label}
            onPress={() => navigateBack(back.href)}
            style={({ pressed }) => [
              styles.backButton,
              { borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
            ]}
          >
            <Icon name="chevron-right" size={18} color={colors.primary} />
            <Text style={[styles.backLabel, { color: colors.primary }]}>رجوع</Text>
          </Pressable>
        ) : null}
        {action}
      </View>
    </View>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionText, { color: colors.foreground }]}>{title}</Text>
      {action}
    </View>
  );
}

export function ActionButton({ label, icon, onPress, secondary = false, disabled = false, compact = false }: { label: string; icon: LucideIconName; onPress: () => void; secondary?: boolean; disabled?: boolean; compact?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      testID={`button-${label}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        { backgroundColor: secondary ? colors.card : colors.primary, borderColor: secondary ? colors.border : colors.primary, opacity: disabled ? 0.5 : pressed ? 0.82 : 1 },
      ]}
    >
      <Icon name={icon} size={compact ? 14 : 16} color={secondary ? colors.primary : colors.primaryForeground} />
      <Text style={[styles.actionLabel, compact && styles.actionLabelCompact, { color: secondary ? colors.primary : colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: LucideIconName; title: string; body: string }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
        <Icon name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{body}</Text>
    </View>
  );
}

export function StatusPill({
  label,
  tone = 'muted',
  style,
}: {
  label: string;
  tone?: 'green' | 'amber' | 'blue' | 'muted';
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const color = tone === 'green' ? colors.primary : tone === 'amber' ? colors.warning : tone === 'blue' ? colors.blue : colors.secondaryForeground;
  return (
    <View style={[styles.pill, style, { backgroundColor: tone === 'green' ? colors.accent : colors.secondary }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function IconButton({ icon, onPress, label, color }: { icon: LucideIconName; onPress: () => void; label: string; color?: string }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconOnly}>
      <Icon name={icon} size={18} color={color ?? colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  pageContent: { paddingHorizontal: 18, gap: 18 },
  constrainedContent: { width: '100%', alignSelf: 'center' },
  brandHeader: { width: '100%', alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 10, borderWidth: 1, borderRadius: 17 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 34, height: 34, borderRadius: 11 },
  brandName: { fontSize: 18, fontWeight: '800', letterSpacing: -0.6 },
  headerIconButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconOnly: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, top: 7, end: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  titleCopy: { flex: 1, alignItems: 'flex-start', gap: 4 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, borderWidth: 1, borderRadius: 13 },
  backLabel: { fontSize: 13, fontWeight: '700' },
  pageTitle: { fontSize: 24, fontWeight: '800', textAlign: 'right' },
  pageSubtitle: {
    alignSelf: 'stretch',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'left',
  },
  panel: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 14, shadowColor: '#0A2540', shadowOpacity: 0.035, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionText: { fontSize: 16, fontWeight: '800', textAlign: 'right' },
  actionButton: { minHeight: 46, borderRadius: 15, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionButtonCompact: { minHeight: 40, borderRadius: 12, paddingHorizontal: 10, gap: 6 },
  actionLabel: { fontSize: 14, fontWeight: '700' },
  actionLabelCompact: { fontSize: 12 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 18, gap: 8 },
  emptyIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptyBody: {
    alignSelf: 'stretch',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'left',
  },
  errorBanner: { borderRadius: 12, padding: 12 },
  errorText: { fontSize: 12, textAlign: 'left', lineHeight: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
});
