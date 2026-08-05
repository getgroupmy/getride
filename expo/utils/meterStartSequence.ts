/**
 * Opening a hire on Meter Digital — the sequence a START press walks through.
 *
 * A physical taxi meter is armed before the passenger gets in: the driver picks
 * what it is measuring with, the link to the car is proved, and the odometer is
 * written down. This module is that sequence, expressed as a small state
 * machine so `app/meter-digital.tsx` stays a layout and every rule below is
 * unit-testable.
 *
 * Three steps, in this order, and none of them may be skipped:
 *
 *  1. **mode** — the driver chooses which sensors bill this hire: the vehicle
 *     bus on its own, or the bus with GPS behind it. This is a *narrowing* of
 *     what the operator's rate card already allows, never a widening: a card
 *     that bills on OBD-II only offers the single option, and a GPS-only card
 *     has taken the bus away entirely and so has no sequence at all.
 *  2. **link** — both choices bill on the vehicle, so both require the reader to
 *     be answering before a fare may open. There is no "start now, link later":
 *     a hire that opened on nothing would bill on nothing.
 *  3. **odometer** — the reading the cluster is showing at pickup (mode-01 PID
 *     A6), taken *before* the fare opens, because a hire that has already begun
 *     cannot be un-begun when the car turns out not to publish it. What happens
 *     when it does not is the card's call ({@link MeterStartSequenceInputs.allowWithoutOdometer}):
 *     a fleet can insist on the reading, or accept the dash.
 *
 * Only when all three are answered does the sequence report `ready`, which is
 * what the confirm key is gated on. Demo Mode is let through the link step as
 * the admin-gated simulation it is (the same exception `evaluateMeterStart`
 * makes), but it has no adapter to ask for an odometer — so a card that
 * requires the reading refuses a simulated hire, exactly as it refuses a car
 * that does not publish PID A6.
 */

import { formatWaypointOdometer, type MeterStartGate } from "@/utils/meterDashboard";

/** Which sensors may bill. The same shape `allowedMeterSources` returns. */
export interface MeterSources {
  obd: boolean;
  gps: boolean;
}

/**
 * What the driver picks when a hire opens.
 *
 * Both bill on the vehicle bus — that is what makes this a taxi meter rather
 * than a phone tracking a car — and they differ in what happens when the reader
 * goes quiet mid-hire: `obd` measures nothing until it comes back, `gps+obd`
 * carries on off the phone's own position.
 */
export type MeterStartMode = "obd" | "gps+obd";

export interface MeterStartModeOption {
  mode: MeterStartMode;
  /** The key's face, e.g. "OBD-II ONLY". */
  label: string;
  /** The line under it: what this choice means to the fare. */
  detail: string;
}

const MODE_OPTIONS: Record<MeterStartMode, MeterStartModeOption> = {
  obd: {
    mode: "obd",
    label: "OBD-II ONLY",
    detail:
      "Bills on the vehicle's own speed. If the reader goes quiet the meter stops measuring — it never falls back to GPS.",
  },
  "gps+obd": {
    mode: "gps+obd",
    label: "OBD-II + GPS",
    detail:
      "Bills on the vehicle's own speed, with GPS taking over whenever the reader goes quiet mid-hire.",
  },
};

/**
 * The choices this rate card leaves the driver.
 *
 * The card is the ceiling: an `obd` card offers only the single mode (there is
 * no GPS to fall back to), and a `gps` card offers none at all — with the bus
 * ruled out there is no vehicle link to open a hire on, and the meter's
 * GPS-only path governs instead.
 */
export function meterStartModeOptions(sources: MeterSources): MeterStartModeOption[] {
  if (!sources.obd) return [];
  return sources.gps ? [MODE_OPTIONS["gps+obd"], MODE_OPTIONS.obd] : [MODE_OPTIONS.obd];
}

/** The sensors a chosen mode bills on. */
export function meterStartModeSources(mode: MeterStartMode): MeterSources {
  return { obd: true, gps: mode === "gps+obd" };
}

/**
 * The sensors actually in force: the card's permission narrowed by the driver's
 * choice.
 *
 * Intersection, never union — a driver may take a sensor away for a hire (the
 * "OBD-II only" key) but may never hand one back that the operator's card has
 * already ruled out.
 */
export function meterSourcesForMode(
  cardSources: MeterSources,
  mode: MeterStartMode | null,
): MeterSources {
  if (!mode) return cardSources;
  const picked = meterStartModeSources(mode);
  return { obd: cardSources.obd && picked.obd, gps: cardSources.gps && picked.gps };
}

/** How the mode reads on the console's status line. */
export function describeMeterStartMode(mode: MeterStartMode | null): string {
  if (!mode) return "GPS";
  return mode === "obd" ? "OBD-II ONLY" : "OBD-II + GPS";
}

/** Where the pickup odometer read has got to. */
export type MeterOdometerStatus = "idle" | "reading" | "captured" | "unavailable";

export interface MeterOdometerCapture {
  status: MeterOdometerStatus;
  /** The reading in km, once one has arrived. */
  km: number | null;
}

/** Nothing asked for yet — what a fresh START press starts from. */
export const IDLE_ODOMETER: MeterOdometerCapture = { status: "idle", km: null };

export type MeterStartStep = "mode" | "link" | "odometer" | "ready";

