/**
 * Meter Digital — the in-app taxi meter.
 *
 * Reached from the Teksi driver-permit screen (partner-teksi), above "Start
 * Pickup". The meter bills distance and time exactly like the physical meter
 * in the dash, and it takes its motion from two sources in priority order:
 *
 *  1. **OBD-II / CANBus** — the vehicle's own speedometer (PID 0D), streamed
 *     off the reader saved in Settings → OBD-II (CANBus) reader.
 *  2. **GPS** — the fallback whenever the reader is absent, stale, or running
 *     in Demo Mode. The meter switches over silently and says which source it
 *     is billing on, so the driver always knows what the fare is based on.
 *
 * All accrual and tariff maths live in `utils/taxiMeter.ts` (pure + tested);
 * this screen only owns the 1 Hz clock, the sensors, and the display.
 *
 * The screen is landscape-only. It is read at a glance off a dash mount, so it
 * pins the device to landscape while it is focused (`useLandscapeLock`) and
 * hands rotation back on the way out. Where that pin cannot happen — the web
 * build, or a binary made before `expo-screen-orientation` shipped — a portrait
 * viewport gets the rotate notice instead of a squeezed meter.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  ArrowLeft,
  Clock,
  Cpu,
  Gauge,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Route,
  Satellite,
  Square,
  TimerReset,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useCanbus } from "@/hooks/useCanbus";
import { useLandscapeLock } from "@/hooks/useLandscapeLock";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import RotateDeviceNotice from "@/components/RotateDeviceNotice";
import { TRANSPORT_LABEL } from "@/utils/canbus/types";
import { isLandscapeSize, shouldPromptRotate } from "@/utils/orientationLock";
import {
  applyMeterSample,
  computeMeterFare,
  createMeterState,
  formatMeterDistance,
  formatMeterDuration,
  pauseMeter,
  resetMeter,
  startMeter,
  WAITING_SPEED_KMH,
  type MeterSample,
  type MeterState,
  type MeterTariff,
} from "@/utils/taxiMeter";

/** How often the meter folds a sensor sample in. Matches the OBD poll rate. */
const TICK_MS = 1000;

const SOURCE_COLOR = {
  obd: "#22C55E",
  gps: "#3B82F6",
  none: "#EF4444",
} as const;

interface LiveFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
}

