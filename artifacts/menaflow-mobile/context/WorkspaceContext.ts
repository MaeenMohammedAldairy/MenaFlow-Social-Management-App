import { createContext, useContext } from "react";
import { type WorkspaceSummary } from "@workspace/api-client-react";

// The shape is the contract's. The hand-written copy that used to live here had
// already drifted from it (no `timezone`), and every screen reads workspaces
// through this context, so there is no second place for the type to be wrong.
export type { WorkspaceSummary };

export type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  isError: boolean;
  /**
   * Whether a workspace-scoped request may go out now.
   *
   * `activeWorkspaceId !== null` is not the same question: it is false both while
   * the workspace is still being resolved (wait — asking now means the request is
   * made twice, and the server has to guess which workspace to answer for) and when
   * it has been established that there is none to wait for (go — otherwise the
   * merchant watches a skeleton that can never resolve). `lib/workspace-queries.ts`
   * holds the rule and its tests.
   */
  scopeReady: boolean;
  selectWorkspace: (workspaceId: string) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspaceId: null,
  isLoading: false,
  isError: false,
  // False by default: a consumer rendered outside the provider waits rather than
  // firing workspace-scoped requests with no workspace to send.
  scopeReady: false,
  selectWorkspace: async () => {},
});

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
