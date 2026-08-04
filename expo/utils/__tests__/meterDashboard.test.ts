import {
  describeMeterLink,
  describeMeterSubline,
  formatDashDate,
  formatDashTime,
  segmentGhost,
  type MeterLinkInputs,
} from "@/utils/meterDashboard";

/** A parked meter with nothing connected — every case starts from here. */
const IDLE: MeterLinkInputs = {
  running: false,
  source: "none",
  obdLinked: false,
  obdConnecting: false,
  obdDemo: false,
  hasGpsFix: false,
  gpsDenied: false,
};

describe("describeMeterLink — running", () => {
  it("names the source the meter is actually billing on", () => {
    expect(
      describeMeterLink({ ...IDLE, running: true, source: "obd", obdLinked: true }),
    ).toEqual({ label: "OBD-II CONNECTED", tone: "ok", fromVehicle: true });

    expect(describeMeterLink({ ...IDLE, running: true, source: "gps" })).toEqual({
      label: "GPS CONNECTED",
      tone: "info",
      fromVehicle: false,
    });
  });

  it("reports GPS while a linked reader is not the billing source", () => {
    // The reader is up but the last sample came off GPS (stale sweep): the
    // panel must name GPS, because GPS is what is being billed.
    const status = describeMeterLink({
      ...IDLE,
      running: true,
      source: "gps",
      obdLinked: true,
    });
    expect(status.label).toBe("GPS CONNECTED");
    expect(status.fromVehicle).toBe(false);
  });

  it("never presents Demo Mode as a vehicle link", () => {
    // Demo telemetry cannot bill, so a running demo meter is on GPS — and if
    // GPS is missing too, it says so rather than claiming the simulator.
    expect(
      describeMeterLink({ ...IDLE, running: true, source: "gps", obdDemo: true }).label,
    ).toBe("GPS CONNECTED");
    expect(
      describeMeterLink({ ...IDLE, running: true, source: "none", obdDemo: true }).label,
    ).toBe("NO SIGNAL");
  });

  it("distinguishes a refused permission from a missing signal", () => {
    expect(describeMeterLink({ ...IDLE, running: true, source: "none" })).toEqual({
      label: "NO SIGNAL",
      tone: "bad",
      fromVehicle: false,
    });
    expect(
      describeMeterLink({ ...IDLE, running: true, source: "none", gpsDenied: true }).label,
    ).toBe("LOCATION OFF");
  });
});

describe("describeMeterLink — idle", () => {
  it("reports readiness in the order the driver would fix it", () => {
    expect(describeMeterLink({ ...IDLE, obdConnecting: true }).label).toBe(
      "LINKING READER",
    );
    expect(describeMeterLink({ ...IDLE, obdLinked: true }).label).toBe("OBD-II READY");
    expect(describeMeterLink({ ...IDLE, gpsDenied: true }).label).toBe("LOCATION OFF");
    expect(describeMeterLink({ ...IDLE, obdDemo: true }).label).toBe("DEMO MODE");
    expect(describeMeterLink({ ...IDLE, hasGpsFix: true }).label).toBe("GPS CONNECTED");
    expect(describeMeterLink(IDLE).label).toBe("ACQUIRING GPS");
  });

  it("flags Demo Mode ahead of a usable GPS fix", () => {
    const status = describeMeterLink({ ...IDLE, obdDemo: true, hasGpsFix: true });
    expect(status.label).toBe("DEMO MODE");
    expect(status.tone).toBe("warn");
  });

  it("keeps a refused permission louder than Demo Mode", () => {
    expect(
      describeMeterLink({ ...IDLE, obdDemo: true, gpsDenied: true }).label,
    ).toBe("LOCATION OFF");
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
