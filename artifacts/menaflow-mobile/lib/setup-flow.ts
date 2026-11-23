/**
 * Pure decisions behind the post-signup setup flow.
 *
 * Kept free of React/Expo imports so plain-Node tests can cover them (the
 * screens themselves cannot be imported in that environment).
 *
 * (The offline→online replay of a failed `skip` that used to live here was
 * dropped: `app/setup.tsx` now shows an OfflineBanner and its error copy asks
 * for a manual retry instead of promising an automatic one, so there is no
 * promise left to keep and no helper left to share.)
 */

export type WorkspaceRole = { role: string } | null;

/**
 * Whether the business-info form (`/setup` edit mode, and its checklist step)
 * is actionable for this member.
 *
 * `PATCH /workspaces/current` is owner-only on the server, so showing the form
 * to anyone else means a guaranteed 403 and a checklist step that can never be
 * completed. Two deliberate exceptions:
 * - local-auth mode has no workspace row at all, so there is nothing to gate;
 * - while the workspace list is still loading the role is *unknown* — returning
 *   false there would make the step blink out and back in on every cold start.
 */
export function canEditBusinessInfo(
  activeWorkspace: WorkspaceRole,
  options: { isLocalAuthDisabled?: boolean } = {},
): boolean {
  if (options.isLocalAuthDisabled) return true;
  if (!activeWorkspace) return true; // role not loaded yet
  return activeWorkspace.role === "owner";
}
