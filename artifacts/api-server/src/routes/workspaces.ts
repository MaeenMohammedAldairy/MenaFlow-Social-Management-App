import { Router } from "express";
import { requireWorkspace, requestWorkspaceContext } from "../lib/workspace-context";

const router = Router();

router.get("/workspaces/current", requireWorkspace, (req, res) => {
  const context = requestWorkspaceContext(req);
  if (!context) {
    res.status(500).json({ error: "تعذر تحديد مساحة العمل." });
    return;
  }

  res.json({
    id: context.workspaceId,
    name: context.workspaceName,
    role: context.role,
  });
});

export default router;
