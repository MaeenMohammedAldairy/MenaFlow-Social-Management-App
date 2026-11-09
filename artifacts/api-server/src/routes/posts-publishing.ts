import { and, eq, notInArray } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaPostActivityEvents,
  posts,
} from "@workspace/db";
import { UpdatePostParams } from "@workspace/api-zod";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { recordOrEmpty as safeRecord } from "../lib/value-utils.ts";
import {
  publishPostToMeta,
  verifyFacebookPublishStatus,
} from "../lib/meta-publishing";

import { parsePublishRequestBody } from "../lib/publish-retry";
import { postReadinessMessage } from "../lib/post-readiness";

import { notifyPostsChanged } from "../lib/post-events";
import { logger } from "../lib/logger";

import { makePostActivityEvent } from "../lib/post-activity";

const router: IRouter = Router();
import {
  normalizeChannels,
  postReadinessIssueForRow,
  responseForRow,
} from "./posts-domain";

router.post(
  "/posts/:id/verify-facebook",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    const paramResult = UpdatePostParams.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: "معرّف المنشور غير صالح." });
      return;
    }

    try {
      const [row] = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, paramResult.data.id),
            eq(posts.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "المنشور غير موجود." });
        return;
      }

      const currentResults = safeRecord(row.publishResults);
      const facebookResult = safeRecord(currentResults.facebook);
      if (facebookResult.status !== "unknown" || row.status !== "failed") {
        res
          .status(409)
          .json({ error: "لا توجد نتيجة نشر غير مؤكدة لفيسبوك للتحقق منها." });
        return;
      }

      const verification = await verifyFacebookPublishStatus(row, workspaceId);
      let updated = row;
      if (verification.status === "found") {
        const publishResults: Record<string, unknown> = {
          ...currentResults,
          facebook: verification.result,
        };
        const channels = normalizeChannels(row.channels);
        const fullyPublished =
          channels.length > 0 &&
          channels.every(
            (channel) =>
              safeRecord(publishResults[channel]).status === "published",
          );
        const error = fullyPublished
          ? null
          : channels
              .map((channel) => {
                const result = safeRecord(publishResults[channel]);
                return result.status === "published"
                  ? null
                  : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
              })
              .filter(Boolean)
              .join("; ");
        [updated] = await db
          .update(posts)
          .set({
            publishResults,
            status: fullyPublished ? "published" : "failed",
            error,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, row.id),
              eq(posts.workspaceId, workspaceId),
              eq(posts.status, "failed"),
            ),
          )
          .returning();
        if (!updated) {
          res.status(409).json({
            error:
              "تغيّرت حالة المنشور أثناء التحقق؛ حدّث الصفحة وحاول مجدداً.",
          });
          return;
        }
        if (verification.result.status === "published") {
          const [metaConnection] = await db
            .select({ pageId: menaMetaConnections.pageId })
            .from(menaMetaConnections)
            .where(eq(menaMetaConnections.workspaceId, workspaceId))
            .limit(1);
          if (metaConnection) {
            await db.insert(menaPostActivityEvents).values(
              makePostActivityEvent({
                ownerId,
                workspaceId,
                postId: row.id,
                accountId: metaConnection.pageId,
                channel: "facebook",
                eventType: "publish_verified",
                actorId: ownerId,
                details: {
                  status: "published",
                  externalPostId: verification.result.postId,
                  url: verification.result.url,
                },
              }),
            );
          }
        }
      } else if (verification.status === "not-found") {
        const channels = normalizeChannels(row.channels);
        const publishResults: Record<string, unknown> = {
          ...currentResults,
          facebook: {
            ...facebookResult,
            status: "failed",
            reason: "FACEBOOK_POST_NOT_FOUND_AFTER_VERIFICATION",
          },
        };
        const error = channels
          .map((channel) => {
            const result = safeRecord(publishResults[channel]);
            return result.status === "published"
              ? null
              : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
          })
          .filter(Boolean)
          .join("; ");
        [updated] = await db
          .update(posts)
          .set({
            publishResults,
            error,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, row.id),
              eq(posts.workspaceId, workspaceId),
              eq(posts.status, "failed"),
              eq(posts.updatedAt, row.updatedAt),
            ),
          )
          .returning();
        if (!updated) {
          res.status(409).json({
            error:
              "تغيّرت حالة المنشور أثناء التحقق؛ حدّث الصفحة وحاول مجدداً.",
          });
          return;
        }
      }

      if (verification.status !== "unavailable") notifyPostsChanged(ownerId);
      res.json({
        status: verification.status,
        reason:
          verification.status === "unavailable"
            ? (verification.reason ?? "FACEBOOK_RESULT_CANNOT_BE_VERIFIED")
            : verification.status === "not-found"
              ? "FACEBOOK_POST_NOT_FOUND_AFTER_VERIFICATION"
              : null,
        post: await responseForRow(
          updated,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      });
    } catch (error) {
      logger.error(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            error instanceof Error
              ? error.message
              : "FACEBOOK_STATUS_CHECK_FAILED",
        },
        "Facebook publish status check failed",
      );
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "FACEBOOK_STATUS_CHECK_FAILED",
      });
    }
  },
);

