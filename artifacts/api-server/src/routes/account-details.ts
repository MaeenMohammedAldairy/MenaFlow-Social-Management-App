import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  menaMetaConnections,
  menaPostActivityEvents,
  menaWhatsAppConnections,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessages,
  menaWhatsAppSyncStates,
  posts,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { metaConnectionAccessToken } from "../lib/meta-connection-token.ts";
import { asRecord } from "../lib/value-utils.ts";
import { getMetaGraphVersion } from "../lib/meta-graph-config";
import { EvolutionApiError, evolutionConnectionState } from "../lib/whatsapp-evolution";
import { evolutionErrorResponse } from "./whatsapp-route-errors";
import { buildFacebookPerformance } from "../lib/facebook-performance";

const router: IRouter = Router();
const GRAPH_VERSION = getMetaGraphVersion();
const INSIGHTS_DAYS = 28;

type AccountPlatform = "facebook" | "instagram" | "whatsapp";
type AccountMetric = { key: string; label: string; value: number; period?: string };
type AccountPost = {
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  imageUrl: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
};

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function graphRequest(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.search = new URLSearchParams({ ...params, access_token: accessToken }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = asRecord(payload);
  const graphError = asRecord(record?.error);
  if (!response.ok || graphError) {
    const message = stringValue(graphError?.message);
    throw new Error(message || `Meta Graph API returned HTTP ${response.status}.`);
  }
  if (!record) throw new Error("أعادت Meta استجابة غير صالحة.");
  return record;
}

function extractCount(value: unknown): number | null {
  const summary = asRecord(asRecord(value)?.summary);
  return numberValue(summary?.total_count);
}

function profilePicture(value: unknown): string | null {
  const data = asRecord(asRecord(value)?.data);
  return stringValue(data?.url);
}

function insightsMetrics(
  response: Record<string, unknown>,
  labels: Record<string, string>,
): AccountMetric[] {
  if (!Array.isArray(response.data)) return [];
  const metrics: AccountMetric[] = [];
  for (const entryValue of response.data) {
    const entry = asRecord(entryValue);
    const name = stringValue(entry?.name);
    if (!name || !labels[name] || !Array.isArray(entry?.values)) continue;
    const values = entry.values
      .map((item) => numberValue(asRecord(item)?.value))
      .filter((value): value is number => value !== null);
    const totalValue = numberValue(asRecord(entry.total_value)?.value);
    if (values.length === 0 && totalValue === null) continue;
    metrics.push({
      key: name,
      label: labels[name],
      value:
        totalValue ??
        values.reduce((total, value) => total + value, 0),
      period:
        totalValue === null
          ? `مجموع القيم اليومية خلال آخر ${INSIGHTS_DAYS} يومًا`
          : `آخر ${INSIGHTS_DAYS} يومًا`,
    });
  }
  return metrics;
}

function mapMetaPost(value: unknown): AccountPost | null {
  const post = asRecord(value);
  const id = stringValue(post?.id);
  if (!id) return null;
  const likes = extractCount(post?.likes);
  const comments = extractCount(post?.comments);
  return {
    id,
    text: stringValue(post?.message) ?? stringValue(post?.caption) ?? "",
    publishedAt: stringValue(post?.created_time) ?? stringValue(post?.timestamp),
    url: stringValue(post?.permalink_url) ?? stringValue(post?.permalink),
    imageUrl: stringValue(post?.full_picture) ?? stringValue(post?.thumbnail_url),
    likes: likes ?? numberValue(post?.like_count),
    comments: comments ?? numberValue(post?.comments_count),
    views: null,
  };
}

function facebookReadIssue(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/valid insights metric/i.test(message)) {
    return "بعض مقاييس الصفحة غير متاحة من Meta حاليًا؛ عُرضت المقاييس التي أمكن جلبها فقط.";
  }
  if (/failed to fetch|fetch failed|network request failed/i.test(message)) {
    return "تعذّر الاتصال بخدمة Meta لجلب بعض البيانات؛ عُرضت البيانات المتاحة فقط.";
  }
  return message || fallback;
}

