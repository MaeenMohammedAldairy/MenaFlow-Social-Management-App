import { useColorScheme } from "react-native";
import colors from "@/constants/colors";
import { useAppearanceMode } from "@/lib/appearance";

/**
 * Palette for the authentication and onboarding setup screens.
 *
 * Derived directly from the shared MenaFlow tokens in `constants/colors.ts`
 * so auth, onboarding, and in-app surfaces share one visual identity while
 * keeping subtle wave surfaces for the auth backdrop in both light and dark modes.
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
  dangerSurface: string;
  dangerBorder: string;
  facebook: string;
  shadow: string;
  overlay: string;
  disabled: string;
  disabledForeground: string;
};

const light: AuthTheme = {
  background: colors.light.background,
  backgroundDeep: colors.light.muted,
  wave: colors.light.accent,
  waveSoft: colors.light.secondary,
  card: colors.light.card,
  foreground: colors.light.foreground,
  mutedForeground: colors.light.mutedForeground,
  icon: colors.light.secondaryForeground,
  primary: colors.light.primary,
  primaryForeground: colors.light.primaryForeground,
  primarySoft: colors.light.accent,
  accent: colors.light.accent,
  accentForeground: colors.light.accentForeground,
  border: colors.light.border,
  inputSurface: colors.light.background,
  link: colors.light.primary,
  subtitle: colors.light.blue,
  destructive: colors.light.destructive,
  dangerSurface: colors.light.secondary,
  dangerBorder: colors.light.destructive,
  facebook: colors.light.facebook,
  shadow: colors.light.shadow,
  overlay: colors.light.overlay,
  disabled: colors.light.disabled,
  disabledForeground: colors.light.disabledForeground,
};

const dark: AuthTheme = {
  background: colors.dark.background,
  backgroundDeep: colors.dark.card,
  wave: colors.dark.accent,
  waveSoft: colors.dark.secondary,
  card: colors.dark.card,
  foreground: colors.dark.foreground,
  mutedForeground: colors.dark.mutedForeground,
  icon: colors.dark.secondaryForeground,
  primary: colors.dark.primary,
  primaryForeground: colors.dark.primaryForeground,
  primarySoft: colors.dark.accent,
  accent: colors.dark.accent,
  accentForeground: colors.dark.accentForeground,
  border: colors.dark.border,
  // Slightly lighter than card so fields read clearly on dark surfaces.
  inputSurface: colors.dark.secondary,
  link: colors.dark.primary,
  subtitle: colors.dark.blue,
  destructive: colors.dark.destructive,
  dangerSurface: colors.dark.secondary,
  dangerBorder: colors.dark.destructive,
  facebook: colors.dark.facebook,
  shadow: colors.dark.shadow,
  overlay: colors.dark.overlay,
  disabled: colors.dark.disabled,
  disabledForeground: colors.dark.disabledForeground,
};

export function useAuthTheme(): AuthTheme {
  const scheme = useColorScheme();
  const appearanceMode = useAppearanceMode();
  const activeScheme = appearanceMode === "system" ? scheme : appearanceMode;
  return activeScheme === "dark" ? dark : light;
}
