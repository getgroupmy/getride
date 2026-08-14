import { ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { darkColors, lightColors } from "@/constants/colors";
import { isSupabaseConfigured } from "@/utils/supabase";

/**
 * Phase 01 landing screen.
 *
 * Not a product screen — it exists so the foundations are visibly wired: the
 * router mounts, the theme resolves, the path alias works, and the Supabase
 * client reports whether it is configured. Phase 02 replaces this with the
 * rider map.
 */
export default function Index() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? darkColors : lightColors;

  const rows: { label: string; value: string }[] = [
    { label: "Router", value: "expo-router mounted" },
    { label: "Theme", value: scheme === "dark" ? "dark" : "light" },
    { label: "Supabase", value: isSupabaseConfigured ? "configured" : "not configured" },
    { label: "Logic layer", value: "108 modules · 1,140 tests" },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>GET.ride</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Rebuild · Phase 01 — Foundations
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {rows.map((row, i) => (
          <View
            key={row.label}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{row.label}</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>{row.value}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.note, { color: colors.subtext }]}>
        Next: the rider map, place search, fare estimate and ride request.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 8, flexGrow: 1 },
  title: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: 15, marginBottom: 20 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: "600" },
  note: { fontSize: 13, marginTop: 20, lineHeight: 19 },
});
