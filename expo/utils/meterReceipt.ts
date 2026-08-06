/**
 * The meter's receipt — what comes off the roll at the end of a hire.
 *
 * There is no dedicated thermal-printer driver in this build, so the receipt
 * is rendered as HTML and handed to the platform print service (`expo-print`
 * on native, the browser's print dialog on web). That reaches any AirPrint /
 * Google Cloud Print / Bluetooth printer the OS already knows about, which is
 * the honest capability: the meter can print, it just does not own the printer.
 *
 * Building the document is pure so its contents can be asserted in a test —
 * particularly the rules that a night-shift fare says so on the paper, and that
 * every charge above the metered fare (keyed-in tolls, an airport surcharge) is
 * printed on its own line rather than folded into the total.
 */

import {
  FLAG_FALL,
  NIGHT_MULTIPLIER,
  formatMeterClock,
  formatMeterDistance,
} from "@/utils/taxiMeter";
import {
  formatDashDate,
  formatDashTime,
  formatWaypointOdometer,
  formatWaypointPlace,
} from "@/utils/meterDashboard";
import { describeAirportLeg } from "@/utils/meterTripDetails";
import type { MeterTrip } from "@/utils/meterTripsStore";

export interface ReceiptBranding {
  /** Operator name across the top of the receipt. */
  title?: string;
  /** Free-text line under the title, e.g. a licence or hotline number. */
  subtitle?: string;
}

