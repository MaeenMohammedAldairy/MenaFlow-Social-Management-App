import { and, eq, gt, lt, sql } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaWhatsAppConnections,
  workspaceSubscriptionUsage,
  workspaceSubscriptions,
} from "@workspace/db";
import {
  planOrFree,
  paymentsEnabled,
  subscriptionPlans,
  type SubscriptionChannel,
  type SubscriptionMeter,
} from "./plan-catalog.ts";
import {
  entitlementsForRow,
  resolveEntitlements,
  type SubscriptionStatus,
} from "./entitlements.ts";
import { ensureSubscription } from "./entitlement-store.ts";
import { notifyQuotaExhausted } from "./push-notifications";

export {
  subscriptionPlans,
  type SubscriptionChannel,
  type SubscriptionMeter,
} from "./plan-catalog.ts";
export type { SubscriptionStatus } from "./entitlements.ts";

async function channelUsage(workspaceId: string) {
  const [meta] = await db
    .select({
      pageId: menaMetaConnections.pageId,
      instagramUserId: menaMetaConnections.instagramUserId,
    })
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  const [whatsapp] = await db
    .select({ workspaceId: menaWhatsAppConnections.workspaceId })
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);
  return {
    facebook: Boolean(meta?.pageId),
    instagram: Boolean(meta?.instagramUserId),
    whatsapp: Boolean(whatsapp),
  };
}

export async function getSubscriptionOverview(workspaceId: string) {
  const now = new Date();
  const subscription = await ensureSubscription(workspaceId);
  const entitlements = entitlementsForRow(subscription, now);
  const plan = entitlements.plan;
  const planId = plan.id;
  const periodKey = entitlements.periodKey;
  const [usage] = await db
    .select()
    .from(workspaceSubscriptionUsage)
    .where(
      and(
        eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
        eq(workspaceSubscriptionUsage.periodKey, periodKey),
      ),
    )
    .limit(1);
  const channels = await channelUsage(workspaceId);

  return {
    planId,
    planName: plan.name,
    status:
      subscription.status === "trialing" && planId === "free"
        ? "free"
        : subscription.status,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    paymentAvailable: paymentsEnabled(),
    source: entitlements.source,
    periodKey,
    periodStart: entitlements.periodStart?.toISOString() ?? null,
    periodEnd: entitlements.periodEnd?.toISOString() ?? null,
    usage: {
      postsCreated: usage?.postsCreated ?? 0,
      aiGenerations: usage?.aiGenerations ?? 0,
      channels: Object.values(channels).filter(Boolean).length,
    },
    plans: subscriptionPlans,
  };
}

export async function consumeSubscriptionUsage(
  workspaceId: string,
  meter: SubscriptionMeter,
): Promise<{ allowed: boolean; used: number; limit: number; periodKey: string }> {
  const now = new Date();
  // A missing row is a self-healing condition, not a 500 for the merchant.
  await ensureSubscription(workspaceId);

  const outcome = await db.transaction(async (transaction) => {
    const [subscription] = await transaction
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .for("update")
      .limit(1);
    if (!subscription) throw new Error("WORKSPACE_SUBSCRIPTION_MISSING");

    const entitlements = resolveEntitlements(
      {
        planId: subscription.planId,
        status: subscription.status as SubscriptionStatus,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      now,
    );
    const periodKey = entitlements.periodKey;
    const limit = entitlements.plan.limits[meter];

    await transaction
      .insert(workspaceSubscriptionUsage)
      .values({ workspaceId, periodKey })
      .onConflictDoNothing();

    const [usage] =
      meter === "aiGenerations"
        ? await transaction
            .update(workspaceSubscriptionUsage)
            .set({
              aiGenerations: sql`${workspaceSubscriptionUsage.aiGenerations} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
                eq(workspaceSubscriptionUsage.periodKey, periodKey),
                lt(workspaceSubscriptionUsage.aiGenerations, limit),
              ),
            )
            .returning({ used: workspaceSubscriptionUsage.aiGenerations })
        : await transaction
            .update(workspaceSubscriptionUsage)
            .set({
              postsCreated: sql`${workspaceSubscriptionUsage.postsCreated} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
                eq(workspaceSubscriptionUsage.periodKey, periodKey),
                lt(workspaceSubscriptionUsage.postsCreated, limit),
              ),
            )
            .returning({ used: workspaceSubscriptionUsage.postsCreated });

    if (!usage) {
      const [current] = await transaction
        .select({
          aiGenerations: workspaceSubscriptionUsage.aiGenerations,
          postsCreated: workspaceSubscriptionUsage.postsCreated,
        })
        .from(workspaceSubscriptionUsage)
        .where(
          and(
            eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
            eq(workspaceSubscriptionUsage.periodKey, periodKey),
          ),
        )
        .limit(1);
      return {
        allowed: false,
        used: current?.[meter] ?? 0,
        limit,
        periodKey,
      };
    }

    return { allowed: true, used: usage.used, limit, periodKey };
  });

  if (!outcome.allowed) {
    // Enqueued after the transaction commits, not inside it: the insert goes
    // through the shared pool, so running it here would write on a different
    // connection while this one still holds the subscription row lock.
    //
    // `notifyQuotaExhausted` never throws, so a failed alert cannot turn a
    // quota denial into a 500 for the merchant.
    await notifyQuotaExhausted({
      workspaceId,
      meter,
      used: outcome.used,
      limit: outcome.limit,
      periodKey: outcome.periodKey,
    });
  }

  return outcome;
}

export async function releaseSubscriptionUsage(
  workspaceId: string,
  meter: SubscriptionMeter,
  periodKey: string,
): Promise<void> {
  const now = new Date();
  if (meter === "aiGenerations") {
    await db
      .update(workspaceSubscriptionUsage)
      .set({
        aiGenerations: sql`greatest(${workspaceSubscriptionUsage.aiGenerations} - 1, 0)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
          eq(workspaceSubscriptionUsage.periodKey, periodKey),
          gt(workspaceSubscriptionUsage.aiGenerations, 0),
        ),
      );
    return;
  }
  await db
    .update(workspaceSubscriptionUsage)
    .set({
      postsCreated: sql`greatest(${workspaceSubscriptionUsage.postsCreated} - 1, 0)`,
      updatedAt: now,
    })
    .where(
      and(
        eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
        eq(workspaceSubscriptionUsage.periodKey, periodKey),
        gt(workspaceSubscriptionUsage.postsCreated, 0),
      ),
    );
}

export async function canConnectChannel(
  workspaceId: string,
  channel: SubscriptionChannel,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const subscription = await ensureSubscription(workspaceId);
  const plan = planOrFree(entitlementsForRow(subscription, new Date()).plan.id);

  const channels = await channelUsage(workspaceId);
  if (channels[channel]) {
    return {
      allowed: true,
      used: Object.values(channels).filter(Boolean).length,
      limit: plan.limits.channels,
    };
  }

  const used = Object.values(channels).filter(Boolean).length;
  return {
    allowed: used < plan.limits.channels,
    used,
    limit: plan.limits.channels,
  };
}

export async function canConnectMetaAccounts(
  workspaceId: string,
  includesInstagram: boolean,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const subscription = await ensureSubscription(workspaceId);
  const plan = planOrFree(entitlementsForRow(subscription, new Date()).plan.id);

  const channels = await channelUsage(workspaceId);
  const used = Number(channels.whatsapp) + 1 + Number(includesInstagram);
  return {
    allowed: used <= plan.limits.channels,
    used,
    limit: plan.limits.channels,
  };
}
