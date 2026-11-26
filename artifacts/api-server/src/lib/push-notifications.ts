import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import {
  db,
  pushNotificationOutbox,
  pushNotificationTokens,
  workspaceMembers,
} from "@workspace/db";
import { logger } from "./logger";
import {
  buildNotificationContent,
  type NotificationDraft,
  type NotificationEventType,
  type SubscriptionMeterName,
} from "./notification-content";
import {
  chunkPushMessages,
  sendPushBatch,
  toPushMessage,
  type SendPushResult,
} from "./expo-push-client";

/**
 * Push notification delivery: token registry plus the outbox worker.
 *
 * The queue copies the states already proven on `mena_orders` for Meta order
 * confirmations, including the distinction that makes duplicate pushes
 * impossible: an expired lease in `processing` means the send never started and
 * is safe to retry, while an expired lease in `sending` means the Expo request
 * may well have been accepted, so the row goes to `unknown` and is never
 * retried. A duplicated "new order" alert teaches the merchant to distrust all
 * of them.
 */

/**
 * Reads a positive integer from the environment at call time rather than at
 * module load, so a test or a script can change it without reloading the module.
 */
function envPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function maxAttempts(): number {
  return envPositiveInt("PUSH_NOTIFICATION_MAX_ATTEMPTS", 5);
}

const LEASE_MS = 60_000;

/** Rows claimed per poll. Small on purpose: latency matters more than throughput. */
const BATCH_LIMIT = 20;

/**
 * Whether delivery can work at all.
 *
 * Expo's push service requires an access token, so without one every send would
 * fail. Enqueueing is suppressed too, not just sending: writing rows nobody will
 * ever drain turns the outbox into unbounded storage for nothing.
 */
export function isPushDeliveryConfigured(): boolean {
  return Boolean(process.env.EXPO_PUSH_ACCESS_TOKEN?.trim());
}

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

export type RegisterPushTokenInput = {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
  deviceId?: string | null;
};

/**
 * How many devices one user may have registered.
 *
 * A real merchant has a phone and maybe a tablet. The cap exists because every
 * notification fans out to *all* of a recipient's tokens, so an authenticated
 * user who registered thousands of them could turn one order alert into
 * thousands of Expo requests — cost and rate-limit abuse at the price of one
 * login. The least recently seen token is evicted, which is also what a user
 * switching phones expects.
 */
export const MAX_TOKENS_PER_USER = 10;

async function evictExcessTokens(userId: string): Promise<void> {
  const rows = await db
    .select({ id: pushNotificationTokens.id })
    .from(pushNotificationTokens)
    .where(eq(pushNotificationTokens.userId, userId))
    .orderBy(desc(pushNotificationTokens.lastSeenAt));

  const excess = rows.slice(MAX_TOKENS_PER_USER).map((row) => row.id);
  if (excess.length === 0) return;

  await db
    .delete(pushNotificationTokens)
    .where(inArray(pushNotificationTokens.id, excess));
  logger.info(
    { userId, evicted: excess.length },
    "Evicted push tokens above the per-user limit",
  );
}

/**
 * Records a device token. Idempotent: the client registers on every cold start,
 * so re-registering the same token must refresh `last_seen_at` rather than fail
 * or duplicate.
 *
 * A token that Expo previously rejected is re-enabled here, because the usual
 * cause is a reinstall — the same device coming back.
 */
export async function registerPushToken(
  input: RegisterPushTokenInput,
): Promise<{ id: string }> {
  const now = new Date();
  const id = `push-token:${randomUUID()}`;

  await db
    .insert(pushNotificationTokens)
    .values({
      id,
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
      enabled: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [pushNotificationTokens.userId, pushNotificationTokens.token],
      set: {
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        enabled: true,
        lastSeenAt: now,
        updatedAt: now,
      },
    });

  // Runs after the upsert so the token just written is the newest and can never
  // be the one evicted.
  await evictExcessTokens(input.userId);

  return { id };
}

/**
 * Lists the caller's own registered devices.
 *
 * The token string is returned in full because the client needs it to
 * unregister on sign-out; these endpoints are authenticated and scoped to the
 * caller's own rows, so there is no wider disclosure.
 */
export async function listPushTokens(userId: string): Promise<
  Array<{
    id: string;
    token: string;
    platform: string;
    deviceId: string | null;
    enabled: boolean;
    lastSeenAt: string;
  }>
