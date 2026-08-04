/**
 * The end-of-hire declaration — the part of the fare the meter cannot measure.
 *
 * Distance, time and the tariff are the machine's own work (`utils/taxiMeter.ts`).
 * Four things are not, and a physical meter has a key or a printed line for each
 * of them because the driver is the only source there is:
 *
 *  - **Passengers** and **luggage** — carried on the receipt, and what a permit
 *    holder is asked for when a hire is queried.
 *  - **Tolls and other charges** — money the driver laid out or is owed (a toll,
 *    a booking fee, a bag charge). Keyed in, never measured.
 *  - **Airport pickup / drop-off** — a hire that starts or ends at an airport
 *    carries a flat {@link AIRPORT_SURCHARGE}. The meter cannot tell: a
 *    geofence would say where the car is, not whether the terminal is what the
 *    fare is for.
 *
 * So the meter asks. Ending a hire stops the fare immediately — the passenger is
 * not billed for the time it takes to answer — and then holds the record open
 * until all four are declared: a draft (this file's {@link MeterTripDetailsDraft},
 * every answer nullable) becomes the answered {@link MeterTripDetails} only once
 * nothing is missing, which is what the screen's confirm key is gated on.
 *
 * Everything here is pure and tested (utils/__tests__/meterTripDetails.test.ts).
 * The surcharge that was actually applied is frozen onto the answered form, so a
 * record always says what it charged rather than what today's constant would.
 */

import { EXTRA_STEP, MAX_EXTRA } from "@/utils/taxiMeter";

/** Which end of the hire — if either — was an airport. */
export type MeterAirport = "none" | "pickup" | "dropoff";

/**
 * Flat surcharge on a hire that begins or ends at an airport, in RM. Charged
 * once, whichever end it was: a fare only crosses the terminal rank once.
 */
export const AIRPORT_SURCHARGE = 3.0;

/** A hire carries at least one passenger, and at most a van's worth. */
export const MIN_PAX = 1;
export const MAX_PAX = 8;

/** Pieces of luggage. None is a real answer, so the floor is zero. */
export const MIN_LUGGAGE = 0;
export const MAX_LUGGAGE = 6;

/**
 * Ceiling for keyed-in charges, in RM. The same ceiling the EXTRA keys have —
 * the driver may reach the figure by typing it or by pressing − / +, and the
 * meter has one limit either way.
 */
export const MAX_CHARGES = MAX_EXTRA;

/** The form as the driver fills it in. `null` is "not answered yet". */
export interface MeterTripDetailsDraft {
  pax: number | null;
  luggage: number | null;
  /** Tolls and other charges, in RM. Zero is an answer; it needs no declaring. */
  charges: number;
  airport: MeterAirport | null;
}