async function loadGrantedPermissions(accessToken: string): Promise<string[] | null> {
  const appId = (process.env.FACEBOOK_APP_ID || process.env.VITE_META_APP_ID || "").trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  // Use POST + Authorization header so the app secret never appears in the URL
  // (query-string params leak into proxy/CDN/access logs)
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
  url.searchParams.set("input_token", accessToken);
  const appAccessToken = `${appId}|${appSecret}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      // Graph API accepts the app-access-token in the Authorization header
      Authorization: `Bearer ${appAccessToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || asRecord(asRecord(payload)?.error)) {
    throw new Error("تعذّر التحقق من صلاحيات حساب Meta.");
  }
  const data = asRecord(asRecord(payload)?.data);
  return Array.isArray(data?.scopes)
    ? data.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
}

async function facebookDetails(connection: typeof menaMetaConnections.$inferSelect) {
  const accessToken = await metaConnectionAccessToken(connection);
  const issues: string[] = [];
  const permissionsNeeded = [
    "pages_read_engagement",
    "pages_manage_posts",
    "read_insights",
  ];
  const since = Math.floor(Date.now() / 1000) - INSIGHTS_DAYS * 24 * 60 * 60;
  const until = Math.floor(Date.now() / 1000);

  const profile = await graphRequest(
    encodeURIComponent(connection.pageId),
    accessToken,
    { fields: "id,name,picture.type(large),cover,category,about,description,link,fan_count,followers_count" },
  );
  let grantedPermissions: string[] | null = null;
  try {
    grantedPermissions = await loadGrantedPermissions(accessToken);
  } catch (error) {
    issues.push(facebookReadIssue(error, "تعذّر تحميل صلاحيات الحساب."));
  }

  const requestedMetrics = [
    ["page_impressions", "مرات الظهور"],
    ["page_post_engagements", "التفاعل"],
    ["page_fan_adds_unique", "نمو المتابعين"],
  ] as const;
  const metricResults = await Promise.all(
    requestedMetrics.map(async ([name, label]) => {
      try {
        const response = await graphRequest(
          `${encodeURIComponent(connection.pageId)}/insights`,
          accessToken,
          {
            metric: name,
            period: "day",
            since: String(since),
            until: String(until),
          },
        );
        return {
          metrics: insightsMetrics(response, { [name]: label }),
          issue: null,
        };
      } catch (error) {
        return {
          metrics: [],
          issue: facebookReadIssue(error, "تعذّر تحميل بعض إحصاءات فيسبوك."),
        };
      }
    }),
  );
  const metrics = metricResults.flatMap((result) => result.metrics);
  issues.push(
    ...new Set(
      metricResults
        .map((result) => result.issue)
        .filter((issue): issue is string => issue !== null),
    ),
  );

  let posts: AccountPost[] = [];
  try {
    const result = await graphRequest(
      `${encodeURIComponent(connection.pageId)}/published_posts`,
      accessToken,
      {
        fields: "id,message,created_time,permalink_url,full_picture,likes.summary(true),comments.summary(true)",
        limit: "25",
      },
    );
    posts = Array.isArray(result.data)
      ? result.data.map(mapMetaPost).filter((post): post is AccountPost => post !== null)
      : [];
  } catch (error) {
    issues.push(facebookReadIssue(error, "تعذّر تحميل منشورات فيسبوك."));
  }

  const granted = new Set(grantedPermissions ?? []);
  const missingPermissions = grantedPermissions
    ? permissionsNeeded.filter((permission) => !granted.has(permission))
    : [];
  const metricsWithProfile = [
    { key: "followers", label: "المتابعون", value: numberValue(profile.followers_count) ?? numberValue(profile.fan_count) },
    ...metrics.map((metric) => ({ ...metric, period: metric.period })),
  ].filter((metric): metric is AccountMetric => metric.value !== null);

  return {
    platform: "facebook" as const,
    accountId: connection.pageId,
    accountName: stringValue(profile.name) ?? connection.pageName,
    connectedAt: connection.connectedAt.toISOString(),
    connectionState: "connected",
    profileImageUrl: profilePicture(profile.picture),
    coverImageUrl: stringValue(asRecord(profile.cover)?.source),
    externalUrl: stringValue(profile.link),
    category: stringValue(profile.category),
    description: stringValue(profile.about) ?? stringValue(profile.description),
    lastSyncedAt: new Date().toISOString(),
    permissions: { required: permissionsNeeded, granted: grantedPermissions, missing: missingPermissions },
    metrics: metricsWithProfile,
    posts,
    issues: [...new Set(issues)],
  };
}

