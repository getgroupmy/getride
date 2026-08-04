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
 *
 * The fare itself is driven by a {@link MeterRates} card rather than by the
 * constants below: the two built-in TEKSI tariffs are just the two cards in
 * {@link TARIFF_RATES}, and an admin-configured card (Admin → Settings → Meter
 * Digital Setting, resolved by `utils/meterSettings.ts`) is fed in the same
 * way. The constants remain the built-in defaults and the fallback the meter
 * bills on when no card has been configured anywhere.
 */

/** Fare structures, mirroring `TariffType` in utils/maps.ts. */
export type MeterTariff = "old" | "new";

/** Which sensor produced the distance for the most recent sample. */
export type MeterSource = "obd" | "gps" | "none";

/**
 * Which shift the hire is billed on. A physical TEKSI meter has a DAY/NIGHT
 * key because the night shift carries a surcharge on the whole fare; the meter
 * screen has the same two keys.
 */
export type MeterPeriod = "day" | "night";

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

// --- Night shift ---

/** First hour of the night shift (inclusive), in local time. */
export const NIGHT_START_HOUR = 0;
/** First hour back on the day shift (exclusive end of the night), local time. */
export const NIGHT_END_HOUR = 6;
/** Surcharge applied to the whole fare on the night shift: +50%. */
export const NIGHT_MULTIPLIER = 1.5;

// --- Extras ---

/** One press of the EXTRA − / + keys, in RM. */
export const EXTRA_STEP = 0.5;
/** Ceiling for extras. Keeps the extras display inside its four digits. */
export const MAX_EXTRA = 99.5;

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
  /** Billed increments beyond the flag fall (block-billed cards only). */
  units: number;
  /** Increments the distance alone would have billed (block cards only). */
  distanceUnits: number;
  /** Increments the time alone would have billed (block cards only). */
  timeUnits: number;
  /** Everything charged on top of the flag fall. */
  variable: number;
  distanceKm: number;
  durationMin: number;
}

// --- The rate card ---

/**
 * How distance is billed. `block` is what a mechanical meter does — a started
 * block costs a whole block (TEKSI: RM0.35 per 200 m) — `per_km` bills
 * continuously, and `off` bills nothing for distance at all.
 */
export type MeterDistanceMode = "block" | "per_km" | "off";

/** How time is billed. `block` is the TEKSI 36-second increment. */
export type MeterTimeMode = "block" | "per_minute" | "per_second" | "off";

/**
 * How the distance and time charges combine. `max` is the taxi-meter rule —
 * whichever is greater, never both for the same second — and `sum` adds them,
 * which is how the "new rates" structure works.
 */
export type MeterChargeMode = "max" | "sum";

/**
 * Where the variable charge starts counting: past the flag-fare distance
 * (`flag`, the classic meter) or from the moment the hire opened (`start`,
 * where the flag fare is a booking fee on top of the whole trip).
 */
export type MeterChargeFrom = "flag" | "start";

/**
 * Everything the fare depends on, in one card. The two built-in TEKSI tariffs
 * are the two entries in {@link TARIFF_RATES}; an admin-configured card comes
 * from `meterRatesOf` in `utils/meterSettings.ts` and is billed the same way.
 */
export interface MeterRates {
  /** Flag fall, in RM — what the meter shows the instant a hire opens. */
  flagFare: number;
  /** Distance the flag fare covers, in metres. */
  flagDistanceM: number;
  /** Floor under the whole fare. 0 means the flag fare is the only floor. */
  minimumFare: number;
  distanceMode: MeterDistanceMode;
  /** One distance block, in metres. */
  distanceBlockM: number;
  /** Charge for a started distance block, in RM. */
  distanceBlockCharge: number;
  perKmCharge: number;
  timeMode: MeterTimeMode;
  /** One time block, in seconds. */
  timeBlockS: number;
  /** Charge for a started time block, in RM. */
  timeBlockCharge: number;
  perMinuteCharge: number;
  perSecondCharge: number;
  chargeMode: MeterChargeMode;
  chargeFrom: MeterChargeFrom;
}

