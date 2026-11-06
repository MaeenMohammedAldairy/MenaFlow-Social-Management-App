import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaWebhookSubscriptions,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import {
  metaAutoReplyPermission,
  missingMetaIntegrationPermissions,
  type MetaIntegration,
} from "../lib/meta-oauth";
import { isRecord } from "../lib/value-utils.ts";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();

const defaults = {
  enabled: false,
  facebookMessagesEnabled: false,
  facebookCommentsEnabled: false,
  instagramMessagesEnabled: false,
  instagramCommentsEnabled: false,
  language: "ar" as const,
  tone: "friendly_professional" as const,
  instructions: "",
};

type ParsedSettings = {
  enabled: boolean;
  facebookMessagesEnabled: boolean;
  facebookCommentsEnabled: boolean;
  instagramMessagesEnabled: boolean;
  instagramCommentsEnabled: boolean;
  language: "ar" | "match_customer";
  tone: "friendly_professional" | "concise" | "formal";
  instructions: string;
};

function parseSettings(value: unknown): ParsedSettings | null {
  if (!isRecord(value)) return null;
  const {
    enabled,
    facebookMessagesEnabled,
    facebookCommentsEnabled,
    instagramMessagesEnabled,
    instagramCommentsEnabled,
    language,
    tone,
    instructions,
  } = value;
  if (
    typeof enabled !== "boolean" ||
    typeof facebookMessagesEnabled !== "boolean" ||
    typeof facebookCommentsEnabled !== "boolean" ||
    typeof instagramMessagesEnabled !== "boolean" ||
    typeof instagramCommentsEnabled !== "boolean" ||
    (language !== "ar" && language !== "match_customer") ||
    (tone !== "friendly_professional" &&
      tone !== "concise" &&
      tone !== "formal") ||
    typeof instructions !== "string" ||
    instructions.length > 2000
  ) {
    return null;
  }
  return {
    enabled,
    facebookMessagesEnabled,
    facebookCommentsEnabled,
    instagramMessagesEnabled,
    instagramCommentsEnabled,
    language,
    tone,
    instructions: instructions.trim(),
  };
}

async function integrationReadiness(
  workspaceId: string,
  platform: MetaIntegration,
  connection: typeof menaMetaConnections.$inferSelect | undefined,
) {
  const [subscription] = await db
    .select()
    .from(menaMetaWebhookSubscriptions)
    .where(
      and(
        eq(menaMetaWebhookSubscriptions.workspaceId, workspaceId),
        eq(menaMetaWebhookSubscriptions.platform, platform),
      ),
    )
    .limit(1);
  const accountId =
    platform === "facebook" ? connection?.pageId : connection?.instagramUserId;
  const subscriptionReady = Boolean(
    accountId &&
    subscription?.accountId === accountId &&
    subscription.subscribedAt,
  );
  const subscribedFields = subscription?.subscribedFields ?? [];
  const messagesSubscriptionReady =
    subscriptionReady && subscribedFields.includes("messages");
  const commentsSubscriptionReady =
    subscriptionReady &&
    subscribedFields.includes(platform === "facebook" ? "feed" : "comments");
  const tokenReady = Boolean(
    connection?.authorizationVerifiedAt &&
    (!connection.accessTokenExpiresAt ||
      connection.accessTokenExpiresAt > new Date()),
  );
  const webhookConfigured = Boolean(
    process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim(),
  );
  const permissions = connection
    ? missingMetaIntegrationPermissions(platform, connection.grantedPermissions)
    : [];
  const messagePermission = metaAutoReplyPermission(platform, "message");
  const commentPermission = metaAutoReplyPermission(platform, "comment");
  const integrationReady = Boolean(
    accountId && tokenReady && subscriptionReady && webhookConfigured,
  );
  const aiConfigured = Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim(),
  );
  return {
    connected: Boolean(accountId),
    tokenReady,
    webhookConfigured,
    subscriptionReady,
    messagesSubscriptionReady,
    commentsSubscriptionReady,
    aiConfigured,
    messagesReady:
      integrationReady &&
      messagesSubscriptionReady &&
      aiConfigured &&
      !permissions.includes(messagePermission),
    commentsReady:
      integrationReady &&
      commentsSubscriptionReady &&
      aiConfigured &&
      !permissions.includes(commentPermission),
    missingPermissions: permissions,
  };
}

