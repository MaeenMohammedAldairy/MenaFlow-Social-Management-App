import { useSyncExternalStore } from "react";
import { isOffline, subscribeToNetworkStatus } from "@/lib/network-status";

/** Tracks whether the app is currently offline (native + web). */
export function useNetworkStatus(): boolean {
  return useSyncExternalStore(subscribeToNetworkStatus, isOffline, isOffline);
}
