import {
  computeMeterMetrics,
  fitDigits,
  fitMoneyPanel,
  fitReadout,
  fitReadoutBox,
  meterScale,
  MAX_METER_SCALE,
  MIN_KEY_HEIGHT,
  MIN_METER_SCALE,
  MIN_READOUT_PT,
} from "@/utils/meterScale";

/** The three mounts the meter is actually read off. */
const PHONE = { width: 844, height: 390 }; // iPhone-class, landscape, in a cradle
const TABLET_7 = { width: 1024, height: 600 };
const TABLET_10 = { width: 1366, height: 900 };

describe("meterScale", () => {
  it("fits the tighter axis, so a wide-but-short viewport never sizes off its width", () => {
    // 1366 wide would allow 1.5×, but 430 tall only allows 1×.
    expect(meterScale(1366, 430)).toBeCloseTo(1, 5);
  });

  it("grows with the glass, up to the ceiling", () => {
    expect(meterScale(PHONE.width, PHONE.height)).toBeLessThan(1);
    expect(meterScale(TABLET_7.width, TABLET_7.height)).toBeGreaterThan(1);
    expect(meterScale(TABLET_10.width, TABLET_10.height)).toBeGreaterThan(
      meterScale(TABLET_7.width, TABLET_7.height),
    );
  });

  it("clamps rather than drawing a cartoon or an unreadable meter", () => {
    expect(meterScale(4000, 4000)).toBe(MAX_METER_SCALE);
    expect(meterScale(320, 200)).toBe(MIN_METER_SCALE);
  });

  it("falls back to 1 for a viewport it cannot measure", () => {
    expect(meterScale(NaN, 390)).toBe(1);
    expect(meterScale(844, 0)).toBe(1);
    expect(meterScale(-844, -390)).toBe(1);
  });
});

describe("fitDigits", () => {
  it("shrinks the point size as the panel narrows", () => {
    const wide = fitDigits(400, 6, 40);
    const narrow = fitDigits(200, 6, 40);
    expect(narrow).toBeLessThan(wide);
  });

  it("shrinks as the value gets longer", () => {
    expect(fitDigits(300, 8, 40)).toBeLessThan(fitDigits(300, 6, 40));
  });

  it("returns nothing usable when the reservation eats the panel", () => {
    expect(fitDigits(40, 6, 60)).toBe(0);
    expect(fitDigits(Number.NaN, 6, 10)).toBe(0);
    expect(fitDigits(300, 0, 10)).toBe(0);
  });
});

describe("fitReadout", () => {
  it("never draws above the ceiling its panel has vertically", () => {
    // A very wide panel could fit enormous digits; the height cap still wins.
    expect(fitReadout(4000, 4, 0, 28)).toBe(28);
  });

  it("shrinks to keep a longer value whole", () => {
    // Nine characters do not fit this panel at the ceiling; four do, and are
    // drawn at it rather than shrunk to match.
    expect(fitReadout(200, 9, 24, 40)).toBeLessThan(40);
    expect(fitReadout(200, 4, 24, 40)).toBe(40);
  });

  it("holds the legibility floor rather than drawing a readout nobody can read", () => {
    expect(fitReadout(60, 9, 24, 40)).toBe(MIN_READOUT_PT);
    // No room at all: the floor is still what gets drawn, and the panel clips.
    expect(fitReadout(10, 9, 24, 40)).toBe(MIN_READOUT_PT);
  });
});

