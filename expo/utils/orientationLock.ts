/**
 * Pure vocabulary for "this screen only makes sense in landscape".
 *
 * Meter Digital is read at a glance from a dash mount, so it is pinned to
 * landscape while it is focused. Pinning is a native-module job, and it can
 * quietly not happen for reasons that have nothing to do with the driver:
 *
 *  - the browser (web) has no orientation lock outside fullscreen;
 *  - an installed binary built before `expo-screen-orientation` landed has no
 *    native side to call, exactly like the CANBus transports.
 *
 * When the lock does not take, the screen must not simply render sideways-ish
 * in a portrait viewport — it tells the driver to turn the device. The maths
 * for "is this viewport landscape" and "should we be asking them to rotate"
 * lives here, native-module free, so it stays unit testable.
 */

/** How the landscape pin is going, as far as the screen is concerned. */
export type OrientationLockState =
  /** The lock has been asked for but has not reported back yet. */
  | "pending"
  /** The OS accepted the landscape lock. */
  | "locked"
  /** No native module, or the platform refused the lock (web, old build). */
  | "unsupported";

/** True when the viewport is wider than it is tall. */
export function isLandscapeSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width > height;
}

/**
 * Whether to cover the screen with the "turn your device" notice.
 *
 * Never while the lock is still `pending`: on a device that is about to rotate
 * itself the first frame is always portrait, and flashing the notice for that
 * frame reads as a bug. Once the lock has reported back, a portrait viewport
 * means the rotation is not coming — either it was refused (`unsupported`) or
 * it was accepted but the platform did not honour it — and the driver is the
 * only one who can fix it.
 */
export function shouldPromptRotate(
  state: OrientationLockState,
  width: number,
  height: number,
): boolean {
  if (state === "pending") return false;
  return !isLandscapeSize(width, height);
}

/** Title + body for the rotate notice, phrased for why the lock did not take. */
export function rotateNoticeCopy(state: OrientationLockState): {
  title: string;
  body: string;
} {
  if (state === "locked") {
    return {
      title: "Turn your device sideways",
      body:
        "Meter Digital runs in landscape. Your device is still upright — if it does not rotate on its own, check that rotation lock is off in Control Centre or Quick Settings.",
    };
  }
  return {
    title: "Turn your device sideways",
    body:
      "Meter Digital runs in landscape and this build cannot rotate the screen for you. Hold the device horizontally to read the meter.",
  };
}
