import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { Panel } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import type { MetaInboxItem } from "@/lib/meta-inbox-api";
import { MetaInboxMedia } from "./MetaInboxMedia";

const platformNames = {
  facebook: "فيسبوك",
  instagram: "إنستغرام",
} as const;

const kindNames = {
  message: "رسالة خاصة",
  comment: "تعليق",
} as const;

export function MetaInboxItemCard({
  item,
  replyText,
  onChangeReply,
  onReply,
  sending,
}: {
  item: MetaInboxItem;
  replyText: string;
  onChangeReply: (text: string) => void;
  onReply: () => void;
  sending: boolean;
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
        <View style={styles.labels}>
          <Text style={[styles.actor, { color: colors.foreground }]}>
            {item.actorName || platformNames[item.platform]}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {platformNames[item.platform]} · {kindNames[item.kind]} ·{" "}
            {new Date(item.occurredAt).toLocaleString("ar")}
          </Text>
        </View>
        <Icon
          name={item.kind === "comment" ? "message-square" : "message-circle"}
          size={20}
          color={
            item.platform === "instagram" ? colors.instagram : colors.facebook
          }
        />
      </View>
      {media.length > 0 ? <MetaInboxMedia media={media} /> : null}
      {messageText &&
      !(media.length > 0 && messageText === "رسالة تحتوي على مرفق") ? (
        <Text selectable style={[styles.message, { color: colors.foreground }]}>
          {messageText}
        </Text>
      ) : null}
      {!item.replyText &&
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
              textAlign: "right",
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
        <View style={[styles.sentReply, { backgroundColor: colors.accent }]}>
          <Text style={[styles.sentLabel, { color: colors.primary }]}>
            رد MenaFlow
          </Text>
          <Text style={{ color: colors.foreground }}>{item.replyText}</Text>
        </View>
      ) : (
        <View style={styles.replyRow}>
          <TextInput
            accessibilityLabel="اكتب ردك"
            value={replyText}
            onChangeText={onChangeReply}
            placeholder="اكتب ردًا..."
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
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  labels: { flex: 1, gap: 3 },
  actor: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  meta: { fontSize: 12, textAlign: "right" },
  message: { fontSize: 15, lineHeight: 24, textAlign: "right" },
  replyRow: { flexDirection: "row-reverse", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sentReply: { gap: 5, borderRadius: 12, padding: 12 },
  sentLabel: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  autoReplyStatus: { borderWidth: 1, borderRadius: 10, padding: 10 },
});
