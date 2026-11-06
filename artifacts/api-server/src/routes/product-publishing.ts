import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaConnections,
  productPublicationJobs,
  products,
} from "@workspace/db";
import { missingMetaIntegrationPermissions } from "../lib/meta-oauth";
import { buildProductPublicationMatrix, type ProductPublicationTarget } from "../lib/product-publishing-logic";
import { requireWorkspace, requestWorkspaceId, requestWorkspaceUserId } from "../lib/workspace-context";
import { requestOwnerId } from "../lib/owner-access";
import { processProductPublicationQueue } from "../lib/product-publishing";

const router = Router();
const MAX_PUBLISH_PRODUCTS = 50;

type Channel = ProductPublicationTarget["channel"];

function isChannel(value: unknown): value is Channel {
  return value === "facebook" || value === "instagram";
}

function publicationSummary(jobs: Array<{ status: string }>) {
  return {
    total: jobs.length,
    successful: jobs.filter((job) => job.status === "published").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    inProgress: jobs.filter((job) =>
      job.status === "queued" || job.status === "processing",
    ).length,
    needsAction: jobs.filter((job) => job.status === "action_required").length,
  };
}

function publicationJobResponse(job: typeof productPublicationJobs.$inferSelect) {
  return {
    id: job.id,
    productId: job.productId,
    channel: job.channel,
    accountId: job.accountId,
    status: job.status,
    postId: job.postId,
    permalink: job.permalink,
    error: job.lastError,
    attempts: job.attempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

function connectionIssue(
  connection: typeof menaMetaConnections.$inferSelect,
  channel: Channel,
): string | null {
  if (!connection.authorizationVerifiedAt) return "META_PERMISSIONS_UNVERIFIED";
  if (
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt <= new Date()
  ) return "META_TOKEN_EXPIRED";
  const missing = missingMetaIntegrationPermissions(
    channel,
    connection.grantedPermissions,
  );
  return missing.length ? `META_PERMISSIONS_MISSING:${missing.join(",")}` : null;
}

router.post("/social/products/publish", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const body = req.body as Record<string, unknown> | null;
  const requestKey = typeof body?.requestKey === "string"
    ? body.requestKey.trim()
    : "";
  const productIds = Array.isArray(body?.productIds)
    ? [...new Set(body.productIds.filter((id): id is string =>
        typeof id === "string" && id.length > 0,
      ))]
    : [];
  const rawTargets = Array.isArray(body?.targets) ? body.targets : [];
  const targets = rawTargets.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const target = item as Record<string, unknown>;
    if (
      !isChannel(target.channel) ||
      typeof target.accountId !== "string" ||
      !target.accountId.trim()
    ) return [];
    return [{
      channel: target.channel,
      accountId: target.accountId.trim(),
    }];
  });
  if (
    !/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey) ||
    productIds.length === 0 ||
    productIds.length > MAX_PUBLISH_PRODUCTS ||
    productIds.length !== (Array.isArray(body?.productIds) ? body.productIds.length : 0) ||
    targets.length === 0 ||
    targets.length !== rawTargets.length ||
    new Set(targets.map((target) => `${target.channel}:${target.accountId}`)).size !== targets.length
  ) {
    res.status(400).json({ error: "بيانات طلب النشر غير صالحة." });
    return;
  }

  const workspaceId = requestWorkspaceId(req);
  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) {
    res.status(409).json({ error: "اربط حساب Meta قبل بدء النشر." });
    return;
  }
  for (const target of targets) {
    const expectedAccountId = target.channel === "facebook"
      ? connection.pageId
      : connection.instagramUserId;
    if (
      !expectedAccountId ||
      expectedAccountId !== target.accountId ||
      (target.channel === "instagram" && !connection.instagramUsername)
    ) {
      res.status(409).json({
        error: "أحد الحسابات المختارة لم يعد متصلًا أو لا يطابق اتصال مساحة العمل.",
      });
      return;
    }
    const issue = connectionIssue(connection, target.channel);
    if (issue) {
      res.status(409).json({
        error: target.channel === "instagram"
          ? "تحقق من صلاحيات Instagram أو أعد ربط حساب Meta."
          : "تحقق من صلاحيات Facebook أو أعد ربط حساب Meta.",
        code: issue,
      });
      return;
    }
  }

  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(
      eq(products.workspaceId, workspaceId),
      inArray(products.id, productIds),
    ));
  if (productRows.length !== productIds.length) {
    res.status(404).json({ error: "بعض المنتجات المحددة غير موجودة." });
    return;
  }

  const matrix = buildProductPublicationMatrix(productIds, targets);
  const now = new Date();
  await db
    .insert(productPublicationJobs)
    .values(matrix.map((item) => ({
      id: randomUUID(),
      ownerId,
      workspaceId,
      requestKey,
      productId: item.productId,
      channel: item.channel,
      accountId: item.accountId,
      status: "queued" as const,
      attempts: 0,
      nextRunAt: now,
      createdBy: requestWorkspaceUserId(req) || ownerId,
      createdAt: now,
      updatedAt: now,
    })))
    .onConflictDoNothing();
  const jobs = await db
    .select()
    .from(productPublicationJobs)
    .where(and(
      eq(productPublicationJobs.workspaceId, workspaceId),
      eq(productPublicationJobs.requestKey, requestKey),
    ))
    .orderBy(asc(productPublicationJobs.createdAt));
  res.status(202).json({
    requestKey,
    jobs: jobs.map(publicationJobResponse),
    summary: publicationSummary(jobs),
  });
  void processProductPublicationQueue().catch((error) => {
    console.error("Initial product publication queue processing failed", {
      workspaceId,
      reason: error instanceof Error ? error.message : "PRODUCT_PUBLISH_QUEUE_FAILED",
    });
  });
});

