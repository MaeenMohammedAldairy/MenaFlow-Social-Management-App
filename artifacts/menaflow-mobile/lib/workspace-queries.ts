/**
 * When a workspace-scoped request may go out.
 *
 * Every business request this app makes is scoped to a workspace: the server
 * resolves which one from the `x-workspace-id` header (`setWorkspaceIdGetter` in
 * the root layout) and answers from that workspace's rows. On a cold start the
 * header does not exist yet, because the active workspace comes from two
 * asynchronous reads — `/api/workspaces` and the saved selection in AsyncStorage.
 *
 * Requesting during that window has two costs, and neither is hypothetical:
 *
 * - **The request is made twice.** Data arrives, the workspace then resolves, and
 *   the root layout invalidates everything — so each query costs two round trips on
 *   every cold start (four queries on the dashboard alone).
 * - **The server has to guess.** With no header it falls back to the user's only
 *   membership, which is correct today and becomes a `409
 *   WORKSPACE_SELECTION_REQUIRED` the moment a merchant belongs to two workspaces
 *   (`lib/workspace-resolution.ts` on the server).
 *
 * Waiting is only right while waiting can still produce an answer, so the predicate
 * opens the gate in three situations where no workspace will ever arrive:
 * local-auth development (there is no workspace row at all), a failed workspace
 * list (the merchant must be shown the failure, not an endless skeleton), and a
 * resolved selection with no workspace to select (the server bootstraps one).
 *
 * **One deliberate exception.** `GET /api/onboarding` is workspace-scoped on the
 * server too, and the three queries that read it (the entry gate in `app/index.tsx`,
 * the root layout's redirect source, and the sources screen) are *not* gated: the
 * entry gate decides whether the merchant lands on the dashboard or in setup, so
 * holding it behind the workspace list would put two sequential round trips in front
 * of every cold start to protect a case that cannot happen yet — a `409` needs two
 * memberships, and invitations are not built (audit item 7ب/E3). When they are, this
 * has to be revisited: either gate the onboarding queries as well, or exempt the
 * route from `requireWorkspace`, because a `409` on the entry gate would show the
 * merchant an error card instead of their dashboard.
 *
 * Pure and dependency-free, in the style of `lib/onboarding-guard.ts`, so the rule
 * is testable in plain Node.
 */

export type WorkspaceScopeInput = {
  /** Development bypass: no Clerk user and no workspace row exist. */
  isLocalAuthDisabled: boolean;
  /** The workspace a scoped request would be sent with, once known. */
  activeWorkspaceId: string | null | undefined;
  /**
   * The saved selection has been read and applied for the signed-in user. Until
   * this is true, `activeWorkspaceId` being null means "not loaded yet" rather
   * than "this user has no workspace".
   */
  selectionApplied: boolean;
  /** `/api/workspaces` has answered, successfully or not. */
  workspaceListSettled: boolean;
  /** `/api/workspaces` failed. */
  workspaceListFailed: boolean;
};

export function workspaceQueryEnabled(input: WorkspaceScopeInput): boolean {
  if (input.isLocalAuthDisabled) return true;
  // Trimmed: an id of only whitespace is not a workspace, and sending it as the
  // `x-workspace-id` header would ask the server to resolve a membership that
  // cannot exist.
  if (input.activeWorkspaceId?.trim()) return true;
  // The list failed: no amount of waiting produces a workspace, and a merchant
  // staring at skeletons learns nothing. Let the request go and be answered — or
  // refused with a status the app already knows how to explain.
  if (input.workspaceListFailed) return true;
  // Selection applied and the list answered, yet there is no workspace: either the
  // user has none (the server bootstraps one on the first scoped request) or the
  // saved one no longer exists and the fallback to the first workspace has already
  // run. Waiting longer cannot change the answer.
  return input.selectionApplied && input.workspaceListSettled;
}