> {
  const rows = await db
    .select({
      id: pushNotificationTokens.id,
      token: pushNotificationTokens.token,
      platform: pushNotificationTokens.platform,
      deviceId: pushNotificationTokens.deviceId,
      enabled: pushNotificationTokens.enabled,
      lastSeenAt: pushNotificationTokens.lastSeenAt,
    })
    .from(pushNotificationTokens)
    .where(eq(pushNotificationTokens.userId, userId))
    .orderBy(desc(pushNotificationTokens.lastSeenAt));

  return rows.map((row) => ({
    ...row,
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

/**
 * Removes a token belonging to the calling user only. The `userId` predicate is
 * what stops one merchant from unregistering another's device by guessing a
 * token string.
 */
export async function unregisterPushToken(
  userId: string,
  token: string,
): Promise<{ removed: boolean }> {
  const deleted = await db
    .delete(pushNotificationTokens)
    .where(
      and(
        eq(pushNotificationTokens.userId, userId),
        eq(pushNotificationTokens.token, token),
      ),
    )
    .returning({ id: pushNotificationTokens.id });

  return { removed: deleted.length > 0 };
}

/**
 * Disables tokens Expo refused as `DeviceNotRegistered` — uninstalled, or the
 * merchant turned notifications off for the app.
 *
 * Disabled rather than deleted so the row survives as evidence of why a device
 * stopped receiving, and so a reinstall re-enables instead of inserting a second
 * row for the same string.
 */
export async function disableUnregisteredTokens(tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;

  const updated = await db
    .update(pushNotificationTokens)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      and(
        inArray(pushNotificationTokens.token, tokens),
        eq(pushNotificationTokens.enabled, true),
      ),
    )
    .returning({ id: pushNotificationTokens.id });

  if (updated.length > 0) {
    logger.info(
      { count: updated.length },
      "Disabled push tokens rejected as DeviceNotRegistered",
    );
  }
  return updated.length;
}

/**
 * Deletes tokens no client has refreshed for a long time.
 *
 * Registration happens on every cold start, so a token that has not been seen
 * for months belongs to a device that is gone. Without this the table only
 * grows and every send re-walks dead rows.
 */
export async function pruneStalePushTokens(
  olderThanDays = 90,
): Promise<number> {
  const cutoff = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
  );

  const deleted = await db
    .delete(pushNotificationTokens)
    .where(lt(pushNotificationTokens.lastSeenAt, cutoff))
    .returning({ id: pushNotificationTokens.id });

  return deleted.length;
}

// ---------------------------------------------------------------------------
// Enqueueing
// ---------------------------------------------------------------------------

export type EnqueueNotificationInput = {
  workspaceId: string;
  draft: NotificationDraft;
  /** Restricts delivery to one member; omitted means every member. */
  recipientUserId?: string | null;
};

export type EnqueueNotificationResult =
  | { status: "enqueued"; id: string }
  /** An identical alert is already queued or was already sent for this bucket. */
  | { status: "deduplicated" }
  /** Delivery is not configured, so nothing was written. */
  | { status: "not_configured" };

/**
 * Puts one alert on the outbox.
 *
 * Safe to call from inside a request handler: it is a single insert and never
 * performs network I/O. Callers do not need to know whether anybody has
 * registered a device — an alert with no recipients settles as `sent` with
 * `recipient_count = 0`, which is a legitimate outcome rather than an error.
 */
export async function enqueueNotification(
  input: EnqueueNotificationInput,
): Promise<EnqueueNotificationResult> {
  if (!isPushDeliveryConfigured()) return { status: "not_configured" };

  const content = buildNotificationContent(input.draft);
  const now = new Date();
  const id = `push-outbox:${randomUUID()}`;

  const inserted = await db
    .insert(pushNotificationOutbox)
    .values({
      id,
      workspaceId: input.workspaceId,
      eventType: content.eventType,
      recipientUserId: input.recipientUserId ?? null,
      title: content.title,
      body: content.body,
      data: content.data,
      dedupeKey: content.dedupeKey,
      status: "queued",
      attempts: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        pushNotificationOutbox.workspaceId,
        pushNotificationOutbox.eventType,
        pushNotificationOutbox.dedupeKey,
      ],
    })
    .returning({ id: pushNotificationOutbox.id });

  if (inserted.length === 0) return { status: "deduplicated" };
  return { status: "enqueued", id: inserted[0].id };
}

// ---------------------------------------------------------------------------
// Trigger helpers
// ---------------------------------------------------------------------------

/**
 * Enqueues an alert without ever throwing.
 *
 * A notification is advisory. If the outbox insert fails — the database is
 * overloaded, a constraint rejects the row, the connection drops — the
 * merchant's order, reply or publish must still succeed. Every call site below
 * goes through here so that guarantee lives in one place instead of being
 * re-implemented (and eventually forgotten) at four of them.
 *
 * Must be called *outside* any open transaction: it writes through the shared
 * pool, so calling it from inside `db.transaction` would run on a different
 * connection and could deadlock against the row locks the caller holds.
 */
export async function enqueueNotificationSafely(
  input: EnqueueNotificationInput,
  context: string,
): Promise<void> {
  try {
    const result = await enqueueNotification(input);
    if (result.status !== "enqueued") {
      // Deduplicated and not-configured are both expected outcomes, not faults.
      logger.debug(
        { workspaceId: input.workspaceId, status: result.status, context },
        "Push notification not enqueued",
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, workspaceId: input.workspaceId, context },
      "Failed to enqueue a push notification; the operation itself is unaffected",
    );
  }
}

/** A customer sent a message and nobody has answered it yet. */
export async function notifyCustomerMessage(input: {
  workspaceId: string;
  conversationId?: string | null;
  platform?: string | null;
  customerName?: string | null;
  preview?: string | null;
  awaitingReply?: boolean;
}): Promise<void> {
  const { workspaceId, ...draft } = input;
  await enqueueNotificationSafely(
    {
      workspaceId,
      draft: { eventType: "customer_message", at: new Date(), ...draft },
    },
    "customer_message",
  );
}

/** A product failed to publish to a social channel. */
export async function notifyPublishFailure(input: {
  workspaceId: string;
  productName: string;
  reason?: string | null;
  jobId?: string | null;
}): Promise<void> {
  const { workspaceId, ...draft } = input;
  await enqueueNotificationSafely(
    {
      workspaceId,
      draft: { eventType: "publish_failure", at: new Date(), ...draft },
    },
    "publish_failure",
  );
}

/** A customer placed an order. */
export async function notifyNewOrder(input: {
  workspaceId: string;
  orderId: string;
  customerName?: string | null;
  totalLabel?: string | null;
}): Promise<void> {
  const { workspaceId, ...draft } = input;
  await enqueueNotificationSafely(
    {
      workspaceId,
      draft: { eventType: "new_order", at: new Date(), ...draft },
    },
    "new_order",
  );
}

/**
 * The workspace hit a plan limit.
 *
 * `periodKey` is what makes this fire once per billing period instead of once
 * per blocked action: without it a merchant who keeps trying after exhaustion
 * gets an alert for every attempt.
 */
export async function notifyQuotaExhausted(input: {
  workspaceId: string;
  meter: SubscriptionMeterName;
  used: number;
  limit: number;
  periodKey: string;
}): Promise<void> {
  const { workspaceId, ...draft } = input;
  await enqueueNotificationSafely(
    {
      workspaceId,
      draft: { eventType: "quota_exhausted", at: new Date(), ...draft },
    },
    "quota_exhausted",
  );
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

type RecipientToken = {
  token: string;
  platform: string;
};

/**
 * Resolves who should receive an alert, through membership rather than through
 * a workspace column on the token.
 *
 * A merchant in three workspaces holds one token; resolving per membership is
 * what keeps a single device from receiving the same alert three times.
 */
async function resolveRecipients(
  workspaceId: string,
  recipientUserId: string | null,
): Promise<RecipientToken[]> {
  const memberIds = recipientUserId
    ? [recipientUserId]
    : (
        await db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId))
      ).map((row) => row.userId);

  if (memberIds.length === 0) return [];

  const rows = await db
    .select({
      token: pushNotificationTokens.token,
      platform: pushNotificationTokens.platform,
    })
    .from(pushNotificationTokens)
    .where(
      and(
        inArray(pushNotificationTokens.userId, memberIds),
        eq(pushNotificationTokens.enabled, true),
      ),
    );

  // The same token can appear under two user ids if a merchant signed in with
  // two accounts on one device; Expo would then deliver the alert twice.
  const unique = new Map<string, RecipientToken>();
  for (const row of rows) unique.set(row.token, row);
  return [...unique.values()];
}