const money = (n: number) => `RM ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

/** Escape anything that reaches the HTML — plates and names are user data. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ReceiptLine {
  label: string;
  value: string;
  strong?: boolean;
}

/**
 * Which sensor the fare was actually metered on, for the footer note.
 *
 * Shared so the HTML, the plain-text copy and the thermal-printer (ESC/POS)
 * render all name the same source — a receipt must never claim OBD-II speed on
 * a fare that billed on GPS.
 */
export function receiptMeteredOnObd(trip: MeterTrip): boolean {
  return trip.obdSamples >= trip.gpsSamples && trip.obdSamples > 0;
}

/** The "Fare metered on … · N OBD / M GPS samples" footer, in plain text. */
export function meterReceiptFooterNote(trip: MeterTrip): string {
  const source = receiptMeteredOnObd(trip) ? "the vehicle's OBD-II speed" : "GPS";
  return `Fare metered on ${source} · ${trip.obdSamples} OBD / ${trip.gpsSamples} GPS samples`;
}

/** The rows of the receipt, in print order. Shared by every renderer. */
export function meterReceiptLines(trip: MeterTrip): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { label: "Date", value: formatDashDate(trip.endedAt) },
    { label: "Start", value: formatDashTime(trip.startedAt) },
    { label: "End", value: formatDashTime(trip.endedAt) },
  ];

  // Where the hire ran, and what the cluster read at each end. A record from
  // before the meter stamped its ends carries none of this, and a car that
  // publishes no odometer carries only half of it — either way the paper shows
  // what was actually recorded and no line for what was not.
  for (const end of [
    { label: "Pickup", waypoint: trip.pickup },
    { label: "Drop-off", waypoint: trip.dropoff },
  ]) {
    if (!end.waypoint) continue;
    lines.push({ label: end.label, value: formatWaypointPlace(end.waypoint) });
    if (end.waypoint.odometerKm !== null) {
      lines.push({
        label: `${end.label} odometer`,
        value: formatWaypointOdometer(end.waypoint.odometerKm),
      });
    }
  }

  lines.push(
    { label: "Distance", value: formatMeterDistance(trip.distanceM) },
    { label: "Trip time", value: formatMeterClock(trip.elapsedMs) },
    { label: "Waiting", value: formatMeterClock(trip.waitingMs) },
    {
      label: "Tariff",
      value: `${trip.tariff === "new" ? "New rates" : "Old rates"} · ${
        trip.period === "night" ? "Night" : "Day"
      }`,
    },
  );

  // The end-of-hire declaration. A record from before the meter asked has none
  // of it, and prints no line rather than a line the driver never stated.
  if (trip.pax !== null) lines.push({ label: "Passengers", value: String(trip.pax) });
  if (trip.luggage !== null) {
    lines.push({ label: "Luggage", value: String(trip.luggage) });
  }
  const airportLeg = describeAirportLeg(trip.airport);
  if (airportLeg) lines.push({ label: "Airport", value: airportLeg });

  if (trip.period === "night") {
    lines.push({
      label: "Night surcharge",
      value: `+${Math.round((NIGHT_MULTIPLIER - 1) * 100)}%`,
    });
  }
  lines.push({ label: "Flag fall", value: money(FLAG_FALL) });
  lines.push({ label: "Metered fare", value: money(trip.fare) });
  if (trip.extra > 0) {
    lines.push({ label: "Tolls & charges", value: money(trip.extra) });
  }
  if (trip.cardSurcharge > 0) {
    lines.push({ label: "Bags & passengers", value: money(trip.cardSurcharge) });
  }
  if (trip.airportSurcharge > 0) {
    lines.push({ label: "Airport surcharge", value: money(trip.airportSurcharge) });
  }
  lines.push({ label: "Total", value: money(trip.total), strong: true });
  return lines;
}

/** Plain-text receipt, for sharing or a text-only printer. */
export function buildMeterReceiptText(
  trip: MeterTrip,
  branding: ReceiptBranding = {},
): string {
  const header = [
    branding.title ?? "GET TAXI METER",
    branding.subtitle ?? null,
    trip.plate ? `Vehicle ${trip.plate}` : null,
    trip.driver ? `Driver ${trip.driver}` : null,
  ].filter(Boolean) as string[];

  const body = meterReceiptLines(trip).map((l) => `${l.label}: ${l.value}`);
  return [...header, "", ...body, "", "Thank you for riding."].join("\n");
}

/** Printable receipt sized for an 80 mm roll, and readable on A4 too. */
export function buildMeterReceiptHtml(
  trip: MeterTrip,
  branding: ReceiptBranding = {},
): string {
  const title = escapeHtml(branding.title ?? "GET TAXI METER");
  const subtitle = branding.subtitle ? escapeHtml(branding.subtitle) : null;
  const rows = meterReceiptLines(trip)
    .map(
      (l) =>
        `<tr class="${l.strong ? "total" : ""}"><td class="l">${escapeHtml(
          l.label,
        )}</td><td class="v">${escapeHtml(l.value)}</td></tr>`,
    )
    .join("");

  const meta = [
    trip.plate ? `Vehicle ${escapeHtml(trip.plate)}` : null,
    trip.driver ? `Driver ${escapeHtml(trip.driver)}` : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} receipt</title>
<style>
  @page { margin: 8mm; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0 auto; max-width: 320px; padding: 12px; }
  h1 { font-size: 15px; letter-spacing: 1px; text-align: center; margin: 0 0 2px; text-transform: uppercase; }
  .sub { font-size: 11px; text-align: center; color: #555; margin: 0 0 2px; }
  .meta { font-size: 11px; text-align: center; color: #555; margin: 0 0 10px; }
  hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 3px 0; }
  td { vertical-align: top; }
  td.l { white-space: nowrap; padding-right: 8px; }
  /* An address is the one value that will not fit an 80 mm roll on one line:
     it wraps inside its own cell rather than pushing the column off the paper. */
  td.v { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  tr.total td { font-size: 15px; font-weight: 700; padding-top: 8px; border-top: 1px solid #111; }
  .foot { font-size: 10px; color: #666; text-align: center; margin-top: 10px; }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<p class="sub">${subtitle}</p>` : ""}
  ${meta ? `<p class="meta">${meta}</p>` : ""}
  <hr />
  <table>${rows}</table>
  <hr />
  <p class="foot">Fare metered on ${
    receiptMeteredOnObd(trip) ? "the vehicle&rsquo;s OBD-II speed" : "GPS"
  } &middot; ${trip.obdSamples} OBD / ${trip.gpsSamples} GPS samples</p>
  <p class="foot">Thank you for riding.</p>
</body>
</html>`;
}
