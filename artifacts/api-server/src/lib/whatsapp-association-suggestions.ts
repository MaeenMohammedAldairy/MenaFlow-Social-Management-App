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
  sourceText: string | null;
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
        sourceText: textMessage.textBody,
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

/**
 * Suggestions safe to accept without a merchant decision.
 *
 * A text paired with exactly one media candidate — and that candidate paired
 * with no other text — is a single content bundle, not a choice between
 * independent products. Everything else stays in the review queue: the
 * 30-second window alone cannot tell two consecutive product posts apart.
 */
export function selectAutoAcceptableWhatsAppAssociations(
  suggestionsByMessage: Map<string, WhatsAppAssociationSuggestion[]>,
): WhatsAppAssociationSuggestion[] {
  const candidateCounts = new Map<string, number>();
  for (const suggestions of suggestionsByMessage.values()) {
    for (const suggestion of suggestions) {
      candidateCounts.set(
        suggestion.candidateMessageId,
        (candidateCounts.get(suggestion.candidateMessageId) ?? 0) + 1,
      );
    }
  }
  const seenPairs = new Set<string>();
  return [...suggestionsByMessage.values()]
    .flat()
    .filter((suggestion) => {
      if (
        (suggestionsByMessage.get(suggestion.sourceMessageId)?.length ?? 0) !== 1 ||
        suggestion.candidateMediaCount === 0 ||
        candidateCounts.get(suggestion.candidateMessageId) !== 1
      ) return false;
      // A greeting next to a captioned product post is not its description.
      // Merging it would put the greeting into the post body, so leave it for
      // review even though the pairing itself is unambiguous.
      if (
        isGreetingLike(suggestion.sourceText) &&
        Boolean(suggestion.candidateText?.trim())
      ) return false;
      const pairKey = `${suggestion.sourceMessageId}:${suggestion.candidateMessageId}`;
      if (seenPairs.has(pairKey)) return false;
      seenPairs.add(pairKey);
      return true;
    });
}

function isGreetingLike(text: string | null): boolean {
  const value = text?.trim() ?? "";
  return value.length > 0 && value.length < 16 && !/\d/.test(value);
}

function isConfirmedCandidateAlbum(message: WhatsAppSuggestionMessage): boolean {
  return Boolean(
    message.mediaGroupId &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container"),
  );
}
