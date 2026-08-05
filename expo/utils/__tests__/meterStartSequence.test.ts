import {
  describeMeterStartMode,
  IDLE_ODOMETER,
  meterSourcesForMode,
  meterStartModeOptions,
  meterStartModeSources,
  resolveMeterStartSequence,
  type MeterStartSequenceInputs,
} from "@/utils/meterStartSequence";

const GATE = {
  title: "Connecting to the vehicle…",
  message: "Linking the OBD-II reader.",
  connecting: true,
};

const BASE: MeterStartSequenceInputs = {
  sources: { obd: true, gps: true },
  mode: null,
  obdLinked: false,
  obdDemo: false,
  readsOdometer: true,
  allowWithoutOdometer: true,
  odometer: IDLE_ODOMETER,
  gate: GATE,
};

const seq = (over: Partial<MeterStartSequenceInputs> = {}) =>
  resolveMeterStartSequence({ ...BASE, ...over });

describe("meterStartModeOptions", () => {
  it("offers both choices when the card allows both sensors", () => {
    const options = meterStartModeOptions({ obd: true, gps: true });
    expect(options.map((o) => o.mode)).toEqual(["gps+obd", "obd"]);
    options.forEach((o) => {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.detail.length).toBeGreaterThan(0);
    });
  });

  it("offers only the bus on an OBD-only card — there is no fallback to choose", () => {
    expect(meterStartModeOptions({ obd: true, gps: false }).map((o) => o.mode)).toEqual([
      "obd",
    ]);
  });

  it("offers nothing on a GPS-only card, which has taken the bus away", () => {
    expect(meterStartModeOptions({ obd: false, gps: true })).toEqual([]);
  });
});

describe("meterSourcesForMode", () => {
  it("narrows the card, never widens it", () => {
    expect(meterSourcesForMode({ obd: true, gps: true }, "obd")).toEqual({
      obd: true,
      gps: false,
    });
    expect(meterSourcesForMode({ obd: true, gps: true }, "gps+obd")).toEqual({
      obd: true,
      gps: true,
    });
    // A card with no bus stays a card with no bus, whatever was picked.
    expect(meterSourcesForMode({ obd: false, gps: true }, "gps+obd")).toEqual({
      obd: false,
      gps: true,
    });
    // A GPS-only card cannot have GPS handed back by an "OBD only" choice.
    expect(meterSourcesForMode({ obd: true, gps: false }, "gps+obd")).toEqual({
      obd: true,
      gps: false,
    });
  });

  it("leaves the card alone until a choice is made", () => {
    expect(meterSourcesForMode({ obd: true, gps: true }, null)).toEqual({
      obd: true,
      gps: true,
    });
  });

  it("agrees with the mode's own sensors", () => {
    expect(meterStartModeSources("obd")).toEqual({ obd: true, gps: false });
    expect(meterStartModeSources("gps+obd")).toEqual({ obd: true, gps: true });
  });
});

describe("resolveMeterStartSequence", () => {
  it("asks for the billing source first", () => {
    const s = seq();
    expect(s.step).toBe("mode");
    expect(s.mode).toBeNull();
    expect(s.canStart).toBe(false);
    expect(s.options).toHaveLength(2);
  });

  it("does not ask when the card leaves no choice", () => {
    const s = seq({ sources: { obd: true, gps: false } });
    expect(s.step).toBe("link");
    expect(s.mode).toBe("obd");
  });

  it("requires the vehicle link before a fare may open, on either choice", () => {
    (["obd", "gps+obd"] as const).forEach((mode) => {
      const s = seq({ mode });
      expect(s.step).toBe("link");
      expect(s.canStart).toBe(false);
      // The link step speaks with the gate's voice rather than its own.
      expect(s.title).toBe(GATE.title);
      expect(s.message).toBe(GATE.message);
      expect(s.connecting).toBe(true);
    });
  });

  it("asks the reader for the odometer once the link is up", () => {
    const s = seq({ mode: "gps+obd", obdLinked: true });
    expect(s.step).toBe("odometer");
    expect(s.shouldRead).toBe(true);
    expect(s.canStart).toBe(false);
  });

  it("does not ask twice while a read is in flight", () => {
    const s = seq({
      mode: "gps+obd",
      obdLinked: true,
      odometer: { status: "reading", km: null },
    });
    expect(s.step).toBe("odometer");
    expect(s.shouldRead).toBe(false);
    expect(s.canStart).toBe(false);
  });

  it("opens the hire once the odometer is captured, and prints it", () => {
    const s = seq({
      mode: "obd",
      obdLinked: true,
      odometer: { status: "captured", km: 128_450.6 },
    });
    expect(s.step).toBe("ready");
    expect(s.canStart).toBe(true);
    expect(s.odometerText).toBe("128 450.6 km");
  });

  it("skips the reading entirely when the card does not take one", () => {
    const s = seq({ mode: "obd", obdLinked: true, readsOdometer: false });
    expect(s.step).toBe("ready");
    expect(s.canStart).toBe(true);
    expect(s.shouldRead).toBe(false);
    expect(s.odometerText).toBeNull();
  });

  describe("a car that does not publish PID A6", () => {
    const unreported = {
      mode: "obd" as const,
      obdLinked: true,
      odometer: { status: "unavailable" as const, km: null },
    };

    it("still opens the hire where the card allows it", () => {
      const s = seq(unreported);
      expect(s.step).toBe("odometer");
      expect(s.canStart).toBe(true);
      expect(s.title).toBe("Odometer not reported");
      expect(s.odometerText).toBeNull();
    });

    it("holds the hire where the card requires the reading", () => {
      const s = seq({ ...unreported, allowWithoutOdometer: false });
      expect(s.canStart).toBe(false);
      expect(s.message).toContain("requires one");
    });
  });

  describe("Demo Mode", () => {
    it("passes the link step, as the admin-gated simulation it is", () => {
      const s = seq({ mode: "gps+obd", obdDemo: true });
      expect(s.step).not.toBe("link");
    });

    it("has no vehicle to ask, and says so rather than inventing a reading", () => {
      const s = seq({
        mode: "gps+obd",
        obdDemo: true,
        odometer: { status: "unavailable", km: null },
      });
      expect(s.canStart).toBe(true);
      expect(s.message).toContain("Demo Mode has no vehicle to ask");
      expect(s.odometerText).toBeNull();
    });

    it("is refused by a card that requires the odometer", () => {
      const s = seq({
        mode: "gps+obd",
        obdDemo: true,
        allowWithoutOdometer: false,
        odometer: { status: "unavailable", km: null },
      });
      expect(s.canStart).toBe(false);
    });
  });

  it("has nothing to sequence on a GPS-only card", () => {
    const s = seq({ sources: { obd: false, gps: true } });
    expect(s.step).toBe("ready");
    expect(s.mode).toBeNull();
    expect(s.options).toEqual([]);
    expect(s.canStart).toBe(true);
    expect(s.shouldRead).toBe(false);
  });
});

describe("describeMeterStartMode", () => {
  it("names the sensors in force", () => {
    expect(describeMeterStartMode("obd")).toBe("OBD-II ONLY");
    expect(describeMeterStartMode("gps+obd")).toBe("OBD-II + GPS");
    expect(describeMeterStartMode(null)).toBe("GPS");
  });
});
