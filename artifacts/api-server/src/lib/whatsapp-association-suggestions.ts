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
  /** Optional scope guards. A DM (`groupId: null`) is never a product source. */
  workspaceId?: string | null;
  instanceName?: string | null;
  groupId?: string | null;
  groupJid?: string | null;
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

/**
 * Multi-evidence bundling for group messages.
 *
 * The seven-day-old pair rule above only links a text to a *single* media item
 * within 30 seconds. A price, a colour reply, or a late image therefore became
 * its own extraction job and its own single-source suggestion. Here a product
 * "run" is built from original message timestamps: a distinctive product name
 * opens a run, continuation text and unambiguous media join it, and a new
 * distinctive name closes it. Time and sender are supporting evidence only —
 * they never open a run on their own.
 */
export const WHATSAPP_PRODUCT_BUNDLE_WINDOW_MS = 10 * 60_000;

export const WHATSAPP_BUNDLE_REASON = {
  reply: "WHATSAPP_REPLY_REFERENCE",
  album: "WHATSAPP_ALBUM_REFERENCE",
  productName: "WHATSAPP_PRODUCT_NAME_REFERENCE",
  continuation: "WHATSAPP_PRODUCT_CONTINUATION",
  mediaAfterProduct: "WHATSAPP_MEDIA_FOLLOWS_PRODUCT_ANCHOR",
  ambiguousMedia: "WHATSAPP_MEDIA_SEQUENCE_REQUIRES_REVIEW",
  ambiguousName: "WHATSAPP_PRODUCT_NAME_REQUIRES_REVIEW",
} as const;

const AUTO_ACCEPTABLE_BUNDLE_REASONS = new Set<string>([
  WHATSAPP_BUNDLE_REASON.reply,
  WHATSAPP_BUNDLE_REASON.album,
  WHATSAPP_BUNDLE_REASON.productName,
  WHATSAPP_BUNDLE_REASON.continuation,
  WHATSAPP_BUNDLE_REASON.mediaAfterProduct,
]);

// Category, colour, price and boilerplate words cannot identify a product.
// Only the distinctive remainder of a message can open or join a named run.
const BUNDLE_GENERIC_TOKENS = new Set([
  "سعر", "اسعار", "ريال", "ريالات", "يمني", "دولار", "دولارات", "sar", "yer", "usd",
  "متوفر", "متوفره", "توفر", "يتوفر", "تتوفر", "موجود", "موجوده", "متاح", "متاحه",
  "لون", "الوان", "اسود", "ابيض", "احمر", "ازرق", "اخضر", "فضي", "ذهبي", "بيج",
  "صوره", "صور", "صوره/products", "كاميرا", "جديد", "جديده", "كميه", "مقاس",
  "جوده", "عالي", "اصلي", "ضمان", "توصيل", "شحن", "طلب", "اطلب", "موقع",
  "ساعه", "ساعات", "حذاء", "منتج", "منتجات", "تفاصيل", "مواصفات", "وصف",
  "price", "color", "photo", "image", "available", "new", "product",
]);

function bundleTokens(text: string): Set<string> {
  const stopWords = new Set(["من", "في", "مع", "the", "and", "for", "على", "الى", "إلى"]);
  return new Set(
    text
      .normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2 && !stopWords.has(token))
      .map((token) => token.replace(/^ال/, "").replace(/^(?:وال|بال|و|ب|لل)/, "")),
  );
}

function distinctiveProductTokens(text: string | null): Set<string> {
  return new Set([...bundleTokens(text ?? "")].filter((token) =>
    !BUNDLE_GENERIC_TOKENS.has(token) && !/^\d+$/.test(token),
  ));
}

function isContinuationText(text: string | null): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return false;
  if (/^[^\p{L}]*\d/u.test(trimmed) && distinctiveProductTokens(trimmed).size === 0) {
    return true;
  }
  return /^(?:ال)?(?:سعر|متوفر|متاح|يتوفر|تتوفر|موجود|موجودة|لون|باللون|الألوان|الالوان|كمية|المقاس|مقاس|الجودة|جودة|الصناعة|صناعة|ضمان|التوصيل|توصيل|متبقي|باقي|يتوفر|تتوفر)/.test(trimmed);
}

function messageTime(message: WhatsAppSuggestionMessage): number {
  const value = new Date(message.messageTimestamp ?? message.createdAt).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}

function sameBundleScope(
  first: WhatsAppSuggestionMessage,
  second: WhatsAppSuggestionMessage,
): boolean {
  const fields = ["workspaceId", "instanceName", "groupId", "groupJid"] as const;
  return fields.every((field) => {
    const left = first[field];
    const right = second[field];
    return left === undefined || right === undefined || left === right;
  });
}

function candidateGroupKeyFor(message: WhatsAppSuggestionMessage): string {
  return isConfirmedCandidateAlbum(message)
    ? `album:${message.mediaGroupId}`
    : `message:${message.id}`;
}

