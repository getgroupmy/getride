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
 * in a portrait viewport — it does not render at all. The console is replaced
 * by the "turn your device" notice until the viewport is actually landscape,
 * and that stays true every time the screen is returned to: coming back from
 * another page re-asks for the pin and re-checks the viewport, so a device that
 * rotated back to portrait while it was away meets the notice again rather than
 * a meter laid out for a shape it is not being held in.
 *
 * The maths for "is this viewport landscape", "may the console draw" and
 * "should we be asking them to rotate" lives here, native-module free, so it
 * stays unit testable.
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

/** What a landscape-only screen may put on the glass right now. */
export type OrientationGate =
  /** Landscape: draw the screen. */
  | "ready"
  /**
   * Portrait, and the device is not going to turn itself: draw the notice
   * *instead of* the screen — never over it, and never a stacked-up portrait
   * rendering of a console that is read at a glance from a dash mount.
   */
  | "rotate"
  /**
   * Portrait, but the pin has not reported back yet — the device may be mid
   * turn. Draw neither: the console would be laid out for the wrong shape, and
   * the notice would flash for one frame on a screen that is already rotating.
   */
  | "waiting";

/**
 * What to draw, from the lock's state and the viewport it produced.
 *
 * The viewport is the authority, not the lock: `locked` only means the OS
 * accepted the request, so the console draws when — and only when — the glass
 * is actually landscape. That is what makes the gate survive navigation. The
 * lock state is re-asked for on every focus, so a return from another page
 * starts at `waiting` and settles into `ready` or `rotate` on its own.
 */
export function resolveOrientationGate(
  state: OrientationLockState,
  width: number,
  height: number,
): OrientationGate {
  if (isLandscapeSize(width, height)) return "ready";
  return state === "pending" ? "waiting" : "rotate";
}

/**
 * Whether to show the "turn your device" notice.
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
  return resolveOrientationGate(state, width, height) === "rotate";
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
