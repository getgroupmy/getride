import {
  adjustExtra,
  applyMeterSample,
  computeMeterFare,
  createMeterState,
  describeMeterSource,
  EXTRA_STEP,
  formatMeterClock,
  formatMeterDistance,
  formatMeterDuration,
  formatMeterKm,
  haversineMeters,
  isNightPeriod,
  isObdFresh,
  MAX_EXTRA,
  meterGrandTotal,
  NIGHT_MULTIPLIER,
  pauseMeter,
  periodMultiplier,
  startMeter,
  type MeterSample,
  type MeterState,
} from "@/utils/taxiMeter";

const T0 = 1_700_000_000_000;

/** Feed `count` one-second samples, each built from the sample index. */
function run(
  state: MeterState,
  count: number,
  build: (i: number, at: number) => Omit<MeterSample, "at">,
  stepMs = 1000,
): MeterState {
  let s = state;
  for (let i = 1; i <= count; i++) {
    const at = T0 + i * stepMs;
    s = applyMeterSample(s, { at, ...build(i, at) });
  }
  return s;
}

/** A fresh OBD reading at `at`, i.e. one sampled this very tick. */
const obd = (speedKmh: number, at: number) => ({
  obdSpeedKmh: speedKmh,
  obdUpdatedAt: at,
});

describe("meter accrual", () => {
  it("starts empty and ignores samples until started", () => {
    const state = createMeterState();
    expect(state.distanceM).toBe(0);
    expect(state.running).toBe(false);

    const after = applyMeterSample(state, {
      at: T0 + 1000,
      ...obd(60, T0 + 1000),
    });
    expect(after).toBe(state);
  });

  it("integrates OBD speed into distance", () => {
    const state = run(startMeter(createMeterState(), T0), 60, (_i, at) => obd(60, at));
    // 60 km/h for 60 s = 1 km.
    expect(state.distanceM).toBeCloseTo(1000, 6);
    expect(state.elapsedMs).toBe(60_000);
    expect(state.source).toBe("obd");
    expect(state.obdSamples).toBe(60);
    expect(state.gpsSamples).toBe(0);
  });

  it("clamps a long gap so a backgrounded app is not billed as motion", () => {
    let state = startMeter(createMeterState(), T0);
    // 60 s of wall clock between samples: only MAX_SAMPLE_GAP_MS (5 s) counts.
    state = applyMeterSample(state, {
      at: T0 + 60_000,
      ...obd(72, T0 + 60_000),
    });
    expect(state.elapsedMs).toBe(5000);
    expect(state.distanceM).toBeCloseTo((72 / 3.6) * 5, 6);
  });

  it("never accrues from an out-of-order sample", () => {
    let state = startMeter(createMeterState(), T0 + 10_000);
    state = applyMeterSample(state, { at: T0, ...obd(60, T0) });
    expect(state.elapsedMs).toBe(0);
    expect(state.distanceM).toBe(0);
  });

  it("does not accrue while paused, and resumes without billing the pause", () => {
    let state = run(startMeter(createMeterState(), T0), 10, (_i, at) => obd(36, at));
    const parked = pauseMeter(state);
    expect(parked.running).toBe(false);

    // Samples during the pause are dropped entirely.
    state = applyMeterSample(parked, {
      at: T0 + 60_000,
      ...obd(80, T0 + 60_000),
    });
    expect(state.elapsedMs).toBe(parked.elapsedMs);

    // Resuming much later restarts the sample clock from the resume instant.
    state = startMeter(parked, T0 + 600_000);
    state = applyMeterSample(state, {
      at: T0 + 601_000,
      ...obd(36, T0 + 601_000),
    });
    expect(state.elapsedMs).toBe(11_000);
  });

  it("counts time at or below the waiting threshold as waiting", () => {
    const state = run(startMeter(createMeterState(), T0), 10, (i, at) =>
      obd(i <= 4 ? 0 : 50, at),
    );
    expect(state.waitingMs).toBe(4000);
  });
});