router.get("/social/meta-auto-replies", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const [[settings], [connection]] = await Promise.all([
    db
      .select()
      .from(menaMetaAutoReplySettings)
      .where(eq(menaMetaAutoReplySettings.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1),
  ]);
  const [facebook, instagram] = await Promise.all([
    integrationReadiness(workspaceId, "facebook", connection),
    integrationReadiness(workspaceId, "instagram", connection),
  ]);
  res.json({
    settings: settings
      ? {
          enabled: settings.enabled,
          facebookMessagesEnabled: settings.facebookMessagesEnabled,
          facebookCommentsEnabled: settings.facebookCommentsEnabled,
          instagramMessagesEnabled: settings.instagramMessagesEnabled,
          instagramCommentsEnabled: settings.instagramCommentsEnabled,
          language: settings.language,
          tone: settings.tone,
          instructions: settings.instructions,
        }
      : defaults,
    readiness: { facebook, instagram },
  });
});

router.put("/social/meta-auto-replies", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const settings = parseSettings(req.body);
  if (!settings) {
    res.status(400).json({ error: "إعدادات الرد الآلي غير صالحة." });
    return;
  }
  const anyEnabled = Object.entries(settings).some(
    ([key, value]) => key.endsWith("Enabled") && value === true,
  );
  if (settings.enabled && !anyEnabled) {
    res.status(400).json({
      error: "فعّل قناة واحدة على الأقل قبل تشغيل الرد الآلي.",
      code: "META_AUTO_REPLY_CHANNEL_REQUIRED",
    });
    return;
  }
  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (settings.enabled && anyEnabled && !connection) {
    res.status(409).json({ error: "اربط حساب Meta أولاً." });
    return;
  }
  const [facebook, instagram] = await Promise.all([
    integrationReadiness(workspaceId, "facebook", connection),
    integrationReadiness(workspaceId, "instagram", connection),
  ]);
  const requested = [
    {
      enabled: settings.facebookMessagesEnabled,
      ready: facebook.messagesReady,
      platform: "Facebook",
    },
    {
      enabled: settings.facebookCommentsEnabled,
      ready: facebook.commentsReady,
      platform: "Facebook",
    },
    {
      enabled: settings.instagramMessagesEnabled,
      ready: instagram.messagesReady,
      platform: "Instagram",
    },
    {
      enabled: settings.instagramCommentsEnabled,
      ready: instagram.commentsReady,
      platform: "Instagram",
    },
  ];
  const unavailable = requested.find(
    ({ enabled, ready }) => settings.enabled && enabled && !ready,
  );
  if (unavailable) {
    res.status(409).json({
      error: `تعذر التفعيل على ${unavailable.platform}. تحقق من الصلاحيات الممنوحة، والاشتراك في Webhook، وإعدادات مزود الذكاء الاصطناعي.`,
      code: "META_AUTO_REPLY_NOT_READY",
    });
    return;
  }

  const saved = await db.transaction(async (transaction) => {
    const [updated] = await transaction
      .insert(menaMetaAutoReplySettings)
      .values({
        id: randomUUID(),
        ownerId,
        workspaceId,
        ...settings,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: menaMetaAutoReplySettings.workspaceId,
        set: { ...settings, updatedAt: new Date() },
      })
      .returning();
    if (!updated) return undefined;
    if (!settings.enabled) {
      await transaction
        .update(menaMetaAutoReplyJobs)
        .set({
          status: "skipped",
          errorCode: "AUTOMATION_DISABLED",
          leaseExpiresAt: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
            eq(menaMetaAutoReplyJobs.status, "queued"),
          ),
        );
    }
    return updated;
  });
  if (!saved) {
    res.status(500).json({ error: "تعذر حفظ إعدادات الرد الآلي." });
    return;
  }
  res.json({
    enabled: saved.enabled,
    facebookMessagesEnabled: saved.facebookMessagesEnabled,
    facebookCommentsEnabled: saved.facebookCommentsEnabled,
    instagramMessagesEnabled: saved.instagramMessagesEnabled,
    instagramCommentsEnabled: saved.instagramCommentsEnabled,
    language: saved.language,
    tone: saved.tone,
    instructions: saved.instructions,
  });
});

export default router;
