import React, { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { getWhatsAppAutoReplySettings } from "@workspace/api-client-react";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { Skeleton } from "@/components/Skeleton";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  IconButton,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { InboxPlatformTabs, type InboxPlatform } from "@/components/inbox/InboxPlatformTabs";
import { formatArabicDateTime, formatArabicNumber } from "@/lib/formatting";
import {
  getMetaAutoReplySettings,
  getMetaInbox,
  metaInboxPersonId,
  type MetaAutoReplySettingsResponse,
  type MetaInboxItem,
  type MetaInboxKind,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";
import {
  getWhatsAppDirectConversations,
  type WhatsAppDirectConversation,
} from "@/lib/whatsapp-direct-inbox-api";

type InboxFilter = "all" | MetaInboxKind;

const filters: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "كل الأنواع" },
  { key: "message", label: "الرسائل" },
  { key: "comment", label: "التعليقات" },
];

type InboxGroup = {
  key: string;
  title: string;
  platform: MetaInboxPlatform;
  items: MetaInboxItem[];
  latestAt: number;
};

type InboxListRow =
  | { kind: "meta"; key: string; group: InboxGroup; latestAt: number }
  | {
      kind: "whatsapp";
      key: string;
      conversation: WhatsAppDirectConversation;
      latestAt: number;
    };

