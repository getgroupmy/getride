/**
 * Native access to `react-native-ble-plx`, kept behind its own module so the
 * web build can swap it out (`bleModule.web.ts`) and never pull a native-only
 * package into the browser bundle.
 *
 * The dependency is installed, but its native side only exists in a build that
 * has been prebuilt with the config plugin — Expo Go loads the JS and has no
 * `BlePlx` native module. Both facts are reported separately so the UI can say
 * which one is missing.
 */

import { NativeModules } from "react-native";

let cache: any | null | undefined;

/** The `react-native-ble-plx` module, or null when it cannot be loaded. */
export function loadBleModule(): any | null {
  if (cache !== undefined) return cache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cache = require("react-native-ble-plx");
  } catch {
    cache = null;
  }
  return cache;
}

/** True when the BLE native module is linked into this binary. */
export function isBleNativeLinked(): boolean {
  return !!(NativeModules as any)?.BlePlx;
}
