/**
 * Meter Digital settings — the admin-configured card the taxi meter runs on.
 *
 * Everything `app/meter-digital.tsx` is *told* rather than decides for itself
 * lives in one profile: which sensors it may bill on, whether a hire may open
 * without an odometer reading, which of the five console panels are shown and
 * which of those may be tapped, and the rate card (flag fare, distance charge,
 * time charge, night surcharge, luggage/passenger extras).
 *
 * Profiles are scoped the way commission rates are: one `master` card is the
 * global one, and country / state / city / suburb cards override it. The meter
 * resolves the first match, highest first:
 *
 *   suburb → city → state → country → master → the built-in TEKSI tariff
 *
 * Resolution is pure and happens on the device, because a meter has to keep
 * pricing a hire with no signal at all — the table (`meter_digital_settings`,
 * migration 0081) is the source of truth and the last fetch is cached. The IO
 * half lives in `utils/meterSettingsStore.ts`; everything here is pure and
 * tested (utils/__tests__/meterSettings.test.ts).
 *
 * The promise this file keeps is the one the rest of the meter keeps: a
 * configured value is used only when it is usable. Anything missing,
 * unparseable or out of range falls back to the built-in default rather than
 * putting a nonsense rate on a passenger's fare.
 */

import {
  EXTRA_STEP,
  MAX_EXTRA,
  NIGHT_END_HOUR,
  NIGHT_MULTIPLIER,
  NIGHT_START_HOUR,
  TARIFF_RATES,
  type MeterChargeFrom,
  type MeterChargeMode,
  type MeterDistanceMode,
  type MeterRates,
  type MeterTimeMode,
} from "@/utils/taxiMeter";

/** Scope of a profile. `master` is the single global card. */
export type MeterSettingsLevel = "master" | "country" | "state" | "city" | "suburb";

/** Resolution order, highest priority first. */
export const METER_SETTINGS_PRIORITY: MeterSettingsLevel[] = [
  "suburb",
  "city",
  "state",
  "country",
  "master",
];

/**
 * Which sensors the meter may bill on.
 *
 * `gps` forces GPS even when a reader is linked (a fleet whose dongles are not
 * trusted), `obd` refuses to bill on GPS at all (a fleet that requires the
 * vehicle's own odometer), and `gps+obd` is the meter's own priority order —
 * OBD-II while it is fresh, GPS the moment it is not.
 */
export type MeterSourceMode = "gps" | "gps+obd" | "obd";

/** The five panels of the console, in tab order. */
export type MeterPanelId = "meter" | "trips" | "printer" | "obd" | "settings";

export const METER_PANEL_IDS: MeterPanelId[] = [
  "meter",
  "trips",
  "printer",
  "obd",
  "settings",
];

/** Human labels for the panels, for the admin screen. */
export const METER_PANEL_LABELS: Record<MeterPanelId, string> = {
  meter: "Meter",
  trips: "Trip log",
  printer: "Printer Connection Status",
  obd: "OBD Connection Status",
  settings: "Settings",
};

/** Whether a panel is drawn at all, and whether its tab responds to a tap. */
export interface MeterPanelAccess {
  show: boolean;
  tap: boolean;
}

/** One resolved settings card. */
export interface MeterProfile {
  id: string;
  level: MeterSettingsLevel;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  /** Optional admin-facing name, e.g. "KL city tariff". */
  label: string | null;

  // --- Sensors ---
  sourceMode: MeterSourceMode;
  /** May a hire open before the vehicle has reported an odometer? */
  allowStartWithoutOdometer: boolean;
  /** Read the vehicle's odometer (PID A6) at each end of a hire at all. */
  readOdometer: boolean;

  // --- Console panels ---
  panels: Record<MeterPanelId, MeterPanelAccess>;

  // --- Rate card ---
  currency: string;
  rates: MeterRates;

  // --- Night shift ---
  nightMultiplier: number;
  nightStartHour: number;
  nightEndHour: number;

