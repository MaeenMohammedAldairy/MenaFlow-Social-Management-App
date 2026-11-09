import { and, eq } from "drizzle-orm";
import {
  db,
  menaContentSettings,
  menaMetaConnections,
  menaPostActivityEvents,
  posts,
} from "@workspace/db";
import {
  CreatePostBody,
  UpdatePostBody,
  UpdatePostParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { recordOrEmpty as safeRecord } from "../lib/value-utils.ts";

import { postReadinessMessage } from "../lib/post-readiness";

import { notifyPostsChanged } from "../lib/post-events";

import { type PostActivityEventType } from "../lib/post-activity";

const router: IRouter = Router();
import {
  normalizeChannels,
  sendPostQuotaError,
  normalizePostMediaUrls,
  publishApprovedPosts,
  normalizeClientSettableStatus,
  postActivityEvents,
  workspaceMediaIds,
  postReadinessIssueForRow,
  responseForRow,
} from "./posts-domain";

router.post("/posts", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const payload = req.body ?? {};
  const parseResult = CreatePostBody.safeParse(payload);
  if (!parseResult.success) {
    res.status(400).json({ error: "البيانات المدخلة غير صالحة." });
    return;
  }

  const data = parseResult.data;
  if (data.channels.includes("whatsapp")) {
    res
      .status(400)
      .json({ error: "النشر المباشر متاح لفيسبوك وإنستغرام فقط." });
    return;
  }
  if (data.status === "scheduled") {
    res.status(422).json({
      error:
        "الجدولة الزمنية غير متاحة بعد؛ احفظ المنشور كمسودة أو أرسله للمراجعة.",
    });
    return;
  }
  const postId =
    String(
      (payload as Record<string, unknown>).id ?? data.id ?? randomUUID(),
    ).trim() || randomUUID();

  try {
    const [existing] = await db
      .select({ ownerId: posts.ownerId })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);
    if (existing && existing.ownerId !== ownerId) {
      res.status(409).json({ error: "معرّف المنشور مستخدم بالفعل." });
      return;
    }
    if (existing) {
      res.status(409).json({
        error: "معرّف المنشور محفوظ مسبقًا؛ استخدم مسار التعديل لتحديثه.",
      });
      return;
    }
    const mediaUrls = normalizePostMediaUrls(
      (payload as Record<string, unknown>).mediaUrls,
    );
    if (
      (await workspaceMediaIds(workspaceId, mediaUrls)).size !==
      mediaUrls.filter((id) => !/^https?:\/\//i.test(id)).length
    ) {
      res
        .status(422)
        .json({ error: "تحتوي الوسائط على ملفات غير متاحة في مساحة العمل." });
      return;
    }
    const postValues = {
      title: data.title ?? "",
      body: data.body ?? "",
      channels: normalizeChannels(data.channels),
      status: normalizeClientSettableStatus(data.status, "draft"),
      sourceType: "manual",
      sourceMessageId: null,
      sourceGroupJid: null,
      sourceMessageDate: null,
      sourceText: null,
      mediaUrls,
      metadata: safeRecord((payload as Record<string, unknown>).metadata),
      autoPublish: Boolean((payload as Record<string, unknown>).autoPublish),
      autoPublishChannels: normalizeChannels(
        (payload as Record<string, unknown>).autoPublishChannels,
      ),
      publishResults: {},
      error: null,
      updatedAt: new Date(),
    };
    const [saved] = await db
      .insert(posts)
      .values({
        id: postId,
        ownerId,
        workspaceId,
        ...postValues,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!saved) {
      res
        .status(409)
        .json({ error: "تعذّر حفظ المنشور بسبب تعارض في المعرّف." });
      return;
    }
    const [metaConnection] = await db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1);
    const eventTypes: PostActivityEventType[] = ["post_created"];
    if (saved.status === "review") eventTypes.push("post_submitted_for_review");
    const events = postActivityEvents(
      ownerId,
      workspaceId,
      {
        id: saved.id,
        title: saved.title,
        channels: normalizeChannels(saved.channels),
      },
      eventTypes,
      metaConnection,
    );
    if (events.length > 0)
      await db.insert(menaPostActivityEvents).values(events);
    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res
      .status(201)
      .json(
        await responseForRow(
          saved,
          workspaceId,
          undefined,
          undefined,
          req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
        ),
      );
  } catch (error) {
    if (sendPostQuotaError(res, error)) return;
    console.error("Error creating post:", error);
    res.status(500).json({ error: "تعذر حفظ المنشور في الخادم." });
  }
});

