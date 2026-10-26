import { canShareWhatsAppMediaGroup } from "./whatsapp-album-relations.ts";

export type WhatsAppSuggestionMessage = {
  id: string;
  remoteMessageId: string;
  senderId: string | null;
  textBody: string | null;
  caption: string | null;
  mediaAvailable: boolean;
  mediaGroupId: string | null;
  mediaGroupSource: string | null;
  messageTimestamp: string | null;
  createdAt: string;
  replyToRemoteId: string | null;
  mediaCount: number;
};

export type WhatsAppAssociationSuggestion = {
  sourceMessageId: string;
  candidateMessageId: string;
  candidateGroupKey: string;
  candidateMediaGroupId: string | null;
  candidateText: string | null;
  candidateMediaCount: number;
  reason: string;
};

export function findWhatsAppAssociationSuggestions(
  messages: WhatsAppSuggestionMessage[],
  windowMs = 30_000,
): Map<string, WhatsAppAssociationSuggestion[]> {
  const suggestionsByMessage = new Map<string, WhatsAppAssociationSuggestion[]>();
  for (const textMessage of messages) {
    if (
      textMessage.mediaAvailable ||
      !textMessage.senderId ||
      !textMessage.textBody?.trim()
    ) {
      continue;
    }

    const textTime = new Date(
      textMessage.messageTimestamp ?? textMessage.createdAt,
    ).getTime();
    if (!Number.isFinite(textTime)) continue;

    const candidates = new Map<string, WhatsAppSuggestionMessage>();
    for (const candidate of messages) {
      if (
        !candidate.mediaAvailable ||
        candidate.senderId !== textMessage.senderId ||
        canShareWhatsAppMediaGroup({
          mediaGroupId: textMessage.mediaGroupId,
          source: textMessage.mediaGroupSource,
          candidateMediaGroupId: candidate.mediaGroupId,
          candidateSource: candidate.mediaGroupSource,
        })
      ) {
        continue;
      }

      const candidateTime = new Date(
        candidate.messageTimestamp ?? candidate.createdAt,
      ).getTime();
      if (
        !Number.isFinite(candidateTime) ||
        Math.abs(candidateTime - textTime) > windowMs
      ) {
        continue;
      }

      const groupKey = isConfirmedCandidateAlbum(candidate)
        ? `album:${candidate.mediaGroupId}`
        : `message:${candidate.id}`;
      candidates.set(groupKey, candidate);
    }

    if (candidates.size === 0) continue;
    suggestionsByMessage.set(
      textMessage.id,
      [...candidates.entries()].map(([candidateGroupKey, candidate]) => ({
        sourceMessageId: textMessage.id,
        candidateMessageId: candidate.id,
        candidateGroupKey,
        candidateMediaGroupId: isConfirmedCandidateAlbum(candidate)
          ? candidate.mediaGroupId
          : null,
        candidateText: candidate.textBody || candidate.caption,
        candidateMediaCount: isConfirmedCandidateAlbum(candidate)
          ? messages
              .filter((item) =>
                item.mediaGroupId === candidate.mediaGroupId &&
                item.mediaGroupSource === candidate.mediaGroupSource,
              )
              .reduce((total, item) => total + item.mediaCount, 0)
          : candidate.mediaCount,
        reason:
          candidate.replyToRemoteId === textMessage.remoteMessageId
            ? "WHATSAPP_REPLY_REFERENCE_REQUIRES_REVIEW"
            : "SAME_GROUP_SENDER_AND_TIME_ONLY_REQUIRES_REVIEW",
      })),
    );
  }
  return suggestionsByMessage;
}

function isConfirmedCandidateAlbum(message: WhatsAppSuggestionMessage): boolean {
  return Boolean(
    message.mediaGroupId &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container"),
  );
}
