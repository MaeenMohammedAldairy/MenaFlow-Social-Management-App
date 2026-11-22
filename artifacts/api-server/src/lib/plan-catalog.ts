/**
 * The only plan catalog in the server. Limits and prices are policy that ships
 * with the code, so they live here instead of in a table: one import for
 * enforcement, one source for `/api/plans` and for the app's pricing screens.
 */
export type PlanId = "free" | "starter" | "growth";
export type SubscriptionMeter = "aiGenerations" | "postsCreated";
export type SubscriptionChannel = "facebook" | "instagram" | "whatsapp";

export type PlanLimits = {
  postsCreated: number;
  aiGenerations: number;
  channels: number;
};

export type SubscriptionPlan = {
  readonly id: PlanId;
  readonly name: string;
  readonly monthlyPriceUsd: number;
  readonly limits: PlanLimits;
};

export const subscriptionPlans: readonly SubscriptionPlan[] = [
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

export const FREE_PLAN_ID: PlanId = "free";
export const TRIAL_PLAN_ID: PlanId = "growth";
export const TRIAL_DAYS = 7;

const planById = new Map<PlanId, SubscriptionPlan>(
  subscriptionPlans.map((plan) => [plan.id, plan]),
);

export const freePlan = planById.get(FREE_PLAN_ID) as SubscriptionPlan;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && planById.has(value as PlanId);
}

/** Unknown ids fall back to the free plan instead of breaking every request. */
export function planOrFree(planId: string): SubscriptionPlan {
  return planById.get(planId as PlanId) ?? freePlan;
}

export function trialEndsAt(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Prices are always advertised; checkout stays off until a payment provider is
 * wired, so nothing may claim the plans are purchasable yet.
 */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "true";
}
