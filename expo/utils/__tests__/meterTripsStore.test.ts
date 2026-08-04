import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  buildMeterTrip,
  clearMeterTrips,
  loadMeterTrips,
  MAX_METER_TRIPS,
  METER_TRIPS_KEY,
  recordMeterTrip,
  saveMeterTrip,
  summarizeMeterTrips,
  type MeterTrip,
} from "@/utils/meterTripsStore";
import {
  computeMeterFare,
  createMeterState,
  periodMultiplier,
  type MeterState,
} from "@/utils/taxiMeter";

const T0 = 1_700_000_000_000;

/** A finished 2 km hire that took ten minutes, half of it crawling. */
function finishedState(overrides: Partial<MeterState> = {}): MeterState {
  return {
    ...createMeterState(),
    startedAt: T0,
    distanceM: 2000,
    elapsedMs: 600_000,
    waitingMs: 300_000,
    obdSamples: 480,
    gpsSamples: 120,
    ...overrides,
  };
}

function tripFrom(state: MeterState, extra = 0, period: "day" | "night" = "day") {
  const fare = computeMeterFare(state, { multiplier: periodMultiplier(period) });
  return buildMeterTrip(state, fare, {
    id: "trip-1",
    endedAt: T0 + 600_000,
    tariff: "old",
    period,
    extra,
    plate: " VEP 1234 ",
    driver: "KABEER SINGH",
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("buildMeterTrip", () => {
  it("freezes the totals and the fare the state produced", () => {
    const trip = tripFrom(finishedState());
    expect(trip).toMatchObject({
      id: "trip-1",
      startedAt: T0,
      endedAt: T0 + 600_000,
      distanceM: 2000,
      elapsedMs: 600_000,
      waitingMs: 300_000,
      tariff: "old",
      period: "day",
      fare: 5.75,
      extra: 0,
      total: 5.75,
      obdSamples: 480,
      gpsSamples: 120,
    });
  });

  it("adds hand-entered extras onto the metered fare", () => {
    expect(tripFrom(finishedState(), 2.5).total).toBe(8.25);
  });

  it("carries the night surcharge into the stored fare", () => {
    const trip = tripFrom(finishedState(), 0, "night");
    expect(trip.period).toBe("night");
    expect(trip.fare).toBe(8.63);
  });

  it("trims the plate and driver, and drops blank ones", () => {
    const trip = tripFrom(finishedState());
    expect(trip.plate).toBe("VEP 1234");

    const anonymous = buildMeterTrip(
      finishedState(),
      computeMeterFare(finishedState()),
      { id: "t", endedAt: T0, tariff: "old", period: "day", extra: 0, plate: "  " },
    );
    expect(anonymous.plate).toBeNull();
    expect(anonymous.driver).toBeNull();
  });

  it("falls back to the end time when the meter never recorded a start", () => {
    const trip = tripFrom(finishedState({ startedAt: null }));
    expect(trip.startedAt).toBe(T0 + 600_000);
  });
});

describe("summarizeMeterTrips", () => {
  it("adds up the hires, the distance and what was charged", () => {
    const trips = [
      { ...tripFrom(finishedState(), 2.5), id: "a" },
      { ...tripFrom(finishedState({ distanceM: 5000 })), id: "b" },
    ];
    const summary = summarizeMeterTrips(trips);
    expect(summary.count).toBe(2);
    expect(summary.distanceM).toBe(7000);
    expect(summary.total).toBe(8.25 + trips[1].total);
  });

  it("is empty for an empty log", () => {
    expect(summarizeMeterTrips([])).toEqual({ count: 0, distanceM: 0, total: 0 });
  });
});

describe("the log on disk", () => {
  it("stores newest first and reads back what it wrote", async () => {
    await saveMeterTrip({ ...tripFrom(finishedState()), id: "older", endedAt: 1 });
    const list = await saveMeterTrip({
      ...tripFrom(finishedState()),
      id: "newer",
      endedAt: 2,
    });
    expect(list.map((t) => t.id)).toEqual(["newer", "older"]);
    expect((await loadMeterTrips()).map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("replaces a record rather than duplicating its id", async () => {
    const trip = tripFrom(finishedState());
    await saveMeterTrip(trip);
    const list = await saveMeterTrip({ ...trip, total: 99 });
    expect(list).toHaveLength(1);
    expect(list[0].total).toBe(99);
  });

  it("keeps the log bounded", async () => {
    let list: MeterTrip[] = [];
    for (let i = 0; i < MAX_METER_TRIPS + 5; i++) {
      list = await saveMeterTrip({ ...tripFrom(finishedState()), id: `trip-${i}` });
    }
    expect(list).toHaveLength(MAX_METER_TRIPS);
    expect(list[0].id).toBe(`trip-${MAX_METER_TRIPS + 4}`);
  });

  it("drops junk rather than rendering a broken record", async () => {
    await AsyncStorage.setItem(
      METER_TRIPS_KEY,
      JSON.stringify([
        null,
        { id: "no-end-time" },
        { id: "ok", endedAt: 5 },
        "nonsense",
      ]),
    );
    const list = await loadMeterTrips();
    expect(list.map((t) => t.id)).toEqual(["ok"]);
    expect(list[0]).toMatchObject({ startedAt: 5, tariff: "old", period: "day", total: 0 });
  });

  it("survives unparseable storage", async () => {
    await AsyncStorage.setItem(METER_TRIPS_KEY, "{not json");
    expect(await loadMeterTrips()).toEqual([]);
  });

  it("clears on request", async () => {
    await saveMeterTrip(tripFrom(finishedState()));
    await clearMeterTrips();
    expect(await loadMeterTrips()).toEqual([]);
  });
});

describe("recordMeterTrip", () => {
  it("prices the hire from the state being stored, not from the caller", async () => {
    const { trip, trips } = await recordMeterTrip(finishedState(), {
      id: "recorded",
      endedAt: T0 + 600_000,
      tariff: "old",
      period: "night",
      extra: 1,
    });
    expect(trip.fare).toBe(8.63);
    expect(trip.total).toBe(9.63);
    expect(trips.map((t) => t.id)).toEqual(["recorded"]);
  });
});
