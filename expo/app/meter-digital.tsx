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
 * this screen owns the 1 Hz clock, the sensors, and the layout. What the
 * status panel says lives in `utils/meterDashboard.ts`, the trip log in
 * `utils/meterTripsStore.ts` and the receipt in `utils/meterReceipt.ts` — all
 * pure, all tested, so this file stays a dashboard.
 *
 * It is drawn as the instrument it replaces: a fixed dark console with segment
 * readouts, deliberately *not* following the app's light/dark theme. A meter is
 * read off a windscreen mount at night, and a white screen there is a hazard.
 *
 * The screen is landscape-only. It pins the device to landscape while it is
 * focused (`useLandscapeLock`) and hands rotation back on the way out. Where
 * that pin cannot happen — the web build, or a binary made before
 * `expo-screen-orientation` shipped — a portrait viewport gets the rotate
 * notice instead of a squeezed meter.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
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
import * as Network from "expo-network";
import * as Cellular from "expo-cellular";
import * as Print from "expo-print";
import {
  ArrowLeft,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  CarTaxiFront,
  ClipboardList,
  Cloud,
  CloudOff,
  Cpu,
  MapPin,
  MapPinOff,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Printer,
  Receipt,
  Settings as SettingsIcon,
  Signal,
  SignalZero,
  Sun,
  Trash2,
  User,
  Wifi,
  X,
} from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useCanbus } from "@/hooks/useCanbus";
import { useDeviceBattery } from "@/hooks/useDeviceBattery";
import { useLandscapeLock } from "@/hooks/useLandscapeLock";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import RotateDeviceNotice from "@/components/RotateDeviceNotice";
import SegmentDisplay from "@/components/SegmentDisplay";
import { TRANSPORT_LABEL } from "@/utils/canbus/types";
import { isLandscapeSize, shouldPromptRotate } from "@/utils/orientationLock";
import {
  describeMeterLink,
  describeMeterSubline,
  formatDashDate,
  formatDashTime,
  type MeterLinkTone,
} from "@/utils/meterDashboard";
import { buildMeterReceiptHtml } from "@/utils/meterReceipt";
import {
  clearMeterTrips,
  loadMeterTrips,
  recordMeterTrip,
  summarizeMeterTrips,
  type MeterTrip,
} from "@/utils/meterTripsStore";
import { uuidv4 } from "@/utils/supabase";
import {
  adjustExtra,
  applyMeterSample,
  computeMeterFare,
  createMeterState,
  EXTRA_STEP,
  formatMeterClock,
  formatMeterDistance,
  formatMeterKm,
  isNightPeriod,
  meterGrandTotal,
  NIGHT_MULTIPLIER,
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  pauseMeter,
  periodMultiplier,
  resetMeter,
  startMeter,
  WAITING_SPEED_KMH,
  type MeterPeriod,
  type MeterSample,
  type MeterState,
  type MeterTariff,
} from "@/utils/taxiMeter";

/** How often the meter folds a sensor sample in. Matches the OBD poll rate. */
const TICK_MS = 1000;

/**
 * The console palette. Fixed rather than themed — see the file header.
 */
const DASH = {
  bg: "#0A1E38",
  bgDeep: "#061729",
  panel: "#0E2848",
  panelEdge: "#1D4472",
  accent: "#3BA9E8",
  segment: "#F2A93B",
  plate: "#F5C542",
  danger: "#E23B3B",
  ok: "#22C55E",
  warn: "#F5A623",
  text: "#FFFFFF",
  muted: "#8FA8C4",
  dim: "#5C7896",
} as const;

/** Status colours by tone, for the trip-status panel and the tab dots. */
const TONE_COLOR: Record<MeterLinkTone, string> = {
  ok: "#22C55E",
  info: "#3BA9E8",
  warn: "#F5A623",
  bad: "#E23B3B",
};

type MeterTab = "ehailing" | "trips" | "printer" | "obd" | "settings";

const TABS: { id: MeterTab; label: string; icon: typeof CarTaxiFront }[] = [
  { id: "ehailing", label: "eHailing", icon: CarTaxiFront },
  { id: "trips", label: "TRIPS", icon: ClipboardList },
  { id: "printer", label: "PRINTER\nCONNECTION STATUS", icon: Printer },
  { id: "obd", label: "OBD\nCONNECTION STATUS", icon: Cpu },
  { id: "settings", label: "SETTINGS", icon: SettingsIcon },
];

interface LiveFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
}

