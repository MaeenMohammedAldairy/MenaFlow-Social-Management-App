import { and, eq, gt, lt, sql } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaWhatsAppConnections,
  workspaceSubscriptionUsage,
  workspaceSubscriptions,
} from "@workspace/db";

export type SubscriptionMeter = "aiGenerations" | "postsCreated";
export type SubscriptionChannel = "facebook" | "instagram" | "whatsapp";

export const subscriptionPlans = [
  {
    id: "free",
    name: "مجاني",
    monthlyPriceUsd: 0,
    limits: { postsCreated: 10, aiGenerations: 10, channels: 2 },
  },
  {
    id: "starter",
    name: "بداية",
    monthlyPriceUsd: 9,
    limits: { postsCreated: 100, aiGenerations: 100, channels: 3 },
  },
  {
    id: "growth",
    name: "نمو",
    monthlyPriceUsd: 29,
    limits: { postsCreated: 500, aiGenerations: 500, channels: 3 },
  },
] as const;

const planById = new Map(subscriptionPlans.map((plan) => [plan.id, plan]));

function currentPeriodKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function effectivePlanId(
  subscription: typeof workspaceSubscriptions.$inferSelect,
  now: Date,
): (typeof subscriptionPlans)[number]["id"] {
  if (subscription.status === "trialing") {
    return subscription.trialEndsAt && subscription.trialEndsAt > now
      ? "growth"
      : "free";
  }
  return subscription.status === "active" ? subscription.planId : "free";
}

async function subscriptionForWorkspace(workspaceId: string) {
  const [subscription] = await db
    .select()
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1);
  if (!subscription) {
    throw new Error("WORKSPACE_SUBSCRIPTION_MISSING");
  }
  return subscription;
}

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
  const subscription = await subscriptionForWorkspace(workspaceId);
  const planId = effectivePlanId(subscription, now);
  const plan = planById.get(planId);
  if (!plan) throw new Error("WORKSPACE_SUBSCRIPTION_PLAN_INVALID");

  const periodKey = currentPeriodKey(now);
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
    paymentAvailable: false,
    periodKey,
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
  const periodKey = currentPeriodKey(now);

  return db.transaction(async (transaction) => {
    const [subscription] = await transaction
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .for("update")
      .limit(1);
    if (!subscription) throw new Error("WORKSPACE_SUBSCRIPTION_MISSING");

    const planId = effectivePlanId(subscription, now);
    const plan = planById.get(planId);
    if (!plan) throw new Error("WORKSPACE_SUBSCRIPTION_PLAN_INVALID");
    const limit = plan.limits[meter];

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
  const subscription = await subscriptionForWorkspace(workspaceId);
  const planId = effectivePlanId(subscription, new Date());
  const plan = planById.get(planId);
  if (!plan) throw new Error("WORKSPACE_SUBSCRIPTION_PLAN_INVALID");

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
  const subscription = await subscriptionForWorkspace(workspaceId);
  const planId = effectivePlanId(subscription, new Date());
  const plan = planById.get(planId);
  if (!plan) throw new Error("WORKSPACE_SUBSCRIPTION_PLAN_INVALID");

  const channels = await channelUsage(workspaceId);
  const used = Number(channels.whatsapp) + 1 + Number(includesInstagram);
  return {
    allowed: used <= plan.limits.channels,
    used,
    limit: plan.limits.channels,
  };
}