router.patch("/posts/:id", requireWorkspace, async (req, res) => {
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

  const bodyResult = UpdatePostBody.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: "البيانات المدخلة غير صالحة." });
    return;
  }

  const postId = paramResult.data.id;
  const updates = bodyResult.data;
  const rawBody = req.body ?? {};
  if (updates.channels?.includes("whatsapp")) {
    res
      .status(400)
      .json({ error: "النشر المباشر متاح لفيسبوك وإنستغرام فقط." });
    return;
  }
  if (updates.status === "scheduled") {
    res.status(422).json({
      error:
        "الجدولة الزمنية غير متاحة بعد؛ احفظ المنشور كمسودة أو أرسله للمراجعة.",
    });
    return;
  }

  try {
    const [current] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }
    if (
      current.status === "publishing" &&
      (updates.title !== undefined ||
        updates.body !== undefined ||
        updates.channels !== undefined ||
        Array.isArray(rawBody.mediaUrls))
    ) {
      res
        .status(409)
        .json({ error: "لا يمكن تعديل محتوى المنشور أثناء إرساله." });
      return;
    }
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (updates.title !== undefined) updateValues.title = updates.title;
    if (updates.body !== undefined) updateValues.body = updates.body;
    if (updates.channels !== undefined)
      updateValues.channels = normalizeChannels(updates.channels);
    if (updates.status !== undefined) {
      const nextStatus = normalizeClientSettableStatus(
        updates.status,
        current.status,
        true,
      );
      if (nextStatus === "approved") {
        const readinessIssue = await postReadinessIssueForRow(workspaceId, {
          ...current,
          ...updates,
          mediaUrls: Array.isArray(rawBody.mediaUrls)
            ? normalizePostMediaUrls(rawBody.mediaUrls)
            : current.mediaUrls,
        });
        if (readinessIssue) {
          res.status(422).json({ error: postReadinessMessage(readinessIssue) });
          return;
        }
      }
      updateValues.status = nextStatus;
      if (
        nextStatus === "draft" ||
        nextStatus === "review" ||
        nextStatus === "approved"
      ) {
        updateValues.error = null;
      }
    }
    const currentMetadata = safeRecord(current.metadata);
    if (Array.isArray(rawBody.mediaUrls)) {
      const mediaUrls = normalizePostMediaUrls(rawBody.mediaUrls);
      if (
        (await workspaceMediaIds(workspaceId, mediaUrls)).size !==
        mediaUrls.filter((id) => !/^https?:\/\//i.test(id)).length
      ) {
        res
          .status(422)
          .json({ error: "تحتوي الوسائط على ملفات غير متاحة في مساحة العمل." });
        return;
      }
      updateValues.mediaUrls = mediaUrls;
      if (
        current.sourceType === "whatsapp" &&
        Array.isArray(currentMetadata.sourceMedia)
      ) {
        const sourceMediaIds = currentMetadata.sourceMedia
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string");
        const selectedMediaIds = new Set(mediaUrls);
        updateValues.metadata = {
          ...currentMetadata,
          removedSourceMediaIds: sourceMediaIds.filter(
            (id) => !selectedMediaIds.has(id),
          ),
        };
      }
    }
    if (rawBody.metadata !== undefined) {
      updateValues.metadata = {
        ...safeRecord(updateValues.metadata ?? currentMetadata),
        ...safeRecord(rawBody.metadata),
      };
    } else if (
      updates.body !== undefined &&
      current.sourceType === "whatsapp" &&
      typeof currentMetadata.instagramBody === "string"
    ) {
      updateValues.metadata = {
        ...currentMetadata,
        instagramBody: updates.body,
      };
    }
    if (rawBody.autoPublish !== undefined)
      updateValues.autoPublish = Boolean(rawBody.autoPublish);
    if (Array.isArray(rawBody.autoPublishChannels))
      updateValues.autoPublishChannels = normalizeChannels(
        rawBody.autoPublishChannels,
      );

    const [updated] = await db
      .update(posts)
      .set(updateValues)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "المنشور غير موجود." });
      return;
    }

    const eventTypes: PostActivityEventType[] = [];
    const contentChanged =
      updates.title !== undefined ||
      updates.body !== undefined ||
      updates.channels !== undefined ||
      Array.isArray(rawBody.mediaUrls) ||
      rawBody.metadata !== undefined;
    if (contentChanged) eventTypes.push("post_edited");
    if (updates.status !== undefined && updates.status !== current.status) {
      const nextStatus = normalizeClientSettableStatus(
        updates.status,
        current.status,
        true,
      );
      if (nextStatus === "review") eventTypes.push("post_submitted_for_review");
      if (nextStatus === "approved") eventTypes.push("post_approved");
      if (nextStatus === "scheduled") {
        eventTypes.push("post_scheduled");
      }
      if (current.status === "review" && nextStatus === "published") {
        eventTypes.push("post_approved");
      }
    }
    if (eventTypes.length > 0) {
      const [metaConnection] = await db
        .select()
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const events = postActivityEvents(
        ownerId,
        workspaceId,
        {
          id: updated.id,
          title: updated.title,
          channels: normalizeChannels(updated.channels),
        },
        eventTypes,
        metaConnection,
      );
      if (events.length > 0)
        await db.insert(menaPostActivityEvents).values(events);
    }

    let responsePost = updated;
    if (current.status !== "approved" && updated.status === "approved") {
      const [settings] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      const autoPublishChannels = normalizeChannels(
        settings?.autoPublishChannels,
      );
      if (settings?.autoPublishEnabled && autoPublishChannels.length > 0) {
        await publishApprovedPosts(
          ownerId,
          workspaceId,
          autoPublishChannels as Array<"facebook" | "instagram">,
        );
        const [latest] = await db
          .select()
          .from(posts)
          .where(
            and(eq(posts.id, updated.id), eq(posts.workspaceId, workspaceId)),
          )
          .limit(1);
        if (latest) responsePost = latest;
      }
    }

    notifyPostsChanged(ownerId);
    notifyPostsChanged(workspaceId);
    res.json(
      await responseForRow(
        responsePost,
        workspaceId,
        undefined,
        undefined,
        req.get("host") ? `${req.protocol}://${req.get("host")}` : undefined,
      ),
    );
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "تعذر تحديث المنشور." });
  }
});

export default router;
