import {
  DEFAULT_CONSUMPTION_L_PER_100KM,
  DEFAULT_TANK_CAPACITY_L,
  MAX_TANK_CAPACITY_L,
  MIN_LEARN_DISTANCE_KM,
  ODOMETER_READ_ATTEMPTS,
  computeFuelRange,
  defaultFuelProfile,
  estimateConsumption,
  formatConsumption,
  formatKm,
  formatLitres,
  formatPercent,
  fuelBarFraction,
  fuelLevelColor,
  fuelRateFromMaf,
  learnConsumption,
  normalizeFuelProfile,
  profileForVin,
  readFuelSnapshot,
  readOdometerKm,
  validateFuelProfileInput,
  type FuelProfile,
  type FuelSnapshot,
} from "@/utils/canbus/fuelRange";
import { decodeReading, type VehicleReading } from "@/utils/canbus/vehicleScan";

function reading(
  pid: string,
  label: string,
  value: string,
  numeric?: number,
): VehicleReading {
  return { pid, label, value, group: "vehicle", known: true, ...(numeric !== undefined ? { numeric } : {}) };
}

const emptySnapshot: FuelSnapshot = {
  odometerKm: null,
  distanceSinceClearedKm: null,
  fuelLevelPercent: null,
  fuelRateLph: null,
  mafGramsPerSec: null,
  speedKmh: null,
  fuelType: null,
};

describe("readFuelSnapshot", () => {
  it("picks the odometer, level and rate parameters out of a scan", () => {
    const snapshot = readFuelSnapshot([
      reading("A6", "Odometer", "128456.7 km", 128456.7),
      reading("2F", "Fuel tank level", "62.0 %", 62),
      reading("5E", "Engine fuel rate", "6.40 L/h", 6.4),
      reading("10", "Mass air flow rate", "12.50 g/s", 12.5),
      reading("0D", "Vehicle speed", "80 km/h", 80),
      reading("31", "Distance since codes cleared", "412 km", 412),
      reading("51", "Fuel type", "Diesel"),
    ]);
    expect(snapshot).toEqual({
      odometerKm: 128456.7,
      distanceSinceClearedKm: 412,
      fuelLevelPercent: 62,
      fuelRateLph: 6.4,
      mafGramsPerSec: 12.5,
      speedKmh: 80,
      fuelType: "Diesel",
    });
  });

  it("reads real decoded frames end to end", () => {
    // 01A6 -> 0.1 km/bit; 012F -> 100/255 %.
    const odometer = decodeReading("A6", "41A600139B4A\r>");
    const level = decodeReading("2F", "412F80\r>");
    const snapshot = readFuelSnapshot([odometer!, level!]);
    expect(snapshot.odometerKm).toBeCloseTo(128493.8, 1);
    expect(snapshot.fuelLevelPercent).toBeCloseTo(50.2, 1);
  });

  it("ignores raw fallbacks — an undecoded frame is not a number", () => {
    const snapshot = readFuelSnapshot([
      { pid: "A6", label: "Odometer", value: "00 13", group: "vehicle", known: false },
    ]);
    expect(snapshot.odometerKm).toBeNull();
  });

  it("returns all-null for a vehicle that answered none of them", () => {
    expect(readFuelSnapshot([])).toEqual(emptySnapshot);
  });
});

