import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { SocialPlatformIcon } from "@/components/SocialPlatformIcon";
import { formatArabicDateTime } from "@/lib/formatting";
import {
  getMetaInbox,
  metaInboxPersonId,
  type MetaInboxItem,
  type MetaInboxKind,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";
import { MetaAutoReplySettingsPanel } from "./MetaAutoReplySettingsPanel";

type InboxFilter = "all" | MetaInboxPlatform | MetaInboxKind;

const filters: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "message", label: "الرسائل" },
  { key: "comment", label: "التعليقات" },
  { key: "facebook", label: "فيسبوك" },
  { key: "instagram", label: "إنستغرام" },
];

type InboxGroup = {
  key: string;
  title: string;
  platform: MetaInboxPlatform;
  items: MetaInboxItem[];
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
  const [filter, setFilter] = useState<InboxFilter>("all");
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
  const loadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await getMetaInbox({ cursor: nextCursor });
      setOlderPages((current) => [...current, page]);
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
  };
  const filteredItems =
    loadedItems.filter((item) => {
      if (filter === "all") return true;
      return item.platform === filter || item.kind === filter;
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

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={inbox.isRefetching}
          onRefresh={refreshInbox}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <Panel style={styles.inboxIntro}>
        <View
          style={[
            styles.inboxEyebrow,
            { backgroundColor: colors.accent },
          ]}
        >
          <Icon name="message-square" size={15} color={colors.primary} />
          <Text style={[styles.inboxEyebrowText, { color: colors.primary }]}>
            صندوق Meta الموحد
          </Text>
        </View>
        <PageTitle
          title="الرسائل والتعليقات"
          subtitle="تابع الرسائل والتعليقات الواردة من حسابات Meta ورد عليها من مكان واحد."
        />
      </Panel>

      <MetaAutoReplySettingsPanel userId={userId} />

      <Panel style={styles.inboxToolbar}>
        <View style={styles.toolbarHeading}>
          <View style={styles.toolbarTitleGroup}>
            <View
              style={[
                styles.toolbarIcon,
                { backgroundColor: colors.accent },
              ]}
            >
              <Icon name="message-square" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.toolbarTitle, { color: colors.foreground }]}>
              المحادثات الواردة
            </Text>
          </View>
          {inbox.data ? (
            <View
              style={[
                styles.totalBadge,
                { backgroundColor: colors.secondary },
              ]}
            >
              <Text
                style={[
                  styles.totalBadgeText,
                  { color: colors.foreground },
                ]}
              >
                {groups.length}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.filters}>
          {filters.map((option) => {
            const selected = filter === option.key;
            const count =
              loadedItems.filter((item) => {
                if (option.key === "all") return true;
                return (
                  item.platform === option.key || item.kind === option.key
                );
              }).length ?? null;
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
                {count !== null ? (
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
                    {count}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
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
        <View style={styles.toolbarFooter}>
          {inbox.data?.webhook.lastEventAt ? (
            <Text style={[styles.lastEvent, { color: colors.mutedForeground }]}>
              {`آخر نشاط: ${formatArabicDateTime(inbox.data.webhook.lastEventAt) ?? "غير محدد"}`}
            </Text>
          ) : null}
          {inbox.data ? (
            <Text
              style={[
                styles.resultCount,
                { color: colors.mutedForeground },
              ]}
            >
              {visibleItems.length} عنصر محمّل
            </Text>
          ) : null}
        </View>
      </Panel>

      {inbox.isPending ? (
        <Panel style={styles.loadingPanel}>
          <Icon name="clock" size={18} color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            جارٍ تحميل الرسائل والتعليقات...
          </Text>
        </Panel>
      ) : inbox.isError ? null : visibleItems.length === 0 ? (
        <EmptyState
          icon="message-square"
          title={
            search
              ? "لا توجد نتائج"
              : "لا توجد رسائل أو تعليقات بعد"
          }
          body={
            search
              ? "جرّب البحث باسم مختلف أو جزء من نص الرسالة."
              : "ستظهر هنا رسائل وتعليقات الحسابات المتصلة تلقائيًا عند وصولها."
          }
        />
      ) : visibleItems.length > 0 ? (
        <View style={styles.groups}>
          {groups.map((group) => {
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
                    <View
                      style={[
                        styles.platformBadge,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <SocialPlatformIcon platform={group.platform} size={16} />
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
      {hasMore ? (
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
  inboxIntro: { padding: 18, gap: 12 },
  inboxEyebrow: {
    alignSelf: "flex-start",
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 9,
  },
  inboxEyebrowText: { fontSize: 11, fontWeight: "700" },
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
  inboxToolbar: { gap: 12 },
  toolbarHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toolbarTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  toolbarIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  toolbarTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  totalBadge: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 7,
  },
  totalBadgeText: { fontSize: 12, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
  },
  filterLabel: { fontSize: 11, fontWeight: "700" },
  filterCount: { fontSize: 10, fontWeight: "700" },
  toolbarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  resultCount: { fontSize: 11, fontWeight: "700" },
  loadingPanel: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  loadingText: { fontSize: 12, textAlign: "center" },
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
  groups: { gap: 14 },
  conversationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    minHeight: 108,
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
  resultsCount: { fontSize: 12, textAlign: "left" },
  lastEvent: { fontSize: 12, textAlign: "left" },
});