  // --- Extras the meter cannot measure ---
  extraLuggageCharge: number;
  freeLuggage: number;
  extraPassengerCharge: number;
  freePassengers: number;
  extraStep: number;
  maxExtra: number;

  active: boolean;
  updatedAt: string | null;
}

/**
 * The card the meter bills on when nothing has been configured anywhere: the
 * built-in TEKSI "old rates" tariff, every panel shown and tappable, both
 * sensors allowed. Applying migration 0081 seeds a master row identical to
 * this, so turning the feature on changes no fare.
 */
export const DEFAULT_METER_PROFILE: MeterProfile = {
  id: "default",
  level: "master",
  country: null,
  state: null,
  city: null,
  suburb: null,
  label: "Built-in TEKSI tariff",
  sourceMode: "gps+obd",
  allowStartWithoutOdometer: true,
  readOdometer: true,
  panels: {
    meter: { show: true, tap: true },
    trips: { show: true, tap: true },
    printer: { show: true, tap: true },
    obd: { show: true, tap: true },
    settings: { show: true, tap: true },
  },
  currency: "MYR",
  rates: { ...TARIFF_RATES.old },
  nightMultiplier: NIGHT_MULTIPLIER,
  nightStartHour: NIGHT_START_HOUR,
  nightEndHour: NIGHT_END_HOUR,
  extraLuggageCharge: 0,
  freeLuggage: 0,
  extraPassengerCharge: 0,
  freePassengers: 1,
  extraStep: EXTRA_STEP,
  maxExtra: MAX_EXTRA,
  active: true,
  updatedAt: null,
};

/** The database row, as `meter_digital_settings` stores it. */
export interface MeterSettingsRow {
  id: string;
  level: string;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  label: string | null;
  source_mode: string;
  allow_start_without_odometer: boolean;
  read_odometer: boolean;
  show_meter: boolean;
  show_trips: boolean;
  show_printer: boolean;
  show_obd: boolean;
  show_settings: boolean;
  tap_meter: boolean;
  tap_trips: boolean;
  tap_printer: boolean;
  tap_obd: boolean;
  tap_settings: boolean;
  currency: string;
  flag_fare: number | string;
  flag_distance_m: number | string;
  minimum_fare: number | string;
  distance_mode: string;
  distance_block_m: number | string;
  distance_block_charge: number | string;
  per_km_charge: number | string;
  time_mode: string;
  time_block_s: number | string;
  time_block_charge: number | string;
  per_minute_charge: number | string;
  per_second_charge: number | string;
  charge_mode: string;
  charge_from: string;
  night_multiplier: number | string;
  night_start_hour: number | string;
  night_end_hour: number | string;
  extra_luggage_charge: number | string;
  free_luggage: number | string;
  extra_passenger_charge: number | string;
  free_passengers: number | string;
  extra_step: number | string;
  max_extra: number | string;
  active: boolean;
  updated_at: string | null;
}

/** The columns every read of the table asks for. */
export const METER_SETTINGS_COLUMNS = [
  "id",
  "level",
  "country",
  "state",
  "city",
  "suburb",
  "label",
  "source_mode",
  "allow_start_without_odometer",
  "read_odometer",
  "show_meter",
  "show_trips",
  "show_printer",
  "show_obd",
  "show_settings",
  "tap_meter",
  "tap_trips",
  "tap_printer",
  "tap_obd",
  "tap_settings",
  "currency",
  "flag_fare",
  "flag_distance_m",
  "minimum_fare",
  "distance_mode",
  "distance_block_m",
  "distance_block_charge",
  "per_km_charge",
  "time_mode",
  "time_block_s",
  "time_block_charge",
  "per_minute_charge",
  "per_second_charge",
  "charge_mode",
  "charge_from",
  "night_multiplier",
  "night_start_hour",
  "night_end_hour",
  "extra_luggage_charge",
  "free_luggage",
  "extra_passenger_charge",
  "free_passengers",
  "extra_step",
  "max_extra",
  "active",
  "updated_at",
].join(", ");

