import { GetOwnerAccessResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireWorkspace, requestWorkspaceContext } from "../lib/workspace-context";

const router: IRouter = Router();

router.get("/auth/access", requireWorkspace, (req, res) => {
  res.json(GetOwnerAccessResponse.parse({ authorized: Boolean(requestWorkspaceContext(req)) }));
});

export default router;
