import assert from "node:assert/strict";
import test from "node:test";
import { marketingPlans } from "./pricing.ts";

test("landing plans mirror the API subscription plans", () => {
  assert.deepEqual(
    marketingPlans.map((plan) => [plan.id, plan.monthlyPriceUsd]),
    [
      ["free", 0],
      ["starter", 9],
      ["growth", 29],
    ],
  );
  marketingPlans.forEach((plan) => {
    assert.ok(plan.name.length > 0);
    assert.ok(plan.limits.length >= 3);
  });
});
