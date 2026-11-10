import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaInboxItems,
  menaMetaWebhookSubscriptions,
  posts,
  productPosts,
  products,
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

function readinessMessage(
  readiness: Awaited<ReturnType<typeof integrationReadiness>>,
  platform: MetaIntegration,
  kind: "message" | "comment",
): string | null {
  if (!readiness.connected) return "اربط حساب المنصة أولًا.";
  if (!readiness.tokenReady) {
    return "تحقق من صلاحيات الحساب أو أعد ربطه من صفحة المصادر.";
  }
  if (
    kind === "message"
      ? !readiness.messagesSubscriptionReady
      : !readiness.commentsSubscriptionReady
  ) {
    return "فعّل اشتراك استقبال التفاعلات لهذا الحساب من صندوق الوارد.";
  }
  if (!readiness.aiConfigured) {
    return "خدمة الذكاء الاصطناعي غير مهيأة على الخادم.";
  }
  const permission = metaAutoReplyPermission(platform, kind);
  if (readiness.missingPermissions.includes(permission)) {
    return `الصلاحية ${permission} غير ممنوحة للحساب.`;
  }
  return null;
}

const historicalCommentWindowMs = 24 * 60 * 60 * 1000;
const historicalCommentBatchLimit = 20;

async function historicalCommentCandidates(
  workspaceId: string,
  platform: MetaIntegration,
  accountId: string,
) {
  const platformPostId = sql<string>`${posts.publishResults}->${platform}->>'postId'`;
  const platformPublished =
    platform === "facebook"
      ? sql`${posts.publishResults}->'facebook'->>'status' = 'published'`
      : sql`${posts.publishResults}->'instagram'->>'status' = 'published'`;
  const published = or(eq(posts.status, "published"), platformPublished);
  const rows = await db
    .select({
      id: posts.id,
      externalPostId: platformPostId,
      title: posts.title,
      productName: products.name,
    })
    .from(posts)
    .innerJoin(
      productPosts,
      and(
        eq(productPosts.workspaceId, posts.workspaceId),
        eq(productPosts.postId, posts.id),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.workspaceId, productPosts.workspaceId),
        eq(products.id, productPosts.productId),
      ),
    )
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        published,
        isNotNull(platformPostId),
        ne(platformPostId, ""),
        eq(products.status, "active"),
        isNotNull(products.verifiedAt),
      ),
    )
    .orderBy(desc(posts.updatedAt))
    .limit(200);
  const grouped = new Map<
    string,
    {
      id: string;
      externalPostId: string;
      title: string;
      productNames: Set<string>;
    }
  >();
  for (const row of rows) {
    let post = grouped.get(row.id);
    if (!post) {
      post = {
        id: row.id,
        externalPostId: row.externalPostId,
        title: row.title,
        productNames: new Set(),
      };
      grouped.set(row.id, post);
    }
    post.productNames.add(row.productName);
  }
  if (!grouped.size) return [];

  const inboxItems = menaMetaInboxItems;
  const jobs = menaMetaAutoReplyJobs;
  const comments = await db
    .select({
      id: inboxItems.id,
      conversationId: inboxItems.conversationId,
    })
    .from(inboxItems)
    .leftJoin(
      jobs,
      and(
        eq(jobs.workspaceId, inboxItems.workspaceId),
        eq(jobs.inboxItemId, inboxItems.id),
      ),
    )
    .where(
      and(
        eq(inboxItems.workspaceId, workspaceId),
        eq(inboxItems.platform, platform),
        eq(inboxItems.kind, "comment"),
        inArray(
          inboxItems.conversationId,
          [...grouped.values()].map((post) => post.externalPostId),
        ),
        inArray(
          inboxItems.parentId,
          [...grouped.values()].map((post) => post.externalPostId),
        ),
        gte(
          inboxItems.occurredAt,
          new Date(Date.now() - historicalCommentWindowMs),
        ),
        isNull(inboxItems.replyText),
        isNull(inboxItems.replyStatus),
        isNotNull(inboxItems.actorId),
        ne(inboxItems.actorId, accountId),
        isNull(jobs.id),
      ),
    );
  const commentsByPost = new Map<string, string[]>();
  for (const comment of comments) {
    const ids = commentsByPost.get(comment.conversationId) ?? [];
    ids.push(comment.id);
    commentsByPost.set(comment.conversationId, ids);
  }
  return [...grouped.values()].map((post) => ({
    id: post.id,
    title: post.title,
    products: [...post.productNames],
    eligibleCommentCount:
      commentsByPost.get(post.externalPostId)?.length ?? 0,
    eligibleCommentIds: commentsByPost.get(post.externalPostId) ?? [],
  }));
}

