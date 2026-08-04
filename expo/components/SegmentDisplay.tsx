/**
 * A seven-segment readout, as the meter's fare / time / distance fields.
 *
 * There is no segment font bundled with the app, so the look is built from the
 * platform's monospace face plus the trick that sells it: a faint ghost of the
 * unlit segments ("8" behind every digit) drawn under the value, exactly as an
 * LCD shows its whole character grid whether it is lit or not. Monospace is
 * what makes the two layers line up, and it also stops the digits shuffling
 * sideways as the fare ticks over.
 */

import React from "react";
import { Platform, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";

import { segmentGhost } from "@/utils/meterDashboard";

const SEGMENT_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

interface Props {
  /** The lit value, e.g. "3.00" or "00:00:24". */
  value: string;
  /** Cap height of the digits. */
  size: number;
  color: string;
  /** Opacity of the unlit segments. Set 0 to switch the ghost off. */
  ghostOpacity?: number;
  style?: ViewStyle;
  testID?: string;
}

export default function SegmentDisplay({
  value,
  size,
  color,
  ghostOpacity = 0.13,
  style,
  testID,
}: Props) {
  const textStyle: TextStyle = {
    fontFamily: SEGMENT_FONT,
    fontSize: size,
    // Roomy enough that the glyphs stay inside their line box: at these sizes a
    // tight leading lets the digits ride up over the panel's label.
    lineHeight: size * 1.26,
    fontWeight: "700",
    letterSpacing: size * 0.02,
    color,
  };

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {ghostOpacity > 0 ? (
        <Text
          style={[textStyle, styles.ghost, { opacity: ghostOpacity }]}
          numberOfLines={1}
          allowFontScaling={false}
          // The ghost is decoration; the value below carries the meaning.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {segmentGhost(value)}
        </Text>
      ) : null}
      <Text style={textStyle} numberOfLines={1} allowFontScaling={false}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // No alignSelf: the readout must hug its text so the absolutely-positioned
  // ghost lines up with it, and the parent's alignItems decides where it sits.
  wrap: { position: "relative" },
  ghost: { ...StyleSheet.absoluteFillObject },
});
