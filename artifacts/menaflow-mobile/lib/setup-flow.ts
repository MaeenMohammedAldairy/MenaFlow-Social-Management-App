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

/** Every step the dashboard's "خطوات البدء" checklist can render. */
export type SetupStepKey =
  | "business-info"
  | "accounts"
  | "first-post"
  | "auto-publish";

/** The step as the checklist reasons about it — identity and completion only. */
export type SetupStepStatus = {
  key: SetupStepKey;
  done: boolean;
};

export type SetupChecklistContext = {
  /** From `canEditBusinessInfo` above. */
  canEditBusinessInfo: boolean;
  /**
   * Whether the connections state has been resolved. `false` while the query is
   * pending or has errored, which makes the `accounts` step unknown rather than
   * outstanding.
   */
  connectionsStateKnown: boolean;
};

export type SetupChecklistProgress = {
  /** Steps the merchant is shown, in display order. */
  visibleKeys: SetupStepKey[];
  /** Shown steps that count toward progress. */
  requiredKeys: SetupStepKey[];
  /** Completed steps among `requiredKeys`. */
  completed: number;
  /** `requiredKeys.length`. */
  total: number;
  /**
   * Whether every required step is done — the signal the dashboard uses to stop
   * showing the card. A checklist with no required steps left reads as complete:
   * there is nothing to guide the merchant to, so the card stays out of the way.
   */
  isComplete: boolean;
};

/** A recommendation rather than a requirement: shown, never counted. */
const OPTIONAL_STEPS: ReadonlySet<SetupStepKey> = new Set<SetupStepKey>([
  "auto-publish",
]);

/**
 * Which setup steps to show, and what progress to claim.
 *
 * Two of the four steps can be *unknown*, and the screen used to treat unknown as
 * outstanding:
 *
 * - `accounts` reads the connections query. While it is loading or has errored, the
 *   screen cannot say whether a publishing account is linked. Counting the step as
 *   outstanding told a merchant who had already linked a page that they had not,
 *   for as long as the network was bad.
 * - `business-info` is hidden, not discounted, because it is the one step that is
 *   *impossible* for a member rather than merely unknown — see `canEditBusinessInfo`.
 *
 * An unknown step stays visible and tappable so the merchant can go and check it;
 * it just does not enter the progress count.
 */
export function setupChecklistProgress(
  steps: ReadonlyArray<SetupStepStatus>,
  context: SetupChecklistContext,
): SetupChecklistProgress {
  const visibleKeys: SetupStepKey[] = [];
  const requiredKeys: SetupStepKey[] = [];
  let completed = 0;

  for (const step of steps) {
    if (step.key === "business-info" && !context.canEditBusinessInfo) continue;
    visibleKeys.push(step.key);
    if (OPTIONAL_STEPS.has(step.key)) continue;
    if (step.key === "accounts" && !context.connectionsStateKnown) continue;
    requiredKeys.push(step.key);
    if (step.done) completed += 1;
  }

  return {
    visibleKeys,
    requiredKeys,
    completed,
    total: requiredKeys.length,
    isComplete: completed === requiredKeys.length,
  };
}
