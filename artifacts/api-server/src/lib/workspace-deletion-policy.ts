import { workspaceMediaKey } from "./product-utils.ts";

/**
 * Pure policy helpers for the workspace-deletion worker (§3.4). Split out of
 * `workspace-deletion.ts` so the rules are testable in plain Node — that
 * module imports `@workspace/db`, which refuses to load without a database.
 */

export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const DELETION_MAX_ATTEMPTS = 5;

/** Pure: the cutoff before which a pending request is due for teardown. */
export function deletionDueCutoff(
  now: Date,
  graceMs: number = DELETION_GRACE_MS,
): Date {
  return new Date(now.getTime() - graceMs);
}

/** Pure: a request is due once its grace period has fully elapsed. */
export function isDeletionRequestDue(
  requestedAt: Date,
  now: Date,
  graceMs: number = DELETION_GRACE_MS,
): boolean {
  return requestedAt.getTime() <= now.getTime() - graceMs;
}

/**
 * Storage prefixes holding every object owned by one workspace: WhatsApp
 * media lives under `{workspaceId}/objects/…`, product media under
 * `product-media/{workspaceKey}/…` (workspaceMediaKey is a hash, so the
 * prefix cannot collide with another workspace's). Thumbnails share the
 * prefixes, so two entries cover originals and derivatives.
 */
export function workspaceStoragePrefixes(workspaceId: string): string[] {
  return [workspaceId, `product-media/${workspaceMediaKey(workspaceId)}`];
}
