import React, { useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  BrandHeader,
  EmptyState,
  navigateBack,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { formatArabicDateTime } from "@/lib/formatting";
import {
  confirmMetaInboxReplyNotSent,
  getMetaInbox,
  metaInboxPersonId,
  sendMetaInboxReply,
  type MetaInboxItem,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";
import { MetaInboxItemCard } from "@/components/inbox/MetaInboxItemCard";

function isMetaPlatform(value: string | undefined): value is MetaInboxPlatform {
  return value === "facebook" || value === "instagram";
}

export default function InboxConversationRoute() {
  return isLocalAuthDisabled ? (
    <InboxConversationContent userId={null} />
  ) : (
    <AuthenticatedInboxConversation />
  );
}

function AuthenticatedInboxConversation() {
  const { userId } = useAuth();
  return <InboxConversationContent userId={userId ?? null} />;
}

function InboxConversationContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { conversationId: rawPersonId, platform: rawPlatform } =
    useLocalSearchParams<{
      conversationId?: string | string[];
      platform?: string | string[];
    }>();
  const personId = Array.isArray(rawPersonId) ? rawPersonId[0] : rawPersonId;
  const platformParam = Array.isArray(rawPlatform)
    ? rawPlatform[0]
    : rawPlatform;
  const platform = isMetaPlatform(platformParam) ? platformParam : null;
  const queryKey = ["meta-inbox", userId ?? "local"] as const;
  const inbox = useQuery({
    queryKey,
    queryFn: getMetaInbox,
    enabled: Boolean(personId && platform && (isLocalAuthDisabled || userId)),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: ({ item, text }: { item: MetaInboxItem; text: string }) =>
      sendMetaInboxReply(item.id, text),
    onSuccess: (_result, variables) => {
      setDrafts((current) => ({ ...current, [variables.item.id]: "" }));
      setActionError(null);
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "تعذر إرسال الرد.",
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const confirmRetry = useMutation({
    mutationFn: (item: MetaInboxItem) => confirmMetaInboxReplyNotSent(item.id),
    onSuccess: () => setActionError(null),
    onError: (error) =>
      setActionError(
        error instanceof Error
          ? error.message
          : "تعذر تأكيد نتيجة محاولة الرد.",
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const items = (inbox.data?.items ?? [])
    .filter(
      (item) =>
        platform !== null &&
        personId !== undefined &&
        item.platform === platform &&
        metaInboxPersonId(item) === personId,
    )
    .sort(
      (first, second) =>
        Date.parse(first.occurredAt) - Date.parse(second.occurredAt),
    );
  const title = items.find((item) => item.actorName)?.actorName || "مستخدم";
  const platformLabel = platform === "facebook" ? "فيسبوك" : "إنستغرام";
  const latestItem = items.at(-1);
  const messageCount = items.filter((item) => item.kind === "message").length;
  const commentCount = items.length - messageCount;

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="العودة إلى صندوق الوارد"
        onPress={() => navigateBack("/(tabs)/inbox")}
        style={styles.backButton}
      >
        <Icon name="chevron-right" size={18} color={colors.primary} />
        <Text style={[styles.backLabel, { color: colors.primary }]}>
          العودة إلى الوارد
        </Text>
      </Pressable>

      <PageTitle
        title={title}
        subtitle={
          platform
            ? `محادثة ${platformLabel} · الرسائل والتعليقات مرتبة حسب وقت الاستلام`
            : "تعذر تحديد المنصة لهذه المحادثة."
        }
      />

      {actionError ? (
        <Panel style={[styles.errorPanel, { borderColor: colors.destructive }]}>
          <Text style={{ color: colors.destructive, textAlign: "right" }}>
            {actionError}
          </Text>
        </Panel>
      ) : null}

      {inbox.isPending && personId && platform ? (
        <Text style={[styles.notice, { color: colors.mutedForeground }]}>
          جارٍ تحميل المحادثة...
        </Text>
      ) : inbox.isError ? (
        <EmptyState
          icon="alert-circle"
          title="تعذر تحميل المحادثة"
          body={
            inbox.error instanceof Error
              ? inbox.error.message
              : "تحقق من اتصال الإنترنت ثم أعد المحاولة."
          }
        />
      ) : !personId || !platform ? (
        <EmptyState
          icon="message-square"
          title="رابط المحادثة غير صالح"
          body="ارجع إلى صندوق الوارد وافتح المحادثة من القائمة."
        />
      ) : items.length === 0 && !inbox.isPending ? (
        <EmptyState
          icon="message-square"
          title="لا توجد رسائل أو تعليقات"
          body="قد تكون المحادثة حُذفت أو لم تعد ضمن العناصر المحمّلة."
        />
      ) : (
        <View style={styles.thread}>
          <Panel style={styles.summary}>
            <View style={styles.summaryTop}>
              <View style={styles.summaryCopy}>
                <Text
                  style={[styles.summaryName, { color: colors.foreground }]}
                >
                  سجل المحادثة
                </Text>
                <Text
                  style={[
                    styles.summaryMeta,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {platformLabel}
                  {latestItem
                    ? ` · آخر تفاعل ${formatArabicDateTime(latestItem.occurredAt) ?? "غير محدد"}`
                    : ""}
                </Text>
              </View>
              <Icon
                name="message-circle"
                size={21}
                color={
                  platform === "instagram"
                    ? colors.instagram
                    : colors.facebook
                }
              />
            </View>
            <View style={styles.counts}>
              <View
                style={[
                  styles.countBadge,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Icon
                  name="message-circle"
                  size={14}
                  color={colors.primary}
                />
                <Text style={[styles.count, { color: colors.foreground }]}>
                  {messageCount} رسالة
                </Text>
              </View>
              <View
                style={[
                  styles.countBadge,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Icon
                  name="message-square"
                  size={14}
                  color={colors.primary}
                />
                <Text style={[styles.count, { color: colors.foreground }]}>
                  {commentCount} تعليق
                </Text>
              </View>
            </View>
          </Panel>

          <View style={styles.timeline}>
            {items.map((item, index) => (
              <View
                key={`${item.platform}:${item.externalId}`}
                style={styles.timelineItem}
              >
                <View
                  style={[
                    styles.timelineMarker,
                    {
                      backgroundColor:
                        item.platform === "instagram"
                          ? colors.instagram
                          : colors.facebook,
                    },
                  ]}
                />
                <MetaInboxItemCard
                  item={item}
                  replyText={drafts[item.id] ?? ""}
                  onChangeReply={(text) =>
                    setDrafts((current) => ({ ...current, [item.id]: text }))
                  }
                  onReply={() => {
                    setActionError(null);
                    reply.mutate({ item, text: drafts[item.id]?.trim() ?? "" });
                  }}
                  onConfirmUnknown={() => {
                    setActionError(null);
                    confirmRetry.mutate(item);
                  }}
                  sending={
                    reply.isPending && reply.variables?.item.id === item.id
                  }
                  confirmingUnknown={
                    confirmRetry.isPending &&
                    confirmRetry.variables?.id === item.id
                  }
                />
                {index < items.length - 1 ? (
                  <View
                    style={[
                      styles.timelineConnector,
                      { backgroundColor: colors.border },
                    ]}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 40,
  },
  backLabel: { fontSize: 13, fontWeight: "700" },
  errorPanel: { borderWidth: 1 },
  notice: { textAlign: "center", paddingVertical: 16 },
  thread: { gap: 12 },
  summary: { gap: 10, padding: 14 },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryCopy: { flex: 1, gap: 3 },
  summaryName: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  summaryMeta: { fontSize: 11, textAlign: "right" },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  count: { fontSize: 11, textAlign: "right", fontWeight: "700" },
  timeline: { gap: 0 },
  timelineItem: { position: "relative", paddingLeft: 12, paddingBottom: 14 },
  timelineMarker: {
    position: "absolute",
    left: 0,
    top: 17,
    width: 7,
    height: 7,
    borderRadius: 4,
    zIndex: 1,
  },
  timelineConnector: {
    position: "absolute",
    left: 3,
    top: 27,
    bottom: 0,
    width: 1,
  },
});
