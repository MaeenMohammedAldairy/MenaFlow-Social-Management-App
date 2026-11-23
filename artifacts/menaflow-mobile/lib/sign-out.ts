type QueryCache = {
  cancelQueries: () => Promise<unknown>;
  clear: () => void;
};

/**
 * Ends a session and drops everything cached for the previous user.
 *
 * `beforeSignOut` is a required parameter rather than something this module
 * imports, because the only thing that needs it — unregistering the push token —
 * lives in a module that pulls in Expo's native packages, which cannot be loaded
 * outside the app runtime (and would break this file's unit test in plain Node).
 * Requiring it means a new sign-out call site cannot silently skip it.
 */
export async function signOutAndClearQueryCache(
  queryCache: QueryCache,
  signOut: () => Promise<unknown>,
  beforeSignOut: () => Promise<unknown>,
): Promise<void> {
  await queryCache.cancelQueries();
  // Before signOut, not after: the DELETE that removes the device is
  // authenticated, so once the session is gone the server would refuse it and
  // the device would keep receiving the previous merchant's alerts.
  //
  // A failure here must not trap the user in the session. The caller's hook
  // already swallows its own errors, and even a bug that escapes it is less bad
  // than a session that will not end: a stale device registration corrects itself
  // the next time anybody signs in on it, because registration overwrites the row.
  try {
    await beforeSignOut();
  } catch (error) {
    console.error("Pre-sign-out cleanup failed; continuing:", error);
  }
  await signOut();
  queryCache.clear();
}
