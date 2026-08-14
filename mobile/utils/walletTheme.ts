/**
 * Semantic colour tokens for the wallet screens.
 *
 * `app/wallet.tsx` used to build its StyleSheet at module scope, which cannot
 * see the active colour scheme, so every surface and every piece of text was a
 * hardcoded light-mode literal — the screen rendered white in dark mode. These
 * tokens are the light/dark pair for each role the wallet actually uses.
 *
 * Roles, not values: a screen should ask for `textMuted`, never for `#6B6B70`.
 * The pairs are contrast-checked in `utils/__tests__/walletTheme.test.ts`, so a
 * value that fails WCAG AA against the surface it is drawn on fails the build
 * rather than shipping.
 *
 * Brand marks (Visa, Mastercard, FPX, MCash) are deliberately NOT tokens —
 * they are somebody else's colours and are kept literal at their call sites,
 * except where a dark background needs the reversed lockup.
 */

/**
 * A QR code or barcode is read by a camera, not by a person, and scanners
 * expect dark-on-light. These two are theme-INDEPENDENT on purpose, and are
 * exported separately so module-scope QR components can use them without a
 * hook. `WalletPalette.qrSurface` / `.qrInk` are the same values.
 */
export const QR_SURFACE = "#FFFFFF";
export const QR_INK = "#111111";

export type WalletPalette = {
  /** Page backdrop the cards sit on. Never a card colour. */
  screen: string;
  /** Card / sheet surface. */
  surface: string;
  /** Inset panel inside a sheet (one step off `surface`). */
  surfaceAlt: string;
  /** Blue-tinted panel behind the master balance. */
  surfaceTint: string;
  /** Gold-tinted GET.coin card. */
  surfaceCoin: string;
  /** Blue-tinted referral card. */
  surfaceReferral: string;
  /** Neutral chip (status badges). */
  surfaceChip: string;
  /** Inset rows, toggle tracks, quiet fills one step off `surface`. */
  surfaceMuted: string;
  /** GET.coin "earn" pill. */
  surfaceCoinPill: string;
  /** Error/warning tint behind a message. */
  surfaceDanger: string;
  /** Success tint behind a confirmation. */
  surfaceSuccess: string;
  /** See QR_SURFACE / QR_INK above — theme-independent by design. */
  qrSurface: string;
  qrInk: string;

  border: string;
  /** Border that must read as an edge, not a hairline (outline buttons). */
  borderStrong: string;
  /** Divider inside the balance card. */
  divider: string;
  /** Row separator in lists. */
  hairline: string;
  borderCoin: string;
  borderReferral: string;

  /** Body text. */
  text: string;
  /** Headings and figures. */
  textStrong: string;
  /** Supporting copy. */
  textMuted: string;
  /** Timestamps and other metadata. */
  textFaint: string;
  /** Input placeholder. Decorative — held to 3:1, not 4.5:1. */
  placeholder: string;
  textChip: string;

  /** Accent used as *text*, which needs more contrast than accent-as-fill. */
  accentText: string;
  /** GET.coin gold, as text. */
  coinText: string;
  /** GET.coin gold, stronger (button labels on tinted ground). */
  coinTextStrong: string;
  /** Text inside the GET.coin earn pill. */
  coinPillText: string;

  /** Credit and debit amounts, drawn on a card surface. */
  amountPositive: string;
  amountNegative: string;
  /** Error copy on `surfaceDanger` — a darker red than the amount colour,
   *  which does not clear AA against a red tint. */
  dangerText: string;

  /** Alpha tints that need more opacity on a dark ground to stay visible. */
  amberTint: string;
  amberTintStrong: string;
  coinTint: string;
  accentTint: string;

  /** Brand wordmarks reverse out on a dark card. */
  brandVisa: string;
  brandFpx: string;
};

const LIGHT: WalletPalette = {
  screen: "#EEEFF3",
  surface: "#FFFFFF",
  surfaceAlt: "#F4F4F6",
  surfaceTint: "#EFF7FC",
  surfaceCoin: "#FFFDF4",
  surfaceReferral: "#F2FAFE",
  surfaceChip: "#EEF1F6",
  surfaceMuted: "#F1F3F5",
  surfaceCoinPill: "#FEF3C7",
  surfaceDanger: "#FEE2E2",
  surfaceSuccess: "#DCFCE7",
  qrSurface: QR_SURFACE,
  qrInk: QR_INK,

  border: "#E6E6EB",
  borderStrong: "#D7D7DE",
  divider: "#D2DFE9",
  hairline: "#F1F1F4",
  borderCoin: "#F3E8C0",
  borderReferral: "#C9E3F4",

  text: "#1C1C1E",
  textStrong: "#111827",
  textMuted: "#6B6B70",
  // Was #8E8E93 — 3.26:1 on white, below the 4.5:1 body-text floor.
  textFaint: "#6E6E76",
  placeholder: "#8E8E96",
  textChip: "#3A4157",

  // Was #2dabe2 — 2.61:1 on white. The accent is a fill colour, not a text
  // colour; as text on a light ground it needs to be darkened.
  accentText: "#1C7FA3",
  coinText: "#A16207",
  coinTextStrong: "#92400E",
  coinPillText: "#B45309",

  // Was #16A34A — 3.30:1 on a white card, below AA for the amount on every
  // credit row in the activity list.
  amountPositive: "#15803D",
  amountNegative: "#DC2626",
  dangerText: "#B91C1C",

  amberTint: "#F59E0B15",
  amberTintStrong: "#F59E0B22",
  coinTint: "#EAB30822",
  accentTint: "#2dabe212",

  brandVisa: "#1A1F71",
  brandFpx: "#1A2E6E",
};

const DARK: WalletPalette = {
  screen: "#0A0A0C",
  surface: "#17181C",
  surfaceAlt: "#202127",
  surfaceTint: "#13212B",
  surfaceCoin: "#1E1A0D",
  surfaceReferral: "#0F1E27",
  surfaceChip: "#24252B",
  surfaceMuted: "#212227",
  surfaceCoinPill: "#3A2E0B",
  surfaceDanger: "#3A1618",
  surfaceSuccess: "#0F2A18",
  qrSurface: QR_SURFACE,
  qrInk: QR_INK,

  border: "#2C2D34",
  borderStrong: "#3A3B44",
  divider: "#26333C",
  hairline: "#232429",
  borderCoin: "#4A3D14",
  borderReferral: "#1B3A4A",

  text: "#F5F5F7",
  textStrong: "#FFFFFF",
  textMuted: "#A9A9B2",
  textFaint: "#8E8E99",
  placeholder: "#6E6E78",
  textChip: "#C7C9D4",

  accentText: "#5CC4EE",
  coinText: "#FCD34D",
  coinTextStrong: "#FBBF24",
  coinPillText: "#FCD34D",

  // #DC2626 is 3.67:1 on the dark card — below AA.
  amountPositive: "#22C55E",
  amountNegative: "#F87171",
  dangerText: "#F87171",

  amberTint: "#F59E0B26",
  amberTintStrong: "#F59E0B33",
  coinTint: "#EAB30833",
  accentTint: "#2dabe233",

  // Reversed lockups: the brand hues are near-black on a dark card.
  brandVisa: "#FFFFFF",
  brandFpx: "#FFFFFF",
};

export function walletPalette(dark: boolean): WalletPalette {
  return dark ? DARK : LIGHT;
}
