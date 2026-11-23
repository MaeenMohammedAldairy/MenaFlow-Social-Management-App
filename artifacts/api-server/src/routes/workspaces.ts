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

    const { name, businessType } = input.data;
    if (name === undefined && businessType === undefined) {
      res.status(400).json({ error: "لم يتم تحديد أي حقول للتحديث." });
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
        })
        .where(eq(workspaces.id, context.workspaceId))
        .returning({
          id: workspaces.id,
          name: workspaces.name,
          businessType: workspaces.businessType,
        });

      if (!updated) {
        res.status(404).json({ error: "مساحة العمل غير موجودة." });
        return;
      }

      res.json({
        id: updated.id,
        name: updated.name,
        businessType: updated.businessType ?? null,
        role: context.role,
      });
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
        })
        .from(workspaceDeletionRequests)
        .where(eq(workspaceDeletionRequests.workspaceId, context.workspaceId))
        .limit(1);
      if (!existing) {
        throw new Error("WORKSPACE_DELETION_REQUEST_NOT_FOUND_AFTER_CONFLICT");
      }
      res.json({ request: existing });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
