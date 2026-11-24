/**
 * inbound-delivery-log.ts
 *
 * Persists each inbound webhook decision so the app can answer "did the
 * provider call us?" after the log window has rolled over.
 *
 * The rule that matters: a failure to record must never turn a successful
 * webhook into a failed one. The provider retries when we answer 4xx/5xx, and
 * losing the diagnostics row is always preferable to losing the message — so
 * every write is best-effort, warn-logged, and swallowed.
 *
 * Identifiers only. Message text never enters this table: customer content is
 * encrypted at rest for WhatsApp and a diagnostics row would outlive it.
 */

import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { db, menaInboundWebhookEvents } from "@workspace/db";
import {
  clampInboundWebhookEventQueryLimit,
  resolveInboundWebhookEventRetentionMs,
} from "./inbound-delivery-log-policy.ts";
import { logger } from "./logger.ts";

function newEventId(): string {
  return `iwe_${crypto.randomUUID().replace(/-/g, "")}`;
}

function toText(value: unknown, max = 200): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export type InboundDeliveryPlatform = "whatsapp" | "facebook" | "instagram";

export type InboundDeliveryAttempt = {
  /** Null when the attempt was refused before the platform could be read. */
  platform: InboundDeliveryPlatform | null;
  /** Stable outcome name, e.g. `WHATSAPP_WEBHOOK_REJECTED_SECRET`. */
  event: string;
  /** True when the outcome proves the provider reached this server. */
  deliveryConfirmed?: boolean;
  workspaceId?: string | null;
  instanceName?: string | null;
  accountId?: string | null;
  /** Identifiers only — never message text. */
  context?: Record<string, unknown> | null;
};

/**
 * Records one attempt. Never throws: a broken log must not break inbound
 * delivery.
 */
export async function recordInboundWebhookAttempt(
  attempt: InboundDeliveryAttempt,
): Promise<void> {
  try {
    const event = toText(attempt.event, 120);
    // Nothing to key the row on: recording an unnamed outcome would add a row
    // no reader can interpret.
    if (!event) return;
    await db
      .insert(menaInboundWebhookEvents)
      .values({
        id: newEventId(),
        workspaceId: toText(attempt.workspaceId, 64),
        platform: attempt.platform ?? null,
        event,
        deliveryConfirmed: attempt.deliveryConfirmed ?? true,
        instanceName: toText(attempt.instanceName, 200),
        accountId: toText(attempt.accountId, 200),
        context: attempt.context ?? {},
      })
      .onConflictDoNothing();
  } catch (error) {
    logger.warn(
      { error, event: attempt.event, platform: attempt.platform },
      "INBOUND_WEBHOOK_EVENT_NOT_RECORDED",
    );
  }
}

/**
 * Deletes attempts older than the retention window. Returns the count deleted
 * so the caller can log it, or -1 when the purge failed — a failed purge must
 * not be reported as "nothing to do".
 */
export async function purgeOldInboundWebhookEvents(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - resolveInboundWebhookEventRetentionMs(),
  ).toISOString();
  try {
    const rows = await db
      .delete(menaInboundWebhookEvents)
      .where(lt(menaInboundWebhookEvents.createdAt, new Date(cutoff)))
      .returning({ id: menaInboundWebhookEvents.id });
    return rows.length;
  } catch (error) {
    logger.warn({ error, cutoff }, "INBOUND_WEBHOOK_EVENT_PURGE_FAILED");
    return -1;
  }
}

export type RecordedInboundAttempt = {
  event: string;
  deliveryConfirmed: boolean;
  createdAt: Date | null;
};

/**
 * Reads the most recent attempts for a workspace. Rows that could not be
 * attributed (a rejected secret) are included by matching the identifiers the
 * merchant does have — the Evolution instance name, or the Meta account id —
 * because those are exactly the attempts that explain a refusal.
 *
 * `includeUnattributed` additionally returns server-wide rows that carry
 * neither a workspace nor a platform: a Meta call refused before its object
 * type was read. Those rows describe the deployment, not one merchant, and the
 * Meta settings response already reports the same facts directly
 * (`appSecretConfigured`, `verifyTokenConfigured`), so showing them adds the
 * timeline without adding reach into another workspace's data.
 */
export async function fetchInboundWebhookAttempts(
  query: {
    workspaceId: string;
    /** Restrict to these platforms; omitted reads every platform. */
    platforms?: readonly InboundDeliveryPlatform[];
    instanceNames?: readonly string[];
    accountIds?: readonly string[];
    /** Also return rows with no workspace and no platform (server-wide refusals). */
    includeUnattributed?: boolean;
    limit?: number;
  },
  now: Date = new Date(),
): Promise<RecordedInboundAttempt[]> {
  const limit = clampInboundWebhookEventQueryLimit(query.limit);
  const since = new Date(
    now.getTime() - resolveInboundWebhookEventRetentionMs(),
  ).toISOString();
  const instanceNames = [...new Set(query.instanceNames ?? [])]
    .map((name) => toText(name, 200))
    .filter((name): name is string => Boolean(name))
    .slice(0, 25);
  const accountIds = [...new Set(query.accountIds ?? [])]
    .map((id) => toText(id, 200))
    .filter((id): id is string => Boolean(id))
    .slice(0, 25);

  const platforms = [...new Set(query.platforms ?? [])];
  const attribution = [
    eq(menaInboundWebhookEvents.workspaceId, query.workspaceId),
    ...(instanceNames.length > 0
      ? [inArray(menaInboundWebhookEvents.instanceName, instanceNames)]
      : []),
    ...(accountIds.length > 0
      ? [inArray(menaInboundWebhookEvents.accountId, accountIds)]
      : []),
  ];

  try {
    const rows = await db
      .select({
        event: menaInboundWebhookEvents.event,
        deliveryConfirmed: menaInboundWebhookEvents.deliveryConfirmed,
        createdAt: menaInboundWebhookEvents.createdAt,
      })
      .from(menaInboundWebhookEvents)
      .where(
        and(
          gte(menaInboundWebhookEvents.createdAt, new Date(since)),
          platforms.length > 0
            ? query.includeUnattributed
              ? or(
                  inArray(menaInboundWebhookEvents.platform, platforms),
                  and(
                    isNull(menaInboundWebhookEvents.platform),
                    isNull(menaInboundWebhookEvents.workspaceId),
                  ),
                )
              : inArray(menaInboundWebhookEvents.platform, platforms)
            : undefined,
          or(...attribution),
        ),
      )
      .orderBy(desc(menaInboundWebhookEvents.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      event: row.event,
      deliveryConfirmed: row.deliveryConfirmed,
      createdAt: row.createdAt ?? null,
    }));
  } catch (error) {
    // A missing table (migration not yet applied) must not break the settings
    // screen; the caller reports the rest of the diagnostics.
    logger.warn(
      { error, workspaceId: query.workspaceId },
      "INBOUND_WEBHOOK_EVENT_QUERY_FAILED",
    );
    return [];
  }
}
