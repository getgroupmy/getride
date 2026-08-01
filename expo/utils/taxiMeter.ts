/**
 * Digital taxi meter — pure accumulation + tariff logic.
 *
 * The meter runs off a 1 Hz sample loop fed by two sources, in priority order:
 *
 *  1. **OBD-II / CANBus** (primary) — the vehicle's own speedometer (PID 0D),
 *     read through the ELM327 session client. It is the odometer-grade source:
 *     unaffected by tunnels, urban canyons or a cold GPS fix.
 *  2. **GPS** (fallback) — used whenever the OBD link is absent, stale, or
 *     running against the simulator. Distance comes from the displacement
 *     between consecutive fixes when they are trustworthy, and from integrating
 *     the reported ground speed when they are not.
 *
 * Everything here is deterministic — no timers, no device access — so the
 * accrual and the fare can be unit-tested sample by sample. See
 * utils/__tests__/taxiMeter.test.ts. The screen (app/meter-digital.tsx) owns
 * the clock and the sensors and simply feeds samples in.
 */

/** Fare structures, mirroring `TariffType` in utils/maps.ts. */
export type MeterTariff = "old" | "new";

/** Which sensor produced the distance for the most recent sample. */
export type MeterSource = "obd" | "gps" | "none";

// --- Tariff constants (same TEKSI Malaysia tariffs as `calculateFare`) ---

/** Flag fall, in RM. Covers the first {@link FLAG_FALL_DISTANCE_M}. */
export const FLAG_FALL = 4.0;
/** Distance the flag fall covers, in metres. */
export const FLAG_FALL_DISTANCE_M = 1000;
/** Charge per increment beyond the flag fall, in RM ("old" tariff). */
export const INCREMENT_CHARGE = 0.35;
/** One distance increment, in metres ("old" tariff). */
export const INCREMENT_DISTANCE_M = 200;
/** One time increment, in ms ("old" tariff). */
export const INCREMENT_TIME_MS = 36_000;
/** Per-km charge, in RM ("new" tariff). */
export const NEW_TARIFF_PER_KM = 1.0;
/** Per-minute charge, in RM ("new" tariff). */
export const NEW_TARIFF_PER_MIN = 0.3;

// --- Sampling tunables ---

/**
 * How old an OBD telemetry sweep may be before the meter stops trusting it and
 * falls back to GPS. The client polls once a second (POLL_INTERVAL_MS), so this
 * tolerates a few missed sweeps before switching source.
 */
export const OBD_STALE_MS = 4000;

/**
 * Longest gap between two samples that still counts as continuous driving.
 * Anything larger (app backgrounded, screen slept, clock jump) is clamped so a
 * pause can never be billed as motion.
 */
export const MAX_SAMPLE_GAP_MS = 5000;

/** At or below this speed the vehicle counts as waiting, not moving. */
export const WAITING_SPEED_KMH = 5;

/** GPS fixes worse than this (metres) are not trusted for displacement. */
export const GPS_MAX_ACCURACY_M = 50;

/** Displacement below this (metres) is treated as GPS jitter, not travel. */
export const GPS_MIN_MOVE_M = 3;

/** Displacement implying a speed above this (km/h) is a GPS jump, not travel. */
export const GPS_MAX_PLAUSIBLE_KMH = 220;

export interface MeterPoint {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres, when the platform reports one. */
  accuracyM?: number | null;
}

/** One tick of sensor input. All fields are optional — sources come and go. */
export interface MeterSample {
  /** Epoch ms this sample was taken. */
  at: number;
  /** Vehicle speed from OBD PID 0D, in km/h. */
  obdSpeedKmh?: number | null;
  /** Epoch ms of the telemetry sweep that produced `obdSpeedKmh`. */
  obdUpdatedAt?: number | null;
  /** Ground speed from the GPS fix, in km/h. */
  gpsSpeedKmh?: number | null;
  /** The GPS fix itself, used for displacement-based distance. */
  gpsPoint?: MeterPoint | null;
}

export interface MeterState {
  /** True while the meter is accruing. Samples are ignored when false. */
  running: boolean;
  /** Epoch ms the meter was first started, or null before the first start. */
  startedAt: number | null;
  /** Total distance travelled, in metres. */
  distanceM: number;
  /** Total running time, in ms (paused time excluded). */
  elapsedMs: number;
  /**
   * Running time accrued *after* the flag-fall distance was covered. This is
   * what the "old" tariff bills per 36 s — a real meter tracks it directly
   * instead of `calculateFare`'s proportional approximation.
   */
  chargeableMs: number;
  /** Time spent at or below {@link WAITING_SPEED_KMH}, in ms. */
  waitingMs: number;
  /** Speed used for the most recent sample, in km/h. */
  speedKmh: number;
  /** Which sensor drove the most recent sample. */
  source: MeterSource;
  /** How many samples each source has contributed (for the source badge). */
  obdSamples: number;
  gpsSamples: number;
  /** Epoch ms of the previous accepted sample. */
  lastAt: number | null;
  /** Previous trusted GPS fix, the baseline for displacement. */
  lastPoint: MeterPoint | null;
}