describe("OBD freshness", () => {
  it("accepts a reading from this sweep and rejects a stale one", () => {
    expect(isObdFresh({ at: T0, obdSpeedKmh: 40, obdUpdatedAt: T0 - 2000 })).toBe(true);
    expect(isObdFresh({ at: T0, obdSpeedKmh: 40, obdUpdatedAt: T0 - 9000 })).toBe(false);
    expect(isObdFresh({ at: T0, obdSpeedKmh: 40 })).toBe(false);
    expect(isObdFresh({ at: T0, obdSpeedKmh: null, obdUpdatedAt: T0 })).toBe(false);
  });
});

describe("GPS fallback", () => {
  it("falls back to GPS when the OBD reading goes stale", () => {
    const state = run(startMeter(createMeterState(), T0), 10, (i, at) =>
      i <= 5
        ? obd(36, at)
        : // The adapter stopped answering: the last sweep is minutes old.
          { obdSpeedKmh: 36, obdUpdatedAt: T0 - 60_000, gpsSpeedKmh: 72 },
    );
    expect(state.source).toBe("gps");
    expect(state.obdSamples).toBe(5);
    expect(state.gpsSamples).toBe(5);
    // 5 s at 36 km/h (OBD) + 5 s at 72 km/h (GPS).
    expect(state.distanceM).toBeCloseTo((36 / 3.6) * 5 + (72 / 3.6) * 5, 6);
  });

  it("uses the displacement between trustworthy fixes", () => {
    let state = startMeter(createMeterState(), T0);
    // ~0.0001 deg of latitude ≈ 11.1 m.
    state = applyMeterSample(state, {
      at: T0 + 1000,
      gpsPoint: { latitude: 3.139, longitude: 101.6869, accuracyM: 5 },
    });
    state = applyMeterSample(state, {
      at: T0 + 2000,
      gpsPoint: { latitude: 3.1391, longitude: 101.6869, accuracyM: 5 },
    });
    const expected = haversineMeters(
      { latitude: 3.139, longitude: 101.6869 },
      { latitude: 3.1391, longitude: 101.6869 },
    );
    expect(state.source).toBe("gps");
    expect(state.distanceM).toBeCloseTo(expected, 6);
  });

  it("treats sub-3m wander as standing still, not travel", () => {
    let state = startMeter(createMeterState(), T0);
    state = applyMeterSample(state, {
      at: T0 + 1000,
      gpsPoint: { latitude: 3.139, longitude: 101.6869, accuracyM: 5 },
    });
    state = applyMeterSample(state, {
      at: T0 + 2000,
      // ~1.1 m north — below the jitter floor.
      gpsPoint: { latitude: 3.13901, longitude: 101.6869, accuracyM: 5 },
    });
    expect(state.distanceM).toBe(0);
    expect(state.speedKmh).toBe(0);
    expect(state.waitingMs).toBe(2000);
  });

  it("rejects an implausible jump and bills the reported speed instead", () => {
    let state = startMeter(createMeterState(), T0);
    state = applyMeterSample(state, {
      at: T0 + 1000,
      gpsSpeedKmh: 40,
      gpsPoint: { latitude: 3.139, longitude: 101.6869, accuracyM: 5 },
    });
    state = applyMeterSample(state, {
      at: T0 + 2000,
      gpsSpeedKmh: 40,
      // 0.01 deg ≈ 1.1 km in one second — a fix jump, not a trip.
      gpsPoint: { latitude: 3.149, longitude: 101.6869, accuracyM: 5 },
    });
    // Both seconds billed at the reported 40 km/h; the jump contributes nothing
    // beyond its own second.
    expect(state.distanceM).toBeCloseTo(2 * (40 / 3.6), 6);
  });

  it("ignores fixes whose accuracy is worse than the trust threshold", () => {
    let state = startMeter(createMeterState(), T0);
    state = applyMeterSample(state, {
      at: T0 + 1000,
      gpsPoint: { latitude: 3.139, longitude: 101.6869, accuracyM: 500 },
    });
    expect(state.lastPoint).toBeNull();
    state = applyMeterSample(state, {
      at: T0 + 2000,
      gpsPoint: { latitude: 3.1391, longitude: 101.6869, accuracyM: 500 },
    });
    expect(state.distanceM).toBe(0);
    expect(state.source).toBe("none");
  });

  it("still accrues time when neither source reports anything", () => {
    const state = run(startMeter(createMeterState(), T0), 5, () => ({}));
    expect(state.elapsedMs).toBe(5000);
    expect(state.distanceM).toBe(0);
    expect(state.source).toBe("none");
    expect(state.waitingMs).toBe(5000);
  });
});