describe("estimateConsumption", () => {
  const profile = defaultFuelProfile();

  it("falls back to the entered average with nothing live", () => {
    expect(estimateConsumption(emptySnapshot, profile)).toEqual({
      l100: DEFAULT_CONSUMPTION_L_PER_100KM,
      source: "configured",
    });
  });

  it("uses the live fuel rate at road speed", () => {
    const result = estimateConsumption(
      { ...emptySnapshot, fuelRateLph: 6, speedKmh: 80 },
      profile,
    );
    expect(result.source).toBe("fuel-rate");
    expect(result.l100).toBeCloseTo(7.5, 3);
  });

  it("ignores the live rate at a standstill — burning fuel, going nowhere", () => {
    expect(
      estimateConsumption({ ...emptySnapshot, fuelRateLph: 1.2, speedKmh: 0 }, profile).source,
    ).toBe("configured");
  });

  it("falls back to air flow when the vehicle has no fuel-rate PID", () => {
    const result = estimateConsumption(
      { ...emptySnapshot, mafGramsPerSec: 12, speedKmh: 90 },
      profile,
    );
    expect(result.source).toBe("maf");
    expect(result.l100).toBeCloseTo((fuelRateFromMaf(12, null) / 90) * 100, 6);
  });

  it("rejects a live figure outside the plausible band", () => {
    // 0.1 L/h at 100 km/h would be 0.1 L/100 km — a decode artefact, not a car.
    expect(
      estimateConsumption({ ...emptySnapshot, fuelRateLph: 0.1, speedKmh: 100 }, profile)
        .source,
    ).toBe("configured");
  });

  it("prefers a measured figure over any live reading", () => {
    const measured: FuelProfile = { ...profile, measuredL100: 9.4 };
    expect(
      estimateConsumption({ ...emptySnapshot, fuelRateLph: 6, speedKmh: 80 }, measured),
    ).toEqual({ l100: 9.4, source: "measured" });
  });

  it("treats diesel as denser and leaner than petrol", () => {
    expect(fuelRateFromMaf(12, "Diesel")).toBeLessThan(fuelRateFromMaf(12, "Petrol"));
  });
});

describe("computeFuelRange", () => {
  it("converts the level into litres and kilometres", () => {
    const result = computeFuelRange(
      { ...emptySnapshot, odometerKm: 90000, fuelLevelPercent: 50 },
      { ...defaultFuelProfile(), tankCapacityL: 50, consumptionL100: 10 },
    );
    expect(result.litresRemaining).toBeCloseTo(25, 6);
    expect(result.rangeKm).toBeCloseTo(250, 6);
    expect(result.odometerKm).toBe(90000);
    expect(result.estimated).toBe(true);
  });

  it("is not an estimate once the consumption has been measured", () => {
    const result = computeFuelRange(
      { ...emptySnapshot, fuelLevelPercent: 100 },
      { ...defaultFuelProfile(), tankCapacityL: 40, measuredL100: 8 },
    );
    expect(result.consumption.source).toBe("measured");
    expect(result.estimated).toBe(false);
    expect(result.rangeKm).toBeCloseTo(500, 6);
  });

  it("has no range to report when the vehicle hides its fuel gauge", () => {
    const result = computeFuelRange({ ...emptySnapshot, odometerKm: 1000 }, defaultFuelProfile());
    expect(result.litresRemaining).toBeNull();
    expect(result.rangeKm).toBeNull();
  });

  it("clamps a nonsense level rather than inventing fuel", () => {
    const result = computeFuelRange(
      { ...emptySnapshot, fuelLevelPercent: 140 },
      { ...defaultFuelProfile(), tankCapacityL: 50 },
    );
    expect(result.litresRemaining).toBeCloseTo(50, 6);
  });
});