function retryDelayMs(attempts: number): number {
  // 15s, 30s, 60s, 120s, 240s — capped at five minutes. A customer-message
  // alert is worth retrying quickly, but not worth hammering Expo for.
  return Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

async function settle(
  id: string,
  status: "sent" | "failed" | "unknown",
  options: {
    error?: string | null;
    nextRunAt?: Date;
    recipientCount?: number;
    sentAt?: Date | null;
  } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(pushNotificationOutbox)
    .set({
      status,
      lastError: options.error ?? null,
      nextRunAt: options.nextRunAt ?? now,
      leaseExpiresAt: null,
      ...(options.sentAt ? { sentAt: options.sentAt } : {}),
      ...(typeof options.recipientCount === "number"
        ? { recipientCount: options.recipientCount }
        : {}),
      updatedAt: now,
    })
    .where(eq(pushNotificationOutbox.id, id));
}

async function claimDueNotifications(now: Date) {
  // A lease that expired while the Expo request was in flight cannot be retried:
  // the message may have been accepted. Those rows are parked as `unknown`.
  await db
    .update(pushNotificationOutbox)
    .set({
      status: "unknown",
      lastError: "PUSH_SEND_RESULT_UNKNOWN",
      leaseExpiresAt: null,
      nextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pushNotificationOutbox.status, "sending"),
        lt(pushNotificationOutbox.leaseExpiresAt, now),
      ),
    );

  await db
    .update(pushNotificationOutbox)
    .set({
      status: "failed",
      lastError: "PUSH_RETRY_LIMIT_REACHED",
      leaseExpiresAt: null,
      nextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pushNotificationOutbox.status, "processing"),
        lt(pushNotificationOutbox.leaseExpiresAt, now),
        sql`${pushNotificationOutbox.attempts} >= ${maxAttempts()}`,
      ),
    );

  return db.transaction(async (transaction) => {
    const candidates = await transaction
      .select()
      .from(pushNotificationOutbox)
      .where(
        or(
          and(
            eq(pushNotificationOutbox.status, "queued"),
            lte(pushNotificationOutbox.nextRunAt, now),
          ),
          and(
            eq(pushNotificationOutbox.status, "processing"),
            lt(pushNotificationOutbox.leaseExpiresAt, now),
            sql`${pushNotificationOutbox.attempts} < ${maxAttempts()}`,
          ),
        ),
      )
      .orderBy(asc(pushNotificationOutbox.createdAt))
      .limit(BATCH_LIMIT)
      // Two API replicas run this worker; SKIP LOCKED is what stops them from
      // claiming the same row and sending the same alert twice.
      .for("update", { skipLocked: true });

    if (candidates.length === 0) return [];

    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed: typeof candidates = [];

    for (const candidate of candidates) {
      const [row] = await transaction
        .update(pushNotificationOutbox)
        .set({
          status: "processing",
          attempts: sql`${pushNotificationOutbox.attempts} + 1`,
          leaseExpiresAt,
          nextRunAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(pushNotificationOutbox.id, candidate.id))
        .returning();
      if (row) claimed.push(row);
    }

    return claimed;
  });
}

