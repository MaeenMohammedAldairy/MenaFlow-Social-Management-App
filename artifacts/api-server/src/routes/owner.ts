import { Router, type IRouter, type Request } from "express";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaConnections,
  menaMetaInboxItems,
  menaOrders,
  menaWhatsAppAutoReplyEvents,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessages,
  workspaceMembers,
  workspaceSubscriptions,
  workspaceSubscriptionUsage,
  workspaces,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { backgroundWorkerSnapshots } from "../lib/background-worker-loop";
import {
  clampOwnerLimit,
  ownerUsagePeriodKey,
  parseOwnerWindow,
  resolveOwnerConsoleAccess,
} from "../lib/owner-console";
import { isLocalAuthDisabled } from "../lib/owner-access";
import { logger } from "../lib/logger";

/**
 * Owner console API — internal, read-only.
 *
 * Every route here answers aggregate numbers and identifiers only: no customer
 * messages, no phone numbers, no encrypted bodies. Write actions are
 * deliberately absent: this surface exists to observe the platform, so a
 * leaked console session cannot change a workspace.
 */
const router: IRouter = Router();

const failedStatuses = ["failed", "unknown"] as const;

type AuthAttempt = { count: number; blockedUntil: number };
const authAttempts = new Map<string, AuthAttempt>();
const maxAuthFailures = 10;
const authFailureWindowMs = 5 * 60_000;
const authBlockMs = 10 * 60_000;

function authAttemptKey(req: Request): string {
  return req.ip ?? "unknown";
}

function isBlocked(key: string): boolean {
  const attempt = authAttempts.get(key);
  if (!attempt) return false;
  if (attempt.blockedUntil > Date.now()) return true;
  if (attempt.blockedUntil !== 0) authAttempts.delete(key);
  return false;
}

function recordAuthFailure(key: string) {
  const attempt = authAttempts.get(key) ?? { count: 0, blockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= maxAuthFailures) {
    attempt.count = 0;
    attempt.blockedUntil = Date.now() + authBlockMs;
  }
  authAttempts.set(key, attempt);
}

/** Gate for every console request; also mounted on the session probe. */
router.use((req, res, next) => {
  const key = authAttemptKey(req);
  if (isBlocked(key)) {
    res.status(429).json({ error: "محاولات دخول كثيرة. انتظر عشر دقائق." });
    return;
  }
  const access = resolveOwnerConsoleAccess({
    userId: isLocalAuthDisabled() ? null : (getAuth(req).userId ?? null),
    authorization: req.get("authorization") ?? undefined,
  });
  if (access.mode === "disabled") {
    // Behave exactly like a route that does not exist.
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!access.allowed) {
    recordAuthFailure(key);
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="owner-console"')
      .json({ error: "تحتاج صلاحية مالك المشروع." });
    return;
  }
  authAttempts.delete(key);
  res.locals["ownerMode"] = access.mode;
  next();
});

router.get("/session", (req, res) => {
  res.json({
    mode: res.locals["ownerMode"],
    scope: "read-only",
    serverTime: new Date().toISOString(),
  });
});

function intValue(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : 0;
}