/** The two built-in TEKSI tariffs, as rate cards. */
export const TARIFF_RATES: Record<MeterTariff, MeterRates> = {
  old: {
    flagFare: FLAG_FALL,
    flagDistanceM: FLAG_FALL_DISTANCE_M,
    minimumFare: 0,
    distanceMode: "block",
    distanceBlockM: INCREMENT_DISTANCE_M,
    distanceBlockCharge: INCREMENT_CHARGE,
    perKmCharge: NEW_TARIFF_PER_KM,
    timeMode: "block",
    timeBlockS: INCREMENT_TIME_MS / 1000,
    timeBlockCharge: INCREMENT_CHARGE,
    perMinuteCharge: NEW_TARIFF_PER_MIN,
    perSecondCharge: 0,
    chargeMode: "max",
    chargeFrom: "flag",
  },
  new: {
    flagFare: FLAG_FALL,
    flagDistanceM: FLAG_FALL_DISTANCE_M,
    minimumFare: 0,
    distanceMode: "per_km",
    distanceBlockM: INCREMENT_DISTANCE_M,
    distanceBlockCharge: INCREMENT_CHARGE,
    perKmCharge: NEW_TARIFF_PER_KM,
    timeMode: "per_minute",
    timeBlockS: INCREMENT_TIME_MS / 1000,
    timeBlockCharge: INCREMENT_CHARGE,
    perMinuteCharge: NEW_TARIFF_PER_MIN,
    perSecondCharge: 0,
    chargeMode: "sum",
    chargeFrom: "start",
  },
};

