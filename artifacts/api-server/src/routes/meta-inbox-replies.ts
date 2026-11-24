import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaConnections,
  menaMetaInboxItems,
} from "@workspace/db";
import {
  metaPageAccessToken,
  MetaInboxGraphError,
  sendMetaInboxReply,
} from "../lib/meta-inbox-graph";
import {
  confirmMetaInboxReplyNotSent,
  completeMetaInboxReply,
  releaseMetaInboxReplyReservation,
  reserveMetaInboxReply,
} from "../lib/meta-inbox-reply-reservation";
import { metaString } from "../lib/meta-inbox-utils";
import { metaAutoReplyRetryableStatus } from "../lib/meta-auto-reply";
import { requireOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  missingMetaIntegrationPermissions,
  type MetaIntegration,
} from "../lib/meta-oauth";
import { logger } from "../lib/logger.ts";

const router = Router();

async function reserveManualAutoReply(
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
    const ownerId = requireOwnerId(req, res);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) return;
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

    if (!(await reserveManualAutoReply(workspaceId, item.id))) {
      res.status(409).json({
        error: "يجري تجهيز رد آلي لهذه الرسالة. انتظر لحظات ثم حدّث الوارد.",
        code: "META_AUTO_REPLY_IN_PROGRESS",
      });
      return;
    }

    const reservation = await reserveMetaInboxReply(workspaceId, item.id);
    if (reservation !== "reserved") {
      if (reservation === "unknown") {
        await markAutomaticReplyUnknown(workspaceId, item.id);
      }
      if (reservation === "missing") {
        res
          .status(404)
          .json({ error: "لم يتم العثور على الرسالة أو التعليق." });
        return;
      }
      const error =
        reservation === "unknown"
          ? "نتيجة محاولة الرد السابقة غير مؤكدة. تحقق من المحادثة قبل محاولة أخرى."
          : reservation === "in_progress"
            ? "يجري إرسال رد لهذه الرسالة أو التعليق. انتظر لحظات ثم حدّث الوارد."
            : "تم الرد على هذه الرسالة أو التعليق بالفعل.";
      res.status(409).json({
        error,
        code:
          reservation === "unknown"
            ? "META_SEND_RESULT_UNKNOWN"
            : reservation === "in_progress"
              ? "META_REPLY_IN_PROGRESS"
              : "META_ITEM_ALREADY_REPLIED",
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
      const saved = await completeMetaInboxReply(workspaceId, item.id, {
        text,
        externalId: replyExternalId,
        repliedAt,
      });
      if (!saved) {
        await releaseMetaInboxReplyReservation(workspaceId, item.id, "unknown");
        await markAutomaticReplyUnknown(workspaceId, item.id);
        res.status(502).json({
          error:
            "أرسلت Meta الرد، لكن تعذر حفظه محليًا. تحقق من المحادثة قبل إعادة المحاولة.",
          code: "META_SEND_RESULT_UNKNOWN",
        });
        return;
      }
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
            error.status === undefined ||
            error.status >= 500 ||
            (error.status >= 200 &&
              error.status < 300 &&
              error.code === undefined)));
      await releaseMetaInboxReplyReservation(
        workspaceId,
        item.id,
        ambiguousSend ? "unknown" : "available",
      );
      if (ambiguousSend) {
        await markAutomaticReplyUnknown(workspaceId, item.id);
      } else {
        await restoreAutomaticReply(workspaceId, item.id);
      }
      if (manualSendAccepted) {
        logger.warn(
          {
            platform: item.platform,
            kind: item.kind,
          },
          "Meta inbox reply accepted but local save failed",
        );
        res.status(502).json({
          error:
            "أرسلت Meta الرد، لكن تعذر حفظه محليًا. تحقق من المحادثة قبل إعادة المحاولة.",
          code: "META_SEND_RESULT_UNKNOWN",
        });
        return;
      }
      if (error instanceof MetaInboxGraphError) {
        logger.warn(
          {
            platform: item.platform,
            kind: item.kind,
            status: error.status,
            code: error.code,
            networkFailure: error.networkFailure,
          },
          "Meta inbox reply failed",
        );
        const resultUnknown =
          error.networkFailure ||
          error.status === undefined ||
          error.status >= 500 ||
          (error.status >= 200 &&
            error.status < 300 &&
            error.code === undefined);
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

/**
 * Requeue an automatic reply that stopped before sending: the workspace ran out
 * of AI quota, the provider was not configured, or the queue gave up. Entries
 * whose outcome is unknown are refused on purpose, because resending them could
 * deliver the same answer twice.
 */
router.post(
  "/social/meta-inbox/items/:id/auto-reply",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) return;
    const itemId = metaString(req.params.id);
    if (!itemId) {
      res.status(400).json({ error: "معرّف الرسالة أو التعليق غير صالح." });
      return;
    }

    const [item] = await db
      .select({
        replyText: menaMetaInboxItems.replyText,
        replyStatus: menaMetaInboxItems.replyStatus,
      })
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
    if (item.replyStatus === "unknown") {
      res.status(409).json({
        error:
          "نتيجة الرد السابق غير مؤكدة. تحقق من المحادثة قبل إعادة المحاولة.",
        code: "META_SEND_RESULT_UNKNOWN",
      });
      return;
    }

    const [job] = await db
      .select({
        id: menaMetaAutoReplyJobs.id,
        status: menaMetaAutoReplyJobs.status,
      })
      .from(menaMetaAutoReplyJobs)
      .where(
        and(
          eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
          eq(menaMetaAutoReplyJobs.inboxItemId, itemId),
        ),
      )
      .limit(1);
    if (!job) {
      res.status(409).json({
        error: "لم يُسجَّل رد آلي لهذه الرسالة، اكتب ردًا يدويًا.",
        code: "META_AUTO_REPLY_NOT_QUEUED",
      });
      return;
    }
    if (!metaAutoReplyRetryableStatus(job.status)) {
      res.status(409).json({
        error: "الرد الآلي قيد التنفيذ بالفعل.",
        code: "META_AUTO_REPLY_IN_PROGRESS",
      });
      return;
    }

    const now = new Date();
    const [requeued] = await db
      .update(menaMetaAutoReplyJobs)
      .set({
        status: "queued",
        attempts: 0,
        errorCode: null,
        nextRunAt: now,
        leaseExpiresAt: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(menaMetaAutoReplyJobs.id, job.id),
          eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
          eq(menaMetaAutoReplyJobs.status, job.status),
        ),
      )
      .returning({ status: menaMetaAutoReplyJobs.status });
    if (!requeued) {
      res.status(409).json({
        error: "تغيّرت حالة الرد الآلي، أعد تحميل المحادثة.",
        code: "META_AUTO_REPLY_IN_PROGRESS",
      });
      return;
    }

    res.json({ queued: true, autoReplyStatus: requeued.status });
  },
);

router.post(
  "/social/meta-inbox/items/:id/retry-confirmation",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) return;
    const itemId = metaString(req.params.id);
    if (!itemId) {
      res.status(400).json({ error: "معرّف الرسالة أو التعليق غير صالح." });
      return;
    }

    const cleared = await confirmMetaInboxReplyNotSent(workspaceId, itemId);
    if (!cleared) {
      res.status(409).json({
        error:
          "لا توجد محاولة غير مؤكدة لهذا العنصر، أو أنه تم الرد عليه بالفعل.",
        code: "META_REPLY_NOT_UNKNOWN",
      });
      return;
    }
    res.json({ cleared: true });
  },
);

export default router;
