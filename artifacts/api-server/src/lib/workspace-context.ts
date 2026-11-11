import { eq, sql } from "drizzle-orm";
import {
  db,
  workspaceMembers,
  workspaceOnboarding,
  workspaceSubscriptions,
  workspaces,
} from "@workspace/db";
import {
  createRequireWorkspace,
  requestWorkspaceContext,
} from "./workspace-middleware";
import {
  type WorkspaceRepository,
} from "./workspace-resolution";

export {
  resolveWorkspaceContext,
  WorkspaceContextError,
} from "./workspace-resolution";
export {
  createRequireWorkspace,
  requestWorkspaceContext,
} from "./workspace-middleware";
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
          const now = new Date();
          await transaction.insert(workspaceSubscriptions).values({
            id: `subscription:${input.id}`,
            workspaceId: input.id,
            planId: "growth",
            status: "trialing",
            trialEndsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            createdAt: now,
            updatedAt: now,
          });
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

export function requestWorkspaceId(req: import("express").Request): string {
  const workspaceId = requestWorkspaceContext(req)?.workspaceId;
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  return workspaceId;
}

export function requestWorkspaceUserId(req: import("express").Request): string {
  const userId = requestWorkspaceContext(req)?.userId;
  if (!userId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  return userId;
}

export const requireWorkspace = createRequireWorkspace(databaseRepository);
