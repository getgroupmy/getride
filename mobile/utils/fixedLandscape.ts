/**
 * Draws a screen horizontally whatever shape the glass is.
 *
 * Meter Digital is an instrument on a windscreen mount, so it is laid out in
 * landscape and must *stay* laid out in landscape — a taxi meter that reflows
 * into a tall column because the phone was picked up is not a meter. The OS
 * lock (`hooks/useLandscapeLock.ts`) turns the device where it can, but it is
 * best effort: the web build has no lock outside fullscreen, a binary older
 * than `expo-screen-orientation` has no native side to call, and iOS can accept
 * a geometry update and then not honour it.
 *
 * So the lock is backed by a *stage*. The content is always given a landscape
 * box to draw in — the long edge of the glass is its width, the short edge its
 * height — and where the glass itself is portrait the box is rotated a quarter
 * turn to fit. The console never sees a portrait viewport and never reflows;
 * the driver reads it horizontally either way.
 *
 * All of that is pure arithmetic, so it lives here rather than in the screen.
 */

/** The four physical edges, as `react-native-safe-area-context` reports them. */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LandscapeStage {
  /** Width of the box the content is laid out in — always the longer edge. */
  width: number;
  /** Height of that box — always the shorter edge. */
  height: number;
  /**
   * True when the glass is portrait and the box has to be turned to fit.
   *
   * The one flag the screen needs: false is the ordinary case and the stage is
   * a passthrough, so a device whose OS lock worked pays nothing for this.
   */
  rotated: boolean;
  /** Where to pin the (unrotated) box so it covers the glass once turned. */
  left: number;
  top: number;
  /**
   * The safe-area insets *as the content experiences them*.
   *
   * A rotated box meets the glass's edges on different sides than it thinks:
   * its top is against the screen's right, its right against the screen's
   * bottom, and so on. Handing the screen the raw insets would pad the notch on
   * whichever edge happens to be up, which is how a rotated layout ends up with
   * its content under the sensor housing.
   */
  insets: EdgeInsets;
}

/** Quarter turn applied to the content when the glass is portrait. */
export const STAGE_ROTATION = "90deg";

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve the landscape box for a given viewport.
 *
 * A square viewport counts as landscape: there is nothing to gain by turning
 * it, and rotating on an exact tie would flip the console back and forth as a
 * resizable window crossed the diagonal.
 */
export function resolveLandscapeStage(
  winWidth: number,
  winHeight: number,
  insets?: Partial<EdgeInsets>,
): LandscapeStage {
  const w = Math.max(0, finite(winWidth));
  const h = Math.max(0, finite(winHeight));
  const edges: EdgeInsets = {
    top: Math.max(0, finite(insets?.top ?? 0)),
    right: Math.max(0, finite(insets?.right ?? 0)),
    bottom: Math.max(0, finite(insets?.bottom ?? 0)),
    left: Math.max(0, finite(insets?.left ?? 0)),
  };

  if (w >= h) {
    return { width: w, height: h, rotated: false, left: 0, top: 0, insets: edges };
  }

  // Portrait: lay the content out in the swapped box and turn it. Pinning the
  // box so its centre sits on the glass's centre is what makes the quarter turn
  // land exactly over the screen — RN rotates a view about its own centre.
  return {
    width: h,
    height: w,
    rotated: true,
    left: (w - h) / 2,
    top: (h - w) / 2,
    // Turned clockwise, so the content's top edge is against the screen's right.
    insets: {
      top: edges.right,
      right: edges.bottom,
      bottom: edges.left,
      left: edges.top,
    },
  };
}

/**
 * The insets collapsed to the two totals `computeMeterMetrics` asks for.
 *
 * It only ever needs how much width and height the glass is keeping for
 * itself, so the screen does not have to know which edge became which.
 */
export function stageInsetTotals(stage: LandscapeStage): {
  horizontal: number;
  vertical: number;
} {
  return {
    horizontal: stage.insets.left + stage.insets.right,
    vertical: stage.insets.top + stage.insets.bottom,
  };
}
