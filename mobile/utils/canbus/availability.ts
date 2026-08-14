/**
 * Shared, pure vocabulary for "this transport's native driver isn't here".
 *
 * A missing native module means two very different things to a driver, and the
 * old copy only ever described one of them. In Expo Go the JS is loaded but no
 * native side exists — the fix is to use a real build. In an installed build
 * (TestFlight / App Store / dev client) a missing driver means the *binary* is
 * older than the feature: the JS bundle it was compiled with predates the
 * transport, so no amount of retrying will help until a newer build is
 * installed. Telling a TestFlight tester they are in a "preview build" sends
 * them looking for a setting that does not exist.
 *
 * Kept native-module-free so both `ble.ts` and `mfi.ts` can share it and it
 * stays unit testable.
 */

/** How this JS bundle is running, as far as native modules are concerned. */
export type AppRuntime = "expo-go" | "standalone";

export interface MissingNativeModuleInput {
  runtime: AppRuntime;
  /** Driver-facing transport name, e.g. "Bluetooth LE". */
  transport: string;
  /** npm package that provides the native side, named for bug reports. */
  packageName: string;
}

/** Short reason (list rows) plus the longer guidance an alert can show. */
export interface AvailabilityReason {
  available: false;
  reason: string;
  guidance: string;
}

/**
 * Why a transport's native driver is missing and what the driver can do about
 * it, phrased for whichever runtime they are actually in.
 */
export function describeMissingNativeModule({
  runtime,
  transport,
  packageName,
}: MissingNativeModuleInput): AvailabilityReason {
  if (runtime === "expo-go") {
    return {
      available: false,
      reason: "needs a development or production build (not available in Expo Go)",
      guidance:
        `Connecting to a real OBD-II reader over ${transport} needs a native module that Expo Go does not ship (${packageName}). ` +
        `It works in a development build or an installed release of the app.`,
    };
  }
  return {
    available: false,
    reason: "not included in this build of the app",
    guidance:
      `This build of the app does not contain the ${transport} driver (${packageName}), so it cannot reach a reader. ` +
      `It was built before ${transport} support was added. Install the latest build from TestFlight or the App Store, then try again.`,
  };
}

/** Web has no native transports at all — one shared way of saying so. */
export function describeWebUnsupported(transport: string): AvailabilityReason {
  return {
    available: false,
    reason: "not supported on web",
    guidance: `${transport} readers can only be used from the iOS or Android app, not the web preview.`,
  };
}
