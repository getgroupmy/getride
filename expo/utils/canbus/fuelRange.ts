/**
 * Odometer, fuel level and distance-to-empty.
 *
 * Two of the three numbers the driver actually wants come straight off the
 * bus: the odometer (mode 01 PID A6) and the fuel tank level (PID 2F). The
 * third — how far the remaining fuel will go — is *not* an OBD-II parameter.
 * Generic OBD-II exposes no tank capacity and no distance-to-empty, so the
 * range shown by the dashboard is computed by the car from data it never
 * publishes. This module reconstructs it from what the reader can see:
 *
 *     litres remaining = tank capacity × fuel level %
 *     range            = litres remaining ÷ consumption
 *
 * Tank capacity has to come from the driver (it is a property of the car, not
 * of the bus). Consumption is resolved in priority order — a figure *measured*
 * across the driver's own fuel burn between two scans beats an instantaneous
 * live rate, which beats the configured average — and every result says which
 * source it used, so the screen never presents an assumption as a measurement.
 *
 * Everything here is pure arithmetic so the whole surface is unit-tested
 * without a vehicle — see utils/__tests__/fuelRange.test.ts.
 */

import { decodeReading, type VehicleReading } from "./vehicleScan";

/* ------------------------------------------------------------------ *
 * PIDs this module reads
 * ------------------------------------------------------------------ */

export const PID_ODOMETER = "A6";
export const PID_FUEL_LEVEL = "2F";
export const PID_FUEL_RATE = "5E";
export const PID_MAF = "10";
export const PID_SPEED = "0D";
export const PID_FUEL_TYPE = "51";
/** Fallback distance counter — not an odometer, but the only one many cars have. */
export const PID_DISTANCE_SINCE_CLEARED = "31";

/* ------------------------------------------------------------------ *
 * Profile — the part of the maths that cannot come off the bus
 * ------------------------------------------------------------------ */

/** Tank size assumed until the driver enters the real one (a typical sedan). */
export const DEFAULT_TANK_CAPACITY_L = 45;
/** Consumption assumed until something better is known, in L/100 km. */
export const DEFAULT_CONSUMPTION_L_PER_100KM = 8;

export const MIN_TANK_CAPACITY_L = 5;
export const MAX_TANK_CAPACITY_L = 500;
/** Sanity band for any consumption figure, measured or entered. */
export const MIN_CONSUMPTION_L_PER_100KM = 2;
export const MAX_CONSUMPTION_L_PER_100KM = 40;

/** Below this the fuel burn is too small for the level gauge to resolve. */
export const MIN_LEARN_DISTANCE_KM = 20;
/** A drop larger than this between two scans is a gauge glitch, not a burn. */
export const MAX_LEARN_LEVEL_DROP = 60;
/** Weight given to a fresh measurement when folding it into the running one. */
export const LEARN_SMOOTHING = 0.4;

/** Live consumption is meaningless below this speed (idling burns fuel, goes nowhere). */
export const MIN_LIVE_CONSUMPTION_SPEED_KMH = 10;

/** One (odometer, fuel level) pair, kept so the next scan can measure the burn. */
export interface FuelSample {
  odometerKm: number;
  fuelLevelPercent: number;
  /** Epoch ms. */
  at: number;
}

/** Everything about this vehicle's fuel that the bus cannot tell us. */
export interface FuelProfile {
  /** Usable tank size in litres. */
  tankCapacityL: number;
  /** The driver's own average, in L/100 km — used when nothing better exists. */
  consumptionL100: number;
  /** Consumption actually measured from this car's fuel burn, if enough has been driven. */
  measuredL100: number | null;
  /** The reading the next measurement is taken against. */
  baseline: FuelSample | null;
  /** Which vehicle this profile describes, when the VIN is known. */
  vin: string | null;
}

