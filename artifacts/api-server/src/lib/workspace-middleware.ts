import type { Request, RequestHandler } from "express";
import { requestOwnerId } from "./owner-access.ts";
import {
  resolveWorkspaceContext,
  WorkspaceContextError,
  type WorkspaceContext,
  type WorkspaceRepository,
} from "./workspace-resolution.ts";

const workspaceContexts = new WeakMap<Request, WorkspaceContext>();

export function requestWorkspaceContext(req: Request): WorkspaceContext | null {
  return workspaceContexts.get(req) ?? null;
}

export function createRequireWorkspace(
  repository: WorkspaceRepository,
  getUserId: (req: Request) => string | null = requestOwnerId,
): RequestHandler {
  return (req, res, next) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    const requestedWorkspaceId = req.get("x-workspace-id")?.trim();
    void resolveWorkspaceContext(
      repository,
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
}