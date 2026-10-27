import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db, menaMetaConnections, menaMetaInboxItems } from "@workspace/db";
import {
  metaPageAccessToken,
  MetaInboxGraphError,
  sendMetaInboxReply,
} from "../lib/meta-inbox-graph";
import { menaMetaAutoReplyJobs } from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  missingMetaIntegrationPermissions,
  type MetaIntegration,
} from "../lib/meta-oauth";

const router = Router();

async function reserveManualReply(
  workspaceId: string,
  itemId: string,
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const [job] = await transaction
      .select()
      .from(menaMetaAutoReplyJobs)
      .where(
        and(
          eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
          eq(menaMetaAutoReplyJobs.inboxItemId, itemId),
        ),
      )
      .for("update");
    if (!job) return true;
    if (job.status === "processing" || job.status === "sending") return false;
    if (job.status === "queued") {
      await transaction
        .update(menaMetaAutoReplyJobs)
        .set({
          status: "skipped",
          errorCode: "MANUAL_REPLY_IN_PROGRESS",
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(menaMetaAutoReplyJobs.id, job.id));
    }
    return true;
  });
}

async function restoreAutomaticReply(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  await db
    .update(menaMetaAutoReplyJobs)
    .set({
      status: "queued",
      errorCode: null,
      nextRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
        eq(menaMetaAutoReplyJobs.inboxItemId, itemId),
        eq(menaMetaAutoReplyJobs.status, "skipped"),
        eq(menaMetaAutoReplyJobs.errorCode, "MANUAL_REPLY_IN_PROGRESS"),
      ),
    );
}

async function markAutomaticReplyUnknown(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  await db
    .update(menaMetaAutoReplyJobs)
    .set({
      status: "unknown",
      errorCode: "MANUAL_SEND_RESULT_UNKNOWN",
      leaseExpiresAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
        eq(menaMetaAutoReplyJobs.inboxItemId, itemId),
        eq(menaMetaAutoReplyJobs.status, "skipped"),
        eq(menaMetaAutoReplyJobs.errorCode, "MANUAL_REPLY_IN_PROGRESS"),
      ),
    );
}

function metaPermissionError(integration: MetaIntegration, permission: string) {
  return {
    error: "أعد ربط حساب Meta ومنح الصلاحية المطلوبة قبل المتابعة.",
    code: "META_PERMISSION_REQUIRED",
    integration,
    missingPermissions: [permission],
  };
}