async function deliverOne(
  row: typeof pushNotificationOutbox.$inferSelect,
): Promise<void> {
  const recipients = await resolveRecipients(
    row.workspaceId,
    row.recipientUserId,
  );

  if (recipients.length === 0) {
    // Nobody has registered a device yet. Not an error, and retrying cannot
    // change it, so the row settles immediately.
    await settle(row.id, "sent", { recipientCount: 0, sentAt: new Date() });
    return;
  }

  // Announce that the side effect is about to happen. From this point an
  // expired lease means `unknown`, not a safe retry.
  await db
    .update(pushNotificationOutbox)
    .set({
      status: "sending",
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      updatedAt: new Date(),
    })
    .where(eq(pushNotificationOutbox.id, row.id));

  const payload = { title: row.title, body: row.body, data: row.data as Record<string, string> };
  const results: SendPushResult[] = [];

  for (const chunk of chunkPushMessages(
    recipients.map((recipient) =>
      toPushMessage(recipient.token, payload, { platform: recipient.platform }),
    ),
  )) {
    results.push(
      await sendPushBatch(chunk, {
        accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN,
      }),
    );
  }

  const notRegistered = results.flatMap((result) => result.deviceNotRegistered);
  await disableUnregisteredTokens(notRegistered);

  const accepted = results.reduce((total, result) => total + result.accepted, 0);
  const retryable = results.flatMap((result) => result.retryable);
  const permanent = results.flatMap((result) => result.permanent);
  const requestError = results.find((result) => result.requestError)?.requestError;
  const lastError =
    requestError ?? results.find((result) => result.lastErrorMessage)?.lastErrorMessage;

  // Settlement rules, in the order they are checked:
  //
  //   accepted > 0            → sent. Partial success is success: the devices
  //                             that got through must not be alerted again just
  //                             because a different token turned out to be dead.
  //   nothing, retryable,     → failed with a scheduled retry. Expo said "later"
  //   attempts left             (429, 5xx, dropped request).
  //   nothing, otherwise      → failed, terminal. Either the retry budget is
  //                             spent or every token was rejected outright.
  if (accepted > 0) {
    await settle(row.id, "sent", {
      error: lastError,
      recipientCount: accepted,
      sentAt: new Date(),
    });
    return;
  }

  if (retryable.length > 0 && row.attempts < maxAttempts()) {
    // Honour Expo's own backoff instruction when it gives one; a 429 answered
    // sooner than Retry-After just earns another 429.
    const retryAfterSeconds = results
      .map((result) => result.retryAfterSeconds)
      .find((seconds): seconds is number => typeof seconds === "number");
    const delayMs = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : retryDelayMs(row.attempts);

    await settle(row.id, "failed", {
      error: lastError ?? "PUSH_DELIVERY_INCOMPLETE",
      nextRunAt: new Date(Date.now() + delayMs),
      recipientCount: 0,
    });
    logger.warn(
      {
        notificationId: row.id,
        eventType: row.eventType,
        attempts: row.attempts,
        retryInMs: delayMs,
        retryable: retryable.length,
        error: lastError,
      },
      "Push notification delivery failed and will be retried",
    );
    return;
  }

  const terminalError =
    lastError ??
    (retryable.length > 0
      ? "PUSH_RETRY_LIMIT_REACHED"
      : "PUSH_NO_DELIVERABLE_RECIPIENT");

  await settle(row.id, "failed", {
    error: terminalError,
    recipientCount: 0,
  });
  logger.warn(
    {
      notificationId: row.id,
      eventType: row.eventType,
      attempts: row.attempts,
      // Distinguishes "Expo would not take it" from "the payload itself was
      // rejected", which need different fixes and look identical otherwise.
      permanent: permanent.length,
      deadTokens: notRegistered.length,
      retryable: retryable.length,
      error: terminalError,
    },
    "Push notification delivery gave up",
  );
}

