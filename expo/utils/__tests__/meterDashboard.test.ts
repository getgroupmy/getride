import {
  describeMeterConnection,
  describeMeterSubline,
  evaluateMeterStart,
  formatDashDate,
  formatDashTime,
  formatOdometerSpan,
  formatPlaceSpan,
  formatWaypointCoords,
  formatWaypointOdometer,
  formatWaypointPlace,
  normalizeMeterWaypoint,
  resolveMeterBack,
  segmentGhost,
  type MeterConnectionInputs,
  type MeterWaypoint,
} from "@/utils/meterDashboard";

/** A parked meter with nothing connected — every case starts from here. */
const IDLE: MeterConnectionInputs = {
  running: false,
  obdLinked: false,
  obdConnecting: false,
  obdDemo: false,
  hasGpsFix: false,
  gpsDenied: false,
};

describe("describeMeterConnection", () => {
  it("names both sensors when the meter has both", () => {
    expect(
      describeMeterConnection({ ...IDLE, obdLinked: true, hasGpsFix: true }),
    ).toEqual({
      type: "gps+obd",
      label: "GPS + OBD-II",
      tone: "ok",
      fromVehicle: true,
      demo: false,
    });
  });

  it("names the one sensor it has when that is all there is", () => {
    expect(describeMeterConnection({ ...IDLE, obdLinked: true })).toMatchObject({
      type: "obd",
      label: "OBD-II ONLY",
      fromVehicle: true,
    });
    expect(describeMeterConnection({ ...IDLE, hasGpsFix: true })).toMatchObject({
      type: "gps",
      label: "GPS ONLY",
      fromVehicle: false,
    });
  });

  it("does not count a stale fix the platform has taken back", () => {
    // Permission revoked mid-hire: the last fix is not a live connection.
    expect(
      describeMeterConnection({ ...IDLE, hasGpsFix: true, gpsDenied: true }).type,
    ).toBe("none");
  });

  it("never counts Demo Mode as a vehicle link", () => {
    const demoOnly = describeMeterConnection({ ...IDLE, obdDemo: true });
    expect(demoOnly.type).toBe("none");
    expect(demoOnly.label).toBe("DEMO MODE");
    expect(demoOnly.demo).toBe(true);

    // With a fix the type is GPS — the simulator adds nothing to it, and is
    // flagged beside the type rather than folded into it.
    const demoWithGps = describeMeterConnection({
      ...IDLE,
      obdDemo: true,
      hasGpsFix: true,
    });
    expect(demoWithGps.type).toBe("gps");
    expect(demoWithGps.demo).toBe(true);

    // Once a real reader answers, the link is the car.
    expect(
      describeMeterConnection({ ...IDLE, obdDemo: true, obdLinked: true }).demo,
    ).toBe(false);
  });

  it("reports the reason, worst first, when it has neither", () => {
    expect(describeMeterConnection({ ...IDLE, gpsDenied: true }).label).toBe(
      "LOCATION OFF",
    );
    expect(describeMeterConnection({ ...IDLE, obdConnecting: true }).label).toBe(
      "LINKING READER",
    );
    expect(describeMeterConnection(IDLE).label).toBe("ACQUIRING GPS");
    // A hire under way with nothing to measure on is not "acquiring" — it is a
    // meter that has lost its signal.
    expect(describeMeterConnection({ ...IDLE, running: true })).toEqual({
      type: "none",
      label: "NO SIGNAL",
      tone: "bad",
      fromVehicle: false,
      demo: false,
    });
  });

  it("keeps a refused permission louder than Demo Mode", () => {
    expect(
      describeMeterConnection({ ...IDLE, obdDemo: true, gpsDenied: true }).label,
    ).toBe("LOCATION OFF");
  });
});

