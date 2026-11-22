import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarPeriodBounds,
  calendarPeriodKey,
  resolveEntitlements,
} from "./entitlements.ts";
import {
  FREE_PLAN_ID,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
  planOrFree,
  subscriptionPlans,
  trialEndsAt,
} from "./plan-catalog.ts";

const now = new Date("2026-11-22T10:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

function state(overrides = {}) {
  return {
    planId: "starter",
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

test("an active trial grants the trial plan limits, not the stored plan", () => {
  const entitlements = resolveEntitlements(
    state({
      planId: "free",
      status: "trialing",
      trialEndsAt: new Date(now.getTime() + 2 * dayMs),
    }),
    now,
  );

  assert.equal(entitlements.source, "trial");
  assert.equal(entitlements.plan.id, TRIAL_PLAN_ID);
  assert.deepEqual(entitlements.plan.limits, {
    postsCreated: 500,
    aiGenerations: 500,
    channels: 3,
  });
});

test("an expired trial falls back to the free plan without changing the row", () => {
  const entitlements = resolveEntitlements(
    state({
      planId: "growth",
      status: "trialing",
      trialEndsAt: new Date(now.getTime() - dayMs),
    }),
    now,
  );

  assert.equal(entitlements.source, "free");
  assert.equal(entitlements.plan.id, FREE_PLAN_ID);
  assert.equal(entitlements.plan.limits.aiGenerations, 10);
});

test("a paid plan uses its own limits", () => {
  const entitlements = resolveEntitlements(state({ planId: "growth" }), now);

  assert.equal(entitlements.source, "plan");
  assert.equal(entitlements.plan.id, "growth");
  assert.equal(entitlements.plan.limits.aiGenerations, 500);
});

test("a paid plan with a billing period uses a billing period key", () => {
  const periodStart = new Date("2026-11-20T00:00:00.000Z");
  const periodEnd = new Date("2026-12-20T00:00:00.000Z");
  const entitlements = resolveEntitlements(
    state({
      planId: "starter",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    }),
    now,
  );

  assert.equal(entitlements.periodKey, "billing:2026-11-20");
  assert.equal(entitlements.periodStart?.toISOString(), periodStart.toISOString());
  assert.equal(entitlements.periodEnd?.toISOString(), periodEnd.toISOString());
});

test("past due and canceled fall back to free limits", () => {
  for (const status of ["past_due", "canceled", "trialing"]) {
    const entitlements = resolveEntitlements(
      state({ planId: "growth", status, trialEndsAt: null }),
      now,
    );
    assert.equal(entitlements.plan.id, FREE_PLAN_ID, status);
    assert.equal(entitlements.source, "free", status);
  }
});

test("an unknown plan id degrades to free instead of throwing", () => {
  const entitlements = resolveEntitlements(
    state({ planId: "enterprise-typo" }),
    now,
  );

  assert.equal(entitlements.plan.id, FREE_PLAN_ID);
});

test("the free month window is the UTC calendar month", () => {
  assert.equal(calendarPeriodKey(now), "2026-11");

  const lastMoment = new Date("2026-11-30T23:59:59.999Z");
  assert.equal(calendarPeriodKey(lastMoment), "2026-11");
  assert.equal(calendarPeriodKey(new Date("2026-12-01T00:00:00.000Z")), "2026-12");

  const bounds = calendarPeriodBounds(now);
  assert.equal(bounds.start.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("the catalog is the single definition the rest of the system consumes", () => {
  assert.deepEqual(
    subscriptionPlans.map((plan) => plan.id),
    ["free", "starter", "growth"],
  );
  assert.equal(planOrFree("nope").id, FREE_PLAN_ID);
  assert.equal(TRIAL_DAYS, 7);
  assert.equal(
    trialEndsAt(now).getTime() - now.getTime(),
    TRIAL_DAYS * dayMs,
  );
  for (const plan of subscriptionPlans) {
    assert.ok(plan.limits.channels >= 1, plan.id);
    assert.ok(plan.limits.postsCreated > 0, plan.id);
    assert.ok(plan.limits.aiGenerations > 0, plan.id);
  }
});
