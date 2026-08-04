import {
  allowedMeterSources,
  createMeterProfileDraft,
  DEFAULT_METER_PROFILE,
  describeMeterRates,
  hasMeterSurcharges,
  meterExtraSurcharge,
  meterOdometerGate,
  meterProfileScopeLabel,
  meterProfileToRow,
  normalizeMeterProfile,
  resolveMeterProfile,
  validateMeterProfile,
  type MeterProfile,
  type MeterSettingsRow,
} from "@/utils/meterSettings";
import { computeMeterFare, createMeterState, type MeterState } from "@/utils/taxiMeter";

/** A complete row as the database would hand it back. */
function row(overrides: Partial<MeterSettingsRow> = {}): MeterSettingsRow {
  return {
    id: "row-1",
    level: "master",
    country: null,
    state: null,
    city: null,
    suburb: null,
    label: "Global",
    source_mode: "gps+obd",
    allow_start_without_odometer: true,
    require_odometer: false,
    show_meter: true,
    show_trips: true,
    show_printer: true,
    show_obd: true,
    show_settings: true,
    tap_meter: true,
    tap_trips: true,
    tap_printer: true,
    tap_obd: true,
    tap_settings: true,
    currency: "MYR",
    flag_fare: "4.00",
    flag_distance_m: 1000,
    minimum_fare: "0.00",
    distance_mode: "block",
    distance_block_m: 200,
    distance_block_charge: "0.35",
    per_km_charge: "1.00",
    time_mode: "block",
    time_block_s: 36,
    time_block_charge: "0.35",
    per_minute_charge: "0.30",
    per_second_charge: "0.0000",
    charge_mode: "max",
    charge_from: "flag",
    night_multiplier: "1.500",
    night_start_hour: 0,
    night_end_hour: 6,
    extra_luggage_charge: "0.00",
    free_luggage: 0,
    extra_passenger_charge: "0.00",
    free_passengers: 1,
    extra_step: "0.50",
    max_extra: "99.50",
    active: true,
    updated_at: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function profile(overrides: Partial<MeterProfile> = {}): MeterProfile {
  return {
    ...DEFAULT_METER_PROFILE,
    rates: { ...DEFAULT_METER_PROFILE.rates },
    panels: {
      meter: { show: true, tap: true },
      trips: { show: true, tap: true },
      printer: { show: true, tap: true },
      obd: { show: true, tap: true },
      settings: { show: true, tap: true },
    },
    ...overrides,
  };
}

describe("normalizeMeterProfile", () => {
  it("reads a full row, coercing the numeric strings postgres returns", () => {
    const p = normalizeMeterProfile(row());
    expect(p).not.toBeNull();
    expect(p!.rates.flagFare).toBe(4);
    expect(p!.rates.distanceBlockCharge).toBe(0.35);
    expect(p!.rates.timeBlockS).toBe(36);
    expect(p!.nightMultiplier).toBe(1.5);
    expect(p!.currency).toBe("MYR");
    expect(p!.panels.printer).toEqual({ show: true, tap: true });
  });

  it("rejects anything without an id", () => {
    expect(normalizeMeterProfile(null)).toBeNull();
    expect(normalizeMeterProfile({})).toBeNull();
    expect(normalizeMeterProfile(row({ id: "  " }))).toBeNull();
  });

  it("falls back to the built-in default for an unusable value", () => {
    const p = normalizeMeterProfile(
      row({
        flag_fare: "not a number",
        distance_block_m: 0,
        time_mode: "per_fortnight",
        source_mode: "satellite",
        night_multiplier: "0.2",
      }),
    )!;
    expect(p.rates.flagFare).toBe(DEFAULT_METER_PROFILE.rates.flagFare);
    expect(p.rates.distanceBlockM).toBe(DEFAULT_METER_PROFILE.rates.distanceBlockM);
    expect(p.rates.timeMode).toBe(DEFAULT_METER_PROFILE.rates.timeMode);
    expect(p.sourceMode).toBe("gps+obd");
    // A night multiplier below 1 would *discount* the night shift.
    expect(p.nightMultiplier).toBe(DEFAULT_METER_PROFILE.nightMultiplier);
  });

  it("clears place names the level does not own", () => {
    const p = normalizeMeterProfile(
      row({ level: "master", country: "Malaysia", city: "Ipoh" }),
    )!;
    expect(p.country).toBeNull();
    expect(p.city).toBeNull();

    const city = normalizeMeterProfile(
      row({ level: "city", country: "Malaysia", state: "Selangor", city: "Klang", suburb: "X" }),
    )!;
    expect(city.city).toBe("Klang");
    expect(city.suburb).toBeNull();
  });

  it("round-trips through the row shape", () => {
    const p = normalizeMeterProfile(row())!;
    const back = normalizeMeterProfile({ ...meterProfileToRow(p), id: p.id, updated_at: null })!;
    expect(back.rates).toEqual(p.rates);
    expect(back.panels).toEqual(p.panels);
    expect(back.sourceMode).toBe(p.sourceMode);
  });
});

describe("resolveMeterProfile", () => {
  const master = profile({ id: "m", level: "master" });
  const country = profile({ id: "c", level: "country", country: "Malaysia" });
  const state = profile({ id: "s", level: "state", country: "Malaysia", state: "Selangor" });
  const city = profile({
    id: "ci",
    level: "city",
    country: "Malaysia",
    state: "Selangor",
    city: "Petaling Jaya",
  });
  const suburb = profile({
    id: "su",
    level: "suburb",
    country: "Malaysia",
    state: "Selangor",
    city: "Petaling Jaya",
    suburb: "Bangsar",
  });
  const all = [master, country, state, city, suburb];

  it("takes the narrowest matching scope", () => {
    expect(
      resolveMeterProfile({
        profiles: all,
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
        suburb: "Bangsar",
      }).profile.id,
    ).toBe("su");
    expect(
      resolveMeterProfile({
        profiles: all,
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
      }).profile.id,
    ).toBe("ci");
    expect(
      resolveMeterProfile({ profiles: all, country: "Malaysia", state: "Selangor" }).profile.id,
    ).toBe("s");
    expect(resolveMeterProfile({ profiles: all, country: "Malaysia" }).profile.id).toBe("c");
    expect(resolveMeterProfile({ profiles: all }).profile.id).toBe("m");
  });

  it("matches place names case- and space-insensitively", () => {
    const hit = resolveMeterProfile({
      profiles: all,
      country: " malaysia ",
      state: "SELANGOR",
    });
    expect(hit.profile.id).toBe("s");
    expect(hit.level).toBe("state");
  });

  it("skips an inactive card and falls through to the next scope", () => {
    const off = [{ ...suburb, active: false }, city, master];
    expect(
      resolveMeterProfile({
        profiles: off,
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
        suburb: "Bangsar",
      }).profile.id,
    ).toBe("ci");
  });

  it("does not match a card whose parent scope contradicts the hire", () => {
    const elsewhere = profile({
      id: "other",
      level: "city",
      country: "Singapore",
      state: "Central",
      city: "Petaling Jaya",
    });
    const hit = resolveMeterProfile({
      profiles: [elsewhere, master],
      country: "Malaysia",
      state: "Selangor",
      city: "Petaling Jaya",
    });
    expect(hit.profile.id).toBe("m");
  });

  it("falls back to the built-in tariff when nothing is configured", () => {
    const hit = resolveMeterProfile({ profiles: [] });
    expect(hit.level).toBe("default");
    expect(hit.profile).toBe(DEFAULT_METER_PROFILE);
    expect(hit.scope).toBe("Built-in tariff");
  });
});

describe("the resolved card drives the fare", () => {
  const at = (distanceM: number, chargeableMs = 0, elapsedMs = 0): MeterState => ({
    ...createMeterState(),
    distanceM,
    chargeableMs,
    elapsedMs,
  });

  it("prices the default card exactly like the built-in old tariff", () => {
    const rates = DEFAULT_METER_PROFILE.rates;
    expect(computeMeterFare(at(1200), { rates }).total).toBe(4.35);
    expect(computeMeterFare(at(2000), { rates }).total).toBe(5.75);
    expect(computeMeterFare(at(1200, 300_000), { rates }).total).toBe(4 + 9 * 0.35);
  });

  it("bills a per-km + per-minute card from the start of the hire", () => {
    const p = profile({
      rates: {
        ...DEFAULT_METER_PROFILE.rates,
        flagFare: 3,
        distanceMode: "per_km",
        perKmCharge: 2,
        timeMode: "per_minute",
        perMinuteCharge: 0.5,
        chargeMode: "sum",
        chargeFrom: "start",
      },
    });
    // 3 flag + 4 km × 2 + 10 min × 0.50
    const fare = computeMeterFare(at(4000, 0, 600_000), { rates: p.rates });
    expect(fare.total).toBe(3 + 8 + 5);
  });

  it("bills a per-second card", () => {
    const p = profile({
      rates: {
        ...DEFAULT_METER_PROFILE.rates,
        distanceMode: "off",
        timeMode: "per_second",
        perSecondCharge: 0.01,
        chargeFrom: "start",
        chargeMode: "sum",
      },
    });
    // 4 flag + 120 s × 0.01
    expect(computeMeterFare(at(0, 0, 120_000), { rates: p.rates }).total).toBe(5.2);
  });

  it("honours a second block of an unusual length", () => {
    const p = profile({
      rates: { ...DEFAULT_METER_PROFILE.rates, timeBlockS: 45, timeBlockCharge: 1, distanceMode: "off" },
    });
    // 100 s past the flag distance is 3 started 45 s blocks.
    expect(computeMeterFare(at(1500, 100_000), { rates: p.rates }).total).toBe(4 + 3);
  });

  it("lifts a cheap hire to the configured minimum fare", () => {
    const p = profile({
      rates: { ...DEFAULT_METER_PROFILE.rates, flagFare: 2, minimumFare: 8 },
    });
    expect(computeMeterFare(at(1200), { rates: p.rates }).total).toBe(8);
    // …and stops applying once the metered fare passes it.
    expect(computeMeterFare(at(6000), { rates: p.rates }).total).toBe(2 + 25 * 0.35);
  });
});

describe("allowedMeterSources", () => {
  it("takes the other sensor away in a single-source mode", () => {
    expect(allowedMeterSources("gps+obd")).toEqual({ obd: true, gps: true });
    expect(allowedMeterSources("gps")).toEqual({ obd: false, gps: true });
    expect(allowedMeterSources("obd")).toEqual({ obd: true, gps: false });
  });
});

describe("meterOdometerGate", () => {
  it("lets a hire open without an odometer by default", () => {
    expect(meterOdometerGate(profile(), null).canStart).toBe(true);
  });

  it("blocks a hire with no odometer when the card requires one", () => {
    const strict = profile({ allowStartWithoutOdometer: false });
    expect(meterOdometerGate(strict, null).canStart).toBe(false);
    expect(meterOdometerGate(strict, null).reason).toContain("odometer");
    expect(meterOdometerGate(strict, Number.NaN).canStart).toBe(false);
    expect(meterOdometerGate(strict, 128_450.6).canStart).toBe(true);
    // A car that has genuinely never moved still has a reading.
    expect(meterOdometerGate(strict, 0).canStart).toBe(true);
  });
});

describe("meterExtraSurcharge", () => {
  const p = profile({
    extraLuggageCharge: 1.5,
    freeLuggage: 2,
    extraPassengerCharge: 2,
    freePassengers: 1,
  });

  it("charges only past the free allowance", () => {
    expect(meterExtraSurcharge(p, { luggage: 2, passengers: 1 })).toBe(0);
    expect(meterExtraSurcharge(p, { luggage: 4, passengers: 1 })).toBe(3);
    expect(meterExtraSurcharge(p, { luggage: 0, passengers: 3 })).toBe(4);
    expect(meterExtraSurcharge(p, { luggage: 3, passengers: 2 })).toBe(3.5);
  });

  it("never goes negative and ignores nonsense counts", () => {
    expect(meterExtraSurcharge(p, { luggage: -5, passengers: -5 })).toBe(0);
    expect(meterExtraSurcharge(p, { luggage: Number.NaN, passengers: 2.7 })).toBe(2);
  });

  it("knows whether a card charges extras at all", () => {
    expect(hasMeterSurcharges(profile())).toBe(false);
    expect(hasMeterSurcharges(p)).toBe(true);
  });
});

describe("describeMeterRates", () => {
  it("names only the charges the card actually bills", () => {
    const lines = describeMeterRates(profile());
    expect(lines[0]).toBe("MYR 4.00 flag fare, first 1 km");
    expect(lines).toContain("MYR 0.35 per started 200 m");
    expect(lines).toContain("MYR 0.35 per started 36 s");
    expect(lines).toContain("Distance or time — whichever is greater");
    expect(lines.some((l) => l.includes("per bag"))).toBe(false);
  });

  it("says nothing about time on a distance-only card", () => {
    const lines = describeMeterRates(
      profile({ rates: { ...DEFAULT_METER_PROFILE.rates, timeMode: "off" } }),
    );
    expect(lines.some((l) => l.includes("per started 36 s"))).toBe(false);
    expect(lines.some((l) => l.includes("whichever is greater"))).toBe(false);
  });

  it("spells out the extras when the card charges them", () => {
    const lines = describeMeterRates(
      profile({ extraLuggageCharge: 2, freeLuggage: 1, extraPassengerCharge: 3, freePassengers: 2 }),
    );
    expect(lines).toContain("MYR 2.00 per bag after 1 free");
    expect(lines).toContain("MYR 3.00 per passenger after 2");
  });
});

describe("validateMeterProfile", () => {
  it("accepts the default card", () => {
    expect(validateMeterProfile(profile())).toBeNull();
  });

  it("requires the place names its level needs", () => {
    expect(validateMeterProfile(createMeterProfileDraft("country"))).toBe("Select a country.");
    expect(
      validateMeterProfile({ ...createMeterProfileDraft("state"), country: "Malaysia" }),
    ).toBe("Select a state.");
    expect(
      validateMeterProfile({
        ...createMeterProfileDraft("suburb"),
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
      }),
    ).toBe("Enter a suburb.");
  });

  it("refuses a card that would meter every hire at zero", () => {
    const free = profile({
      rates: {
        ...DEFAULT_METER_PROFILE.rates,
        flagFare: 0,
        minimumFare: 0,
        distanceBlockCharge: 0,
        timeBlockCharge: 0,
      },
    });
    expect(validateMeterProfile(free)).toContain("charges nothing");
  });

  it("refuses to hide or lock the meter itself", () => {
    const hidden = profile();
    hidden.panels.meter.show = false;
    expect(validateMeterProfile(hidden)).toContain("cannot be hidden");

    const locked = profile();
    locked.panels.meter.tap = false;
    expect(validateMeterProfile(locked)).toContain("cannot be locked");
  });
});

describe("meterProfileScopeLabel", () => {
  it("prints the scope the way the admin list reads it", () => {
    expect(meterProfileScopeLabel(profile())).toBe("Global (all regions)");
    expect(
      meterProfileScopeLabel(profile({ level: "country", country: "Malaysia" })),
    ).toBe("Malaysia");
    expect(
      meterProfileScopeLabel(
        profile({ level: "suburb", suburb: "Bangsar", city: "Kuala Lumpur" }),
      ),
    ).toBe("Bangsar, Kuala Lumpur");
  });
});
