/**
 * Pure decisions behind the post-signup setup flow.
 *
 * Kept free of React/Expo imports so plain-Node tests can cover them (the
 * screens themselves cannot be imported in that environment).
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

export type PendingSkipState = {
  /** Device currently offline (`useNetworkStatus`). */
  isOffline: boolean;
  /** Whether an offline stretch has been observed since the failure. */
  wasOffline: boolean;
  /** The failed `skip` was armed for an automatic replay. */
  awaitingRetry: boolean;
  /** The exit the pending `skip` should navigate to, if still armed. */
  pendingExit: string | null;
  /** A `skip` request is already in flight. */
  requestInFlight: boolean;
};

/**
 * Whether the pending onboarding `skip` should be replayed right now.
 *
 * The guard keeps the merchant on `/setup` until `skip` lands, so the error
 * copy promising an automatic retry has to be true. But only the
 * offline→online transition counts: replaying on every render (or after a
 * server-side rejection while online) would loop forever.
 */
export function shouldReplayPendingSkip(state: PendingSkipState): boolean {
  if (state.isOffline) return false;
  if (!state.wasOffline) return false;
  if (!state.awaitingRetry) return false;
  if (!state.pendingExit) return false;
  if (state.requestInFlight) return false;
  return true;
}

/**
 * Whether an offline failure should be armed for that automatic replay.
 * A failure while online is not a connectivity problem, so it is left to the
 * merchant to retry by pressing the button again.
 */
export function shouldArmSkipRetry(isOffline: boolean): boolean {
  return isOffline;
}
