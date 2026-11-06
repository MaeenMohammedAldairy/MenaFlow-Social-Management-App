import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useSyncExternalStore } from "react";
import { Appearance, Platform } from "react-native";

export type AppearanceMode = "system" | "light" | "dark";

const APPEARANCE_MODE_STORAGE_KEY = "menaflow.mobile.appearance";
let currentMode: AppearanceMode = "system";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearanceMode(): AppearanceMode {
  return useSyncExternalStore(subscribe, () => currentMode, () => "system");
}

export async function readAppearanceMode(): Promise<AppearanceMode> {
  const storedMode = await AsyncStorage.getItem(APPEARANCE_MODE_STORAGE_KEY);
  return storedMode === "light" || storedMode === "dark" ? storedMode : "system";
}

export async function saveAppearanceMode(
  mode: AppearanceMode,
): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, mode);
  applyAppearanceMode(mode);
}

export function applyAppearanceMode(mode: AppearanceMode): void {
  currentMode = mode;
  for (const listener of listeners) listener();
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.style.colorScheme =
        mode === "system" ? "normal" : mode;
    }
    return;
  }
  Appearance.setColorScheme(mode === "system" ? "unspecified" : mode);
}
