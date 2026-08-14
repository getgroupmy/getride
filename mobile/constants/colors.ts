/**
 * The app-wide colour palette, one entry per theme.
 *
 * Fill and text are separate roles. `accent`, `error`, `success` and `warning`
 * are *fills* — they are the brand and status colours, and they are what a
 * button, chip or dot is painted with. Drawn as **text** on a light background
 * the same values are unreadable: #2dabe2 is 2.61:1 on white, #F59E0B is
 * 2.15:1, both far below the 4.5:1 body-text floor.
 *
 * So each has a `*Text` twin, dark enough to read on light and light enough to
 * read on dark, in the same hue family. Use the fill for `backgroundColor` and
 * the twin for `color`. The pairs are contrast-checked in
 * `utils/__tests__/colors.test.ts`, so a value that fails WCAG AA against the
 * surfaces it is actually drawn on fails the build.
 */

export const lightColors = {
  primary: "#000000",
  secondary: "#FFFFFF",
  accent: "#2dabe2",
  accentDark: "#238baf",
  onAccent: "#000000",
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },
  economy: "#4F46E5",
  comfort: "#7C3AED",
  premium: "#1F2937",
  background: "#FFFFFF",
  text: "#111827",
  // Was #6B7280 — 4.39:1 on gray.100 and 3.90:1 on gray.200, both below the
  // body-text floor, and this is the most-used colour in the app.
  textSecondary: "#5C636E",
  subtext: "#5C636E",
  card: "#FFFFFF",
  border: "#E5E7EB",
  error: "#EF4444",
  danger: "#EF4444",
  success: "#10B981",
  warning: "#F59E0B",

  /** Text/icon twins of the fills above. See the note at the top of this file. */
  accentText: "#17708F",
  errorText: "#C81E1E",
  dangerText: "#C81E1E",
  successText: "#047857",
  warningText: "#B45309",
  /** Text drawn *on* a fill of the matching colour. */
  onError: "#FFFFFF",
  onSuccess: "#000000",
  onWarning: "#000000",
};

export const darkColors = {
  primary: "#FFFFFF",
  secondary: "#000000",
  accent: "#2dabe2",
  accentDark: "#238baf",
  onAccent: "#000000",
  gray: {
    50: "#1F2937",
    100: "#374151",
    200: "#4B5563",
    300: "#6B7280",
    400: "#9CA3AF",
    500: "#D1D5DB",
    600: "#E5E7EB",
    700: "#F3F4F6",
    800: "#F9FAFB",
    900: "#FFFFFF",
  },
  economy: "#6366F1",
  comfort: "#8B5CF6",
  premium: "#F3F4F6",
  background: "#000000",
  text: "#FFFFFF",
  // Was #9CA3AF — 4.06:1 on gray.100 (#374151), the lightest dark surface.
  textSecondary: "#A8AEB9",
  subtext: "#A8AEB9",
  card: "#1F2937",
  border: "#374151",
  error: "#EF4444",
  danger: "#EF4444",
  success: "#10B981",
  warning: "#F59E0B",

  /** On a dark ground the fills mostly read already; only red needs lifting. */
  accentText: "#5CC4EE",
  // #F87171 is only 3.73:1 on gray.100; red has to be lifted further than the
  // other statuses to clear the lightest dark surface.
  errorText: "#FA9C9C",
  dangerText: "#FA9C9C",
  successText: "#34D399",
  warningText: "#FBBF24",
  onError: "#FFFFFF",
  onSuccess: "#000000",
  onWarning: "#000000",
};

export default lightColors;