export function defaultFuelProfile(vin: string | null = null): FuelProfile {
  return {
    tankCapacityL: DEFAULT_TANK_CAPACITY_L,
    consumptionL100: DEFAULT_CONSUMPTION_L_PER_100KM,
    measuredL100: null,
    baseline: null,
    vin,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Coerce a stored/parsed profile into a usable one, replacing anything absent
 * or out of range with the default. Storage is device-local JSON that older
 * builds may have written, so nothing here may be trusted blindly.
 */
export function normalizeFuelProfile(input: Partial<FuelProfile> | null | undefined): FuelProfile {
  const base = defaultFuelProfile();
  if (!input) return base;
  const capacity = Number(input.tankCapacityL);
  const consumption = Number(input.consumptionL100);
  const measured = Number(input.measuredL100);
  const baseline =
    input.baseline &&
    Number.isFinite(Number(input.baseline.odometerKm)) &&
    Number.isFinite(Number(input.baseline.fuelLevelPercent))
      ? {
          odometerKm: Number(input.baseline.odometerKm),
          fuelLevelPercent: Number(input.baseline.fuelLevelPercent),
          at: Number(input.baseline.at) || 0,
        }
      : null;
  return {
    tankCapacityL: Number.isFinite(capacity)
      ? clamp(capacity, MIN_TANK_CAPACITY_L, MAX_TANK_CAPACITY_L)
      : base.tankCapacityL,
    consumptionL100: Number.isFinite(consumption)
      ? clamp(consumption, MIN_CONSUMPTION_L_PER_100KM, MAX_CONSUMPTION_L_PER_100KM)
      : base.consumptionL100,
    measuredL100:
      Number.isFinite(measured) &&
      measured >= MIN_CONSUMPTION_L_PER_100KM &&
      measured <= MAX_CONSUMPTION_L_PER_100KM
        ? measured
        : null,
    baseline,
    vin: typeof input.vin === "string" && input.vin.length > 0 ? input.vin : null,
  };
}

/**
 * The profile to use for the vehicle now on the other end of the reader.
 *
 * A different VIN is a different car: its tank size and its measured burn have
 * nothing to do with the stored ones, so the profile starts fresh rather than
 * quietly computing range for one car from another car's numbers. A vehicle
 * that does not report a VIN cannot be told apart, so the stored profile
 * stands.
 */
export function profileForVin(stored: FuelProfile, vin: string | null): FuelProfile {
  if (!vin) return stored;
  if (!stored.vin) return { ...stored, vin };
  if (stored.vin === vin) return stored;
  return defaultFuelProfile(vin);
}

export interface ProfileEditResult {
  ok: boolean;
  error?: string;
  value?: { tankCapacityL: number; consumptionL100: number };
}

/** Validate the two numbers the driver can type on the fuel settings popup. */
export function validateFuelProfileInput(
  tankCapacity: string | number,
  consumption: string | number,
): ProfileEditResult {
  const capacity = typeof tankCapacity === "number" ? tankCapacity : Number(String(tankCapacity).trim());
  if (!Number.isFinite(capacity) || capacity < MIN_TANK_CAPACITY_L || capacity > MAX_TANK_CAPACITY_L) {
    return {
      ok: false,
      error: `Tank capacity must be between ${MIN_TANK_CAPACITY_L} and ${MAX_TANK_CAPACITY_L} litres.`,
    };
  }
  const l100 = typeof consumption === "number" ? consumption : Number(String(consumption).trim());
  if (
    !Number.isFinite(l100) ||
    l100 < MIN_CONSUMPTION_L_PER_100KM ||
    l100 > MAX_CONSUMPTION_L_PER_100KM
  ) {
    return {
      ok: false,
      error: `Average consumption must be between ${MIN_CONSUMPTION_L_PER_100KM} and ${MAX_CONSUMPTION_L_PER_100KM} L/100 km.`,
    };
  }
  return { ok: true, value: { tankCapacityL: capacity, consumptionL100: l100 } };
}

/* ------------------------------------------------------------------ *
 * Snapshot — what this scan saw
 * ------------------------------------------------------------------ */

export interface FuelSnapshot {
  /** Total distance the vehicle has covered, km (PID A6). */
  odometerKm: number | null;
  /** Distance since the codes were last cleared, km (PID 31) — not an odometer. */
  distanceSinceClearedKm: number | null;
  fuelLevelPercent: number | null;
  /** Instantaneous burn in L/h (PID 5E). */
  fuelRateLph: number | null;
  /** Mass air flow in g/s (PID 10), the fallback way to a burn rate. */
  mafGramsPerSec: number | null;
  speedKmh: number | null;
  /** Decoded fuel type text (PID 51), e.g. "Diesel". */
  fuelType: string | null;
}

function numericReading(byPid: Map<string, VehicleReading>, pid: string): number | null {
  const value = byPid.get(pid)?.numeric;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Pull everything the range maths needs out of a completed scan. */
export function readFuelSnapshot(readings: VehicleReading[]): FuelSnapshot {
  const byPid = new Map<string, VehicleReading>();
  for (const reading of readings) {
    if (reading.known) byPid.set(reading.pid.toUpperCase(), reading);
  }
  return {
    odometerKm: numericReading(byPid, PID_ODOMETER),
    distanceSinceClearedKm: numericReading(byPid, PID_DISTANCE_SINCE_CLEARED),
    fuelLevelPercent: numericReading(byPid, PID_FUEL_LEVEL),
    fuelRateLph: numericReading(byPid, PID_FUEL_RATE),
    mafGramsPerSec: numericReading(byPid, PID_MAF),
    speedKmh: numericReading(byPid, PID_SPEED),
    fuelType: byPid.get(PID_FUEL_TYPE)?.value ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Reading the odometer off a live adapter
 * ------------------------------------------------------------------ */

/**
 * How many times PID A6 is asked before the reading is called absent.
 *
 * One unanswered command is not proof that a car has no odometer. The adapter
 * serves a single command at a time while the 1 Hz sweep is still running, and
 * ELM327 clones answer `BUSY`, `STOPPED` or a truncated frame often enough that
 * a single ask is a coin toss — which matters now that a missing reading holds
 * a hire up rather than merely leaving a dash on the receipt.
 */
export const ODOMETER_READ_ATTEMPTS = 3;

/** Pause between attempts, long enough for the adapter to finish its answer. */
export const ODOMETER_RETRY_DELAY_MS = 250;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ask a live reader for the odometer the cluster is showing (mode 01 PID A6).
 *
 * Returns the reading in km, or `null` once every attempt has come back empty
 * — which on a car that simply does not implement A6 is the honest answer, and
 * the only one: generic OBD-II has no second odometer. PID 31 (distance since
 * the codes were cleared) is *not* a substitute — it is reset by any scan-tool
 * clear, so billing a receipt's start mileage on it would print a number that
 * is not the car's mileage.
 *
 * `send` is `useCanbus().sendCommand`; a thrown command (timeout, dropped link)
 * counts as one failed attempt rather than aborting the read.
 */
export async function readOdometerKm(
  send: (command: string) => Promise<string>,
  options?: { attempts?: number; delayMs?: number },
): Promise<number | null> {
  const attempts = Math.max(1, Math.floor(options?.attempts ?? ODOMETER_READ_ATTEMPTS));
  const delayMs = Math.max(0, options?.delayMs ?? ODOMETER_RETRY_DELAY_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && delayMs > 0) await wait(delayMs);
    try {
      const raw = await send("01" + PID_ODOMETER);
      const numeric = decodeReading(PID_ODOMETER, raw)?.numeric;
      if (typeof numeric === "number" && Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
      }
    } catch (e) {
      console.log("[fuelRange] odometer read failed", e);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Consumption
 * ------------------------------------------------------------------ */

export type ConsumptionSource = "measured" | "fuel-rate" | "maf" | "configured";

export const CONSUMPTION_SOURCE_LABEL: Record<ConsumptionSource, string> = {
  measured: "measured from this vehicle's own fuel use",
  "fuel-rate": "from the engine's live fuel rate",
  maf: "estimated from live air flow",
  configured: "your entered average — no live measurement yet",
};

export interface ConsumptionEstimate {
  /** Litres per 100 km. */
  l100: number;
  source: ConsumptionSource;
}

/**
 * Litres per hour derived from mass air flow.
 *
 * The engine burns air and fuel at roughly the stoichiometric ratio, so the
 * fuel mass is the air mass over that ratio, and the volume is that mass over
 * the fuel's density. Diesel runs leaner and is denser than petrol; anything
 * else falls back to the petrol figures, which is what the ratio and density
 * of an unknown liquid fuel are most likely to be.
 */
export function fuelRateFromMaf(mafGramsPerSec: number, fuelType: string | null): number {
  const diesel = (fuelType ?? "").toLowerCase().includes("diesel");
  const airFuelRatio = diesel ? 14.5 : 14.7;
  const densityGramsPerL = diesel ? 832 : 745;
  return (mafGramsPerSec * 3600) / (airFuelRatio * densityGramsPerL);
}

function inBand(l100: number): boolean {
  return (
    Number.isFinite(l100) &&
    l100 >= MIN_CONSUMPTION_L_PER_100KM &&
    l100 <= MAX_CONSUMPTION_L_PER_100KM
  );
}

/**
 * Resolve the consumption to divide the remaining fuel by.
 *
 * A figure measured across tens of kilometres of the driver's own driving is
 * the best predictor of the next tens of kilometres, so it outranks any
 * instantaneous reading; a live rate taken at road speed comes next; the
 * entered average is the floor. Live rates are only used while the vehicle is
 * actually moving — at a standstill the burn is real but the distance is zero,
 * which would put the range at zero too.
 */
export function estimateConsumption(
  snapshot: FuelSnapshot,
  profile: FuelProfile,
): ConsumptionEstimate {
  if (profile.measuredL100 !== null && inBand(profile.measuredL100)) {
    return { l100: profile.measuredL100, source: "measured" };
  }
  const speed = snapshot.speedKmh;
  if (speed !== null && speed >= MIN_LIVE_CONSUMPTION_SPEED_KMH) {
    if (snapshot.fuelRateLph !== null && snapshot.fuelRateLph > 0) {
      const l100 = (snapshot.fuelRateLph / speed) * 100;
      if (inBand(l100)) return { l100, source: "fuel-rate" };
    }
    if (snapshot.mafGramsPerSec !== null && snapshot.mafGramsPerSec > 0) {
      const l100 = (fuelRateFromMaf(snapshot.mafGramsPerSec, snapshot.fuelType) / speed) * 100;
      if (inBand(l100)) return { l100, source: "maf" };
    }
  }
  return { l100: profile.consumptionL100, source: "configured" };
}

/* ------------------------------------------------------------------ *
 * Learning the real consumption
 * ------------------------------------------------------------------ */

export interface LearnResult {
  profile: FuelProfile;
  /** True when this sample produced a new measurement. */
  learned: boolean;
  /** The consumption this sample alone implied, before smoothing. */
  sampleL100?: number;
}

/**
 * Fold a fresh (odometer, level) reading into the profile.
 *
 * Only a pair that describes a plausible burn is used: the odometer must have
 * gone forward by enough for the coarse level gauge to have moved, and the
 * level must have gone *down* by a believable amount. A refuel (level up), a
 * different vehicle (odometer back), or an implausible result all re-baseline
 * instead of poisoning the average — the measurement is simply deferred to the
 * next stretch of driving.
 */
export function learnConsumption(current: FuelSample, profile: FuelProfile): LearnResult {
  const rebaselined = { ...profile, baseline: current };
  const previous = profile.baseline;
  if (!previous) return { profile: rebaselined, learned: false };

  const distanceKm = current.odometerKm - previous.odometerKm;
  // Odometer went backwards — a different car, or a reader that reported
  // rubbish. Start again from here rather than measuring across the jump.
  if (distanceKm < 0) return { profile: rebaselined, learned: false };
  // Not far enough yet: keep the old baseline so the next scan measures the
  // whole stretch instead of restarting the clock every time the screen opens.
  if (distanceKm < MIN_LEARN_DISTANCE_KM) return { profile, learned: false };

  const levelDrop = previous.fuelLevelPercent - current.fuelLevelPercent;
  if (levelDrop <= 0 || levelDrop > MAX_LEARN_LEVEL_DROP) {
    return { profile: rebaselined, learned: false };
  }

  const litresUsed = (profile.tankCapacityL * levelDrop) / 100;
  const sampleL100 = (litresUsed / distanceKm) * 100;
  if (!inBand(sampleL100)) return { profile: rebaselined, learned: false };

  const measuredL100 =
    profile.measuredL100 === null
      ? sampleL100
      : profile.measuredL100 * (1 - LEARN_SMOOTHING) + sampleL100 * LEARN_SMOOTHING;

  return {
    profile: { ...rebaselined, measuredL100 },
    learned: true,
    sampleL100,
  };
}

/* ------------------------------------------------------------------ *
 * The answer
 * ------------------------------------------------------------------ */

export interface FuelRangeResult {
  odometerKm: number | null;
  /** Only meaningful when the vehicle does not report a real odometer. */
  distanceSinceClearedKm: number | null;
  fuelLevelPercent: number | null;
  litresRemaining: number | null;
  /** Distance the remaining fuel is expected to cover, km. */
  rangeKm: number | null;
  consumption: ConsumptionEstimate;
  /** True when the numbers rest on an entered figure rather than a measured one. */
  estimated: boolean;
}

export function computeFuelRange(
  snapshot: FuelSnapshot,
  profile: FuelProfile,
): FuelRangeResult {
  const consumption = estimateConsumption(snapshot, profile);
  const level = snapshot.fuelLevelPercent;
  const litresRemaining =
    level === null ? null : (profile.tankCapacityL * clamp(level, 0, 100)) / 100;
  const rangeKm =
    litresRemaining === null || consumption.l100 <= 0
      ? null
      : (litresRemaining / consumption.l100) * 100;
  return {
    odometerKm: snapshot.odometerKm,
    distanceSinceClearedKm: snapshot.distanceSinceClearedKm,
    fuelLevelPercent: level,
    litresRemaining,
    rangeKm,
    consumption,
    estimated: consumption.source !== "measured",
  };
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/** Thousands-separated whole kilometres, e.g. 128456.7 → "128,457". */
export function formatKm(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return "—";
  return Math.round(km).toLocaleString("en-US");
}

export function formatLitres(litres: number | null): string {
  if (litres === null || !Number.isFinite(litres)) return "—";
  return litres.toFixed(1);
}

export function formatPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return "—";
  return percent.toFixed(0);
}

export function formatConsumption(l100: number | null): string {
  if (l100 === null || !Number.isFinite(l100)) return "—";
  return l100.toFixed(1);
}

/** How full the tank is, 0…1, for the level bar. */
export function fuelBarFraction(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  return clamp(percent, 0, 100) / 100;
}

/** Green above a quarter, amber down to the reserve, red below it. */
export function fuelLevelColor(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return "#6B7280";
  if (percent <= 10) return "#EF4444";
  if (percent <= 25) return "#F59E0B";
  return "#22C55E";
}
