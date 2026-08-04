/**
 * Pure vocabulary for the Meter Digital dash.
 *
 * The meter is laid out like the instrument it replaces: a status cluster in
 * the header, a TRIP STATUS panel that names what the fare is being measured
 * with, and a clock/date the driver reads at a glance. What each of those says
 * is decided here rather than in the screen, so the wording is unit-testable
 * and the screen stays a layout.
 *
 * The TRIP STATUS panel answers two different questions depending on whether a
 * hire is under way. Idle, it is a readiness report: which sensors the meter
 * could measure with (the *connection type* — GPS, the vehicle bus, or both).
 * Once a hire has started it also carries the facts that belong to that hire
 * and cannot be recovered later: the odometer the vehicle showed when the
 * passenger got in, and where that was. The same {@link MeterWaypoint} is
 * stamped again at the drop-off, and the formatters below are what the trip log
 * and the printed receipt render both ends with.
 *
 * The rule the whole file exists to keep: nothing here ever claims a source the
 * meter does not have. Demo Mode telemetry is invented, so a simulated session
 * is never counted as a vehicle link — it is reported as demo, beside whatever
 * the connection type genuinely is, the same promise `utils/taxiMeter.ts` keeps
 * by refusing to bill on it. And because the connection type names what is
 * *linked* rather than what is being *billed*, a running meter shows the billed
 * source separately (see `describeMeterSource` in utils/taxiMeter.ts).
 */

import type { MeterPeriod, MeterTariff } from "@/utils/taxiMeter";

/** How the status should be coloured. Screens map these onto their palette. */
export type MeterLinkTone = "ok" | "info" | "warn" | "bad";

/**
 * Which sensors the meter can actually measure with right now. Demo Mode is
 * not one of them — a simulator is not a vehicle.
 */
export type MeterConnectionType = "gps+obd" | "obd" | "gps" | "none";

export interface MeterConnection {
  type: MeterConnectionType;
  /** The TRIP STATUS headline, e.g. "GPS + OBD-II". */
  label: string;
  tone: MeterLinkTone;
  /**
   * True when the vehicle bus is part of the link — the screen uses it to pick
   * the glyph beside the label.
   */
  fromVehicle: boolean;
  /**
   * A simulated session is open. Never folded into `type`: it is shown beside
   * it, so invented telemetry can never read as a vehicle link.
   */
  demo: boolean;
}

export interface MeterConnectionInputs {
  /** Is the meter accruing right now? */
  running: boolean;
  /** A real, non-simulated OBD-II session is open. */
  obdLinked: boolean;
  /** A connection attempt is in flight. */
  obdConnecting: boolean;
  /** The session is the simulator — telemetry is invented. */
  obdDemo: boolean;
  /** A usable GPS fix has arrived. */
  hasGpsFix: boolean;
  /** Location permission was refused. */
  gpsDenied: boolean;
}

/**
 * The connection type the TRIP STATUS headline shows, in both states: which of
 * the two sensors the meter has, together or on their own.
 *
 * With neither, the headline becomes the reason — ordered by what the driver
 * would want to fix first, and distinguishing a refused permission from a
 * signal that simply has not arrived yet.
 */
export function describeMeterConnection(inputs: MeterConnectionInputs): MeterConnection {
  const { running, obdLinked, obdConnecting, obdDemo, hasGpsFix, gpsDenied } = inputs;

  const gps = hasGpsFix && !gpsDenied;
  // A simulated session is only "demo" while no real reader is linked; once a
  // car answers, the link is the car.
  const demo = obdDemo && !obdLinked;

  if (gps && obdLinked) {
    return { type: "gps+obd", label: "GPS + OBD-II", tone: "ok", fromVehicle: true, demo };
  }
  if (obdLinked) {
    return { type: "obd", label: "OBD-II ONLY", tone: "ok", fromVehicle: true, demo };
  }
  if (gps) {
    return { type: "gps", label: "GPS ONLY", tone: "info", fromVehicle: false, demo };
  }

  const none = { type: "none" as const, demo };
  if (gpsDenied) {
    return { ...none, label: "LOCATION OFF", tone: "bad", fromVehicle: false };
  }
  if (obdConnecting) {
    return { ...none, label: "LINKING READER", tone: "warn", fromVehicle: true };
  }
  if (demo) {
    return { ...none, label: "DEMO MODE", tone: "warn", fromVehicle: true };
  }
  if (running) {
    return { ...none, label: "NO SIGNAL", tone: "bad", fromVehicle: false };
  }
  return { ...none, label: "ACQUIRING GPS", tone: "warn", fromVehicle: false };
}

export interface MeterStartGateInputs {
  /** A real, non-simulated OBD-II session is open. */
  obdLinked: boolean;
  /** The session is the simulator. */
  obdDemo: boolean;
  /** A connection attempt is in flight. */
  obdConnecting: boolean;
  /** The last error the reader reported, if any. */
  obdError?: string | null;
}

