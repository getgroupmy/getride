import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  buildMeterTrip,
  clearMeterTrips,
  loadMeterTrips,
  MAX_METER_TRIPS,
  METER_TRIPS_KEY,
  patchMeterTripWaypoints,
  recordMeterTrip,
  saveMeterTrip,
  summarizeMeterTrips,
  type MeterTrip,
} from "@/utils/meterTripsStore";
import type { MeterWaypoint } from "@/utils/meterDashboard";
import { AIRPORT_SURCHARGE } from "@/utils/meterTripDetails";
import {
  computeMeterFare,
  createMeterState,
  periodMultiplier,
  type MeterState,
} from "@/utils/taxiMeter";

const T0 = 1_700_000_000_000;

/** The two ends of a hire, as the meter stamps them. */
const PICKUP: MeterWaypoint = {
  at: T0,
  odometerKm: 128450.6,
  latitude: 3.139,
  longitude: 101.6869,
  place: "KLCC, Kuala Lumpur",
};
const DROPOFF: MeterWaypoint = {
  at: T0 + 600_000,
  odometerKm: 128452.7,
  latitude: 3.1285,
  longitude: 101.6768,
  place: "Bangsar, Kuala Lumpur",
};

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

  it("stores the end-of-hire declaration and charges the airport surcharge", () => {
    const state = finishedState();
    const trip = buildMeterTrip(state, computeMeterFare(state), {
      id: "t",
      endedAt: T0 + 600_000,
      tariff: "old",
      period: "day",
      extra: 2.5,
      pax: 3,
      luggage: 2,
      airport: "dropoff",
      airportSurcharge: AIRPORT_SURCHARGE,
    });
    expect(trip).toMatchObject({
      pax: 3,
      luggage: 2,
      airport: "dropoff",
      airportSurcharge: AIRPORT_SURCHARGE,
      fare: 5.75,
      extra: 2.5,
    });
    expect(trip.total).toBe(5.75 + 2.5 + AIRPORT_SURCHARGE);
  });

  it("derives the surcharge from the leg when the caller passes none", () => {
    const state = finishedState();
    const make = (airport: "none" | "pickup") =>
      buildMeterTrip(state, computeMeterFare(state), {
        id: "t",
        endedAt: T0,
        tariff: "old",
        period: "day",
        extra: 0,
        pax: 1,
        luggage: 0,
        airport,
      });
    // A record can never claim an airport leg it did not bill for, or bill for
    // one it did not claim.
    expect(make("pickup").airportSurcharge).toBe(AIRPORT_SURCHARGE);
    expect(make("none").airportSurcharge).toBe(0);
  });

  it("stores the rate card's bag & passenger surcharge in the total", () => {
    const state = finishedState();
    const trip = buildMeterTrip(state, computeMeterFare(state), {
      id: "t",
      endedAt: T0 + 600_000,
      tariff: "old",
      period: "day",
      extra: 1,
      pax: 3,
      luggage: 2,
      airport: "pickup",
      airportSurcharge: AIRPORT_SURCHARGE,
      cardSurcharge: 4.5,
    });
    expect(trip.cardSurcharge).toBe(4.5);
    // Every line the passenger paid, and nothing the meter invented.
    expect(trip.total).toBe(5.75 + 1 + AIRPORT_SURCHARGE + 4.5);
  });

  it("charges no card surcharge when the caller priced none", () => {
    const trip = tripFrom(finishedState());
    expect(trip.cardSurcharge).toBe(0);
    expect(trip.total).toBe(trip.fare + trip.extra);
  });

  it("has no declaration at all when the caller made none", () => {
    const trip = tripFrom(finishedState());
    expect(trip).toMatchObject({
      pax: null,
      luggage: null,
      airport: "none",
      airportSurcharge: 0,
    });
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

  it("keeps both ends of the hire, sanitised", () => {
    const trip = buildMeterTrip(finishedState(), computeMeterFare(finishedState()), {
      id: "t",
      endedAt: T0 + 600_000,
      tariff: "old",
      period: "day",
      extra: 0,
      pickup: PICKUP,
      dropoff: {
        ...DROPOFF,
        // Half a fix and a blank address are dropped rather than stored.
        longitude: null,
        place: "  ",
      },
    });
    expect(trip.pickup).toEqual(PICKUP);
    expect(trip.dropoff).toEqual({
      at: DROPOFF.at,
      odometerKm: DROPOFF.odometerKm,
      latitude: null,
      longitude: null,
      place: null,
    });
  });

  it("has no ends at all when the meter could not stamp them", () => {
    const trip = tripFrom(finishedState());
    expect(trip.pickup).toBeNull();
    expect(trip.dropoff).toBeNull();
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

  it("reads a record written before the meter asked for a declaration", async () => {
    await AsyncStorage.setItem(
      METER_TRIPS_KEY,
      JSON.stringify([{ id: "legacy", endedAt: 5, fare: 6.1, extra: 0, total: 6.1 }]),
    );
    const [trip] = await loadMeterTrips();
    // No counts to print, no surcharge invented, and the total it charged.
    expect(trip).toMatchObject({
      pax: null,
      luggage: null,
      airport: "none",
      airportSurcharge: 0,
      total: 6.1,
    });
  });

  it("reads a record written before the meter stamped its ends", async () => {
    // The shape the log had until the ends existed: no pickup, no dropoff.
    await AsyncStorage.setItem(
      METER_TRIPS_KEY,
      JSON.stringify([{ id: "legacy", endedAt: 5, distanceM: 1200, total: 6.1 }]),
    );
    const [trip] = await loadMeterTrips();
    expect(trip).toMatchObject({ id: "legacy", pickup: null, dropoff: null });
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

describe("patchMeterTripWaypoints", () => {
  it("completes a hire whose readings landed after it was written", async () => {
    // What the record looks like when the driver ends the hire: the ends are
    // stamped, but the odometer and the address have not answered yet.
    const pending = {
      ...tripFrom(finishedState()),
      pickup: { ...PICKUP, odometerKm: null, place: null },
      dropoff: { ...DROPOFF, odometerKm: null, place: null },
    };
    await saveMeterTrip(pending);

    const { trip, trips } = await patchMeterTripWaypoints(pending.id, {
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    expect(trip?.pickup).toEqual(PICKUP);
    expect(trip?.dropoff).toEqual(DROPOFF);
    expect(trips[0].pickup?.place).toBe("KLCC, Kuala Lumpur");
    // And it is on disk, not just in the returned copy.
    expect((await loadMeterTrips())[0].dropoff?.odometerKm).toBe(128452.7);
  });

  it("touches only the end it was given", async () => {
    const trip = { ...tripFrom(finishedState()), pickup: PICKUP, dropoff: DROPOFF };
    await saveMeterTrip(trip);
    const { trip: patched } = await patchMeterTripWaypoints(trip.id, {
      dropoff: { ...DROPOFF, place: "Mid Valley" },
    });
    expect(patched?.pickup).toEqual(PICKUP);
    expect(patched?.dropoff?.place).toBe("Mid Valley");
  });

  it("never rewrites what was measured or charged", async () => {
    const trip = { ...tripFrom(finishedState(), 2.5), pickup: PICKUP, dropoff: DROPOFF };
    await saveMeterTrip(trip);
    const { trip: patched } = await patchMeterTripWaypoints(trip.id, {
      pickup: { ...PICKUP, place: "Ampang" },
    });
    expect(patched).toMatchObject({
      distanceM: trip.distanceM,
      elapsedMs: trip.elapsedMs,
      fare: trip.fare,
      extra: trip.extra,
      total: trip.total,
    });
  });

  it("is a no-op for a hire that is no longer on the roll", async () => {
    // Cleared, or aged off the end of the log, while the answer was in flight.
    const { trip, trips } = await patchMeterTripWaypoints("gone", { pickup: PICKUP });
    expect(trip).toBeNull();
    expect(trips).toEqual([]);
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

  it("carries the declaration onto the roll", async () => {
    const { trip } = await recordMeterTrip(finishedState(), {
      id: "declared",
      endedAt: T0 + 600_000,
      tariff: "old",
      period: "day",
      extra: 0,
      pax: 4,
      luggage: 0,
      airport: "pickup",
      airportSurcharge: AIRPORT_SURCHARGE,
    });
    expect(trip).toMatchObject({ pax: 4, luggage: 0, airport: "pickup" });
    expect(trip.total).toBe(5.75 + AIRPORT_SURCHARGE);
    expect((await loadMeterTrips())[0].airportSurcharge).toBe(AIRPORT_SURCHARGE);
  });
});
