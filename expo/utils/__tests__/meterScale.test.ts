import {
  computeMeterMetrics,
  fitDigits,
  meterScale,
  MAX_METER_SCALE,
  MIN_METER_SCALE,
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

describe("computeMeterMetrics", () => {
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

  it("keeps the clock readout inside its own half of the left column", () => {
    for (const size of [PHONE, TABLET_7, TABLET_10]) {
      const m = computeMeterMetrics(size.width, size.height);
      const gridWidth = size.width - m.bodyPad * 2 - m.gap;
      const statPanel = (gridWidth / 2.85 - m.gap) / 2;
      // "00:00:00" — the longest thing a stat panel ever shows.
      expect(m.pad * 2 + m.statSize * 8 * 0.62).toBeLessThanOrEqual(
        statPanel + 0.5,
      );
    }
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
    expect(tiny.statSize).toBeGreaterThan(0);
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
