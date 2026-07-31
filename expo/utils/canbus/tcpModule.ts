/**
 * Native access to `react-native-tcp-socket`, kept behind its own module for
 * the same reasons as `bleModule.ts` / `mfiModule.ts`: the web build swaps it
 * out (`tcpModule.web.ts`) so a native-only package never reaches the browser
 * bundle, and the two facts the UI needs — "is the JS here" and "is the native
 * side linked into this binary" — stay separately reportable.
 *
 * The require is guarded for a sharper reason here than for the Bluetooth
 * modules: `react-native-tcp-socket/src/Globals.js` runs
 * `new NativeEventEmitter(NativeModules.TcpSockets)` at *import* time. In a
 * binary without the native module that argument is null, which RN rejects with
 * an invariant — so an unguarded top-level import would take down the whole
 * screen that is only asking which transports exist, rather than reporting
 * Wi-Fi as unavailable.
 */

import { NativeModules, TurboModuleRegistry } from "react-native";

/**
 * The name the library registers its iOS/Android module under — every call in
 * its own `Socket.js` reads `NativeModules.TcpSockets`.
 */
const TCP_NATIVE_MODULE = "TcpSockets";

let cache: any | null | undefined;

/** The `react-native-tcp-socket` module, or null when it cannot be loaded. */
export function loadTcpModule(): any | null {
  if (cache !== undefined) return cache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-tcp-socket");
    cache = mod?.default ?? mod ?? null;
  } catch {
    cache = null;
  }
  return cache;
}

/**
 * True when the TCP socket native module is linked into this binary.
 *
 * Checked both ways for the reason `bleModule.ts` documents: the app runs the
 * New Architecture, where a legacy bridge module like this one is reached
 * through the TurboModule interop and `NativeModules` is only a compatibility
 * proxy over it. A single lookup risks reporting "not in this build" in a build
 * that has it.
 */
export function isTcpNativeLinked(): boolean {
  if ((NativeModules as any)?.[TCP_NATIVE_MODULE]) return true;
  try {
    return !!TurboModuleRegistry?.get?.(TCP_NATIVE_MODULE);
  } catch {
    return false;
  }
}