describe("fitReadoutBox", () => {
  it("fits the tighter axis of the box it was measured in", () => {
    // Wide but shallow: the height is what may not be exceeded.
    expect(fitReadoutBox(4000, 40, 8, 0, 90)).toBeLessThanOrEqual(Math.round(40 / 1.26));
    // Deep but narrow: the width is.
    const narrow = fitReadoutBox(120, 4000, 8, 0, 90);
    expect(narrow * 8 * 0.62).toBeLessThanOrEqual(120);
  });

  it("never exceeds the viewport ceiling, however big the box", () => {
    expect(fitReadoutBox(4000, 4000, 4, 0, 28)).toBe(28);
  });

  it("falls through to the axis that has been measured", () => {
    // First frame: a width but no height yet, and the reverse.
    expect(fitReadoutBox(300, 0, 4, 0, 90)).toBeGreaterThan(MIN_READOUT_PT);
    expect(fitReadoutBox(0, 300, 4, 0, 90)).toBeGreaterThan(MIN_READOUT_PT);
    // Nothing measured at all: the floor, and the panel clips.
    expect(fitReadoutBox(0, 0, 4, 0, 90)).toBe(MIN_READOUT_PT);
  });

  it("keeps a growing clock whole in a box that does not grow", () => {
    const box = { width: 180, height: 60 };
    for (const value of ["00:04", "00:04:07", "104:07:22"]) {
      const drawn = fitReadoutBox(box.width, box.height, value.length, 0, 40);
      expect(drawn * value.length * 0.62).toBeLessThanOrEqual(box.width + 0.5);
      expect(drawn * 1.26).toBeLessThanOrEqual(box.height + 0.5);
    }
  });
});

describe("fitMoneyPanel", () => {
  const panel = (height: number, captionLines: number) =>
    fitMoneyPanel({
      width: 300,
      height,
      chars: 4,
      pad: 10,
      gap: 8,
      textLines: captionLines === 2 ? [12, 10] : [12],
      reservedWidth: 30,
      maxReadout: 56,
      maxKeyHeight: 40,
    });

  it("draws the readout and the keys inside the panel they were measured in", () => {
    for (const height of [120, 180, 240, 320]) {
      const fit = panel(height, 2);
      const label = 12 * 1.35;
      const caption = 10 * 1.35;
      const stack =
        10 * 2 + label + caption + 8 * 3 + fit.readoutSize * 1.26 + fit.keyHeight;
      expect(stack).toBeLessThanOrEqual(height + 0.5);
    }
  });

  it("gives the readout its ground back when the caption goes", () => {
    // The FARE panel only carries its total line once there is an extra, so it
    // has more room for digits than EXTRA does at the same height.
    expect(panel(200, 1).readoutSize).toBeGreaterThan(panel(200, 2).readoutSize);
  });

  it("keeps the keys pressable on a console with almost no height", () => {
    expect(panel(90, 2).keyHeight).toBeGreaterThanOrEqual(MIN_KEY_HEIGHT - 0.5);
  });

  it("holds the viewport ceilings before it has been measured", () => {
    const first = fitMoneyPanel({
      width: 0,
      height: 0,
      chars: 4,
      pad: 10,
      gap: 8,
      textLines: [12, 10],
      reservedWidth: 30,
      maxReadout: 48,
      maxKeyHeight: 40,
    });
    expect(first.readoutSize).toBe(48);
    expect(first.keyHeight).toBe(40);
  });
});

