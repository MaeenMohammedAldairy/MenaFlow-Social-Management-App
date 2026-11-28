/**
 * Shadow Bundle Engine — Phase 2.
 *
 * What this module does: given a set of already-persisted WhatsApp messages
 * (and the media rows they carry), it decides which of them plausibly describe
 * ONE product, and returns that decision as a plain value.
 *
 * What it deliberately does NOT do:
 *   - it never touches the database (no reads, no writes);
 *   - it never calls a model;
 *   - it never creates a job, a suggestion or a product;
 *   - it never mutates its input;
 *   - it never decides at arrival. The decision is a function of the whole
 *     window, because a photo may arrive before the price that explains it.
 *
 * Shape of the decision:
 *   1. Cluster the media (album, contiguous run, or single photo).
 *   2. Anchor each cluster with at most one text.
 *   3. Everything else stands alone.
 *
 * That order is what makes "text arrived first" and "photos arrived first" the
 * same problem, so neither ordering can lose the other side.
 */

export type ShadowBundleStatus =
  | "COLLECTING"
  | "READY"
  | "PROCESSING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ShadowBundleKind =
  | "album"
  | "reply"
  | "explicit"
  | "adjacent"
  | "single";

/** How a member was claimed. One value per member, never a guess. */
export type ShadowClaimReason =
  | "ALBUM_MEMBER"
  | "REPLY_TO_PARENT"
  | "EXPLICIT_PRODUCT_REFERENCE"
  | "CLUSTER_TEXT"
  | "MEDIA_RUN_MEMBER"
  | "SINGLETON";

export type ShadowConfidence = "strong" | "medium" | "weak";

export type ShadowBundleMemberRole = "text" | "media" | "both";

export type ShadowBundleMessage = {
  id: string;
  remoteMessageId: string;
  workspaceId: string;
  ownerId: string;
  instanceName: string;
  groupId: string | null;
  groupJid: string;
  senderId: string | null;
  messageType: string;
  textBody: string | null;
  caption: string | null;
  mediaAvailable: boolean;
  mediaGroupId: string | null;
  mediaGroupSource: "protocol_association" | "provider_album_container" | null;
  mediaGroupExpectedCount: number | null;
  mediaGroupIndex: number | null;
  replyToRemoteId: string | null;
  messageTimestamp: string | null;
  createdAt: string;
  /** Stored media rows only. `failed` is terminal and does not block READY. */
  media: Array<{ id: string; downloadStatus: string }>;
  /** Optional: a product/SKU reference written in the message itself. */
  explicitProductRef?: string | null;
};

export type ShadowBundleMember = {
  messageId: string;
  role: ShadowBundleMemberRole;
  claimReason: ShadowClaimReason;
  addedAt: string;
};

export type ShadowBundle = {
  id: string;
  bundleKey: string;
  ownerId: string;
  workspaceId: string;
  instanceName: string;
  groupId: string | null;
  groupJid: string;
  kind: ShadowBundleKind;
  senderId: string | null;
  status: ShadowBundleStatus;
  evidence: string;
  evidenceDetail: Record<string, unknown>;
  confidence: ShadowConfidence;
  anchorMessageId: string;
  mediaExpected: number;
  mediaStored: number;
  openedAt: string;
  readyAt: string | null;
  frozenAt: string | null;
  completedAt: string | null;
  version: number;
  memberSetHash: string;
  reviewReason: string | null;
  members: ShadowBundleMember[];
};

export type ShadowPlanResult = {
  bundles: ShadowBundle[];
  /** messageId -> bundleId, for the comparison step. */
  messageBundle: Map<string, string>;
};

export type ShadowPlanOptions = {
  /** An unlabelled-media run longer than this is not one offer. */
  maxMediaRunLength?: number;
  /**
   * A *tie-breaker* bound on adjacency, never a reason to merge on its own.
   * Two messages inside it are still separate until another rule says
   * otherwise.
   */
  adjacencyMs?: number;
  /** How long a text-only bundle waits for media that may still arrive. */
  textSettleMs?: number;
  /** How long an album waits for media that may still be downloading. */
  albumSettleMs?: number;
  /** Clock for readiness evaluation, so a replay is reproducible. */
  evaluatedAt?: Date;
};