// --- Coercion helpers -------------------------------------------------------
//
// Every one of these takes the default rather than throwing. A settings row is
// admin-entered and may predate a column, and a meter that refuses to price a
// hire because one field is odd is worse than one that prices it on the
// built-in default and says so.

function num(value: unknown, fallback: number, { min = 0, max = Infinity } = {}): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function int(value: unknown, fallback: number, bounds?: { min?: number; max?: number }): number {
  return Math.round(num(value, fallback, bounds));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown): string | null {
  const t = typeof value === "string" ? value.trim() : "";
  return t.length > 0 ? t : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const t = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(t) ? (t as T) : fallback;
}

const LEVELS = ["master", "country", "state", "city", "suburb"] as const;
const SOURCE_MODES = ["gps", "gps+obd", "obd"] as const;
const DISTANCE_MODES = ["block", "per_km", "off"] as const;
const TIME_MODES = ["block", "per_minute", "per_second", "off"] as const;
const CHARGE_MODES = ["max", "sum"] as const;
const CHARGE_FROMS = ["flag", "start"] as const;

/** Turn a stored row into a profile, defaulting anything unusable. */
export function normalizeMeterProfile(raw: unknown): MeterProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MeterSettingsRow>;
  if (typeof r.id !== "string" || r.id.trim().length === 0) return null;

  const d = DEFAULT_METER_PROFILE;
  const level = oneOf<MeterSettingsLevel>(r.level, LEVELS, "master");

  return {
    id: r.id,
    level,
    // A master card is global by definition — a stray place name on one would
    // silently narrow it, so the scope is cleared to match the level.
    country: level === "master" ? null : text(r.country),
    state: ["state", "city", "suburb"].includes(level) ? text(r.state) : null,
    city: ["city", "suburb"].includes(level) ? text(r.city) : null,
    suburb: level === "suburb" ? text(r.suburb) : null,
    label: text(r.label),

    sourceMode: oneOf<MeterSourceMode>(r.source_mode, SOURCE_MODES, d.sourceMode),
    allowStartWithoutOdometer: bool(
      r.allow_start_without_odometer,
      d.allowStartWithoutOdometer,
    ),
    readOdometer: bool(r.read_odometer, d.readOdometer),

    panels: {
      meter: { show: bool(r.show_meter, true), tap: bool(r.tap_meter, true) },
      trips: { show: bool(r.show_trips, true), tap: bool(r.tap_trips, true) },
      printer: { show: bool(r.show_printer, true), tap: bool(r.tap_printer, true) },
      obd: { show: bool(r.show_obd, true), tap: bool(r.tap_obd, true) },
      settings: { show: bool(r.show_settings, true), tap: bool(r.tap_settings, true) },
    },

    currency: text(r.currency) ?? d.currency,
    rates: {
      flagFare: num(r.flag_fare, d.rates.flagFare),
      flagDistanceM: int(r.flag_distance_m, d.rates.flagDistanceM),
      minimumFare: num(r.minimum_fare, d.rates.minimumFare),
      distanceMode: oneOf<MeterDistanceMode>(
        r.distance_mode,
        DISTANCE_MODES,
        d.rates.distanceMode,
      ),
      distanceBlockM: int(r.distance_block_m, d.rates.distanceBlockM, { min: 1 }),
      distanceBlockCharge: num(r.distance_block_charge, d.rates.distanceBlockCharge),
      perKmCharge: num(r.per_km_charge, d.rates.perKmCharge),
      timeMode: oneOf<MeterTimeMode>(r.time_mode, TIME_MODES, d.rates.timeMode),
      timeBlockS: int(r.time_block_s, d.rates.timeBlockS, { min: 1 }),
      timeBlockCharge: num(r.time_block_charge, d.rates.timeBlockCharge),
      perMinuteCharge: num(r.per_minute_charge, d.rates.perMinuteCharge),
      perSecondCharge: num(r.per_second_charge, d.rates.perSecondCharge),
      chargeMode: oneOf<MeterChargeMode>(r.charge_mode, CHARGE_MODES, d.rates.chargeMode),
      chargeFrom: oneOf<MeterChargeFrom>(r.charge_from, CHARGE_FROMS, d.rates.chargeFrom),
    },

    nightMultiplier: num(r.night_multiplier, d.nightMultiplier, { min: 1 }),
    nightStartHour: int(r.night_start_hour, d.nightStartHour, { min: 0, max: 23 }),
    nightEndHour: int(r.night_end_hour, d.nightEndHour, { min: 0, max: 24 }),

    extraLuggageCharge: num(r.extra_luggage_charge, d.extraLuggageCharge),
    freeLuggage: int(r.free_luggage, d.freeLuggage),
    extraPassengerCharge: num(r.extra_passenger_charge, d.extraPassengerCharge),
    freePassengers: int(r.free_passengers, d.freePassengers),
    extraStep: num(r.extra_step, d.extraStep, { min: 0.01 }),
    maxExtra: num(r.max_extra, d.maxExtra, { min: 0 }),

    active: bool(r.active, true),
    updatedAt: text(r.updated_at),
  };
}

