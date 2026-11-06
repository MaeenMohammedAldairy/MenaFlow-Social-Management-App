import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { formatArabicDateTime } from "@/lib/formatting";
import {
  activateMetaWebhookSubscriptions,
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
      if (!group.title || group.title === "مستخدم") {
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
      title: item.actorName || "مستخدم",
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const queryKey = ["meta-inbox", userId ?? "local"] as const;
  const inbox = useQuery({
    queryKey,
    queryFn: getMetaInbox,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const setup = useMutation({
    mutationFn: activateMetaWebhookSubscriptions,
    onSuccess: async (result) => {
      const failed = Object.entries(result.subscriptions).filter(
        ([, status]) => !status.subscribed,
      );
      setActionError(
        failed.length
          ? "لم تكتمل تهيئة كل الحسابات. تحقق من الصلاحيات واشتراكات Webhooks في لوحة Meta."
          : null,
      );
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "تعذر تفعيل Webhooks.",
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const filteredItems =
    inbox.data?.items.filter((item) => {
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
  const subscriptions = inbox.data?.webhook.subscriptions ?? {};
  const connectedPlatforms = (["facebook", "instagram"] as const).filter(
    (platform) => Boolean(inbox.data?.webhook.accounts[platform]),
  );
  const allConfiguredSubscriptions =
    connectedPlatforms.length > 0 &&
    connectedPlatforms.every((platform) => {
      const subscription = subscriptions[platform];
      return (
        subscription?.subscribedAt &&
        subscription.accountId === inbox.data?.webhook.accounts[platform]
      );
    });
  const setupAvailable = inbox.data?.webhook.verificationConfigured === true;
  const subscriptionSummary = connectedPlatforms
    .map((platform) => {
      const subscribed =
        subscriptions[platform]?.accountId ===
          inbox.data?.webhook.accounts[platform] &&
        Boolean(subscriptions[platform]?.subscribedAt);
      return `${platform === "facebook" ? "فيسبوك" : "إنستغرام"}: ${
        subscribed ? "مفعّل" : "بانتظار التفعيل"
      }`;
    })
    .join(" · ");

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={inbox.isRefetching}
          onRefresh={() => void inbox.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle
        title="الرسائل والتعليقات"
        subtitle="تابع الرسائل والتعليقات الواردة من حسابات Meta ورد عليها من مكان واحد."
      />

      {!setupAvailable || !allConfiguredSubscriptions ? (
        <Panel style={styles.setupPanel}>
          <View style={styles.setupHeading}>
            <Icon name="info" size={20} color={colors.warning} />
            <Text style={[styles.setupTitle, { color: colors.foreground }]}>
              {setupAvailable
                ? "فعّل استقبال الأحداث من Meta"
                : "يلزم إعداد Webhook على الخادم"}
            </Text>
          </View>
          <Text style={[styles.setupText, { color: colors.mutedForeground }]}>
            {setupAvailable
              ? "تأكد من إضافة عنوان الاستقبال وحقول الرسائل والتعليقات في لوحة تطبيق Meta، ثم فعّل اشتراك الحسابات."
              : "أضف MENA_META_WEBHOOK_VERIFY_TOKEN إلى إعدادات الخادم وأعد تشغيله. ثم أكمل إعداد عنوان Webhook وحقوله في لوحة تطبيق Meta."}
          </Text>
          {subscriptionSummary ? (
            <Text style={[styles.setupText, { color: colors.mutedForeground }]}>
              {subscriptionSummary}
            </Text>
          ) : null}
          {inbox.data?.webhook.callbackUrl ? (
            <Text
              selectable
              style={[styles.callback, { color: colors.primary }]}
            >
              {inbox.data.webhook.callbackUrl}
            </Text>
          ) : null}
          {setupAvailable ? (
            <ActionButton
              label={
                setup.isPending ? "جارٍ التفعيل..." : "تفعيل الحسابات المتصلة"
              }
              icon="refresh-cw"
              disabled={setup.isPending || inbox.isPending}
              onPress={() => {
                setActionError(null);
                setup.mutate();
              }}
            />
          ) : null}
        </Panel>
      ) : null}

      {actionError ? (
        <Panel style={[styles.errorPanel, { borderColor: colors.destructive }]}>
          <Text style={{ color: colors.destructive, textAlign: "left" }}>
            {actionError}
          </Text>
        </Panel>
      ) : null}

      {inbox.isError ? (
        <EmptyState
          icon="alert-circle"
          title="تعذر تحميل صندوق الوارد"
          body={
            inbox.error instanceof Error
              ? inbox.error.message
              : "تحقق من اتصال الإنترنت ثم أعد المحاولة."
          }
        />
      ) : null}

      <MetaAutoReplySettingsPanel userId={userId} />

      <View style={styles.filters}>
        {filters.map((option) => {
          const selected = filter === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(option.key)}
              style={[
                styles.filter,
                {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color: selected
                    ? colors.primaryForeground
                    : colors.foreground,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View
        style={[
          styles.searchRow,
          { borderColor: colors.border, backgroundColor: colors.card },
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
      {inbox.data ? (
        <Text style={[styles.lastEvent, { color: colors.mutedForeground }]}>
          {inbox.data.webhook.lastEventAt
            ? `آخر رسالة أو تعليق مستلم: ${formatArabicDateTime(inbox.data.webhook.lastEventAt) ?? "غير محدد"}`
            : "لم تُستقبل رسائل أو تعليقات من Meta حتى الآن"}
        </Text>
      ) : null}

      {inbox.isPending ? (
        <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
          جارٍ تحميل الرسائل والتعليقات...
        </Text>
      ) : visibleItems.length === 0 && !inbox.isError ? (
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
              : allConfiguredSubscriptions
                ? "ستظهر هنا رسائل وتعليقات الحسابات المتصلة عند وصولها."
                : "أكمل إعداد Webhooks وفعّل اشتراك الحسابات، ثم أرسل رسالة أو أضف تعليقًا للاختبار."
          }
        />
      ) : (
        <View style={styles.groups}>
          <Text style={[styles.resultsCount, { color: colors.mutedForeground }]}>
            {visibleItems.length} نتيجة · عدد المحادثات: {groups.length}
          </Text>
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
                accessibilityLabel={`فتح محادثة ${group.title}، ${messageCount} رسالة و${commentCount} تعليق`}
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
                  <Icon
                    name="user"
                    size={20}
                    color={
                      group.platform === "instagram"
                        ? colors.instagram
                        : colors.facebook
                    }
                  />
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
                      <Icon
                        name={group.platform}
                        size={13}
                        color={
                          group.platform === "instagram"
                            ? colors.instagram
                            : colors.facebook
                        }
                      />
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
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  setupPanel: { gap: 12 },
  setupHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  setupTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  setupText: { fontSize: 13, lineHeight: 22, textAlign: "left" },
  callback: {
    fontSize: 12,
    textAlign: "left",
    writingDirection: "ltr",
  },
  errorPanel: { borderWidth: 1 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  searchRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    textAlign: "right",
    writingDirection: "rtl",
    fontSize: 14,
  },
  items: { gap: 12 },
  groups: { gap: 14 },
  conversationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    minHeight: 100,
  },
  conversationAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationHeading: { flex: 1, gap: 8 },
  conversationTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  conversationTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  conversationDate: { fontSize: 10, textAlign: "left" },
  conversationPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
