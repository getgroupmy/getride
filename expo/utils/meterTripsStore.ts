/**
 * The meter's trip log — one record per completed hire.
 *
 * Device-local (AsyncStorage) for the same reason the adapter book is: the log
 * is the paper roll of a physical meter, kept by the machine that measured the
 * fare, and it has to keep working with no signal at all. Nothing here is a
 * billing record — a dispatched ride is settled through `ride_requests` and
 * the commission RPC; this is the driver's own tally of street hires.
 *
 * Shaping a record and summing the log are pure (and tested); this module only
 * loads, appends and trims.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  computeMeterFare,
  meterGrandTotal,
  periodMultiplier,
  type MeterFare,
  type MeterPeriod,
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
  /** Hand-entered extras in RM. */
  extra: number;
  /** What the passenger paid: `fare` + `extra`. */
  total: number;
  /** Samples each sensor contributed, so a fare can be traced to its source. */
  obdSamples: number;
  gpsSamples: number;
  plate: string | null;
  driver: string | null;
}

export interface BuildMeterTripInput {
  id: string;
  endedAt: number;
  tariff: MeterTariff;
  period: MeterPeriod;
  extra: number;
  plate?: string | null;
  driver?: string | null;
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
  const extra = Math.max(0, Number.isFinite(input.extra) ? input.extra : 0);
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
    total: meterGrandTotal(fare.total, extra),
    obdSamples: state.obdSamples,
    gpsSamples: state.gpsSamples,
    plate: input.plate?.trim() ? input.plate.trim() : null,
    driver: input.driver?.trim() ? input.driver.trim() : null,
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
      total:
        typeof t.total === "number"
          ? t.total
          : meterGrandTotal(typeof t.fare === "number" ? t.fare : 0, 0),
      obdSamples: typeof t.obdSamples === "number" ? t.obdSamples : 0,
      gpsSamples: typeof t.gpsSamples === "number" ? t.gpsSamples : 0,
      plate: typeof t.plate === "string" ? t.plate : null,
      driver: typeof t.driver === "string" ? t.driver : null,
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
    multiplier: periodMultiplier(input.period),
  });
  const trip = buildMeterTrip(state, fare, input);
  const trips = await saveMeterTrip(trip);
  return { trip, trips };
}