const DEFAULT_MAX_MEDIA_RUN = 6;
const DEFAULT_ADJACENCY_MS = 30_000;
const DEFAULT_TEXT_SETTLE_MS = 30_000;
const DEFAULT_ALBUM_SETTLE_MS = 60_000;

/** Words that can never identify a product on their own. */
const GENERIC_TOKENS = new Set([
  "سعر", "اسعار", "ريال", "ريالات", "يمني", "دولار", "دولارات", "sar", "yer",
  "usd", "متوفر", "متوفره", "توفر", "يتوفر", "تتوفر", "موجود", "موجوده",
  "متاح", "متاحه", "لون", "الوان", "اسود", "ابيض", "احمر", "ازرق", "اخضر",
  "فضي", "ذهبي", "بيج", "صوره", "صور", "كاميرا", "جديد", "جديده", "كميه",
  "مقاس", "جوده", "عالي", "عاليه", "اصلي", "ضمان", "توصيل", "شحن", "طلب",
  "اطلب", "موقع", "ساعه", "ساعات", "حذاء", "منتج", "منتجات", "تفاصيل",
  "مواصفات", "وصف", "فقط", "price", "color", "photo", "image", "available",
  "new", "product",
]);

const STOP_WORDS = new Set(["من", "في", "مع", "على", "الى", "إلى", "the", "and", "for"]);

/**
 * Same normalisation the legacy ruleset uses, kept identical on purpose: the
 * comparison is only meaningful if both sides read Arabic the same way.
 */
export function distinctiveProductTokens(text: string | null): Set<string> {
  const trimmed = text?.trim();
  if (!trimmed) return new Set();
  const tokens = trimmed
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .map((token) => token.replace(/^ال/, "").replace(/^(?:وال|بال|و|ب|لل)/, ""));
  return new Set(tokens.filter((token) => !GENERIC_TOKENS.has(token) && !/^\d+$/.test(token)));
}

function timeOf(message: ShadowBundleMessage): number {
  const raw = message.messageTimestamp ?? message.createdAt;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}

function textOf(message: ShadowBundleMessage): string | null {
  const value = message.textBody?.trim() || message.caption?.trim();
  return value ? value : null;
}

function isConfirmedAlbum(message: ShadowBundleMessage): boolean {
  return Boolean(
    message.mediaGroupId &&
      (message.mediaGroupSource === "protocol_association" ||
        message.mediaGroupSource === "provider_album_container"),
  );
}

function hasMedia(message: ShadowBundleMessage): boolean {
  return message.mediaAvailable || message.media.length > 0;
}

function hasPendingMedia(message: ShadowBundleMessage): boolean {
  return message.media.some(
    (item) => item.downloadStatus !== "stored" && item.downloadStatus !== "failed",
  );
}

function roleOf(message: ShadowBundleMessage): ShadowBundleMemberRole {
  const withText = Boolean(textOf(message));
  const withMedia = hasMedia(message);
  if (withText && withMedia) return "both";
  return withText ? "text" : "media";
}

/** A photo that carries no words of its own and belongs to no album. */
function isUnlabelledMedia(message: ShadowBundleMessage): boolean {
  return hasMedia(message) && !textOf(message) && !isConfirmedAlbum(message);
}

function isTextOnly(message: ShadowBundleMessage): boolean {
  return !hasMedia(message) && Boolean(textOf(message));
}

/**
 * Only a *plain* text message may be pulled into a media cluster.
 *
 * A photo that carries its own caption (`"وصل وصل"` under a picture) is already
 * complete evidence in itself: claiming it as somebody else's anchor silently
 * relocates its photos, which is exactly the over-merge this design forbids. The
 * reverse direction — a bare photo joining an adjacent text — is unaffected,
 * because that photo brings no words of its own to lose.
 */