describe("chargeable time after the flag fall", () => {
  it("stays at zero for the whole first kilometre", () => {
    const state = run(startMeter(createMeterState(), T0), 60, (_i, at) => obd(60, at));
    expect(state.distanceM).toBeCloseTo(1000, 6);
    expect(state.chargeableMs).toBe(0);
  });

  it("only counts the part of a sample that falls past 1 km", () => {
    // 120 km/h = 33.33 m/s. After 30 s: 1000 m exactly. Sample 31 crosses.
    const state = run(startMeter(createMeterState(), T0), 31, (_i, at) => obd(120, at));
    expect(state.distanceM).toBeCloseTo(1033.33, 1);
    // Only the fraction of that second spent beyond 1 km is chargeable.
    expect(state.chargeableMs).toBeCloseTo(1000, 0);
  });

  it("counts full samples once past the flag-fall distance", () => {
    const state = run(startMeter(createMeterState(), T0), 90, (_i, at) => obd(60, at));
    expect(state.chargeableMs).toBeCloseTo(30_000, 0);
  });
});

describe("computeMeterFare — old tariff", () => {
  const at = (distanceM: number, chargeableMs = 0, elapsedMs = 0): MeterState => ({
    ...createMeterState(),
    distanceM,
    chargeableMs,
    elapsedMs,
  });

  it("charges only the flag fall for the first kilometre", () => {
    expect(computeMeterFare(at(0)).total).toBe(4);
    expect(computeMeterFare(at(999)).total).toBe(4);
    expect(computeMeterFare(at(1000, 0, 600_000)).total).toBe(4);
  });

  it("charges RM0.35 per started 200 m beyond the first km", () => {
    expect(computeMeterFare(at(1200)).total).toBe(4.35);
    expect(computeMeterFare(at(1250)).total).toBe(4.7);
    expect(computeMeterFare(at(2000)).total).toBe(5.75);
  });

  it("bills the time increments when they exceed the distance increments", () => {
    // 1.2 km (1 distance unit) but 5 minutes crawling past the first km
    // (300 s / 36 s = 9 time units) — the meter bills the larger.
    const fare = computeMeterFare(at(1200, 300_000));
    expect(fare.distanceUnits).toBe(1);
    expect(fare.timeUnits).toBe(9);
    expect(fare.units).toBe(9);
    expect(fare.total).toBe(4 + 9 * 0.35);
  });

  it("applies the multiplier to the whole fare", () => {
    expect(computeMeterFare(at(2000), { multiplier: 2 }).total).toBe(11.5);
    expect(computeMeterFare(at(500), { multiplier: 2 }).total).toBe(8);
  });

  it("clamps a negative distance to the flag fall", () => {
    expect(computeMeterFare(at(-500)).total).toBe(4);
  });
});

describe("computeMeterFare — new tariff", () => {
  it("charges base + per-km + per-minute", () => {
    const state: MeterState = {
      ...createMeterState(),
      distanceM: 5000,
      elapsedMs: 10 * 60_000,
    };
    const fare = computeMeterFare(state, { tariff: "new" });
    // 4 + 5*1.00 + 10*0.30
    expect(fare.total).toBe(12);
    expect(fare.variable).toBe(8);
  });

  it("charges just the base fare at zero distance and time", () => {
    expect(computeMeterFare(createMeterState(), { tariff: "new" }).total).toBe(4);
  });

  it("applies the multiplier", () => {
    const state: MeterState = {
      ...createMeterState(),
      distanceM: 5000,
      elapsedMs: 10 * 60_000,
    };
    expect(computeMeterFare(state, { tariff: "new", multiplier: 2 }).total).toBe(24);
  });
});