/**
 * Drains the outbox. Registered as a background worker; safe to call directly
 * from a test or a one-off script.
 */
export async function processPushNotificationQueue(): Promise<number> {
  if (!isPushDeliveryConfigured()) return 0;

  const claimed = await claimDueNotifications(new Date());
  for (const row of claimed) {
    try {
      await deliverOne(row);
    } catch (error) {
      // An unexpected throw is a code or database fault, not an Expo rejection:
      // release the row for another attempt instead of losing the alert.
      await settle(row.id, "failed", {
        error: error instanceof Error ? error.message : "PUSH_DELIVERY_ERROR",
        nextRunAt: new Date(Date.now() + retryDelayMs(row.attempts)),
      }).catch(() => undefined);
      logger.error(
        { err: error, notificationId: row.id, eventType: row.eventType },
        "Push notification delivery threw",
      );
    }
  }
  return claimed.length;
}

/**
 * Deletes settled rows past the retention window.
 *
 * The dedupe constraint is on `(workspace_id, event_type, dedupe_key)`, and
 * keys are time-bucketed, so keeping rows forever would eventually make a
 * reused bucket collide with an old one. Purging is what keeps the constraint
 * meaning "recently sent" rather than "ever sent".
 */
export async function purgeSettledPushNotifications(
  retentionDays = envPositiveInt("PUSH_NOTIFICATION_RETENTION_DAYS", 14),
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(pushNotificationOutbox)
    .where(
      and(
        inArray(pushNotificationOutbox.status, ["sent", "failed", "unknown"]),
        lt(pushNotificationOutbox.createdAt, cutoff),
      ),
    )
    .returning({ id: pushNotificationOutbox.id });

  return deleted.length;
}

export type { NotificationDraft, NotificationEventType };
