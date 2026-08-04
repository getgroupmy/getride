/**
 * The meter's trip log — one record per completed hire.
 *
 * Device-local (AsyncStorage) for the same reason the adapter book is: the log
 * is the paper roll of a physical meter, kept by the machine that measured the
 * fare, and it has to keep working with no signal at all. Nothing here is a
 * billing record — a dispatched ride is settled through `ride_requests` and
 * the commission RPC; this is the driver's own tally of street hires.
 *
 * A record carries both ends of the hire (`pickup` / `dropoff`: the odometer
 * and the position where the passenger got in and out). Those readings do not
 * all land at once — the adapter and the geocoder answer after the fare is
 * already settled — so the record is written immediately and completed by
 * `patchMeterTripWaypoints`. Nothing that was measured or charged is rewritable.
 *
 * It also carries the end-of-hire declaration — passengers, luggage, keyed-in
 * charges and whether either end was an airport (`utils/meterTripDetails.ts`).
 * Those are stated by the driver before the record is written, so unlike the
 * waypoints they are complete from the first write. A record from a build before
 * the meter asked has `pax`/`luggage` null, and prints no such line.
 *
 * Shaping a record and summing the log are pure (and tested); this module only
 * loads, appends, patches and trims.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeMeterWaypoint,
  type MeterWaypoint,
} from "@/utils/meterDashboard";
import {
  airportSurchargeFor,
  clampLuggage,
  clampPax,
  normalizeAirport,
  sanitizeCharges,
  type MeterAirport,
} from "@/utils/meterTripDetails";
import {
  computeMeterFare,
  meterGrandTotal,
  periodMultiplier,
  type MeterFare,
  type MeterPeriod,
  type MeterRates,
  type MeterState,
  type MeterTariff,
} from "@/utils/taxiMeter";

export const METER_TRIPS_KEY = "@meter_trips_v1";

/** How many hires the log keeps. Older ones fall off the end. */
export const MAX_METER_TRIPS = 50;

export interface MeterTrip {
  id: string;
  /** Epoch ms the meter was started, and the moment the hire was ended. */
  startedAt: number;
  endedAt: number;
  distanceM: number;
  elapsedMs: number;
  waitingMs: number;
  tariff: MeterTariff;
  period: MeterPeriod;
  /** Metered fare in RM, night surcharge already applied. */
  fare: number;
  /** Tolls and other charges the driver keyed in, in RM. */
  extra: number;
  /**
   * Passengers carried and pieces of luggage, as the driver declared them at
   * the end of the hire. Null only on a record written before the meter asked.
   */
  pax: number | null;
  luggage: number | null;
  /** Which end of the hire — if either — was an airport. */
  airport: MeterAirport;
  /** The airport surcharge actually charged, in RM. Zero when neither end was. */
  airportSurcharge: number;
  /** What the passenger paid: `fare` + `extra` + `airportSurcharge`. */
  total: number;
  /** Samples each sensor contributed, so a fare can be traced to its source. */
  obdSamples: number;
  gpsSamples: number;
  plate: string | null;
  driver: string | null;
  /**
   * Where the hire began and ended: the vehicle's odometer and the position at
   * each end. Null on a record from a build before the meter stamped them, and
   * on either end the meter could not read — see {@link MeterWaypoint}.
   */
  pickup: MeterWaypoint | null;
  dropoff: MeterWaypoint | null;
}

export interface BuildMeterTripInput {
  id: string;
  endedAt: number;
  tariff: MeterTariff;
  period: MeterPeriod;
  /**
   * The rate card the hire was billed on. Omitted on a hire metered by the
   * built-in tariff, where `tariff` alone says everything.
   */
  rates?: MeterRates;
  /** The card's night surcharge, when it is not the built-in one. */
  nightMultiplier?: number;
  extra: number;
  /** The end-of-hire declaration. Omitted only by callers that predate it. */
  pax?: number | null;
  luggage?: number | null;
  airport?: MeterAirport | null;
  /**
   * The surcharge to charge for the airport leg. Defaulted from `airport` when
   * the caller does not pass one, so a record can never claim an airport leg it
   * did not bill for — or bill for one it did not claim.
   */
  airportSurcharge?: number | null;
  plate?: string | null;
  driver?: string | null;
  pickup?: MeterWaypoint | null;
  dropoff?: MeterWaypoint | null;
}