export interface MeterFareOptions {
  tariff?: MeterTariff;
  /** Surge/peak multiplier applied to the whole fare. */
  multiplier?: number;
  /**
   * The rate card to bill on. Defaults to the built-in card for `tariff`, so
   * every existing caller keeps the fare it had.
   */
  rates?: MeterRates;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A positive, finite number, or `fallback`. Guards a configured divisor. */
function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** A finite, non-negative number, or 0. Guards a configured charge. */
function charge(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whether `at` falls on the night shift, in the device's local time.
 *
 * Written to survive the window being moved: a shift that wraps past midnight
 * (say 22:00 → 06:00) is handled by the second branch. The window itself is
 * configurable, because the night shift is not the same hours everywhere.
 */
export function isNightPeriod(
  at: Date | number = Date.now(),
  window: { startHour?: number; endHour?: number } = {},
): boolean {
  const d = at instanceof Date ? at : new Date(at);
  const hour = d.getHours();
  if (!Number.isFinite(hour)) return false;
  const start = Number.isFinite(window.startHour) ? (window.startHour as number) : NIGHT_START_HOUR;
  const end = Number.isFinite(window.endHour) ? (window.endHour as number) : NIGHT_END_HOUR;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The fare multiplier the DAY / NIGHT key selects. */
export function periodMultiplier(
  period: MeterPeriod,
  nightMultiplier: number = NIGHT_MULTIPLIER,
): number {
  if (period !== "night") return 1;
  return Number.isFinite(nightMultiplier) && nightMultiplier > 0
    ? nightMultiplier
    : NIGHT_MULTIPLIER;
}

/**
 * Fare for the meter's current totals, billed on a rate card.
 *
 * Matches `calculateFare` in utils/maps.ts, with one deliberate improvement:
 * a `chargeFrom: "flag"` card's time blocks are billed from the time actually
 * accrued after the flag-fare distance (`chargeableMs`) rather than a
 * proportional estimate, because a live meter knows it exactly.
 */
export function computeMeterFare(
  state: MeterState,
  options: MeterFareOptions = {},
): MeterFare {
  const { tariff = "old", multiplier = 1 } = options;
  const rates = options.rates ?? TARIFF_RATES[tariff] ?? TARIFF_RATES.old;

  const distanceM = Math.max(0, state.distanceM);
  const distanceKm = distanceM / 1000;
  const elapsedMs = Math.max(0, state.elapsedMs);
  const durationMin = elapsedMs / 60_000;

  // What the variable charge is measured over. On a `flag` card that is the
  // distance and the time past the flag fare; on a `start` card it is the whole
  // hire, with the flag fare riding on top.
  const billedM =
    rates.chargeFrom === "start"
      ? distanceM
      : Math.max(0, distanceM - Math.max(0, rates.flagDistanceM));
  const billedMs =
    rates.chargeFrom === "start" ? elapsedMs : Math.max(0, state.chargeableMs);

  let distanceUnits = 0;
  let distanceCharge = 0;
  if (rates.distanceMode === "block") {
    distanceUnits = Math.ceil(billedM / positive(rates.distanceBlockM, INCREMENT_DISTANCE_M));
    distanceCharge = distanceUnits * charge(rates.distanceBlockCharge);
  } else if (rates.distanceMode === "per_km") {
    distanceCharge = (billedM / 1000) * charge(rates.perKmCharge);
  }

  let timeUnits = 0;
  let timeCharge = 0;
  if (rates.timeMode === "block") {
    timeUnits = Math.ceil(billedMs / (positive(rates.timeBlockS, 36) * 1000));
    timeCharge = timeUnits * charge(rates.timeBlockCharge);
  } else if (rates.timeMode === "per_minute") {
    timeCharge = (billedMs / 60_000) * charge(rates.perMinuteCharge);
  } else if (rates.timeMode === "per_second") {
    timeCharge = (billedMs / 1000) * charge(rates.perSecondCharge);
  }

  const variable =
    rates.chargeMode === "sum"
      ? distanceCharge + timeCharge
      : Math.max(distanceCharge, timeCharge);
  const units =
    rates.chargeMode === "sum" ? distanceUnits + timeUnits : Math.max(distanceUnits, timeUnits);

  const flagFare = charge(rates.flagFare);
  // The floor is on the metered fare, before the shift multiplier — a night
  // surcharge lifts the minimum with everything else.
  const metered = Math.max(flagFare + variable, charge(rates.minimumFare));

  return {
    total: round2(metered * multiplier),
    flagFall: round2(flagFare * multiplier),
    units,
    distanceUnits,
    timeUnits,
    variable: round2(variable * multiplier),
    distanceKm,
    durationMin,
  };
}

/**
 * Move the extras total by `steps` presses of the − / + keys.
 *
 * Extras are the charges the meter cannot measure — booking fee, luggage, a
 * toll the driver paid — so they are only ever entered by hand. Clamped to
 * [0, `max`] and rounded to sen, so no sequence of presses can put a negative
 * or unrenderable number on the display. The step and the ceiling default to
 * the built-ins and are overridden by the admin-configured rate card.
 */
export function adjustExtra(
  current: number,
  steps: number,
  bounds: { step?: number; max?: number } = {},
): number {
  const base = Number.isFinite(current) ? current : 0;
  const delta = Number.isFinite(steps) ? steps : 0;
  const step = positive(bounds.step ?? EXTRA_STEP, EXTRA_STEP);
  const max = positive(bounds.max ?? MAX_EXTRA, MAX_EXTRA);
  return round2(Math.min(max, Math.max(0, base + delta * step)));
}

/**
 * What the passenger pays: the metered fare plus everything declared on top of
 * it — keyed-in charges, an airport surcharge (see `utils/meterTripDetails.ts`).
 *
 * Any number of additions, because they are separate lines on the receipt and
 * summing them before they get here would lose which was which. Each is clamped
 * on its own, so no single bad value can pull the total below the fare.
 */
export function meterGrandTotal(fareTotal: number, ...extras: number[]): number {
  const fare = Number.isFinite(fareTotal) ? Math.max(0, fareTotal) : 0;
  const added = extras.reduce(
    (sum, value) => sum + (Number.isFinite(value) ? Math.max(0, value) : 0),
    0,
  );
  return round2(fare + added);
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

/**
 * Always "HH:MM:SS", zero-padded — the fixed-width form the meter's segment
 * display needs, where digits must not shuffle sideways as the trip crosses an
 * hour. Past 99 hours the field simply grows rather than wrapping.
 */
export function formatMeterClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Metres as the driver reads them: "740 m" below a km, else "3.42 km". */
export function formatMeterDistance(meters: number): string {
  const m = Math.max(0, meters);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/**
 * Distance for the segment display: kilometres to two decimals, unit-free,
 * because the display renders "km" as its own smaller label.
 */
export function formatMeterKm(meters: number): string {
  const m = Math.max(0, Number.isFinite(meters) ? meters : 0);
  return (m / 1000).toFixed(2);
}

/** Short label for the active source, used on the meter's source badge. */
export function describeMeterSource(source: MeterSource): string {
  if (source === "obd") return "OBD-II";
  if (source === "gps") return "GPS";
  return "No signal";
}
