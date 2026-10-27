export function assertWorkspaceContext(workspaceId: string): void {
  if (!workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
}

export function assertPostWorkspace(
  post: { workspaceId: string },
  workspaceId: string,
): void {
  assertWorkspaceContext(workspaceId);
  if (post.workspaceId !== workspaceId) throw new Error("POST_NOT_IN_WORKSPACE");
}
