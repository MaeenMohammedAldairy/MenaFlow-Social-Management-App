import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, menaWhatsAppGroupSelections, posts } from "@workspace/db";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

import { subscribeToPostChanges } from "../lib/post-events";
import { logger } from "../lib/logger";
import {
  normalizePostReportSummary,
  parsePostReportRange,
  postReportCutoff,
} from "../lib/post-report-summary";

const router: IRouter = Router();
import {
  normalizePostMediaUrls,
  toIso,
  workspaceMediaIds,
  responseForRow,
} from "./posts-domain";

router.get("/posts", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const requestHost = req.get("host");
    const requestOrigin = requestHost
      ? `${req.protocol}://${requestHost}`
      : undefined;
    const [list, groupSelections] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(eq(posts.workspaceId, workspaceId))
        .orderBy(desc(posts.createdAt)),
      db
        .select({
          groupJid: menaWhatsAppGroupSelections.groupJid,
          groupName: menaWhatsAppGroupSelections.groupName,
        })
        .from(menaWhatsAppGroupSelections)
        .where(eq(menaWhatsAppGroupSelections.workspaceId, workspaceId)),
    ]);
    const groupNames = new Map(
      groupSelections.map(({ groupJid, groupName }) => [groupJid, groupName]),
    );
    const allMediaIds = list.flatMap((row) =>
      normalizePostMediaUrls(row.mediaUrls),
    );
    const authorizedMediaIds = await workspaceMediaIds(
      workspaceId,
      allMediaIds,
    );

    res.json(
      await Promise.all(
        list.map((row) =>
          responseForRow(
            row,
            workspaceId,
            row.sourceGroupJid ? groupNames.get(row.sourceGroupJid) : undefined,
            authorizedMediaIds,
            requestOrigin,
          ),
        ),
      ),
    );
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "تعذر تحميل المنشورات." });
  }
});

router.post("/posts/known-ids", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  if (
    !Array.isArray(body.ids) ||
    body.ids.length > 1000 ||
    body.ids.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 150,
    )
  ) {
    res.status(400).json({ error: "قائمة معرّفات المنشورات غير صالحة." });
    return;
  }
  const ids = [...new Set(body.ids as string[])];
  if (ids.length === 0) {
    res.json({ ids: [] });
    return;
  }
  try {
    const rows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.workspaceId, workspaceId), inArray(posts.id, ids)));
    res.json({ ids: rows.map((row) => row.id) });
  } catch (error) {
    console.error("Error checking cached post IDs:", error);
    res.status(500).json({ error: "تعذر التحقق من المنشورات المحفوظة." });
  }
});

router.get("/posts/report-summary", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const range = parsePostReportRange(req.query.range);
  if (!range) {
    res.status(400).json({ error: "فترة التقرير غير صالحة." });
    return;
  }

  try {
    const cutoff = postReportCutoff(range);
    const filters = [eq(posts.workspaceId, workspaceId)];
    if (cutoff) {
      filters.push(
        sql`COALESCE(${posts.sourceMessageDate}, ${posts.createdAt}) >= ${cutoff}`,
      );
    }
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        draft: sql<number>`count(*) filter (where ${posts.status} = 'draft')::int`,
        review: sql<number>`count(*) filter (where ${posts.status} = 'review')::int`,
        scheduled: sql<number>`count(*) filter (where ${posts.status} = 'scheduled')::int`,
        approved: sql<number>`count(*) filter (where ${posts.status} = 'approved')::int`,
        publishing: sql<number>`count(*) filter (where ${posts.status} = 'publishing')::int`,
        published: sql<number>`count(*) filter (where ${posts.status} = 'published')::int`,
        failed: sql<number>`count(*) filter (where ${posts.status} = 'failed')::int`,
        instagram: sql<number>`count(*) filter (where ${posts.channels} ? 'instagram')::int`,
        facebook: sql<number>`count(*) filter (where ${posts.channels} ? 'facebook')::int`,
        whatsapp: sql<number>`count(*) filter (where ${posts.channels} ? 'whatsapp')::int`,
      })
      .from(posts)
      .where(and(...filters));
    res.json(normalizePostReportSummary(row));
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Failed to fetch post report summary",
    );
    res.status(500).json({ error: "تعذر تحميل ملخص التقارير." });
  }
});

router.get("/posts/page", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const requestedLimit = Number(req.query.limit ?? 20);
  if (
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 50
  ) {
    res.status(400).json({ error: "حجم الصفحة يجب أن يكون بين 1 و50." });
    return;
  }

  let cursor: { createdAt: Date; id: string } | null = null;
  if (typeof req.query.cursor === "string") {
    try {
      const value = JSON.parse(
        Buffer.from(req.query.cursor, "base64url").toString("utf8"),
      );
      if (
        !value ||
        typeof value.createdAt !== "string" ||
        typeof value.id !== "string" ||
        !value.id
      )
        throw new Error("INVALID_POST_CURSOR");
      const createdAt = new Date(value.createdAt);
      if (Number.isNaN(createdAt.getTime()))
        throw new Error("INVALID_POST_CURSOR");
      cursor = { createdAt, id: value.id };
    } catch {
      res.status(400).json({ error: "مؤشر الصفحة غير صالح." });
      return;
    }
  }

  try {
    const requestHost = req.get("host");
    const requestOrigin = requestHost
      ? `${req.protocol}://${requestHost}`
      : undefined;
    const filters = [eq(posts.workspaceId, workspaceId)];
    if (cursor) {
      const cursorFilter = or(
        lt(posts.createdAt, cursor.createdAt),
        and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id)),
      );
      if (cursorFilter) filters.push(cursorFilter);
    }
    const [rows, groupSelections] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(and(...filters))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(requestedLimit + 1),
      db
        .select({
          groupJid: menaWhatsAppGroupSelections.groupJid,
          groupName: menaWhatsAppGroupSelections.groupName,
        })
        .from(menaWhatsAppGroupSelections)
        .where(eq(menaWhatsAppGroupSelections.workspaceId, workspaceId)),
    ]);
    const hasMore = rows.length > requestedLimit;
    const pageRows = rows.slice(0, requestedLimit);
    const groupNames = new Map(
      groupSelections.map(({ groupJid, groupName }) => [groupJid, groupName]),
    );
    const mediaIds = pageRows.flatMap((row) =>
      normalizePostMediaUrls(row.mediaUrls),
    );
    const authorizedMediaIds = await workspaceMediaIds(workspaceId, mediaIds);
    const items = await Promise.all(
      pageRows.map((row) =>
        responseForRow(
          row,
          workspaceId,
          row.sourceGroupJid ? groupNames.get(row.sourceGroupJid) : undefined,
          authorizedMediaIds,
          requestOrigin,
        ),
      ),
    );
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? Buffer.from(
            JSON.stringify({
              createdAt: toIso(lastRow.createdAt),
              id: lastRow.id,
            }),
          ).toString("base64url")
        : null;
    res.json({ items, nextCursor });
  } catch (error) {
    console.error("Error fetching posts page:", error);
    res.status(500).json({ error: "تعذر تحميل المنشورات." });
  }
});

router.get("/posts/events", requireWorkspace, (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  const unsubscribeOwner = subscribeToPostChanges(ownerId, () => {
    res.write("event: posts_changed\ndata: {}\n\n");
  });
  const unsubscribeWorkspace = subscribeToPostChanges(workspaceId, () => {
    res.write("event: posts_changed\ndata: {}\n\n");
  });
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeOwner();
    unsubscribeWorkspace();
  });
});

export default router;
