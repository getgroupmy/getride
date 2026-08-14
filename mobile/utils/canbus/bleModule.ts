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

import { NativeModules, TurboModuleRegistry } from "react-native";
import { loadOptionalNativeModule } from "@/utils/nativeModuleGuard";

/**
 * `react-native-ble-plx` registers its iOS/Android module under this name
 * (`NativeModules.BlePlx` is what its own `BleModule.js` reads).
 */
const BLE_NATIVE_MODULE = "BlePlx";

let cache: any | null | undefined;

/**
 * The `react-native-ble-plx` module, or null when it cannot be loaded.
 *
 * Loaded the same way as the other two transports: the package is not imported
 * unless its native module is linked, and the import runs inside the guard
 * (`utils/nativeModuleGuard.ts`) rather than a bare try/catch, which Metro
 * defeats for anything a package throws at import time. Skipping the import
 * can never disable a working build — `describeBleAvailability` already
 * requires the same linkage before it calls Bluetooth LE usable.
 */
export function loadBleModule(): any | null {
  if (cache !== undefined) return cache;
  if (!isBleNativeLinked()) {
    cache = null;
    return cache;
  }
  cache = loadOptionalNativeModule("react-native-ble-plx", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-ble-plx");
  });
  return cache;
}

/**
 * True when the BLE native module is linked into this binary.
 *
 * Checked both ways on purpose: the app runs the New Architecture, where a
 * legacy module like this one is reached through the TurboModule interop, and
 * `NativeModules` is only a compatibility proxy over it. Trusting a single
 * lookup risks reporting "Bluetooth unavailable" in a build that has it.
 */
export function isBleNativeLinked(): boolean {
  if ((NativeModules as any)?.[BLE_NATIVE_MODULE]) return true;
  try {
    return !!TurboModuleRegistry?.get?.(BLE_NATIVE_MODULE);
  } catch {
    return false;
  }
}

let managerCache: any | null | undefined;

/**
 * The one `BleManager` the whole app shares.
 *
 * `react-native-ble-plx` backs every `BleManager` with a *single* native BLE
 * client, and its own docs say to keep one instance for the app's lifetime:
 * `new BleManager()` re-creates that native client and `.destroy()` tears it
 * down — for **every** JS manager at once, not just the one the call was made
 * on. This app has two independent BLE consumers (the OBD-II reader's live
 * session and the mini receipt printer's fire-and-forget print job), so two
 * managers meant the printer's per-job `destroy()` was ripping the native
 * client out from under the reader's open session: the next command to the
 * reader (the pickup odometer read) then had no client to answer it and hung
 * until it timed out, so a trip printed a receipt could not start the next
 * hire. Sharing one manager — and never destroying it while the app lives —
 * is the fix and the library's intended usage.
 *
 * Returns null when the module can't be loaded (web, or a binary without the
 * native side), matching {@link loadBleModule}.
 */
export function getSharedBleManager(): any | null {
  if (managerCache !== undefined) return managerCache;
  const ble = loadBleModule();
  if (!ble?.BleManager) {
    managerCache = null;
    return managerCache;
  }
  try {
    managerCache = new ble.BleManager();
  } catch {
    managerCache = null;
  }
  return managerCache;
}
