/**
 * Gives its children a landscape box to draw in, whatever shape the glass is.
 *
 * The companion to `hooks/useLandscapeLock.ts`: the lock turns the *device*
 * where the platform allows it, and this turns the *content* where it does not.
 * Between them the console is always read horizontally and never reflows into a
 * tall column — see `utils/fixedLandscape.ts` for the geometry, which is pure
 * and tested.
 *
 * On a landscape viewport — the ordinary case, and the only one on a device
 * whose OS lock worked — this is a plain `flex: 1` view: no transform, no
 * absolute positioning, nothing to pay for.
 *
 * A React Native `<Modal>` is its own native window and does **not** inherit an
 * ancestor's transform, so a popup raised over a rotated console would come up
 * square with the glass while the console behind it was turned. Every modal
 * that can appear over the meter therefore wraps its own content in a stage of
 * its own, which is why this is a component rather than a wrapper applied once
 * at the root.
 */

import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { STAGE_ROTATION, type LandscapeStage } from "@/utils/fixedLandscape";

interface Props {
  stage: LandscapeStage;
  children: React.ReactNode;
  /** Applied to the content box in both orientations. */
  style?: ViewStyle;
  testID?: string;
}

export default function FixedLandscapeStage({
  stage,
  children,
  style,
  testID,
}: Props) {
  if (!stage.rotated) {
    return (
      <View style={[styles.flat, style]} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    // The glass, portrait, with the turned content pinned over it. The box is
    // laid out at its landscape size and rotated about its own centre, which
    // `resolveLandscapeStage` has already positioned on the centre of the
    // screen — so the quarter turn lands exactly over the viewport.
    <View style={styles.glass} testID={testID}>
      <View
        style={[
          styles.turned,
          {
            width: stage.width,
            height: stage.height,
            left: stage.left,
            top: stage.top,
          },
          style,
        ]}
        testID={testID ? `${testID}-rotated` : undefined}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flat: { flex: 1 },
  // Deliberately no `overflow: "hidden"`: the turned box covers the glass
  // exactly once rotated, so there is nothing to clip, and clipping a
  // transformed child is the kind of thing Android renders inconsistently.
  glass: { flex: 1 },
  turned: {
    position: "absolute",
    transform: [{ rotate: STAGE_ROTATION }],
  },
});
