import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the device asks for reduced motion (iOS Settings → Accessibility →
 * Motion → Reduce Motion, Android Settings → Accessibility → Remove animations,
 * `prefers-reduced-motion` on web).
 *
 * Pair it with `utils/reducedMotion.ts`, which decides what a given animation
 * should do with the answer — the setting does not mean "no animation".
 *
 * The value is cached at module scope as well as returned, so an animation
 * started from a callback rather than from render (`isMotionReduced()`) reads
 * the same answer without threading the flag through.
 */

let cached = false;
const listeners = new Set<(value: boolean) => void>();

/** The current preference, readable outside React. */
export function isMotionReduced(): boolean {
  return cached;
}

function publish(value: boolean) {
  if (value === cached) return;
  cached = value;
  listeners.forEach((l) => l(value));
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(cached);

  useEffect(() => {
    let active = true;

    // Not every platform implements this (older RN Web, and any host that
    // stubs AccessibilityInfo); a missing answer means "no preference set",
    // never a crash on a screen the user is trying to reach.
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (!active) return;
        publish(value === true);
        setReduced(value === true);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (value: boolean) => {
        publish(value === true);
        setReduced(value === true);
      }
    );

    listeners.add(setReduced);

    return () => {
      active = false;
      listeners.delete(setReduced);
      // RN ≥ 0.65 returns a subscription; older hosts returned void.
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