export interface MeterStartGate {
  /** May a hire begin? */
  canStart: boolean;
  /** A link attempt is in flight — the popup shows a spinner rather than a retry. */
  connecting: boolean;
  /** Headline for the button's popup, e.g. "Connecting to the vehicle…". */
  title: string;
  /** The line under it: what is happening, or what to do about it. */
  message: string;
}

/**
 * Whether the meter may start a hire, and what to say when it may not.
 *
 * A hire begins on the vehicle link: the meter is a taxi meter, and the fare it
 * opens should be measured by the car rather than by whatever the phone can
 * see. GPS remains the fallback *during* a hire (a tunnel, a dropped dongle),
 * because a fare already running must never stop measuring — but it is not what
 * a hire opens on.
 *
 * Demo Mode is the one deliberate exception: it is admin-gated simulation, and
 * blocking it would make the screen impossible to exercise without a car. It is
 * allowed through, and told plainly that it bills on GPS.
 */
export function evaluateMeterStart(inputs: MeterStartGateInputs): MeterStartGate {
  const { obdLinked, obdDemo, obdConnecting, obdError } = inputs;

  if (obdLinked) {
    return {
      canStart: true,
      connecting: false,
      title: "Vehicle linked",
      message:
        "The OBD-II reader is answering. The meter measures the hire on the vehicle's own speed.",
    };
  }
  if (obdDemo) {
    return {
      canStart: true,
      connecting: false,
      title: "Demo Mode",
      message:
        "This is simulated telemetry, not a vehicle. The meter will start, but it bills on GPS — Demo Mode never bills a fare.",
    };
  }
  if (obdConnecting) {
    return {
      canStart: false,
      connecting: true,
      title: "Connecting to the vehicle…",
      message:
        "Linking the OBD-II reader. The hire starts by itself as soon as the vehicle answers.",
    };
  }

  const reason =
    typeof obdError === "string" && obdError.trim().length > 0
      ? `The reader could not be reached: ${obdError.trim()}`
      : "No OBD-II reader is connected";
  return {
    canStart: false,
    connecting: false,
    title: "No vehicle link",
    message: `${reason}. A hire starts on the vehicle link — connect the reader saved in Settings → OBD-II (CANBus) reader, or add one there.`,
  };
}

/**
 * What a back press means on the meter.
 *
 * - `panel` — the driver is on one of the other four tabs. Those are panels of
 *   the same instrument, not screens, so back returns to the meter.
 * - `blocked` — a fare is accruing. Leaving would abandon it, so the key is
 *   inert (and the Android hardware back is swallowed rather than popping the
 *   screen out from under a running hire).
 * - `prompt` — the meter is idle: ask where the driver is going, since leaving
 *   the console means changing mode rather than stepping back one screen.
 */
export type MeterBackAction = "panel" | "blocked" | "prompt";

export interface MeterBackInputs {
  /** Is the driver on the meter itself, rather than one of the other panels? */
  onMeterPanel: boolean;
  /** Is the meter accruing a fare right now? */
  running: boolean;
  /**
   * A hire has been ended but not yet closed — the driver is filling in the
   * end-of-hire declaration. The fare has stopped, but the hire has not been
   * written, so leaving would lose it just as surely as walking out of a
   * running one.
   */
  ending?: boolean;
}

/**
 * Resolve a back press. Panel-first: a running meter still lets the driver back
 * out of the trip log or the reader settings onto the meter — what it refuses
 * is leaving the console with a fare in progress, or with one that has stopped
 * but has not yet been declared and recorded.
 */
export function resolveMeterBack(inputs: MeterBackInputs): MeterBackAction {
  if (!inputs.onMeterPanel) return "panel";
  return inputs.running || inputs.ending === true ? "blocked" : "prompt";
}

/**
 * One end of a hire — where it began or where it finished.
 *
 * These are the facts that belong to a moment (the passenger getting in, the
 * passenger getting out) and cannot be reconstructed afterwards, so the meter
 * stamps them as they happen: the odometer the cluster was showing, and where
 * the vehicle was.
 *
 * Both readings are nullable on purpose: generic OBD-II only publishes an
 * odometer on the cars that implement PID A6, and a hire can begin before the
 * first GPS fix lands. A missing one is shown as missing, never filled in with
 * a guess.
 */
export interface MeterWaypoint {
  /** Epoch ms this end was stamped. Also the key a late answer is matched against. */
  at: number;
  /** Odometer the vehicle reported here, in km (OBD-II PID A6). */
  odometerKm: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Reverse-geocoded label for the point, once one arrives. */
  place: string | null;
}

/** A finite, non-negative number, or null. Used to sanitise stored readings. */
function finiteOrNull(value: unknown, { min = -Infinity }: { min?: number } = {}):
  | number
  | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min
    ? value
    : null;
}

/**
 * Narrow anything that claims to be a waypoint down to one, dropping readings
 * that are not usable rather than storing them.
 *
 * Records written before the meter stamped its ends have none of this, so a
 * value it cannot make sense of becomes null rather than an error — the log has
 * to keep opening on a build older than the feature.
 */
