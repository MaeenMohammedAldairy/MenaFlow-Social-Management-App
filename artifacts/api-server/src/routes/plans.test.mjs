import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import plansRouter from "./plans.ts";
import {
  FREE_PLAN_ID,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
  subscriptionPlans,
} from "../lib/plan-catalog.ts";

async function withPlansServer(run) {
  const app = express();
  app.use("/api", plansRouter);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}/api/plans`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("serves the catalogue the app must read its limits from", async () => {
  await withPlansServer(async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=300",
    );

    const body = await response.json();
    assert.deepEqual(
      body.plans.map((plan) => plan.id),
      subscriptionPlans.map((plan) => plan.id),
    );
    assert.equal(body.plans[0].id, FREE_PLAN_ID);
    assert.deepEqual(body.trial, { planId: TRIAL_PLAN_ID, days: TRIAL_DAYS });

    for (const plan of body.plans) {
      const source = subscriptionPlans.find((item) => item.id === plan.id);
      assert.deepEqual(plan.limits, source.limits, plan.id);
      assert.equal(plan.monthlyPriceUsd, source.monthlyPriceUsd, plan.id);
    }
  });
});

test("payment availability follows the deployment flag", async () => {
  const previous = process.env.PAYMENTS_ENABLED;

  try {
    delete process.env.PAYMENTS_ENABLED;
    await withPlansServer(async (url) => {
      const body = await (await fetch(url)).json();
      assert.equal(body.paymentAvailable, false);
    });

    process.env.PAYMENTS_ENABLED = "true";
    await withPlansServer(async (url) => {
      const body = await (await fetch(url)).json();
      assert.equal(body.paymentAvailable, true);
    });
  } finally {
    if (previous === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = previous;
  }
});

test("the plan catalogue is public: no workspace header is required", async () => {
  await withPlansServer(async (url) => {
    const response = await fetch(url, { headers: {} });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Object.keys(body).sort().join(","), "paymentAvailable,plans,trial");
  });
});