describe("learnConsumption", () => {
  const base: FuelProfile = { ...defaultFuelProfile(), tankCapacityL: 50 };

  it("takes the first sample as a baseline and measures nothing", () => {
    const result = learnConsumption({ odometerKm: 1000, fuelLevelPercent: 90, at: 1 }, base);
    expect(result.learned).toBe(false);
    expect(result.profile.baseline).toEqual({ odometerKm: 1000, fuelLevelPercent: 90, at: 1 });
    expect(result.profile.measuredL100).toBeNull();
  });

  it("measures the burn across a long enough stretch", () => {
    const profile = { ...base, baseline: { odometerKm: 1000, fuelLevelPercent: 90, at: 1 } };
    // 200 km on 20 % of a 50 L tank = 10 L = 5.0 L/100 km.
    const result = learnConsumption({ odometerKm: 1200, fuelLevelPercent: 70, at: 2 }, profile);
    expect(result.learned).toBe(true);
    expect(result.sampleL100).toBeCloseTo(5, 6);
    expect(result.profile.measuredL100).toBeCloseTo(5, 6);
    expect(result.profile.baseline?.odometerKm).toBe(1200);
  });

  it("smooths a new measurement into the running one", () => {
    const profile = {
      ...base,
      measuredL100: 10,
      baseline: { odometerKm: 1000, fuelLevelPercent: 90, at: 1 },
    };
    const result = learnConsumption({ odometerKm: 1200, fuelLevelPercent: 70, at: 2 }, profile);
    // 0.6 * 10 + 0.4 * 5
    expect(result.profile.measuredL100).toBeCloseTo(8, 6);
  });

  it("keeps the baseline until enough distance has been covered", () => {
    const baseline = { odometerKm: 1000, fuelLevelPercent: 90, at: 1 };
    const profile = { ...base, baseline };
    const result = learnConsumption(
      { odometerKm: 1000 + MIN_LEARN_DISTANCE_KM - 1, fuelLevelPercent: 88, at: 2 },
      profile,
    );
    expect(result.learned).toBe(false);
    expect(result.profile.baseline).toEqual(baseline);
  });

  it("re-baselines after a refuel instead of measuring a negative burn", () => {
    const profile = { ...base, baseline: { odometerKm: 1000, fuelLevelPercent: 30, at: 1 } };
    const result = learnConsumption({ odometerKm: 1200, fuelLevelPercent: 95, at: 2 }, profile);
    expect(result.learned).toBe(false);
    expect(result.profile.measuredL100).toBeNull();
    expect(result.profile.baseline?.fuelLevelPercent).toBe(95);
  });

  it("re-baselines when the odometer goes backwards", () => {
    const profile = { ...base, baseline: { odometerKm: 90000, fuelLevelPercent: 80, at: 1 } };
    const result = learnConsumption({ odometerKm: 120, fuelLevelPercent: 60, at: 2 }, profile);
    expect(result.learned).toBe(false);
    expect(result.profile.baseline?.odometerKm).toBe(120);
  });

  it("discards an implausible result rather than poisoning the average", () => {
    const profile = { ...base, baseline: { odometerKm: 1000, fuelLevelPercent: 90, at: 1 } };
    // 25 km on 45 % of a 50 L tank would be 90 L/100 km.
    const result = learnConsumption({ odometerKm: 1025, fuelLevelPercent: 45, at: 2 }, profile);
    expect(result.learned).toBe(false);
    expect(result.profile.measuredL100).toBeNull();
  });
});

describe("profileForVin", () => {
  it("adopts the VIN the first time one is seen", () => {
    const stored = { ...defaultFuelProfile(), tankCapacityL: 60 };
    expect(profileForVin(stored, "WVWZZZ1JZ3W386752")).toEqual({
      ...stored,
      vin: "WVWZZZ1JZ3W386752",
    });
  });

  it("keeps the profile for the same vehicle", () => {
    const stored = { ...defaultFuelProfile("VIN1"), measuredL100: 7 };
    expect(profileForVin(stored, "VIN1")).toBe(stored);
  });

  it("starts fresh for a different vehicle", () => {
    const stored = { ...defaultFuelProfile("VIN1"), tankCapacityL: 80, measuredL100: 7 };
    expect(profileForVin(stored, "VIN2")).toEqual(defaultFuelProfile("VIN2"));
  });

  it("keeps the stored profile when the vehicle reports no VIN", () => {
    const stored = defaultFuelProfile("VIN1");
    expect(profileForVin(stored, null)).toBe(stored);
  });
});

