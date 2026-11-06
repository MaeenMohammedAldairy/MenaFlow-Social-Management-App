import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { Panel } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { formatArabicDateTime } from "@/lib/formatting";
import type { MetaInboxItem } from "@/lib/meta-inbox-api";
import { MetaInboxMedia } from "./MetaInboxMedia";

const kindNames = {
  message: "رسالة خاصة",
  comment: "تعليق",
} as const;

export function MetaInboxItemCard({
  item,
  replyText,
  onChangeReply,
  onReply,
  onConfirmUnknown,
  sending,
  confirmingUnknown,
}: {
  item: MetaInboxItem;
  replyText: string;
  onChangeReply: (text: string) => void;
  onReply: () => void;
  onConfirmUnknown: () => void;
  sending: boolean;
  confirmingUnknown: boolean;
}) {
  const colors = useColors();
  const media = item.media ?? [];
  const messageText =
    item.text ||
    (item.kind === "message" && media.length === 0
      ? "رسالة تحتوي على مرفق"
      : "");
  return (
    <Panel style={styles.card}>
      <View style={styles.header}>
        <Icon
          name={item.kind === "comment" ? "message-square" : "message-circle"}
          size={17}
          color={
            item.platform === "instagram" ? colors.instagram : colors.facebook
          }
        />
        <View style={styles.labels}>
          <Text style={[styles.actor, { color: colors.foreground }]}>
            {item.kind === "comment" ? "تعليق وارد" : "رسالة واردة"}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {kindNames[item.kind]} ·{" "}
            {formatArabicDateTime(item.occurredAt) ?? "غير محدد"}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.incomingBubble,
          { backgroundColor: colors.secondary },
        ]}
      >
        {messageText &&
        !(media.length > 0 && messageText === "رسالة تحتوي على مرفق") ? (
          <Text
            selectable
            style={[styles.message, { color: colors.foreground }]}
          >
            {messageText}
          </Text>
        ) : null}
        {media.length > 0 ? <MetaInboxMedia media={media} /> : null}
      </View>
      {!item.replyText &&
      !item.replyStatus &&
      ["queued", "processing", "sending", "failed", "unknown"].includes(
        item.autoReplyStatus ?? "",
      ) ? (
        <View
          style={[
            styles.autoReplyStatus,
            {
              backgroundColor: colors.accent,
              borderColor:
                item.autoReplyStatus === "failed" ||
                item.autoReplyStatus === "unknown"
                  ? colors.warning
                  : colors.border,
            },
          ]}
        >
          <Text
            style={{
              color:
                item.autoReplyStatus === "failed" ||
                item.autoReplyStatus === "unknown"
                  ? colors.warning
                  : colors.mutedForeground,
              textAlign: "left",
            }}
          >
            {item.autoReplyStatus === "queued" ||
            item.autoReplyStatus === "processing"
              ? "جارٍ إعداد الرد الآلي..."
              : item.autoReplyStatus === "sending"
                ? "جارٍ إرسال الرد الآلي..."
                : item.autoReplyStatus === "unknown"
                  ? "نتيجة الإرسال غير مؤكدة. تحقق من المحادثة قبل الرد لتجنب التكرار."
                  : "تعذر إرسال الرد الآلي. يمكنك المتابعة بالرد يدويًا."}
          </Text>
        </View>
      ) : null}

      {item.replyText ? (
        <View
          style={[
            styles.sentReply,
            {
              backgroundColor: colors.accent,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.replyHeading}>
            <Icon name="send" size={13} color={colors.primary} />
            <Text style={[styles.sentLabel, { color: colors.primary }]}>
              الرد المرسل
            </Text>
            {item.repliedAt ? (
              <Text style={[styles.replyDate, { color: colors.mutedForeground }]}>
                {formatArabicDateTime(item.repliedAt)}
              </Text>
            ) : null}
          </View>
          <Text style={{ color: colors.foreground }}>{item.replyText}</Text>
        </View>
      ) : item.replyStatus ? (
        <View
          style={[
            styles.autoReplyStatus,
            {
              backgroundColor: colors.accent,
              borderColor:
                item.replyStatus === "unknown" ? colors.warning : colors.border,
            },
          ]}
        >
          <Text
            style={{
              color:
                item.replyStatus === "unknown"
                  ? colors.warning
                  : colors.mutedForeground,
              textAlign: "left",
            }}
          >
            {item.replyStatus === "unknown"
              ? "نتيجة إرسال الرد غير مؤكدة. تحقق من محادثة Meta؛ لا تعِد الإرسال إن كان الرد قد وصل."
              : "جارٍ إرسال الرد..."}
          </Text>
          {item.replyStatus === "unknown" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تأكيد عدم ظهور الرد وإتاحة إعادة المحاولة"
              disabled={confirmingUnknown}
              onPress={onConfirmUnknown}
              style={[
                styles.confirmRetryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: confirmingUnknown ? 0.55 : 1,
                },
              ]}
            >
              <Text
                style={{ color: colors.primaryForeground, textAlign: "center" }}
              >
                {confirmingUnknown
                  ? "جارٍ التحقق..."
                  : "تحققت، لم يصل الرد — إتاحة إعادة الإرسال"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {item.kind === "comment" ? (
            <Text style={[styles.publicReplyHint, { color: colors.warning }]}>
              هذا الرد علني وسيظهر أسفل التعليق.
            </Text>
          ) : null}
          <View style={styles.replyRow}>
            <TextInput
              accessibilityLabel={
                item.kind === "comment"
                  ? "اكتب ردًا علنيًا على التعليق"
                  : "اكتب ردًا خاصًا على الرسالة"
              }
              value={replyText}
              onChangeText={onChangeReply}
              placeholder={
                item.kind === "comment"
                  ? "اكتب ردًا علنيًا..."
                  : "اكتب ردًا خاصًا..."
              }
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={2000}
              textAlign="right"
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
              accessibilityLabel="إرسال الرد"
              disabled={sending || !replyText.trim()}
              onPress={onReply}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    sending || !replyText.trim() ? 0.45 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Icon name="send" size={17} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 12, borderRadius: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  labels: { flex: 1, gap: 3 },
  actor: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  meta: { fontSize: 10, textAlign: "right" },
  incomingBubble: {
    alignSelf: "flex-end",
    width: "100%",
    gap: 8,
    borderRadius: 14,
    borderTopRightRadius: 4,
    padding: 11,
  },
  message: { fontSize: 14, lineHeight: 23, textAlign: "right" },
  replyRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sentReply: {
    alignSelf: "flex-start",
    width: "94%",
    gap: 7,
    borderWidth: 1,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    padding: 11,
  },
  replyHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  replyDate: { marginLeft: "auto", fontSize: 10 },
  publicReplyHint: { fontSize: 12, textAlign: "left" },
  confirmRetryButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sentLabel: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  autoReplyStatus: { borderWidth: 1, borderRadius: 10, padding: 10 },
});
