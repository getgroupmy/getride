import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FixedLandscapeStage from "@/components/FixedLandscapeStage";
import SegmentDisplay from "@/components/SegmentDisplay";
import { useCanbus } from "@/hooks/useCanbus";
import { useLandscapeLock } from "@/hooks/useLandscapeLock";
import { describeMeterConnection } from "@/utils/meterDashboard";
import { resolveLandscapeStage } from "@/utils/fixedLandscape";
import { computeMeterMetrics, type MeterMetrics } from "@/utils/meterScale";
import {
  applyMeterSample,
  computeMeterFare,
  createMeterState,
  formatMeterClock,
  formatMeterKm,
  isNightPeriod,
  pauseMeter,
  periodMultiplier,
  resetMeter,
  startMeter,
  type MeterPeriod,
  type MeterState,
  type MeterTariff,
} from "@/utils/taxiMeter";

/**
 * Meter Digital — the in-app taxi meter.
 *
 * Drawn as the instrument it replaces: a fixed dark console, deliberately not
 * themed, because a white screen on a windscreen mount at night is a hazard.
 *
 * It bills on the vehicle's own OBD-II speed (PID 0D) and silently falls back
 * to GPS when the reader is absent, stale, or simulated — simulated telemetry
 * never bills a fare. All accrual and tariff arithmetic lives in
 * `utils/taxiMeter.ts`; this screen owns only the 1 Hz clock and the sensors.
 */

/** The console's own palette — fixed, not themed. */
const INK = "#E8EDF2";
const DIM = "#7C8B99";
const GROUND = "#0B0F14";
const PANEL = "#141A21";
const LIT = "#FFB627";
const OK = "#3DD68C";

const TICK_MS = 1000;

