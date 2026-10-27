type PostChangeListener = () => void;

const listenersByOwner = new Map<string, Set<PostChangeListener>>();

export function subscribeToPostChanges(
  ownerId: string,
  listener: PostChangeListener,
): () => void {
  let listeners = listenersByOwner.get(ownerId);
  if (!listeners) {
    listeners = new Set();
    listenersByOwner.set(ownerId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) listenersByOwner.delete(ownerId);
  };
}

export function notifyPostsChanged(ownerId: string): void {
  for (const listener of listenersByOwner.get(ownerId) ?? []) listener();
}
