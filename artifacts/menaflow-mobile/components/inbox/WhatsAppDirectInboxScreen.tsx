import { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { Skeleton } from "@/components/Skeleton";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, EmptyState, IconButton, Page, Panel } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { formatArabicDate } from "@/lib/formatting";
import {
  confirmWhatsAppDirectReplyNotSent,
  getWhatsAppDirectConversations,
  getWhatsAppDirectMessages,
  sendWhatsAppDirectReply,
  whatsappDirectMessagePlaceholder,
  type WhatsAppDirectMessage,
  type WhatsAppDirectMessageCursor,
} from "@/lib/whatsapp-direct-inbox-api";

function directConversationLabel(remoteJid: string): string {
  return remoteJid.endsWith("@lid")
    ? `معرّف ${remoteJid.replace(/@lid$/, "")}`
    : remoteJid.replace(/@s\.whatsapp\.net$/, "");
}

function AuthenticatedWhatsAppDirectInbox() {
  const { userId } = useAuth();
  return <WhatsAppDirectInboxContent userId={userId ?? null} />;
}

export default function WhatsAppDirectInboxScreen() {
  return isLocalAuthDisabled ? (
    <WhatsAppDirectInboxContent userId={null} />
  ) : (
    <AuthenticatedWhatsAppDirectInbox />
  );
}

