/**
 * Native access to `react-native-bluetooth-classic`, kept behind its own module
 * for the same reason as `bleModule.ts`: the web build swaps it out
 * (`mfiModule.web.ts`) so a native-only package never reaches the browser
 * bundle, and the two facts the UI needs — "is the JS here" and "is the native
 * side linked into this binary" — stay separately reportable.
 *
 * The dependency is installed, so the JS always resolves. Its native side only
 * exists in a binary that was prebuilt with it: Expo Go has no
 * `RNBluetoothClassic` module at all, and a TestFlight/App Store build made
 * before the dependency shipped has neither. Both are reported up front rather
 * than surfacing as a rejected promise (or a Swift crash) mid-connect.
 *
 * Android is deliberately not linked (see `react-native.config.js`) — MFi is an
 * Apple programme, and `describeMfiAvailability` already sends Android drivers
 * to Bluetooth LE / USB before any native call is attempted.
 */

import { NativeModules, TurboModuleRegistry } from "react-native";
import { loadOptionalNativeModule } from "@/utils/nativeModuleGuard";

/**
 * The name the library registers its iOS module under — `@objc(RNBluetoothClassic)`
 * on the Swift side, and what its own `index.js` reads out of `NativeModules`.
 */
const MFI_NATIVE_MODULE = "RNBluetoothClassic";

let cache: any | null | undefined;

/**
 * The `react-native-bluetooth-classic` default export (a `BluetoothModule`
 * instance), or null when it cannot be loaded.
 *
 * The package builds that instance at import time — handing the native module
 * straight to a `NativeEventEmitter`, which iOS rejects with an invariant when
 * it is null — so the import is skipped entirely unless the native side is
 * linked, exactly as in `tcpModule.ts`, and the import that does happen runs
 * inside the guard (a try/catch alone does not survive an import-time throw;
 * see `utils/nativeModuleGuard.ts`). A load failure must degrade to "MFi
 * unavailable", never take down the screen that is only asking which transports
 * exist.
 */
export function loadMfiModule(): any | null {
  if (cache !== undefined) return cache;
  if (!isMfiNativeLinked()) {
    cache = null;
    return cache;
  }
  cache = loadOptionalNativeModule("react-native-bluetooth-classic", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-bluetooth-classic");
    return mod?.default ?? mod ?? null;
  });
  return cache;
}

/**
 * True when the classic-Bluetooth native module is linked into this binary.
 *
 * Checked both ways for the reason `bleModule.ts` documents: the app runs the
 * New Architecture, where a legacy bridge module like this one is reached
 * through the TurboModule interop and `NativeModules` is only a compatibility
 * proxy over it. A single lookup risks reporting "not in this build" in a build
 * that has it.
 */
export function isMfiNativeLinked(): boolean {
  if ((NativeModules as any)?.[MFI_NATIVE_MODULE]) return true;
  try {
    return !!TurboModuleRegistry?.get?.(MFI_NATIVE_MODULE);
  } catch {
    return false;
  }
}
