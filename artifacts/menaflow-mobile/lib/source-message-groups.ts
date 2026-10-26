import type {
  WhatsAppMessage,
  WhatsAppMessageMedia,
} from "@workspace/api-client-react";

export type DisplayedWhatsAppMessageGroup = {
  key: string;
  messages: WhatsAppMessage[];
  media: Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>;
  mediaGroupId: string | null;
  contentBundleId: string | null;
  text: string;
  expectedCount: number;
  mediaFailed: boolean;
  mediaPending: boolean;
  postId: string | null;
  postStatus: string | null;
  senderName: string;
  messageTimestamp: string | null;
};

export function groupWhatsAppMessages(
  messages: WhatsAppMessage[],
): DisplayedWhatsAppMessageGroup[] {
  const grouped = new Map<string, {
    key: string;
    messages: WhatsAppMessage[];
    media: Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>;
  }>();
  for (const message of messages) {
    const confirmedAlbum =
      Boolean(message.mediaGroupId) &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container");
    const key = message.contentBundleId ??
      (confirmedAlbum ? message.mediaGroupId! : message.id);
    const group = grouped.get(key) ?? { key, messages: [], media: [] };
    group.messages.push(message);
    group.media.push(...message.media.map((item) => ({ message, item })));
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => {
    group.media.sort((left, right) =>
      (left.message.mediaGroupIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.message.mediaGroupIndex ?? Number.MAX_SAFE_INTEGER) ||
      new Date(left.message.messageTimestamp ?? left.message.createdAt ?? 0).getTime() -
        new Date(right.message.messageTimestamp ?? right.message.createdAt ?? 0).getTime() ||
      (left.item.mediaIndex ?? 0) - (right.item.mediaIndex ?? 0),
    );
    const text = [...new Set(group.messages.flatMap((message) =>
      [message.textBody, message.caption]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    ))].join("\n");
    const expectedCount = Math.max(
      0,
      ...group.messages.map((message) =>
        message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container"
          ? message.mediaGroupExpectedCount ?? 0
          : 0,
      ),
    );
    const mediaFailed = group.messages.some((message) =>
      message.mediaDownloadStatus === "failed" ||
      message.media.some((item) => item.downloadStatus === "failed"),
    );
    const mediaPending = group.messages.some((message) =>
      message.mediaAvailable &&
      message.mediaDownloadStatus !== "failed" &&
      (message.mediaDownloadStatus === "pending" ||
        !message.media.some((item) => item.downloadStatus === "stored")),
    );
    const postId = group.messages.find((message) => message.linkedPostId)?.linkedPostId ?? null;
    const first = group.messages[0];

    return {
      ...group,
      mediaGroupId: group.messages.find((message) =>
        (message.mediaGroupSource === "protocol_association" ||
          message.mediaGroupSource === "provider_album_container") &&
        message.mediaGroupId,
      )?.mediaGroupId ?? null,
      contentBundleId:
        group.messages.find((message) => message.contentBundleId)?.contentBundleId ?? null,
      text,
      expectedCount,
      mediaFailed,
      mediaPending,
      postId,
      postStatus: group.messages.find((message) => message.linkedPostStatus)?.linkedPostStatus ?? null,
      senderName: first.senderName || first.senderId || "مستخدم واتساب",
      messageTimestamp: group.messages
        .map((message) => message.messageTimestamp)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
    };
  });
}