router.get("/social/products/publish-jobs", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const requestKey = typeof req.query.requestKey === "string"
    ? req.query.requestKey.trim()
    : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) {
    res.status(400).json({ error: "معرّف عملية النشر غير صالح." });
    return;
  }
  const jobs = await db
    .select()
    .from(productPublicationJobs)
    .where(and(
      eq(productPublicationJobs.workspaceId, requestWorkspaceId(req)),
      eq(productPublicationJobs.requestKey, requestKey),
    ))
    .orderBy(asc(productPublicationJobs.createdAt));
  res.json({
    requestKey,
    jobs: jobs.map(publicationJobResponse),
    summary: publicationSummary(jobs),
  });
});

router.post("/social/products/publish-jobs/retry", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const rawJobIds: unknown[] = Array.isArray(req.body?.jobIds)
    ? req.body.jobIds
    : [];
  const jobIds = [...new Set(rawJobIds.filter((id): id is string =>
        typeof id === "string" && id.length > 0,
      ))];
  if (jobIds.length === 0 || jobIds.length > 50) {
    res.status(400).json({ error: "حدد عمليات فاشلة لإعادة المحاولة." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const retried = await db
    .update(productPublicationJobs)
    .set({
      status: "queued",
      attempts: 0,
      lastError: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(productPublicationJobs.workspaceId, workspaceId),
      eq(productPublicationJobs.status, "failed"),
      inArray(productPublicationJobs.id, jobIds),
    ))
    .returning();
  if (retried.length === 0) {
    res.status(409).json({
      error: "لا توجد عمليات فاشلة قابلة لإعادة المحاولة ضمن التحديد.",
    });
    return;
  }
  const requestKeys: string[] = [...new Set(retried.map((job) => job.requestKey))];
  const jobs = await db
    .select()
    .from(productPublicationJobs)
    .where(and(
      eq(productPublicationJobs.workspaceId, workspaceId),
      inArray(productPublicationJobs.requestKey, requestKeys),
    ))
    .orderBy(asc(productPublicationJobs.createdAt));
  res.status(202).json({
    jobs: jobs.map(publicationJobResponse),
    summary: publicationSummary(jobs),
  });
  void processProductPublicationQueue().catch((error) => {
    console.error("Retried product publication queue processing failed", {
      workspaceId,
      reason: error instanceof Error ? error.message : "PRODUCT_PUBLISH_QUEUE_FAILED",
    });
  });
});

export default router;
