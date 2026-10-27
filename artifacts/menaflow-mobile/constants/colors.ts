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
    text: '#173365',
    tint: '#0BA87A',

    // Core surfaces
    background: '#F2FBFA',
    foreground: '#123266',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#123266',

    // Primary action color (buttons, links, active states)
    primary: '#0AA77A',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#EDF5F4',
    secondaryForeground: '#173365',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#EAF4F3',
    mutedForeground: '#758BAA',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E1F7EF',
    accentForeground: '#07865F',

    // Destructive actions (delete, error states)
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#DCEDE9',
    input: '#DCEDE9',
    warning: '#D69325',
    green: '#0AA77A',
    greenSoft: '#E1F7EF',
    blue: '#456FA5',
    blueSoft: '#EAF2FC',
    instagram: '#C54898',
    facebook: '#3978D6',
    whatsapp: '#10A982',
  },

  dark: {
    text: '#EAF1FC',
    tint: '#39C79C',
    background: '#0D1E32',
    foreground: '#EAF1FC',
    card: '#152B43',
    cardForeground: '#EAF1FC',
    primary: '#23B88D',
    primaryForeground: '#092A23',
    secondary: '#20364E',
    secondaryForeground: '#DDE9F7',
    muted: '#20364E',
    mutedForeground: '#9DB1C9',
    accent: '#173C38',
    accentForeground: '#74E0BD',
    destructive: '#F87171',
    destructiveForeground: '#2A1212',
    border: '#29415A',
    input: '#29415A',
    warning: '#E4B85C',
    green: '#23B88D',
    greenSoft: '#173C38',
    blue: '#80A9E2',
    blueSoft: '#1B3655',
    instagram: '#E17BBF',
    facebook: '#72A6F2',
    whatsapp: '#45D7AC',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
