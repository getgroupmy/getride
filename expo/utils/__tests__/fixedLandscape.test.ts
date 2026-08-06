import {
  resolveLandscapeStage,
  stageInsetTotals,
  STAGE_ROTATION,
} from "@/utils/fixedLandscape";

describe("resolveLandscapeStage", () => {
  describe("a landscape viewport is left alone", () => {
    it("passes the glass straight through", () => {
      const stage = resolveLandscapeStage(800, 400);
      expect(stage).toMatchObject({
        width: 800,
        height: 400,
        rotated: false,
        left: 0,
        top: 0,
      });
    });

    it("keeps the insets on the edges they came from", () => {
      const stage = resolveLandscapeStage(800, 400, {
        top: 1,
        right: 2,
        bottom: 3,
        left: 4,
      });
      expect(stage.insets).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    });

    it("treats a square viewport as landscape, so nothing flips on the tie", () => {
      expect(resolveLandscapeStage(500, 500).rotated).toBe(false);
    });
  });

  describe("a portrait viewport is turned", () => {
    it("lays the content out in the swapped box", () => {
      const stage = resolveLandscapeStage(400, 800);
      expect(stage.width).toBe(800);
      expect(stage.height).toBe(400);
      expect(stage.rotated).toBe(true);
    });

    it("pins the box so its centre is the glass's centre", () => {
      const stage = resolveLandscapeStage(400, 800);
      // The box is 800x400 placed at (-200, 200): its centre lands on
      // (200, 400) — the centre of the 400x800 glass — so the quarter turn
      // covers the screen exactly.
      expect(stage.left).toBe(-200);
      expect(stage.top).toBe(200);
      expect(stage.left + stage.width / 2).toBe(400 / 2);
      expect(stage.top + stage.height / 2).toBe(800 / 2);
    });

    it("rolls the insets round with the content", () => {
      const stage = resolveLandscapeStage(400, 800, {
        top: 1,
        right: 2,
        bottom: 3,
        left: 4,
      });
      // Turned clockwise: the content's top edge is against the screen's right.
      expect(stage.insets).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    });

    it("keeps a notch out of the content rather than off whichever edge is up", () => {
      // A phone held upright: a tall status inset at the top, a home indicator
      // at the bottom. Turned, those become the content's left and right.
      const stage = resolveLandscapeStage(390, 844, { top: 59, bottom: 34 });
      expect(stage.insets.left).toBe(59);
      expect(stage.insets.right).toBe(34);
      expect(stage.insets.top).toBe(0);
      expect(stage.insets.bottom).toBe(0);
    });
  });

  describe("degenerate viewports", () => {
    it("does not produce NaN sizes from a non-finite viewport", () => {
      const stage = resolveLandscapeStage(Number.NaN, Number.POSITIVE_INFINITY);
      expect(Number.isFinite(stage.width)).toBe(true);
      expect(Number.isFinite(stage.height)).toBe(true);
    });

    it("clamps negative insets rather than padding by a negative", () => {
      const stage = resolveLandscapeStage(800, 400, { top: -20, left: -5 });
      expect(stage.insets.top).toBe(0);
      expect(stage.insets.left).toBe(0);
    });

    it("survives a zero viewport", () => {
      const stage = resolveLandscapeStage(0, 0);
      expect(stage).toMatchObject({ width: 0, height: 0, rotated: false });
    });
  });

  it("turns exactly a quarter", () => {
    expect(STAGE_ROTATION).toBe("90deg");
  });
});

describe("stageInsetTotals", () => {
  it("sums the edges the content actually has", () => {
    const stage = resolveLandscapeStage(800, 400, {
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
    expect(stageInsetTotals(stage)).toEqual({ horizontal: 60, vertical: 40 });
  });

  it("reports the turned totals for a rotated stage", () => {
    const stage = resolveLandscapeStage(400, 800, {
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
    // Rolled round: the content's horizontal is the screen's top+bottom
    // (10+30) and its vertical is the screen's right+left (20+40).
    expect(stageInsetTotals(stage)).toEqual({ horizontal: 40, vertical: 60 });
  });
});
