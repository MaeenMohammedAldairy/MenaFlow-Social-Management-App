import { Router } from "express";
import {
  paymentsEnabled,
  subscriptionPlans,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
} from "../lib/plan-catalog.ts";

const router = Router();

/**
 * Public plan catalog. The mobile app and the landing page both read limits and
 * prices from here so a plan change cannot drift between server and screens.
 */
router.get("/plans", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    plans: subscriptionPlans.map((plan) => ({ ...plan })),
    trial: { planId: TRIAL_PLAN_ID, days: TRIAL_DAYS },
    paymentAvailable: paymentsEnabled(),
  });
});

export default router;
