import { useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isLocalAuthDisabled } from "@/constants/auth";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, BrandHeader, EmptyState, Page, PageTitle, Panel } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { formatArabicDateTime } from "@/lib/formatting";
import { InboxPlatformTabs } from "@/components/inbox/InboxPlatformTabs";
import {
  confirmWhatsAppDirectReplyNotSent,
  getWhatsAppDirectConversations,
  getWhatsAppDirectMessages,
  sendWhatsAppDirectReply,
  type WhatsAppDirectMessage,
} from "@/lib/whatsapp-direct-inbox-api";

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
    if (initialRemoteJid) {
      setSelectedRemoteJid(initialRemoteJid);
      setDraft("");
      setRequestId(null);
    }
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
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => getWhatsAppDirectMessages(selectedRemoteJid!),
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
  const orderedMessages = messages.data?.messages ?? [];
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

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={conversations.isRefetching || messages.isRefetching}
          onRefresh={() => {
            void conversations.refetch();
            if (selectedRemoteJid) void messages.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <InboxPlatformTabs
        activePlatform="whatsapp"
        onSelect={(platform) => {
          if (platform === "whatsapp") return;
          router.replace({
            pathname: "/(tabs)/inbox",
            params: { platform },
          });
        }}
      />
      <PageTitle
        title="رسائل WhatsApp الخاصة"
        subtitle="تابع المحادثات الفردية ورد يدويًا عند الحاجة."
        back={{ href: "/(tabs)/inbox", label: "العودة إلى المحادثات" }}
      />
      <ActionButton
        label="إعدادات الرد الآلي"
        icon="settings"
        secondary
        onPress={() => router.push("/inbox/reply-settings")}
      />

      {selectedRemoteJid ? (
        <>
          <ActionButton
            label="قائمة المحادثات"
            icon="chevron-right"
            secondary
            onPress={() => {
              setSelectedRemoteJid(null);
              router.setParams({ remoteJid: undefined });
              setDraft("");
              setRequestId(null);
            }}
          />
          <Panel style={styles.conversationPanel}>
            <View style={styles.conversationHeading}>
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Icon name="message-circle" size={18} color={colors.primary} />
              </View>
              <View style={styles.conversationCopy}>
                <Text style={{ color: colors.foreground, fontWeight: "800" }}>
                  {selectedConversation?.customerNumber ?? selectedRemoteJid.replace(/@s\.whatsapp\.net$/, "")}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  تنتهي صلاحية الرسائل بعد 90 يومًا.
                </Text>
              </View>
            </View>
          </Panel>
          {messages.isError ? (
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
              {messages.error instanceof Error
                ? messages.error.message
                : "تعذر تحميل المحادثة."}
            </Text>
          ) : null}
          <View style={styles.messageList}>
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
            {orderedMessages.length === 0 && !messages.isPending ? (
              <EmptyState
                icon="message-circle"
                title="لا توجد رسائل محفوظة"
                body="ستظهر هنا الرسائل الواردة بعد وصولها إلى الحساب المرتبط."
              />
            ) : null}
          </View>
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
        </>
      ) : (
        <Panel style={styles.inboxPanel}>
          <Text style={{ color: colors.foreground, fontWeight: "800", fontSize: 15 }}>
            المحادثات الفردية
          </Text>
          {conversations.isError ? (
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
              {conversations.error instanceof Error
                ? conversations.error.message
                : "تعذر تحميل المحادثات."}
            </Text>
          ) : null}
          {conversations.isPending ? (
            <Text style={{ color: colors.mutedForeground }}>جارٍ تحميل المحادثات...</Text>
          ) : conversations.data?.conversations.length ? (
            conversations.data.conversations.map((conversation) => (
              <Pressable
                key={conversation.remoteJid}
                accessibilityRole="button"
                accessibilityLabel={`فتح محادثة ${conversation.customerNumber}`}
                onPress={() => setSelectedRemoteJid(conversation.remoteJid)}
                style={({ pressed }) => [
                  styles.conversationRow,
                  { borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <View style={styles.conversationCopy}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                    {conversation.customerNumber}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "right" }}
                  >
                    {conversation.preview || "رسالة بدون نص"}
                  </Text>
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {formatArabicDateTime(conversation.lastMessageAt) ?? ""}
                </Text>
              </Pressable>
            ))
          ) : (
            <EmptyState
              icon="message-circle"
              title="لا توجد محادثات فردية بعد"
              body="ستظهر المحادثات عند وصول رسائل مباشرة إلى حساب WhatsApp المرتبط."
            />
          )}
        </Panel>
      )}
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
  return (
    <Panel
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
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {isBusiness ? "رد النشاط" : "رسالة العميل"}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {formatArabicDateTime(message.occurredAt) ?? ""}
        </Text>
      </View>
      <Text selectable style={{ color: colors.foreground, textAlign: "right", lineHeight: 22 }}>
        {message.text || "رسالة بدون نص"}
      </Text>
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
      {message.status === "failed" || message.autoReplyStatus === "failed" ? (
        <Text style={{ color: colors.destructive, textAlign: "right" }}>
          لم يتم إرسال الرد الآلي أو اليدوي.
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  inboxPanel: { gap: 12 },
  conversationPanel: { gap: 10 },
  conversationHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  conversationCopy: { flex: 1, gap: 4 },
  conversationRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  messageList: { gap: 10 },
  messageBubble: { width: "94%", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
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