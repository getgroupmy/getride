/**
 * Pure helpers for the Wi-Fi (TCP) ELM327 link.
 *
 * Native-module-free, like `ble.ts` and `mfi.ts`, so the availability rules can
 * be unit tested and imported on web. `transports.ts` owns the actual
 * `react-native-tcp-socket` calls.
 *
 * A Wi-Fi ELM327 dongle boots its own soft-AP and exposes a raw TCP server on
 * it; the phone joins that network and opens a socket. There is no scan and no
 * pairing — the endpoint is configuration, which is why the saved reader can
 * carry a host/port and this module only has to answer "can this build open a
 * socket at all".
 */

import {
  describeMissingNativeModule,
  describeWebUnsupported,
  type AppRuntime,
} from "./availability";

/** Inputs to {@link describeWifiAvailability} — kept plain so it stays pure. */
export interface WifiAvailabilityInput {
  /** `react-native-tcp-socket` resolved as a JS module. */
  moduleInstalled: boolean;
  /** Its native side is linked into this binary (false in Expo Go). */
  nativeModuleLinked: boolean;
  platform: string;
  /** Expo Go vs. an installed binary — changes what the driver should do. */
  runtime: AppRuntime;
}

/**
 * Why the Wi-Fi transport can (or cannot) be attempted, phrased for the driver
 * rather than for a bundler.
 *
 * Which half is missing (the JS package or its linked native side) is a build
 * detail, not something a driver can act on: in an installed build both mean
 * "this binary is older than the feature", and in Expo Go both mean "use a real
 * build". So the runtime, not the missing half, decides what we say — the same
 * rule `describeBleAvailability` follows.
 *
 * Unlike Bluetooth MFi there is no platform gate beyond web: a TCP socket to
 * the dongle's soft-AP works identically on iOS and Android.
 */
export function describeWifiAvailability({
  moduleInstalled,
  nativeModuleLinked,
  platform,
  runtime,
}: WifiAvailabilityInput): { available: boolean; reason?: string; guidance?: string } {
  if (platform === "web") return describeWebUnsupported("Wi-Fi");
  if (moduleInstalled && nativeModuleLinked) return { available: true };
  return describeMissingNativeModule({
    runtime,
    transport: "Wi-Fi",
    packageName: "react-native-tcp-socket",
  });
}
