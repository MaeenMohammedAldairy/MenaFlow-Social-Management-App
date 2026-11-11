import { createContext, useContext } from "react";

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
};

export type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  isError: boolean;
  selectWorkspace: (workspaceId: string) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspaceId: null,
  isLoading: false,
  isError: false,
  selectWorkspace: async () => {},
});

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}