export default function MeterDigitalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Colors = useColors();
  const isLightMode = Colors.background === "#FFFFFF";
  const params = useLocalSearchParams<{ tariff?: string; plate?: string }>();

  // Landscape-only: pinned while focused, with the rotate notice as the cover
  // for every platform/build where the pin cannot happen.
  const lockState = useLandscapeLock();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = isLandscapeSize(winWidth, winHeight);
  const promptRotate = shouldPromptRotate(lockState, winWidth, winHeight);

  const { settings: displaySettings } = useDisplaySettings();
  // Same link the Teksi screen uses: auto-connect to the saved reader, and only
  // fall back to the simulator when partner-side simulation is switched on.
  const canbus = useCanbus({
    autoConnect: true,
    allowSimulator: displaySettings.partnerDriveSimEnabled,
  });

  const [tariff, setTariff] = useState<MeterTariff>(
    params.tariff === "new" ? "new" : "old",
  );
  const [meter, setMeter] = useState<MeterState>(createMeterState);
  const [gpsDenied, setGpsDenied] = useState<boolean>(false);

  // Latest sensor readings, held in refs so the 1 Hz tick can read them without
  // re-creating the interval on every telemetry update.
  const fixRef = useRef<LiveFix | null>(null);
  const canbusRef = useRef(canbus.state);
  useEffect(() => {
    canbusRef.current = canbus.state;
  }, [canbus.state]);

  const canbusState = canbus.state;
  const online = canbusState.phase === "online";
  const obdLinked = online && !canbusState.simulated;
  const obdDemo = online && canbusState.simulated;

  // --- Live GPS: a continuous high-accuracy watch, the meter's fallback ---
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;
      (async () => {
        try {
          let { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") {
            status = (await Location.requestForegroundPermissionsAsync()).status;
          }
          if (status !== "granted") {
            if (!cancelled) setGpsDenied(true);
            return;
          }
          if (cancelled) return;
          setGpsDenied(false);
          sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.BestForNavigation,
              timeInterval: TICK_MS,
              distanceInterval: 0,
            },
            (pos) => {
              if (cancelled) return;
              const speed = pos.coords.speed;
              fixRef.current = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracyM:
                  typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
                speedKmh:
                  typeof speed === "number" && Number.isFinite(speed) && speed >= 0
                    ? speed * 3.6
                    : null,
              };
            },
          );
          if (cancelled) {
            sub.remove();
            sub = null;
          }
        } catch (e) {
          console.log("[meter-digital] GPS watch failed", e);
        }
      })();
      return () => {
        cancelled = true;
        sub?.remove();
        sub = null;
        fixRef.current = null;
      };
    }, []),
  );

  // --- The meter clock ---
  useEffect(() => {
    if (!meter.running) return;
    const id = setInterval(() => {
      const now = Date.now();
      const can = canbusRef.current;
      const fix = fixRef.current;
      // Demo Mode telemetry is invented, so it must never bill a fare: the
      // meter treats a simulated link as "no OBD" and runs on GPS instead.
      const useObd = can.phase === "online" && !can.simulated;
      const sample: MeterSample = {
        at: now,
        obdSpeedKmh: useObd ? canbusSpeedOf(can.telemetry.speed) : null,
        obdUpdatedAt: useObd ? can.lastUpdate : null,
        gpsSpeedKmh: fix?.speedKmh ?? null,
        gpsPoint: fix
          ? {
              latitude: fix.latitude,
              longitude: fix.longitude,
              accuracyM: fix.accuracyM,
            }
          : null,
      };
      setMeter((prev) => applyMeterSample(prev, sample));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [meter.running]);

  const fare = useMemo(() => computeMeterFare(meter, { tariff }), [meter, tariff]);

  const started = meter.startedAt !== null;
  const sourceColor = SOURCE_COLOR[meter.source];
  const sourceLabel =
    meter.source === "obd"
      ? `OBD-II · ${TRANSPORT_LABEL[canbusState.device?.transport ?? "bluetooth"]}`
      : meter.source === "gps"
        ? "GPS fallback"
        : meter.running
          ? "Waiting for signal"
          : "Meter idle";

  const linkLine = canbus.connecting
    ? "Connecting to the OBD-II reader…"
    : obdLinked
      ? `${canbusState.device?.name ?? "Reader"} linked${
          canbusState.bitrateKbps ? ` · ${canbusState.bitrateKbps} kbps` : ""
        }`
      : obdDemo
        ? "Demo Mode — virtual data, the meter bills on GPS"
        : canbusState.error ??
          "No reader connected — the meter is billing on GPS";

  const handleStart = useCallback(() => {
    setMeter((prev) => startMeter(prev, Date.now()));
  }, []);

  const handlePause = useCallback(() => {
    setMeter((prev) => pauseMeter(prev));
  }, []);

  const handleReset = useCallback(() => {
    setMeter(resetMeter());
  }, []);

  const handleStop = useCallback(() => {
    const stopped = pauseMeter(meter);
    const total = computeMeterFare(stopped, { tariff });
    setMeter(stopped);
    Alert.alert(
      `Fare RM ${total.total.toFixed(2)}`,
      [
        `Distance: ${formatMeterDistance(stopped.distanceM)}`,
        `Time: ${formatMeterDuration(stopped.elapsedMs)}`,
        `Waiting: ${formatMeterDuration(stopped.waitingMs)}`,
        `Source: ${stopped.obdSamples >= stopped.gpsSamples ? "OBD-II" : "GPS"} (${
          stopped.obdSamples
        } OBD / ${stopped.gpsSamples} GPS samples)`,
      ].join("\n"),
      [
        { text: "Keep meter", style: "cancel" },
        { text: "Clear meter", style: "destructive", onPress: handleReset },
      ],
    );
  }, [handleReset, meter, tariff]);

  const cardStyle = {
    backgroundColor: isLightMode ? "#F9FAFB" : "#111",
    borderColor: Colors.border,
  };

  const stats: { id: string; icon: typeof Route; label: string; value: string }[] = [
    {
      id: "distance",
      icon: Route,
      label: "Distance",
      value: formatMeterDistance(meter.distanceM),
    },
    {
      id: "time",
      icon: Clock,
      label: "Trip time",
      value: formatMeterDuration(meter.elapsedMs),
    },
    {
      id: "waiting",
      icon: TimerReset,
      label: `Waiting (≤${WAITING_SPEED_KMH} km/h)`,
      value: formatMeterDuration(meter.waitingMs),
    },
    {
      id: "speed",
      icon: Gauge,
      label: "Speed",
      value: `${Math.round(meter.speedKmh)} km/h`,
    },
  ];

  /* --- Fare --- */
  const fareCard = (
    <View
      style={[styles.fareCard, { backgroundColor: Colors.accent }]}
      testID="meter-digital-fare"
    >
      <View style={styles.fareTopRow}>
        <View style={styles.fareBadge}>
          <Text style={styles.fareBadgeText}>
            {tariff === "new" ? "NEW TARIFF" : "OLD TARIFF"}
          </Text>
        </View>
        <View style={[styles.sourcePill, { backgroundColor: sourceColor }]}>
          {meter.source === "obd" ? (
            <Cpu color="#fff" size={12} />
          ) : (
            <Satellite color="#fff" size={12} />
          )}
          <Text style={styles.sourcePillText}>{sourceLabel}</Text>
        </View>
      </View>

      <View style={styles.fareAmountRow}>
        <Text style={styles.fareCurrency}>RM</Text>
        <Text
          style={[styles.fareAmount, isLandscape && styles.fareAmountLandscape]}
          testID="meter-digital-total"
        >
          {fare.total.toFixed(2)}
        </Text>
      </View>

      <Text style={styles.fareBreakdown}>
        {tariff === "new"
          ? `Base RM ${fare.flagFall.toFixed(2)} + RM ${fare.variable.toFixed(
              2,
            )} for ${fare.distanceKm.toFixed(2)} km / ${Math.floor(
              fare.durationMin,
            )} min`
          : `Flag fall RM ${fare.flagFall.toFixed(2)} + ${fare.units} × RM 0.35 (${
              fare.distanceUnits
            } distance / ${fare.timeUnits} time)`}
      </Text>
    </View>
  );

  /* --- Live stats --- */
  const statsGrid = (
    <View style={styles.statsGrid}>
      {stats.map((s) => (
        <View key={s.id} style={[styles.statCard, cardStyle]}>
          <s.icon color={Colors.textSecondary} size={16} />
          <Text style={[styles.statValue, { color: Colors.text }]}>{s.value}</Text>
          <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );

  /* --- Source / vehicle link --- */
  const sourceCard = (
    <View style={[styles.card, cardStyle]} testID="meter-digital-link">
      <View style={styles.cardHeader}>
        <Cpu color={Colors.text} size={18} />
        <Text style={[styles.cardTitle, { color: Colors.text }]}>Fare source</Text>
      </View>
      <Text
        style={[
          styles.statusLine,
          { color: obdLinked ? "#22C55E" : canbus.connecting ? "#F59E0B" : Colors.textSecondary },
        ]}
      >
        {linkLine}
      </Text>
      <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
        The meter bills on the vehicle&apos;s OBD-II speed when the reader is
        linked, and switches to GPS the moment it isn&apos;t. This trip so far:{" "}
        {meter.obdSamples} OBD / {meter.gpsSamples} GPS samples.
      </Text>
      {gpsDenied ? (
        <View style={styles.warnRow}>
          <MapPin color="#EF4444" size={14} />
          <Text style={[styles.warnText, { color: "#EF4444" }]}>
            Location permission is off — without the reader the meter cannot
            measure distance.
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { borderColor: Colors.border },
            canbus.connecting && styles.buttonDisabled,
          ]}
          disabled={canbus.connecting}
          onPress={() => {
            if (online) void canbus.disconnect();
            else void canbus.connect();
          }}
          testID="meter-digital-link-toggle"
        >
          {canbus.connecting ? (
            <ActivityIndicator color={Colors.text} size="small" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
              {online ? "Disconnect reader" : "Connect reader"}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: Colors.border }]}
          onPress={() => router.push("/obd2-reader" as never)}
          testID="meter-digital-reader-settings"
        >
          <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
            Reader settings
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  /* --- Tariff --- */
  const tariffCard = (
    <View style={[styles.card, cardStyle]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: Colors.text }]}>Tariff</Text>
      </View>
      <View style={styles.tariffRow}>
        {(
          [
            { key: "old" as const, title: "Old", hint: "RM4 first km, then RM0.35 / 200 m or 36 s" },
            { key: "new" as const, title: "New", hint: "RM4 + RM1 / km + RM0.30 / min" },
          ]
        ).map((opt) => {
          const active = tariff === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.tariffChip,
                {
                  borderColor: active ? Colors.accent : Colors.border,
                  backgroundColor: active ? Colors.accent + "1A" : "transparent",
                },
              ]}
              onPress={() => setTariff(opt.key)}
              activeOpacity={0.85}
              testID={`meter-digital-tariff-${opt.key}`}
            >
              <Text
                style={[
                  styles.tariffChipTitle,
                  { color: active ? Colors.accent : Colors.text },
                ]}
              >
                {opt.title}
              </Text>
              <Text style={[styles.tariffChipHint, { color: Colors.textSecondary }]}>
                {opt.hint}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  /* --- Controls: the footer in portrait, the left column in landscape --- */
  const controls = (
    <>
      <TouchableOpacity
        style={[
          styles.primaryButton,
          { backgroundColor: meter.running ? "#F59E0B" : Colors.accent },
        ]}
        onPress={meter.running ? handlePause : handleStart}
        activeOpacity={0.9}
        testID="meter-digital-toggle"
      >
        {meter.running ? (
          <>
            <Pause color="#fff" size={18} fill="#fff" />
            <Text style={styles.primaryButtonText}>Pause meter</Text>
          </>
        ) : (
          <>
            <Play color="#fff" size={18} fill="#fff" />
            <Text style={styles.primaryButtonText}>
              {started ? "Resume meter" : "Start meter"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={[
            styles.footerButton,
            { borderColor: Colors.border },
            !started && styles.buttonDisabled,
          ]}
          disabled={!started}
          onPress={handleStop}
          activeOpacity={0.85}
          testID="meter-digital-stop"
        >
          <Square color={Colors.text} size={16} />
          <Text style={[styles.footerButtonText, { color: Colors.text }]}>
            Stop &amp; total
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.footerButton,
            { borderColor: Colors.border },
            !started && styles.buttonDisabled,
          ]}
          disabled={!started}
          onPress={handleReset}
          activeOpacity={0.85}
          testID="meter-digital-reset"
        >
          <RotateCcw color={Colors.text} size={16} />
          <Text style={[styles.footerButtonText, { color: Colors.text }]}>Clear</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isLightMode ? "dark-content" : "light-content"} />

      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ backgroundColor: Colors.background }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.back()}
            testID="meter-digital-back"
          >
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Meter Digital</Text>
            {params.plate ? (
              <Text style={[styles.headerSub, { color: Colors.textSecondary }]}>
                {params.plate}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerButton} />
        </View>
      </SafeAreaView>

      {isLandscape ? (
        // Landscape: the fare and the controls stay put on the left, everything
        // that can be read at a stop scrolls on the right.
        <View
          style={[
            styles.landscapeBody,
            {
              paddingLeft: insets.left + 16,
              paddingRight: insets.right + 16,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={styles.landscapeLeft}>
            {fareCard}
            <View style={styles.landscapeControls}>{controls}</View>
          </View>
          <ScrollView
            style={styles.landscapeRight}
            contentContainerStyle={styles.landscapeRightContent}
            showsVerticalScrollIndicator={false}
          >
            {statsGrid}
            {sourceCard}
            {tariffCard}
          </ScrollView>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + 32 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {fareCard}
            {statsGrid}
            {sourceCard}
            {tariffCard}
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                backgroundColor: Colors.background,
                borderTopColor: Colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            {controls}
          </View>
        </>
      )}

      {promptRotate ? (
        <RotateDeviceNotice
          state={lockState}
          onBack={() => router.back()}
          testID="meter-digital-rotate"
        />
      ) : null}
    </View>
  );
}

/** Narrow the telemetry reading to a finite, non-negative km/h value. */
function canbusSpeedOf(speed: number | undefined): number | null {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= 0
    ? speed
    : null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSub: { fontSize: 12, fontWeight: "600" as const, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },

  /* Landscape: fare + controls pinned left, the readable detail scrolls right. */
  landscapeBody: { flex: 1, flexDirection: "row", gap: 14, paddingTop: 4 },
  landscapeLeft: { flex: 1, gap: 12 },
  landscapeControls: { flex: 1, justifyContent: "flex-end", gap: 10 },
  landscapeRight: { flex: 1 },
  landscapeRightContent: { gap: 12, paddingBottom: 8 },

  fareCard: {
    borderRadius: 20,
    padding: 18,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  fareTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fareBadge: {
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  fareBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 0.6,
  },
  sourcePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  sourcePillText: { color: "#fff", fontSize: 11, fontWeight: "800" as const },
  fareAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  fareCurrency: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 20,
    fontWeight: "800" as const,
    marginBottom: 8,
  },
  fareAmount: {
    color: "#fff",
    fontSize: 56,
    fontWeight: "900" as const,
    letterSpacing: -1,
  },
  fareAmountLandscape: { fontSize: 46 },
  fareBreakdown: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600" as const },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  statValue: { fontSize: 20, fontWeight: "800" as const },
  statLabel: { fontSize: 11, fontWeight: "600" as const },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800" as const },
  cardBody: { fontSize: 12, lineHeight: 18 },
  statusLine: { fontSize: 13, fontWeight: "700" as const },
  warnRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  warnText: { flex: 1, fontSize: 12, fontWeight: "600" as const },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontSize: 13, fontWeight: "700" as const },
  buttonDisabled: { opacity: 0.5 },

  tariffRow: { flexDirection: "row", gap: 10 },
  tariffChip: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  tariffChipTitle: { fontSize: 14, fontWeight: "800" as const },
  tariffChipHint: { fontSize: 11, lineHeight: 15 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900" as const,
    letterSpacing: 0.3,
  },
  footerRow: { flexDirection: "row", gap: 10 },
  footerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
  },
  footerButtonText: { fontSize: 13, fontWeight: "700" as const },
});