async function facebookDetailsWithFallback(
  connection: typeof menaMetaConnections.$inferSelect,
) {
  try {
    return await facebookDetails(connection);
  } catch (error) {
    const issue = facebookReadIssue(error, "تعذّر التحقق من بيانات صفحة Facebook.");
    console.error("Unable to refresh Facebook profile details:", {
      pageId: connection.pageId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      platform: "facebook" as const,
      accountId: connection.pageId,
      accountName: connection.pageName,
      connectedAt: connection.connectedAt.toISOString(),
      connectionState: "connected",
      profileImageUrl: null,
      coverImageUrl: null,
      externalUrl: null,
      category: null,
      description: null,
      lastSyncedAt: null,
      permissions: {
        required: ["pages_read_engagement", "pages_manage_posts", "read_insights"],
        granted: null,
        missing: [],
      },
      metrics: [],
      posts: [],
      issues: [issue],
    };
  }
}

async function loadFacebookPerformance(ownerId: string, workspaceId: string, accountId: string) {
  const [accountPosts, activity] = await Promise.all([
    db
      .select({
        id: posts.id,
        workspaceId: posts.workspaceId,
        title: posts.title,
        status: posts.status,
        channels: posts.channels,
        publishResults: posts.publishResults,
        metadata: posts.metadata,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(eq(posts.workspaceId, workspaceId)),
    db
      .select({
        id: menaPostActivityEvents.id,
        postId: menaPostActivityEvents.postId,
        workspaceId: menaPostActivityEvents.workspaceId,
        accountId: menaPostActivityEvents.accountId,
        channel: menaPostActivityEvents.channel,
        eventType: menaPostActivityEvents.eventType,
        actorId: menaPostActivityEvents.actorId,
        occurredAt: menaPostActivityEvents.occurredAt,
        details: menaPostActivityEvents.details,
        title: posts.title,
      })
      .from(menaPostActivityEvents)
      .innerJoin(
        posts,
        and(
          eq(posts.id, menaPostActivityEvents.postId),
          eq(posts.workspaceId, workspaceId),
          eq(menaPostActivityEvents.workspaceId, workspaceId),
        ),
      )
      .where(and(
        eq(menaPostActivityEvents.workspaceId, workspaceId),
        eq(menaPostActivityEvents.accountId, accountId),
        eq(menaPostActivityEvents.channel, "facebook"),
      ))
      .orderBy(desc(menaPostActivityEvents.occurredAt)),
  ]);
  return buildFacebookPerformance(accountPosts, activity, accountId, ownerId, workspaceId);
}

async function instagramDetails(connection: typeof menaMetaConnections.$inferSelect) {
  if (!connection.instagramUserId || !connection.instagramUsername) {
    const error = new Error("لم يُربط حساب Instagram احترافي بصفحة Meta. أعد ربط صفحة Facebook التي تدير الحساب.");
    Object.assign(error, { statusCode: 404 });
    throw error;
  }
  const accessToken = await metaConnectionAccessToken(connection);
  const accountId = connection.instagramUserId;
  const permissionsNeeded = ["instagram_basic", "instagram_manage_insights"];
  const issues: string[] = [];
  const profile = await graphRequest(encodeURIComponent(accountId), accessToken, {
    fields: "id,username,name,profile_picture_url,biography,website,followers_count,follows_count,media_count",
  });
  let grantedPermissions: string[] | null = null;
  try {
    grantedPermissions = await loadGrantedPermissions(accessToken);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "تعذّر تحميل صلاحيات الحساب.");
  }

  let posts: AccountPost[] = [];
  try {
    const result = await graphRequest(`${encodeURIComponent(accountId)}/media`, accessToken, {
      fields: "id,caption,media_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url",
      limit: "25",
    });
    posts = Array.isArray(result.data)
      ? result.data.map(mapMetaPost).filter((post): post is AccountPost => post !== null)
      : [];
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "تعذّر تحميل منشورات Instagram.");
  }

  let insightMetrics: AccountMetric[] = [];
  try {
    const since = Math.floor(Date.now() / 1000) - INSIGHTS_DAYS * 24 * 60 * 60;
    const until = Math.floor(Date.now() / 1000);
    const result = await graphRequest(`${encodeURIComponent(accountId)}/insights`, accessToken, {
      metric: "reach,profile_views,total_interactions",
      period: "day",
      metric_type: "total_value",
      since: String(since),
      until: String(until),
    });
    insightMetrics = insightsMetrics(result, {
      reach: "الوصول",
      profile_views: "مشاهدات الملف",
      total_interactions: "التفاعلات",
    });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "تعذّر تحميل إحصاءات Instagram.");
  }

  const granted = new Set(grantedPermissions ?? []);
  const missingPermissions = grantedPermissions
    ? permissionsNeeded.filter((permission) => !granted.has(permission))
    : [];
  return {
    platform: "instagram" as const,
    accountId,
    accountName: stringValue(profile.username) ?? connection.instagramUsername,
    connectedAt: connection.connectedAt.toISOString(),
    connectionState: "connected",
    profileImageUrl: stringValue(profile.profile_picture_url),
    externalUrl: stringValue(profile.website),
    description: stringValue(profile.biography),
    lastSyncedAt: new Date().toISOString(),
    permissions: { required: permissionsNeeded, granted: grantedPermissions, missing: missingPermissions },
    metrics: [
      { key: "followers", label: "المتابعون", value: numberValue(profile.followers_count) },
      { key: "following", label: "يتابع", value: numberValue(profile.follows_count) },
      { key: "media", label: "المنشورات", value: numberValue(profile.media_count) },
      ...insightMetrics,
    ].filter((metric): metric is AccountMetric => metric.value !== null),
    posts,
    issues,
  };
}