router.get("/overview", async (_req, res) => {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const periodKey = ownerUsagePeriodKey(now);

  const [
    workspaceTotals,
    plans,
    statuses,
    usage,
    whatsappConnections,
    metaConnections,
    orderTotals,
    metaInbox24h,
    directMessages24h,
    whatsappAutoReplies,
    metaAutoReplies,
    whatsappBacklog,
    metaBacklog,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        last30: sql<number>`(count(*) filter (where ${workspaces.createdAt} >= ${since30d}))::int`,
      })
      .from(workspaces),
    db
      .select({ planId: workspaceSubscriptions.planId, total: count() })
      .from(workspaceSubscriptions)
      .groupBy(workspaceSubscriptions.planId),
    db
      .select({ status: workspaceSubscriptions.status, total: count() })
      .from(workspaceSubscriptions)
      .groupBy(workspaceSubscriptions.status),
    db
      .select({
        aiGenerations: sql<number>`coalesce(sum(${workspaceSubscriptionUsage.aiGenerations}), 0)::int`,
        postsCreated: sql<number>`coalesce(sum(${workspaceSubscriptionUsage.postsCreated}), 0)::int`,
      })
      .from(workspaceSubscriptionUsage)
      .where(eq(workspaceSubscriptionUsage.periodKey, periodKey)),
    db
      .select({
        total: count(),
        autoReplyEnabled: sql<number>`(count(*) filter (where ${menaWhatsAppConnections.autoReplyEnabled}))::int`,
      })
      .from(menaWhatsAppConnections),
    db
      .select({
        total: count(),
        expired: sql<number>`(count(*) filter (where ${menaMetaConnections.accessTokenExpiresAt} is not null and ${menaMetaConnections.accessTokenExpiresAt} <= ${now}))::int`,
      })
      .from(menaMetaConnections),
    db
      .select({
        total: count(),
        last30: sql<number>`(count(*) filter (where ${menaOrders.createdAt} >= ${since30d}))::int`,
      })
      .from(menaOrders),
    db
      .select({ total: count() })
      .from(menaMetaInboxItems)
      .where(gte(menaMetaInboxItems.createdAt, since24h)),
    db
      .select({ total: count() })
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.direction, "inbound"),
          gte(menaWhatsAppDirectMessages.createdAt, since24h),
        ),
      ),
    db
      .select({ status: menaWhatsAppAutoReplyEvents.status, total: count() })
      .from(menaWhatsAppAutoReplyEvents)
      .where(gte(menaWhatsAppAutoReplyEvents.createdAt, since24h))
      .groupBy(menaWhatsAppAutoReplyEvents.status),
    db
      .select({ status: menaMetaAutoReplyJobs.status, total: count() })
      .from(menaMetaAutoReplyJobs)
      .where(gte(menaMetaAutoReplyJobs.createdAt, since24h))
      .groupBy(menaMetaAutoReplyJobs.status),
    db
      .select({ total: count() })
      .from(menaWhatsAppAutoReplyEvents)
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.status, "queued"),
          lte(menaWhatsAppAutoReplyEvents.nextRunAt, now),
        ),
      ),
    db
      .select({ total: count() })
      .from(menaMetaAutoReplyJobs)
      .where(
        and(
          eq(menaMetaAutoReplyJobs.status, "queued"),
          lte(menaMetaAutoReplyJobs.nextRunAt, now),
        ),
      ),
  ]);

  res.json({
    generatedAt: now.toISOString(),
    period: periodKey,
    workspaces: {
      total: intValue(workspaceTotals[0]?.total),
      last30Days: intValue(workspaceTotals[0]?.last30),
      byPlan: plans.map((plan) => ({
        planId: plan.planId,
        total: intValue(plan.total),
      })),
      byStatus: statuses.map((status) => ({
        status: status.status,
        total: intValue(status.total),
      })),
    },
    usage: {
      aiGenerations: intValue(usage[0]?.aiGenerations),
      postsCreated: intValue(usage[0]?.postsCreated),
    },
    channels: {
      whatsapp: {
        total: intValue(whatsappConnections[0]?.total),
        autoReplyEnabled: intValue(whatsappConnections[0]?.autoReplyEnabled),
      },
      meta: {
        total: intValue(metaConnections[0]?.total),
        expiredTokens: intValue(metaConnections[0]?.expired),
      },
    },
    orders: {
      total: intValue(orderTotals[0]?.total),
      last30Days: intValue(orderTotals[0]?.last30),
    },
    inbox: {
      metaItems24h: intValue(metaInbox24h[0]?.total),
      whatsappInbound24h: intValue(directMessages24h[0]?.total),
    },
    autoReplies: {
      whatsapp24h: whatsappAutoReplies.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
      meta24h: metaAutoReplies.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
      backlog: {
        whatsapp: intValue(whatsappBacklog[0]?.total),
        meta: intValue(metaBacklog[0]?.total),
      },
    },
  });
});