describe("computeMeterMetrics", () => {
  it("sizes to the glass the console actually gets, not the whole window", () => {
    // A landscape notch takes ~100pt of width and the home indicator ~21pt of
    // height; panels predicted off the raw window are that much too wide.
    const raw = computeMeterMetrics(PHONE.width, PHONE.height);
    const inset = computeMeterMetrics(PHONE.width, PHONE.height, {
      horizontal: 118,
      vertical: 21,
    });
    expect(inset.statPanelWidth).toBeLessThan(raw.statPanelWidth);
    expect(inset.scale).toBeLessThanOrEqual(raw.scale);
  });

  it("ignores chrome it cannot make sense of", () => {
    const plain = computeMeterMetrics(PHONE.width, PHONE.height);
    const negative = computeMeterMetrics(PHONE.width, PHONE.height, {
      horizontal: -50,
    });
    expect(negative.statPanelWidth).toBeCloseTo(plain.statPanelWidth, 5);
  });

  it("keeps the fare digits inside the panel that holds them", () => {
    for (const size of [PHONE, TABLET_7, TABLET_10, { width: 667, height: 375 }]) {
      const m = computeMeterMetrics(size.width, size.height);
      const gridWidth = size.width - m.bodyPad * 2 - m.gap;
      const farePanel = ((gridWidth / 2.85) * 1.85 - m.gap) / 2;
      // "RM" + gap + "999.99" at ~0.62 em per monospace glyph, inside padding.
      const drawn =
        m.pad * 2 + m.currencySize * 1.6 + m.gap + m.fareSize * 6 * 0.62;
      expect(drawn).toBeLessThanOrEqual(farePanel + 0.5);
    }
  });

  it("hands the stat panels their own width, so a readout can be fitted to it", () => {
    for (const size of [PHONE, TABLET_7, TABLET_10]) {
      const m = computeMeterMetrics(size.width, size.height);
      const gridWidth = size.width - m.bodyPad * 2 - m.gap;
      expect(m.statPanelWidth).toBeCloseTo((gridWidth / 2.85 - m.gap) / 2, 5);
    }
  });

  it("keeps every character of a stat readout inside its own panel", () => {
    for (const size of [PHONE, TABLET_7, TABLET_10, { width: 667, height: 375 }]) {
      const m = computeMeterMetrics(size.width, size.height);
      // The clock as it grows: "04:07", an hour in, and past a hundred hours.
      for (const value of ["00:04:07", "104:07:22", "9.99", "1234.56"]) {
        const drawn = fitReadout(
          m.statPanelWidth,
          value.length,
          m.pad * 2,
          m.statSizeMax,
        );
        // 0.62 em is the real advance of the platform monospace face; the
        // fitting carries margin above it, so the drawn width must sit inside.
        expect(m.pad * 2 + drawn * value.length * 0.62).toBeLessThanOrEqual(
          m.statPanelWidth + 0.5,
        );
      }
    }
  });

  it("sizes a stat readout to the value in hand, not to the longest one it might hold", () => {
    const m = computeMeterMetrics(PHONE.width, PHONE.height);
    const short = fitReadout(m.statPanelWidth, "4.20".length, m.pad * 2, m.statSizeMax);
    const long = fitReadout(
      m.statPanelWidth,
      "104:07:22".length,
      m.pad * 2,
      m.statSizeMax,
    );
    expect(short).toBeGreaterThan(long);
    expect(short).toBeLessThanOrEqual(m.statSizeMax);
  });

  it("never sizes the fare above the room its panel has vertically", () => {
    // A short viewport is the case that used to overflow: proportional digits
    // in a panel that has no proportional height left.
    const short = computeMeterMetrics(1366, 320);
    const tall = computeMeterMetrics(1366, 900);
    expect(short.fareSize).toBeLessThan(tall.fareSize);
  });

  it("scales every size together, so nothing is left at a fixed point size", () => {
    const small = computeMeterMetrics(PHONE.width, PHONE.height);
    const large = computeMeterMetrics(TABLET_10.width, TABLET_10.height);
    const keys = [
      "pad",
      "gap",
      "bodyPad",
      "statusSize",
      "panelLabel",
      "nameSize",
      "bodyText",
      "buttonHeight",
      "buttonText",
      "keyHeight",
      "keyText",
      "wideButtonHeight",
      "wideButtonText",
      "avatar",
      "tabIcon",
      "tabLabel",
      "headerTitle",
      "tripWhenWidth",
    ] as const;
    for (const key of keys) {
      expect(large[key]).toBeGreaterThan(small[key]);
    }
  });

  it("holds a legibility floor: a dash instrument is read at a glance", () => {
    const tiny = computeMeterMetrics(360, 240);
    expect(tiny.panelLabel).toBeGreaterThanOrEqual(9);
    expect(tiny.tabLabel).toBeGreaterThanOrEqual(8);
    expect(tiny.buttonText).toBeGreaterThanOrEqual(12);
    expect(tiny.fareSize).toBeGreaterThan(0);
    expect(
      fitReadout(tiny.statPanelWidth, 8, tiny.pad * 2, tiny.statSizeMax),
    ).toBeGreaterThanOrEqual(MIN_READOUT_PT);
  });

  it("drops the header date only on a viewport too narrow for it", () => {
    // A small landscape phone (iPhone SE-class) has no room for the date
    // beside the clock and the status cluster; the date is what goes.
    expect(computeMeterMetrics(667, 375).showHeaderDate).toBe(false);
    expect(computeMeterMetrics(TABLET_7.width, TABLET_7.height).showHeaderDate).toBe(
      true,
    );
  });
});
