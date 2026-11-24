/**
 * Keying for the studio store's on-device cache.
 *
 * The store (`context/StudioContext.tsx`) keeps a page of posts, the auto-publish
 * settings and two device preferences in AsyncStorage so the dashboard has
 * something to show before the first response lands. What that cache is keyed by
 * decides whose data it can show:
 *
 * - Keyed by user alone — the way it was — one cache served every workspace the
 *   user belongs to. The workspace switcher in settings is reachable, so switching
 *   left the previous workspace's posts, activity and checklist state on screen
 *   until a manual pull-to-refresh replaced them.
 * - Keyed by user *and* workspace, each workspace gets its own cache, and the
 *   namespace is `null` until the active workspace is known, which the store reads
 *   as "not ready" rather than as "this workspace has no posts".
 *
 * Pure and free of React Native on purpose: AsyncStorage cannot be imported into a
 * plain Node test, and the rules about who sees whose cache are exactly the kind
 * that need one.
 */

/** Versioned root key. Bumping it abandons every cache rather than migrating. */
export const STUDIO_STORAGE_KEY = "menaflow.mobile.studio.v1";

/**
 * The cache namespace for a signed-in merchant, or `null` when it is not yet
 * possible to know which workspace the cache would belong to.
 *
 * `null` is also the signed-out value, and both mean the same thing to the store:
 * do not read or write a cache, and report "not ready".
 */
export function workspaceStorageNamespace(
  // `undefined` as well as `null` because both inputs arrive from sources that
  // report "not resolved yet" either way: Clerk's `userId` and the workspace
  // selection read back from AsyncStorage.
  userId: string | null | undefined,
  activeWorkspaceId: string | null | undefined,
): string | null {
  if (!userId || !activeWorkspaceId) return null;
  return `user:${userId}:ws:${activeWorkspaceId}`;
}

/**
 * The pre-workspace-scoping key holding the same user's cache, if this namespace
 * has one.
 *
 * Used to carry the device-local preferences across the change of key, so
 * scoping the cache by workspace does not silently reset "in-app alerts" and
 * "review before publishing" for every merchant on upgrade. Posts and auto-publish
 * settings are deliberately not carried over: they belong to one workspace, and
 * seeding another workspace's cache with them would show data that workspace does
 * not own, even for the moment before the first sync replaces it.
 */
export function legacyStudioStorageKey(
  storageNamespace: string | null,
): string | null {
  if (!storageNamespace) return null;
  const match = /^user:(.+):ws:[^:]+$/.exec(storageNamespace);
  return match ? `${STUDIO_STORAGE_KEY}.user:${match[1]}` : null;
}
