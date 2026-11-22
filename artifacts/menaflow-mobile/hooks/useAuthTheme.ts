import { useColorScheme } from "react-native";
import { useAppearanceMode } from "@/lib/appearance";

/**
 * Palette for the authentication screens (sign in / sign up / 2FA / reset).
 *
 * These screens follow the marketing artwork instead of the in-app theme: a pale
 * mint background, deep navy headings and a single green call to action. The
 * token names deliberately mirror `useColors()` so the shared auth styles and the
 * additional forms keep working unchanged.
 *
 * The dark scheme keeps the very same layout and only flips the surfaces, so the
 * screen never blinds a user who runs the app in dark mode.
 */
export type AuthTheme = {
  background: string;
  backgroundDeep: string;
  wave: string;
  waveSoft: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  icon: string;
  primary: string;
  primaryForeground: string;
  primarySoft: string;
  accent: string;
  accentForeground: string;
  border: string;
  inputSurface: string;
  link: string;
  subtitle: string;
  destructive: string;
  facebook: string;
  shadow: string;
  overlay: string;
};

const light: AuthTheme = {
  background: "#F4FBFD",
  backgroundDeep: "#E8F6F1",
  wave: "#BAFAE4",
  waveSoft: "#DCF6EA",
  card: "#FFFFFF",
  foreground: "#0A2A63",
  mutedForeground: "#7F95B4",
  icon: "#3B5A80",
  primary: "#02A362",
  primaryForeground: "#FFFFFF",
  primarySoft: "#E6F8EF",
  accent: "#E7F8F0",
  accentForeground: "#028A54",
  border: "#DDEBF2",
  inputSurface: "#FFFFFF",
  link: "#049143",
  subtitle: "#2366D7",
  destructive: "#C62828",
  facebook: "#1877F2",
  shadow: "#0A2A63",
  overlay: "rgba(10, 42, 99, 0.06)",
};

const dark: AuthTheme = {
  background: "#071320",
  backgroundDeep: "#0A1A28",
  wave: "#0C3A2B",
  waveSoft: "#0A2A22",
  card: "#101E2C",
  foreground: "#E9F2F9",
  mutedForeground: "#93A9BF",
  icon: "#A9C0D6",
  primary: "#1FC58C",
  primaryForeground: "#04150E",
  primarySoft: "#0F3A2C",
  accent: "#0F3A2C",
  accentForeground: "#5BE3B0",
  border: "#22323F",
  inputSurface: "#0D1A26",
  link: "#3ED9A0",
  subtitle: "#8FB6F0",
  destructive: "#FF8A8A",
  facebook: "#4A90F5",
  shadow: "#000000",
  overlay: "rgba(255, 255, 255, 0.04)",
};

export function useAuthTheme(): AuthTheme {
  const scheme = useColorScheme();
  const appearanceMode = useAppearanceMode();
  const activeScheme = appearanceMode === "system" ? scheme : appearanceMode;
  return activeScheme === "dark" ? dark : light;
}
