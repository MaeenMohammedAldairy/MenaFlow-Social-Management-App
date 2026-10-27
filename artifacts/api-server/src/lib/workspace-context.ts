import { eq, sql } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import {
  db,
  workspaceMembers,
  workspaceOnboarding,
  workspaces,
} from "@workspace/db";
import { requestOwnerId } from "./owner-access";
import {
  resolveWorkspaceContext,
  WorkspaceContextError,
  type WorkspaceContext,
  type WorkspaceMembership,
  type WorkspaceRepository,
} from "./workspace-resolution";

export {
  resolveWorkspaceContext,
  WorkspaceContextError,
} from "./workspace-resolution";
export type {
  WorkspaceContext,
  WorkspaceMembership,
  WorkspaceRepository,
  WorkspaceTransaction,
} from "./workspace-resolution";

const databaseRepository: WorkspaceRepository = {
  transaction: (operation) =>
    db.transaction((transaction) =>
      operation({
        lockUser: async (userId) => {
          await transaction.execute(
            // Transaction-scoped lock serializes first-workspace creation per Clerk user.
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
          );
        },
        listMemberships: async (userId) =>
          transaction
            .select({
              workspaceId: workspaceMembers.workspaceId,
              workspaceName: workspaces.name,
              role: workspaceMembers.role,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(eq(workspaceMembers.userId, userId)),
        createWorkspace: async (input) => {
          await transaction.insert(workspaces).values(input);
        },
        createOnboardingProgress: async (input) => {
          await transaction.insert(workspaceOnboarding).values(input);
        },
        createOwnerMembership: async (input) => {
          await transaction.insert(workspaceMembers).values({
            ...input,
            role: "owner",
          });
        },
      }),
    ),
};

const workspaceContexts = new WeakMap<Request, WorkspaceContext>();

export function requestWorkspaceContext(req: Request): WorkspaceContext | null {
  return workspaceContexts.get(req) ?? null;
}

export function requestWorkspaceId(req: Request): string {
  const workspaceId = requestWorkspaceContext(req)?.workspaceId;
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  return workspaceId;
}

export function requestWorkspaceUserId(req: Request): string {
  const userId = requestWorkspaceContext(req)?.userId;
  if (!userId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  return userId;
}

export const requireWorkspace: RequestHandler = (req, res, next) => {
  const userId = requestOwnerId(req);
  if (!userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const requestedWorkspaceId = req.get("x-workspace-id")?.trim();
  void resolveWorkspaceContext(
    databaseRepository,
    userId,
    requestedWorkspaceId || undefined,
  )
    .then((context) => {
      workspaceContexts.set(req, context);
      next();
    })
    .catch((error: unknown) => {
      if (error instanceof WorkspaceContextError) {
        res.status(error.statusCode).json({
          error:
            error.code === "WORKSPACE_ACCESS_DENIED"
              ? "لا تملك صلاحية الوصول إلى مساحة العمل المطلوبة."
              : "اختر مساحة العمل قبل متابعة الطلب.",
          code: error.code,
        });
        return;
      }
      next(error);
    });
};
