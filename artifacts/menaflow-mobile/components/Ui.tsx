import React, { useState } from 'react';
import { Image, Modal, Platform, Pressable, RefreshControlProps, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon, type LucideIconName } from '@/components/LucideIcon';
import { AppAlert } from '@/components/AppFeedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useStudio } from '@/context/StudioContext';
import { isLocalAuthDisabled } from '@/constants/auth';
import { getOrderSummary } from '@/lib/orders-api';
import { router, type Href } from 'expo-router';

export function navigateBack(fallbackHref: Href) {
  router.replace(fallbackHref);
}

export function confirmDiscardChanges(
  onDiscard: () => void,
  message = 'لديك تغييرات غير محفوظة. هل تريد تجاهلها؟',
) {
  AppAlert.alert('تجاهل التغييرات؟', message, [
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
      {storageError ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {storageError}
          </Text>
        </View>
      ) : null}
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
  if (!showBell || isLocalAuthDisabled) {
    return <BrandHeaderContent showBell={showBell} userId={null} />;
  }
  return <AuthenticatedBrandHeader />;
}

function AuthenticatedBrandHeader() {
  const { userId } = useAuth();
  return <BrandHeaderContent showBell userId={userId ?? null} />;
}

function BrandHeaderContent({
  showBell,
  userId,
}: {
  showBell: boolean;
  userId: string | null;
}) {
  const colors = useColors();
  const { posts } = useStudio();
  const pendingReview = posts.filter((post) => post.status === 'review').length;
  const failedPosts = posts.filter((post) => post.status === 'failed').length;
  const orderSummaryQuery = useQuery({
    queryKey: ['order-summary', userId ?? 'local'],
    queryFn: getOrderSummary,
    enabled: showBell && (isLocalAuthDisabled || Boolean(userId)),
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const metaOrderDrafts = orderSummaryQuery.data?.metaDrafts ?? 0;
  const whatsappOrderDrafts = orderSummaryQuery.data?.whatsappDrafts ?? 0;
  const orderDraftCount = metaOrderDrafts + whatsappOrderDrafts;
  const actionableCount = pendingReview + failedPosts + orderDraftCount;
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const openPostQueue = (status: 'review' | 'failed') => {
    setNotificationsVisible(false);
    router.push({ pathname: '/(tabs)/content', params: { status } });
  };
  const openOrders = () => {
    setNotificationsVisible(false);
    router.push('/(tabs)/more/orders');
  };

  return (
    <>
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
                actionableCount > 0
                  ? `الإشعارات، ${actionableCount} منشورات تحتاج إلى إجراء`
                  : 'الإشعارات'
              }
              accessibilityState={{ expanded: notificationsVisible }}
              testID="notifications-button"
              onPress={() => setNotificationsVisible(true)}
              style={({ pressed }) => [
                styles.headerIconButton,
                { backgroundColor: colors.background, opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Icon name="bell" size={18} color={colors.foreground} />
              {actionableCount > 0 ? (
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
      <Modal
        visible={showBell && notificationsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsVisible(false)}
      >
        <View style={styles.notificationOverlay}>
          <Pressable
            accessibilityLabel="إغلاق مركز الإشعارات"
            onPress={() => setNotificationsVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.notificationDialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.notificationHeader}>
              <View style={styles.notificationHeadingCopy}>
                <Text style={[styles.notificationTitle, { color: colors.foreground }]}>
                  الإشعارات
                </Text>
                <Text style={[styles.notificationSubtitle, { color: colors.mutedForeground }]}>
                  المهام التي تحتاج إلى إجراء
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق الإشعارات"
                onPress={() => setNotificationsVisible(false)}
                hitSlop={8}
              >
                <Icon name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.notificationList}>
              {pendingReview > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${pendingReview} منشورات بانتظار المراجعة`}
                  onPress={() => openPostQueue('review')}
                  style={({ pressed }) => [
                    styles.notificationItem,
                    { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <View style={[styles.notificationItemIcon, { backgroundColor: colors.accent }]}>
                    <Icon name="file-text" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.notificationItemCopy}>
                    <Text style={[styles.notificationItemTitle, { color: colors.foreground }]}>
                      منشورات بانتظار المراجعة
                    </Text>
                    <Text style={[styles.notificationSubtitle, { color: colors.mutedForeground }]}>
                      {pendingReview} منشورات تحتاج إلى اعتماد أو تعديل.
                    </Text>
                  </View>
                  <Icon name="chevron-left" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {failedPosts > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${failedPosts} منشورات تعذر نشرها`}
                  onPress={() => openPostQueue('failed')}
                  style={({ pressed }) => [
                    styles.notificationItem,
                    { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <View style={[styles.notificationItemIcon, { backgroundColor: colors.secondary }]}>
                    <Icon name="alert-circle" size={18} color={colors.destructive} />
                  </View>
                  <View style={styles.notificationItemCopy}>
                    <Text style={[styles.notificationItemTitle, { color: colors.foreground }]}>
                      تعذّر نشر بعض المنشورات
                    </Text>
                    <Text style={[styles.notificationSubtitle, { color: colors.mutedForeground }]}>
                      {failedPosts} منشورات تحتاج إلى مراجعة نتيجة النشر.
                    </Text>
                  </View>
                  <Icon name="chevron-left" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {orderDraftCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${orderDraftCount} مسودات طلب بانتظار المراجعة`}
                  onPress={openOrders}
                  style={({ pressed }) => [
                    styles.notificationItem,
                    { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <View style={[styles.notificationItemIcon, { backgroundColor: colors.accent }]}>
                    <Icon name="shopping-bag" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.notificationItemCopy}>
                    <Text style={[styles.notificationItemTitle, { color: colors.foreground }]}>
                      طلبات بانتظار المراجعة
                    </Text>
                    <Text style={[styles.notificationSubtitle, { color: colors.mutedForeground }]}>
                      {metaOrderDrafts} من محادثات Meta و{whatsappOrderDrafts} من WhatsApp.
                    </Text>
                  </View>
                  <Icon name="chevron-left" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {actionableCount === 0 ? (
                <View style={styles.notificationEmpty}>
                  <Icon name="check-circle" size={26} color={colors.mutedForeground} />
                  <Text style={[styles.notificationItemTitle, { color: colors.foreground }]}>
                    لا توجد مهام تحتاج إجراء الآن
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
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
        <View style={styles.titleHeading}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={back.label}
              testID="page-back-button"
              onPress={() => navigateBack(back.href)}
              style={({ pressed }) => [
                styles.backButton,
                {
                  backgroundColor: pressed ? colors.secondary : colors.accent,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon name="chevron-right" size={19} color={colors.primary} />
            </Pressable>
          ) : null}
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.titleActions}>
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
  notificationOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.42)' },
  notificationDialog: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 18, padding: 18, gap: 16 },
  notificationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  notificationHeadingCopy: { alignItems: 'flex-start', gap: 4 },
  notificationTitle: { fontSize: 18, fontWeight: '800', textAlign: 'right' },
  notificationSubtitle: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  notificationList: { gap: 9 },
  notificationItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 11 },
  notificationItemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notificationItemCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 3 },
  notificationItemTitle: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  notificationEmpty: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  titleCopy: { flex: 1, alignItems: 'flex-start', gap: 4 },
  titleHeading: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14 },
  pageTitle: { flexShrink: 1, fontSize: 24, fontWeight: '800', textAlign: 'right' },
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
