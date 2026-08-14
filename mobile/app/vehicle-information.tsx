import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useCanbus } from "@/hooks/useCanbus";
import { useColors } from "@/hooks/useColors";
import {
  groupReadings,
  scanVehicle,
  type ScanProgress,
  type VehicleScanReport,
} from "@/utils/canbus/vehicleScan";
import { PID_GROUP_LABEL, PID_GROUP_ORDER } from "@/utils/canbus/pidCatalog";

/**
 * Everything the reader can tell us about this car, in one pass.
 *
 * The scan pauses the 1 Hz telemetry sweep first, because the adapter answers
 * one command at a time — without that, a bulk read and the meter's sweep
 * compete and both get slower and less reliable. The pause is always released,
 * including when the scan fails or the screen goes away mid-read.
 *
 * A PID the car claims but that did not answer is reported as unreadable
 * rather than dropped, so a supported parameter is never silently missing.
 */
export default function VehicleInformation() {
  const colors = useColors();
  const { state, sendCommand, setPollingPaused } = useCanbus();

  const [report, setReport] = useState<VehicleScanReport | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const online = state.phase === "online";

  const run = useCallback(async () => {
    if (!online || scanning) return;
    setScanning(true);
    setError(null);
    setProgress(null);
    setPollingPaused(true);
    try {
      const result = await scanVehicle(sendCommand, {
        onProgress: (p) => {
          if (aliveRef.current) setProgress(p);
        },
        shouldContinue: () => aliveRef.current,
      });
      if (aliveRef.current) setReport(result);
    } catch (e) {
      if (aliveRef.current) {
        setError(e instanceof Error ? e.message : "The scan did not finish.");
      }
    } finally {
      // Always released — a paused sweep stays paused, and that would leave
      // the meter blind to the vehicle's speed.
      setPollingPaused(false);
      if (aliveRef.current) setScanning(false);
    }
  }, [online, scanning, sendCommand, setPollingPaused]);

  const section = (title: string, rows: { key: string; label: string; value: string }[]) =>
    rows.length ? (
      <View key={title} style={styles.block}>
        <Text style={[styles.section, { color: colors.textSecondary }]}>{title}</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {rows.map((r, i) => (
            <View
              key={r.key}
              style={[
                styles.row,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={2}>
                {r.label}
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>{r.value}</Text>
            </View>
          ))}
        </View>
      </View>
    ) : null;

  if (!online) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>No reader connected</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          Connect your OBD-II reader to read this vehicle.
        </Text>
      </View>
    );
  }

  const grouped = report ? groupReadings(report.readings, PID_GROUP_ORDER) : [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan this vehicle"
        onPress={run}
        disabled={scanning}
        style={[styles.cta, { backgroundColor: scanning ? colors.border : colors.primary }]}
      >
        {scanning ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={[styles.ctaText, { color: colors.onAccent }]}>
            {report ? "Scan again" : "Scan vehicle"}
          </Text>
        )}
      </Pressable>

      {scanning && progress ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          Reading… {progress.done} of {progress.total}
        </Text>
      ) : null}

      {state.simulated ? (
        <Text style={[styles.meta, { color: colors.warning }]}>
          Demo Mode — these values are simulated, not read from a car.
        </Text>
      ) : null}

      {error ? <Text style={[styles.meta, { color: colors.error }]}>{error}</Text> : null}

      {report ? (
        <>
          {section("Adapter", report.adapter)}
          {section("Vehicle identity", report.identity)}

          {grouped.map((g) =>
            section(
              PID_GROUP_LABEL[g.group],
              g.readings.map((r) => ({
                key: r.pid,
                // An uncatalogued PID keeps its raw label rather than being
                // dropped — a supported parameter is never silently missing.
                label: r.known ? r.label : `${r.label} (PID ${r.pid})`,
                value: r.value,
              }))
            )
          )}

          {Object.entries(report.dtcs).map(([store, codes]) =>
            section(
              `Fault codes — ${store}`,
              (codes ?? []).map((c, i) => ({ key: `${store}-${i}`, label: c, value: "" }))
            )
          )}

          {report.unreadablePids.length ? (
            <View style={styles.block}>
              <Text style={[styles.section, { color: colors.textSecondary }]}>
                Supported but silent
              </Text>
              <Text style={[styles.meta, { color: colors.subtext }]}>
                {report.unreadablePids.join(", ")}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  title: { fontSize: 18, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  block: { gap: 6 },
  section: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  label: { fontSize: 13, flex: 1 },
  value: { fontSize: 13, fontWeight: "600" },
  cta: { borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  ctaText: { fontSize: 15, fontWeight: "700" },
});
