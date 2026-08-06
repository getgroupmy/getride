/**
 * Pins the focused screen to landscape and reports whether the pin took.
 *
 * The lock is held only while the screen is focused: navigating away (or back)
 * hands rotation straight back to the app default, so no other screen inherits
 * a landscape-only device. Coming *back* is the other half of that — focus runs
 * again, the pin is re-requested and the state restarts at `pending`, so a
 * screen that gates itself on this never shows a console laid out for a shape
 * the device has meanwhile left. See `utils/orientationLock.ts` for what the
 * returned state means and `utils/screenOrientation.ts` for the guarded native
 * call.
 *
 * The pin is *asked for more than once*, because one accepted request is not
 * the same as a device that turned. A screen reached by `replace` — which is
 * how the launch buffer opens the meter — asks for the lock in the middle of a
 * stack transition, and iOS drops a geometry update requested by a view
 * controller that is not settled in the window hierarchy yet: `lockAsync`
 * resolves, nothing rotates, and the driver is told to turn a phone the app
 * could have turned itself. So the lock is re-applied while the viewport is
 * still portrait, up to `LOCK_ATTEMPTS` times, before the screen is allowed to
 * conclude the rotation is not coming.
 */

import { useCallback, useState } from "react";
import { Dimensions } from "react-native";
import { useFocusEffect } from "expo-router";

import { isLandscapeSize, type OrientationLockState } from "@/utils/orientationLock";
import { lockLandscape, unlockOrientation } from "@/utils/screenOrientation";

/**
 * How long to keep saying `pending` after the OS has accepted the lock.
 *
 * `lockAsync` resolves when the request is accepted, not when the device has
 * finished turning, so the first frames after it are still portrait. Reporting
 * `locked` there would tell the screen the rotation is not coming and put the
 * rotate notice up over a device that is mid-turn. A viewport that goes
 * landscape inside the grace is simply drawn — the gate reads the viewport, not
 * this state — and one that has not turned by the end of it is asked again.
 */
const LOCK_SETTLE_MS = 700;

/**
 * How many times to ask before believing the answer.
 *
 * Two, not ten: a request the platform is going to honour is honoured on the
 * first or second ask, and every extra attempt is another `LOCK_SETTLE_MS` of a
 * blank screen for a driver whose device genuinely will not turn.
 */
const LOCK_ATTEMPTS = 2;

/** Is the glass landscape right now? The same window the gate measures. */
function viewportIsLandscape(): boolean {
  const { width, height } = Dimensions.get("window");
  return isLandscapeSize(width, height);
}

export function useLandscapeLock(): OrientationLockState {
  const [state, setState] = useState<OrientationLockState>("pending");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let settle: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      // Re-entering the screen re-asks the question from scratch: the device
      // may have been rotated back to portrait while we were on another page.
      setState("pending");

      const ask = () => {
        void (async () => {
          attempts += 1;
          const locked = await lockLandscape();
          if (cancelled) return;
          if (!locked) {
            // No native module, or the platform refused outright. Asking again
            // would only delay the notice.
            setState("unsupported");
            return;
          }
          settle = setTimeout(() => {
            if (cancelled) return;
            if (viewportIsLandscape() || attempts >= LOCK_ATTEMPTS) {
              // Either it turned, or we have asked as often as is worth asking
              // and the screen may now put the notice up.
              setState("locked");
              return;
            }
            // Accepted, but nothing moved — most likely the request landed
            // mid-transition. Ask again from a settled screen.
            ask();
          }, LOCK_SETTLE_MS);
        })();
      };

      ask();

      return () => {
        cancelled = true;
        if (settle) clearTimeout(settle);
        setState("pending");
        void unlockOrientation();
      };
    }, []),
  );

  return state;
}

export default useLandscapeLock;
