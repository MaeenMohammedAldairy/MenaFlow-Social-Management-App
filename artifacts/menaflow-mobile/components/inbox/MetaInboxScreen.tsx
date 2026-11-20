import React, { useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
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
  Panel,
} from "@/components/Ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import {
  FilterBar,
  FilterChipGroup,
  FilterSheet,
} from "@/components/FilterBar";
import { formatArabicDateTime, formatArabicNumber } from "@/lib/formatting";
import {
  getMetaInbox,
  metaInboxPersonId,
  type InboxPlatform,
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
  const insets = useSafeAreaInsets();
  const { platform: routePlatform } = useLocalSearchParams<{ platform?: string }>();
  const initialPlatform: InboxPlatform =
    routePlatform === "whatsapp" ||
    routePlatform === "facebook" ||
    routePlatform === "instagram"
      ? routePlatform
      : "all";
  const [platform, setPlatform] = useState<InboxPlatform>(initialPlatform);
  const [filter, setFilter] = useState<InboxFilter>("all");
  useEffect(() => {
    setPlatform(initialPlatform);
    setFilter("all");
  }, [initialPlatform]);
  const showsWhatsApp = platform === "all" || platform === "whatsapp";
  const [search, setSearch] = useState("");
  const [olderPages, setOlderPages] = useState<
    Awaited<ReturnType<typeof getMetaInbox>>[]
  >([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const queryKey = ["meta-inbox", userId ?? "local"] as const;
  const inbox = useQuery({
    queryKey,
    queryFn: () => getMetaInbox(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const whatsappInbox = useQuery({
    queryKey: ["whatsapp-direct-inbox", userId ?? "local"],
    queryFn: getWhatsAppDirectConversations,
    enabled: showsWhatsApp && (isLocalAuthDisabled || Boolean(userId)),
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
    if (showsWhatsApp) void whatsappInbox.refetch();
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
    showsWhatsApp && filter !== "comment"
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
    setPlatform(nextPlatform);
    setFilter("all");
    router.setParams({ platform: nextPlatform });
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCounts = filters.reduce<Record<string, number>>((counts, option) => {
    counts[option.key] =
      loadedItems.filter(
        (item) =>
          (platform === "all" || item.platform === platform) &&
          (option.key === "all" || item.kind === option.key),
      ).length +
      (showsWhatsApp && option.key !== "comment"
        ? whatsappConversations.length
        : 0);
    return counts;
  }, {});
  const activeFilterCount =
    (filter !== "all" ? 1 : 0) + (platform !== "all" ? 1 : 0);

  const renderRow = (row: InboxListRow) => {
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
              {platform === "all" ? (
                <Icon name="whatsapp" size={15} color={colors.primary} />
              ) : null}
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
  };

  return (
    <Page scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => renderRow(item)}
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
        ListHeaderComponent={
          <View style={styles.listHeaderStack}>
      <BrandHeader
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
      <FilterBar
        activeCount={activeFilterCount}
        onOpenFilters={() => setFiltersOpen(true)}
      >
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
      </FilterBar>

      <View style={styles.inboxMeta}>
        <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
          {formatArabicNumber(rows.length)} محادثة
        </Text>
        {inbox.data?.webhook.lastEventAt ? (
          <Text style={[styles.lastEvent, { color: colors.mutedForeground }]}>
            {`آخر نشاط: ${formatArabicDateTime(inbox.data.webhook.lastEventAt) ?? "غير محدد"}`}
          </Text>
        ) : null}
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
          </View>
        }
        ListEmptyComponent={
          <>
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
      ) : null}
          </>
        }
        ListFooterComponent={
          <>
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
          </>
        }
        style={styles.listFill}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 112 + insets.bottom },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching || whatsappInbox.isRefetching}
            onRefresh={refreshInbox}
            tintColor={colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onClear={() => {
          setFilter("all");
          selectPlatform("all");
        }}
      >
        <FilterChipGroup
          title="نوع التفاعل"
          selected={filter}
          onSelect={(key) => setFilter(key as InboxFilter)}
          options={filters.map((option) => ({
            key: option.key,
            label: option.label,
            count: filterCounts[option.key] ?? 0,
          }))}
        />
        <FilterChipGroup
          title="المنصة"
          selected={platform}
          onSelect={(key) => selectPlatform(key as InboxPlatform)}
          options={[
            { key: "all", label: "كل المنصات" },
            { key: "facebook", label: "فيسبوك" },
            { key: "instagram", label: "إنستغرام" },
            { key: "whatsapp", label: "واتساب" },
          ]}
        />
      </FilterSheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  listFill: { flex: 1 },
  listContent: { gap: 10 },
  listHeaderStack: { gap: 18 },
  rowSeparator: { height: 10 },
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
  inboxMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  resultCount: { fontSize: 12, fontWeight: "700" },
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
  conversationDate: { fontSize: 12, textAlign: "right" },
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
  platformLabel: { fontSize: 12, fontWeight: "700" },
  conversationCounts: { flexDirection: "row", alignItems: "center", gap: 10 },
  countItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  conversationMeta: { fontSize: 12 },
  lastEvent: { fontSize: 12, textAlign: "right" },
});