function isClaimableText(message: ShadowBundleMessage): boolean {
  return isTextOnly(message) && !isUnlabelledMedia(message);
}

function sameScope(a: ShadowBundleMessage, b: ShadowBundleMessage): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.ownerId === b.ownerId &&
    a.instanceName === b.instanceName &&
    a.groupId !== null &&
    a.groupId === b.groupId &&
    a.groupJid === b.groupJid
  );
}

function hash(value: string): string {
  // Stable across processes and dependency-free: the shadow plan only needs
  // identity, not cryptography.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = ((h1 ^ code) * 0x01000193) >>> 0;
    h2 = (h2 + code * (index + 1)) >>> 0;
    h2 = (h2 ^ (h2 << 5)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function memberSetHash(memberIds: readonly string[]): string {
  return hash([...new Set(memberIds)].sort().join("\u0000"));
}

/** Deterministic bundle id from its scope and its anchor message. */
export function shadowBundleId(input: {
  workspaceId: string;
  instanceName: string;
  groupJid: string;
  anchorMessageId: string;
}): string {
  return `bundle:${hash(
    [input.workspaceId, input.instanceName, input.groupJid, input.anchorMessageId].join("\u0000"),
  )}`;
}

/** Why two sides must never share a bundle. Returned as the refusal reason. */
export type MergeRefusal =
  | "PRODUCT_TOKEN_CONFLICT"
  | "DIFFERENT_ALBUMS"
  | "COMPETING_EVIDENCE"
  | "NO_EVIDENCE";

/**
 * The guards, in one place, so no rule can merge without passing them.
 *
 * `hasStrongEvidence` means the side already stands on its own evidence (album,
 * reply, explicit reference). Two strong sides are never merged by adjacency.
 */
export function checkMergeGuard(input: {
  left: { hasStrongEvidence: boolean; tokens: Set<string>; albumId: string | null };
  right: { hasStrongEvidence: boolean; tokens: Set<string>; albumId: string | null };
}): MergeRefusal | null {
  const { left, right } = input;
  if (left.albumId && right.albumId && left.albumId !== right.albumId) {
    return "DIFFERENT_ALBUMS";
  }
  if (left.hasStrongEvidence && right.hasStrongEvidence) return "COMPETING_EVIDENCE";
  if (
    left.tokens.size > 0 &&
    right.tokens.size > 0 &&
    ![...left.tokens].some((token) => right.tokens.has(token))
  ) {
    return "PRODUCT_TOKEN_CONFLICT";
  }
  return null;
}

type DraftBundle = {
  members: ShadowBundleMessage[];
  kind: ShadowBundleKind;
  evidence: string;
  evidenceDetail: Record<string, unknown>;
  confidence: ShadowConfidence;
  claimReasons: Map<string, ShadowClaimReason>;
  anchor: ShadowBundleMessage;
  /** Set when the bundle is a question for a human rather than a merge. */
  ambiguous: boolean;
  reviewReason: string | null;
  /** Album identity, when the cluster came from one. */
  mediaGroupId: string | null;
};

function orderedMessages(messages: readonly ShadowBundleMessage[]): ShadowBundleMessage[] {
  return [...messages]
    .filter((message) => message.groupId !== null)
    .sort((a, b) => {
      const delta = timeOf(a) - timeOf(b);
      return Number.isFinite(delta) && delta !== 0 ? delta : a.id.localeCompare(b.id);
    });
}

function makeDraft(input: {
  anchor: ShadowBundleMessage;
  kind: ShadowBundleKind;
  evidence: string;
  evidenceDetail?: Record<string, unknown>;
  confidence: ShadowConfidence;
  claimReason: ShadowClaimReason;
  mediaGroupId?: string | null;
}): DraftBundle {
  return {
    anchor: input.anchor,
    members: [input.anchor],
    kind: input.kind,
    evidence: input.evidence,
    evidenceDetail: input.evidenceDetail ?? {},
    confidence: input.confidence,
    claimReasons: new Map([[input.anchor.id, input.claimReason]]),
    ambiguous: false,
    reviewReason: null,
    mediaGroupId: input.mediaGroupId ?? null,
  };
}

function addToDraft(draft: DraftBundle, message: ShadowBundleMessage, reason: ShadowClaimReason): void {
  if (draft.claimReasons.has(message.id)) return;
  draft.members.push(message);
  draft.claimReasons.set(message.id, reason);
  // The anchor is the earliest member, so the bundle id never moves.
  if (timeOf(message) < timeOf(draft.anchor)) draft.anchor = message;
}

function draftTokens(draft: DraftBundle): Set<string> {
  const tokens = new Set<string>();
  for (const member of draft.members) {
    for (const token of distinctiveProductTokens(textOf(member))) tokens.add(token);
  }
  return tokens;
}

function draftSpan(draft: DraftBundle): { start: number; end: number } {
  const times = draft.members.map(timeOf).filter((value) => Number.isFinite(value));
  return { start: Math.min(...times), end: Math.max(...times) };
}

/** Media rows promised by the cluster, counted over its media members. */
function bundleMediaCounts(draft: DraftBundle): {
  expected: number;
  stored: number;
  pending: boolean;
} {
  let stored = 0;
  let pending = false;
  let mediaMembers = 0;
  // The advertised count lives on the album *container*, which carries no media
  // of its own, so it has to be read from every member — not only the ones that
  // hold rows.
  const promised = Math.max(
    0,
    ...draft.members.map((member) => member.mediaGroupExpectedCount ?? 0),
  );
  for (const member of draft.members) {
    if (!hasMedia(member)) continue; // an album container carries no media itself
    mediaMembers += 1;
    for (const item of member.media) {
      if (item.downloadStatus === "stored") stored += 1;
      else if (item.downloadStatus !== "failed") pending = true;
    }
  }
  // The advertised count includes the album container itself, which never
  // carries a media row. Subtracting the containers present in the cluster is
  // the difference between "12 of 13 arrived" (a permanent false shortfall) and
  // "12 of 12 arrived" (the truth). The legacy gate compares 12 rows against the
  // advertised 13 and therefore never settles — the same arithmetic, corrected.
  const containers = draft.members.filter(
    (member) =>
      !hasMedia(member) &&
      (member.messageType ?? "").toLowerCase().includes("album") &&
      (member.mediaGroupExpectedCount ?? 0) > 0,
  ).length;
  // A container with no children at all is the ACE5CCDE shape: the promise was
  // made and nothing came back. Keep the promise visible (2 expected, 0 stored)
  // so the shortfall is reported instead of being rewritten as "0 of 0".
  const expected =
    mediaMembers === 0 && containers > 0
      ? promised
      : Math.max(promised - containers, mediaMembers);
  return { expected, stored, pending };
}

function evaluateReadiness(
  draft: DraftBundle,
  settings: { textSettleMs: number; albumSettleMs: number; evaluatedAt: Date },
): {
  status: ShadowBundleStatus;
  mediaExpected: number;
  mediaStored: number;
  readyAt: string | null;
  reviewReason: string | null;
} {
  const counts = bundleMediaCounts(draft);
  const span = draftSpan(draft);
  const ageMs = settings.evaluatedAt.getTime() - span.end;
  const withText = draft.members.some((member) => Boolean(textOf(member)));
  const withMedia = draft.members.some(hasMedia);

  if (draft.ambiguous) {
    return {
      status: "NEEDS_REVIEW",
      mediaExpected: counts.expected,
      mediaStored: counts.stored,
      readyAt: null,
      reviewReason: draft.reviewReason ?? "AMBIGUOUS_EVIDENCE",
    };
  }

  if (draft.kind === "album") {
    if (counts.stored >= counts.expected) {
      return {
        status: "READY",
        mediaExpected: counts.expected,
        mediaStored: counts.stored,
        readyAt: settings.evaluatedAt.toISOString(),
        reviewReason: null,
      };
    }
    if (counts.pending || ageMs < settings.albumSettleMs) {
      return {
        status: "COLLECTING",
        mediaExpected: counts.expected,
        mediaStored: counts.stored,
        readyAt: null,
        reviewReason: counts.pending ? "MEDIA_PENDING" : "ALBUM_SETTLING",
      };
    }
    // The album stopped arriving short of what it promised. Reading what is
    // there beats waiting forever, and the gap is named rather than hidden.
    return {
      status: "READY",
      mediaExpected: counts.expected,
      mediaStored: counts.stored,
      readyAt: settings.evaluatedAt.toISOString(),
      reviewReason: "MEDIA_PARTIAL",
    };
  }

  if (counts.pending) {
    return {
      status: "COLLECTING",
      mediaExpected: counts.expected,
      mediaStored: counts.stored,
      readyAt: null,
      reviewReason: "MEDIA_PENDING",
    };
  }
  if (withMedia && !withText) {
    // Photos with no words: nothing to read yet, and no evidence that a text is
    // coming. It waits. It is never guessed to be a product.
    return {
      status: "COLLECTING",
      mediaExpected: counts.expected,
      mediaStored: counts.stored,
      readyAt: null,
      reviewReason: "NEEDS_TEXT",
    };
  }
  if (!withMedia && withText && ageMs < settings.textSettleMs) {
    return {
      status: "COLLECTING",
      mediaExpected: counts.expected,
      mediaStored: counts.stored,
      readyAt: null,
      reviewReason: "TEXT_SETTLING",
    };
  }
  return {
    status: "READY",
    mediaExpected: counts.expected,
    mediaStored: counts.stored,
    readyAt: settings.evaluatedAt.toISOString(),
    reviewReason: null,
  };
}

function finalise(
  draft: DraftBundle,
  settings: { textSettleMs: number; albumSettleMs: number; evaluatedAt: Date },
): ShadowBundle {
  const readiness = evaluateReadiness(draft, settings);
  const members = [...draft.members].sort((a, b) => {
    const delta = timeOf(a) - timeOf(b);
    return Number.isFinite(delta) && delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const anchor = members[0];
  const bundleKey = shadowBundleId({
    workspaceId: anchor.workspaceId,
    instanceName: anchor.instanceName,
    groupJid: anchor.groupJid,
    anchorMessageId: anchor.id,
  });
  return {
    id: bundleKey,
    bundleKey,
    ownerId: anchor.ownerId,
    workspaceId: anchor.workspaceId,
    instanceName: anchor.instanceName,
    groupId: anchor.groupId,
    groupJid: anchor.groupJid,
    kind: draft.kind,
    senderId: anchor.senderId,
    status: readiness.status,
    evidence: draft.evidence,
    evidenceDetail: draft.evidenceDetail,
    confidence: draft.confidence,
    anchorMessageId: anchor.id,
    mediaExpected: readiness.mediaExpected,
    mediaStored: readiness.mediaStored,
    openedAt: anchor.messageTimestamp ?? anchor.createdAt,
    readyAt: readiness.readyAt,
    frozenAt: null,
    completedAt: null,
    version: 1,
    memberSetHash: memberSetHash(members.map((member) => member.id)),
    reviewReason: readiness.reviewReason,
    members: members.map((member) => ({
      messageId: member.id,
      role: roleOf(member),
      claimReason: draft.claimReasons.get(member.id) ?? "SINGLETON",
      addedAt: member.messageTimestamp ?? member.createdAt,
    })),
  };
}

/**
 * Plan bundles for one window of messages.
 *
 *   1. ALBUM      — same media_group_id + media_group_source. Strongest signal.
 *   2. REPLY      — reply/quoted target inside the same scope.
 *   3. EXPLICIT   — a product/SKU reference written in the message.
 *   4. CLUSTER TEXT — one text anchored to one media cluster (an album with no
 *                   words of its own, a contiguous run of photos, or a single
 *                   photo). Exactly one text and exactly one cluster, or the
 *                   question goes to a human instead of being answered by
 *                   proximity.
 *   5. SINGLETON  — everything else stays alone.
 */
export function planShadowBundles(
  messages: readonly ShadowBundleMessage[],
  options: ShadowPlanOptions = {},
): ShadowPlanResult {
  const adjacencyMs = options.adjacencyMs ?? DEFAULT_ADJACENCY_MS;
  const maxRun = options.maxMediaRunLength ?? DEFAULT_MAX_MEDIA_RUN;
  const settings = {
    textSettleMs: options.textSettleMs ?? DEFAULT_TEXT_SETTLE_MS,
    albumSettleMs: options.albumSettleMs ?? DEFAULT_ALBUM_SETTLE_MS,
    evaluatedAt: options.evaluatedAt ?? new Date(),
  };

  const ordered = orderedMessages(messages);
  const byRemoteId = new Map<string, ShadowBundleMessage>();
  for (const message of ordered) {
    if (message.remoteMessageId) byRemoteId.set(message.remoteMessageId, message);
  }

  const drafts: DraftBundle[] = [];
  const draftByMessage = new Map<string, DraftBundle>();
  const attach = (draft: DraftBundle, message: ShadowBundleMessage, reason: ShadowClaimReason) => {
    addToDraft(draft, message, reason);
    draftByMessage.set(message.id, draft);
  };
  const openDraft = (draft: DraftBundle) => {
    for (const member of draft.members) draftByMessage.set(member.id, draft);
    drafts.push(draft);
  };

  // ---- RULE 1 — ALBUM -----------------------------------------------------
  const albums = new Map<string, ShadowBundleMessage[]>();
  for (const message of ordered) {
    if (!isConfirmedAlbum(message)) continue;
    const key = [
      message.workspaceId,
      message.instanceName,
      message.groupJid,
      message.mediaGroupId,
      message.mediaGroupSource,
    ].join("\u0000");
    const bucket = albums.get(key) ?? [];
    bucket.push(message);
    albums.set(key, bucket);
  }
  for (const bucket of albums.values()) {
    const anchor = [...bucket].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id))[0];
    const draft = makeDraft({
      anchor,
      kind: "album",
      evidence: "ALBUM",
      evidenceDetail: {
        mediaGroupId: anchor.mediaGroupId,
        mediaGroupSource: anchor.mediaGroupSource,
        advertisedMediaCount: Math.max(...bucket.map((m) => m.mediaGroupExpectedCount ?? 0)),
      },
      confidence: "strong",
      claimReason: "ALBUM_MEMBER",
      mediaGroupId: anchor.mediaGroupId,
    });
    for (const member of bucket) attach(draft, member, "ALBUM_MEMBER");
    openDraft(draft);
  }

  // ---- RULE 2 — REPLY -----------------------------------------------------
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const message of ordered) {
      if (draftByMessage.has(message.id)) continue;
      if (!message.replyToRemoteId) continue;
      const parent = byRemoteId.get(message.replyToRemoteId);
      if (!parent || !sameScope(parent, message)) continue;
      const parentDraft = draftByMessage.get(parent.id);
      if (!parentDraft) continue;
      attach(parentDraft, message, "REPLY_TO_PARENT");
      progressed = true;
    }
  }

  // ---- RULE 3 — EXPLICIT --------------------------------------------------
  const explicitDrafts = new Map<string, DraftBundle>();
  for (const message of ordered) {
    if (draftByMessage.has(message.id)) continue;
    const reference = message.explicitProductRef?.trim();
    if (!reference) continue;
    const existing = explicitDrafts.get(reference);
    if (existing && sameScope(existing.anchor, message)) {
      attach(existing, message, "EXPLICIT_PRODUCT_REFERENCE");
      continue;
    }
    const draft = makeDraft({
      anchor: message,
      kind: "explicit",
      evidence: "EXPLICIT_PRODUCT",
      evidenceDetail: { reference },
      confidence: "strong",
      claimReason: "EXPLICIT_PRODUCT_REFERENCE",
    });
    openDraft(draft);
    explicitDrafts.set(reference, draft);
  }

  // ---- RULE 4 — CLUSTER TEXT ---------------------------------------------
  //
  // Clusters are built from what is still unclaimed. A cluster is:
  //   * an album draft that carries no words of its own (the usual case: a
  //     photo gallery posted with a separate price/description message), or
  //   * a contiguous run of unlabelled photos, or
  //   * a single unlabelled photo.
  // A cluster takes exactly one text; anything else is a question, not an
  // answer. This is the rule that replaces legacy's keyword overlap, and it is
  // deliberately stricter: it can only ever attach ONE text to ONE cluster.
  type Cluster = {
    draft: DraftBundle;
    label: string;
    start: number;
    end: number;
    senderId: string | null;
    tokens: Set<string>;
  };
  const clusters: Cluster[] = [];
  const clusterByMessage = new Map<string, Cluster>();

  const registerCluster = (draft: DraftBundle, label: string) => {
    const span = draftSpan(draft);
    const cluster: Cluster = {
      draft,
      label,
      start: span.start,
      end: span.end,
      senderId: draft.anchor.senderId,
      tokens: draftTokens(draft),
    };
    clusters.push(cluster);
    for (const member of draft.members) clusterByMessage.set(member.id, cluster);
  };

  // 4a — albums that carry no words of their own.
  for (const draft of drafts) {
    if (draft.kind !== "album") continue;
    if (draft.members.some((member) => Boolean(textOf(member)))) continue;
    registerCluster(draft, `album:${draft.mediaGroupId ?? "unknown"}`);
  }

  // 4b — contiguous runs of unlabelled photos, and single ones.
  let runDraft: DraftBundle | null = null;
  let runLast: ShadowBundleMessage | null = null;
  const flushRun = () => {
    if (!runDraft) return;
    registerCluster(runDraft, `run:${runDraft.anchor.id}`);
    drafts.push(runDraft);
    runDraft = null;
    runLast = null;
  };
  for (const message of ordered) {
    if (draftByMessage.has(message.id) || !isUnlabelledMedia(message)) continue;
    const continues =
      runDraft &&
      runLast &&
      runDraft.members.length < maxRun &&
      sameScope(runLast, message) &&
      runLast.senderId === message.senderId &&
      timeOf(message) - timeOf(runLast) <= adjacencyMs;
    if (!continues) {
      flushRun();
      runDraft = makeDraft({
        anchor: message,
        kind: "adjacent",
        evidence: "MEDIA_CLUSTER",
        evidenceDetail: { mediaMessages: [message.remoteMessageId] },
        confidence: "medium",
        claimReason: "MEDIA_RUN_MEMBER",
      });
      attach(runDraft, message, "MEDIA_RUN_MEMBER");
    } else if (runDraft && runLast) {
      attach(runDraft, message, "MEDIA_RUN_MEMBER");
      (runDraft.evidenceDetail.mediaMessages as string[]).push(message.remoteMessageId);
      runDraft.confidence = "medium";
    }
    runLast = message;
  }
  flushRun();

  // Assign at most one text per cluster.
  const claimedText = new Map<string, Cluster>();
  for (const cluster of clusters) {
    const candidates = ordered.filter(
      (candidate) =>
        !draftByMessage.has(candidate.id) &&
        !clusterByMessage.has(candidate.id) &&
        isClaimableText(candidate) &&
        sameScope(candidate, cluster.draft.anchor) &&
        candidate.senderId === cluster.senderId &&
        Number.isFinite(timeOf(candidate)) &&
        timeOf(candidate) >= cluster.start - adjacencyMs &&
        timeOf(candidate) <= cluster.end + adjacencyMs,
    );
    if (candidates.length === 0) continue;

    // Among several candidate texts, exactly one may still be unambiguous: the
    // one that is the *nearest* text on either side of the cluster, with no
    // other text in between. That is the "price, then a gallery" shape. Two
    // nearest texts (one on each side) means proximity cannot choose, and the
    // cluster becomes a question.
    const nearestBefore = [...ordered]
      .reverse()
      .find(
        (candidate) =>
          isClaimableText(candidate) &&
          sameScope(candidate, cluster.draft.anchor) &&
          candidate.senderId === cluster.senderId &&
          timeOf(candidate) <= cluster.start,
      );
    const nearestAfter = ordered.find(
      (candidate) =>
        isClaimableText(candidate) &&
        sameScope(candidate, cluster.draft.anchor) &&
        candidate.senderId === cluster.senderId &&
        timeOf(candidate) >= cluster.end,
    );
    const adjacentCandidates = [nearestBefore, nearestAfter].filter(
      (candidate): candidate is ShadowBundleMessage =>
        Boolean(candidate) && candidates.some((item) => item.id === candidate!.id),
    );
    if (candidates.length > 1 && adjacentCandidates.length === 1) {
      candidates.length = 0;
      candidates.push(adjacentCandidates[0]);
    }

    const guard = checkMergeGuard({
      left: {
        hasStrongEvidence: cluster.draft.kind === "album" || cluster.draft.kind === "explicit",
        tokens: cluster.tokens,
        albumId: cluster.draft.mediaGroupId,
      },
      right: {
        hasStrongEvidence: false,
        tokens: candidates
          .flatMap((candidate) => [...distinctiveProductTokens(textOf(candidate))])
          .reduce((set, token) => set.add(token), new Set<string>()),
        albumId: null,
      },
    });

    if (candidates.length > 1 || guard === "PRODUCT_TOKEN_CONFLICT") {
      cluster.draft.ambiguous = true;
      cluster.draft.reviewReason =
        candidates.length > 1 ? "MULTIPLE_TEXT_CANDIDATES" : (guard ?? "AMBIGUOUS_EVIDENCE");
      cluster.draft.evidenceDetail.candidateTexts = candidates.map((c) => c.remoteMessageId);
      cluster.draft.evidenceDetail.refusedBy = guard;
      // The cluster is a question: keep the photos, name the candidates, and
      // claim none of them. Under-grouping is the chosen failure mode.
      continue;
    }
    if (guard) {
      cluster.draft.evidenceDetail.refusedBy = guard;
      continue;
    }

    const text = candidates[0];
    const existing = claimedText.get(text.id);
    if (existing && existing !== cluster) {
      // One text, two clusters: neither may take it silently.
      existing.draft.ambiguous = true;
      existing.draft.reviewReason = "TEXT_CLAIMED_BY_TWO_CLUSTERS";
      cluster.draft.ambiguous = true;
      cluster.draft.reviewReason = "TEXT_CLAIMED_BY_TWO_CLUSTERS";
      continue;
    }
    claimedText.set(text.id, cluster);
    attach(cluster.draft, text, "CLUSTER_TEXT");
    cluster.draft.evidenceDetail.textMessage = text.remoteMessageId;
    cluster.draft.evidenceDetail.deltaMs = Math.max(
      0,
      Math.min(
        Math.abs(timeOf(text) - cluster.start),
        Math.abs(timeOf(text) - cluster.end),
      ),
    );
    cluster.draft.confidence = cluster.draft.kind === "album" ? "strong" : "medium";
  }

  // ---- RULE 5 — SINGLETON -------------------------------------------------
  for (const message of ordered) {
    if (draftByMessage.has(message.id)) continue;
    const draft = makeDraft({
      anchor: message,
      kind: "single",
      evidence: "NONE",
      evidenceDetail: {},
      confidence: "weak",
      claimReason: "SINGLETON",
    });
    openDraft(draft);
  }

  const bundles = drafts.map((draft) => finalise(draft, settings));
  const messageBundle = new Map<string, string>();
  for (const bundle of bundles) {
    for (const member of bundle.members) messageBundle.set(member.messageId, bundle.id);
  }
  return { bundles, messageBundle };
}
