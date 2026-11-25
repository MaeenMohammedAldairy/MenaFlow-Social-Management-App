/**
 * Decisions taken after a Meta inbox item has already been stored.
 *
 * The webhook must never lose a customer message because the automatic-reply
 * settings could not be read or the reply queue could not be written. Everything
 * here is pure: the handler injects the settings lookup and the queue insert,
 * so the ordering and the failure behaviour are testable with plain Node and no
 * database.
 */

export type MetaInboundPlatform = "facebook" | "instagram";
export type MetaInboundKind = "message" | "comment";

/** The subset of a stored inbox item needed for notifications and routing. */
export type MetaInboundItem = {
  id: string;
  workspaceId: string;
  platform: MetaInboundPlatform;
  kind: MetaInboundKind;
  conversationId: string;
  actorId: string | null;
  actorName: string | null;
  text: string;
};

export type MetaAutoReplySettingsLike = {
  enabled: boolean;
  facebookMessagesEnabled: boolean;
  facebookCommentsEnabled: boolean;
  instagramMessagesEnabled: boolean;
  instagramCommentsEnabled: boolean;
};

export type MetaAutoReplyJobInput = {
  id: string;
  ownerId: string;
  workspaceId: string;
  inboxItemId: string;
  nextRunAt: Date;
};

export type MetaSchedulingReason =
  | "no_items"
  | "disabled"
  | "channel_off"
  | "queued"
  | "queue_failed";

export type MetaSchedulingResult = {
  reason: MetaSchedulingReason;
  /** Inbox item ids with a successfully created reply job. */
  queuedItemIds: string[];
};

/** Mirrors `metaAutoReplyEnabled` without importing the AI module. */
export function isMetaAutoReplyEligible(
  settings: MetaAutoReplySettingsLike,
  item: Pick<MetaInboundItem, "platform" | "kind">,
): boolean {
  if (!settings.enabled) return false;
  if (item.platform === "facebook") {
    return item.kind === "message"
      ? settings.facebookMessagesEnabled
      : settings.facebookCommentsEnabled;
  }
  return item.kind === "message"
    ? settings.instagramMessagesEnabled
    : settings.instagramCommentsEnabled;
}

/**
 * Schedules replies for items that are already safe in the inbox. A failed
 * settings lookup or job insert is reported to the caller but never rethrown:
 * the caller keeps the stored items and can still notify the merchant.
 */
export async function scheduleMetaAutoReplies(input: {
  items: readonly MetaInboundItem[];
  ownerId: string;
  workspaceId: string;
  nextRunAt: Date | (() => Date);
  newJobId: () => string;
  getSettings: () => Promise<MetaAutoReplySettingsLike | null | undefined>;
  /** Inserts the jobs and returns the inbox item ids that were really inserted. */
  insertJobs: (jobs: MetaAutoReplyJobInput[]) => Promise<string[]>;
  onError: (error: unknown) => void;
}): Promise<MetaSchedulingResult> {
  const failed = (error: unknown): MetaSchedulingResult => {
    input.onError(error);
    return { reason: "queue_failed", queuedItemIds: [] };
  };
  if (input.items.length === 0) {
    return { reason: "no_items", queuedItemIds: [] };
  }

  let settings: MetaAutoReplySettingsLike | null | undefined;
  try {
    settings = await input.getSettings();
  } catch (error) {
    return failed(error);
  }
  if (!settings?.enabled) {
    return { reason: "disabled", queuedItemIds: [] };
  }

  const eligible = input.items.filter((item) =>
    isMetaAutoReplyEligible(settings, item),
  );
  if (eligible.length === 0) {
    return { reason: "channel_off", queuedItemIds: [] };
  }

  let jobs: MetaAutoReplyJobInput[] = [];
  try {
    const nextRunAt =
      typeof input.nextRunAt === "function" ? input.nextRunAt() : input.nextRunAt;
    jobs = eligible.map((item) => ({
      id: input.newJobId(),
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      inboxItemId: item.id,
      nextRunAt,
    }));
  } catch (error) {
    return failed(error);
  }
  try {
    const queuedItemIds = await input.insertJobs(jobs);
    return { reason: "queued", queuedItemIds };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Every stored item gets a push notification. Only items without a queued
 * reply are "waiting for your reply"; the rest are announced as new messages,
 * so turning the automatic reply on never hides the message and never claims a
 * human is needed when the bot already took it.
 */
export function metaInboundNotifications(
  items: readonly MetaInboundItem[],
  queuedItemIds: readonly string[],
): Array<{ item: MetaInboundItem; awaitingReply: boolean }> {
  const queued = new Set(queuedItemIds);
  return items.map((item) => ({
    item,
    awaitingReply: !queued.has(item.id),
  }));
}