function candidateMediaCount(
  message: WhatsAppSuggestionMessage,
  messages: readonly WhatsAppSuggestionMessage[],
): number {
  return isConfirmedCandidateAlbum(message)
    ? messages
        .filter((item) =>
          item.mediaGroupId === message.mediaGroupId &&
          item.mediaGroupSource === message.mediaGroupSource &&
          sameBundleScope(item, message),
        )
        .reduce((total, item) => total + item.mediaCount, 0)
    : message.mediaCount;
}

type ProductBundleRun = {
  anchorId: string;
  memberIds: Set<string>;
  anchorTokens: Set<string>;
  lastTime: number;
  lastSenderId: string | null;
  unlabelledMediaCount: number;
  hasMedia: boolean;
  greetingAnchor: boolean;
  mediaGroupIds: Set<string>;
};

export function findWhatsAppProductBundleSuggestions(
  messages: readonly WhatsAppSuggestionMessage[],
  windowMs = WHATSAPP_PRODUCT_BUNDLE_WINDOW_MS,
): Map<string, WhatsAppAssociationSuggestion[]> {
  const suggestions = new Map<string, WhatsAppAssociationSuggestion[]>();
  const byRemoteId = new Map<string, WhatsAppSuggestionMessage>();
  for (const message of messages) {
    if (message.remoteMessageId) byRemoteId.set(message.remoteMessageId, message);
  }
  const ordered = [...messages]
    .filter((message) => message.groupId !== null)
    .sort((left, right) => messageTime(left) - messageTime(right) || left.id.localeCompare(right.id));

  const runs: ProductBundleRun[] = [];
  const runByMessage = new Map<string, ProductBundleRun>();
  const runByAlbum = new Map<string, ProductBundleRun>();

  const addSuggestion = (
    anchor: WhatsAppSuggestionMessage,
    member: WhatsAppSuggestionMessage,
    reason: string,
  ) => {
    if (anchor.id === member.id) return;
    const current = suggestions.get(anchor.id) ?? [];
    if (current.some((item) => item.candidateMessageId === member.id)) return;
    current.push({
      sourceMessageId: anchor.id,
      candidateMessageId: member.id,
      candidateGroupKey: candidateGroupKeyFor(member),
      candidateMediaGroupId: isConfirmedCandidateAlbum(member) ? member.mediaGroupId : null,
      sourceText: anchor.textBody || anchor.caption,
      candidateText: member.textBody || member.caption,
      candidateMediaCount: candidateMediaCount(member, messages),
      reason,
    });
    suggestions.set(anchor.id, current);
  };

  const attach = (
    run: ProductBundleRun,
    message: WhatsAppSuggestionMessage,
    reason: string,
  ) => {
    const anchor = messages.find((item) => item.id === run.anchorId);
    if (anchor) addSuggestion(anchor, message, reason);
    run.memberIds.add(message.id);
    runByMessage.set(message.id, run);
    run.lastTime = Math.max(run.lastTime, messageTime(message));
    run.lastSenderId = message.senderId;
    run.hasMedia = run.hasMedia || message.mediaAvailable || message.mediaCount > 0;
    if (message.mediaAvailable && !message.textBody?.trim() && !message.caption?.trim()) {
      run.unlabelledMediaCount += 1;
    }
    if (isConfirmedCandidateAlbum(message) && message.mediaGroupId) {
      run.mediaGroupIds.add(message.mediaGroupId);
      runByAlbum.set(message.mediaGroupId, run);
    }
  };

  for (const message of ordered) {
    const time = messageTime(message);
    if (!Number.isFinite(time)) continue;
    const text = message.textBody || message.caption;
    const tokens = distinctiveProductTokens(text);
    const continuation = isContinuationText(text);
    const hasMedia = message.mediaAvailable || message.mediaCount > 0;
    const replyTarget = message.replyToRemoteId
      ? byRemoteId.get(message.replyToRemoteId)
      : undefined;
    const replyRun = replyTarget ? runByMessage.get(replyTarget.id) : undefined;
    const albumRun = isConfirmedCandidateAlbum(message) && message.mediaGroupId
      ? runByAlbum.get(message.mediaGroupId)
      : undefined;
    const referencedRun = replyRun ?? albumRun;

    if (referencedRun && sameBundleScope(messages.find((item) =>
      item.id === referencedRun.anchorId,
    )!, message)) {
      attach(referencedRun, message, replyRun
        ? WHATSAPP_BUNDLE_REASON.reply
        : WHATSAPP_BUNDLE_REASON.album);
      continue;
    }

    const matchingRuns = tokens.size > 0
      ? runs.filter((run) => {
          const anchor = messages.find((item) => item.id === run.anchorId);
          return anchor &&
            sameBundleScope(anchor, message) &&
            anchor.senderId === message.senderId &&
            Math.abs(run.lastTime - time) <= windowMs &&
            ([...tokens].some((token) => run.anchorTokens.has(token)) ||
              // Out-of-order arrival: the photo/price came first, the name later.
              (run.anchorTokens.size === 0 && run.hasMedia && !run.greetingAnchor));
        })
      : [];
    // A name with no overlap starts a new bundle even when it follows another
    // message from the same sender within the same second.
    if (tokens.size > 0) {
      if (matchingRuns.length === 1) {
        attach(matchingRuns[0], message, WHATSAPP_BUNDLE_REASON.productName);
        continue;
      }
      if (matchingRuns.length > 1) {
        for (const run of matchingRuns) {
          const anchor = messages.find((item) => item.id === run.anchorId);
          if (anchor) addSuggestion(anchor, message, WHATSAPP_BUNDLE_REASON.ambiguousName);
        }
      }
      const run: ProductBundleRun = {
        anchorId: message.id,
        memberIds: new Set([message.id]),
        anchorTokens: tokens,
        lastTime: time,
        lastSenderId: message.senderId,
        unlabelledMediaCount: hasMedia && !text?.trim() ? 1 : 0,
        hasMedia,
        greetingAnchor: isGreetingLike(text) && tokens.size === 0,
        mediaGroupIds: new Set(),
      };
      runs.push(run);
      runByMessage.set(message.id, run);
      if (isConfirmedCandidateAlbum(message) && message.mediaGroupId) {
        run.mediaGroupIds.add(message.mediaGroupId);
        runByAlbum.set(message.mediaGroupId, run);
      }
      continue;
    }

    const active = runs.at(-1);
    const canJoinActive = active && !active.greetingAnchor &&
      active.lastSenderId === message.senderId &&
      Math.abs(active.lastTime - time) <= windowMs &&
      (continuation || hasMedia);
    if (canJoinActive && active) {
      const reason = continuation
        ? WHATSAPP_BUNDLE_REASON.continuation
        : active.unlabelledMediaCount === 0
          ? WHATSAPP_BUNDLE_REASON.mediaAfterProduct
          : WHATSAPP_BUNDLE_REASON.ambiguousMedia;
      attach(active, message, reason);
      continue;
    }

    const run: ProductBundleRun = {
      anchorId: message.id,
      memberIds: new Set([message.id]),
      anchorTokens: new Set(),
      lastTime: time,
      lastSenderId: message.senderId,
      unlabelledMediaCount: hasMedia && !text?.trim() ? 1 : 0,
      hasMedia,
      greetingAnchor: isGreetingLike(text) && tokens.size === 0,
      mediaGroupIds: new Set(),
    };
    runs.push(run);
    runByMessage.set(message.id, run);
    if (isConfirmedCandidateAlbum(message) && message.mediaGroupId) {
      run.mediaGroupIds.add(message.mediaGroupId);
      runByAlbum.set(message.mediaGroupId, run);
    }
  }

  // Keep the older review-only suggestions where the run rules found no link:
  // the merchant must still be able to decide those pairs manually.
  const reviewSuggestions = findWhatsAppAssociationSuggestions([...messages]);
  for (const [messageId, items] of reviewSuggestions) {
    const strong = suggestions.get(messageId) ?? [];
    if (strong.some((item) => AUTO_ACCEPTABLE_BUNDLE_REASONS.has(item.reason))) continue;
    const existing = new Set(strong.map((item) => item.candidateGroupKey));
    const merged = [
      ...strong,
      ...items.filter((item) => !existing.has(item.candidateGroupKey)),
    ];
    suggestions.set(messageId, merged);
  }
  return suggestions;
}

/** Only links with evidence beyond time and sender proximity are auto-accepted. */
export function selectAutoAcceptableProductBundleSuggestions(
  suggestionsByMessage: Map<string, WhatsAppAssociationSuggestion[]>,
): WhatsAppAssociationSuggestion[] {
  const selected: WhatsAppAssociationSuggestion[] = [];
  const candidateCounts = new Map<string, number>();
  for (const [sourceId, suggestions] of suggestionsByMessage) {
    const strong = suggestions.filter((item) =>
      AUTO_ACCEPTABLE_BUNDLE_REASONS.has(item.reason),
    );
    // Weak pairs stay in the review queue even when the run found a different
    // link for the same message.
    const chosen = strong.length > 0 ? strong : [];
    for (const suggestion of chosen) {
      if (suggestion.sourceMessageId !== sourceId) continue;
      selected.push(suggestion);
      candidateCounts.set(
        suggestion.candidateGroupKey,
        (candidateCounts.get(suggestion.candidateGroupKey) ?? 0) + 1,
      );
    }
  }
  return selected.filter((suggestion) =>
    candidateCounts.get(suggestion.candidateGroupKey) === 1,
  );
}
