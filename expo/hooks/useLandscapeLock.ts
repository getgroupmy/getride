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
 */

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { OrientationLockState } from "@/utils/orientationLock";
import { lockLandscape, unlockOrientation } from "@/utils/screenOrientation";

/**
 * How long to keep saying `pending` after the OS has accepted the lock.
 *
 * `lockAsync` resolves when the request is accepted, not when the device has
 * finished turning, so the first frames after it are still portrait. Reporting
 * `locked` there would tell the screen the rotation is not coming and put the
 * rotate notice up over a device that is mid-turn. A viewport that goes
 * landscape inside the grace is simply drawn — the gate reads the viewport, not
 * this state — and one that has not turned by the end of it really is stuck.
 */
const LOCK_SETTLE_MS = 900;

export function useLandscapeLock(): OrientationLockState {
  const [state, setState] = useState<OrientationLockState>("pending");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let settle: ReturnType<typeof setTimeout> | undefined;
      // Re-entering the screen re-asks the question from scratch: the device
      // may have been rotated back to portrait while we were on another page.
      setState("pending");
      void (async () => {
        const locked = await lockLandscape();
        if (cancelled) return;
        if (!locked) {
          setState("unsupported");
          return;
        }
        settle = setTimeout(() => {
          if (!cancelled) setState("locked");
        }, LOCK_SETTLE_MS);
      })();
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