router.get(
  "/social/meta-auto-replies/historical-comments",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
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
    const platforms = {} as Record<
      MetaIntegration,
      { ready: boolean; reason: string | null; posts: Array<{
        id: string;
        title: string;
        products: string[];
        eligibleCommentCount: number;
      }> }
    >;
    for (const platform of ["facebook", "instagram"] as const) {
      const commentReplyEnabled = Boolean(
        settings?.enabled &&
          (platform === "facebook"
            ? settings.facebookCommentsEnabled
            : settings.instagramCommentsEnabled),
      );
      const readiness = await integrationReadiness(
        workspaceId,
        platform,
        connection,
      );
      const ready = commentReplyEnabled && readiness.commentsReady;
      const accountId =
        platform === "facebook"
          ? connection?.pageId
          : connection?.instagramUserId;
      const candidates =
        ready && accountId
          ? await historicalCommentCandidates(workspaceId, platform, accountId)
          : [];
      platforms[platform] = {
        ready,
        reason: !commentReplyEnabled
          ? "فعّل الرد الآلي على تعليقات هذه المنصة أولًا."
          : readinessMessage(readiness, platform, "comment"),
        posts: candidates.map(
          ({ id, title, products: productNames, eligibleCommentCount }) => ({
            id,
            title,
            products: productNames,
            eligibleCommentCount,
          }),
        ),
      };
    }
    res.json({ platforms });
  },
);

router.post(
  "/social/meta-auto-replies/historical-comments",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const platform = req.body?.platform;
    const postIds = req.body?.postIds;
    if (
      (platform !== "facebook" && platform !== "instagram") ||
      !Array.isArray(postIds) ||
      postIds.length < 1 ||
      postIds.length > 100 ||
      postIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      res.status(400).json({ error: "حدد منصة ومنشورات صالحة للمعالجة." });
      return;
    }
    const selectedPostIds = [
      ...new Set(
        postIds.filter((id: unknown): id is string => typeof id === "string"),
      ),
    ];
    if (selectedPostIds.length !== postIds.length) {
      res.status(400).json({ error: "تحتوي القائمة على منشورات مكررة." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
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
    const enabled = Boolean(
      settings?.enabled &&
        (platform === "facebook"
          ? settings.facebookCommentsEnabled
          : settings.instagramCommentsEnabled),
    );
    const readiness = await integrationReadiness(
      workspaceId,
      platform,
      connection,
    );
    const accountId =
      platform === "facebook"
        ? connection?.pageId
        : connection?.instagramUserId;
    if (!enabled || !readiness.commentsReady || !accountId) {
      res.status(409).json({
        error:
          "تعذر بدء المعالجة. تحقق من تفعيل الرد على تعليقات المنصة وصلاحية الحساب واشتراك Webhook.",
      });
      return;
    }
    const candidates = await historicalCommentCandidates(
      workspaceId,
      platform,
      accountId,
    );
    const selected = candidates.filter((post) =>
      selectedPostIds.includes(post.id),
    );
    if (
      selected.length !== selectedPostIds.length ||
      selected.some((post) => post.eligibleCommentCount === 0)
    ) {
      res.status(409).json({
        error:
          "تغيرت أهلية بعض المنشورات أو لم تعد تحتوي على تعليقات مؤهلة. حدّث القائمة وحاول مجددًا.",
      });
      return;
    }
    const totalEligibleComments = selected.reduce(
      (total, post) => total + post.eligibleCommentCount,
      0,
    );
    if (totalEligibleComments > historicalCommentBatchLimit) {
      res.status(400).json({
        error: `الحد الأقصى للدفعة ${historicalCommentBatchLimit} تعليقًا. قلل عدد المنشورات المحددة ثم أعد المحاولة.`,
      });
      return;
    }
    const inboxItemIds = selected.flatMap((post) => post.eligibleCommentIds);
    const queued = inboxItemIds.length
      ? await db
          .insert(menaMetaAutoReplyJobs)
          .values(
            inboxItemIds.map((inboxItemId) => ({
              id: randomUUID(),
              ownerId,
              workspaceId,
              inboxItemId,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: menaMetaAutoReplyJobs.id })
      : [];
    res.status(202).json({ queuedCount: queued.length });
  },
);

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