describe("formatting", () => {
  it("formats durations under and over an hour", () => {
    expect(formatMeterDuration(0)).toBe("00:00");
    expect(formatMeterDuration(65_000)).toBe("01:05");
    expect(formatMeterDuration(3_905_000)).toBe("1:05:05");
    expect(formatMeterDuration(-5)).toBe("00:00");
  });

  it("formats metres below a km and kilometres above", () => {
    expect(formatMeterDistance(0)).toBe("0 m");
    expect(formatMeterDistance(740.4)).toBe("740 m");
    expect(formatMeterDistance(3421)).toBe("3.42 km");
  });

  it("labels the active source", () => {
    expect(describeMeterSource("obd")).toBe("OBD-II");
    expect(describeMeterSource("gps")).toBe("GPS");
    expect(describeMeterSource("none")).toBe("No signal");
  });

  it("formats the segment clock at a fixed width", () => {
    expect(formatMeterClock(0)).toBe("00:00:00");
    expect(formatMeterClock(24_000)).toBe("00:00:24");
    expect(formatMeterClock(65_000)).toBe("00:01:05");
    expect(formatMeterClock(3_905_000)).toBe("01:05:05");
    expect(formatMeterClock(-5)).toBe("00:00:00");
    // Past 99 hours the field grows rather than wrapping.
    expect(formatMeterClock(100 * 3_600_000)).toBe("100:00:00");
  });

  it("formats the segment distance as unit-free kilometres", () => {
    expect(formatMeterKm(0)).toBe("0.00");
    expect(formatMeterKm(740.4)).toBe("0.74");
    expect(formatMeterKm(3421)).toBe("3.42");
    expect(formatMeterKm(-500)).toBe("0.00");
  });
});

describe("night shift", () => {
  const atHour = (hour: number) => new Date(2026, 7, 4, hour, 30, 0);

  it("runs from midnight to 06:00, local time", () => {
    expect(isNightPeriod(atHour(0))).toBe(true);
    expect(isNightPeriod(atHour(5))).toBe(true);
    expect(isNightPeriod(atHour(6))).toBe(false);
    expect(isNightPeriod(atHour(11))).toBe(false);
    expect(isNightPeriod(atHour(23))).toBe(false);
  });

  it("accepts an epoch as readily as a Date", () => {
    expect(isNightPeriod(atHour(3).getTime())).toBe(true);
    expect(isNightPeriod(atHour(15).getTime())).toBe(false);
  });

  it("surcharges the whole fare on the night shift", () => {
    expect(periodMultiplier("day")).toBe(1);
    expect(periodMultiplier("night")).toBe(NIGHT_MULTIPLIER);

    const state: MeterState = { ...createMeterState(), distanceM: 2000 };
    const day = computeMeterFare(state, { multiplier: periodMultiplier("day") });
    const night = computeMeterFare(state, { multiplier: periodMultiplier("night") });
    expect(day.total).toBe(5.75);
    expect(night.total).toBe(8.63);
  });
});

describe("extras", () => {
  it("moves by one step per press", () => {
    expect(adjustExtra(0, 1)).toBe(EXTRA_STEP);
    expect(adjustExtra(EXTRA_STEP, 1)).toBe(EXTRA_STEP * 2);
    expect(adjustExtra(2, -1)).toBe(2 - EXTRA_STEP);
    expect(adjustExtra(2, 4)).toBe(4);
  });

  it("never goes negative and never overflows the display", () => {
    expect(adjustExtra(0, -1)).toBe(0);
    expect(adjustExtra(0.5, -5)).toBe(0);
    expect(adjustExtra(MAX_EXTRA, 1)).toBe(MAX_EXTRA);
    expect(adjustExtra(MAX_EXTRA, 40)).toBe(MAX_EXTRA);
  });

  it("survives a non-finite starting point", () => {
    expect(adjustExtra(Number.NaN, 1)).toBe(EXTRA_STEP);
    expect(adjustExtra(0, Number.NaN)).toBe(0);
  });

  it("adds extras onto the metered fare in sen", () => {
    expect(meterGrandTotal(8.63, 2.5)).toBe(11.13);
    expect(meterGrandTotal(4, 0)).toBe(4);
    // Negative inputs are clamped rather than subtracted from the passenger.
    expect(meterGrandTotal(-3, -2)).toBe(0);
  });
});
