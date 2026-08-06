/**
 * Pins the focused screen to landscape and keeps it pinned.
 *
 * The lock is held only while the screen is focused: navigating away (or back)
 * hands rotation straight back to the app default, so no other screen inherits
 * a landscape-only device. Coming *back* is the other half of that — focus runs
 * again and the pin is re-requested. See `utils/orientationLock.ts` for what the
 * returned state means and `utils/screenOrientation.ts` for the guarded native
 * call.
 *
 * The pin is *asked for more than once*, because one accepted request is not
 * the same as a device that turned. A screen reached by `replace` — which is
 * how the launch buffer opens the meter — asks for the lock in the middle of a
 * stack transition, and iOS drops a geometry update requested by a view
 * controller that is not settled in the window hierarchy yet: `lockAsync`
 * resolves, nothing rotates, and the driver is left reading a console laid out
 * for a shape they are not holding.
 *
 * So the pin is not a one-off that gives up — it is **held for as long as the
 * screen is focused**. Three things drive it:
 *
 *  - an opening burst (`LOCK_BURST_ATTEMPTS`, `LOCK_SETTLE_MS` apart) for the
 *    mid-transition case, where the request is dropped and re-asking from a
 *    settled screen is what fixes it;
 *  - a slow re-assert (`LOCK_REASSERT_MS`) that keeps running for as long as
 *    the glass reads portrait, since a dropped geometry update changes nothing
 *    and so raises no event to react to;
 *  - the two signals that *do* fire — the viewport changing (the driver turned
 *    the phone, or the OS let the lock go) and the app coming back to the
 *    foreground, which can release it.
 *
 * The loop deliberately costs nothing in the normal case: while the viewport is
 * landscape there is no timer and no native call, and it only starts again if
 * the glass goes back to portrait. It also stops for good the moment
 * `lockLandscape` reports there is no lock to ask for (the web build, a binary
 * older than the native module) — that answer is cached and will never change,
 * so re-asking would spin forever for nothing.
 *
 * `forceRotate` is the same sequence on demand, from the top.
 */

import { useCallback, useRef, useState } from "react";
import { AppState, Dimensions } from "react-native";
import { useFocusEffect } from "expo-router";

import { isLandscapeSize, type OrientationLockState } from "@/utils/orientationLock";
import { lockLandscape, unlockOrientation } from "@/utils/screenOrientation";

/**
 * How long to wait after the OS accepts the lock before looking again.
 *
 * `lockAsync` resolves when the request is accepted, not when the device has
 * finished turning, so the first frames after it are still portrait. Checking
 * immediately would read a mid-rotation phone as one that refused.
 */
const LOCK_SETTLE_MS = 700;

/**
 * How many times to ask in the opening burst, before dropping to the slow
 * re-assert. Small on purpose: a request the platform is going to honour is
 * honoured within a couple of asks, and the rest is the keep-alive's job.
 */
const LOCK_BURST_ATTEMPTS = 3;

/**
 * How often to re-assert once the burst is done and the glass is still
 * portrait. Long enough not to be a busy loop on a device that simply will not
 * turn, short enough that a phone which becomes able to rotate comes round
 * without the driver doing anything.
 */
const LOCK_REASSERT_MS = 2000;

/** Is the glass landscape right now? */
function viewportIsLandscape(): boolean {
  const { width, height } = Dimensions.get("window");
  return isLandscapeSize(width, height);
}

export interface LandscapeLock {
  /** How the pin is going, as far as the screen is concerned. */
  state: OrientationLockState;
  /**
   * Ask for the pin again, from the top.
   *
   * A no-op once the screen has been left, since the lock belongs to whoever is
   * focused.
   */
  forceRotate: () => void;
}

export function useLandscapeLock(): LandscapeLock {
  const [state, setState] = useState<OrientationLockState>("pending");
  /** The focused run's "ask again", or null while no screen holds the lock. */
  const restartRef = useRef<(() => void) | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      /** Set once the platform says there is no lock here. Terminal. */
      let unsupported = false;
      // Re-entering the screen re-asks the question from scratch: the device
      // may have been rotated back to portrait while we were on another page.
      setState("pending");

      const clear = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
      };

      const schedule = (ms: number) => {
        clear();
        timer = setTimeout(() => {
          if (!cancelled) void ask();
        }, ms);
      };

      /**
       * Ask for the lock, unless the glass is already landscape.
       *
       * `force` re-asserts even from a landscape viewport — used when the app
       * comes back to the foreground, since the OS may have quietly dropped the
       * lock while we were away even though the device is still held sideways.
       */
      const ask = async (force = false) => {
        if (cancelled || unsupported) return;
        if (!force && viewportIsLandscape()) {
          // Nothing to do, and nothing to keep running: the viewport listener
          // starts us again if the phone goes back to portrait.
          clear();
          setState("locked");
          return;
        }
        attempts += 1;
        const accepted = await lockLandscape();
        if (cancelled) return;
        if (!accepted) {
          // No native module, or the platform refused outright. Cached, so
          // asking again would spin forever without ever turning the device.
          unsupported = true;
          clear();
          setState("unsupported");
          return;
        }
        // Accepted — which is not the same as turned. Keep looking, fast while
        // the burst lasts and slowly forever after, until the glass comes round
        // or the screen is left.
        if (attempts >= LOCK_BURST_ATTEMPTS) setState("locked");
        schedule(attempts < LOCK_BURST_ATTEMPTS ? LOCK_SETTLE_MS : LOCK_REASSERT_MS);
      };

      // The glass changed shape: either it turned (in which case `ask` stands
      // down) or it went back to portrait and the pin has to be re-applied.
      const dimensionsSub = Dimensions.addEventListener("change", () => {
        if (cancelled || unsupported) return;
        attempts = 0;
        void ask();
      });

      // Coming back from the background: re-assert unconditionally, because a
      // lock released while we were away leaves a landscape viewport that is
      // free to fall back to portrait the moment the phone is tilted.
      const appStateSub = AppState.addEventListener("change", (next) => {
        if (cancelled || unsupported) return;
        if (next !== "active") return;
        attempts = 0;
        void ask(true);
      });

      // Pressed by a caller that wants the rotation now: drop whatever attempt
      // is in flight and start the count over.
      restartRef.current = () => {
        if (cancelled) return;
        clear();
        attempts = 0;
        setState("pending");
        void ask(true);
      };

      void ask();

      return () => {
        cancelled = true;
        restartRef.current = null;
        clear();
        dimensionsSub.remove();
        appStateSub.remove();
        setState("pending");
        void unlockOrientation();
      };
    }, []),
  );

  const forceRotate = useCallback(() => {
    restartRef.current?.();
  }, []);

  return { state, forceRotate };
}

export default useLandscapeLock;
