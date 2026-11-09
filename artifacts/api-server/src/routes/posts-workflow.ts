import { eq } from "drizzle-orm";
import { db, menaContentSettings, menaMetaConnections } from "@workspace/db";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

import { unconnectedMetaChannels } from "../lib/meta-channel-routing";

import { processWhatsAppBacklog } from "../lib/whatsapp-marketing";

const router: IRouter = Router();
import { normalizeChannels, publishApprovedPosts } from "./posts-domain";

router.get(
  "/posts/auto-publish-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    try {
      const [settings] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      res.json({
        enabled: Boolean(settings?.autoPublishEnabled),
        channels: settings
          ? normalizeChannels(settings.autoPublishChannels)
          : [],
        enabledAt: settings?.enabledAt
          ? settings.enabledAt.toISOString()
          : null,
      });
    } catch (error) {
      console.error("Error loading auto-publish settings:", error);
      res.status(500).json({ error: "تعذر تحميل إعدادات النشر التلقائي." });
    }
  },
);

router.put(
  "/posts/auto-publish-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const enabled = req.body?.enabled;
    const requestedChannels = normalizeChannels(req.body?.channels);
    const channels = requestedChannels.filter(
      (channel): channel is "facebook" | "instagram" =>
        channel === "facebook" || channel === "instagram",
    );
    if (
      typeof enabled !== "boolean" ||
      channels.length !== requestedChannels.length ||
      (enabled && channels.length === 0)
    ) {
      res
        .status(400)
        .json({ error: "اختر منصة واحدة على الأقل لتفعيل النشر التلقائي." });
      return;
    }
    try {
      const [metaConnection] = await db
        .select({
          pageId: menaMetaConnections.pageId,
          instagramUserId: menaMetaConnections.instagramUserId,
        })
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const unconnectedChannels = enabled
        ? unconnectedMetaChannels(channels, metaConnection)
        : [];
      if (unconnectedChannels.length > 0) {
        res.status(400).json({
          error: `اربط ${unconnectedChannels.map((channel) => (channel === "facebook" ? "فيسبوك" : "إنستغرام")).join(" و")} قبل تفعيل النشر التلقائي عليها.`,
        });
        return;
      }
      const [current] = await db
        .select()
        .from(menaContentSettings)
        .where(eq(menaContentSettings.workspaceId, workspaceId))
        .limit(1);
      const enabledAt = enabled
        ? current?.autoPublishEnabled
          ? current.enabledAt
          : new Date()
        : null;
      const [saved] = await db
        .insert(menaContentSettings)
        .values({
          ownerId,
          workspaceId,
          autoPublishEnabled: enabled,
          autoPublishChannels: channels,
          enabledAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: menaContentSettings.workspaceId,
          setWhere: eq(menaContentSettings.workspaceId, workspaceId),
          set: {
            autoPublishEnabled: enabled,
            autoPublishChannels: channels,
            enabledAt,
            updatedAt: new Date(),
          },
        })
        .returning();
      const initialPublish =
        enabled && !current?.autoPublishEnabled
          ? await publishApprovedPosts(ownerId, workspaceId, channels)
          : undefined;
      res.json({
        enabled: saved.autoPublishEnabled,
        channels: normalizeChannels(saved.autoPublishChannels),
        enabledAt: saved.enabledAt?.toISOString() ?? null,
        ...(initialPublish ? { initialPublish } : {}),
      });
    } catch (error) {
      console.error("Error saving auto-publish settings:", error);
      res.status(500).json({ error: "تعذر حفظ إعدادات النشر التلقائي." });
    }
  },
);

router.post(
  "/posts/process-whatsapp-backlog",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const requestedLimit = Number(req.body?.limit ?? 50);
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      res
        .status(400)
        .json({ error: "الحد الأقصى للتحليل هو 100 رسالة في الطلب." });
      return;
    }
    try {
      const result = await processWhatsAppBacklog(workspaceId, requestedLimit);
      res.json(result);
    } catch (error) {
      console.error("Error processing WhatsApp backlog:", error);
      res.status(500).json({ error: "تعذر تحليل الرسائل القديمة." });
    }
  },
);

export default router;