/** The answered form, as it is charged, stored and printed. */
export interface MeterTripDetails {
  pax: number;
  luggage: number;
  charges: number;
  airport: MeterAirport;
  /**
   * The surcharge actually applied, in RM. Frozen here rather than re-derived
   * from {@link AIRPORT_SURCHARGE}, so a record from before a tariff change
   * still prints the money that changed hands.
   */
  airportSurcharge: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A fresh form for a hire that is ending.
 *
 * Nothing is pre-selected: the whole point of the declaration is that the driver
 * states it, and a defaulted "1 passenger, no bags" would be the meter guessing
 * on the receipt. The charges carry over from the EXTRA keys, since anything
 * already pressed in during the hire is the same money.
 */
export function createTripDetailsDraft(charges: number = 0): MeterTripDetailsDraft {
  return { pax: null, luggage: null, charges: sanitizeCharges(charges), airport: null };
}

/** Narrow a passenger count to a whole number inside the allowed range. */
export function clampPax(value: unknown): number | null {
  return clampCount(value, MIN_PAX, MAX_PAX);
}

/** Narrow a luggage count to a whole number inside the allowed range. */
export function clampLuggage(value: unknown): number | null {
  return clampCount(value, MIN_LUGGAGE, MAX_LUGGAGE);
}

function clampCount(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Narrow stored or routed input to one of the three airport answers. */
export function normalizeAirport(value: unknown): MeterAirport | null {
  return value === "pickup" || value === "dropoff" || value === "none" ? value : null;
}

/** True when this hire touched an airport at either end. */
export function isAirportLeg(airport: MeterAirport | null): boolean {
  return airport === "pickup" || airport === "dropoff";
}

/** What the airport answer costs, in RM. */
export function airportSurchargeFor(airport: MeterAirport | null): number {
  return isAirportLeg(airport) ? AIRPORT_SURCHARGE : 0;
}

/** A charges figure the meter will accept: non-negative, in sen, capped. */
export function sanitizeCharges(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return round2(Math.min(MAX_CHARGES, Math.max(0, value)));
}

/**
 * Keep a money field to what a money field may contain, as the driver types it.
 *
 * Only the *shape* is enforced here — digits, one separator, two decimals — and
 * not the ceiling: clamping mid-keystroke would rewrite "9" into something else
 * the moment a second digit landed. The value is clamped when it is read
 * ({@link chargesFromText}), which is where the limit belongs.
 */
export function sanitizeChargesText(text: string): string {
  if (typeof text !== "string") return "";
  // A comma is what half the world's keypads put under the decimal key.
  const cleaned = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  const head = whole.slice(0, 4);
  if (rest.length === 0) return head;
  return `${head}.${rest.join("").slice(0, 2)}`;
}

/** The value a keyed money field holds. Empty, or "." alone, is zero. */
export function chargesFromText(text: string): number {
  const parsed = Number.parseFloat(sanitizeChargesText(text));
  return sanitizeCharges(Number.isFinite(parsed) ? parsed : 0);
}

/** The text a money field starts with. Zero starts empty, not "0.00". */
export function chargesToText(value: number): string {
  const amount = sanitizeCharges(value);
  return amount > 0 ? amount.toFixed(2) : "";
}

/** Move keyed charges by `steps` presses of the − / + keys, same step as EXTRA. */
export function adjustCharges(current: number, steps: number): number {
  const base = sanitizeCharges(current);
  const delta = Number.isFinite(steps) ? steps : 0;
  return sanitizeCharges(base + delta * EXTRA_STEP);
}

/** What is still unanswered, in the order the form asks it. Empty when done. */
export function missingTripDetails(draft: MeterTripDetailsDraft): string[] {
  const missing: string[] = [];
  if (clampPax(draft.pax) === null) missing.push("passengers");
  if (clampLuggage(draft.luggage) === null) missing.push("luggage");
  if (normalizeAirport(draft.airport) === null) missing.push("airport");
  return missing;
}

/** May the hire be closed? Only once every question has an answer. */
export function isTripDetailsComplete(draft: MeterTripDetailsDraft): boolean {
  return missingTripDetails(draft).length === 0;
}

/** The line under a disabled confirm key: what the driver still has to answer. */
export function describeMissingTripDetails(
  draft: MeterTripDetailsDraft,
): string | null {
  const missing = missingTripDetails(draft);
  if (missing.length === 0) return null;
  return `Still to declare: ${missing.join(" · ")}`;
}

/**
 * Freeze an answered form. Null while anything is missing — the caller cannot
 * accidentally charge a hire that was never fully declared.
 */
export function resolveTripDetails(
  draft: MeterTripDetailsDraft,
): MeterTripDetails | null {
  const pax = clampPax(draft.pax);
  const luggage = clampLuggage(draft.luggage);
  const airport = normalizeAirport(draft.airport);
  if (pax === null || luggage === null || airport === null) return null;
  return {
    pax,
    luggage,
    airport,
    charges: sanitizeCharges(draft.charges),
    airportSurcharge: airportSurchargeFor(airport),
  };
}

/** "Airport pickup" / "Airport drop-off", or null for a hire that touched neither. */
export function describeAirportLeg(airport: MeterAirport | null): string | null {
  if (airport === "pickup") return "Airport pickup";
  if (airport === "dropoff") return "Airport drop-off";
  return null;
}

/**
 * The occupancy line — "2 pax · 1 bag". Null when neither count was declared,
 * which is what a record written before the meter asked looks like: no line, in
 * place of a line of dashes.
 */
export function formatPaxLuggage(
  pax: number | null | undefined,
  luggage: number | null | undefined,
): string | null {
  const people = clampPax(pax);
  const bags = clampLuggage(luggage);
  if (people === null && bags === null) return null;
  const parts: string[] = [];
  if (people !== null) parts.push(`${people} pax`);
  if (bags !== null) parts.push(bags === 0 ? "no luggage" : `${bags} bag${bags === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
