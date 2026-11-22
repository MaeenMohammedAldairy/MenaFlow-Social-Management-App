import { and, eq } from "drizzle-orm";
import { db, workspaceSubscriptions } from "@workspace/db";
import { logger } from "./logger";
import { FREE_PLAN_ID } from "./plan-catalog.ts";
import {
  entitlementsForRow,
  trialHasExpired,
  type Entitlements,
} from "./entitlements.ts";

type SubscriptionRow = typeof workspaceSubscriptions.$inferSelect;

export async function findSubscription(
  workspaceId: string,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/**
 * An ended trial used to stay `trialing` in the database forever while the
 * resolver served free limits, so the owner console and every report disagreed
 * with the app. Persist the transition once, guarded by the old status.
 */
async function expireTrialIfNeeded(
  row: SubscriptionRow,
  now: Date,
): Promise<SubscriptionRow | null> {
  if (!trialHasExpired(row, now)) return null;

  const [updated] = await db
    .update(workspaceSubscriptions)
    .set({ status: "canceled", updatedAt: now })
    .where(
      and(
        eq(workspaceSubscriptions.workspaceId, row.workspaceId),
        eq(workspaceSubscriptions.status, "trialing"),
      ),
    )
    .returning();
  if (!updated) return null;

  logger.info(
    { workspaceId: row.workspaceId, event: "subscription.trial_expired" },
    "Trial ended; workspace continues on the free plan",
  );
  return updated;
}

/**
 * A workspace without a subscription row used to fail every AI call with a 500.
 * Create the free row instead and leave a trace.
 */
export async function ensureSubscription(
  workspaceId: string,
  now: Date = new Date(),
): Promise<SubscriptionRow> {
  const existing = await findSubscription(workspaceId);
  if (existing) {
    const expired = await expireTrialIfNeeded(existing, now);
    return expired ?? existing;
  }

  await db
    .insert(workspaceSubscriptions)
    .values({
      id: `subscription:${workspaceId}`,
      workspaceId,
      planId: FREE_PLAN_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  logger.warn(
    { workspaceId, event: "subscription.self_healed" },
    "Created a missing free subscription for an existing workspace",
  );
  const created = await findSubscription(workspaceId);
  if (!created) {
    throw new Error("WORKSPACE_SUBSCRIPTION_MISSING");
  }
  return created;
}

export async function loadEntitlements(
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ entitlements: Entitlements; subscription: SubscriptionRow }> {
  const subscription = await ensureSubscription(workspaceId);
  return { entitlements: entitlementsForRow(subscription, now), subscription };
}