async function whatsappDetails(workspaceId: string) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) {
    const error = new Error("حساب واتساب غير مربوط.");
    Object.assign(error, { statusCode: 404 });
    throw error;
  }

  let providerState: string;
  try {
    providerState = await evolutionConnectionState(connection.instanceName);
  } catch (error) {
    if (error instanceof EvolutionApiError && error.statusCode === 404) {
      providerState = "missing";
    } else {
      console.warn("Unable to verify WhatsApp account details", {
        workspaceId,
        statusCode: error instanceof EvolutionApiError ? error.statusCode : null,
      });
      providerState = "unavailable";
    }
  }
  const connected = providerState === "open";
  const connectionState =
    connected
      ? "connected"
      : providerState === "missing"
        ? "missing"
        : providerState === "connecting"
          ? "connecting"
          : ["close", "closed", "refused", "logout"].includes(providerState)
            ? "disconnected"
            : "unavailable";

  const [groups, syncStates, messageCount, latestMessages] = await Promise.all([
    db
      .select({
        groupJid: menaWhatsAppGroupSelections.groupJid,
        groupName: menaWhatsAppGroupSelections.groupName,
      })
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      ),
    db
      .select({
        lastSyncedAt: sql<Date | null>`max(${menaWhatsAppSyncStates.lastSyncedAt})`,
      })
      .from(menaWhatsAppSyncStates)
      .where(
        and(
          eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
          eq(menaWhatsAppSyncStates.instanceName, connection.instanceName),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(menaWhatsAppMessages)
      .where(
        and(
          eq(menaWhatsAppMessages.workspaceId, workspaceId),
          eq(menaWhatsAppMessages.instanceName, connection.instanceName),
        ),
      ),
    db
      .select()
      .from(menaWhatsAppMessages)
      .where(
        and(
          eq(menaWhatsAppMessages.workspaceId, workspaceId),
          eq(menaWhatsAppMessages.instanceName, connection.instanceName),
        ),
      )
      .orderBy(desc(menaWhatsAppMessages.messageTimestamp), desc(menaWhatsAppMessages.createdAt))
      .limit(20),
  ]);

  const groupNames = new Map(groups.map((group) => [group.groupJid, group.groupName]));
  const messageCountValue = messageCount[0]?.count ?? 0;
  const lastSyncedAt = syncStates[0]?.lastSyncedAt;
  return {
    platform: "whatsapp" as const,
    accountId: connection.instanceName,
    accountName: connection.phoneNumber ?? connection.instanceName,
    connectedAt: connection.connectedAt.toISOString(),
    connectionState,
    profileImageUrl: null,
    externalUrl: null,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    autoSyncEnabled: connection.autoSyncEnabled,
    permissions: {
      required: ["اتصال واتساب نشط", "اختيار مجموعات الرسائل"],
      granted:
        connected
          ? ["اتصال واتساب نشط", ...(groups.length > 0 ? ["الوصول إلى المجموعات المحددة"] : [])]
          : [],
      missing:
        connected
          ? groups.length === 0
            ? ["لم يتم اختيار مجموعات للمزامنة"]
            : []
          : ["اتصال واتساب نشط"],
    },
    metrics: [
      { key: "messages", label: "الرسائل المحفوظة", value: messageCountValue },
      { key: "groups", label: "المجموعات المحددة", value: groups.length },
    ],
    groups: groups.map((group) => ({ groupJid: group.groupJid, groupName: group.groupName })),
    messages: latestMessages.map((message) => ({
      id: message.id,
      groupName: groupNames.get(message.groupJid) ?? message.groupJid,
      text: message.textBody ?? message.caption ?? "",
      messageType: message.messageType,
      sentAt: message.messageTimestamp?.toISOString() ?? message.createdAt.toISOString(),
      source: message.source,
    })),
    issues: [],
  };
}

router.get("/social/account-details/:platform", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const platform = Array.isArray(req.params.platform) ? req.params.platform[0] : req.params.platform;
  if (platform !== "facebook" && platform !== "instagram" && platform !== "whatsapp") {
    res.status(400).json({ error: "منصة الحساب غير صالحة." });
    return;
  }

  try {
    if (platform === "whatsapp") {
      res.json(await whatsappDetails(workspaceId));
      return;
    }

    const [connection] = await db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection || (platform === "instagram" && !connection.instagramUserId)) {
      res.status(404).json({ error: "هذا الحساب غير مربوط بمساحة العمل." });
      return;
    }
    if (platform === "facebook") {
      const [details, performance] = await Promise.all([
        facebookDetailsWithFallback(connection),
        loadFacebookPerformance(ownerId, workspaceId, connection.pageId),
      ]);
      res.json({ ...details, performance });
      return;
    }
    res.json(await instagramDetails(connection));
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      evolutionErrorResponse(res, error, "Unable to load WhatsApp account details");
      return;
    }
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 502;
    console.error("Error loading social account details:", {
      platform,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : "تعذّر تحميل تفاصيل الحساب.",
    });
  }
});

export default router;
