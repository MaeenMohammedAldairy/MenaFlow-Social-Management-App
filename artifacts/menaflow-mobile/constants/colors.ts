/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#152B3B",
    tint: "#087F68",

    // Core surfaces
    background: "#F5F7F6",
    foreground: "#152B3B",

    // Cards / elevated surfaces
    card: "#FFFFFF",
    cardForeground: "#152B3B",

    // Primary action color (buttons, links, active states)
    primary: "#087F68",
    primaryForeground: "#FFFFFF",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#EEF2F1",
    secondaryForeground: "#24394B",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#E8EEEB",
    mutedForeground: "#5F6F7F",

    // Accent highlights (badges, selected items, focus rings)
    accent: "#DDF3E9",
    accentForeground: "#08644F",

    // Destructive actions (delete, error states)
    destructive: "#C62828",
    destructiveForeground: "#FFFFFF",

    // Borders and input outlines
    border: "#D7E1DC",
    input: "#D7E1DC",
    warning: "#9A5A00",
    green: "#087F68",
    greenSoft: "#DDF3E9",
    blue: "#285FA8",
    blueSoft: "#E5EDF9",
    instagram: "#B32D78",
    facebook: "#1F5FBF",
    whatsapp: "#087F68",
  },

  dark: {
    text: "#EAF1F5",
    tint: "#47D6A4",
    background: "#0D1722",
    foreground: "#EAF1F5",
    card: "#152331",
    cardForeground: "#EAF1F5",
    primary: "#35C799",
    primaryForeground: "#07271F",
    secondary: "#20313F",
    secondaryForeground: "#DFE8ED",
    muted: "#20313F",
    mutedForeground: "#A6B6C2",
    accent: "#173D32",
    accentForeground: "#72E0B8",
    destructive: "#FF7A7A",
    destructiveForeground: "#301416",
    border: "#2C3E4B",
    input: "#2C3E4B",
    warning: "#F2BF60",
    green: "#35C799",
    greenSoft: "#173D32",
    blue: "#8DB8F2",
    blueSoft: "#1B3450",
    instagram: "#E17AB9",
    facebook: "#80ACF0",
    whatsapp: "#47D6A4",
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