/** The ten panel columns of a row — the console's own half of a card. */
export type MeterPanelRow = Pick<
  MeterSettingsRow,
  | "show_meter"
  | "show_trips"
  | "show_printer"
  | "show_obd"
  | "show_settings"
  | "tap_meter"
  | "tap_trips"
  | "tap_printer"
  | "tap_obd"
  | "tap_settings"
>;

/**
 * The panel flags as the row stores them.
 *
 * Split out of `meterProfileToRow` because the panels are written on their own:
 * a Show / Tap toggle in the admin editor applies live, and a narrow write of
 * these ten columns cannot carry a half-typed rate along with it.
 */
export function meterPanelsToRow(
  panels: Record<MeterPanelId, MeterPanelAccess>,
): MeterPanelRow {
  return {
    show_meter: panels.meter.show,
    show_trips: panels.trips.show,
    show_printer: panels.printer.show,
    show_obd: panels.obd.show,
    show_settings: panels.settings.show,
    tap_meter: panels.meter.tap,
    tap_trips: panels.trips.tap,
    tap_printer: panels.printer.tap,
    tap_obd: panels.obd.tap,
    tap_settings: panels.settings.tap,
  };
}

/** Turn a profile back into the row shape, for an insert or update. */
export function meterProfileToRow(
  profile: MeterProfile,
): Omit<MeterSettingsRow, "id" | "updated_at"> {
  const { rates, panels, level } = profile;
  return {
    level,
    country: level === "master" ? null : profile.country,
    state: ["state", "city", "suburb"].includes(level) ? profile.state : null,
    city: ["city", "suburb"].includes(level) ? profile.city : null,
    suburb: level === "suburb" ? profile.suburb : null,
    label: profile.label,
    source_mode: profile.sourceMode,
    allow_start_without_odometer: profile.allowStartWithoutOdometer,
    read_odometer: profile.readOdometer,
    ...meterPanelsToRow(panels),
    currency: profile.currency,
    flag_fare: rates.flagFare,
    flag_distance_m: rates.flagDistanceM,
    minimum_fare: rates.minimumFare,
    distance_mode: rates.distanceMode,
    distance_block_m: rates.distanceBlockM,
    distance_block_charge: rates.distanceBlockCharge,
    per_km_charge: rates.perKmCharge,
    time_mode: rates.timeMode,
    time_block_s: rates.timeBlockS,
    time_block_charge: rates.timeBlockCharge,
    per_minute_charge: rates.perMinuteCharge,
    per_second_charge: rates.perSecondCharge,
    charge_mode: rates.chargeMode,
    charge_from: rates.chargeFrom,
    night_multiplier: profile.nightMultiplier,
    night_start_hour: profile.nightStartHour,
    night_end_hour: profile.nightEndHour,
    extra_luggage_charge: profile.extraLuggageCharge,
    free_luggage: profile.freeLuggage,
    extra_passenger_charge: profile.extraPassengerCharge,
    free_passengers: profile.freePassengers,
    extra_step: profile.extraStep,
    max_extra: profile.maxExtra,
    active: profile.active,
  };
}

