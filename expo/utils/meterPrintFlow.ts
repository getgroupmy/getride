/**
 * What PRINT RECEIPT does — where the receipt goes, and what happens to the
 * console once it is on paper.
 *
 * Two decisions, both pure so the meter screen only owns the IO around them:
 *
 * 1. **Where the receipt goes.** A saved mini printer that this build can
 *    actually reach prints straight off the roll; with no printer saved at all
 *    the driver is taken to the setup screen rather than being handed a system
 *    dialog they didn't ask for; and a printer that is saved but whose
 *    transport this binary cannot reach (an older build) falls back to the OS
 *    print service, which is the honest answer there.
 *
 * 2. **Whether the hire is finished.** Printing the receipt is the last act of
 *    a hire: the passenger has the paper, so the console has no further use for
 *    the fare it is still showing. When the receipt that just printed is the
 *    hire the console is still holding, the fare-due card closes and the meter
 *    rolls on to the next trip — the driver is left on a meter ready to press
 *    START rather than on a total they have to clear by hand. Reprinting an
 *    older trip out of the log is not that: it must never wipe a hire the
 *    console is showing (nor, once the meter has been cleared, do anything at
 *    all).
 */

/** Where a print job is sent. */
export type MeterPrintRoute =
  /** Straight to the driver's configured mini thermal printer. */
  | "direct"
  /** No printer saved yet — take the driver to the setup screen. */
  | "setup"
  /** A printer is saved but unreachable in this build — use the OS service. */
  | "system";

export interface MeterPrintRouteInput {
  /** The driver has a printer saved on this device. */
  hasSavedPrinter: boolean;
  /** That printer's transport is linked into this binary and usable. */
  printerAvailable: boolean;
}

export function resolveMeterPrintRoute(input: MeterPrintRouteInput): MeterPrintRoute {
  if (input.hasSavedPrinter && input.printerAvailable) return "direct";
  if (!input.hasSavedPrinter) return "setup";
  return "system";
}

export interface MeterPrintFinishesHireInput {
  /** The job actually reached paper (or the OS print service completed it). */
  printed: boolean;
  /** The record that was printed. */
  tripId: string;
  /** The hire the console is still showing, or null once the meter is clear. */
  openHireTripId: string | null;
}

/**
 * Whether this print completes the hire the console is holding — i.e. whether
 * to close the fare-due card and reset the meter for the next passenger.
 */
export function meterPrintFinishesHire(input: MeterPrintFinishesHireInput): boolean {
  if (!input.printed) return false;
  if (!input.openHireTripId) return false;
  return input.openHireTripId === input.tripId;
}