router.post("/posts/:id/publish", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const publishRequest = parsePublishRequestBody(req.body);
  if (!publishRequest) {
    res.status(400).json({ error: "بيانات طلب النشر غير صالحة." });
    return;
  }

  const paramResult = UpdatePostParams.safeParse(req.params);
  if (!paramResult.success) {
    res.status(400).json({ error: "معرّف المنشور غير صالح." });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, paramResult.data.id),
          eq(posts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    const selectedChannels = normalizeChannels(
      publishRequest.channels ?? row.channels,
    );
    if (
      selectedChannels.some(
        (channel) => channel !== "facebook" && channel !== "instagram",
      )
    ) {
      res.status(400).json({ error: "النشر متاح لفيسبوك وإنستغرام فقط." });
      return;
    }
    const channels = selectedChannels;
    const retryUncertain = publishRequest.retryUncertain;
    logger.info(
      {
        requestId: req.id,
        retryUncertain,
        channels,
      },
      "Post publish request received",
    );
    if (channels.length === 0) {
      res.status(400).json({ error: "اختر فيسبوك أو إنستغرام قبل النشر." });
      return;
    }
    const targetChannels = normalizeChannels([
      ...normalizeChannels(row.channels).filter(
        (channel) => channel === "facebook" || channel === "instagram",
      ),
      ...channels,
    ]);
    const currentResults = safeRecord(row.publishResults);
    const alreadyPublished = channels.filter(
      (channel) => safeRecord(currentResults[channel]).status === "published",
    );
    if (alreadyPublished.length > 0) {
      const channelNames = alreadyPublished
        .map((channel) => channel === "facebook" ? "فيسبوك" : "إنستغرام")
        .join(" و");
      res.status(409).json({
        error: `سبق نشر المنشور بنجاح على ${channelNames}. أزل هذه القناة من المحاولة لتجنب التكرار.`,
      });
      return;
    }
    const readinessIssue = await postReadinessIssueForRow(workspaceId, row);
    if (readinessIssue) {
      res.status(422).json({ error: postReadinessMessage(readinessIssue) });
      return;
    }
    if (row.status === "publishing" || row.status === "published") {
      res.status(409).json({
        error: "المنشور قيد الإرسال أو سبق نشره؛ لا يمكن إعادة إرساله.",
      });
      return;
    }

    const [claimed] = await db
      .update(posts)
      .set({
        channels: targetChannels,
        status: "publishing",
        error: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posts.id, row.id),
          eq(posts.workspaceId, workspaceId),
          notInArray(posts.status, ["publishing", "published"]),
        ),
      )
      .returning();
    if (!claimed) {
      res
        .status(409)
        .json({ error: "هناك محاولة نشر أخرى جارية لهذا المنشور." });
      return;
    }

    let latestResults = safeRecord(claimed.publishResults);
    try {
      const results = await publishPostToMeta(
        claimed,
        channels,
        async (channel, result) => {
          latestResults = { ...latestResults, [channel]: result };
          await db
            .update(posts)
            .set({ publishResults: latestResults, updatedAt: new Date() })
            .where(
              and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
            );
        },
        workspaceId,
        retryUncertain,
        false,
      );
      latestResults = { ...latestResults, ...results };
      const fullyPublished = targetChannels.every(
        (channel) => safeRecord(latestResults[channel]).status === "published",
      );
      const errorMessage = fullyPublished
        ? null
        : targetChannels
            .map((channel) => {
              const result = safeRecord(latestResults[channel]);
              return result.status === "published"
                ? null
                : `${channel}: ${String(result.reason ?? result.status ?? "PUBLISH_FAILED")}`;
            })
            .filter(Boolean)
            .join("; ");
      const [updated] = await db
        .update(posts)
        .set({
          status: fullyPublished ? "published" : "failed",
          channels: targetChannels,
          publishResults: latestResults,
          error: errorMessage,
          updatedAt: new Date(),
        })
        .where(
          and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
        )
        .returning();

      logger.info(
        {
          requestId: req.id,
          retryUncertain,
          channelStatuses: Object.fromEntries(
            Object.entries(latestResults).map(([channel, result]) => [
              channel,
              safeRecord(result).status,
            ]),
          ),
        },
        "Post publish request completed",
      );
      notifyPostsChanged(ownerId);
      notifyPostsChanged(workspaceId);
      res.json({
        success: fullyPublished,
        results: latestResults,
        post: await responseForRow(
          updated,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر النشر.";
      await db
        .update(posts)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(
          and(eq(posts.id, claimed.id), eq(posts.workspaceId, workspaceId)),
        );
      notifyPostsChanged(ownerId);
      notifyPostsChanged(workspaceId);
      res.status(400).json({ error: message, results: latestResults });
    }
  } catch (error) {
    console.error("Error publishing post:", error);
    const message = error instanceof Error ? error.message : "تعذر النشر.";
    await db
      .update(posts)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posts.id, paramResult.data.id),
          eq(posts.workspaceId, workspaceId),
        ),
      );
    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.status(400).json({ error: message });
  }
});

export default router;
