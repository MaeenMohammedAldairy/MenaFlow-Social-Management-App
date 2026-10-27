import { randomUUID } from "node:crypto";

export interface WorkspaceMembership {
  workspaceId: string;
  workspaceName: string;
  role: string;
}

export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
}

export interface WorkspaceTransaction {
  lockUser(userId: string): Promise<void>;
  listMemberships(userId: string): Promise<WorkspaceMembership[]>;
  createWorkspace(input: {
    id: string;
    name: string;
    createdBy: string;
  }): Promise<void>;
  createOnboardingProgress(input: {
    id: string;
    workspaceId: string;
    userId: string;
    currentStep: number;
    completed: boolean;
    socialAccountsCompleted: boolean;
  }): Promise<void>;
  createOwnerMembership(input: {
    id: string;
    workspaceId: string;
    userId: string;
  }): Promise<void>;
}

export interface WorkspaceRepository {
  transaction<T>(
    operation: (transaction: WorkspaceTransaction) => Promise<T>,
  ): Promise<T>;
}

export class WorkspaceContextError extends Error {
  readonly statusCode: number;
  readonly code: "WORKSPACE_SELECTION_REQUIRED" | "WORKSPACE_ACCESS_DENIED";

  constructor(
    statusCode: number,
    code: "WORKSPACE_SELECTION_REQUIRED" | "WORKSPACE_ACCESS_DENIED",
  ) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function resolveWorkspaceContext(
  repository: WorkspaceRepository,
  userId: string,
  requestedWorkspaceId?: string,
): Promise<WorkspaceContext> {
  if (!userId.trim()) {
    throw new WorkspaceContextError(401, "WORKSPACE_ACCESS_DENIED");
  }
  return repository.transaction(async (transaction) => {
    let memberships = await transaction.listMemberships(userId);

    if (memberships.length === 0) {
      await transaction.lockUser(userId);
      memberships = await transaction.listMemberships(userId);
    }

    if (memberships.length === 0) {
      const workspaceId = randomUUID();
      await transaction.createWorkspace({
        id: workspaceId,
        name: "مساحة العمل",
        createdBy: userId,
      });
      await transaction.createOwnerMembership({
        id: randomUUID(),
        workspaceId,
        userId,
      });
      await transaction.createOnboardingProgress({
        id: randomUUID(),
        workspaceId,
        userId,
        currentStep: 0,
        completed: false,
        socialAccountsCompleted: false,
      });
      memberships = await transaction.listMemberships(userId);
    }

    const membership = requestedWorkspaceId
      ? memberships.find((item) => item.workspaceId === requestedWorkspaceId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) {
      throw new WorkspaceContextError(
        requestedWorkspaceId ? 403 : 409,
        requestedWorkspaceId
          ? "WORKSPACE_ACCESS_DENIED"
          : "WORKSPACE_SELECTION_REQUIRED",
      );
    }

    return {
      userId,
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspaceName,
      role: membership.role,
    };
  });
}