export function normalizeMeterWaypoint(value: unknown): MeterWaypoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MeterWaypoint>;
  const at = finiteOrNull(raw.at);
  if (at === null) return null;
  const place = typeof raw.place === "string" ? raw.place.trim() : "";
  const latitude = finiteOrNull(raw.latitude);
  const longitude = finiteOrNull(raw.longitude);
  return {
    at,
    odometerKm: finiteOrNull(raw.odometerKm, { min: 0 }),
    // A half fix is no fix: one coordinate on its own cannot be plotted.
    latitude: longitude === null ? null : latitude,
    longitude: latitude === null ? null : longitude,
    place: place.length > 0 ? place : null,
  };
}

/** Group the thousands of an odometer, the way the dash cluster prints it. */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * The odometer as the meter shows it, e.g. "128 450.6 km".
 *
 * A car that does not publish PID A6 has no odometer to read, and there is no
 * second source for one — so it renders as a dash rather than as a number the
 * meter made up.
 */
export function formatWaypointOdometer(km: number | null | undefined): string {
  if (typeof km !== "number" || !Number.isFinite(km) || km < 0) return "—";
  const [whole, frac] = km.toFixed(1).split(".");
  return `${groupThousands(whole)}.${frac} km`;
}

/** A fix as the meter prints it when there is no address: "3.13900, 101.68690". */
export function formatWaypointCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  if (typeof latitude !== "number" || !Number.isFinite(latitude)) return null;
  if (typeof longitude !== "number" || !Number.isFinite(longitude)) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * Where an end of the hire was: the address when the geocoder answered, the raw
 * fix when it did not, and an honest "no fix" when the meter had no position at
 * that moment at all.
 */
export function formatWaypointPlace(
  waypoint: MeterWaypoint | null | undefined,
): string {
  if (!waypoint) return "—";
  const place = waypoint.place?.trim();
  if (place) return place;
  return formatWaypointCoords(waypoint.latitude, waypoint.longitude) ?? "NO FIX";
}

/**
 * The odometer across a whole hire — "128 450.6 → 128 462.1 km" — for the log
 * row and the receipt.
 *
 * Null when neither end has a reading, so a record from a car with no odometer
 * (or from a build before the meter stamped its ends) simply has no such line
 * rather than a line full of dashes.
 */
export function formatOdometerSpan(
  from: MeterWaypoint | null | undefined,
  to: MeterWaypoint | null | undefined,
): string | null {
  const start = from?.odometerKm ?? null;
  const end = to?.odometerKm ?? null;
  if (start === null && end === null) return null;
  const startText = start === null ? "—" : formatWaypointOdometer(start).replace(" km", "");
  const endText = end === null ? "—" : formatWaypointOdometer(end).replace(" km", "");
  return `${startText} → ${endText} km`;
}

/**
 * Where the hire ran, end to end — "KLCC → Bangsar". Null only when neither end
 * was stamped at all, which is what a record from an older build looks like.
 */
export function formatPlaceSpan(
  from: MeterWaypoint | null | undefined,
  to: MeterWaypoint | null | undefined,
): string | null {
  if (!from && !to) return null;
  return `${formatWaypointPlace(from)} → ${formatWaypointPlace(to)}`;
}

export interface MeterSublineInputs {
  running: boolean;
  /** The meter has been started at least once since it was last cleared. */
  started: boolean;
  period: MeterPeriod;
  /**
   * Which of the two built-in tariffs is billing. Null when an operator's rate
   * card is — the OLD / NEW distinction is not where the fare is coming from
   * then, and naming one would name a tariff that is not being charged.
   */
  tariff: MeterTariff | null;
}

/**
 * The line under the status headline: what the meter is doing and which
 * tariff it will bill, e.g. "Meter running • Night tariff · new rates".
 */
export function describeMeterSubline(inputs: MeterSublineInputs): string {
  const { running, started, period, tariff } = inputs;
  const phase = running ? "Meter running" : started ? "Meter stopped" : "Meter idle";
  const shift = period === "night" ? "Night tariff" : "Day tariff";
  const rates = tariff === "new" ? " · new rates" : "";
  return `${phase} • ${shift}${rates}`;
}

/**
 * The unlit segments behind a value, the way a real LCD shows every digit as a
 * faint "8" whether it is lit or not.
 *
 * Digits become `8`; everything else (separators, spaces, a minus) is kept so
 * the ghost lines up character-for-character with the value drawn over it.
 */
export function segmentGhost(value: string): string {
  return value.replace(/\d/g, "8");
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** "04 AUG 2026" — the header date, in the device's local time. */
export function formatDashDate(at: Date | number = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate().toString().padStart(2, "0");
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "11:47 AM" — the header clock, in the device's local time. */
export function formatDashTime(at: Date | number = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const hours = d.getHours();
  const suffix = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${d.getMinutes().toString().padStart(2, "0")} ${suffix}`;
}
