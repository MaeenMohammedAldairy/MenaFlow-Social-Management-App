import { eq } from "drizzle-orm";
import { db, workspaceSubscriptions } from "@workspace/db";
import { logger } from "./logger";
import { FREE_PLAN_ID } from "./plan-catalog.ts";
import { entitlementsForRow, type Entitlements } from "./entitlements.ts";

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
 * A workspace without a subscription row used to fail every AI call with a 500.
 * Create the free row instead and leave a trace.
 */
export async function ensureSubscription(
  workspaceId: string,
): Promise<SubscriptionRow> {
  const existing = await findSubscription(workspaceId);
  if (existing) return existing;

  const now = new Date();
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


