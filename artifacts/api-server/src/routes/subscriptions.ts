import { Router } from "express";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { getSubscriptionOverview } from "../lib/subscriptions";

const router = Router();

router.get("/subscription", requireWorkspace, async (req, res, next) => {
  try {
    res.json(await getSubscriptionOverview(requestWorkspaceId(req)));
  } catch (error) {
    next(error);
  }
});

export default router;