export default function MeterDigitalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    tariff?: string;
    plate?: string;
    driver?: string;
    license?: string;
    photo?: string;
  }>();
  const { authState } = useAuth();
  const { appIconUri } = useBranding();
  const battery = useDeviceBattery();

  // Landscape-only: pinned while focused, with the rotate notice as the cover
  // for every platform/build where the pin cannot happen.
  const lockState = useLandscapeLock();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = isLandscapeSize(winWidth, winHeight);
  const promptRotate = shouldPromptRotate(lockState, winWidth, winHeight);
  // A landscape phone fits the instrument but not every chip in the header, so
  // the date — the one thing the driver is least likely to need — goes first.
  const compactHeader = winWidth < 820;

  /**
   * The readouts scale with the glass. The same meter is read off a 7-inch
   * dash tablet and off a phone in a cradle, and a fare that needs squinting at
   * is the one thing this screen may not produce, so the digits, the avatar and
   * the trip button all size off the viewport height rather than sitting at one
   * fixed point size.
   */
  const ui = useMemo(() => {
    const scale = Math.min(1.7, Math.max(0.8, winHeight / 430));
    const pad = Math.round(12 * scale);
    // What the grid actually gets once the header and the tab bar have taken
    // theirs. The fare readout is sized to fit its own panel rather than to a
    // fixed share of the viewport: on a phone in a cradle a "proportional"
    // digit is simply one that overflows the panel it lives in.
    const bodyHeight = Math.max(180, winHeight - 130);
    const fareRoom = Math.max(26, bodyHeight / 1.75 - (pad * 2 + 80));
    return {
      pad,
      gap: Math.round(9 * scale),
      fareSize: Math.round(Math.min(56 * scale, fareRoom / 1.3)),
      statSize: Math.round(28 * scale),
      nameSize: Math.round(19 * scale),
      statusSize: Math.round(22 * scale),
      buttonHeight: Math.round(56 * scale),
      buttonText: Math.round(19 * scale),
      avatar: Math.round(95 * scale),
      currencySize: Math.round(18 * scale),
    };
  }, [winHeight]);

  const { settings: displaySettings } = useDisplaySettings();
  // Same link the Teksi screen uses: auto-connect to the saved reader, and only
  // fall back to the simulator when partner-side simulation is switched on.
  const canbus = useCanbus({
    autoConnect: true,
    allowSimulator: displaySettings.partnerDriveSimEnabled,
  });

  const [tab, setTab] = useState<MeterTab>("ehailing");
  const [tariff, setTariff] = useState<MeterTariff>(
    params.tariff === "new" ? "new" : "old",
  );
  // The night shift is what the clock says at the moment the screen opens; the
  // driver can still override it with the DAY / NIGHT keys.
  const [period, setPeriod] = useState<MeterPeriod>(() =>
    isNightPeriod() ? "night" : "day",
  );
  const [meter, setMeter] = useState<MeterState>(createMeterState);
  const [extra, setExtra] = useState<number>(0);
  const [gpsDenied, setGpsDenied] = useState<boolean>(false);
  const [hasFix, setHasFix] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());

  const [trips, setTrips] = useState<MeterTrip[]>([]);
  const [lastTrip, setLastTrip] = useState<MeterTrip | null>(null);
  const [totalOpen, setTotalOpen] = useState<boolean>(false);
  const [printing, setPrinting] = useState<boolean>(false);

  // Latest sensor readings, held in refs so the 1 Hz tick can read them without
  // re-creating the interval on every telemetry update.
  const fixRef = useRef<LiveFix | null>(null);
  const hasFixRef = useRef<boolean>(false);
  const canbusRef = useRef(canbus.state);
  useEffect(() => {
    canbusRef.current = canbus.state;
  }, [canbus.state]);

  const canbusState = canbus.state;
  const online = canbusState.phase === "online";
  const obdLinked = online && !canbusState.simulated;
  const obdDemo = online && canbusState.simulated;

  // --- The trip log, the meter's own paper roll ---
  useEffect(() => {
    let cancelled = false;
    void loadMeterTrips().then((list) => {
      if (!cancelled) setTrips(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Network + cellular, for the header status cluster ---
  const network = Network.useNetworkState();
  const [cellularGeneration, setCellularGeneration] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Read silently: never prompt for READ_PHONE_STATE from a dash screen.
        if (Platform.OS === "android") {
          const perm = await Cellular.getPermissionsAsync();
          if (!perm.granted) return;
        }
        const generation = await Cellular.getCellularGenerationAsync();
        if (cancelled) return;
        const label =
          generation === Cellular.CellularGeneration.CELLULAR_5G
            ? "5G"
            : generation === Cellular.CellularGeneration.CELLULAR_4G
              ? "4G"
              : generation === Cellular.CellularGeneration.CELLULAR_3G
                ? "3G"
                : generation === Cellular.CellularGeneration.CELLULAR_2G
                  ? "2G"
                  : null;
        setCellularGeneration(label);
      } catch (e) {
        console.log("[meter-digital] cellular generation unavailable", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
              // Only render on the transition — fixes arrive far faster than
              // the meter needs to redraw.
              if (!hasFixRef.current) {
                hasFixRef.current = true;
                setHasFix(true);
              }
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
        hasFixRef.current = false;
        setHasFix(false);
      };
    }, []),
  );

  // --- The meter clock: one 1 Hz tick drives both the header and the accrual ---
  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const can = canbusRef.current;
      const fix = fixRef.current;
      // Demo Mode telemetry is invented, so it must never bill a fare: the
      // meter treats a simulated link as "no OBD" and runs on GPS instead.
      const useObd = can.phase === "online" && !can.simulated;
      const sample: MeterSample = {
        at,
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
      // A stopped meter ignores the sample and returns the same state object,
      // so this is a no-op render while parked.
      setMeter((prev) => applyMeterSample(prev, sample));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const fare = useMemo(
    () => computeMeterFare(meter, { tariff, multiplier: periodMultiplier(period) }),
    [meter, tariff, period],
  );
  const grandTotal = meterGrandTotal(fare.total, extra);

  const started = meter.startedAt !== null;
  const link = describeMeterLink({
    running: meter.running,
    source: meter.source,
    obdLinked,
    obdConnecting: canbus.connecting,
    obdDemo,
    hasGpsFix: hasFix,
    gpsDenied,
  });
  const linkColor = TONE_COLOR[link.tone];
  const subline = describeMeterSubline({
    running: meter.running,
    started,
    period,
    tariff,
  });

  // The reader's own state, separate from what the meter is billing on: a
  // demo link is amber (it exists but cannot bill), never the red of no link.
  const readerColor = obdLinked
    ? DASH.ok
    : canbus.connecting || obdDemo
      ? DASH.warn
      : DASH.danger;

  const linkLine = canbus.connecting
    ? "Connecting to the OBD-II reader…"
    : obdLinked
      ? `${canbusState.device?.name ?? "Reader"} linked${
          canbusState.bitrateKbps ? ` · ${canbusState.bitrateKbps} kbps` : ""
        }`
      : obdDemo
        ? "Demo Mode — virtual data, the meter bills on GPS"
        : canbusState.error ?? "No reader connected — the meter is billing on GPS";

  // --- Driver identity, as the permit screen handed it over ---
  const driverName = (params.driver ?? authState.profileName ?? "DRIVER").toUpperCase();
  const plate = params.plate ?? null;
  const license = params.license ?? null;
  const photo = params.photo ?? authState.profileAvatar ?? null;

  /* --- Controls --- */

  const handleStart = useCallback(() => {
    setMeter((prev) => startMeter(prev, Date.now()));
  }, []);

  const handlePauseToggle = useCallback(() => {
    setMeter((prev) => (prev.running ? pauseMeter(prev) : startMeter(prev, Date.now())));
  }, []);

  const handleNewTrip = useCallback(() => {
    setMeter(resetMeter());
    setExtra(0);
    setPeriod(isNightPeriod() ? "night" : "day");
  }, []);

  /** End the hire: stop accruing, write the record, show the total. */
  const handleEndTrip = useCallback(() => {
    const stopped = pauseMeter(meter);
    setMeter(stopped);
    void recordMeterTrip(stopped, {
      id: uuidv4(),
      endedAt: Date.now(),
      tariff,
      period,
      extra,
      plate,
      driver: driverName,
    }).then(({ trip, trips: list }) => {
      setLastTrip(trip);
      setTrips(list);
      setTotalOpen(true);
    });
  }, [driverName, extra, meter, period, plate, tariff]);

  const handleExtra = useCallback((steps: number) => {
    setExtra((prev) => adjustExtra(prev, steps));
  }, []);

  const printReceipt = useCallback(
    async (trip: MeterTrip | null) => {
      if (!trip) return;
      const html = buildMeterReceiptHtml(trip, {
        title: "GET TAXI METER",
        subtitle: license ? `Licence ${license}` : undefined,
      });
      try {
        setPrinting(true);
        if (Platform.OS === "web") {
          const w = window.open("", "_blank");
          if (w) {
            w.document.write(html);
            w.document.close();
            w.focus();
            setTimeout(() => {
              try {
                w.print();
              } catch (e) {
                console.log("[meter-digital] web print err", e);
              }
            }, 300);
          }
        } else {
          await Print.printAsync({ html });
        }
      } catch (e) {
        console.log("[meter-digital] print failed", e);
        Alert.alert(
          "Print failed",
          "Could not reach a printer. Check that one is set up in your device's print settings and try again.",
        );
      } finally {
        setPrinting(false);
      }
    },
    [license],
  );

  const handleClearLog = useCallback(() => {
    Alert.alert(
      "Clear the trip log?",
      "The receipts already printed are unaffected. This only clears the log kept on this device.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearMeterTrips().then(() => {
              setTrips([]);
              setLastTrip(null);
            });
          },
        },
      ],
    );
  }, []);

  /* --- Header status cluster --- */

  const netConnected = network.isInternetReachable ?? network.isConnected ?? null;
  const onWifi = network.type === Network.NetworkStateType.WIFI;
  const BatteryIcon = battery.charging
    ? BatteryCharging
    : battery.level === null
      ? BatteryFull
      : battery.level > 0.6
        ? BatteryFull
        : battery.level > 0.25
          ? BatteryMedium
          : BatteryLow;

  const statusCluster = (
    <View style={styles.statusCluster} testID="meter-digital-status-cluster">
      {gpsDenied ? (
        <MapPinOff color={DASH.danger} size={17} />
      ) : (
        <MapPin color={hasFix ? DASH.accent : DASH.muted} size={17} />
      )}
      {netConnected === false ? (
        <CloudOff color={DASH.danger} size={17} />
      ) : (
        <Cloud color={netConnected ? DASH.muted : DASH.dim} size={17} />
      )}
      <View style={styles.signalWrap}>
        {cellularGeneration ? (
          <Text style={styles.signalLabel}>{cellularGeneration}</Text>
        ) : null}
        {onWifi ? (
          <Wifi color={DASH.muted} size={17} />
        ) : netConnected ? (
          <Signal color={DASH.muted} size={17} />
        ) : (
          <SignalZero color={DASH.dim} size={17} />
        )}
      </View>
      {battery.level !== null ? (
        <View style={styles.signalWrap}>
          <BatteryIcon
            color={battery.level <= 0.15 && !battery.charging ? DASH.danger : DASH.muted}
            size={19}
          />
          <Text style={styles.signalLabel}>{Math.round(battery.level * 100)}%</Text>
        </View>
      ) : null}
      {compactHeader ? null : (
        <Text style={styles.headerDate}>{formatDashDate(now)}</Text>
      )}
      <Text style={styles.headerTime}>{formatDashTime(now)}</Text>
    </View>
  );

  /* --- Driver --- */

  const driverCard = (
    <View
      style={[styles.panel, styles.driverPanel, { padding: ui.pad }]}
      testID="meter-digital-driver"
    >
      <Text style={styles.panelLabel}>DRIVER</Text>
      <View style={styles.driverRow}>
        <View
          style={[styles.avatar, { width: ui.avatar, height: ui.avatar }]}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatarImage} />
          ) : (
            <User color={DASH.muted} size={Math.round(ui.avatar * 0.45)} />
          )}
        </View>
        <View style={styles.driverInfo}>
          <Text style={[styles.driverName, { fontSize: ui.nameSize }]} numberOfLines={2}>
            {driverName}
          </Text>
          <View style={styles.plateChip}>
            <Text style={styles.plateChipLabel}>PLATE</Text>
            <Text style={styles.plateChipValue} numberOfLines={1}>
              {plate ?? "—"}
            </Text>
          </View>
          <View style={styles.licenseRow}>
            <Text style={styles.licenseLabel}>LICENSE</Text>
            <Text style={styles.licenseValue} numberOfLines={1}>
              {license ?? "—"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  /* --- Trip control: START / END, with the meter's pause beside it --- */

  const tripControls = (
    <View style={styles.controlRow}>
      <TouchableOpacity
        style={[
          styles.primaryButton,
          {
            height: ui.buttonHeight,
            backgroundColor: meter.running
              ? DASH.danger
              : started
                ? DASH.accent
                : DASH.ok,
          },
        ]}
        onPress={meter.running ? handleEndTrip : started ? handleNewTrip : handleStart}
        activeOpacity={0.85}
        testID="meter-digital-toggle"
      >
        <CarTaxiFront color="#fff" size={Math.round(ui.buttonText * 1.3)} />
        <Text style={[styles.primaryButtonText, { fontSize: ui.buttonText }]}>
          {meter.running ? "END TRIP" : started ? "NEW TRIP" : "START TRIP"}
        </Text>
      </TouchableOpacity>
      {started ? (
        <TouchableOpacity
          style={[
            styles.pauseButton,
            { width: ui.buttonHeight, height: ui.buttonHeight },
          ]}
          onPress={handlePauseToggle}
          activeOpacity={0.85}
          testID="meter-digital-pause"
        >
          {meter.running ? (
            <Pause color={DASH.text} size={22} fill={DASH.text} />
          ) : (
            <Play color={DASH.text} size={22} fill={DASH.text} />
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );

  /* --- Time / distance --- */

  const statCard = (
    label: string,
    value: string,
    unit: string | null,
    testID: string,
  ) => (
    <View style={[styles.panel, styles.statPanel, { padding: ui.pad }]} testID={testID}>
      <Text style={styles.panelLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <View style={styles.statValueInner}>
          <SegmentDisplay value={value} size={ui.statSize} color={DASH.segment} />
          {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
        </View>
      </View>
    </View>
  );

  /* --- Fare --- */

  const fareCard = (
    <View
      style={[styles.panel, styles.farePanel, { padding: ui.pad }]}
      testID="meter-digital-fare"
    >
      <Text style={styles.panelLabel}>FARE</Text>
      <View style={styles.moneyRow}>
        <Text style={[styles.currency, { fontSize: ui.currencySize }]}>RM</Text>
        <SegmentDisplay
          value={fare.total.toFixed(2)}
          size={ui.fareSize}
          color={DASH.segment}
          testID="meter-digital-total"
        />
      </View>
      <View style={styles.keyRow}>
        {(["day", "night"] as const).map((key) => {
          const active = period === key;
          const Icon = key === "day" ? Sun : Moon;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.key, active && styles.keyActive]}
              onPress={() => setPeriod(key)}
              activeOpacity={0.8}
              testID={`meter-digital-period-${key}`}
            >
              <Icon color={active ? DASH.bgDeep : DASH.accent} size={14} />
              <Text style={[styles.keyText, active && styles.keyTextActive]}>
                {key === "day" ? "DAY" : "NIGHT"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {extra > 0 ? (
        <Text style={styles.fareTotalLine} numberOfLines={1}>
          TOTAL WITH EXTRA · RM {grandTotal.toFixed(2)}
        </Text>
      ) : null}
    </View>
  );

  /* --- Extras --- */

  const extraCard = (
    <View
      style={[styles.panel, styles.farePanel, { padding: ui.pad }]}
      testID="meter-digital-extra"
    >
      <Text style={styles.panelLabel}>EXTRA</Text>
      <View style={styles.moneyRow}>
        <Text style={[styles.currency, { fontSize: ui.currencySize }]}>RM</Text>
        <SegmentDisplay
          value={extra.toFixed(2)}
          size={ui.fareSize}
          color={DASH.segment}
        />
      </View>
      <View style={styles.keyRow}>
        <TouchableOpacity
          style={[styles.key, extra <= 0 && styles.keyDisabled]}
          disabled={extra <= 0}
          onPress={() => handleExtra(-1)}
          activeOpacity={0.8}
          testID="meter-digital-extra-down"
        >
          <Minus color={DASH.accent} size={18} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.key}
          onPress={() => handleExtra(1)}
          activeOpacity={0.8}
          testID="meter-digital-extra-up"
        >
          <Plus color={DASH.accent} size={18} />
        </TouchableOpacity>
      </View>
      {/* One line, always: a wrapped caption steals the height the readout
          above it needs on a phone-sized dash. */}
      <Text style={styles.fareTotalLine} numberOfLines={1}>
        RM {EXTRA_STEP.toFixed(2)} PER PRESS · TOLLS, FEES, LUGGAGE
      </Text>
    </View>
  );

  /* --- Trip status --- */

  const statusCard = (
    <View
      style={[styles.panel, styles.statusPanel, { padding: ui.pad }]}
      testID="meter-digital-link"
    >
      <Text style={styles.panelLabel}>TRIP STATUS</Text>
      <View style={styles.statusCenter}>
        <View style={styles.statusHeadline}>
          {link.fromVehicle ? (
            <Cpu color={linkColor} size={Math.round(ui.statusSize * 1.15)} />
          ) : (
            <MapPin
              color={linkColor}
              size={Math.round(ui.statusSize * 1.15)}
              fill={linkColor}
            />
          )}
          <Text style={[styles.statusText, { fontSize: ui.statusSize }]}>
            {link.label}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <Text style={styles.statusSub}>{subline}</Text>
      </View>
    </View>
  );

  /* --- The meter, as the mount sees it --- */

  const dashboard = (
    <View style={[styles.grid, !isLandscape && styles.gridStacked]}>
      <View style={styles.colLeft}>
        {driverCard}
        {tripControls}
        <View style={styles.pairRow}>
          {statCard("TIME", formatMeterClock(meter.elapsedMs), null, "meter-digital-time")}
          {statCard(
            "DISTANCE",
            formatMeterKm(meter.distanceM),
            "km",
            "meter-digital-distance",
          )}
        </View>
      </View>
      <View style={styles.colRight}>
        <View style={styles.pairRow}>
          {fareCard}
          {extraCard}
        </View>
        {statusCard}
      </View>
    </View>
  );

  /* --- Secondary tabs --- */

  /** A thin reminder of the live fare, so no tab hides a running meter. */
  const runningStrip = started ? (
    <View style={styles.runningStrip}>
      <View style={[styles.runningDot, { backgroundColor: linkColor }]} />
      <Text style={styles.runningText}>
        {meter.running ? "METER RUNNING" : "METER STOPPED"} · RM{" "}
        {grandTotal.toFixed(2)} · {formatMeterClock(meter.elapsedMs)} ·{" "}
        {formatMeterDistance(meter.distanceM)}
      </Text>
      <TouchableOpacity
        style={styles.stripButton}
        onPress={() => setTab("ehailing")}
        testID="meter-digital-strip-back"
      >
        <Text style={styles.stripButtonText}>OPEN METER</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  const tripsSummary = summarizeMeterTrips(trips);
  const tripsTab = (
    <View style={styles.tabBody}>
      {runningStrip}
      <View style={styles.summaryRow}>
        {[
          { label: "HIRES", value: String(tripsSummary.count) },
          { label: "DISTANCE", value: formatMeterDistance(tripsSummary.distanceM) },
          { label: "TAKINGS", value: `RM ${tripsSummary.total.toFixed(2)}` },
        ].map((s) => (
          <View key={s.label} style={[styles.panel, styles.summaryCard]}>
            <Text style={styles.panelLabel}>{s.label}</Text>
            <Text style={styles.summaryValue}>{s.value}</Text>
          </View>
        ))}
        <TouchableOpacity
          style={[styles.panel, styles.summaryCard, styles.clearCard]}
          onPress={handleClearLog}
          disabled={trips.length === 0}
          activeOpacity={0.85}
          testID="meter-digital-clear-log"
        >
          <Trash2 color={trips.length === 0 ? DASH.dim : DASH.danger} size={18} />
          <Text
            style={[
              styles.clearCardText,
              { color: trips.length === 0 ? DASH.dim : DASH.danger },
            ]}
          >
            CLEAR LOG
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {trips.length === 0 ? (
          <Text style={styles.emptyText}>
            No hires logged on this device yet. Every trip you end on the meter is
            recorded here, with the fare it charged and the source it measured on.
          </Text>
        ) : (
          trips.map((trip) => (
            <View key={trip.id} style={[styles.panel, styles.tripRow]}>
              <View style={styles.tripWhen}>
                <Text style={styles.tripDate}>{formatDashDate(trip.endedAt)}</Text>
                <Text style={styles.tripTime}>
                  {formatDashTime(trip.startedAt)} → {formatDashTime(trip.endedAt)}
                </Text>
              </View>
              <View style={styles.tripFacts}>
                <Text style={styles.tripFact}>
                  {formatMeterDistance(trip.distanceM)} ·{" "}
                  {formatMeterClock(trip.elapsedMs)}
                </Text>
                <Text style={styles.tripMeta}>
                  {trip.tariff === "new" ? "New rates" : "Old rates"} ·{" "}
                  {trip.period === "night" ? "Night" : "Day"} · {trip.obdSamples} OBD /{" "}
                  {trip.gpsSamples} GPS
                  {trip.extra > 0 ? ` · extras RM ${trip.extra.toFixed(2)}` : ""}
                </Text>
              </View>
              <Text style={styles.tripTotal}>RM {trip.total.toFixed(2)}</Text>
              <TouchableOpacity
                style={styles.tripPrint}
                onPress={() => void printReceipt(trip)}
                activeOpacity={0.85}
                testID={`meter-digital-print-${trip.id}`}
              >
                <Printer color={DASH.accent} size={18} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  const receiptTarget = lastTrip ?? trips[0] ?? null;
  const printerTab = (
    <View style={styles.tabBody}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>PRINTER</Text>
          <View style={styles.statusLineRow}>
            <View style={[styles.runningDot, { backgroundColor: DASH.warn }]} />
            <Text style={styles.statusLineText}>
              No dedicated receipt printer is paired with this build
            </Text>
          </View>
          <Text style={styles.bodyText}>
            The meter has no thermal-printer driver of its own, so receipts go to
            the print service your device already has — AirPrint, Google Cloud
            Print, or a Bluetooth printer set up in the system settings. Anything
            the OS can print to, the meter can print to.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>LAST RECEIPT</Text>
          {receiptTarget ? (
            <>
              <Text style={styles.receiptTotal}>
                RM {receiptTarget.total.toFixed(2)}
              </Text>
              <Text style={styles.bodyText}>
                {formatDashDate(receiptTarget.endedAt)} ·{" "}
                {formatDashTime(receiptTarget.startedAt)} →{" "}
                {formatDashTime(receiptTarget.endedAt)} ·{" "}
                {formatMeterDistance(receiptTarget.distanceM)} ·{" "}
                {formatMeterClock(receiptTarget.elapsedMs)}
              </Text>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  styles.soloButton,
                  printing && styles.buttonDisabled,
                ]}
                disabled={printing}
                onPress={() => void printReceipt(receiptTarget)}
                activeOpacity={0.85}
                testID="meter-digital-print-last"
              >
                {printing ? (
                  <ActivityIndicator color={DASH.text} size="small" />
                ) : (
                  <>
                    <Receipt color={DASH.text} size={18} />
                    <Text style={styles.wideButtonText}>PRINT RECEIPT</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.emptyText}>
              Nothing to print yet — end a trip and its receipt appears here.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );

  const obdTab = (
    <View style={styles.tabBody}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>OBD-II READER</Text>
          <View style={styles.statusLineRow}>
            <View style={[styles.runningDot, { backgroundColor: readerColor }]} />
            <Text style={styles.statusLineText}>{linkLine}</Text>
          </View>
          <Text style={styles.bodyText}>
            The meter bills on the vehicle&apos;s OBD-II speed when the reader is
            linked, and switches to GPS the moment it isn&apos;t. Demo Mode never
            bills a fare — simulated telemetry is not a vehicle. This trip so far:{" "}
            {meter.obdSamples} OBD / {meter.gpsSamples} GPS samples.
          </Text>
          {canbusState.device ? (
            <Text style={styles.bodyMuted}>
              {TRANSPORT_LABEL[canbusState.device.transport]} ·{" "}
              {canbusState.device.name}
              {canbusState.protocol ? ` · ${canbusState.protocol}` : ""}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.wideButton, canbus.connecting && styles.buttonDisabled]}
              disabled={canbus.connecting}
              onPress={() => {
                if (online) void canbus.disconnect();
                else void canbus.connect();
              }}
              activeOpacity={0.85}
              testID="meter-digital-link-toggle"
            >
              {canbus.connecting ? (
                <ActivityIndicator color={DASH.text} size="small" />
              ) : (
                <Text style={styles.wideButtonText}>
                  {online ? "DISCONNECT READER" : "CONNECT READER"}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.wideButton, styles.ghostButton]}
              onPress={() => router.push("/obd2-reader" as never)}
              activeOpacity={0.85}
              testID="meter-digital-reader-settings"
            >
              <Text style={styles.wideButtonText}>READER SETTINGS</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>SATELLITES</Text>
          <View style={styles.statusLineRow}>
            <View
              style={[
                styles.runningDot,
                {
                  backgroundColor: gpsDenied
                    ? DASH.danger
                    : hasFix
                      ? DASH.ok
                      : DASH.warn,
                },
              ]}
            />
            <Text style={styles.statusLineText}>
              {gpsDenied
                ? "Location permission is off"
                : hasFix
                  ? "GPS fix acquired"
                  : "Waiting for a GPS fix"}
            </Text>
          </View>
          <Text style={styles.bodyText}>
            {gpsDenied
              ? "Without the reader and without location, the meter cannot measure distance at all. Grant location access in your device settings."
              : `GPS is the meter's fallback. Speeds at or below ${WAITING_SPEED_KMH} km/h count as waiting time rather than travel.`}
          </Text>
        </View>
      </ScrollView>
    </View>
  );

  const settingsTab = (
    <View style={styles.tabBody}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>TARIFF</Text>
          <View style={styles.tariffRow}>
            {(
              [
                {
                  key: "old" as const,
                  title: "OLD RATES",
                  hint: "RM4 first km, then RM0.35 per 200 m or 36 s",
                },
                {
                  key: "new" as const,
                  title: "NEW RATES",
                  hint: "RM4 + RM1 per km + RM0.30 per minute",
                },
              ]
            ).map((opt) => {
              const active = tariff === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.tariffChip, active && styles.tariffChipActive]}
                  onPress={() => setTariff(opt.key)}
                  activeOpacity={0.85}
                  testID={`meter-digital-tariff-${opt.key}`}
                >
                  <Text
                    style={[
                      styles.tariffChipTitle,
                      { color: active ? DASH.accent : DASH.text },
                    ]}
                  >
                    {opt.title}
                  </Text>
                  <Text style={styles.tariffChipHint}>{opt.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.bodyMuted}>
            Changing the tariff re-prices the running meter from its own totals —
            distance and time are not re-measured.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>SHIFT</Text>
          <Text style={styles.bodyText}>
            The night shift adds {Math.round((NIGHT_MULTIPLIER - 1) * 100)}% to the
            whole fare and runs from{" "}
            {NIGHT_START_HOUR.toString().padStart(2, "0")}:00 to{" "}
            {NIGHT_END_HOUR.toString().padStart(2, "0")}:00. The meter picks the
            shift from the clock when it opens; the DAY / NIGHT keys override it.
          </Text>
          <View style={styles.tariffRow}>
            {(["day", "night"] as const).map((key) => {
              const active = period === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.tariffChip, active && styles.tariffChipActive]}
                  onPress={() => setPeriod(key)}
                  activeOpacity={0.85}
                  testID={`meter-digital-shift-${key}`}
                >
                  <Text
                    style={[
                      styles.tariffChipTitle,
                      { color: active ? DASH.accent : DASH.text },
                    ]}
                  >
                    {key === "day" ? "DAY" : "NIGHT"}
                  </Text>
                  <Text style={styles.tariffChipHint}>
                    {key === "day" ? "No surcharge" : `× ${NIGHT_MULTIPLIER.toFixed(1)}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>METER</Text>
          <Text style={styles.bodyText}>
            Clearing the meter zeroes the fare, the clock, the distance and the
            extras. It does not touch the trip log.
          </Text>
          <TouchableOpacity
            style={[
              styles.wideButton,
              styles.ghostButton,
              styles.soloButton,
              !started && styles.buttonDisabled,
            ]}
            disabled={!started}
            onPress={handleNewTrip}
            activeOpacity={0.85}
            testID="meter-digital-reset"
          >
            <Text style={styles.wideButtonText}>CLEAR METER</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  const body =
    tab === "trips"
      ? tripsTab
      : tab === "printer"
        ? printerTab
        : tab === "obd"
          ? obdTab
          : tab === "settings"
            ? settingsTab
            : dashboard;

  return (
    <View style={styles.container}>
      {/* The meter draws its own status cluster, so the OS bar is redundant
          here — and a dash instrument wants the whole glass. */}
      <StatusBar barStyle="light-content" hidden />

      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            testID="meter-digital-back"
          >
            <ArrowLeft color={DASH.muted} size={20} />
          </TouchableOpacity>
          <Image
            source={appIconUri ? { uri: appIconUri } : require("@/assets/images/icon.png")}
            style={styles.brandLogo}
            resizeMode="contain"
          />
          <Text style={styles.brandTitle} numberOfLines={1}>
            GET TAXI METER
          </Text>
          <View style={styles.headerSpacer} />
          {statusCluster}
        </View>
      </SafeAreaView>

      <View
        style={[
          styles.bodyWrap,
          { paddingLeft: insets.left + 14, paddingRight: insets.right + 14 },
        ]}
      >
        {body}
      </View>

      <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.tabItem}
              onPress={() => setTab(item.id)}
              activeOpacity={0.8}
              testID={`meter-digital-tab-${item.id}`}
            >
              <item.icon color={active ? DASH.accent : DASH.muted} size={24} />
              <Text
                style={[styles.tabLabel, { color: active ? DASH.accent : DASH.muted }]}
              >
                {item.label}
              </Text>
              {item.id === "obd" ? (
                <View style={[styles.tabDot, { backgroundColor: readerColor }]} />
              ) : null}
              {active ? <View style={styles.tabUnderline} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* The end-of-hire total: the moment the receipt exists. */}
      <Modal
        visible={totalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTotalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="meter-digital-total-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>FARE DUE</Text>
              <TouchableOpacity
                onPress={() => setTotalOpen(false)}
                style={styles.modalClose}
                testID="meter-digital-total-close"
              >
                <X color={DASH.muted} size={20} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalAmount}>
              <Text style={styles.currency}>RM</Text>
              <SegmentDisplay
                value={(lastTrip?.total ?? grandTotal).toFixed(2)}
                size={62}
                color={DASH.segment}
              />
            </View>
            {lastTrip ? (
              <View style={styles.modalRows}>
                {[
                  { label: "Distance", value: formatMeterDistance(lastTrip.distanceM) },
                  { label: "Trip time", value: formatMeterClock(lastTrip.elapsedMs) },
                  { label: "Waiting", value: formatMeterClock(lastTrip.waitingMs) },
                  { label: "Metered fare", value: `RM ${lastTrip.fare.toFixed(2)}` },
                  ...(lastTrip.extra > 0
                    ? [{ label: "Extras", value: `RM ${lastTrip.extra.toFixed(2)}` }]
                    : []),
                  {
                    label: "Measured on",
                    value:
                      lastTrip.obdSamples >= lastTrip.gpsSamples && lastTrip.obdSamples > 0
                        ? `OBD-II (${lastTrip.obdSamples} / ${lastTrip.gpsSamples} GPS)`
                        : `GPS (${lastTrip.gpsSamples} / ${lastTrip.obdSamples} OBD)`,
                  },
                ].map((row) => (
                  <View key={row.label} style={styles.modalRow}>
                    <Text style={styles.modalRowLabel}>{row.label}</Text>
                    <Text style={styles.modalRowValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.wideButton, styles.ghostButton, printing && styles.buttonDisabled]}
                disabled={printing}
                onPress={() => void printReceipt(lastTrip)}
                activeOpacity={0.85}
                testID="meter-digital-total-print"
              >
                {printing ? (
                  <ActivityIndicator color={DASH.text} size="small" />
                ) : (
                  <>
                    <Printer color={DASH.text} size={18} />
                    <Text style={styles.wideButtonText}>PRINT RECEIPT</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.wideButton, { backgroundColor: DASH.accent }]}
                onPress={() => {
                  setTotalOpen(false);
                  handleNewTrip();
                }}
                activeOpacity={0.85}
                testID="meter-digital-total-new"
              >
                <Text style={styles.wideButtonText}>NEW TRIP</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  container: { flex: 1, backgroundColor: DASH.bg },

  /* Header */
  headerSafe: { backgroundColor: DASH.bgDeep },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  brandLogo: { width: 28, height: 28, borderRadius: 7 },
  brandTitle: {
    flexShrink: 1,
    color: DASH.text,
    fontSize: 17,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  headerSpacer: { flex: 1, minWidth: 8 },
  statusCluster: { flexDirection: "row", alignItems: "center", gap: 10 },
  signalWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  signalLabel: { color: DASH.muted, fontSize: 10, fontWeight: "800" as const },
  headerDate: {
    color: DASH.text,
    fontSize: 13,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  headerTime: {
    color: DASH.text,
    fontSize: 13,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },

  /* Body */
  bodyWrap: { flex: 1, paddingTop: 10, paddingBottom: 6 },
  grid: { flex: 1, flexDirection: "row", gap: 12 },
  gridStacked: { flexDirection: "column" },
  colLeft: { flex: 1, gap: 10 },
  colRight: { flex: 1.85, gap: 10 },
  pairRow: { flexDirection: "row", gap: 10, flex: 1 },

  panel: {
    backgroundColor: DASH.panel,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
    padding: 12,
    gap: 8,
  },
  panelLabel: {
    color: DASH.text,
    fontSize: 12,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },

  /* Driver */
  driverPanel: { flex: 1.25 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  driverInfo: { flex: 1, gap: 6 },
  driverName: {
    color: DASH.text,
    fontSize: 21,
    fontWeight: "900" as const,
    letterSpacing: 0.4,
  },
  plateChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    backgroundColor: DASH.plate,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  plateChipLabel: { color: "#5A4A00", fontSize: 11, fontWeight: "800" as const },
  plateChipValue: {
    color: "#1A1A1A",
    fontSize: 15,
    fontWeight: "900" as const,
    letterSpacing: 0.5,
  },
  licenseRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  licenseLabel: { color: DASH.muted, fontSize: 11, fontWeight: "700" as const },
  licenseValue: { color: DASH.muted, fontSize: 13, fontWeight: "700" as const },

  /* Trip control */
  controlRow: { flexDirection: "row", gap: 10 },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    height: 62,
    borderRadius: 14,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "900" as const,
    letterSpacing: 1,
  },
  pauseButton: {
    width: 62,
    height: 62,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DASH.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
  },

  /* Time / distance */
  statPanel: { flex: 1 },
  statValueRow: { flex: 1, justifyContent: "center" },
  // The unit rides the digits' baseline, as it does on a physical meter.
  statValueInner: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  statUnit: {
    color: DASH.muted,
    fontSize: 13,
    fontWeight: "700" as const,
    marginBottom: 4,
  },

  /* Fare / extras */
  farePanel: { flex: 1 },
  moneyRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  currency: { color: DASH.segment, fontSize: 20, fontWeight: "900" as const },
  keyRow: { flexDirection: "row", gap: 10 },
  key: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: DASH.accent,
  },
  keyActive: { backgroundColor: DASH.accent },
  keyDisabled: { opacity: 0.4 },
  keyText: {
    color: DASH.accent,
    fontSize: 13,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  keyTextActive: { color: DASH.bgDeep },
  fareTotalLine: {
    color: DASH.muted,
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.4,
  },

  /* Trip status */
  statusPanel: { flex: 0.7 },
  statusCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  statusHeadline: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusText: {
    color: DASH.text,
    fontSize: 26,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  statusDivider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginHorizontal: 24,
    backgroundColor: DASH.panelEdge,
  },
  statusSub: { color: DASH.muted, fontSize: 14, fontWeight: "600" as const },

  /* Secondary tabs */
  // Capped: a 10-inch dash screen would otherwise run these paragraphs the
  // whole width of the glass, which is a line length nobody reads at a glance.
  tabBody: { flex: 1, gap: 10, width: "100%", maxWidth: 1180, alignSelf: "center" },
  tabScroll: { flex: 1 },
  tabScrollContent: { gap: 10, paddingBottom: 8 },
  runningStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: DASH.panel,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  runningDot: { width: 9, height: 9, borderRadius: 5 },
  runningText: {
    flex: 1,
    color: DASH.text,
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.4,
  },
  stripButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: DASH.accent,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  stripButtonText: { color: DASH.accent, fontSize: 11, fontWeight: "800" as const },

  summaryRow: { flexDirection: "row", gap: 10 },
  summaryCard: { flex: 1 },
  summaryValue: { color: DASH.segment, fontSize: 22, fontWeight: "900" as const },
  clearCard: { alignItems: "center", justifyContent: "center", gap: 6 },
  clearCardText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 0.6 },

  tripRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tripWhen: { width: 180, gap: 2 },
  tripDate: { color: DASH.text, fontSize: 13, fontWeight: "800" as const },
  tripTime: { color: DASH.muted, fontSize: 11, fontWeight: "600" as const },
  tripFacts: { flex: 1, gap: 2 },
  tripFact: { color: DASH.text, fontSize: 13, fontWeight: "700" as const },
  tripMeta: { color: DASH.muted, fontSize: 11, fontWeight: "600" as const },
  tripTotal: { color: DASH.segment, fontSize: 19, fontWeight: "900" as const },
  tripPrint: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: DASH.panelEdge,
  },

  statusLineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusLineText: { flex: 1, color: DASH.text, fontSize: 13, fontWeight: "700" as const },
  bodyText: { color: DASH.muted, fontSize: 12, lineHeight: 18 },
  bodyMuted: { color: DASH.dim, fontSize: 11, lineHeight: 16 },
  emptyText: { color: DASH.muted, fontSize: 13, lineHeight: 20 },
  receiptTotal: { color: DASH.segment, fontSize: 30, fontWeight: "900" as const },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  wideButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: DASH.panelEdge,
  },
  ghostButton: { backgroundColor: "transparent" },
  /** A button that stands alone in a panel, rather than sharing an action row. */
  soloButton: { flex: 0, alignSelf: "flex-start", paddingHorizontal: 24 },
  wideButtonText: {
    color: DASH.text,
    fontSize: 13,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
  },
  buttonDisabled: { opacity: 0.45 },

  tariffRow: { flexDirection: "row", gap: 10 },
  tariffChip: {
    flex: 1,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: DASH.panelEdge,
    padding: 10,
    gap: 4,
  },
  tariffChipActive: { borderColor: DASH.accent, backgroundColor: "rgba(59,169,232,0.12)" },
  tariffChipTitle: { fontSize: 13, fontWeight: "800" as const, letterSpacing: 0.6 },
  tariffChipHint: { color: DASH.muted, fontSize: 11, lineHeight: 15 },

  /* Tab bar */
  tabBar: {
    flexDirection: "row",
    backgroundColor: DASH.bgDeep,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DASH.panelEdge,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingTop: 9,
    paddingBottom: 11,
    paddingHorizontal: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  tabDot: {
    position: "absolute",
    top: 8,
    right: "32%",
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tabUnderline: {
    position: "absolute",
    left: "18%",
    right: "18%",
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: DASH.accent,
  },

  /* Total modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(3,10,20,0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: DASH.panel,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
    padding: 18,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center" },
  modalTitle: {
    flex: 1,
    color: DASH.text,
    fontSize: 14,
    fontWeight: "800" as const,
    letterSpacing: 1.2,
  },
  modalClose: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  modalAmount: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  modalRows: { gap: 5 },
  modalRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  modalRowLabel: { color: DASH.muted, fontSize: 12, fontWeight: "600" as const },
  modalRowValue: { color: DASH.text, fontSize: 12, fontWeight: "700" as const },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 2 },
});
