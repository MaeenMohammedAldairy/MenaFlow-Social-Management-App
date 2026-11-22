import assert from "node:assert/strict";
import test from "node:test";
import {
  marketingPlanLimits,
  marketingPlanPrices,
  marketingPlans,
} from "./pricing.ts";
import { subscriptionPlans } from "../../api-server/src/lib/plan-catalog.ts";

test("landing-page plans match the server catalogue exactly", () => {
  assert.deepEqual(
    marketingPlans.map((plan) => plan.id),
    subscriptionPlans.map((plan) => plan.id),
  );

  for (const serverPlan of subscriptionPlans) {
    const landingPlan = marketingPlans.find((plan) => plan.id === serverPlan.id);
    assert.ok(landingPlan, serverPlan.id);
    assert.equal(landingPlan.name, serverPlan.name, serverPlan.id);
    assert.equal(
      landingPlan.monthlyPriceUsd,
      serverPlan.monthlyPriceUsd,
      serverPlan.id,
    );
    assert.equal(
      marketingPlanPrices[serverPlan.id],
      serverPlan.monthlyPriceUsd,
      serverPlan.id,
    );
    assert.deepEqual(
      marketingPlanLimits[serverPlan.id],
      serverPlan.limits,
      serverPlan.id,
    );
  }
});

test("the shown bullet points are generated from those numbers", () => {
  for (const plan of marketingPlans) {
    const limits = marketingPlanLimits[plan.id];
    assert.equal(plan.limits.length, 3, plan.id);
    assert.match(plan.limits[0], new RegExp(`^${limits.postsCreated}\\b`), plan.id);
    assert.match(plan.limits[1], new RegExp(`^${limits.aiGenerations}\\b`), plan.id);
  }
});