describe("evaluateMeterStart", () => {
  const NO_LINK = { obdLinked: false, obdDemo: false, obdConnecting: false };

  it("opens a hire only on a vehicle link", () => {
    expect(evaluateMeterStart({ ...NO_LINK, obdLinked: true }).canStart).toBe(true);
    expect(evaluateMeterStart(NO_LINK).canStart).toBe(false);
  });

  it("lets Demo Mode through, saying plainly what it is", () => {
    const gate = evaluateMeterStart({ ...NO_LINK, obdDemo: true });
    expect(gate.canStart).toBe(true);
    expect(gate.title).toBe("Demo Mode");
    expect(gate.message).toContain("bills on GPS");
  });

  it("holds the hire while a link attempt is in flight", () => {
    const gate = evaluateMeterStart({ ...NO_LINK, obdConnecting: true });
    expect(gate.canStart).toBe(false);
    expect(gate.connecting).toBe(true);
    expect(gate.title).toBe("Connecting to the vehicle…");
  });

  it("repeats the reader's own error rather than a generic one", () => {
    const gate = evaluateMeterStart({ ...NO_LINK, obdError: "Adapter not found" });
    expect(gate.canStart).toBe(false);
    expect(gate.message).toContain("Adapter not found");
    expect(gate.message).toContain("OBD-II (CANBus) reader");

    // Blank/absent errors fall back to the plain statement of fact.
    expect(evaluateMeterStart({ ...NO_LINK, obdError: "  " }).message).toContain(
      "No OBD-II reader is connected",
    );
  });
});

describe("resolveMeterBack", () => {
  it("returns to the meter from any other panel", () => {
    expect(resolveMeterBack({ onMeterPanel: false, running: false })).toBe("panel");
  });

  it("returns to the meter from another panel even while a fare runs", () => {
    // The panels are inner navigation: what a running hire blocks is leaving
    // the console, not stepping off the trip log back onto the meter.
    expect(resolveMeterBack({ onMeterPanel: false, running: true })).toBe("panel");
  });

  it("asks where the driver is going when the meter is idle", () => {
    expect(resolveMeterBack({ onMeterPanel: true, running: false })).toBe("prompt");
  });

  it("refuses to leave the console with a fare accruing", () => {
    expect(resolveMeterBack({ onMeterPanel: true, running: true })).toBe("blocked");
  });

  it("refuses to leave a hire that stopped but was never declared", () => {
    // The fare has stopped, but the record is not written until the driver has
    // declared the hire — walking out now would lose it just the same.
    expect(
      resolveMeterBack({ onMeterPanel: true, running: false, ending: true }),
    ).toBe("blocked");
  });

  it("still steps back onto the meter from another panel while one is ending", () => {
    expect(
      resolveMeterBack({ onMeterPanel: false, running: false, ending: true }),
    ).toBe("panel");
  });
});

describe("waypoint readings", () => {
  const AT = 1_700_000_000_000;
  const waypoint = (over: Partial<MeterWaypoint> = {}): MeterWaypoint => ({
    at: AT,
    odometerKm: null,
    latitude: null,
    longitude: null,
    place: null,
    ...over,
  });

  it("groups an odometer the way a dash cluster prints it", () => {
    expect(formatWaypointOdometer(128450.62)).toBe("128 450.6 km");
    expect(formatWaypointOdometer(0)).toBe("0.0 km");
    expect(formatWaypointOdometer(999)).toBe("999.0 km");
    expect(formatWaypointOdometer(1234567.8)).toBe("1 234 567.8 km");
  });

  it("says nothing rather than inventing an odometer", () => {
    // A car without PID A6 has no odometer to read, and nothing else can supply
    // one — GPS cannot know what the cluster says.
    expect(formatWaypointOdometer(null)).toBe("—");
    expect(formatWaypointOdometer(undefined)).toBe("—");
    expect(formatWaypointOdometer(Number.NaN)).toBe("—");
    expect(formatWaypointOdometer(-1)).toBe("—");
  });

  it("prints a fix to five decimals", () => {
    expect(formatWaypointCoords(3.139, 101.6869)).toBe("3.13900, 101.68690");
    expect(formatWaypointCoords(3.139, null)).toBeNull();
    expect(formatWaypointCoords(Number.NaN, 101.6869)).toBeNull();
  });

  it("falls back from the address to the fix, and says so when there is neither", () => {
    const located = { latitude: 3.139, longitude: 101.6869 };
    expect(
      formatWaypointPlace(waypoint({ ...located, place: "KLCC, Kuala Lumpur" })),
    ).toBe("KLCC, Kuala Lumpur");
    expect(formatWaypointPlace(waypoint({ ...located, place: "   " }))).toBe(
      "3.13900, 101.68690",
    );
    expect(formatWaypointPlace(waypoint())).toBe("NO FIX");
    expect(formatWaypointPlace(null)).toBe("—");
  });

  it("prints the odometer across the hire, and nothing when there is none", () => {
    expect(
      formatOdometerSpan(
        waypoint({ odometerKm: 128450.6 }),
        waypoint({ odometerKm: 128462.14 }),
      ),
    ).toBe("128 450.6 → 128 462.1 km");
    // One end read it and the other did not — the gap is shown as a gap.
    expect(formatOdometerSpan(waypoint({ odometerKm: 128450.6 }), waypoint())).toBe(
      "128 450.6 → — km",
    );
    expect(formatOdometerSpan(waypoint(), waypoint({ odometerKm: 12 }))).toBe(
      "— → 12.0 km",
    );
    // Neither end has one: the caller drops the line rather than printing dashes.
    expect(formatOdometerSpan(waypoint(), waypoint())).toBeNull();
    expect(formatOdometerSpan(null, null)).toBeNull();
  });

  it("prints where the hire ran, and nothing for a record that never stamped it", () => {
    expect(
      formatPlaceSpan(waypoint({ place: "KLCC" }), waypoint({ place: "Bangsar" })),
    ).toBe("KLCC → Bangsar");
    // A hire still running has no drop-off yet — that is a dash, not a blank.
    expect(formatPlaceSpan(waypoint({ place: "KLCC" }), null)).toBe("KLCC → —");
    // A record written before the meter stamped its ends carries neither.
    expect(formatPlaceSpan(null, null)).toBeNull();
  });
});