router.get("/auto-replies", async (req, res) => {
  const window = parseOwnerWindow(req.query["window"]);
  const now = new Date();

  const [whatsappStatuses, whatsappErrors, metaStatuses, metaErrors] =
    await Promise.all([
      db
        .select({ status: menaWhatsAppAutoReplyEvents.status, total: count() })
        .from(menaWhatsAppAutoReplyEvents)
        .where(gte(menaWhatsAppAutoReplyEvents.createdAt, window.since))
        .groupBy(menaWhatsAppAutoReplyEvents.status),
      db
        .select({
          errorCode: menaWhatsAppAutoReplyEvents.errorCode,
          total: count(),
        })
        .from(menaWhatsAppAutoReplyEvents)
        .where(
          and(
            gte(menaWhatsAppAutoReplyEvents.createdAt, window.since),
            isNotNull(menaWhatsAppAutoReplyEvents.errorCode),
          ),
        )
        .groupBy(menaWhatsAppAutoReplyEvents.errorCode)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({ status: menaMetaAutoReplyJobs.status, total: count() })
        .from(menaMetaAutoReplyJobs)
        .where(gte(menaMetaAutoReplyJobs.createdAt, window.since))
        .groupBy(menaMetaAutoReplyJobs.status),
      db
        .select({ errorCode: menaMetaAutoReplyJobs.errorCode, total: count() })
        .from(menaMetaAutoReplyJobs)
        .where(
          and(
            gte(menaMetaAutoReplyJobs.createdAt, window.since),
            isNotNull(menaMetaAutoReplyJobs.errorCode),
          ),
        )
        .groupBy(menaMetaAutoReplyJobs.errorCode)
        .orderBy(desc(count()))
        .limit(10),
    ]);

  const [whatsappBacklog, metaBacklog, whatsappOldest, metaOldest] =
    await Promise.all([
      db
        .select({ total: count() })
        .from(menaWhatsAppAutoReplyEvents)
        .where(
          and(
            eq(menaWhatsAppAutoReplyEvents.status, "queued"),
            lte(menaWhatsAppAutoReplyEvents.nextRunAt, now),
          ),
        ),
      db
        .select({ total: count() })
        .from(menaMetaAutoReplyJobs)
        .where(
          and(
            eq(menaMetaAutoReplyJobs.status, "queued"),
            lte(menaMetaAutoReplyJobs.nextRunAt, now),
          ),
        ),
      db
        .select({
          oldest: sql<string | null>`min(${menaWhatsAppAutoReplyEvents.nextRunAt})`,
        })
        .from(menaWhatsAppAutoReplyEvents)
        .where(eq(menaWhatsAppAutoReplyEvents.status, "queued")),
      db
        .select({
          oldest: sql<string | null>`min(${menaMetaAutoReplyJobs.nextRunAt})`,
        })
        .from(menaMetaAutoReplyJobs)
        .where(eq(menaMetaAutoReplyJobs.status, "queued")),
    ]);

  const [whatsappRecent, metaRecent] = await Promise.all([
    db
      .select({
        id: menaWhatsAppAutoReplyEvents.id,
        workspaceId: menaWhatsAppAutoReplyEvents.workspaceId,
        workspaceName: workspaces.name,
        status: menaWhatsAppAutoReplyEvents.status,
        errorCode: menaWhatsAppAutoReplyEvents.errorCode,
        completedAt: menaWhatsAppAutoReplyEvents.completedAt,
      })
      .from(menaWhatsAppAutoReplyEvents)
      .leftJoin(
        workspaces,
        eq(workspaces.id, menaWhatsAppAutoReplyEvents.workspaceId),
      )
      .where(
        and(
          gte(menaWhatsAppAutoReplyEvents.createdAt, window.since),
          inArray(menaWhatsAppAutoReplyEvents.status, failedStatuses),
        ),
      )
      .orderBy(desc(menaWhatsAppAutoReplyEvents.createdAt))
      .limit(15),
    db
      .select({
        id: menaMetaAutoReplyJobs.id,
        workspaceId: menaMetaAutoReplyJobs.workspaceId,
        workspaceName: workspaces.name,
        status: menaMetaAutoReplyJobs.status,
        errorCode: menaMetaAutoReplyJobs.errorCode,
        completedAt: menaMetaAutoReplyJobs.completedAt,
      })
      .from(menaMetaAutoReplyJobs)
      .leftJoin(workspaces, eq(workspaces.id, menaMetaAutoReplyJobs.workspaceId))
      .where(
        and(
          gte(menaMetaAutoReplyJobs.createdAt, window.since),
          inArray(menaMetaAutoReplyJobs.status, failedStatuses),
        ),
      )
      .orderBy(desc(menaMetaAutoReplyJobs.createdAt))
      .limit(15),
  ]);

  res.json({
    window: window.key,
    since: window.since.toISOString(),
    whatsapp: {
      byStatus: whatsappStatuses.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
      topErrors: whatsappErrors.map((row) => ({
        errorCode: row.errorCode ?? "—",
        total: intValue(row.total),
      })),
      backlog: intValue(whatsappBacklog[0]?.total),
      oldestPendingAt: whatsappOldest[0]?.oldest ?? null,
      recentFailures: whatsappRecent,
    },
    meta: {
      byStatus: metaStatuses.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
      topErrors: metaErrors.map((row) => ({
        errorCode: row.errorCode ?? "—",
        total: intValue(row.total),
      })),
      backlog: intValue(metaBacklog[0]?.total),
      oldestPendingAt: metaOldest[0]?.oldest ?? null,
      recentFailures: metaRecent,
    },
  });
});

