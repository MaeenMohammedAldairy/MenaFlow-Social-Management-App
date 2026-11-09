import { and, eq } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { DeletePostParams } from "@workspace/api-zod";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

import { processWhatsAppMessage } from "../lib/whatsapp-marketing";
import { notifyPostsChanged } from "../lib/post-events";

const router: IRouter = Router();
import { sendPostQuotaError, responseForRow } from "./posts-domain";

router.post("/posts/from-message", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const messageId =
    typeof req.body?.messageId === "string" ? req.body.messageId.trim() : null;
  if (!messageId) {
    res.status(400).json({ error: "معرّف الرسالة غير موجود." });
    return;
  }

  try {
    const processed = await processWhatsAppMessage(workspaceId, messageId, {
      allowAutoPublish: false,
      manualReview: true,
    });
    if (!processed.postId) {
      res.status(422).json({
        error: processed.reason ?? "الرسالة غير مؤهلة للتحويل إلى منشور.",
      });
      return;
    }
    const [post] = await db
      .select()
      .from(posts)
      .where(
        and(eq(posts.id, processed.postId), eq(posts.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!post) throw new Error("CREATED_POST_NOT_FOUND");
    res
      .status(processed.outcome === "created" ? 201 : 200)
      .json(
        await responseForRow(
          post,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      );
  } catch (error) {
    if (sendPostQuotaError(res, error)) return;
    console.error("Error creating post from WhatsApp message:", error);
    res.status(500).json({ error: "تعذر إنشاء المنشور من الرسالة المختارة." });
  }
});

router.delete("/posts/:id", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const paramResult = DeletePostParams.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: "معرّف المنشور غير صالح." });
    return;
  }

  const postId = paramResult.data.id;

  try {
    const deleted = await db
      .delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .returning();

    if (!deleted || deleted.length === 0) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "تعذر حذف المنشور." });
  }
});

export default router;
