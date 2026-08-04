/**
 * Pure vocabulary for the Meter Digital dash.
 *
 * The meter is laid out like the instrument it replaces: a status cluster in
 * the header, a TRIP STATUS panel that names what the fare is being measured
 * with, and a clock/date the driver reads at a glance. What each of those says
 * is decided here rather than in the screen, so the wording is unit-testable
 * and the screen stays a layout.
 *
 * The rule the whole file exists to keep: the panel never claims a source the
 * meter is not actually billing on. Demo Mode telemetry is invented, so a
 * simulated link reads as "demo", never as a vehicle link — the same promise
 * `utils/taxiMeter.ts` keeps by refusing to bill on it.
 */

import type { MeterPeriod, MeterSource, MeterTariff } from "@/utils/taxiMeter";

/** How the status should be coloured. Screens map these onto their palette. */
export type MeterLinkTone = "ok" | "info" | "warn" | "bad";

export interface MeterLinkStatus {
  /** The TRIP STATUS headline, e.g. "GPS CONNECTED". */
  label: string;
  tone: MeterLinkTone;
  /**
   * True when the headline is about the vehicle bus rather than satellites —
   * the screen uses it to pick the glyph beside the label.
   */
  fromVehicle: boolean;
}

export interface MeterLinkInputs {
  /** Is the meter accruing right now? */
  running: boolean;
  /** Source the last accepted sample actually billed on. */
  source: MeterSource;
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
 * What the TRIP STATUS panel says.
 *
 * While the meter runs, the answer is simply which source produced the last
 * sample — that is the source being billed, so nothing else may be shown.
 * While it is idle the panel is a readiness report instead, ordered by what
 * the driver would want to fix first.
 */
export function describeMeterLink(inputs: MeterLinkInputs): MeterLinkStatus {
  const {
    running,
    source,
    obdLinked,
    obdConnecting,
    obdDemo,
    hasGpsFix,
    gpsDenied,
  } = inputs;

  if (running) {
    if (source === "obd") {
      return { label: "OBD-II CONNECTED", tone: "ok", fromVehicle: true };
    }
    if (source === "gps") {
      return { label: "GPS CONNECTED", tone: "info", fromVehicle: false };
    }
    return gpsDenied
      ? { label: "LOCATION OFF", tone: "bad", fromVehicle: false }
      : { label: "NO SIGNAL", tone: "bad", fromVehicle: false };
  }

  if (obdConnecting) {
    return { label: "LINKING READER", tone: "warn", fromVehicle: true };
  }
  if (obdLinked) {
    return { label: "OBD-II READY", tone: "ok", fromVehicle: true };
  }
  if (gpsDenied) {
    return { label: "LOCATION OFF", tone: "bad", fromVehicle: false };
  }
  if (obdDemo) {
    return { label: "DEMO MODE", tone: "warn", fromVehicle: true };
  }
  if (hasGpsFix) {
    return { label: "GPS CONNECTED", tone: "info", fromVehicle: false };
  }
  return { label: "ACQUIRING GPS", tone: "warn", fromVehicle: false };
}

export interface MeterSublineInputs {
  running: boolean;
  /** The meter has been started at least once since it was last cleared. */
  started: boolean;
  period: MeterPeriod;
  tariff: MeterTariff;
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
