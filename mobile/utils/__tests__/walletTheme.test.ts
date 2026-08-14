import { walletPalette, type WalletPalette } from "@/utils/walletTheme";

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MODES: [string, WalletPalette][] = [
  ["light", walletPalette(false)],
  ["dark", walletPalette(true)],
];

describe("walletPalette", () => {
  it.each(MODES)("%s: every token is an opaque 6-digit hex", (_mode, p) => {
    // These four carry an 8-digit alpha pair; every other token is opaque.
    const ALPHA = new Set(["amberTint", "amberTintStrong", "coinTint", "accentTint"]);
    for (const [role, value] of Object.entries(p)) {
      const expected = ALPHA.has(role) ? 9 : 7;
      expect([role, value.length]).toEqual([role, expected]);
      expect(value).toMatch(/^#[0-9A-Fa-f]+$/);
    }
  });

  // Body text must clear 4.5:1 against whatever it is drawn on. These are the
  // pairs the wallet screen actually renders.
  const BODY: [keyof WalletPalette, keyof WalletPalette][] = [
    ["text", "surface"],
    ["text", "surfaceAlt"],
    ["text", "surfaceTint"],
    ["text", "surfaceCoin"],
    ["text", "surfaceReferral"],
    ["textStrong", "surface"],
    ["textStrong", "surfaceCoin"],
    ["textStrong", "surfaceReferral"],
    ["textMuted", "surface"],
    ["textMuted", "surfaceAlt"],
    ["textMuted", "surfaceTint"],
    ["textMuted", "surfaceCoin"],
    ["textMuted", "surfaceReferral"],
    ["textMuted", "screen"],
    ["textMuted", "surfaceMuted"],
    ["text", "surfaceMuted"],
    ["coinPillText", "surfaceCoinPill"],
    ["dangerText", "surfaceDanger"],
    ["qrInk", "qrSurface"],
    ["textFaint", "surface"],
    ["textFaint", "surfaceTint"],
    ["textChip", "surfaceChip"],
    ["accentText", "surface"],
    ["coinText", "surfaceCoin"],
    ["coinTextStrong", "surface"],
    ["amountPositive", "surface"],
    ["amountNegative", "surface"],
    ["brandVisa", "surface"],
    ["brandFpx", "surface"],
  ];

  describe.each(MODES)("%s mode", (_mode, p) => {
    it.each(BODY)("%s on %s clears 4.5:1", (fg, bg) => {
      const ratio = contrast(p[fg], p[bg]);
      expect([fg, bg, ratio >= 4.5]).toEqual([fg, bg, true]);
    });

    // Placeholders and borders are non-text UI; AA asks 3:1 of them.
    it("placeholder clears 3:1 on its input surface", () => {
      expect(contrast(p.placeholder, p.surface)).toBeGreaterThanOrEqual(3);
    });

    it("borders and dividers are visible against their surfaces", () => {
      // 1.2:1 is the point at which an edge stops reading as an edge. Dividers
      // are deliberately quiet, so this is a floor, not a target.
      expect(contrast(p.border, p.surface)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(p.borderStrong, p.surface)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(p.hairline, p.surface)).toBeGreaterThanOrEqual(1.05);
      expect(contrast(p.divider, p.surfaceTint)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(p.borderCoin, p.surfaceCoin)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(p.borderReferral, p.surfaceReferral)).toBeGreaterThanOrEqual(1.2);
    });

    it("cards separate from the page backdrop", () => {
      expect(contrast(p.surface, p.screen)).toBeGreaterThanOrEqual(1.1);
      expect(contrast(p.surfaceMuted, p.surface)).toBeGreaterThanOrEqual(1.03);
    });
  });

  // A QR code is read by a camera. Inverting it in dark mode stops it scanning.
  it("keeps QR surfaces theme-independent", () => {
    expect(walletPalette(true).qrSurface).toBe(walletPalette(false).qrSurface);
    expect(walletPalette(true).qrInk).toBe(walletPalette(false).qrInk);
    expect(contrast(walletPalette(true).qrInk, walletPalette(true).qrSurface)).toBeGreaterThan(7);
  });

  it("light and dark define exactly the same roles", () => {
    expect(Object.keys(walletPalette(false)).sort()).toEqual(
      Object.keys(walletPalette(true)).sort()
    );
  });

  it("dark surfaces are darker than light surfaces", () => {
    expect(luminance(walletPalette(true).surface)).toBeLessThan(
      luminance(walletPalette(false).surface)
    );
  });
});