/**
 * Freeze a finished hire into a log record.
 *
 * Pure: the id and the end time are passed in rather than read off the clock,
 * so a record is reproducible sample-for-sample in a test. The fare is
 * recomputed from the state that is being stored, never taken from whatever
 * the screen happened to be rendering.
 */
export function buildMeterTrip(
  state: MeterState,
  fare: MeterFare,
  input: BuildMeterTripInput,
): MeterTrip {
  const extra = sanitizeCharges(input.extra);
  const airport = normalizeAirport(input.airport) ?? "none";
  const airportSurcharge =
    typeof input.airportSurcharge === "number" && Number.isFinite(input.airportSurcharge)
      ? Math.max(0, input.airportSurcharge)
      : airportSurchargeFor(airport);
  return {
    id: input.id,
    startedAt: state.startedAt ?? input.endedAt,
    endedAt: input.endedAt,
    distanceM: Math.max(0, state.distanceM),
    elapsedMs: Math.max(0, state.elapsedMs),
    waitingMs: Math.max(0, state.waitingMs),
    tariff: input.tariff,
    period: input.period,
    fare: fare.total,
    extra,
    pax: clampPax(input.pax),
    luggage: clampLuggage(input.luggage),
    airport,
    airportSurcharge,
    total: meterGrandTotal(fare.total, extra, airportSurcharge),
    obdSamples: state.obdSamples,
    gpsSamples: state.gpsSamples,
    plate: input.plate?.trim() ? input.plate.trim() : null,
    driver: input.driver?.trim() ? input.driver.trim() : null,
    pickup: normalizeMeterWaypoint(input.pickup),
    dropoff: normalizeMeterWaypoint(input.dropoff),
  };
}

export interface MeterTripsSummary {
  count: number;
  distanceM: number;
  /** Sum of the totals actually charged, in RM. */
  total: number;
}

/** Totals across the log — what the TRIPS tab shows above the list. */
export function summarizeMeterTrips(trips: MeterTrip[]): MeterTripsSummary {
  let distanceM = 0;
  let total = 0;
  for (const trip of trips) {
    distanceM += Number.isFinite(trip.distanceM) ? Math.max(0, trip.distanceM) : 0;
    total += Number.isFinite(trip.total) ? Math.max(0, trip.total) : 0;
  }
  return {
    count: trips.length,
    distanceM,
    total: Math.round(total * 100) / 100,
  };
}

/** Drop anything in storage that is not a usable record. */
function normalizeTrips(value: unknown): MeterTrip[] {
  if (!Array.isArray(value)) return [];
  const out: MeterTrip[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Partial<MeterTrip>;
    if (typeof t.id !== "string" || typeof t.endedAt !== "number") continue;
    const airport = normalizeAirport(t.airport) ?? "none";
    // A record from before the declaration existed has no surcharge line, and
    // one is never invented for it: its stored total is what was charged.
    const airportSurcharge =
      typeof t.airportSurcharge === "number" && Number.isFinite(t.airportSurcharge)
        ? Math.max(0, t.airportSurcharge)
        : airportSurchargeFor(airport);
    out.push({
      id: t.id,
      startedAt: typeof t.startedAt === "number" ? t.startedAt : t.endedAt,
      endedAt: t.endedAt,
      distanceM: typeof t.distanceM === "number" ? t.distanceM : 0,
      elapsedMs: typeof t.elapsedMs === "number" ? t.elapsedMs : 0,
      waitingMs: typeof t.waitingMs === "number" ? t.waitingMs : 0,
      tariff: t.tariff === "new" ? "new" : "old",
      period: t.period === "night" ? "night" : "day",
      fare: typeof t.fare === "number" ? t.fare : 0,
      extra: typeof t.extra === "number" ? t.extra : 0,
      pax: clampPax(t.pax),
      luggage: clampLuggage(t.luggage),
      airport,
      airportSurcharge,
      total:
        typeof t.total === "number"
          ? t.total
          : meterGrandTotal(
              typeof t.fare === "number" ? t.fare : 0,
              typeof t.extra === "number" ? t.extra : 0,
              airportSurcharge,
            ),
      obdSamples: typeof t.obdSamples === "number" ? t.obdSamples : 0,
      gpsSamples: typeof t.gpsSamples === "number" ? t.gpsSamples : 0,
      plate: typeof t.plate === "string" ? t.plate : null,
      driver: typeof t.driver === "string" ? t.driver : null,
      pickup: normalizeMeterWaypoint(t.pickup),
      dropoff: normalizeMeterWaypoint(t.dropoff),
    });
  }
  return out;
}

