import { useEffect } from "react";
import { Platform } from "react-native";
import { useColors } from "@/hooks/useColors";

const STYLE_ID = "menaflow-focus-ring";

/**
 * Web builds have no visible keyboard focus indicator on the custom
 * Pressable/TextInput styles, so keyboard users cannot tell where they are.
 * Injects a single stylesheet that follows the active palette.
 */
export function WebFocusRing() {
  const { primary } = useColors();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!element) {
      element = document.createElement("style");
      element.id = STYLE_ID;
      document.head.appendChild(element);
    }
    element.textContent = `
:focus-visible {
  outline: 2px solid ${primary} !important;
  outline-offset: 2px !important;
}
`.trim();
  }, [primary]);
  return null;
}
