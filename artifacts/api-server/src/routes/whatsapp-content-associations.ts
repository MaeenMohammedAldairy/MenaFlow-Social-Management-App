import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import {
  decideWhatsAppContentAssociation,
  WhatsAppContentAssociationError,
} from "../lib/whatsapp-content-associations";
import { requireWorkspace, requestWorkspaceId, requestWorkspaceUserId } from "../lib/workspace-context";

const router: IRouter = Router();

router.post(
  "/social/whatsapp/content-associations",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      res.status(400).json({ error: "بيانات قرار ارتباط الرسائل غير صالحة." });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const firstMessageId =
      typeof body?.firstMessageId === "string"
        ? body.firstMessageId.trim()
        : "";
    const secondMessageId =
      typeof body?.secondMessageId === "string"
        ? body.secondMessageId.trim()
        : "";
    const decision = body?.decision;
    if (
      !firstMessageId ||
      !secondMessageId ||
      firstMessageId === secondMessageId ||
      (decision !== "accepted" && decision !== "rejected")
    ) {
      res.status(400).json({ error: "بيانات قرار ارتباط الرسائل غير صالحة." });
      return;
    }

    try {
      const result = await decideWhatsAppContentAssociation({
        decidedBy: requestWorkspaceUserId(req),
        workspaceId: requestWorkspaceId(req),
        firstMessageId,
        secondMessageId,
        decision,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof WhatsAppContentAssociationError) {
        const status = error.code === "MESSAGE_SCOPE_MISMATCH" ? 404 : 409;
        res.status(status).json({
          error:
            error.code === "GROUP_NOT_SELECTED"
              ? "لا يمكن ربط رسائل من مجموعة غير محددة."
              : error.code === "MESSAGE_NOT_AVAILABLE"
                ? "إحدى الرسالتين لم تعد متاحة."
                : error.code === "ASSOCIATION_DECISION_CONFLICT"
                  ? "سبق حفظ قرار مختلف لهذا الاقتراح."
                  : "الرسائل لا تنتمي إلى المجموعة ومساحة العمل نفسيهما.",
          code: error.code,
        });
        return;
      }
      console.error("Failed to save WhatsApp content association decision:", error);
      res.status(500).json({ error: "تعذّر حفظ قرار ارتباط الرسائل." });
    }
  },
);

export default router;
