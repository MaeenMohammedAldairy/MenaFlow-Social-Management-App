import { getAuth } from "@clerk/express";
import { GetOwnerAccessResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { isOwnerRequest } from "../lib/owner-access";

const router: IRouter = Router();

router.get("/auth/access", (req, res) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  if (!process.env.MENA_OWNER_EMAIL?.trim()) {
    res.status(503).json({ error: "إعداد صلاحية المالك غير مكتمل." });
    return;
  }
  res.json(GetOwnerAccessResponse.parse({ authorized: isOwnerRequest(req) }));
});

export default router;