// --- Panel toggles ----------------------------------------------------------

/**
 * Flip one panel's Show or Tap flag, keeping the two flags coherent.
 *
 * Three rules, all of them the console's rather than the form's, which is why
 * they live here and not in the admin screen:
 *
 *   * the meter panel is pinned on at both ends — a console without a meter is
 *     not a meter (`validateMeterProfile` refuses to store one either),
 *   * hiding a panel takes its tap with it: a tab that isn't drawn cannot be
 *     pressed,
 *   * a hidden panel cannot be made tappable without being shown, so turning
 *     Tap on turns Show on with it.
 *
 * Returns a new record — the caller's is never mutated.
 */
export function setMeterPanelAccess(
  panels: Record<MeterPanelId, MeterPanelAccess>,
  id: MeterPanelId,
  patch: Partial<MeterPanelAccess>,
): Record<MeterPanelId, MeterPanelAccess> {
  const next: Record<MeterPanelId, MeterPanelAccess> = {
    meter: { ...panels.meter },
    trips: { ...panels.trips },
    printer: { ...panels.printer },
    obd: { ...panels.obd },
    settings: { ...panels.settings },
  };
  if (id === "meter") {
    next.meter = { show: true, tap: true };
    return next;
  }

  let { show, tap } = next[id];
  if (patch.show !== undefined) {
    show = patch.show;
    // Hiding takes the tap with it. Showing again does not hand it back: a
    // panel that was locked stays locked until Tap is turned on itself.
    if (!show) tap = false;
  }
  if (patch.tap !== undefined) {
    tap = patch.tap;
    if (tap) show = true;
  }
  next[id] = { show, tap };
  return next;
}

/**
 * Whether a panel toggle on this card can be written through on its own.
 *
 * A card that is already stored is updated in place, and the global card is
 * upserted as the single `master` row whether or not it exists yet — both take
 * effect the moment the switch moves. A brand-new override card has no row to
 * update and no scope entered yet, so its panels stay in the form until it is
 * created.
 */
export function canApplyMeterPanelLive(profile: MeterProfile): boolean {
  return profile.id.trim().length > 0 || profile.level === "master";
}

/** A blank card at `level`, seeded from the built-in defaults. */
export function createMeterProfileDraft(level: MeterSettingsLevel): MeterProfile {
  return {
    ...DEFAULT_METER_PROFILE,
    id: "",
    level,
    label: null,
    rates: { ...DEFAULT_METER_PROFILE.rates },
    panels: {
      meter: { ...DEFAULT_METER_PROFILE.panels.meter },
      trips: { ...DEFAULT_METER_PROFILE.panels.trips },
      printer: { ...DEFAULT_METER_PROFILE.panels.printer },
      obd: { ...DEFAULT_METER_PROFILE.panels.obd },
      settings: { ...DEFAULT_METER_PROFILE.panels.settings },
    },
  };
}

// --- Resolution -------------------------------------------------------------