function groupInboxItems(items: MetaInboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const item of items) {
    const personId = metaInboxPersonId(item);
    const key = `${item.platform}:person:${personId}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      if (!group.title || group.title === "اسم غير متاح") {
        group.title = item.actorName || group.title;
      }
      const occurredAt = Date.parse(item.occurredAt);
      if (Number.isFinite(occurredAt)) {
        group.latestAt = Math.max(group.latestAt, occurredAt);
      }
      continue;
    }
    const occurredAt = Date.parse(item.occurredAt);
    groups.set(key, {
      key,
      title: item.actorName || "اسم غير متاح",
      platform: item.platform,
      items: [item],
      latestAt: Number.isFinite(occurredAt) ? occurredAt : 0,
    });
  }
  return [...groups.values()].sort(
    (first, second) => second.latestAt - first.latestAt,
  );
}

function latestInboxItem(group: InboxGroup): MetaInboxItem {
  return group.items.reduce((latest, item) =>
    Date.parse(item.occurredAt) > Date.parse(latest.occurredAt) ? item : latest,
  );
}

function inboxErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "تعذر تحميل الرسائل والتعليقات. تحقق من اتصالك ثم أعد المحاولة.";
  }
  if (/failed to fetch|network request failed|networkerror/i.test(error.message)) {
    return "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
  }
  return error.message;
}

function metaReplyStatus(
  response: MetaAutoReplySettingsResponse,
  platform: MetaInboxPlatform,
): string {
  const { settings, readiness } = response;
  const platformReadiness = readiness[platform];
  if (!platformReadiness.connected) return "الحساب غير متصل";
  if (!platformReadiness.tokenReady) return "يحتاج إعدادًا";

  const enabledKinds =
    platform === "facebook"
      ? [settings.facebookMessagesEnabled, settings.facebookCommentsEnabled]
      : [settings.instagramMessagesEnabled, settings.instagramCommentsEnabled];
  if (!settings.enabled || !enabledKinds.some(Boolean)) return "متوقف";

  const kindReadiness = [
    platformReadiness.messagesReady,
    platformReadiness.commentsReady,
  ].filter((_, index) => enabledKinds[index]);
  if (kindReadiness.every(Boolean)) return "مفعّل وجاهز";
  if (kindReadiness.some(Boolean)) return "جاهز جزئيًا";
  return "يحتاج إعدادًا";
}

export function MetaInboxScreen() {
  return isLocalAuthDisabled ? (
    <MetaInboxContent userId={null} />
  ) : (
    <AuthenticatedMetaInbox />
  );
}

function AuthenticatedMetaInbox() {
  const { userId } = useAuth();
  return <MetaInboxContent userId={userId ?? null} />;
}

function MetaInboxContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { platform: routePlatform } = useLocalSearchParams<{ platform?: string }>();
  const initialPlatform: Exclude<InboxPlatform, "whatsapp"> =
    routePlatform === "facebook" || routePlatform === "instagram"
      ? routePlatform
      : "all";
  const [platform, setPlatform] = useState<Exclude<InboxPlatform, "whatsapp">>(initialPlatform);
  const [filter, setFilter] = useState<InboxFilter>("all");
  useEffect(() => {
    setPlatform(initialPlatform);
    setFilter("all");
  }, [initialPlatform]);
  const [search, setSearch] = useState("");
  const [olderPages, setOlderPages] = useState<
    Awaited<ReturnType<typeof getMetaInbox>>[]
  >([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const queryKey = ["meta-inbox", userId ?? "local"] as const;
  const canLoadAccountSettings = isLocalAuthDisabled || Boolean(userId);
  const metaReplySettings = useQuery({
    queryKey: ["meta-auto-reply-settings", userId ?? "local"],
    queryFn: getMetaAutoReplySettings,
    enabled: canLoadAccountSettings,
    retry: false,
  });
  const whatsAppReplySettings = useQuery({
    queryKey: ["whatsappAutoReplySettings", userId ?? "local"],
    queryFn: getWhatsAppAutoReplySettings,
    enabled: platform === "all" && canLoadAccountSettings,
    retry: false,
  });
  const inbox = useQuery({
    queryKey,
    queryFn: () => getMetaInbox(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const whatsappInbox = useQuery({
    queryKey: ["whatsapp-direct-inbox", userId ?? "local"],
    queryFn: getWhatsAppDirectConversations,
    enabled:
      platform === "all" && (isLocalAuthDisabled || Boolean(userId)),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const whatsappConversations = whatsappInbox.data?.conversations ?? [];
  const loadedItems = [
    ...(inbox.data?.items ?? []),
    ...olderPages.flatMap((page) => page.items),
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.id === item.id) === index,
  );
  const lastPage = olderPages.at(-1);
  const hasMore = lastPage?.hasMore ?? inbox.data?.hasMore ?? false;
  const nextCursor = lastPage?.nextCursor ?? inbox.data?.nextCursor ?? null;
  const canLoadOlder = hasMore && Boolean(nextCursor);
  const loadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await getMetaInbox({ cursor: nextCursor });
      const loadedIds = new Set(loadedItems.map((item) => item.id));
      const hasNewItems = page.items.some((item) => !loadedIds.has(item.id));
      setOlderPages((current) => [
        ...current,
        hasNewItems && page.hasMore && page.nextCursor
          ? page
          : { ...page, hasMore: false, nextCursor: null },
      ]);
    } catch (error) {
      setOlderError(
        error instanceof Error ? error.message : "تعذر تحميل العناصر الأقدم.",
      );
    } finally {
      setLoadingOlder(false);
    }
  };
  const refreshInbox = () => {
    setOlderPages([]);
    setOlderError(null);
    void inbox.refetch();
    void metaReplySettings.refetch();
    if (platform === "all") void whatsAppReplySettings.refetch();
    if (platform === "all") void whatsappInbox.refetch();
  };
  const filteredItems =
    loadedItems.filter((item) => {
      if (platform !== "all" && item.platform !== platform) return false;
      return filter === "all" || item.kind === filter;
    }) ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = normalizedSearch
    ? filteredItems.filter((item) =>
        [item.actorName, item.text]
          .filter(Boolean)
          .some(
            (value) =>
              value?.toLocaleLowerCase().includes(normalizedSearch) ?? false,
          ),
      )
    : filteredItems;
  const groups = groupInboxItems(visibleItems);
  const visibleWhatsAppConversations =
    platform === "all" && filter !== "comment"
      ? whatsappConversations.filter((conversation) =>
          normalizedSearch
            ? [conversation.customerNumber, conversation.preview].some((value) =>
                value.toLocaleLowerCase().includes(normalizedSearch),
              )
            : true,
        )
      : [];
  const rows: InboxListRow[] = [
    ...groups.map((group) => ({
      kind: "meta" as const,
      key: group.key,
      group,
      latestAt: group.latestAt,
    })),
    ...visibleWhatsAppConversations.map((conversation) => ({
      kind: "whatsapp" as const,
      key: `whatsapp:${conversation.remoteJid}`,
      conversation,
      latestAt: Date.parse(conversation.lastMessageAt) || 0,
    })),
  ].sort((first, second) => second.latestAt - first.latestAt);
  const selectPlatform = (nextPlatform: InboxPlatform) => {
    if (nextPlatform === "whatsapp") {
      router.push("/inbox/whatsapp");
      return;
    }
    setPlatform(nextPlatform);
    setFilter("all");
    router.setParams({ platform: nextPlatform });
  };
  const visibleMetaPlatforms: MetaInboxPlatform[] =
    platform === "all" ? ["facebook", "instagram"] : [platform];

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={
            inbox.isRefetching ||
            whatsappInbox.isRefetching ||
            metaReplySettings.isRefetching ||
            whatsAppReplySettings.isRefetching
          }
          onRefresh={refreshInbox}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.inboxHeader}>
        <BrandHeader />
        <PageTitle
          title="المحادثات"
          action={
            <IconButton
              icon="settings"
              label="إدارة إعدادات الرد الآلي"
              color={colors.primary}
              onPress={() => router.push("/inbox/reply-settings")}
            />
          }
        />
        <InboxPlatformTabs
          activePlatform={platform}
          onSelect={selectPlatform}
        />

        <Panel style={styles.automationSummary}>
          <View style={styles.automationHeading}>
            <Icon name="zap" size={15} color={colors.primary} />
            <Text style={[styles.automationHeadingText, { color: colors.foreground }]}>
              حالة الرد الآلي
            </Text>
          </View>
          <View style={styles.automationStatuses}>
            {metaReplySettings.data ? (
              visibleMetaPlatforms.map((channel) => (
                <View
                  key={channel}
                  style={[
                    styles.automationStatusChip,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <SocialPlatformIcon platform={channel} size={14} />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.automationStatus,
                      { color: colors.foreground },
                    ]}
                  >
                    {channel === "facebook" ? "فيسبوك" : "إنستغرام"} ·{" "}
                    {metaReplyStatus(metaReplySettings.data, channel)}
                  </Text>
                </View>
              ))
            ) : (
              <Text
                style={[
                  styles.automationMessage,
                  {
                    color: metaReplySettings.isPending
                      ? colors.mutedForeground
                      : colors.destructive,
                  },
                ]}
              >
                {metaReplySettings.isPending
                  ? "جارٍ التحقق من حالة Meta..."
                  : "تعذر التحقق من إعدادات الرد الآلي لـ Meta."}
              </Text>
            )}
            {platform === "all" ? (
              whatsAppReplySettings.data ? (
                <View
                  style={[
                    styles.automationStatusChip,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <SocialPlatformIcon platform="whatsapp" size={14} />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.automationStatus,
                      { color: colors.foreground },
                    ]}
                  >
                    واتساب ·{" "}
                    {!whatsAppReplySettings.data.connected
                      ? "الحساب غير متصل"
                      : whatsAppReplySettings.data.settings.enabled
                        ? "مفعّل"
                        : "متوقف"}
                  </Text>
                </View>
              ) : (
                <Text
                  style={[
                    styles.automationMessage,
                    {
                      color: whatsAppReplySettings.isPending
                        ? colors.mutedForeground
                        : colors.destructive,
                    },
                  ]}
                >
                  {whatsAppReplySettings.isPending
                    ? "جارٍ التحقق من حالة WhatsApp..."
                    : "تعذر التحقق من إعدادات الرد الآلي لـ WhatsApp."}
                </Text>
              )
            ) : null}
          </View>
        </Panel>
      </View>

      <Panel style={styles.inboxToolbar}>
        <View style={styles.toolbarHeading}>
          <Text style={[styles.toolbarTitle, { color: colors.foreground }]}>
            نوع التفاعل
          </Text>
          <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
            {formatArabicNumber(rows.length)} محادثة
          </Text>
        </View>
        <View
          style={[
            styles.searchRow,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Icon name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            accessibilityLabel="ابحث في الرسائل والتعليقات"
            value={search}
            onChangeText={setSearch}
            placeholder="ابحث بالاسم أو نص الرسالة"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="مسح البحث"
              onPress={() => setSearch("")}
              hitSlop={8}
            >
              <Icon name="x" size={17} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filters}>
          {filters.map((option) => {
            const selected = filter === option.key;
            const count =
              loadedItems.filter((item) => {
                return (
                  (platform === "all" || item.platform === platform) &&
                  (option.key === "all" || item.kind === option.key)
                );
              }).length +
              (platform === "all" && option.key !== "comment"
                ? whatsappConversations.length
                : 0);
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(option.key)}
                style={({ pressed }) => [
                  styles.filter,
                  {
                    backgroundColor: selected
                      ? colors.primary
                      : colors.background,
                    borderColor: selected ? colors.primary : colors.border,
                    opacity: pressed ? 0.78 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    {
                      color: selected
                        ? colors.primaryForeground
                        : colors.foreground,
                    },
                  ]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.filterCount,
                    {
                      color: selected
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {formatArabicNumber(count)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {inbox.isError ? (
          <Panel style={[styles.loadError, { borderColor: colors.border }]}>
            <View
              style={[
                styles.loadErrorIcon,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Icon name="alert-circle" size={22} color={colors.destructive} />
            </View>
            <Text style={[styles.loadErrorTitle, { color: colors.foreground }]}>
              تعذر تحميل صندوق الوارد
            </Text>
            <Text
              accessibilityRole="alert"
              style={[styles.loadErrorText, { color: colors.mutedForeground }]}
            >
              {inboxErrorMessage(inbox.error)}
            </Text>
            <ActionButton
              label={inbox.isFetching ? "جارٍ التحقق..." : "إعادة المحاولة"}
              icon={inbox.isFetching ? "clock" : "refresh-cw"}
              disabled={inbox.isFetching}
              onPress={() => void inbox.refetch()}
            />
          </Panel>
        ) : null}
        {platform === "all" && whatsappInbox.isError ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
              تعذر تحميل محادثات WhatsApp: {whatsappInbox.error instanceof Error
                ? whatsappInbox.error.message
                : "تحقق من اتصالك ثم أعد المحاولة."}
            </Text>
            <ActionButton
              label={whatsappInbox.isFetching ? "جارٍ التحقق..." : "إعادة تحميل WhatsApp"}
              icon={whatsappInbox.isFetching ? "clock" : "refresh-cw"}
              disabled={whatsappInbox.isFetching}
              onPress={() => void whatsappInbox.refetch()}
            />
          </View>
        ) : null}
        <View style={styles.toolbarFooter}>
          {inbox.data?.webhook.lastEventAt ? (
            <Text style={[styles.lastEvent, { color: colors.mutedForeground }]}>
              {`آخر نشاط: ${formatArabicDateTime(inbox.data.webhook.lastEventAt) ?? "غير محدد"}`}
            </Text>
          ) : null}
        </View>
      </Panel>

      {rows.length === 0 &&
      (inbox.isPending || (platform === "all" && whatsappInbox.isPending)) ? (
        <View
          accessible
          accessibilityLabel="جارٍ تحميل الرسائل والتعليقات"
          style={styles.groups}
        >
          {[0, 1, 2].map((index) => (
            <View
              key={`inbox-skeleton-${index}`}
              style={[
                styles.conversationCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Skeleton width={46} height={46} radius={16} />
              <View style={styles.conversationHeading}>
                <View style={styles.conversationTopLine}>
                  <Skeleton width="42%" height={12} radius={6} />
                  <Skeleton width={54} height={10} radius={5} />
                </View>
                <Skeleton width="86%" height={10} radius={5} />
                <Skeleton width="60%" height={10} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : rows.length === 0 &&
      (inbox.isError || (platform === "all" && whatsappInbox.isError)) ? null : rows.length === 0 ? (
        <EmptyState
          icon="message-square"
          title={
            search
              ? "لا توجد نتائج"
              : "لا توجد محادثات بعد"
          }
          body={
            search
              ? "جرّب البحث باسم مختلف أو جزء من نص الرسالة."
              : "ستظهر هنا الرسائل والتعليقات الواردة إلى حساباتك المتصلة."
          }
        />
      ) : rows.length > 0 ? (
        <View style={styles.groups}>
          {rows.map((row) => {
            if (row.kind === "whatsapp") {
              const { conversation } = row;
              return (
                <Pressable
                  key={row.key}
                  accessibilityRole="button"
                  accessibilityLabel={`فتح محادثة WhatsApp مع ${conversation.customerNumber}`}
                  onPress={() =>
                    router.push({
                      pathname: "/inbox/whatsapp",
                      params: { remoteJid: conversation.remoteJid },
                    })
                  }
                  style={[
                    styles.conversationCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View
                    style={[styles.conversationAvatar, { backgroundColor: colors.accent }]}
                  >
                    <Icon name="whatsapp" size={21} color={colors.primary} />
                  </View>
                  <View style={styles.conversationHeading}>
                    <View style={styles.conversationTopLine}>
                      <Text
                        style={[styles.conversationTitle, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {conversation.customerNumber}
                      </Text>
                      <Text style={[styles.conversationDate, { color: colors.mutedForeground }]}>
                        {formatArabicDateTime(conversation.lastMessageAt) ?? "غير محدد"}
                      </Text>
                    </View>
                    <View style={styles.conversationPreviewRow}>
                      <Icon name="message-circle" size={15} color={colors.mutedForeground} />
                      <Text
                        style={[styles.conversationPreview, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {conversation.preview || "رسالة بدون نص"}
                      </Text>
                    </View>
                    {platform === "all" ? (
                      <View style={styles.conversationBottomLine}>
                        <View style={[styles.platformBadge, { backgroundColor: colors.accent }]}>
                          <Text style={[styles.platformLabel, { color: colors.primary }]}>WhatsApp</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                  <Icon name="chevron-left" size={19} color={colors.primary} />
                </Pressable>
              );
            }
            const { group } = row;
            const latestItem = latestInboxItem(group);
            const messageCount = group.items.filter(
              (item) => item.kind === "message",
            ).length;
            const commentCount = group.items.length - messageCount;
            return (
              <Pressable
                key={group.key}
                accessibilityRole="button"
                accessibilityLabel={`فتح محادثة ${group.title}، ${messageCount} رسالة محمّلة و${commentCount} تعليق محمّل`}
                onPress={() =>
                  router.push({
                    pathname: "/inbox/[conversationId]",
                    params: {
                      conversationId: metaInboxPersonId(group.items[0]),
                      platform: group.platform,
                    },
                  })
                }
                style={[
                  styles.conversationCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.conversationAvatar,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  <SocialPlatformIcon platform={group.platform} size={25} />
                </View>
                <View style={styles.conversationHeading}>
                  <View style={styles.conversationTopLine}>
                    <Text
                      style={[
                        styles.conversationTitle,
                        { color: colors.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {group.title}
                    </Text>
                    <Text
                      style={[
                        styles.conversationDate,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {formatArabicDateTime(latestItem.occurredAt) ??
                        "غير محدد"}
                    </Text>
                  </View>
                  <View style={styles.conversationPreviewRow}>
                    <Icon
                      name={
                        latestItem.kind === "comment"
                          ? "message-square"
                          : "message-circle"
                      }
                      size={15}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.conversationPreview,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      {latestItem.text ||
                        (latestItem.media.length > 0
                          ? "رسالة تحتوي على مرفق"
                          : latestItem.kind === "comment"
                            ? "تعليق بدون نص"
                            : "رسالة بدون نص")}
                    </Text>
                  </View>
                  <View style={styles.conversationBottomLine}>
                    {platform === "all" ? (
                      <View
                        style={[
                          styles.platformBadge,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <Text
                          style={[
                            styles.platformLabel,
                            {
                              color:
                                group.platform === "instagram"
                                  ? colors.instagram
                                  : colors.facebook,
                            },
                          ]}
                        >
                          {group.platform === "facebook" ? "فيسبوك" : "إنستغرام"}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.conversationCounts}>
                      <View style={styles.countItem}>
                        <Icon
                          name="message-circle"
                          size={13}
                          color={colors.mutedForeground}
                        />
                        <Text
                          style={[
                            styles.conversationMeta,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {messageCount}
                        </Text>
                      </View>
                      <View style={styles.countItem}>
                        <Icon
                          name="message-square"
                          size={13}
                          color={colors.mutedForeground}
                        />
                        <Text
                          style={[
                            styles.conversationMeta,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {commentCount}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
                <Icon
                  name="chevron-left"
                  size={19}
                  color={
                    group.platform === "instagram"
                      ? colors.instagram
                      : colors.facebook
                  }
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {olderError ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {olderError}
        </Text>
      ) : null}
      {canLoadOlder ? (
        <ActionButton
          label={loadingOlder ? "جارٍ تحميل الأقدم..." : "تحميل عناصر أقدم"}
          icon={loadingOlder ? "clock" : "chevron-down"}
          disabled={loadingOlder}
          onPress={() => void loadOlder()}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  inboxHeader: { gap: 10 },
  automationSummary: { gap: 8, padding: 10, borderRadius: 14 },
  automationHeading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
  },
  automationHeadingText: { fontSize: 12, fontWeight: "800" },
  automationStatuses: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  automationStatusChip: {
    minHeight: 28,
    maxWidth: "100%",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  automationStatus: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "right",
  },
  automationMessage: { fontSize: 11, lineHeight: 16, textAlign: "right" },
  loadError: { alignItems: "center", gap: 10, paddingVertical: 20 },
  loadErrorIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  loadErrorTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  loadErrorText: {
    maxWidth: 420,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  inboxToolbar: { gap: 10, padding: 12 },
  toolbarHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toolbarTitle: { fontSize: 12, fontWeight: "800", textAlign: "right" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
  },
  filterLabel: { fontSize: 11, fontWeight: "700" },
  filterCount: { fontSize: 11, fontWeight: "700" },
  toolbarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },
  resultCount: { fontSize: 11, fontWeight: "700" },
  searchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    textAlign: "right",
    writingDirection: "rtl",
    fontSize: 14,
  },
  items: { gap: 12 },
  groups: { gap: 10 },
  conversationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    minHeight: 96,
  },
  conversationAvatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationHeading: { flex: 1, minWidth: 0, gap: 9 },
  conversationTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  conversationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  conversationDate: { fontSize: 10, textAlign: "left" },
  conversationPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  conversationPreview: { flex: 1, fontSize: 12, textAlign: "right" },
  conversationBottomLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  platformBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  platformLabel: { fontSize: 10, fontWeight: "700" },
  conversationCounts: { flexDirection: "row", alignItems: "center", gap: 10 },
  countItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  conversationMeta: { fontSize: 11 },
  lastEvent: { fontSize: 12, textAlign: "left" },
});
