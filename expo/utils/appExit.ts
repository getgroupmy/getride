/**
 * Leaving the app itself — the "EXIT" key on the taxi meter's leave popup.
 *
 * A fleet whose drivers never ride as passengers on the shift phone configures
 * that key to close the app rather than open passenger mode
 * (`utils/meterLeave.ts`). Closing is *not* signing out: the session is left
 * exactly where it was, so the next launch comes straight back to the console.
 *
 * The two platforms get there differently:
 *
 *   * **Android** has a sanctioned way out — `BackHandler.exitApp()` finishes
 *     the activity and the driver is back on the home screen. Nothing native to
 *     add, so it works in every build.
 *   * **iOS** has no public API for it at all. `react-native-exit-app` provides
 *     one (`exit(0)`), which lands the driver on the home screen — but its
 *     native half only exists in a binary prebuilt since the dependency landed,
 *     so the JS is loaded behind a guarded require for the same reason as the
 *     CANBus transports and `expo-screen-orientation`. The package's entry point
 *     is a TurboModule spec built on `TurboModuleRegistry.getEnforcing`, which
 *     **throws at import time** when the native module is absent — Expo Go, the
 *     web bundle, and every build made before this shipped — so an unguarded
 *     import would take the meter down rather than the app.
 *
 * Where neither path exists the caller says how to leave instead of drawing a
 * key that silently does nothing (`describeMeterExit`).
 *
 * Note for whoever ships this: Apple's HIG asks apps not to terminate
 * themselves, and App Review has been known to treat `exit(0)` as a crash. It is
 * behind an operator switch that is off by default, but it is worth knowing
 * before the next submission.
 */

import { BackHandler, Platform } from "react-native";

let cache: { exitApp?: () => void } | null | undefined;

/** The `react-native-exit-app` module, or null when it isn't in this binary. */
function loadExitModule(): { exitApp?: () => void } | null {
  if (cache !== undefined) return cache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-exit-app");
    const resolved = mod?.default ?? mod ?? null;
    cache = typeof resolved?.exitApp === "function" ? resolved : null;
  } catch (e) {
    // getEnforcing throws when the native side is missing — an older installed
    // build, Expo Go, or the web bundle. Not an error, just an answer.
    console.log("[appExit] native exit module unavailable", e);
    cache = null;
  }
  return cache ?? null;
}

/**
 * Can this build put the driver back on the home screen?
 *
 * Android always can. iOS can only where the native module was compiled in, so
 * an existing TestFlight/App Store build answers false until it is rebuilt.
 */
export function canLeaveApp(): boolean {
  if (Platform.OS === "android") return true;
  if (Platform.OS === "ios") return loadExitModule() !== null;
  return false;
}

/**
 * Close the app, leaving the session signed in. True when it is on its way out.
 *
 * Returns false rather than throwing where the platform has no way to do it, so
 * the caller can say so instead.
 */
export function leaveApp(): boolean {
  if (Platform.OS === "android") {
    BackHandler.exitApp();
    return true;
  }
  if (Platform.OS === "ios") {
    const mod = loadExitModule();
    if (!mod?.exitApp) return false;
    try {
      mod.exitApp();
      return true;
    } catch (e) {
      console.log("[appExit] exit failed", e);
      return false;
    }
  }
  return false;
}
