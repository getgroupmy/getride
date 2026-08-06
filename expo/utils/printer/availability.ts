/**
 * Pure "can this build reach a printer over <transport>" vocabulary.
 *
 * Mirrors `utils/canbus/availability.ts` but with printer-facing copy, and
 * reuses the same runtime distinction: a missing native module in Expo Go means
 * "use a development build", while in an installed release it means "this binary
 * predates the driver — install a newer build". Kept native-module-free so it
 * stays unit-testable.
 */

import type { AppRuntime } from "@/utils/canbus/availability";

export interface PrinterAvailabilityInput {
  runtime: AppRuntime;
  /** Driver-facing transport name, e.g. "Bluetooth LE". */
  transport: string;
  /** npm package providing the native side, named for bug reports. */
  packageName: string;
}

export interface PrinterAvailabilityReason {
  available: false;
  reason: string;
  guidance: string;
}

/** Why a printer transport's native driver is missing, phrased per runtime. */
export function describePrinterMissingModule({
  runtime,
  transport,
  packageName,
}: PrinterAvailabilityInput): PrinterAvailabilityReason {
  if (runtime === "expo-go") {
    return {
      available: false,
      reason: "needs a development or production build (not available in Expo Go)",
      guidance:
        `Printing to a ${transport} receipt printer needs a native module that Expo Go does not ship (${packageName}). ` +
        `It works in a development build or an installed release of the app.`,
    };
  }
  return {
    available: false,
    reason: "not included in this build of the app",
    guidance:
      `This build of the app does not contain the ${transport} printer driver (${packageName}), so it cannot reach a printer. ` +
      `It was built before direct printer support was added. Install the latest build from TestFlight or the App Store, then try again.`,
  };
}

/** Web has no native transports — receipts go through the browser print dialog. */
export function describePrinterWebUnsupported(
  transport: string,
): PrinterAvailabilityReason {
  return {
    available: false,
    reason: "not supported on web",
    guidance:
      `A ${transport} printer can only be driven from the iOS or Android app. On the web preview, use the browser's print dialog instead.`,
  };
}
