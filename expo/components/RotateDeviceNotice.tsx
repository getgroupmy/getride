/**
 * Full-screen "turn your device sideways" cover for landscape-only screens.
 *
 * Shown when the native landscape lock did not take (web, or a build made
 * before `expo-screen-orientation` shipped) and the viewport is still portrait.
 * It covers the screen rather than sitting above the content so the driver
 * cannot half-read a meter that is laid out for a shape they are not holding.
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, RotateCw } from "lucide-react-native";

import { useColors } from "@/hooks/useColors";
import { rotateNoticeCopy, type OrientationLockState } from "@/utils/orientationLock";

interface Props {
  state: OrientationLockState;
  /** Optional way out, so the driver is never trapped behind the notice. */
  onBack?: () => void;
  testID?: string;
}

export default function RotateDeviceNotice({ state, onBack, testID }: Props) {
  const Colors = useColors();
  const { title, body } = rotateNoticeCopy(state);

  return (
    <View
      style={[styles.container, { backgroundColor: Colors.background }]}
      testID={testID ?? "rotate-device-notice"}
    >
      <View style={[styles.iconWrap, { backgroundColor: Colors.accent + "1A" }]}>
        <RotateCw color={Colors.accent} size={44} />
      </View>
      <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: Colors.textSecondary }]}>{body}</Text>
      {onBack ? (
        <TouchableOpacity
          style={[styles.backButton, { borderColor: Colors.border }]}
          onPress={onBack}
          activeOpacity={0.85}
          testID="rotate-device-notice-back"
        >
          <ArrowLeft color={Colors.text} size={16} />
          <Text style={[styles.backButtonText, { color: Colors.text }]}>Go back</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "90deg" }],
  },
  title: { fontSize: 20, fontWeight: "800" as const, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  backButtonText: { fontSize: 13, fontWeight: "700" as const },
});