function eqi(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** True when the card's parent scopes don't contradict the hire's geography. */
function parentsMatch(
  profile: MeterProfile,
  geo: { country?: string | null; state?: string | null; city?: string | null },
): boolean {
  if (profile.country && geo.country && !eqi(profile.country, geo.country)) return false;
  if (profile.state && geo.state && !eqi(profile.state, geo.state)) return false;
  if (profile.city && geo.city && !eqi(profile.city, geo.city)) return false;
  return true;
}

export interface ResolveMeterProfileInput {
  profiles: MeterProfile[];
  country?: string | null;
  state?: string | null;
  city?: string | null;
  suburb?: string | null;
}

export interface ResolvedMeterProfile {
  profile: MeterProfile;
  /** Which level supplied it — "default" when nothing matched at all. */
  level: MeterSettingsLevel | "default";
  /** Human-readable scope, e.g. "Suburb: Bangsar" or "Built-in tariff". */
  scope: string;
}

/**
 * The card a hire is priced on.
 *
 * Priority: suburb → city → state → country → master → the built-in tariff.
 * Inactive cards are skipped rather than blocking the level below, so
 * switching one off falls through to the next scope instead of leaving the
 * meter with nothing.
 */
export function resolveMeterProfile(
  input: ResolveMeterProfileInput,
): ResolvedMeterProfile {
  const active = (input.profiles ?? []).filter((p) => p.active);
  const geo = { country: input.country, state: input.state, city: input.city };

  const suburb = text(input.suburb);
  if (suburb) {
    const hit = active.find(
      (p) => p.level === "suburb" && eqi(p.suburb, suburb) && parentsMatch(p, geo),
    );
    if (hit) return { profile: hit, level: "suburb", scope: `Suburb: ${hit.suburb}` };
  }

  const city = text(input.city);
  if (city) {
    const hit = active.find(
      (p) => p.level === "city" && eqi(p.city, city) && parentsMatch(p, geo),
    );
    if (hit) return { profile: hit, level: "city", scope: `City: ${hit.city}` };
  }

  const state = text(input.state);
  if (state) {
    const hit = active.find(
      (p) => p.level === "state" && eqi(p.state, state) && parentsMatch(p, geo),
    );
    if (hit) return { profile: hit, level: "state", scope: `State: ${hit.state}` };
  }

  const country = text(input.country);
  if (country) {
    const hit = active.find((p) => p.level === "country" && eqi(p.country, country));
    if (hit) return { profile: hit, level: "country", scope: `Country: ${hit.country}` };
  }

  const master = active.find((p) => p.level === "master");
  if (master) return { profile: master, level: "master", scope: "Global rate card" };

  return { profile: DEFAULT_METER_PROFILE, level: "default", scope: "Built-in tariff" };
}

// --- What the profile means to the meter ------------------------------------

/**
 * Which sensors the meter may bill on under this card.
 *
 * This is a permission, not a preference: `gps+obd` leaves the meter's own
 * OBD-first priority intact, while the two single-source modes take the other
 * sensor away entirely — a card that says OBD-II only must never quietly bill
 * a fare on a phone's GPS.
 */
export function allowedMeterSources(mode: MeterSourceMode): {
  obd: boolean;
  gps: boolean;
} {
  return { obd: mode !== "gps", gps: mode !== "obd" };
}

/**
 * Whether this card reads the vehicle's odometer (mode-01 PID A6) at all.
 *
 * Two things have to be true: the card asks for the read, and the card lets the
 * meter talk to the vehicle bus in the first place — the odometer has no second
 * source, so a GPS-only card can never have one however the flag is set.
 */
export function meterReadsOdometer(profile: MeterProfile): boolean {
  return profile.readOdometer && allowedMeterSources(profile.sourceMode).obd;
}

/**
 * Whether the odometer is read *before* the fare opens, rather than chased
 * after it.
 *
 * The pickup mileage is the one reading that cannot be recovered later: by the
 * time the adapter answers, the car has already moved. So whenever there is a
 * reader on the bus to ask, the meter asks it first and opens the hire on the
 * answer — a live link is never billed from a pickup stamped with a dash that
 * fills itself in a second later. The read is a handful of milliseconds on an
 * adapter that is already answering the 1 Hz sweep, which is a fair price for a
 * receipt whose start mileage is the one the cluster actually showed.
 *
 * Without a link there is nothing to ask, so the press is not held — unless the
 * card *requires* the reading, where the missing answer is the whole point: the
 * absent read is what `meterOdometerGate` then refuses the hire on.
 *
 * `obdLinked` means a real session, never Demo Mode: a simulated odometer is a
 * number no vehicle ever reported, and the meter would rather print a dash.
 */
export function meterReadsOdometerBeforeStart(
  profile: MeterProfile,
  obdLinked: boolean,
): boolean {
  if (!meterReadsOdometer(profile)) return false;
  return obdLinked || !profile.allowStartWithoutOdometer;
}

/**
 * Whether a hire may open, as far as the *odometer* is concerned.
 *
 * The sensor the hire opens on is gated separately (`evaluateMeterStart`); this
 * is the extra condition a fleet can impose on top of it — no odometer reading,
 * no hire — so the pickup mileage on the receipt is never a blank.
 *
 * It only applies where the reading is obtainable. A card that switches the
 * read off, or that bills on GPS only and so never speaks to the bus, has no
 * way to produce an odometer: holding the hire for one would not be strictness
 * but a meter that can never be started at all.
 */
export function meterOdometerGate(
  profile: MeterProfile,
  odometerKm: number | null | undefined,
): { canStart: boolean; reason: string | null } {
  if (profile.allowStartWithoutOdometer) return { canStart: true, reason: null };
  if (!meterReadsOdometer(profile)) return { canStart: true, reason: null };
  const has = typeof odometerKm === "number" && Number.isFinite(odometerKm) && odometerKm >= 0;
  if (has) return { canStart: true, reason: null };
  return {
    canStart: false,
    reason:
      "This rate card requires the vehicle's odometer before a hire may open, and the reader has not returned one (mode-01 PID A6). Connect the reader, or ask an administrator to allow starting without it.",
  };
}

/**
 * The per-unit surcharges the meter cannot measure: luggage beyond what the
 * fare includes, and passengers beyond the free allowance.
 *
 * Rounded to sen and never negative, so it can be added straight onto the
 * hand-entered extras.
 */
export function meterExtraSurcharge(
  profile: MeterProfile,
  counts: { luggage?: number; passengers?: number },
): number {
  const luggage = Math.max(0, Math.floor(num(counts.luggage, 0)));
  const passengers = Math.max(0, Math.floor(num(counts.passengers, 0)));
  const billedBags = Math.max(0, luggage - Math.max(0, profile.freeLuggage));
  const billedSeats = Math.max(0, passengers - Math.max(0, profile.freePassengers));
  const total =
    billedBags * Math.max(0, profile.extraLuggageCharge) +
    billedSeats * Math.max(0, profile.extraPassengerCharge);
  return Math.round(total * 100) / 100;
}

/** True when this card charges anything at all for luggage or passengers. */
export function hasMeterSurcharges(profile: MeterProfile): boolean {
  return profile.extraLuggageCharge > 0 || profile.extraPassengerCharge > 0;
}

const money = (n: number, currency: string) => `${currency} ${n.toFixed(2)}`;

/**
 * The rate card in words — one line per charge, for the admin list and the
 * meter's own SETTINGS panel. Only the charges the card actually bills are
 * named, so a card with no time charge does not claim one.
 */
export function describeMeterRates(profile: MeterProfile): string[] {
  const { rates, currency } = profile;
  const lines: string[] = [];

  const flag =
    rates.flagDistanceM > 0 && rates.chargeFrom === "flag"
      ? `${money(rates.flagFare, currency)} flag fare, first ${
          rates.flagDistanceM >= 1000
            ? `${(rates.flagDistanceM / 1000).toFixed(rates.flagDistanceM % 1000 === 0 ? 0 : 2)} km`
            : `${rates.flagDistanceM} m`
        }`
      : `${money(rates.flagFare, currency)} flag fare`;
  lines.push(flag);

  if (rates.distanceMode === "block") {
    lines.push(
      `${money(rates.distanceBlockCharge, currency)} per started ${rates.distanceBlockM} m`,
    );
  } else if (rates.distanceMode === "per_km") {
    lines.push(`${money(rates.perKmCharge, currency)} per km`);
  }

  if (rates.timeMode === "block") {
    lines.push(`${money(rates.timeBlockCharge, currency)} per started ${rates.timeBlockS} s`);
  } else if (rates.timeMode === "per_minute") {
    lines.push(`${money(rates.perMinuteCharge, currency)} per minute`);
  } else if (rates.timeMode === "per_second") {
    lines.push(`${money(rates.perSecondCharge, currency)} per second`);
  }

  if (rates.distanceMode !== "off" && rates.timeMode !== "off") {
    lines.push(
      rates.chargeMode === "max"
        ? "Distance or time — whichever is greater"
        : "Distance and time added together",
    );
  }

  if (rates.minimumFare > 0) lines.push(`${money(rates.minimumFare, currency)} minimum fare`);
  if (profile.nightMultiplier > 1) {
    lines.push(
      `Night ×${profile.nightMultiplier.toFixed(2).replace(/\.?0+$/, "")} (${String(
        profile.nightStartHour,
      ).padStart(2, "0")}:00–${String(profile.nightEndHour).padStart(2, "0")}:00)`,
    );
  }
  if (profile.extraLuggageCharge > 0) {
    lines.push(
      `${money(profile.extraLuggageCharge, currency)} per bag${
        profile.freeLuggage > 0 ? ` after ${profile.freeLuggage} free` : ""
      }`,
    );
  }
  if (profile.extraPassengerCharge > 0) {
    lines.push(
      `${money(profile.extraPassengerCharge, currency)} per passenger${
        profile.freePassengers > 0 ? ` after ${profile.freePassengers}` : ""
      }`,
    );
  }
  return lines;
}

/** The scope of a card as the admin list prints it. */
export function meterProfileScopeLabel(profile: MeterProfile): string {
  switch (profile.level) {
    case "country":
      return profile.country ?? "—";
    case "state":
      return [profile.state, profile.country].filter(Boolean).join(", ") || "—";
    case "city":
      return [profile.city, profile.state].filter(Boolean).join(", ") || "—";
    case "suburb":
      return [profile.suburb, profile.city].filter(Boolean).join(", ") || "—";
    default:
      return "Global (all regions)";
  }
}

/**
 * Whether a card can be saved, and what is wrong when it cannot.
 *
 * Only the things the database cannot express are checked here: that the scope
 * carries the place names its level needs, and that the card actually bills
 * something (a rate with no flag fare, no distance charge and no time charge
 * would meter every hire at zero).
 */
export function validateMeterProfile(profile: MeterProfile): string | null {
  switch (profile.level) {
    case "country":
      if (!text(profile.country)) return "Select a country.";
      break;
    case "state":
      if (!text(profile.country)) return "Select a country.";
      if (!text(profile.state)) return "Select a state.";
      break;
    case "city":
      if (!text(profile.country)) return "Select a country.";
      if (!text(profile.state)) return "Select a state.";
      if (!text(profile.city)) return "Enter a city.";
      break;
    case "suburb":
      if (!text(profile.country)) return "Select a country.";
      if (!text(profile.state)) return "Select a state.";
      if (!text(profile.city)) return "Enter a city.";
      if (!text(profile.suburb)) return "Enter a suburb.";
      break;
    case "master":
      break;
  }

  const { rates } = profile;
  if (!(rates.flagFare >= 0)) return "Flag fare cannot be negative.";
  if (rates.distanceMode === "block" && !(rates.distanceBlockM > 0)) {
    return "A distance block must be longer than 0 m.";
  }
  if (rates.timeMode === "block" && !(rates.timeBlockS > 0)) {
    return "A time block must be longer than 0 s.";
  }
  const bills =
    rates.flagFare > 0 ||
    rates.minimumFare > 0 ||
    (rates.distanceMode === "block" && rates.distanceBlockCharge > 0) ||
    (rates.distanceMode === "per_km" && rates.perKmCharge > 0) ||
    (rates.timeMode === "block" && rates.timeBlockCharge > 0) ||
    (rates.timeMode === "per_minute" && rates.perMinuteCharge > 0) ||
    (rates.timeMode === "per_second" && rates.perSecondCharge > 0);
  if (!bills) return "This card charges nothing — every hire would meter at zero.";

  if (!profile.panels.meter.show) return "The meter panel cannot be hidden.";
  if (!profile.panels.meter.tap) return "The meter panel cannot be locked.";
  return null;
}
