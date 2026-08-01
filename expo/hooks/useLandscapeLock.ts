/**
 * Pins the focused screen to landscape and reports whether the pin took.
 *
 * The lock is held only while the screen is focused: navigating away (or back)
 * hands rotation straight back to the app default, so no other screen inherits
 * a landscape-only device. See `utils/orientationLock.ts` for what the returned
 * state means and `utils/screenOrientation.ts` for the guarded native call.
 */

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { OrientationLockState } from "@/utils/orientationLock";
import { lockLandscape, unlockOrientation } from "@/utils/screenOrientation";

export function useLandscapeLock(): OrientationLockState {
  const [state, setState] = useState<OrientationLockState>("pending");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const locked = await lockLandscape();
        if (!cancelled) setState(locked ? "locked" : "unsupported");
      })();
      return () => {
        cancelled = true;
        setState("pending");
        void unlockOrientation();
      };
    }, []),
  );

  return state;
}

export default useLandscapeLock;
