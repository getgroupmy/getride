/**
 * Leaving the app itself — the "EXIT" key on the taxi meter's leave popup.
 *
 * A fleet whose drivers never ride as passengers on the shift phone configures
 * that key to close the app rather than open passenger mode
 * (`utils/meterLeave.ts`). Closing is *not* signing out: the session is left
 * exactly where it was, so the next launch comes straight back to the console.
 *
 * **Android only, by decision.** `BackHandler.exitApp()` finishes the activity
 * and the driver is back on the home screen — sanctioned, and it works in every
 * build.
 *
 * iOS has no public API for this at all. The routes that exist are `exit(0)`
 * (which App Review can treat as a crash) and the private `suspend` selector;
 * Apple's HIG asks apps not to terminate themselves, and this operator chose not
 * to carry that risk for one key. So the iPhone answer is deliberate rather than
 * missing: the console tells the driver to swipe up
 * (`describeMeterExit`), which leaves them signed in exactly as the setting
 * promises. The web build cannot close a tab it did not open either.
 *
 * If that decision is ever revisited it is a native module plus a new build —
 * not an OTA update — and `describeMeterExit`'s second argument is the seam it
 * would come back through.
 */

import { BackHandler, Platform } from "react-native";

/**
 * Can this build put the driver back on the home screen?
 *
 * Android can. Nothing else does, on purpose — see the file header.
 */
export function canLeaveApp(): boolean {
  return Platform.OS === "android";
}

/**
 * Close the app, leaving the session signed in. True when it is on its way out.
 *
 * Returns false rather than throwing where the platform has no way to do it, so
 * the caller can say so instead.
 */
export function leaveApp(): boolean {
  if (!canLeaveApp()) return false;
  BackHandler.exitApp();
  return true;
}