function makeRequestId(): string {
  return `whatsapp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Replies we deliberately did not send. They are recorded as `failed` in the
 * queue so nothing retries them, but nothing went wrong for the merchant, so
 * they are shown as information instead of an error.
 */
function suppressedAutoReplyMessage(
  message: WhatsAppDirectMessage,
): string | null {
  if (
    message.direction !== "inbound" ||
    message.autoReplyStatus !== "failed"
  ) {
    return null;
  }
  if (message.autoReplyErrorCode === "SUPERSEDED_BY_NEWER_MESSAGE") {
    return "لم يُرسل هذا الرد لأن رسالة أحدث وصلت من العميل، ويجري الرد عليها.";
  }
  if (message.autoReplyErrorCode === "AUTO_REPLY_LOOP_GUARD") {
    return "أوقفنا الرد الآلي في هذه المحادثة مؤقتًا لتجاوزها حد الردود التلقائية في الساعة الأخيرة. يمكنك الرد يدويًا.";
  }
  if (message.autoReplyErrorCode === "AUTO_REPLY_WINDOW_EXPIRED") {
    return "لم يُرسل الرد الآلي لأن الرسالة أقدم من المدة المسموحة للرد التلقائي. يمكنك الرد يدويًا.";
  }
  if (message.autoReplyErrorCode === "AUTO_REPLY_DISABLED") {
    return "الرد الآلي غير مفعّل لهذه الرسالة. يمكنك الرد يدويًا.";
  }
  return null;
}

function sendFailureMessage(message: WhatsAppDirectMessage): string | null {
  if (
    message.direction === "inbound" &&
    message.autoReplyStatus === "failed"
  ) {
    if (suppressedAutoReplyMessage(message)) return null;
    if (message.autoReplyErrorCode === "SubscriptionAiQuotaError") {
      return "تعذّر إنشاء الرد الآلي لأن حصة الذكاء الاصطناعي مستنفدة. زد الحصة أو أرسل ردًا يدويًا.";
    }
    return "تعذّر إرسال الرد الآلي. يمكنك الرد يدويًا أو مراجعة إعداداته.";
  }
  if (message.direction === "outbound" && message.status === "failed") {
    return message.errorCode === "MANUAL_CONFIRMED_NOT_SENT"
      ? "تأكد أن الرد اليدوي لم يصل إلى العميل. يمكنك إعادة المحاولة."
      : "تعذّر إرسال الرد اليدوي. تحقق من اتصال WhatsApp ثم أعد المحاولة.";
  }
  return null;
}

function WhatsAppDirectInboxContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { remoteJid: routeRemoteJid } = useLocalSearchParams<{
    remoteJid?: string | string[];
  }>();
  const initialRemoteJid = Array.isArray(routeRemoteJid)
    ? routeRemoteJid[0]
    : routeRemoteJid;
  const [selectedRemoteJid, setSelectedRemoteJid] = useState<string | null>(
    initialRemoteJid ?? null,
  );
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedRemoteJid(initialRemoteJid ?? null);
    setDraft("");
    setRequestId(null);
  }, [initialRemoteJid]);
  const inboxKey = ["whatsapp-direct-inbox", userId ?? "local"] as const;
  const conversations = useQuery({
    queryKey: inboxKey,
    queryFn: getWhatsAppDirectConversations,
    enabled: isLocalAuthDisabled || Boolean(userId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const messagesKey = [
    "whatsapp-direct-messages",
    userId ?? "local",
    selectedRemoteJid,
  ] as const;
  const messages = useInfiniteQuery({
    queryKey: messagesKey,
    initialPageParam: undefined as WhatsAppDirectMessageCursor | undefined,
    queryFn: ({ pageParam }) =>
      getWhatsAppDirectMessages(selectedRemoteJid!, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(selectedRemoteJid && (isLocalAuthDisabled || userId)),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const reply = useMutation({
    mutationFn: sendWhatsAppDirectReply,
    onSuccess: async () => {
      setDraft("");
      setRequestId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxKey }),
        queryClient.invalidateQueries({ queryKey: messagesKey }),
      ]);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxKey }),
        queryClient.invalidateQueries({ queryKey: messagesKey }),
      ]);
    },
  });
  const confirmNotSent = useMutation({
    mutationFn: confirmWhatsAppDirectReplyNotSent,
    onSuccess: async () => {
      setRequestId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxKey }),
        queryClient.invalidateQueries({ queryKey: messagesKey }),
      ]);
    },
  });
  const selectedConversation = conversations.data?.conversations.find(
    (conversation) => conversation.remoteJid === selectedRemoteJid,
  );
  const orderedMessages = messages.data
    ? [...messages.data.pages].reverse().flatMap((page) => page.messages)
    : [];
  const canReply = selectedRemoteJid?.endsWith("@s.whatsapp.net") ?? false;
  const hasUnknownSend = orderedMessages.some(
    (message) =>
      message.status === "unknown" || message.autoReplyStatus === "unknown",
  );
  const hasPendingAutoReply = orderedMessages.some(
    (message) =>
      message.direction === "inbound" &&
      ["queued", "processing", "sending"].includes(
        message.autoReplyStatus ?? "",
      ),
  );

  const sendReply = () => {
    if (
      !selectedRemoteJid ||
      !canReply ||
      !draft.trim() ||
      reply.isPending ||
      hasUnknownSend ||
      hasPendingAutoReply
    ) return;
    const clientRequestId = requestId ?? makeRequestId();
    setRequestId(clientRequestId);
    reply.mutate({
      remoteJid: selectedRemoteJid,
      text: draft.trim(),
      clientRequestId,
    });
  };

  if (!selectedRemoteJid) {
    return (
      <Redirect
        href={{ pathname: "/(tabs)/inbox", params: { platform: "whatsapp" } }}
      />
    );
  }

  return (
    <Page scroll={false} bottomPadding={84}>
      <View style={[styles.chatHeader, { borderColor: colors.border }]}>
        <View style={styles.conversationHeading}>
          <IconButton
            icon="chevron-right"
            label="العودة إلى قائمة المحادثات"
            color={colors.primary}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace({
                pathname: "/(tabs)/inbox",
                params: { platform: "whatsapp" },
              });
            }}
          />
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Icon name="whatsapp" size={18} color={colors.primary} />
          </View>
          <View style={styles.conversationCopy}>
            <Text style={{ color: colors.foreground, fontWeight: "800" }}>
              {selectedConversation?.customerNumber ?? directConversationLabel(selectedRemoteJid)}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12 }}>
              تنتهي صلاحية الرسائل بعد 90 يومًا.
            </Text>
          </View>
          <IconButton
            icon="settings"
            label="إعدادات الرد الآلي"
            color={colors.primary}
            onPress={() =>
              router.push({
                pathname: "/inbox/reply-settings",
                params: { channel: "whatsapp" },
              })
            }
          />
        </View>
      </View>
      <ScrollView
        style={styles.chatScroll}
        contentContainerStyle={styles.chatMessages}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={messages.isRefetching}
            onRefresh={() => void messages.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {messages.isError ? (
          <View style={styles.loadError}>
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
              {messages.error instanceof Error
                ? messages.error.message
                : "تعذر تحميل المحادثة."}
            </Text>
            <ActionButton
              label={messages.isFetching ? "جارٍ التحقق..." : "إعادة المحاولة"}
              icon={messages.isFetching ? "clock" : "refresh-cw"}
              secondary
              compact
              disabled={messages.isFetching}
              onPress={() => void messages.refetch()}
            />
          </View>
        ) : null}
        {messages.isPending && orderedMessages.length === 0 ? (
          <View
            accessible
            accessibilityLabel="جارٍ تحميل رسائل المحادثة"
            style={styles.messageList}
          >
            {[0, 1, 2].map((index) => (
              <Panel
                key={`message-skeleton-${index}`}
                style={[
                  styles.messageBubble,
                  {
                    alignSelf: index % 2 === 0 ? "flex-end" : "flex-start",
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.messageHeader}>
                  <Skeleton width={64} height={9} radius={5} />
                  <Skeleton width={88} height={9} radius={5} />
                </View>
                <Skeleton width="100%" height={10} radius={5} />
                <Skeleton width="64%" height={10} radius={5} />
              </Panel>
            ))}
          </View>
        ) : orderedMessages.length > 0 ? (
          <View style={styles.messageList}>
            {messages.hasNextPage ? (
              <ActionButton
                label={
                  messages.isFetchingNextPage
                    ? "جارٍ تحميل الرسائل الأقدم..."
                    : "تحميل رسائل أقدم"
                }
                icon={messages.isFetchingNextPage ? "clock" : "chevron-up"}
                secondary
                compact
                disabled={messages.isFetchingNextPage}
                onPress={() => void messages.fetchNextPage()}
              />
            ) : null}
            {orderedMessages.map((message) => (
              <DirectMessageBubble
                key={message.id}
                message={message}
                onConfirmNotSent={() => confirmNotSent.mutate(message.id)}
                confirming={
                  confirmNotSent.isPending &&
                  confirmNotSent.variables === message.id
                }
              />
            ))}
          </View>
        ) : messages.isError ? null : (
          <EmptyState
            icon="whatsapp"
            title="لا توجد رسائل محفوظة"
            body="ستظهر هنا الرسائل الواردة بعد وصولها إلى الحساب المرتبط."
          />
        )}
      </ScrollView>
      <View style={[styles.chatDock, { borderTopColor: colors.border }]}>
        {reply.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {reply.error instanceof Error ? reply.error.message : "تعذر إرسال الرد."}
          </Text>
        ) : null}
        {confirmNotSent.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {confirmNotSent.error instanceof Error
              ? confirmNotSent.error.message
              : "تعذر تحديث حالة الإرسال."}
          </Text>
        ) : null}
        {hasUnknownSend ? (
          <Text accessibilityRole="alert" style={{ color: colors.warning }}>
            تحقق من WhatsApp قبل إرسال رد جديد؛ توجد محاولة لم تتأكد نتيجتها.
          </Text>
        ) : null}
        {hasPendingAutoReply ? (
          <Text style={{ color: colors.mutedForeground, textAlign: "right" }}>
            جارٍ تجهيز الرد الآلي أو إرساله؛ انتظر تحديث الحالة قبل الرد اليدوي.
          </Text>
        ) : null}
        {canReply ? (
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="اكتب ردًا خاصًا على WhatsApp"
              value={draft}
              onChangeText={(text) => {
                setDraft(text.slice(0, 2000));
                setRequestId(null);
              }}
              editable={!hasUnknownSend && !hasPendingAutoReply && !reply.isPending}
              maxLength={2000}
              multiline
              textAlign="right"
              placeholder="اكتب ردًا خاصًا..."
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إرسال رد WhatsApp"
              disabled={
                !draft.trim() ||
                reply.isPending ||
                hasUnknownSend ||
                hasPendingAutoReply
              }
              onPress={sendReply}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    !draft.trim() || reply.isPending || hasUnknownSend || hasPendingAutoReply
                      ? 0.45
                      : pressed
                        ? 0.78
                        : 1,
                },
              ]}
            >
              <Icon name="send" size={17} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : (
          <Text accessibilityRole="alert" style={{ color: colors.warning, textAlign: "right" }}>
            وصلت هذه المحادثة بمعرّف LID دون رقم هاتف بديل؛ يمكن عرض الرسائل، لكن لا يمكن إرسال رد آمن.
          </Text>
        )}
      </View>
    </Page>
  );
}

function DirectMessageBubble({
  message,
  onConfirmNotSent,
  confirming,
}: {
  message: WhatsAppDirectMessage;
  onConfirmNotSent: () => void;
  confirming: boolean;
}) {
  const colors = useColors();
  const isBusiness = message.direction === "outbound";
  const isUnknown =
    message.status === "unknown" || message.autoReplyStatus === "unknown";
  const failureMessage = sendFailureMessage(message);
  const suppressedMessage = suppressedAutoReplyMessage(message);
  const messageTypeLabel = whatsappDirectMessagePlaceholder(message.messageType);
  return (
    <Panel
      accessibilityLabel={isBusiness ? "رد مُرسل من النشاط" : "رسالة واردة من العميل"}
      style={[
        styles.messageBubble,
        {
          alignSelf: isBusiness ? "flex-start" : "flex-end",
          backgroundColor: isBusiness ? colors.accent : colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.messageHeader}>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          {formatArabicDate(message.occurredAt, { dateStyle: "short" }) ?? ""}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          {formatArabicDate(message.occurredAt, { timeStyle: "short" }) ?? ""}
        </Text>
      </View>
      <Text selectable style={{ color: colors.foreground, textAlign: "right", lineHeight: 22 }}>
        {message.text || messageTypeLabel}
      </Text>
      {message.text && message.messageType !== "text" ? (
        <Text style={{ color: colors.mutedForeground, textAlign: "right", fontSize: 12 }}>
          {messageTypeLabel}
        </Text>
      ) : null}
      {isUnknown ? (
        <View style={styles.unknownBlock}>
          <Text accessibilityRole="alert" style={{ color: colors.warning, textAlign: "right" }}>
            نتيجة الإرسال غير مؤكدة. تحقق من المحادثة قبل محاولة أخرى.
          </Text>
          <ActionButton
            label={confirming ? "جارٍ التحديث..." : "تحققت، لم يصل الرد"}
            icon="check"
            disabled={confirming}
            onPress={onConfirmNotSent}
          />
        </View>
      ) : null}
      {message.direction === "inbound" &&
      ["queued", "processing", "sending"].includes(
        message.autoReplyStatus ?? "",
      ) ? (
        <Text style={{ color: colors.mutedForeground, textAlign: "right" }}>
          {message.autoReplyStatus === "sending"
            ? "جارٍ إرسال الرد الآلي..."
            : "جارٍ إعداد الرد الآلي..."}
        </Text>
      ) : null}
      {suppressedMessage ? (
        <Text style={{ color: colors.mutedForeground, textAlign: "right" }}>
          {suppressedMessage}
        </Text>
      ) : null}
      {failureMessage ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive, textAlign: "right" }}>
          {failureMessage}
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loadError: { gap: 9 },
  chatHeader: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  chatScroll: { flex: 1 },
  chatMessages: { gap: 10, paddingVertical: 10 },
  chatDock: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },

  conversationHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  conversationCopy: { flex: 1, gap: 4 },
  messageList: { gap: 10 },
  messageBubble: { maxWidth: "80%", gap: 6, borderWidth: 1, borderRadius: 12, padding: 10 },
  messageHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  unknownBlock: { gap: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    writingDirection: "rtl",
  },
  sendButton: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});