export default function MeterDigital() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Pin the device to landscape while this screen is focused. The pin is held
  // rather than asked once: a screen reached by `replace` asks from inside a
  // stack transition, and iOS drops a geometry update from a view controller
  // that is not settled in the window hierarchy yet.
  useLandscapeLock();

  // The lock turns the device where the platform allows it; the stage turns the
  // content where it does not. There is deliberately no rotate gate — a
  // portrait viewport draws a tighter console rather than a notice standing in
  // front of the meter.
  const stage = resolveLandscapeStage(width, height, insets);
  const m: MeterMetrics = useMemo(
    () => computeMeterMetrics(stage.width, stage.height),
    [stage.width, stage.height]
  );

  const canbus = useCanbus();
  const [meter, setMeter] = useState<MeterState>(createMeterState);
  const [tariff, setTariff] = useState<MeterTariff>("old");
  const [period, setPeriod] = useState<MeterPeriod>(() =>
    isNightPeriod(new Date()) ? "night" : "day"
  );
  const [hasFix, setHasFix] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);

  const runningRef = useRef(false);
  runningRef.current = meter.running;

  // One clock drives the meter. Each tick hands `applyMeterSample` whatever the
  // sensors currently report and lets it decide which one bills — including
  // rejecting a stale OBD reading.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      let gpsSpeedKmh: number | null = null;
      let gpsPoint: { latitude: number; longitude: number; accuracyM?: number | null } | null =
        null;

      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") {
          setGpsDenied(true);
        } else {
          const fix = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          });
          if (cancelled) return;
          setGpsDenied(false);
          setHasFix(true);
          gpsPoint = {
            latitude: fix.coords.latitude,
            longitude: fix.coords.longitude,
            accuracyM: fix.coords.accuracy,
          };
          gpsSpeedKmh =
            typeof fix.coords.speed === "number" && fix.coords.speed >= 0
              ? fix.coords.speed * 3.6
              : null;
        }
      } catch {
        // A missed fix is a missed sample, not a stopped meter.
      }

      if (cancelled || !runningRef.current) return;

      // Demo Mode must never bill: withhold the simulated speed so the sample
      // falls through to GPS, exactly as if no reader were linked.
      const simulated = canbus.state.simulated;
      const obdSpeedKmh = simulated ? null : (canbus.state.telemetry.speed ?? null);
      const obdUpdatedAt = simulated ? null : canbus.state.lastUpdate;

      setMeter((prev) =>
        applyMeterSample(prev, {
          at: Date.now(),
          obdSpeedKmh,
          obdUpdatedAt,
          gpsSpeedKmh,
          gpsPoint,
        })
      );
    };

    void tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canbus.state.simulated, canbus.state.telemetry.speed, canbus.state.lastUpdate]);

  const linked = canbus.state.phase === "online" && !canbus.state.simulated;

  const connection = describeMeterConnection({
    running: meter.running,
    obdLinked: linked,
    obdConnecting: canbus.connecting,
    obdDemo: canbus.state.simulated,
    hasGpsFix: hasFix,
    gpsDenied,
  });

  const fare = computeMeterFare(meter, {
    tariff,
    multiplier: periodMultiplier(period),
  });

  const toggleRun = useCallback(() => {
    setMeter((prev) => (prev.running ? pauseMeter(prev) : startMeter(prev, Date.now())));
  }, []);

  const clear = useCallback(() => {
    if (runningRef.current) return;
    setMeter(resetMeter());
  }, []);

  const key = (
    label: string,
    active: boolean,
    onPress: () => void,
    disabled = false
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.key,
        {
          height: m.keyHeight,
          borderRadius: m.radius * 0.6,
          backgroundColor: active ? LIT : PANEL,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={{ color: active ? GROUND : INK, fontSize: m.keyText, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.ground, { backgroundColor: GROUND }]}>
      <FixedLandscapeStage stage={stage}>
        <View style={{ flex: 1, padding: m.pad, gap: m.gap }}>
          {/* Status line — names the connection type, and flags Demo Mode
              beside it rather than folding it in: a simulator is not a sensor. */}
          <View style={styles.statusRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave the meter"
              onPress={() => {
                if (runningRef.current) return; // a running hire cannot be walked out of
                router.back();
              }}
            >
              <Text style={{ color: DIM, fontSize: m.statusSize }}>‹ BACK</Text>
            </Pressable>
            <Text
              style={{
                color: connection.tone === "ok" ? OK : DIM,
                fontSize: m.statusSize,
                fontWeight: "700",
              }}
            >
              {connection.label}
              {connection.demo ? "  ·  DEMO" : ""}
            </Text>
          </View>

          <View style={{ flex: 1, flexDirection: "row", gap: m.gap }}>
            {/* Fare */}
            <View
              style={[
                styles.panel,
                { backgroundColor: PANEL, padding: m.bodyPad, borderRadius: m.radius, flex: 2 },
              ]}
            >
              <Text style={{ color: DIM, fontSize: m.panelLabel, letterSpacing: 1 }}>FARE</Text>
              <View style={styles.panelBody}>
                <Text style={{ color: DIM, fontSize: m.currencySize, fontWeight: "700" }}>RM</Text>
                <SegmentDisplay
                  value={fare.total.toFixed(2)}
                  size={m.fareSize}
                  color={LIT}
                />
              </View>
            </View>

            {/* Time + distance */}
            <View style={{ flex: 1, gap: m.gap }}>
              <View
                style={[
                  styles.panel,
                  { backgroundColor: PANEL, padding: m.bodyPad, borderRadius: m.radius, flex: 1 },
                ]}
              >
                <Text style={{ color: DIM, fontSize: m.panelLabel, letterSpacing: 1 }}>TIME</Text>
                <SegmentDisplay
                  value={formatMeterClock(meter.elapsedMs)}
                  size={m.statSizeMax}
                  color={INK}
                />
              </View>
              <View
                style={[
                  styles.panel,
                  { backgroundColor: PANEL, padding: m.bodyPad, borderRadius: m.radius, flex: 1 },
                ]}
              >
                <Text style={{ color: DIM, fontSize: m.panelLabel, letterSpacing: 1 }}>
                  DISTANCE
                </Text>
                <SegmentDisplay
                  value={formatMeterKm(meter.distanceM)}
                  size={m.statSizeMax}
                  color={INK}
                />
              </View>
            </View>
          </View>

          {/* Keys */}
          <View style={{ flexDirection: "row", gap: m.gap }}>
            {key("OLD", tariff === "old", () => setTariff("old"), meter.running)}
            {key("NEW", tariff === "new", () => setTariff("new"), meter.running)}
            {key("DAY", period === "day", () => setPeriod("day"))}
            {key("NIGHT", period === "night", () => setPeriod("night"))}
            {key("CLEAR", false, clear, meter.running)}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={meter.running ? "End hire" : "Start hire"}
              onPress={toggleRun}
              style={[
                styles.key,
                {
                  flex: 2,
                  height: m.keyHeight,
                  borderRadius: m.radius * 0.6,
                  backgroundColor: meter.running ? "#C8321E" : OK,
                },
              ]}
            >
              <Text style={{ color: GROUND, fontSize: m.keyText, fontWeight: "800" }}>
                {meter.running ? "END" : "START"}
              </Text>
            </Pressable>
          </View>

          {/* Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: m.gap }}>
              {[
                { label: "OBD-II", to: "/obd2-reader" },
                { label: "PRINTER", to: "/meter-printer" },
                { label: "VEHICLE", to: "/vehicle-information" },
              ].map((t) => (
                <Pressable
                  key={t.to}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                  onPress={() => router.push(t.to as never)}
                  style={[
                    styles.key,
                    {
                      height: m.keyHeight,
                      paddingHorizontal: m.bodyPad * 1.5,
                      borderRadius: m.radius * 0.6,
                      backgroundColor: PANEL,
                    },
                  ]}
                >
                  <Text style={{ color: INK, fontSize: m.keyText }}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </FixedLandscapeStage>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panel: { justifyContent: "center", overflow: "hidden" },
  panelBody: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  key: { flex: 1, alignItems: "center", justifyContent: "center" },
});
