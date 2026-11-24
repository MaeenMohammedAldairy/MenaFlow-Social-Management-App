import React, { useState } from 'react';
import { Image, Modal, Platform, Pressable, RefreshControlProps, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { CairoText as Text } from '@/components/CairoTypography';
import { LucideIcon as Icon, type LucideIconName } from '@/components/LucideIcon';
import { AppAlert } from '@/components/AppFeedback';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useStudio } from '@/context/StudioContext';
import { isLocalAuthDisabled } from '@/constants/auth';
import { getOrderSummary } from '@/lib/orders-api';
import { arabicCountPhrase } from '@/lib/formatting';
import { useWorkspace } from '@/context/WorkspaceContext';
import { POLL_AGGREGATE_MS } from '@/lib/poll-intervals';
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
  scrollEventThrottle,
  contentMaxWidth,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  bottomPadding?: number;
  onScroll?: ScrollViewProps['onScroll'];
  /** Override for screens that read the offset to page in more content. */
  scrollEventThrottle?: number;
  contentMaxWidth?: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { storageError } = useStudio();
  const content = (
    <View
      style={[
        styles.pageContent,
        scroll ? null : styles.pageContentFill,
        contentMaxWidth ? styles.constrainedContent : null,
        contentMaxWidth ? { maxWidth: contentMaxWidth } : null,
        {
          paddingTop: insets.top + 8,
          paddingBottom:
            bottomPadding === undefined
              ? scroll
                ? Platform.OS === 'web'
                  ? 112
                  : 112 + insets.bottom
                : 0
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
      <OfflineBanner />
      {children}
    </View>
  );
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      {scroll ? (
        <ScrollView
          refreshControl={refreshControl}
          onScroll={onScroll}
          scrollEventThrottle={
            scrollEventThrottle ?? (onScroll ? 250 : undefined)
          }
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {content}
        </ScrollView>
      ) : content}
    </View>
  );
}

type BrandHeaderProps = {
  showBell?: boolean;
  /**
   * Turns the brand card into a compact page header: mark + screen title on
   * one row, so a screen does not stack a brand card above its own title.
   */
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: { href: Href; label: string };
};

export function BrandHeader({
  showBell = true,
  title,
  subtitle,
  action,
  back,
}: BrandHeaderProps) {
  if (!showBell || isLocalAuthDisabled) {
    return (
      <BrandHeaderContent
        showBell={showBell}
        userId={null}
        title={title}
        subtitle={subtitle}
        action={action}
        back={back}
      />
    );
  }
  return (
    <AuthenticatedBrandHeader
      title={title}
      subtitle={subtitle}
      action={action}
      back={back}
    />
  );
}

function AuthenticatedBrandHeader({
  title,
  subtitle,
  action,
  back,
}: BrandHeaderProps) {
  const { userId } = useAuth();
  return (
    <BrandHeaderContent
      showBell
      userId={userId ?? null}
      title={title}
      subtitle={subtitle}
      action={action}
      back={back}
    />
  );
}

function BrandHeaderContent({
  showBell,
  userId,
  title,
  subtitle,
  action,
  back,
}: {
  showBell: boolean;
  userId: string | null;
} & BrandHeaderProps) {
  const colors = useColors();
  const { posts } = useStudio();
  const { scopeReady } = useWorkspace();
  const pendingReview = posts.filter((post) => post.status === 'review').length;
  const failedPosts = posts.filter((post) => post.status === 'failed').length;
  const orderSummaryQuery = useQuery({
    queryKey: ['order-summary', userId ?? 'local'],
    queryFn: getOrderSummary,
    // The order summary is workspace-scoped, so it waits for the active workspace
    // like the dashboard's own queries do (`lib/workspace-queries.ts`); without the
    // gate the bell fetched once before the header existed and again after.
    enabled: showBell && scopeReady,
    staleTime: 30_000,
    refetchInterval: POLL_AGGREGATE_MS,
    refetchOnWindowFocus: true,
  });
  const metaOrderDrafts = orderSummaryQuery.data?.metaDrafts ?? 0;
  const whatsappOrderDrafts = orderSummaryQuery.data?.whatsappDrafts ?? 0;
  const orderDraftCount = metaOrderDrafts + whatsappOrderDrafts;
  const actionableCount = pendingReview + failedPosts + orderDraftCount;
  /**
   * What the badge counts, in the same words the sheet uses for each group.
   *
   * The label used to call every item a post — "N منشورات تحتاج إلى إجراء" —
   * while the count also includes draft orders, so a screen reader announced three
   * posts needing action to a merchant with one post and two orders waiting. The
   * groups are named through `arabicCountPhrase` because the count is spoken: "1
   * منشورات" and "12 منشورات" are both ungrammatical.
   */
  const pendingReviewPhrase = arabicCountPhrase(pendingReview, {
    one: "منشور واحد بانتظار المراجعة",
    two: "منشوران بانتظار المراجعة",
    few: "منشورات بانتظار المراجعة",
    many: "منشورًا بانتظار المراجعة",
  });
  const failedPostsPhrase = arabicCountPhrase(failedPosts, {
    one: "منشور واحد تعذّر نشره",
    two: "منشوران تعذّر نشرهما",
    few: "منشورات تعذّر نشرها",
    many: "منشورًا تعذّر نشره",
  });
  const orderDraftsPhrase = arabicCountPhrase(orderDraftCount, {
    one: "مسودة طلب واحدة بانتظار المراجعة",
    two: "مسودتا طلب بانتظار المراجعة",
    few: "مسودات طلب بانتظار المراجعة",
    many: "مسودة طلب بانتظار المراجعة",
  });
  const actionableSummary = [
    pendingReview > 0 ? pendingReviewPhrase : null,
    failedPosts > 0 ? failedPostsPhrase : null,
    orderDraftCount > 0 ? orderDraftsPhrase : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("، ");
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
      <View style={styles.pageHeader}>
        <View style={styles.headerActions}>
          {action}
          {showBell ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                actionableCount > 0
                  ? `الإشعارات: ${actionableSummary}`
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
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={back.label}
              testID="page-back-button"
              onPress={() => navigateBack(back.href)}
              style={({ pressed }) => [
                styles.compactBackButton,
                {
                  backgroundColor: pressed ? colors.secondary : colors.accent,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon name="chevron-right" size={18} color={colors.primary} />
            </Pressable>
          ) : (
            <Image
              source={require('../assets/images/icon.png')}
              style={styles.brandMarkSmall}
            />
          )}
          <View style={styles.brandCopy}>
            <Text
              numberOfLines={1}
              style={[styles.pageHeaderTitle, { color: colors.foreground }]}
            >
              {title ?? 'MenaFlow'}
            </Text>
            {subtitle ? (
              <Text
                numberOfLines={2}
                style={[
                  styles.pageHeaderSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      <Modal
        visible={showBell && notificationsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsVisible(false)}
      >
        <View style={[styles.notificationOverlay, { backgroundColor: colors.overlay }]}>
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
                  accessibilityLabel={pendingReviewPhrase}
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
                      {arabicCountPhrase(pendingReview, {
                        one: "منشور واحد يحتاج إلى اعتماد أو تعديل.",
                        two: "منشوران يحتاجان إلى اعتماد أو تعديل.",
                        few: "منشورات تحتاج إلى اعتماد أو تعديل.",
                        many: "منشورًا يحتاج إلى اعتماد أو تعديل.",
                      })}
                    </Text>
                  </View>
                  <Icon name="chevron-left" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {failedPosts > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={failedPostsPhrase}
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
                      {arabicCountPhrase(failedPosts, {
                        one: "منشور واحد يحتاج إلى مراجعة نتيجة النشر.",
                        two: "منشوران يحتاجان إلى مراجعة نتيجة النشر.",
                        few: "منشورات تحتاج إلى مراجعة نتيجة النشر.",
                        many: "منشورًا يحتاج إلى مراجعة نتيجة النشر.",
                      })}
                    </Text>
                  </View>
                  <Icon name="chevron-left" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {orderDraftCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={orderDraftsPhrase}
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

export function Panel({
  children,
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.panel,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.shadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
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
  const backgroundColor = disabled
    ? colors.disabled
    : secondary
      ? colors.card
      : colors.primary;
  const borderColor = disabled
    ? colors.border
    : secondary
      ? colors.border
      : colors.primary;
  const foregroundColor = disabled
    ? colors.disabledForeground
    : secondary
      ? colors.primary
      : colors.primaryForeground;
  return (
    <Pressable
      accessibilityRole="button"
      testID={`button-${label}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        { backgroundColor, borderColor, opacity: !disabled && pressed ? 0.82 : 1 },
      ]}
    >
      <Icon name={icon} size={compact ? 14 : 16} color={foregroundColor} />
      <Text style={[styles.actionLabel, compact && styles.actionLabelCompact, { color: foregroundColor }]}>{label}</Text>
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

export function StepBadge({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.stepBadge, { backgroundColor: colors.accent }]}>
      <Text style={[styles.stepBadgeText, { color: colors.accentForeground }]}>
        {`الخطوة ${step} من ${total} · ${label}`}
      </Text>
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
  pageContentFill: { flex: 1 },
  constrainedContent: { width: '100%', alignSelf: 'center' },
  pageHeader: { width: '100%', alignSelf: 'stretch', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, gap: 10 },
  pageHeaderTitle: { flexShrink: 1, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  pageHeaderSubtitle: { flexShrink: 1, fontSize: 13, lineHeight: 19, textAlign: 'right' },
  brandMarkSmall: { width: 30, height: 30, borderRadius: 10 },
  compactBackButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandLockup: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandCopy: { flexShrink: 1, gap: 2 },
  headerIconButton: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconOnly: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, top: 8, end: 8 },
  notificationOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  notificationDialog: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 18, padding: 18, gap: 16 },
  notificationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  notificationHeadingCopy: { alignItems: 'flex-start', gap: 4 },
  notificationTitle: { fontSize: 18, fontWeight: '800', textAlign: 'right' },
  notificationSubtitle: { fontSize: 13, lineHeight: 19, textAlign: 'right' },
  notificationList: { gap: 9 },
  notificationItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 11 },
  notificationItemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notificationItemCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 3 },
  notificationItemTitle: { fontSize: 14, fontWeight: '800', textAlign: 'right' },
  notificationEmpty: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 10 },
  panel: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 14, shadowOpacity: 0.035, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionText: { fontSize: 16, fontWeight: '800', textAlign: 'right' },
  actionButton: { minHeight: 46, borderRadius: 15, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionButtonCompact: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, gap: 6 },
  actionLabel: { fontSize: 14, fontWeight: '700' },
  actionLabelCompact: { fontSize: 13 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 18, gap: 8 },
  emptyIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptyBody: {
    alignSelf: 'stretch',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'right',
  },
  errorBanner: { borderRadius: 12, padding: 12 },
  errorText: { fontSize: 13.5, textAlign: 'right', lineHeight: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  stepBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stepBadgeText: { fontSize: 12, fontWeight: '800', textAlign: 'right' },
});
