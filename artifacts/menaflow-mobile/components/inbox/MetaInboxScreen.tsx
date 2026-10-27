import React, { useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
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
import {
  activateMetaWebhookSubscriptions,
  getMetaInbox,
  sendMetaInboxReply,
  type MetaInboxItem,
  type MetaInboxKind,
  type MetaInboxPlatform,
} from "@/lib/meta-inbox-api";
import { MetaInboxItemCard } from "./MetaInboxItemCard";
import { MetaAutoReplySettingsPanel } from "./MetaAutoReplySettingsPanel";

type InboxFilter = "all" | MetaInboxPlatform | MetaInboxKind;

const filters: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "message", label: "الرسائل" },
  { key: "comment", label: "التعليقات" },
  { key: "facebook", label: "فيسبوك" },
  { key: "instagram", label: "إنستغرام" },
];

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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
  const reply = useMutation({
    mutationFn: ({ item, text }: { item: MetaInboxItem; text: string }) =>
      sendMetaInboxReply(item.id, text),
    onSuccess: async (_result, variables) => {
      setDrafts((current) => ({ ...current, [variables.item.id]: "" }));
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "تعذر إرسال الرد.",
      ),
  });

  const visibleItems =
    inbox.data?.items.filter((item) => {
      if (filter === "all") return true;
      return item.platform === filter || item.kind === filter;
    }) ?? [];
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
          <Text style={{ color: colors.destructive, textAlign: "right" }}>
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
      {inbox.data ? (
        <Text style={[styles.lastEvent, { color: colors.mutedForeground }]}>
          {inbox.data.webhook.lastEventAt
            ? `آخر رسالة أو تعليق مستلم: ${new Date(inbox.data.webhook.lastEventAt).toLocaleString("ar")}`
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
          title="لا توجد رسائل أو تعليقات بعد"
          body={
            allConfiguredSubscriptions
              ? "ستظهر هنا رسائل وتعليقات الحسابات المتصلة عند وصولها."
              : "أكمل إعداد Webhooks وفعّل اشتراك الحسابات، ثم أرسل رسالة أو أضف تعليقًا للاختبار."
          }
        />
      ) : (
        <View style={styles.items}>
          {visibleItems.map((item) => (
            <MetaInboxItemCard
              key={`${item.platform}:${item.externalId}`}
              item={item}
              replyText={drafts[item.id] ?? ""}
              onChangeReply={(text) =>
                setDrafts((current) => ({ ...current, [item.id]: text }))
              }
              onReply={() => {
                setActionError(null);
                reply.mutate({ item, text: drafts[item.id]?.trim() ?? "" });
              }}
              sending={reply.isPending && reply.variables?.item.id === item.id}
            />
          ))}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  setupPanel: { gap: 12 },
  setupHeading: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  setupTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  setupText: { fontSize: 13, lineHeight: 22, textAlign: "right" },
  callback: { fontSize: 12, textAlign: "left" },
  errorPanel: { borderWidth: 1 },
  filters: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  filter: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  items: { gap: 12 },
  lastEvent: { fontSize: 12, textAlign: "right" },
});
