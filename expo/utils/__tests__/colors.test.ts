import { lightColors, darkColors } from "@/constants/colors";

type Palette = typeof lightColors;

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

const MODES: [string, Palette][] = [
  ["light", lightColors],
  ["dark", darkColors],
];

/** The surfaces text is actually drawn on across the app. */
const surfacesOf = (p: Palette) => ({
  background: p.background,
  card: p.card,
  "gray.50": p.gray[50],
  "gray.100": p.gray[100],
});

describe("app palette", () => {
  describe.each(MODES)("%s mode", (_mode, p) => {
    const surfaces = Object.entries(surfacesOf(p));

    // Body text: 4.5:1. These are the tokens screens pass to `color`.
    const BODY: (keyof Palette)[] = [
      "text",
      "textSecondary",
      "subtext",
      "accentText",
      "errorText",
      "dangerText",
      "successText",
      "warningText",
    ];

    it.each(BODY)("%s clears 4.5:1 on every common surface", (token) => {
      for (const [name, surface] of surfaces) {
        const ratio = contrast(p[token] as string, surface);
        expect([token, name, ratio >= 4.5]).toEqual([token, name, true]);
      }
    });

    // Text drawn on the fill of the same name.
    it("text on a semantic fill is readable", () => {
      expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onSuccess, p.success)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onWarning, p.warning)).toBeGreaterThanOrEqual(4.5);
      // Red is the one fill where the conventional white lettering sits between
      // the 3:1 non-text floor and the 4.5:1 text floor. It carries icons and
      // short all-caps labels only, so 3:1 is the bar it is held to.
      expect(contrast(p.onError, p.error)).toBeGreaterThanOrEqual(3);
    });

    // Icons and other non-text UI: 3:1.
    it("fills used as icon colour clear 3:1 on background and card", () => {
      for (const token of ["accentText", "errorText", "successText", "warningText"] as const) {
        for (const surface of [p.background, p.card]) {
          expect([token, contrast(p[token], surface) >= 3]).toEqual([token, true]);
        }
      }
    });

    it("borders are visible against the surfaces they divide", () => {
      expect(contrast(p.border, p.background)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(p.border, p.card)).toBeGreaterThanOrEqual(1.2);
    });

    it("cards separate from the page background", () => {
      // In light mode both are white by design; the separation is the border.
      const sameByDesign = p.card === p.background;
      expect(sameByDesign || contrast(p.card, p.background) >= 1.1).toBe(true);
    });
  });

  it("light and dark define exactly the same tokens", () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });

  it("every text twin keeps the hue family of its fill", () => {
    // A twin that drifted to another hue would stop reading as the same status.
    const hue = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
      const max = Math.max(r, g, b);
      return max === r ? "r" : max === g ? "g" : "b";
    };
    for (const p of [lightColors, darkColors]) {
      expect(hue(p.accentText)).toBe(hue(p.accent));
      expect(hue(p.errorText)).toBe(hue(p.error));
      expect(hue(p.successText)).toBe(hue(p.success));
      expect(hue(p.warningText)).toBe(hue(p.warning));
    }
  });
});
