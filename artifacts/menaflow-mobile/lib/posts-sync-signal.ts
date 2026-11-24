/**
 * A one-function bridge from the app shell to the studio store.
 *
 * Posts do not live in React Query: `context/StudioContext.tsx` keeps them in its
 * own state with an AsyncStorage cache, so neither `queryClient.invalidateQueries`
 * nor the focus-manager wiring in `lib/query-focus.ts` reaches them. The code that
 * knows an alert arrived is the root layout, which sits *above* `StudioProvider` in
 * the tree and therefore cannot call `useStudio()`.
 *
 * This module is the seam: the provider registers its sync function on mount, and
 * the alert handler asks for a sync without knowing who is listening. One listener
 * at a time — there is exactly one `StudioProvider` — and registering returns the
 * unregister function so a remount cannot leave a stale closure behind.
 *
 * Deliberately free of React and of Expo so the contract is testable in plain
 * Node, in the same spirit as `lib/alert-invalidation.ts`.
 */

let listener: (() => void) | null = null;

/**
 * Register the function that syncs posts with the server.
 *
 * Returns the unregister function. A second registration replaces the first and
 * the older unregister call then does nothing, so an overlapping remount cannot
 * detach the listener that belongs to the mounted provider.
 */
export function setPostsSyncListener(sync: (() => void) | null): () => void {
  listener = sync;
  return () => {
    if (listener === sync) listener = null;
  };
}

/**
 * Ask for a post sync.
 *
 * Returns whether anything was listening, so a caller (and a test) can tell "the
 * store synced" from "no store is mounted yet".
 */
export function requestPostsSync(): boolean {
  if (!listener) return false;
  listener();
  return true;
}
