import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  workspaceDeletionRequests,
  workspaceMembers,
  workspaces,
} from "@workspace/db";
import { UpdateWorkspaceCurrentBody } from "@workspace/api-zod";
import { isValidTimezone } from "../lib/scheduling";
import { buildWorkspaceExport } from "../lib/workspace-export";
import { requestOwnerId } from "../lib/owner-access";
import {
  requireWorkspace,
  requestWorkspaceContext,
} from "../lib/workspace-context";

const router = Router();

function requireWorkspaceOwner(req: Request, res: Response) {
  const context = requestWorkspaceContext(req);
  if (!context) {
    res.status(500).json({ error: "تعذر تحديد مساحة العمل." });
    return null;
  }
  if (context.role !== "owner") {
    res.status(403).json({ error: "يقتصر هذا الإجراء على مالك مساحة العمل." });
    return null;
  }
  return context;
}

router.get("/workspaces", async (req, res, next) => {
  const userId = requestOwnerId(req);
  if (!userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  try {
    const memberships = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        businessType: workspaces.businessType,
        country: workspaces.country,
        timezone: workspaces.timezone,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId));
    res.json({ workspaces: memberships });
  } catch (error) {
    next(error);
  }
});

router.get("/workspaces/current", requireWorkspace, (req, res) => {
  const context = requestWorkspaceContext(req);
  if (!context) {
    res.status(500).json({ error: "تعذر تحديد مساحة العمل." });
    return;
  }

  res.json({
    id: context.workspaceId,
    name: context.workspaceName,
    role: context.role,
  });
});

router.patch(
  "/workspaces/current",
  requireWorkspace,
  async (req, res, next) => {
    const context = requireWorkspaceOwner(req, res);
    if (!context) return;

    const input = UpdateWorkspaceCurrentBody.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "بيانات تحديث مساحة العمل غير صالحة." });
      return;
    }

    const { name, businessType, country, timezone } = input.data;
    if (name === undefined && businessType === undefined && country === undefined && timezone === undefined) {
      res.status(400).json({ error: "لم يتم تحديد أي حقول للتحديث." });
      return;
    }
    if (country !== undefined && new Intl.DisplayNames(["en"], { type: "region" }).of(country) === country) {
      res.status(422).json({ error: "رمز البلد غير صالح." });
      return;
    }
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      res.status(422).json({ error: "المنطقة الزمنية غير صالحة." });
      return;
    }

    try {
      const [updated] = await db
        .update(workspaces)
        .set({
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(businessType !== undefined
            ? { businessType: businessType.trim() }
            : {}),
          ...(country !== undefined ? { country } : {}),
          ...(timezone !== undefined ? { timezone: timezone.trim() } : {}),
        })
        .where(eq(workspaces.id, context.workspaceId))
        .returning({
          id: workspaces.id,
          name: workspaces.name,
          businessType: workspaces.businessType,
          country: workspaces.country,
          timezone: workspaces.timezone,
        });

      if (!updated) {
        res.status(404).json({ error: "مساحة العمل غير موجودة." });
        return;
      }

      res.json({
        id: updated.id,
        name: updated.name,
        businessType: updated.businessType ?? null,
        country: updated.country ?? null,
        timezone: updated.timezone,
        role: context.role,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/workspaces/current/export",
  requireWorkspace,
  async (req, res, next) => {
    const context = requireWorkspaceOwner(req, res);
    if (!context) return;

    try {
      const payload = await buildWorkspaceExport(context.workspaceId);
      if (!payload) {
        res.status(404).json({ error: "مساحة العمل غير موجودة." });
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="menaflow-export-${context.workspaceId}.json"`,
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/workspaces/current/deletion-request",
  requireWorkspace,
  async (req, res, next) => {
    const context = requireWorkspaceOwner(req, res);
    if (!context) return;

    try {
      const [request] = await db
        .select({
          id: workspaceDeletionRequests.id,
          status: workspaceDeletionRequests.status,
          requestedAt: workspaceDeletionRequests.requestedAt,
          completedAt: workspaceDeletionRequests.completedAt,
        })
        .from(workspaceDeletionRequests)
        .where(eq(workspaceDeletionRequests.workspaceId, context.workspaceId))
        .limit(1);
      res.json({ request: request ?? null });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/workspaces/current/deletion-request",
  requireWorkspace,
  async (req, res, next) => {
    const context = requireWorkspaceOwner(req, res);
    if (!context) return;

    try {
      const [created] = await db
        .insert(workspaceDeletionRequests)
        .values({
          id: randomUUID(),
          workspaceId: context.workspaceId,
          requestedBy: context.userId,
        })
        .onConflictDoNothing({
          target: workspaceDeletionRequests.workspaceId,
        })
        .returning({
          id: workspaceDeletionRequests.id,
          status: workspaceDeletionRequests.status,
          requestedAt: workspaceDeletionRequests.requestedAt,
          completedAt: workspaceDeletionRequests.completedAt,
        });
      if (created) {
        res.status(201).json({ request: created });
        return;
      }

      const [existing] = await db
        .select({
          id: workspaceDeletionRequests.id,
          status: workspaceDeletionRequests.status,
          requestedAt: workspaceDeletionRequests.requestedAt,
          completedAt: workspaceDeletionRequests.completedAt,
        })
        .from(workspaceDeletionRequests)
        .where(eq(workspaceDeletionRequests.workspaceId, context.workspaceId))
        .limit(1);
      if (!existing) {
        throw new Error("WORKSPACE_DELETION_REQUEST_NOT_FOUND_AFTER_CONFLICT");
      }
      // A request whose retry budget was exhausted stays `failed` and the
      // worker never reads it again, so asking again is the only way to retry
      // the erasure — which is what the settings screen tells the merchant they
      // may do. It starts a new 30-day grace period rather than resuming the
      // expired one: the copy promises thirty days from the request, and a
      // deletion that lands without that warning is the one outcome worth
      // being conservative about. A request still `pending` is returned as it
      // stands — re-asking must not restart a clock the merchant was promised.
      if (existing.status === "failed") {
        const [restarted] = await db
          .update(workspaceDeletionRequests)
          .set({
            status: "pending",
            requestedAt: new Date(),
            requestedBy: context.userId,
            attempts: 0,
            lastError: null,
            completedAt: null,
          })
          .where(eq(workspaceDeletionRequests.id, existing.id))
          .returning({
            id: workspaceDeletionRequests.id,
            status: workspaceDeletionRequests.status,
            requestedAt: workspaceDeletionRequests.requestedAt,
            completedAt: workspaceDeletionRequests.completedAt,
          });
        if (!restarted) {
          throw new Error("WORKSPACE_DELETION_REQUEST_NOT_FOUND_AFTER_CONFLICT");
        }
        res.json({ request: restarted });
        return;
      }
      res.json({ request: existing });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