/** The log, newest hire first. */
export async function loadMeterTrips(): Promise<MeterTrip[]> {
  try {
    const raw = await AsyncStorage.getItem(METER_TRIPS_KEY);
    if (!raw) return [];
    return normalizeTrips(JSON.parse(raw));
  } catch (e) {
    console.log("[meter-trips] load failed", e);
    return [];
  }
}

/** Append a hire and return the trimmed log, newest first. */
export async function saveMeterTrip(trip: MeterTrip): Promise<MeterTrip[]> {
  const existing = await loadMeterTrips();
  const next = [trip, ...existing.filter((t) => t.id !== trip.id)].slice(
    0,
    MAX_METER_TRIPS,
  );
  try {
    await AsyncStorage.setItem(METER_TRIPS_KEY, JSON.stringify(next));
  } catch (e) {
    console.log("[meter-trips] save failed", e);
  }
  return next;
}

/**
 * Fold a late answer into a hire that is already on the roll.
 *
 * The two ends of a hire are stamped the instant they happen, but the readings
 * that describe them do not all arrive at once: the odometer comes back from
 * the adapter a moment later, and an address later still. Rather than hold the
 * record up — the log must exist the second the driver ends the hire — the
 * record is written with what is known and completed here.
 *
 * Only the ends may be patched: nothing that was measured or charged is
 * rewritable after the fact.
 */
export async function patchMeterTripWaypoints(
  id: string,
  patch: { pickup?: MeterWaypoint | null; dropoff?: MeterWaypoint | null },
): Promise<{ trip: MeterTrip | null; trips: MeterTrip[] }> {
  const existing = await loadMeterTrips();
  const index = existing.findIndex((t) => t.id === id);
  // The hire may have fallen off the end of the log, or been cleared, while the
  // answer was in flight — that is not an error, there is simply nothing to fill in.
  if (index === -1) return { trip: null, trips: existing };

  const updated: MeterTrip = {
    ...existing[index],
    ...("pickup" in patch ? { pickup: normalizeMeterWaypoint(patch.pickup) } : {}),
    ...("dropoff" in patch ? { dropoff: normalizeMeterWaypoint(patch.dropoff) } : {}),
  };
  const next = [...existing];
  next[index] = updated;
  try {
    await AsyncStorage.setItem(METER_TRIPS_KEY, JSON.stringify(next));
  } catch (e) {
    console.log("[meter-trips] waypoint patch failed", e);
  }
  return { trip: updated, trips: next };
}

/** Clear the log. The driver's own tally, so it is theirs to wipe. */
export async function clearMeterTrips(): Promise<void> {
  try {
    await AsyncStorage.removeItem(METER_TRIPS_KEY);
  } catch (e) {
    console.log("[meter-trips] clear failed", e);
  }
}

/**
 * Shape and store a finished hire in one step. Returns the record and the
 * trimmed log so the screen can render both without a second read.
 */
export async function recordMeterTrip(
  state: MeterState,
  input: BuildMeterTripInput,
): Promise<{ trip: MeterTrip; trips: MeterTrip[] }> {
  const fare = computeMeterFare(state, {
    tariff: input.tariff,
    rates: input.rates,
    multiplier: periodMultiplier(input.period, input.nightMultiplier),
  });
  const trip = buildMeterTrip(state, fare, input);
  const trips = await saveMeterTrip(trip);
  return { trip, trips };
}