router.get("/workers", async (_req, res) => {
  const startedAt = Date.now();
  let databaseMs: number | null = null;
  let databaseOk = false;
  try {
    await db.execute(sql`select 1`);
    databaseMs = Date.now() - startedAt;
    databaseOk = true;
  } catch (error) {
    logger.error({ err: error }, "Owner console database probe failed");
  }
  const workers = backgroundWorkerSnapshots();
  res.json({
    generatedAt: new Date().toISOString(),
    database: { ok: databaseOk, latencyMs: databaseMs },
    workers,
    attention: workers.filter(
      (worker) => worker.stale || worker.consecutiveErrors > 0,
    ).length,
  });
});

router.get("/workspaces", async (req, res) => {
  const limit = clampOwnerLimit(req.query["limit"]);
  const search =
    typeof req.query["search"] === "string"
      ? req.query["search"].trim().slice(0, 80)
      : "";
  const periodKey = ownerUsagePeriodKey();

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      createdBy: workspaces.createdBy,
    })
    .from(workspaces)
    .where(search ? ilike(workspaces.name, `%${search}%`) : undefined)
    .orderBy(desc(workspaces.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map((row) => row.id);

  if (ids.length === 0) {
    res.json({ items: [], hasMore: false });
    return;
  }

  const [subscriptions, usage, members, whatsapp, meta] = await Promise.all([
    db
      .select({
        workspaceId: workspaceSubscriptions.workspaceId,
        planId: workspaceSubscriptions.planId,
        status: workspaceSubscriptions.status,
        trialEndsAt: workspaceSubscriptions.trialEndsAt,
      })
      .from(workspaceSubscriptions)
      .where(inArray(workspaceSubscriptions.workspaceId, ids)),
    db
      .select({
        workspaceId: workspaceSubscriptionUsage.workspaceId,
        aiGenerations: workspaceSubscriptionUsage.aiGenerations,
        postsCreated: workspaceSubscriptionUsage.postsCreated,
      })
      .from(workspaceSubscriptionUsage)
      .where(
        and(
          inArray(workspaceSubscriptionUsage.workspaceId, ids),
          eq(workspaceSubscriptionUsage.periodKey, periodKey),
        ),
      ),
    db
      .select({ workspaceId: workspaceMembers.workspaceId, total: count() })
      .from(workspaceMembers)
      .where(inArray(workspaceMembers.workspaceId, ids))
      .groupBy(workspaceMembers.workspaceId),
    db
      .select({
        workspaceId: menaWhatsAppConnections.workspaceId,
        instanceName: menaWhatsAppConnections.instanceName,
        status: menaWhatsAppConnections.status,
        autoReplyEnabled: menaWhatsAppConnections.autoReplyEnabled,
      })
      .from(menaWhatsAppConnections)
      .where(inArray(menaWhatsAppConnections.workspaceId, ids)),
    db
      .select({
        workspaceId: menaMetaConnections.workspaceId,
        pageName: menaMetaConnections.pageName,
        accessTokenExpiresAt: menaMetaConnections.accessTokenExpiresAt,
      })
      .from(menaMetaConnections)
      .where(inArray(menaMetaConnections.workspaceId, ids)),
  ]);

  res.json({
    hasMore,
    items: page.map((row) => {
      const subscription = subscriptions.find(
        (entry) => entry.workspaceId === row.id,
      );
      const usageRow = usage.find((entry) => entry.workspaceId === row.id);
      const connection = whatsapp.find((entry) => entry.workspaceId === row.id);
      const metaRow = meta.find((entry) => entry.workspaceId === row.id);
      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        planId: subscription?.planId ?? null,
        subscriptionStatus: subscription?.status ?? null,
        trialEndsAt: subscription?.trialEndsAt ?? null,
        members: intValue(
          members.find((entry) => entry.workspaceId === row.id)?.total,
        ),
        aiGenerations: intValue(usageRow?.aiGenerations),
        postsCreated: intValue(usageRow?.postsCreated),
        whatsapp: connection
          ? {
              instanceName: connection.instanceName,
              status: connection.status,
              autoReplyEnabled: connection.autoReplyEnabled,
            }
          : null,
        metaPage: metaRow?.pageName ?? null,
      };
    }),
  });
});

