import {
  FREE_PLAN_ID,
  planOrFree,
  TRIAL_PLAN_ID,
  type SubscriptionPlan,
} from "./plan-catalog.ts";

export type SubscriptionStatus = "trialing" | "active" | "canceled" | "past_due";

/** Only the fields the rules need, so this module stays free of database imports. */
export type SubscriptionRow = {
  planId: string;
  status: SubscriptionStatus | string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

export type SubscriptionState = {
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

export type EntitlementSource = "trial" | "plan" | "free";

export type Entitlements = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** Where the limits came from: an active trial, a paid plan, or the fallback. */
  source: EntitlementSource;
  trialEndsAt: Date | null;
  /** Key of the row in `mena_workspace_subscription_usage`. */
  periodKey: string;
  periodStart: Date | null;
  periodEnd: Date | null;
};

/**
 * Quota period for workspaces without a billing period: the UTC calendar month.
 * Everything that needs a period key goes through here so the app, the workers
 * and the owner console cannot drift apart.
 */
export function calendarPeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calendarPeriodBounds(now: Date): {
  start: Date;
  end: Date;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { start, end };
}

function billingPeriodKey(periodStart: Date): string {
  return `billing:${periodStart.toISOString().slice(0, 10)}`;
}

/**
 * A trial whose end date has passed is over, even if nobody wrote that down.
 * The store uses this to persist the transition once, instead of leaving a row
 * that says `trialing` forever while the resolver silently serves free limits.
 */
export function trialHasExpired(
  state: Pick<SubscriptionState, "status" | "trialEndsAt">,
  now: Date,
): boolean {
  return (
    state.status === "trialing" &&
    Boolean(state.trialEndsAt) &&
    (state.trialEndsAt as Date).getTime() <= now.getTime()
  );
}

/**
 * Pure resolution of "what may this workspace do right now". No database access,
 * so every state can be exercised directly in a unit test.
 */
export function resolveEntitlements(
  state: SubscriptionState,
  now: Date,
): Entitlements {
  const trialActive = Boolean(state.trialEndsAt && state.trialEndsAt > now);

  if (state.status === "trialing" && trialActive) {
    const bounds = calendarPeriodBounds(now);
    return {
      plan: planOrFree(TRIAL_PLAN_ID),
      status: state.status,
      source: "trial",
      trialEndsAt: state.trialEndsAt,
      periodKey: calendarPeriodKey(now),
      periodStart: bounds.start,
      periodEnd: bounds.end,
    };
  }

  if (state.status === "active") {
    if (state.currentPeriodStart) {
      return {
        plan: planOrFree(state.planId),
        status: state.status,
        source: "plan",
        trialEndsAt: state.trialEndsAt,
        periodKey: billingPeriodKey(state.currentPeriodStart),
        periodStart: state.currentPeriodStart,
        periodEnd: state.currentPeriodEnd,
      };
    }
    const bounds = calendarPeriodBounds(now);
    return {
      plan: planOrFree(state.planId),
      status: state.status,
      source: "plan",
      trialEndsAt: state.trialEndsAt,
      periodKey: calendarPeriodKey(now),
      periodStart: bounds.start,
      periodEnd: bounds.end,
    };
  }

  // Expired trial, past due, canceled or unknown: free limits on the calendar month.
  const bounds = calendarPeriodBounds(now);
  return {
    plan: planOrFree(FREE_PLAN_ID),
    status: state.status,
    source: "free",
    trialEndsAt: state.trialEndsAt,
    periodKey: calendarPeriodKey(now),
    periodStart: bounds.start,
    periodEnd: bounds.end,
  };
}

export function entitlementsForRow(
  row: SubscriptionRow,
  now: Date,
): Entitlements {
  return resolveEntitlements(
    {
      planId: row.planId,
      status: row.status as SubscriptionStatus,
      trialEndsAt: row.trialEndsAt,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
    },
    now,
  );
}