export function createMeterState(): MeterState {
  return {
    running: false,
    startedAt: null,
    distanceM: 0,
    elapsedMs: 0,
    chargeableMs: 0,
    waitingMs: 0,
    speedKmh: 0,
    source: "none",
    obdSamples: 0,
    gpsSamples: 0,
    lastAt: null,
    lastPoint: null,
  };
}

/**
 * Start (or resume) accrual at `at`. The sample clock restarts from `at`, so
 * however long the meter sat paused is never billed.
 */
export function startMeter(state: MeterState, at: number): MeterState {
  return {
    ...state,
    running: true,
    startedAt: state.startedAt ?? at,
    lastAt: at,
    // Drop the stale GPS baseline: the vehicle may have moved while paused and
    // that displacement is not chargeable.
    lastPoint: null,
  };
}

/** Pause accrual. Totals are kept so the meter can be resumed. */
export function pauseMeter(state: MeterState): MeterState {
  return { ...state, running: false, lastAt: null, lastPoint: null, speedKmh: 0 };
}

/** Clear the meter back to a fresh, stopped state. */
export function resetMeter(): MeterState {
  return createMeterState();
}

/** Great-circle distance between two fixes, in metres. */
export function haversineMeters(a: MeterPoint, b: MeterPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isUsableFix(point: MeterPoint | null | undefined): point is MeterPoint {
  if (!point) return false;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return false;
  }
  const acc = point.accuracyM;
  // A missing accuracy is common on web/older Android; accept the fix but let
  // the plausibility guards below catch the bad ones.
  if (typeof acc === "number" && Number.isFinite(acc) && acc > GPS_MAX_ACCURACY_M) {
    return false;
  }
  return true;
}

/** True when the OBD speed reading is present and recent enough to bill on. */
export function isObdFresh(sample: MeterSample): boolean {
  const speed = sample.obdSpeedKmh;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0) {
    return false;
  }
  const at = sample.obdUpdatedAt;
  if (typeof at !== "number" || !Number.isFinite(at)) return false;
  const age = sample.at - at;
  return age >= 0 && age <= OBD_STALE_MS;
}

/**
 * Fold one sensor sample into the meter. Pure: returns a new state and never
 * touches the clock itself.
 *
 * A sample arriving while the meter is stopped is ignored outright, so a
 * paused meter can never accrue distance, time, or fare.
 */
export function applyMeterSample(state: MeterState, sample: MeterSample): MeterState {
  if (!state.running) return state;

  const usableFix = isUsableFix(sample.gpsPoint) ? (sample.gpsPoint as MeterPoint) : null;

  if (state.lastAt === null) {
    // First sample after a start/resume: nothing to integrate over yet, just
    // set the baseline.
    return { ...state, lastAt: sample.at, lastPoint: usableFix };
  }

  const rawDt = sample.at - state.lastAt;
  const dt = Math.min(Math.max(0, rawDt), MAX_SAMPLE_GAP_MS);

  let source: MeterSource = "none";
  let speedKmh = 0;
  let deltaM = 0;

  if (isObdFresh(sample)) {
    source = "obd";
    speedKmh = sample.obdSpeedKmh as number;
    deltaM = (speedKmh / 3.6) * (dt / 1000);
  } else {
    const gpsSpeed =
      typeof sample.gpsSpeedKmh === "number" &&
      Number.isFinite(sample.gpsSpeedKmh) &&
      sample.gpsSpeedKmh >= 0
        ? sample.gpsSpeedKmh
        : null;

    let displacement: number | null = null;
    if (usableFix && state.lastPoint && dt > 0) {
      const moved = haversineMeters(state.lastPoint, usableFix);
      const impliedKmh = (moved / (dt / 1000)) * 3.6;
      if (moved >= GPS_MIN_MOVE_M && impliedKmh <= GPS_MAX_PLAUSIBLE_KMH) {
        displacement = moved;
      } else if (moved < GPS_MIN_MOVE_M) {
        // Below the jitter floor the vehicle is standing still — that is a
        // real (zero) reading, not a missing one.
        displacement = 0;
      }
    }

    if (displacement !== null) {
      source = "gps";
      deltaM = displacement;
      speedKmh = gpsSpeed ?? (dt > 0 ? (displacement / (dt / 1000)) * 3.6 : 0);
    } else if (gpsSpeed !== null) {
      source = "gps";
      speedKmh = gpsSpeed;
      deltaM = (gpsSpeed / 3.6) * (dt / 1000);
    }
  }

  const distanceM = state.distanceM + deltaM;

  // Time beyond the flag-fall distance is what the "old" tariff bills. When a
  // sample straddles the 1 km mark, only the part after it counts.
  let chargeableMs = state.chargeableMs;
  if (distanceM > FLAG_FALL_DISTANCE_M) {
    const share =
      state.distanceM >= FLAG_FALL_DISTANCE_M || deltaM <= 0
        ? 1
        : (distanceM - FLAG_FALL_DISTANCE_M) / deltaM;
    chargeableMs += dt * Math.min(1, Math.max(0, share));
  }

  return {
    ...state,
    distanceM,
    elapsedMs: state.elapsedMs + dt,
    chargeableMs,
    waitingMs: state.waitingMs + (speedKmh <= WAITING_SPEED_KMH ? dt : 0),
    speedKmh,
    source,
    obdSamples: state.obdSamples + (source === "obd" ? 1 : 0),
    gpsSamples: state.gpsSamples + (source === "gps" ? 1 : 0),
    lastAt: sample.at,
    lastPoint: usableFix ?? state.lastPoint,
  };
}

