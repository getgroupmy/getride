/**
 * Full-screen "turn your device sideways" cover for landscape-only screens.
 *
 * Shown when the viewport is portrait and the landscape pin did not produce a
 * rotation. It covers the screen rather than sitting above the content so the
 * driver cannot half-read a meter that is laid out for a shape they are not
 * holding.
 *
 * It carries exactly one key, and which one depends on whether there is a lock
 * left to ask (`rotateNoticeAction`). Where the platform accepted the pin and
 * simply did not turn, that key is **Force Rotate**: it asks again, and the
 * screen behind the notice draws itself the moment the device comes round.
 * Where there is no lock at all — the web build, a binary older than
 * `expo-screen-orientation` — forcing is impossible and the key is a way out
 * instead, so the driver is never held behind a notice by a button that cannot
 * work.
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, RotateCw } from "lucide-react-native";

import { useColors } from "@/hooks/useColors";
import {
  rotateNoticeAction,
  rotateNoticeCopy,
  type OrientationLockState,
} from "@/utils/orientationLock";

interface Props {
  state: OrientationLockState;
  /** Ask for the landscape pin again. The key where a lock exists to ask. */
  onForceRotate?: () => void;
  /** Way out, for the states where nothing can be forced. */
  onBack?: () => void;
  testID?: string;
}

export default function RotateDeviceNotice({
  state,
  onForceRotate,
  onBack,
  testID,
}: Props) {
  const Colors = useColors();
  const { title, body } = rotateNoticeCopy(state);
  const action = rotateNoticeAction(state);
  const forcing = action === "force" && !!onForceRotate;

  return (
    <View
      style={[styles.container, { backgroundColor: Colors.background }]}
      testID={testID ?? "rotate-device-notice"}
    >
      <View style={[styles.iconWrap, { backgroundColor: Colors.accent + "1A" }]}>
        <RotateCw color={Colors.accentText} size={44} />
      </View>
      <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: Colors.textSecondary }]}>{body}</Text>
      {forcing ? (
        <TouchableOpacity
          style={[styles.forceButton, { backgroundColor: Colors.accent }]}
          onPress={onForceRotate}
          activeOpacity={0.85}
          testID="rotate-device-notice-force"
          accessibilityRole="button"
        >
          <RotateCw color="#fff" size={16} />
          <Text style={styles.forceButtonText}>Force Rotate</Text>
        </TouchableOpacity>
      ) : onBack ? (
        <TouchableOpacity
          style={[styles.backButton, { borderColor: Colors.border }]}
          onPress={onBack}
          activeOpacity={0.85}
          testID="rotate-device-notice-back"
          accessibilityRole="button"
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
  forceButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  forceButtonText: { color: "#fff", fontSize: 14, fontWeight: "800" as const },
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
