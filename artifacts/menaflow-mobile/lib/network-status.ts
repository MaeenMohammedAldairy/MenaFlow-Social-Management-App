type NetworkStatusListener = () => void;

let offline = false;
const listeners = new Set<NetworkStatusListener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function isOffline(): boolean {
  return offline;
}

export function subscribeToNetworkStatus(
  listener: NetworkStatusListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called when a request fails before the API answers (fetch TypeError). */
export function markNetworkUnavailable(): void {
  if (offline) return;
  offline = true;
  notify();
}

/** Called as soon as any request reaches the API again. */
export function markNetworkAvailable(): void {
  if (!offline) return;
  offline = false;
  notify();
}

// Browsers report connectivity directly; native builds rely on request
// outcomes because no network module ships with the app.
const isBrowserRuntime =
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function" &&
  typeof navigator !== "undefined" &&
  typeof navigator.onLine === "boolean";

if (isBrowserRuntime) {
  offline = navigator.onLine === false;
  window.addEventListener("offline", markNetworkUnavailable);
  window.addEventListener("online", markNetworkAvailable);
}