describe("normalizeFuelProfile", () => {
  it("returns the defaults for nothing stored", () => {
    expect(normalizeFuelProfile(null)).toEqual(defaultFuelProfile());
  });

  it("clamps values an older build may have written", () => {
    const profile = normalizeFuelProfile({ tankCapacityL: 9999, consumptionL100: 0 });
    expect(profile.tankCapacityL).toBe(MAX_TANK_CAPACITY_L);
    expect(profile.consumptionL100).toBe(2);
  });

  it("drops a measured figure outside the plausible band", () => {
    expect(normalizeFuelProfile({ measuredL100: 900 }).measuredL100).toBeNull();
  });

  it("drops a malformed baseline", () => {
    expect(
      normalizeFuelProfile({ baseline: { odometerKm: NaN, fuelLevelPercent: 5, at: 1 } })
        .baseline,
    ).toBeNull();
  });
});

describe("validateFuelProfileInput", () => {
  it("accepts a typed pair", () => {
    expect(validateFuelProfileInput(" 48 ", "7.6")).toEqual({
      ok: true,
      value: { tankCapacityL: 48, consumptionL100: 7.6 },
    });
  });

  it("rejects an impossible tank", () => {
    expect(validateFuelProfileInput("0", "8").ok).toBe(false);
    expect(validateFuelProfileInput("abc", "8").ok).toBe(false);
  });

  it("rejects an impossible consumption", () => {
    expect(validateFuelProfileInput("45", "99").ok).toBe(false);
  });
});

describe("display helpers", () => {
  it("renders whole, separated kilometres", () => {
    expect(formatKm(128456.7)).toBe("128,457");
    expect(formatKm(null)).toBe("—");
  });

  it("renders litres, percent and consumption to one place", () => {
    expect(formatLitres(27.94)).toBe("27.9");
    expect(formatPercent(61.6)).toBe("62");
    expect(formatConsumption(8)).toBe("8.0");
    expect(formatLitres(null)).toBe("—");
  });

  it("maps the gauge onto a bar and a colour", () => {
    expect(fuelBarFraction(50)).toBeCloseTo(0.5, 6);
    expect(fuelBarFraction(140)).toBe(1);
    expect(fuelBarFraction(null)).toBe(0);
    expect(fuelLevelColor(60)).toBe("#22C55E");
    expect(fuelLevelColor(20)).toBe("#F59E0B");
    expect(fuelLevelColor(5)).toBe("#EF4444");
  });

  it("defaults a fresh profile to a plausible car", () => {
    expect(defaultFuelProfile().tankCapacityL).toBe(DEFAULT_TANK_CAPACITY_L);
    expect(defaultFuelProfile().consumptionL100).toBe(DEFAULT_CONSUMPTION_L_PER_100KM);
  });
});

describe("readOdometerKm", () => {
  const FRAME = "41 A6 00 01 E2 40"; // 123456 → 12345.6 km

  it("decodes the odometer off the first good answer", async () => {
    const send = jest.fn().mockResolvedValue(FRAME);
    await expect(readOdometerKm(send, { delayMs: 0 })).resolves.toBeCloseTo(12345.6, 3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("01A6");
  });

  it("retries an adapter that was busy rather than calling the reading absent", async () => {
    // One unanswered command is not proof that a car has no odometer: the
    // adapter serves the 1 Hz sweep at the same time and clones answer BUSY.
    const send = jest
      .fn()
      .mockResolvedValueOnce("BUSY")
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce(FRAME);
    await expect(readOdometerKm(send, { delayMs: 0 })).resolves.toBeCloseTo(12345.6, 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up honestly on a car that does not publish PID A6", async () => {
    const send = jest.fn().mockResolvedValue("NO DATA");
    await expect(readOdometerKm(send, { delayMs: 0 })).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(ODOMETER_READ_ATTEMPTS);
  });

  it("never reports a reading from a link that only ever threw", async () => {
    const send = jest.fn().mockRejectedValue(new Error("no session"));
    await expect(readOdometerKm(send, { attempts: 2, delayMs: 0 })).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