router.post(
  "/social/meta-inbox/items/:id/reply",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const text = metaString(
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>).text
        : undefined,
    );
    if (!text || text.length > 2000) {
      res.status(400).json({
        error: "اكتب ردًا من 1 إلى 2000 حرف.",
        code: "INVALID_REPLY_TEXT",
      });
      return;
    }
    const itemId = metaString(req.params.id);
    if (!itemId) {
      res.status(400).json({ error: "معرّف الرسالة أو التعليق غير صالح." });
      return;
    }

    const [item] = await db
      .select()
      .from(menaMetaInboxItems)
      .where(
        and(
          eq(menaMetaInboxItems.id, itemId),
          eq(menaMetaInboxItems.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "لم يتم العثور على الرسالة أو التعليق." });
      return;
    }
    if (item.replyText) {
      res.status(409).json({
        error: "تم الرد على هذه الرسالة أو التعليق بالفعل.",
        code: "META_ITEM_ALREADY_REPLIED",
      });
      return;
    }
    const [connection] = await db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) {
      res.status(409).json({ error: "حساب Meta غير مرتبط." });
      return;
    }

    const requiredPermission =
      item.kind === "message"
        ? item.platform === "facebook"
          ? "pages_messaging"
          : "instagram_manage_messages"
        : item.platform === "facebook"
          ? "pages_manage_engagement"
          : "instagram_manage_comments";
    const missing = missingMetaIntegrationPermissions(
      item.platform,
      connection.grantedPermissions,
    );
    if (
      !connection.authorizationVerifiedAt ||
      missing.includes(requiredPermission)
    ) {
      res
        .status(409)
        .json(metaPermissionError(item.platform, requiredPermission));
      return;
    }
    if (
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt <= new Date()
    ) {
      res.status(409).json({
        error: "انتهت صلاحية رمز Meta. أعد ربط الحساب.",
        code: "META_TOKEN_EXPIRED",
      });
      return;
    }

    let tokenResult: Awaited<ReturnType<typeof metaPageAccessToken>>;
    try {
      tokenResult = await metaPageAccessToken(
        connection.encryptedPageAccessToken,
      );
    } catch {
      res.status(409).json({
        error: "تعذر فك رمز Meta. أعد ربط الحساب.",
        code: "META_TOKEN_UNAVAILABLE",
      });
      return;
    }
    if (tokenResult.rotatedCiphertext) {
      await db
        .update(menaMetaConnections)
        .set({ encryptedPageAccessToken: tokenResult.rotatedCiphertext })
        .where(
          and(
            eq(menaMetaConnections.workspaceId, workspaceId),
            eq(
              menaMetaConnections.encryptedPageAccessToken,
              connection.encryptedPageAccessToken,
            ),
          ),
        );
    }

    if (!(await reserveManualReply(workspaceId, item.id))) {
      res.status(409).json({
        error: "يجري تجهيز رد آلي لهذه الرسالة. انتظر لحظات ثم حدّث الوارد.",
        code: "META_AUTO_REPLY_IN_PROGRESS",
      });
      return;
    }

    let manualSendAccepted = false;
    try {
      const result = await sendMetaInboxReply({
        platform: item.platform,
        kind: item.kind,
        pageId: connection.pageId,
        instagramUserId: connection.instagramUserId,
        recipientId: item.conversationId,
        externalId: item.externalId,
        accessToken: tokenResult.accessToken,
        text,
      });
      manualSendAccepted = true;
      const replyExternalId =
        metaString(result.message_id) ?? metaString(result.id) ?? null;
      const repliedAt = new Date();
      await db
        .update(menaMetaInboxItems)
        .set({ replyText: text, replyExternalId, repliedAt })
        .where(
          and(
            eq(menaMetaInboxItems.id, item.id),
            eq(menaMetaInboxItems.workspaceId, workspaceId),
          ),
        );
      res.json({
        sent: true,
        itemId: item.id,
        replyText: text,
        replyExternalId,
        repliedAt: repliedAt.toISOString(),
      });
    } catch (error) {
      const ambiguousSend =
        manualSendAccepted ||
        (error instanceof MetaInboxGraphError &&
          (error.networkFailure ||
            (error.status !== undefined && error.status >= 500)));
      if (ambiguousSend) {
        await markAutomaticReplyUnknown(workspaceId, item.id);
      } else {
        await restoreAutomaticReply(workspaceId, item.id);
      }
      if (error instanceof MetaInboxGraphError) {
        console.warn("Meta inbox reply failed:", {
          platform: item.platform,
          kind: item.kind,
          status: error.status,
          code: error.code,
          networkFailure: error.networkFailure,
        });
        const resultUnknown =
          error.networkFailure ||
          (error.status !== undefined && error.status >= 500);
        res.status(resultUnknown ? 502 : 422).json({
          error: resultUnknown
            ? "نتيجة إرسال الرد غير مؤكدة. حدّث الوارد وتحقق من حالة الرد قبل المحاولة مجددًا."
            : "رفضت Meta الرد. تحقق من صلاحية الحساب وسياسة المراسلة ثم أعد المحاولة.",
          code: resultUnknown
            ? "META_SEND_RESULT_UNKNOWN"
            : "META_REPLY_REJECTED",
          graphCode: error.code,
        });
        return;
      }
      throw error;
    }
  },
);

export default router;
