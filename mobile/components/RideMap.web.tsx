import { StyleSheet, Text, View, useColorScheme } from "react-native";

import { darkColors, lightColors } from "@/constants/colors";
import type { RideMapProps } from "./RideMap";

/**
 * Web stand-in for the map.
 *
 * `react-native-maps` has no web build (see `utils/maps.web.ts`, which exports
 * nulls). Rather than render an empty box, this states what it is showing so
 * the rider flow stays testable in a browser — the pins and route are listed
 * instead of drawn. A real web map (Leaflet) is a later, separate concern.
 */
export default function RideMap({ center, markers = [], route, style }: RideMapProps) {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? darkColors : lightColors;

  return (
    <View style={[styles.fill, { backgroundColor: colors.card }, style]}>
      <Text style={[styles.title, { color: colors.textSecondary }]}>Map preview</Text>
      {center ? (
        <Text style={[styles.line, { color: colors.text }]}>
          Centre {center.latitude.toFixed(4)}, {center.longitude.toFixed(4)}
        </Text>
      ) : (
        <Text style={[styles.line, { color: colors.subtext }]}>Waiting for a fix…</Text>
      )}
      {markers.map((m) => (
        <Text key={m.id} style={[styles.line, { color: colors.text }]}>
          {m.kind}: {m.title ?? `${m.latitude.toFixed(4)}, ${m.longitude.toFixed(4)}`}
        </Text>
      ))}
      {route && route.length > 1 ? (
        <Text style={[styles.line, { color: colors.subtext }]}>
          Route · {route.length} points
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 16 },
  title: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  line: { fontSize: 13 },
});
