import { GetOwnerAccessResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getWorkspaceOnboardingStatus } from "../lib/onboarding-status";
import {
  requireWorkspace,
  requestWorkspaceContext,
  requestWorkspaceId,
  requestWorkspaceUserId,
} from "../lib/workspace-context";

const router: IRouter = Router();

router.get("/auth/access", requireWorkspace, async (req, res, next) => {
  try {
    const onboarding = await getWorkspaceOnboardingStatus(
      requestWorkspaceId(req),
      requestWorkspaceUserId(req),
    );
    res.json(
      GetOwnerAccessResponse.parse({
        authorized: Boolean(requestWorkspaceContext(req)),
        onboarding,
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