export interface MeterStartSequenceInputs {
  /** What the operator's rate card allows (`allowedMeterSources`). */
  sources: MeterSources;
  /** What the driver has chosen so far, if anything. */
  mode: MeterStartMode | null;
  /** A real, non-simulated OBD-II session is open. */
  obdLinked: boolean;
  /** The session is the simulator — admin-gated, and let through the link. */
  obdDemo: boolean;
  /** Does this card read the odometer at all (`meterReadsOdometer`)? */
  readsOdometer: boolean;
  /** May a hire open when the car reports no odometer? */
  allowWithoutOdometer: boolean;
  /** Where the pickup reading has got to. */
  odometer: MeterOdometerCapture;
  /**
   * The link gate's own wording, so the "connecting…" / "no reader" / "the
   * reader could not be reached" copy has exactly one author
   * (`evaluateMeterStart`).
   */
  gate: Pick<MeterStartGate, "title" | "message" | "connecting">;
}

export interface MeterStartSequence {
  step: MeterStartStep;
  /**
   * The mode in force — the driver's choice, or the single option when the card
   * leaves no choice to make. Null while the choice is still open, and on a
   * GPS-only card, which has no mode.
   */
  mode: MeterStartMode | null;
  /** The choices to draw at the `mode` step. */
  options: MeterStartModeOption[];
  /** The screen should ask the reader for the odometer now. */
  shouldRead: boolean;
  /** A link attempt is in flight — the step shows a spinner, not a retry. */
  connecting: boolean;
  /** May the hire open? Only ever true at `ready`. */
  canStart: boolean;
  title: string;
  message: string;
  /** The pickup odometer as the popup prints it, or null when there is none. */
  odometerText: string | null;
}

const NO_OPTIONS: MeterStartModeOption[] = [];

/**
 * Where the START press has got to, and what to say about it.
 *
 * Pure: the screen owns the reader, the popup and the clock, and asks this what
 * to draw and whether the confirm key is live.
 */
export function resolveMeterStartSequence(
  inputs: MeterStartSequenceInputs,
): MeterStartSequence {
  const { obdLinked, obdDemo, readsOdometer, allowWithoutOdometer, odometer, gate } =
    inputs;
  const options = meterStartModeOptions(inputs.sources);

  // A GPS-only card has no bus: no choice to offer, no link to wait for and no
  // odometer to read. The meter's GPS gate governs such a hire on its own.
  if (options.length === 0) {
    return {
      step: "ready",
      mode: null,
      options: NO_OPTIONS,
      shouldRead: false,
      connecting: false,
      canStart: true,
      title: "GPS only",
      message:
        "This rate card bills on GPS only. The hire opens on the phone's own position.",
      odometerText: null,
    };
  }

  // One option is not a choice: a card that bills on the vehicle bus alone has
  // already made it, so the driver is told what is in force rather than asked.
  const mode = inputs.mode ?? (options.length === 1 ? options[0].mode : null);
  if (mode === null) {
    return {
      step: "mode",
      mode: null,
      options,
      shouldRead: false,
      connecting: false,
      canStart: false,
      title: "How is this hire billed?",
      message:
        "Both choices measure the fare on the vehicle's own speed, so the reader has to be connected either way. Pick what happens if it goes quiet.",
      odometerText: null,
    };
  }

  // --- The vehicle link. Neither choice can bill without it.
  if (!obdLinked && !obdDemo) {
    return {
      step: "link",
      mode,
      options,
      shouldRead: false,
      connecting: gate.connecting,
      canStart: false,
      title: gate.title,
      message: gate.message,
      odometerText: null,
    };
  }

  // --- The pickup odometer.
  const base = { mode, options, connecting: false } as const;

  if (!readsOdometer) {
    return {
      ...base,
      step: "ready",
      shouldRead: false,
      canStart: true,
      title: "Ready to start",
      message:
        "This rate card does not read the vehicle's odometer, so the hire opens without one.",
      odometerText: null,
    };
  }

  if (odometer.status === "idle" || odometer.status === "reading") {
    return {
      ...base,
      step: "odometer",
      shouldRead: odometer.status === "idle",
      canStart: false,
      title: "Reading the odometer…",
      message:
        "Asking the vehicle what the cluster is showing (mode-01 PID A6). It is stamped on the pickup so the receipt carries the mileage the hire began at.",
      odometerText: null,
    };
  }

  if (odometer.status === "unavailable") {
    return {
      ...base,
      step: "odometer",
      shouldRead: false,
      canStart: allowWithoutOdometer,
      title: "Odometer not reported",
      message: obdDemo
        ? allowWithoutOdometer
          ? "Demo Mode has no vehicle to ask, so there is no pickup odometer. The hire may still open — the receipt shows a dash rather than a mileage the meter invented."
          : "Demo Mode has no vehicle to ask, and this rate card requires the odometer before a hire may open. Connect a real reader, or ask an administrator to allow starting without it."
        : allowWithoutOdometer
          ? "This vehicle did not answer with an odometer (mode-01 PID A6) — plenty of cars do not publish one. The hire may still open; the receipt shows a dash rather than a mileage the meter invented."
          : "This vehicle did not answer with an odometer (mode-01 PID A6), and this rate card requires one before a hire may open. Try the reading again, or ask an administrator to allow starting without it.",
      odometerText: null,
    };
  }

  return {
    ...base,
    step: "ready",
    shouldRead: false,
    canStart: true,
    title: "Ready to start",
    message:
      "The pickup odometer is stamped and the vehicle is answering. Starting opens the fare.",
    odometerText: formatWaypointOdometer(odometer.km),
  };
}