router.get("/workspaces/:id", async (req, res) => {
  const workspaceId = req.params["id"] ?? "";
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      createdBy: workspaces.createdBy,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    res.status(404).json({ error: "المساحة غير موجودة." });
    return;
  }

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const periodKey = ownerUsagePeriodKey();
  const [
    subscription,
    usage,
    members,
    whatsapp,
    meta,
    orders,
    whatsappReplies,
    metaReplies,
  ] = await Promise.all([
    db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(workspaceSubscriptionUsage)
      .where(
        and(
          eq(workspaceSubscriptionUsage.workspaceId, workspaceId),
          eq(workspaceSubscriptionUsage.periodKey, periodKey),
        ),
      )
      .limit(1),
    db
      .select({ total: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db
      .select({
        instanceName: menaWhatsAppConnections.instanceName,
        status: menaWhatsAppConnections.status,
        autoReplyEnabled: menaWhatsAppConnections.autoReplyEnabled,
        autoReplyLanguage: menaWhatsAppConnections.autoReplyLanguage,
        autoReplyTestedHash: menaWhatsAppConnections.autoReplyTestedHash,
        connectedAt: menaWhatsAppConnections.connectedAt,
      })
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
      .limit(1),
    db
      .select({
        pageName: menaMetaConnections.pageName,
        instagramUsername: menaMetaConnections.instagramUsername,
        accessTokenExpiresAt: menaMetaConnections.accessTokenExpiresAt,
        authorizationVerifiedAt: menaMetaConnections.authorizationVerifiedAt,
      })
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId)),
    db
      .select({ total: count() })
      .from(menaOrders)
      .where(eq(menaOrders.workspaceId, workspaceId)),
    db
      .select({ status: menaWhatsAppAutoReplyEvents.status, total: count() })
      .from(menaWhatsAppAutoReplyEvents)
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.workspaceId, workspaceId),
          gte(menaWhatsAppAutoReplyEvents.createdAt, since7d),
        ),
      )
      .groupBy(menaWhatsAppAutoReplyEvents.status),
    db
      .select({ status: menaMetaAutoReplyJobs.status, total: count() })
      .from(menaMetaAutoReplyJobs)
      .where(
        and(
          eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
          gte(menaMetaAutoReplyJobs.createdAt, since7d),
        ),
      )
      .groupBy(menaMetaAutoReplyJobs.status),
  ]);

  res.json({
    workspace,
    subscription: subscription[0] ?? null,
    usage: {
      period: periodKey,
      aiGenerations: intValue(usage[0]?.aiGenerations),
      postsCreated: intValue(usage[0]?.postsCreated),
    },
    members: intValue(members[0]?.total),
    whatsapp: whatsapp[0]
      ? {
          instanceName: whatsapp[0].instanceName,
          status: whatsapp[0].status,
          autoReplyEnabled: whatsapp[0].autoReplyEnabled,
          autoReplyLanguage: whatsapp[0].autoReplyLanguage,
          autoReplyTested: Boolean(whatsapp[0].autoReplyTestedHash),
          connectedAt: whatsapp[0].connectedAt,
        }
      : null,
    meta: meta,
    orders: intValue(orders[0]?.total),
    autoReplies7d: {
      whatsapp: whatsappReplies.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
      meta: metaReplies.map((row) => ({
        status: row.status,
        total: intValue(row.total),
      })),
    },
  });
});

export default router;
