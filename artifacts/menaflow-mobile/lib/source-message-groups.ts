import type {
  WhatsAppMessage,
  WhatsAppMessageMedia,
} from "@workspace/api-client-react";

export type DisplayedWhatsAppMessageGroup = {
  key: string;
  messages: WhatsAppMessage[];
  media: Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>;
  associationSuggestions: DisplayedWhatsAppAssociationSuggestion[];
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

export type DisplayedWhatsAppAssociationSuggestion =
  NonNullable<WhatsAppMessage["associationSuggestions"]>[number] & {
    candidateMedia: Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>;
  };

export function canConvertWhatsAppMessageGroup(
  group: Pick<
    DisplayedWhatsAppMessageGroup,
    "text" | "media" | "expectedCount" | "mediaPending" | "mediaFailed"
  >,
): boolean {
  return Boolean(
    group.text.trim() &&
      group.media.length > 0 &&
      group.media.every(({ item }) => item.downloadStatus === "stored") &&
      group.expectedCount <= group.media.length &&
      !group.mediaPending &&
      !group.mediaFailed,
  );
}

export function groupWhatsAppMessages(
  messages: WhatsAppMessage[],
): DisplayedWhatsAppMessageGroup[] {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const mediaByCandidateGroup = new Map<
    string,
    Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>
  >();
  for (const message of messages) {
    const confirmedAlbum =
      Boolean(message.mediaGroupId) &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container");
    const candidateGroupKey = confirmedAlbum
      ? `album:${message.mediaGroupId}`
      : `message:${message.id}`;
    const media = mediaByCandidateGroup.get(candidateGroupKey) ?? [];
    media.push(...message.media.map((item) => ({ message, item })));
    mediaByCandidateGroup.set(candidateGroupKey, media);
  }

  const suggestionsByTargetMessage = new Map<
    string,
    Map<string, NonNullable<WhatsAppMessage["associationSuggestions"]>[number]>
  >();
  for (const message of messages) {
    for (const suggestion of message.associationSuggestions ?? []) {
      if (suggestion.decision) continue;
      const targetMessageId = messagesById.has(suggestion.sourceMessageId)
        ? suggestion.sourceMessageId
        : messagesById.has(suggestion.candidateMessageId)
          ? suggestion.candidateMessageId
          : message.id;
      const targetSuggestions =
        suggestionsByTargetMessage.get(targetMessageId) ?? new Map();
      targetSuggestions.set(
        `${suggestion.sourceMessageId}:${suggestion.candidateGroupKey}`,
        suggestion,
      );
      suggestionsByTargetMessage.set(targetMessageId, targetSuggestions);
    }
  }
  const displayMessages = messages.map((message) => ({
    ...message,
    associationSuggestions: [
      ...(suggestionsByTargetMessage.get(message.id)?.values() ?? []),
    ],
  }));

  const contentBundleByAlbum = new Map<string, string>();
  for (const message of displayMessages) {
    if (
      message.contentBundleId &&
      message.mediaGroupId &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container")
    ) {
      contentBundleByAlbum.set(message.mediaGroupId, message.contentBundleId);
    }
  }

  const grouped = new Map<string, {
    key: string;
    messages: WhatsAppMessage[];
    media: Array<{ message: WhatsAppMessage; item: WhatsAppMessageMedia }>;
  }>();
  for (const message of displayMessages) {
    const confirmedAlbum =
      Boolean(message.mediaGroupId) &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container");
    const key = message.contentBundleId ??
      (confirmedAlbum
        ? contentBundleByAlbum.get(message.mediaGroupId!) ?? message.mediaGroupId!
        : message.id);
    const group = grouped.get(key) ?? { key, messages: [], media: [] };
    group.messages.push(message);
    group.media.push(...message.media.map((item) => ({ message, item })));
    group.media.push(
      ...(message.contentBundleMedia ?? []).map((item) => ({ message, item })),
    );
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
    group.media = [...new Map(
      group.media.map((entry, index) => [
        entry.item.id ? `media:${entry.item.id}` : `entry:${index}`,
        entry,
      ]),
    ).values()];
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
    const suggestions = new Map<
      string,
      NonNullable<WhatsAppMessage["associationSuggestions"]>[number]
    >();
    for (const message of group.messages) {
      for (const suggestion of message.associationSuggestions ?? []) {
        if (suggestion.decision) continue;
        suggestions.set(
          `${suggestion.sourceMessageId}:${suggestion.candidateGroupKey}`,
          suggestion,
        );
      }
    }

    return {
      ...group,
      associationSuggestions: [...suggestions.values()].map((suggestion) => ({
        ...suggestion,
        candidateMedia: mediaByCandidateGroup.get(suggestion.candidateGroupKey) ?? [],
      })),
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