export interface MeterFare {
  /** Total payable, in RM, rounded to sen. */
  total: number;
  /** The flag-fall portion, in RM. */
  flagFall: number;
  /** Billed increments beyond the flag fall ("old" tariff only). */
  units: number;
  /** Increments the distance alone would have billed ("old" tariff only). */
  distanceUnits: number;
  /** Increments the time alone would have billed ("old" tariff only). */
  timeUnits: number;
  /** Charge from the increments (or from km + minutes on the new tariff). */
  variable: number;
  distanceKm: number;
  durationMin: number;
}

export interface MeterFareOptions {
  tariff?: MeterTariff;
  /** Surge/peak multiplier applied to the whole fare. */
  multiplier?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fare for the meter's current totals.
 *
 * Matches `calculateFare` in utils/maps.ts, with one deliberate improvement:
 * the "old" tariff's time increments are billed from the time actually accrued
 * after the first kilometre (`chargeableMs`) rather than a proportional
 * estimate, because a live meter knows it exactly.
 */
export function computeMeterFare(
  state: MeterState,
  options: MeterFareOptions = {},
): MeterFare {
  const { tariff = "old", multiplier = 1 } = options;
  const distanceM = Math.max(0, state.distanceM);
  const distanceKm = distanceM / 1000;
  const durationMin = Math.max(0, state.elapsedMs) / 60_000;

  if (tariff === "new") {
    const variable = distanceKm * NEW_TARIFF_PER_KM + durationMin * NEW_TARIFF_PER_MIN;
    return {
      total: round2((FLAG_FALL + variable) * multiplier),
      flagFall: round2(FLAG_FALL * multiplier),
      units: 0,
      distanceUnits: 0,
      timeUnits: 0,
      variable: round2(variable * multiplier),
      distanceKm,
      durationMin,
    };
  }

  const extraM = Math.max(0, distanceM - FLAG_FALL_DISTANCE_M);
  const distanceUnits = Math.ceil(extraM / INCREMENT_DISTANCE_M);
  const timeUnits =
    extraM > 0 ? Math.ceil(Math.max(0, state.chargeableMs) / INCREMENT_TIME_MS) : 0;
  const units = Math.max(distanceUnits, timeUnits);
  const variable = units * INCREMENT_CHARGE;

  return {
    total: round2((FLAG_FALL + variable) * multiplier),
    flagFall: round2(FLAG_FALL * multiplier),
    units,
    distanceUnits,
    timeUnits,
    variable: round2(variable * multiplier),
    distanceKm,
    durationMin,
  };
}

/** "1:04:07" past an hour, otherwise "04:07". */
export function formatMeterDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Metres as the driver reads them: "740 m" below a km, else "3.42 km". */
export function formatMeterDistance(meters: number): string {
  const m = Math.max(0, meters);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/** Short label for the active source, used on the meter's source badge. */
export function describeMeterSource(source: MeterSource): string {
  if (source === "obd") return "OBD-II";
  if (source === "gps") return "GPS";
  return "No signal";
}
