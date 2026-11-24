import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { StatusPill } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import {
  formatArabicDateTime,
  formatArabicNumber,
} from "@/lib/formatting";
import { mediaUrlForApp } from "@/lib/content-utils";
import { describeMediaDownloadFailure } from "@/lib/whatsapp-media-failure-copy";
import {
  canConvertWhatsAppMessageGroup,
  type DisplayedWhatsAppMessageGroup,
} from "@/lib/source-message-groups";

type Props = {
  group: DisplayedWhatsAppMessageGroup;
  convertingMessageIds: Record<string, boolean>;
  onPreview: (url: string) => void;
  onAddToProductReview: (messageId: string) => void;
  associationDecisionPending: string | null;
  onAssociationDecision: (
    sourceMessageId: string,
    candidateMessageId: string,
    decision: "accepted" | "rejected",
  ) => void;
};

export function WhatsAppMessageGroupCard({
  group,
  convertingMessageIds,
  onPreview,
  onAddToProductReview,
  associationDecisionPending,
  onAssociationDecision,
}: Props) {
  const colors = useColors();
  const sourceMessage = group.messages.find((message) =>
    Boolean(message.textBody?.trim() || message.caption?.trim()),
  ) ?? group.messages[0];
  const converting = Boolean(sourceMessage && convertingMessageIds[sourceMessage.id]);
  const canConvert = canConvertWhatsAppMessageGroup(group);
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.groupStatus}>
          {group.mediaFailed ? (
            <StatusPill label="فشل تحميل وسيط" tone="amber" />
          ) : group.mediaExpired ? (
            <StatusPill label="وسائط منتهية مستبعدة" tone="amber" />
          ) : group.mediaPending ? (
            <StatusPill label="جارٍ تحميل الوسائط" tone="amber" />
          ) : group.postId ? (
            <StatusPill label="تم التحويل إلى محتوى" tone="green" />
          ) : group.contentBundleId ? (
            <StatusPill label="ارتباط أكّده المستخدم" tone="blue" />
          ) : group.mediaGroupId ? (
            <StatusPill label="ألبوم واتساب مؤكد" tone="blue" />
          ) : (
            <StatusPill label="رسالة منفردة" tone="muted" />
          )}
        </View>
        <View style={styles.senderWrap}>
          <Text style={[styles.sender, { color: colors.foreground }]}>{group.senderName}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {group.messages.length} رسالة · {group.media.length} وسيط
            {group.expectedCount > group.media.length ? ` من ${group.expectedCount}` : ""}
          </Text>
        </View>
      </View>
      {group.text ? (
        <Text style={[styles.body, { color: colors.foreground }]}>{group.text}</Text>
      ) : (
        <Text style={[styles.body, { color: colors.mutedForeground }]}>لا يوجد نص</Text>
      )}
      {group.associationSuggestions.length > 0 ? (
        <View style={styles.suggestionList}>
          <Text style={[styles.meta, { color: colors.primary }]}>
            اقتراحات ارتباط تحتاج مراجعة:
          </Text>
          {group.associationSuggestions.map((suggestion) => (
            <View
              key={`${suggestion.sourceMessageId}:${suggestion.candidateGroupKey}`}
              style={styles.suggestion}
            >
              {suggestion.candidateMedia.length > 0 ? (
                <View
                  accessibilityLabel={`وسائط مقترحة، ${suggestion.candidateMediaCount} عنصر`}
                  style={styles.candidateMediaList}
                >
                  {suggestion.candidateMedia.map(({ item, message }) =>
                    item.downloadStatus === "stored" &&
                    item.mediaType === "image" &&
                    item.url ? (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel="معاينة صورة الوسائط المقترحة"
                        onPress={() => item.url && onPreview(item.url)}
                      >
                        <Image
                          source={{ uri: mediaUrlForApp(item.thumbnailUrl || item.url) }}
                          style={styles.mediaThumbnail}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ) : (
                      <View
                        key={item.id}
                        style={[
                          styles.mediaPlaceholder,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <Text style={[styles.mediaType, { color: colors.primary }]}>
                          {item.downloadStatus !== "stored"
                            ? describeMediaDownloadFailure({
                                downloadStatus: item.downloadStatus,
                                failureReason: item.failureReason,
                                messageTimestamp: message.messageTimestamp,
                              })
                            : item.mediaType === "video"
                              ? "فيديو"
                              : item.mediaType === "document"
                                ? "مستند"
                                : item.mediaType}
                        </Text>
                      </View>
                    ),
                  )}
                </View>
              ) : (
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {suggestion.candidateText || "وسائط مرشحة"} · {suggestion.candidateMediaCount} وسيط
                </Text>
              )}
              <View style={styles.suggestionActions}>
                {(["accepted", "rejected"] as const).map((decision) => {
                  const actionKey = `${suggestion.sourceMessageId}:${suggestion.candidateMessageId}`;
                  const pending = associationDecisionPending === actionKey;
                  return (
                    <Pressable
                      key={decision}
                      accessibilityRole="button"
                      accessibilityLabel={
                        decision === "accepted"
                          ? "تأكيد أن الرسائل تخص المحتوى نفسه"
                          : "رفض اقتراح ربط الرسائل"
                      }
                      disabled={Boolean(associationDecisionPending)}
                      onPress={() => onAssociationDecision(
                        suggestion.sourceMessageId,
                        suggestion.candidateMessageId,
                        decision,
                      )}
                      style={[
                        styles.suggestionAction,
                        {
                          borderColor: colors.border,
                          opacity: associationDecisionPending ? 0.5 : 1,
                        },
                      ]}
                    >
                      {pending ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={[styles.meta, { color: colors.primary }]}>
                          {decision === "accepted" ? "تأكيد الربط" : "رفض"}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {group.media.length ? (
        <View style={styles.mediaList}>
          {group.media.map(({ item, message }) => item.downloadStatus === "stored" &&
          item.mediaType === "image" && item.url ? (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel="معاينة صورة واتساب"
              onPress={() => item.url && onPreview(item.url)}
            >
              <Image
                source={{ uri: mediaUrlForApp(item.thumbnailUrl || item.url || "") }}
                style={styles.mediaThumbnail}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <View key={item.id} style={[styles.mediaPlaceholder, { backgroundColor: colors.accent }]}>
              <Text style={[styles.mediaType, { color: colors.primary }]}>
                {item.downloadStatus !== "stored"
                  ? describeMediaDownloadFailure({
                      downloadStatus: item.downloadStatus,
                      failureReason: item.failureReason,
                      messageTimestamp: message.messageTimestamp,
                    })
                  : item.accessError
                    ? "الرابط غير متاح"
                    : item.mediaType === "video"
                      ? "فيديو"
                      : item.mediaType === "document"
                        ? "مستند"
                        : item.mediaType}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {group.mediaFailed ? (
        <Text style={[styles.meta, { color: colors.destructive }]}>
          لم يكتمل تحميل جميع الوسائط؛ لن تُعامل المجموعة كمنشور مكتمل.
        </Text>
      ) : group.mediaExpired ? (
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {group.media.length > group.expiredMediaCount
            ? `استُبعدت ${formatArabicNumber(group.expiredMediaCount)} وسائط انتهت صلاحيتها لدى واتساب؛ سيُبنى المنشور من النص والوسائط المتاحة.`
            : "كل وسائط هذه الرسالة انتهت صلاحيتها لدى واتساب؛ أعد إرسالها لإنشاء منشور منها."}
        </Text>
      ) : null}
      {group.postId ? (
        <Text style={[styles.meta, { color: colors.primary }]}>
          حالة المحتوى الناتج: {group.postStatus ?? "قيد المراجعة"}
        </Text>
      ) : null}
      {(
        group.media.length > 0 ||
        group.messages.some((message) => message.mediaAvailable) ||
        group.mediaFailed ||
        group.mediaExpired ||
        group.contentBundleId
      ) &&
      canConvert ? (
        <Pressable
          accessibilityRole="button"
          disabled={converting}
          onPress={() => sourceMessage && onAddToProductReview(sourceMessage.id)}
          style={[
            styles.convertAction,
            {
              borderColor: converting ? colors.border : colors.primary,
              backgroundColor: converting ? colors.disabled : "transparent",
            },
          ]}
        >
          {converting ? (
            <ActivityIndicator size="small" color={colors.disabledForeground} />
          ) : (
            <Icon name="file-plus" size={14} color={colors.primary} />
          )}
          <Text
            style={[
              styles.convertActionLabel,
              { color: converting ? colors.disabledForeground : colors.primary },
            ]}
          >
            إضافة إلى مراجعة المنتجات
          </Text>
        </Pressable>
      ) : null}
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {formatArabicDateTime(group.messageTimestamp) ?? "غير محدد"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  senderWrap: { flex: 1, alignItems: "flex-start", gap: 3 },
  groupStatus: { flexShrink: 0 },
  sender: { fontSize: 13.5, fontWeight: "800", textAlign: "right", flexShrink: 1 },
  body: { fontSize: 14, lineHeight: 22, textAlign: "right" },
  suggestionList: { alignItems: "flex-start", gap: 8 },
  suggestion: { alignItems: "flex-start", gap: 5 },
  candidateMediaList: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  suggestionActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  suggestionAction: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: { fontSize: 12.5, textAlign: "right" },
  mediaList: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  mediaThumbnail: { width: 76, height: 76, borderRadius: 8 },
  mediaPlaceholder: { width: 76, height: 76, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  mediaType: { fontSize: 12.5, fontWeight: "700" },
  convertAction: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  convertActionLabel: { fontSize: 13.5, fontWeight: "800" },
});
