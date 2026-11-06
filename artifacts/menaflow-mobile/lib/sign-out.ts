type QueryCache = {
  cancelQueries: () => Promise<unknown>;
  clear: () => void;
};

export async function signOutAndClearQueryCache(
  queryCache: QueryCache,
  signOut: () => Promise<unknown>,
): Promise<void> {
  await queryCache.cancelQueries();
  await signOut();
  queryCache.clear();
}