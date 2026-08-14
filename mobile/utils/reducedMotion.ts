/**
 * How an animation should behave when the device asks for reduced motion.
 *
 * "Reduce Motion" is not "no animation". WCAG 2.3.3 and both platform HIGs ask
 * for *non-essential* motion to be removed — large travel, parallax, spin,
 * zoom — while animation that carries information stays. A spinner replaced by
 * a static glyph tells the user nothing is happening; a card that flies in from
 * off-screen and rotates on the way out tells them nothing they could not read
 * from its end state.
 *
 * So each animation declares what it is *for*, and this decides what happens:
 *
 * | kind         | example                              | reduced           |
 * |--------------|--------------------------------------|-------------------|
 * | `decorative` | pulsing map ring, shimmer            | does not run      |
 * | `transition` | sheet slide, pin drop, card entry    | snaps to its end  |
 * | `essential`  | spinner, progress bar, countdown     | unchanged         |
 *
 * A `transition` still *runs* — the end state must be reached, or the sheet
 * never opens — it just arrives without the travel.
 */

export type MotionKind = "decorative" | "transition" | "essential";

export type MotionPlan = {
  /** Start the animation at all. False only for decorative motion. */
  run: boolean;
  /** Jump to the end value instead of travelling to it. */
  snap: boolean;
};

export function resolveMotion(kind: MotionKind, reduced: boolean): MotionPlan {
  if (!reduced) return { run: true, snap: false };
  switch (kind) {
    case "decorative":
      // `snap` is redundant next to `run: false`, but it makes each helper
      // safe on its own: a caller that only reads `motionDuration` still gets
      // no travel rather than a full-length decorative animation.
      return { run: false, snap: true };
    case "transition":
      return { run: true, snap: true };
    case "essential":
      return { run: true, snap: false };
  }
}

/**
 * The duration an animation should actually use. Snapping is expressed as a
 * zero-length animation rather than a `setValue`, so callers keep one code path
 * and their completion callbacks still fire.
 */
export function motionDuration(ms: number, kind: MotionKind, reduced: boolean): number {
  return resolveMotion(kind, reduced).snap ? 0 : ms;
}

/**
 * Spring configs have no duration to zero out, so a snapped spring is expressed
 * as the stiffest possible one. `overshootClamping` matters as much as the
 * speed: an overshoot is the bounce, which is the part that causes trouble.
 */
export function motionSpring<T extends object>(
  config: T,
  kind: MotionKind,
  reduced: boolean
): T & { speed?: number; bounciness?: number; overshootClamping?: boolean } {
  if (!resolveMotion(kind, reduced).snap) return config;
  const next = { ...config } as Record<string, unknown>;
  // tension/friction and speed/bounciness are mutually exclusive in Animated;
  // drop the pair the caller used before setting our own.
  delete next.tension;
  delete next.friction;
  delete next.stiffness;
  delete next.damping;
  delete next.mass;
  delete next.velocity;
  return {
    ...(next as T),
    speed: 100,
    bounciness: 0,
    overshootClamping: true,
  };
}