describe("normalizeMeterWaypoint", () => {
  it("keeps a stamped end whole", () => {
    expect(
      normalizeMeterWaypoint({
        at: 5,
        odometerKm: 128450.6,
        latitude: 3.139,
        longitude: 101.6869,
        place: "  KLCC  ",
      }),
    ).toEqual({
      at: 5,
      odometerKm: 128450.6,
      latitude: 3.139,
      longitude: 101.6869,
      place: "KLCC",
    });
  });

  it("drops readings it cannot use rather than storing them", () => {
    const cleaned = normalizeMeterWaypoint({
      at: 5,
      odometerKm: -3,
      // Half a fix cannot be plotted, so neither half is kept.
      latitude: 3.139,
      longitude: null,
      place: "   ",
    });
    expect(cleaned).toEqual({
      at: 5,
      odometerKm: null,
      latitude: null,
      longitude: null,
      place: null,
    });
  });

  it("is null for anything that is not a stamped end", () => {
    // What a record written before this feature looks like.
    expect(normalizeMeterWaypoint(undefined)).toBeNull();
    expect(normalizeMeterWaypoint(null)).toBeNull();
    expect(normalizeMeterWaypoint("KLCC")).toBeNull();
    expect(normalizeMeterWaypoint({ odometerKm: 12 })).toBeNull();
  });
});

describe("describeMeterSubline", () => {
  it("names the meter phase and the shift", () => {
    expect(
      describeMeterSubline({
        running: true,
        started: true,
        period: "day",
        tariff: "old",
      }),
    ).toBe("Meter running • Day tariff");

    expect(
      describeMeterSubline({
        running: false,
        started: false,
        period: "night",
        tariff: "old",
      }),
    ).toBe("Meter idle • Night tariff");

    expect(
      describeMeterSubline({
        running: false,
        started: true,
        period: "day",
        tariff: "new",
      }),
    ).toBe("Meter stopped • Day tariff · new rates");
  });
});

describe("segmentGhost", () => {
  it("lights every digit and leaves the separators alone", () => {
    expect(segmentGhost("3.00")).toBe("8.88");
    expect(segmentGhost("00:01:05")).toBe("88:88:88");
    expect(segmentGhost("100.25")).toBe("888.88");
  });
});

describe("header clock", () => {
  const at = new Date(2026, 7, 4, 11, 47, 0);

  it("formats the date the way the dash prints it", () => {
    expect(formatDashDate(at)).toBe("04 AUG 2026");
    expect(formatDashDate(new Date(2026, 11, 25, 0, 0, 0))).toBe("25 DEC 2026");
  });

  it("formats a 12-hour clock with a padded minute", () => {
    expect(formatDashTime(at)).toBe("11:47 AM");
    expect(formatDashTime(new Date(2026, 7, 4, 0, 5, 0))).toBe("12:05 AM");
    expect(formatDashTime(new Date(2026, 7, 4, 12, 0, 0))).toBe("12:00 PM");
    expect(formatDashTime(new Date(2026, 7, 4, 13, 9, 0))).toBe("1:09 PM");
  });

  it("says so rather than printing a broken date", () => {
    expect(formatDashDate(Number.NaN)).toBe("—");
    expect(formatDashTime(Number.NaN)).toBe("—");
  });
});
