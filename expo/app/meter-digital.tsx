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
 *
 * Nothing here is drawn at a fixed point size. Every padding, icon, key and
 * word comes from `computeMeterMetrics` (pure + tested), which fits the whole
 * console to the viewport it is being drawn into — a phone in a cradle and a
 * 10-inch dash tablet get the same instrument, scaled. Text that lives inside
 * a control shrinks to its box on top of that (`FitText`) and ignores the OS
 * font-size setting, because a clipped fare or a half-drawn key is not a thing
 * a taxi meter may show.
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
  type StyleProp,
  type TextStyle,
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
import { computeMeterMetrics, fitDigits, type MeterMetrics } from "@/utils/meterScale";
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

/**
 * A word that must fit the box it is in.
 *
 * `computeMeterMetrics` already sizes the type to the viewport; this is the
 * second line of defence for the strings that cannot be predicted — a long
 * driver name, a plate from another state, a fare that grew a digit.
 *
 * Two things do that. It never follows the OS font scale, because a dash
 * instrument's layout is fixed by the glass rather than by a phone's
 * accessibility setting — a wound-up system font would otherwise push the fare
 * out of its panel. And it asks for shrink-to-fit, which iOS honours; where the
 * platform ignores it (Android, web) the metrics are what keep the word inside
 * its box, and the panel's `overflow: hidden` is the backstop.
 */
function FitText({
  style,
  size,
  lines = 1,
  minimumScale = 0.6,
  children,
  testID,
}: {
  style?: StyleProp<TextStyle>;
  size: number;
  lines?: number;
  minimumScale?: number;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Text
      style={[style, { fontSize: size }]}
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={minimumScale}
      allowFontScaling={false}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** The small caps heading every panel carries. Always one line. */
function PanelLabel({ ui, children }: { ui: MeterMetrics; children: React.ReactNode }) {
  return (
    <FitText style={styles.panelLabel} size={ui.panelLabel}>
      {children}
    </FitText>
  );
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

  /**
   * Every size on the console, fitted to the glass it is drawn on — see
   * `utils/meterScale.ts`. Nothing below reads a hardcoded point size.
   */
  const ui = useMemo(
    () => computeMeterMetrics(winWidth, winHeight),
    [winWidth, winHeight],
  );

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

  // The end-of-hire total is drawn in a card that is itself a share of the
  // glass, so the digits are fitted to the card rather than to the viewport.
  const modalAmountSize = useMemo(() => {
    const cardWidth = Math.min(520, winWidth * 0.8);
    return Math.round(
      Math.max(
        22,
        Math.min(
          ui.modalAmount,
          fitDigits(cardWidth, 6, ui.pad * 2.8 + ui.currencySize * 1.6 + ui.gap),
        ),
      ),
    );
  }, [ui, winWidth]);

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
    <View style={[styles.statusCluster, { gap: ui.gap }]} testID="meter-digital-status-cluster">
      {gpsDenied ? (
        <MapPinOff color={DASH.danger} size={ui.headerIcon} />
      ) : (
        <MapPin color={hasFix ? DASH.accent : DASH.muted} size={ui.headerIcon} />
      )}
      {netConnected === false ? (
        <CloudOff color={DASH.danger} size={ui.headerIcon} />
      ) : (
        <Cloud color={netConnected ? DASH.muted : DASH.dim} size={ui.headerIcon} />
      )}
      <View style={styles.signalWrap}>
        {cellularGeneration ? (
          <FitText style={styles.signalLabel} size={ui.smallText}>
            {cellularGeneration}
          </FitText>
        ) : null}
        {onWifi ? (
          <Wifi color={DASH.muted} size={ui.headerIcon} />
        ) : netConnected ? (
          <Signal color={DASH.muted} size={ui.headerIcon} />
        ) : (
          <SignalZero color={DASH.dim} size={ui.headerIcon} />
        )}
      </View>
      {battery.level !== null ? (
        <View style={styles.signalWrap}>
          <BatteryIcon
            color={battery.level <= 0.15 && !battery.charging ? DASH.danger : DASH.muted}
            size={Math.round(ui.headerIcon * 1.1)}
          />
          <FitText style={styles.signalLabel} size={ui.smallText}>
            {Math.round(battery.level * 100)}%
          </FitText>
        </View>
      ) : null}
      {/* A small landscape phone fits the instrument but not every chip in the
          header, so the date — the one thing the driver is least likely to
          need — goes before anything else is allowed to shrink. */}
      {ui.showHeaderDate ? (
        <FitText style={styles.headerDate} size={ui.headerText}>
          {formatDashDate(now)}
        </FitText>
      ) : null}
      <FitText style={styles.headerTime} size={ui.headerText}>
        {formatDashTime(now)}
      </FitText>
    </View>
  );

  /* --- Driver --- */

  const driverCard = (
    <View
      style={[styles.panel, styles.driverPanel, { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius }]}
      testID="meter-digital-driver"
    >
      <PanelLabel ui={ui}>DRIVER</PanelLabel>
      <View style={[styles.driverRow, { gap: ui.gap }]}>
        <View
          style={[styles.avatar, { width: ui.avatar, height: ui.avatar }]}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatarImage} />
          ) : (
            <User color={DASH.muted} size={Math.round(ui.avatar * 0.45)} />
          )}
        </View>
        <View style={[styles.driverInfo, { gap: Math.round(ui.gap * 0.7) }]}>
          {/* Two lines, then shrink: a long name must not push the plate out
              of the panel. */}
          <FitText style={styles.driverName} size={ui.nameSize} lines={2} minimumScale={0.55}>
            {driverName}
          </FitText>
          <View
            style={[
              styles.plateChip,
              {
                gap: Math.round(ui.gap * 0.8),
                paddingVertical: Math.round(ui.pad * 0.35),
                paddingHorizontal: Math.round(ui.pad * 0.7),
              },
            ]}
          >
            <FitText style={styles.plateChipLabel} size={ui.captionText}>
              PLATE
            </FitText>
            <FitText style={styles.plateChipValue} size={ui.rowText}>
              {plate ?? "—"}
            </FitText>
          </View>
          <View style={[styles.licenseRow, { gap: Math.round(ui.gap * 0.8) }]}>
            <FitText style={styles.licenseLabel} size={ui.captionText}>
              LICENSE
            </FitText>
            <FitText style={styles.licenseValue} size={ui.captionText}>
              {license ?? "—"}
            </FitText>
          </View>
        </View>
      </View>
    </View>
  );

  /* --- Trip control: START / END, with the meter's pause beside it --- */

  const tripControls = (
    <View style={[styles.controlRow, { gap: ui.gap }]}>
      <TouchableOpacity
        style={[
          styles.primaryButton,
          {
            height: ui.buttonHeight,
            gap: ui.gap,
            borderRadius: ui.radius,
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
        <FitText style={styles.primaryButtonText} size={ui.buttonText}>
          {meter.running ? "END TRIP" : started ? "NEW TRIP" : "START TRIP"}
        </FitText>
      </TouchableOpacity>
      {started ? (
        <TouchableOpacity
          style={[
            styles.pauseButton,
            { width: ui.buttonHeight, height: ui.buttonHeight, borderRadius: ui.radius },
          ]}
          onPress={handlePauseToggle}
          activeOpacity={0.85}
          testID="meter-digital-pause"
        >
          {meter.running ? (
            <Pause color={DASH.text} size={Math.round(ui.buttonHeight * 0.4)} fill={DASH.text} />
          ) : (
            <Play color={DASH.text} size={Math.round(ui.buttonHeight * 0.4)} fill={DASH.text} />
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
    <View
      style={[
        styles.panel,
        styles.statPanel,
        { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius },
      ]}
      testID={testID}
    >
      <PanelLabel ui={ui}>{label}</PanelLabel>
      <View style={styles.statValueRow}>
        <View style={[styles.statValueInner, { gap: Math.round(ui.gap * 0.6) }]}>
          <SegmentDisplay value={value} size={ui.statSize} color={DASH.segment} />
          {unit ? (
            <Text
              style={[
                styles.statUnit,
                { fontSize: ui.captionText, marginBottom: Math.round(ui.statSize * 0.14) },
              ]}
              allowFontScaling={false}
            >
              {unit}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  /* --- Fare --- */

  const fareCard = (
    <View
      style={[
        styles.panel,
        styles.farePanel,
        { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius },
      ]}
      testID="meter-digital-fare"
    >
      <PanelLabel ui={ui}>FARE</PanelLabel>
      <View style={[styles.moneyRow, { gap: Math.round(ui.gap * 0.9) }]}>
        <Text
          style={[styles.currency, { fontSize: ui.currencySize }]}
          allowFontScaling={false}
        >
          RM
        </Text>
        <SegmentDisplay
          value={fare.total.toFixed(2)}
          size={ui.fareSize}
          color={DASH.segment}
          testID="meter-digital-total"
        />
      </View>
      <View style={[styles.keyRow, { gap: ui.gap }]}>
        {(["day", "night"] as const).map((key) => {
          const active = period === key;
          const Icon = key === "day" ? Sun : Moon;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.key,
                {
                  height: ui.keyHeight,
                  gap: Math.round(ui.gap * 0.6),
                  borderRadius: Math.round(ui.radius * 0.65),
                },
                active && styles.keyActive,
              ]}
              onPress={() => setPeriod(key)}
              activeOpacity={0.8}
              testID={`meter-digital-period-${key}`}
            >
              <Icon color={active ? DASH.bgDeep : DASH.accent} size={ui.keyIcon} />
              <FitText
                style={[styles.keyText, active && styles.keyTextActive]}
                size={ui.keyText}
              >
                {key === "day" ? "DAY" : "NIGHT"}
              </FitText>
            </TouchableOpacity>
          );
        })}
      </View>
      {extra > 0 ? (
        <FitText style={styles.fareTotalLine} size={ui.smallText}>
          TOTAL WITH EXTRA · RM {grandTotal.toFixed(2)}
        </FitText>
      ) : null}
    </View>
  );

  /* --- Extras --- */

  const extraCard = (
    <View
      style={[
        styles.panel,
        styles.farePanel,
        { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius },
      ]}
      testID="meter-digital-extra"
    >
      <PanelLabel ui={ui}>EXTRA</PanelLabel>
      <View style={[styles.moneyRow, { gap: Math.round(ui.gap * 0.9) }]}>
        <Text
          style={[styles.currency, { fontSize: ui.currencySize }]}
          allowFontScaling={false}
        >
          RM
        </Text>
        <SegmentDisplay
          value={extra.toFixed(2)}
          size={ui.fareSize}
          color={DASH.segment}
        />
      </View>
      <View style={[styles.keyRow, { gap: ui.gap }]}>
        <TouchableOpacity
          style={[
            styles.key,
            { height: ui.keyHeight, borderRadius: Math.round(ui.radius * 0.65) },
            extra <= 0 && styles.keyDisabled,
          ]}
          disabled={extra <= 0}
          onPress={() => handleExtra(-1)}
          activeOpacity={0.8}
          testID="meter-digital-extra-down"
        >
          <Minus color={DASH.accent} size={ui.iconSize} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.key,
            { height: ui.keyHeight, borderRadius: Math.round(ui.radius * 0.65) },
          ]}
          onPress={() => handleExtra(1)}
          activeOpacity={0.8}
          testID="meter-digital-extra-up"
        >
          <Plus color={DASH.accent} size={ui.iconSize} />
        </TouchableOpacity>
      </View>
      {/* One line, always: a wrapped caption steals the height the readout
          above it needs on a phone-sized dash. */}
      <FitText style={styles.fareTotalLine} size={ui.smallText}>
        RM {EXTRA_STEP.toFixed(2)} PER PRESS · TOLLS, FEES, LUGGAGE
      </FitText>
    </View>
  );

  /* --- Trip status --- */

  const statusCard = (
    <View
      style={[
        styles.panel,
        styles.statusPanel,
        { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius },
      ]}
      testID="meter-digital-link"
    >
      <PanelLabel ui={ui}>TRIP STATUS</PanelLabel>
      <View style={[styles.statusCenter, { gap: Math.round(ui.gap * 0.9) }]}>
        <View style={[styles.statusHeadline, { gap: ui.gap }]}>
          {link.fromVehicle ? (
            <Cpu color={linkColor} size={Math.round(ui.statusSize * 1.15)} />
          ) : (
            <MapPin
              color={linkColor}
              size={Math.round(ui.statusSize * 1.15)}
              fill={linkColor}
            />
          )}
          {/* The headline is the one line the driver reads at a glance, so it
              shrinks to the panel rather than wrapping or being clipped. */}
          <FitText style={[styles.statusText, styles.statusFlex]} size={ui.statusSize}>
            {link.label}
          </FitText>
        </View>
        <View style={[styles.statusDivider, { marginHorizontal: ui.pad * 2 }]} />
        <FitText style={styles.statusSub} size={ui.rowText}>
          {subline}
        </FitText>
      </View>
    </View>
  );

  /* --- The meter, as the mount sees it --- */

  const dashboard = (
    <View style={[styles.grid, { gap: ui.gap }, !isLandscape && styles.gridStacked]}>
      <View style={[styles.colLeft, { gap: ui.gap }]}>
        {driverCard}
        {tripControls}
        <View style={[styles.pairRow, { gap: ui.gap }]}>
          {statCard("TIME", formatMeterClock(meter.elapsedMs), null, "meter-digital-time")}
          {statCard(
            "DISTANCE",
            formatMeterKm(meter.distanceM),
            "km",
            "meter-digital-distance",
          )}
        </View>
      </View>
      <View style={[styles.colRight, { gap: ui.gap }]}>
        <View style={[styles.pairRow, { gap: ui.gap }]}>
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
    <View
      style={[
        styles.runningStrip,
        {
          gap: ui.gap,
          paddingVertical: Math.round(ui.pad * 0.6),
          paddingHorizontal: ui.pad,
          borderRadius: Math.round(ui.radius * 0.7),
        },
      ]}
    >
      <View style={[dotStyle(ui), { backgroundColor: linkColor }]} />
      <FitText style={styles.runningText} size={ui.bodyText}>
        {meter.running ? "METER RUNNING" : "METER STOPPED"} · RM{" "}
        {grandTotal.toFixed(2)} · {formatMeterClock(meter.elapsedMs)} ·{" "}
        {formatMeterDistance(meter.distanceM)}
      </FitText>
      <TouchableOpacity
        style={[
          styles.stripButton,
          {
            paddingVertical: Math.round(ui.pad * 0.4),
            paddingHorizontal: Math.round(ui.pad * 0.8),
            borderRadius: Math.round(ui.radius * 0.55),
          },
        ]}
        onPress={() => setTab("ehailing")}
        testID="meter-digital-strip-back"
      >
        <FitText style={styles.stripButtonText} size={ui.captionText}>
          OPEN METER
        </FitText>
      </TouchableOpacity>
    </View>
  ) : null;

  const tripsSummary = summarizeMeterTrips(trips);
  const tripsTab = (
    <View style={[styles.tabBody, { gap: ui.gap }]}>
      {runningStrip}
      <View style={[styles.summaryRow, { gap: ui.gap }]}>
        {[
          { label: "HIRES", value: String(tripsSummary.count) },
          { label: "DISTANCE", value: formatMeterDistance(tripsSummary.distanceM) },
          { label: "TAKINGS", value: `RM ${tripsSummary.total.toFixed(2)}` },
        ].map((s) => (
          <View key={s.label} style={[styles.panel, styles.summaryCard, panelStyle(ui)]}>
            <PanelLabel ui={ui}>{s.label}</PanelLabel>
            <FitText style={styles.summaryValue} size={ui.summaryValue}>
              {s.value}
            </FitText>
          </View>
        ))}
        <TouchableOpacity
          style={[styles.panel, styles.summaryCard, styles.clearCard, panelStyle(ui)]}
          onPress={handleClearLog}
          disabled={trips.length === 0}
          activeOpacity={0.85}
          testID="meter-digital-clear-log"
        >
          <Trash2 color={trips.length === 0 ? DASH.dim : DASH.danger} size={ui.iconSize} />
          <FitText
            style={[
              styles.clearCardText,
              { color: trips.length === 0 ? DASH.dim : DASH.danger },
            ]}
            size={ui.bodyText}
          >
            CLEAR LOG
          </FitText>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={[styles.tabScrollContent, { gap: ui.gap }]}
        showsVerticalScrollIndicator={false}
      >
        {trips.length === 0 ? (
          <Text
            style={[
              styles.emptyText,
              { fontSize: ui.rowText, lineHeight: Math.round(ui.rowText * 1.5) },
            ]}
            allowFontScaling={false}
          >
            No hires logged on this device yet. Every trip you end on the meter is
            recorded here, with the fare it charged and the source it measured on.
          </Text>
        ) : (
          trips.map((trip) => (
            <View key={trip.id} style={[styles.panel, styles.tripRow, panelStyle(ui)]}>
              <View style={[styles.tripWhen, { width: ui.tripWhenWidth }]}>
                <FitText style={styles.tripDate} size={ui.rowText}>
                  {formatDashDate(trip.endedAt)}
                </FitText>
                <FitText style={styles.tripTime} size={ui.captionText}>
                  {formatDashTime(trip.startedAt)} → {formatDashTime(trip.endedAt)}
                </FitText>
              </View>
              <View style={styles.tripFacts}>
                <FitText style={styles.tripFact} size={ui.rowText}>
                  {formatMeterDistance(trip.distanceM)} ·{" "}
                  {formatMeterClock(trip.elapsedMs)}
                </FitText>
                <FitText style={styles.tripMeta} size={ui.captionText} lines={2}>
                  {trip.tariff === "new" ? "New rates" : "Old rates"} ·{" "}
                  {trip.period === "night" ? "Night" : "Day"} · {trip.obdSamples} OBD /{" "}
                  {trip.gpsSamples} GPS
                  {trip.extra > 0 ? ` · extras RM ${trip.extra.toFixed(2)}` : ""}
                </FitText>
              </View>
              <FitText style={styles.tripTotal} size={ui.summaryValue}>
                RM {trip.total.toFixed(2)}
              </FitText>
              <TouchableOpacity
                style={[
                  styles.tripPrint,
                  {
                    width: ui.wideButtonHeight,
                    height: ui.wideButtonHeight,
                    borderRadius: Math.round(ui.radius * 0.7),
                  },
                ]}
                onPress={() => void printReceipt(trip)}
                activeOpacity={0.85}
                testID={`meter-digital-print-${trip.id}`}
              >
                <Printer color={DASH.accent} size={ui.iconSize} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  const receiptTarget = lastTrip ?? trips[0] ?? null;
  const printerTab = (
    <View style={[styles.tabBody, { gap: ui.gap }]}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={[styles.tabScrollContent, { gap: ui.gap }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>PRINTER</PanelLabel>
          <View style={[styles.statusLineRow, { gap: Math.round(ui.gap * 0.8) }]}>
            <View style={[dotStyle(ui), { backgroundColor: DASH.warn }]} />
            <Text
              style={[styles.statusLineText, { fontSize: ui.rowText }]}
              allowFontScaling={false}
            >
              No dedicated receipt printer is paired with this build
            </Text>
          </View>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            The meter has no thermal-printer driver of its own, so receipts go to
            the print service your device already has — AirPrint, Google Cloud
            Print, or a Bluetooth printer set up in the system settings. Anything
            the OS can print to, the meter can print to.
          </Text>
        </View>

        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>LAST RECEIPT</PanelLabel>
          {receiptTarget ? (
            <>
              <FitText style={styles.receiptTotal} size={ui.receiptTotal}>
                RM {receiptTarget.total.toFixed(2)}
              </FitText>
              <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
                {formatDashDate(receiptTarget.endedAt)} ·{" "}
                {formatDashTime(receiptTarget.startedAt)} →{" "}
                {formatDashTime(receiptTarget.endedAt)} ·{" "}
                {formatMeterDistance(receiptTarget.distanceM)} ·{" "}
                {formatMeterClock(receiptTarget.elapsedMs)}
              </Text>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  styles.soloButton,
                  { paddingHorizontal: ui.pad * 2 },
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
                    <Receipt color={DASH.text} size={ui.iconSize} />
                    <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                      PRINT RECEIPT
                    </FitText>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <Text
              style={[
                styles.emptyText,
                { fontSize: ui.rowText, lineHeight: Math.round(ui.rowText * 1.5) },
              ]}
              allowFontScaling={false}
            >
              Nothing to print yet — end a trip and its receipt appears here.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );

  const obdTab = (
    <View style={[styles.tabBody, { gap: ui.gap }]}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={[styles.tabScrollContent, { gap: ui.gap }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>OBD-II READER</PanelLabel>
          <View style={[styles.statusLineRow, { gap: Math.round(ui.gap * 0.8) }]}>
            <View style={[dotStyle(ui), { backgroundColor: readerColor }]} />
            <Text
              style={[styles.statusLineText, { fontSize: ui.rowText }]}
              allowFontScaling={false}
            >
              {linkLine}
            </Text>
          </View>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            The meter bills on the vehicle&apos;s OBD-II speed when the reader is
            linked, and switches to GPS the moment it isn&apos;t. Demo Mode never
            bills a fare — simulated telemetry is not a vehicle. This trip so far:{" "}
            {meter.obdSamples} OBD / {meter.gpsSamples} GPS samples.
          </Text>
          {canbusState.device ? (
            <Text
              style={[
                styles.bodyMuted,
                { fontSize: ui.captionText, lineHeight: Math.round(ui.captionText * 1.45) },
              ]}
              allowFontScaling={false}
            >
              {TRANSPORT_LABEL[canbusState.device.transport]} ·{" "}
              {canbusState.device.name}
              {canbusState.protocol ? ` · ${canbusState.protocol}` : ""}
            </Text>
          ) : null}
          <View style={[styles.actionRow, { gap: ui.gap }]}>
            <TouchableOpacity
              style={[
                styles.wideButton,
                wideButtonStyle(ui),
                canbus.connecting && styles.buttonDisabled,
              ]}
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
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  {online ? "DISCONNECT READER" : "CONNECT READER"}
                </FitText>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.wideButton, wideButtonStyle(ui), styles.ghostButton]}
              onPress={() => router.push("/obd2-reader" as never)}
              activeOpacity={0.85}
              testID="meter-digital-reader-settings"
            >
              <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                READER SETTINGS
              </FitText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>SATELLITES</PanelLabel>
          <View style={[styles.statusLineRow, { gap: Math.round(ui.gap * 0.8) }]}>
            <View
              style={[
                dotStyle(ui),
                {
                  backgroundColor: gpsDenied
                    ? DASH.danger
                    : hasFix
                      ? DASH.ok
                      : DASH.warn,
                },
              ]}
            />
            <Text
              style={[styles.statusLineText, { fontSize: ui.rowText }]}
              allowFontScaling={false}
            >
              {gpsDenied
                ? "Location permission is off"
                : hasFix
                  ? "GPS fix acquired"
                  : "Waiting for a GPS fix"}
            </Text>
          </View>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            {gpsDenied
              ? "Without the reader and without location, the meter cannot measure distance at all. Grant location access in your device settings."
              : `GPS is the meter's fallback. Speeds at or below ${WAITING_SPEED_KMH} km/h count as waiting time rather than travel.`}
          </Text>
        </View>
      </ScrollView>
    </View>
  );

  const settingsTab = (
    <View style={[styles.tabBody, { gap: ui.gap }]}>
      {runningStrip}
      <ScrollView
        style={styles.tabScroll}
        contentContainerStyle={[styles.tabScrollContent, { gap: ui.gap }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>TARIFF</PanelLabel>
          <View style={[styles.tariffRow, { gap: ui.gap }]}>
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
                  style={[
                    styles.tariffChip,
                    chipStyle(ui),
                    active && styles.tariffChipActive,
                  ]}
                  onPress={() => setTariff(opt.key)}
                  activeOpacity={0.85}
                  testID={`meter-digital-tariff-${opt.key}`}
                >
                  <FitText
                    style={[
                      styles.tariffChipTitle,
                      { color: active ? DASH.accent : DASH.text },
                    ]}
                    size={ui.rowText}
                  >
                    {opt.title}
                  </FitText>
                  <Text
                    style={[
                      styles.tariffChipHint,
                      {
                        fontSize: ui.captionText,
                        lineHeight: Math.round(ui.captionText * 1.35),
                      },
                    ]}
                    allowFontScaling={false}
                  >
                    {opt.hint}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text
            style={[
              styles.bodyMuted,
              { fontSize: ui.captionText, lineHeight: Math.round(ui.captionText * 1.45) },
            ]}
            allowFontScaling={false}
          >
            Changing the tariff re-prices the running meter from its own totals —
            distance and time are not re-measured.
          </Text>
        </View>

        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>SHIFT</PanelLabel>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            The night shift adds {Math.round((NIGHT_MULTIPLIER - 1) * 100)}% to the
            whole fare and runs from{" "}
            {NIGHT_START_HOUR.toString().padStart(2, "0")}:00 to{" "}
            {NIGHT_END_HOUR.toString().padStart(2, "0")}:00. The meter picks the
            shift from the clock when it opens; the DAY / NIGHT keys override it.
          </Text>
          <View style={[styles.tariffRow, { gap: ui.gap }]}>
            {(["day", "night"] as const).map((key) => {
              const active = period === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.tariffChip,
                    chipStyle(ui),
                    active && styles.tariffChipActive,
                  ]}
                  onPress={() => setPeriod(key)}
                  activeOpacity={0.85}
                  testID={`meter-digital-shift-${key}`}
                >
                  <FitText
                    style={[
                      styles.tariffChipTitle,
                      { color: active ? DASH.accent : DASH.text },
                    ]}
                    size={ui.rowText}
                  >
                    {key === "day" ? "DAY" : "NIGHT"}
                  </FitText>
                  <FitText style={styles.tariffChipHint} size={ui.captionText}>
                    {key === "day" ? "No surcharge" : `× ${NIGHT_MULTIPLIER.toFixed(1)}`}
                  </FitText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>METER</PanelLabel>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            Clearing the meter zeroes the fare, the clock, the distance and the
            extras. It does not touch the trip log.
          </Text>
          <TouchableOpacity
            style={[
              styles.wideButton,
              wideButtonStyle(ui),
              styles.ghostButton,
              styles.soloButton,
              { paddingHorizontal: ui.pad * 2 },
              !started && styles.buttonDisabled,
            ]}
            disabled={!started}
            onPress={handleNewTrip}
            activeOpacity={0.85}
            testID="meter-digital-reset"
          >
            <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
              CLEAR METER
            </FitText>
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
        <View
          style={[
            styles.header,
            {
              gap: ui.gap,
              paddingHorizontal: ui.pad,
              paddingVertical: Math.round(ui.pad * 0.6),
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.backButton,
              {
                width: ui.headerButton,
                height: ui.headerButton,
                borderRadius: Math.round(ui.radius * 0.7),
              },
            ]}
            onPress={() => router.back()}
            testID="meter-digital-back"
          >
            <ArrowLeft color={DASH.muted} size={Math.round(ui.headerButton * 0.6)} />
          </TouchableOpacity>
          <Image
            source={appIconUri ? { uri: appIconUri } : require("@/assets/images/icon.png")}
            style={[
              styles.brandLogo,
              {
                width: Math.round(ui.headerButton * 0.82),
                height: Math.round(ui.headerButton * 0.82),
                borderRadius: Math.round(ui.radius * 0.5),
              },
            ]}
            resizeMode="contain"
          />
          <FitText style={styles.brandTitle} size={ui.headerTitle}>
            GET TAXI METER
          </FitText>
          <View style={styles.headerSpacer} />
          {statusCluster}
        </View>
      </SafeAreaView>

      <View
        style={[
          styles.bodyWrap,
          {
            paddingLeft: insets.left + ui.bodyPad,
            paddingRight: insets.right + ui.bodyPad,
            paddingTop: Math.round(ui.pad * 0.8),
            paddingBottom: Math.round(ui.pad * 0.5),
          },
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
              style={[
                styles.tabItem,
                {
                  gap: Math.round(ui.gap * 0.5),
                  paddingTop: Math.round(ui.pad * 0.75),
                  paddingBottom: Math.round(ui.pad * 0.9),
                  paddingHorizontal: Math.round(ui.pad * 0.35),
                },
              ]}
              onPress={() => setTab(item.id)}
              activeOpacity={0.8}
              testID={`meter-digital-tab-${item.id}`}
            >
              <item.icon color={active ? DASH.accent : DASH.muted} size={ui.tabIcon} />
              {/* Two of the five labels are two-liners, and five of them share
                  the width of the glass — so they shrink to their share
                  rather than being cut off mid-word. */}
              <FitText
                style={[styles.tabLabel, { color: active ? DASH.accent : DASH.muted }]}
                size={ui.tabLabel}
                lines={2}
                minimumScale={0.55}
              >
                {item.label}
              </FitText>
              {item.id === "obd" ? (
                <View
                  style={[
                    styles.tabDot,
                    dotStyle(ui),
                    { top: Math.round(ui.pad * 0.65), backgroundColor: readerColor },
                  ]}
                />
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
        <View style={[styles.modalBackdrop, { padding: ui.pad * 1.5 }]}>
          <View
            style={[
              styles.modalCard,
              {
                padding: ui.pad * 1.4,
                gap: ui.gap,
                borderRadius: Math.round(ui.radius * 1.3),
                // The card is a share of the glass, never a fixed width: it has
                // to sit inside a landscape phone as well as a dash tablet.
                maxWidth: Math.min(520, winWidth * 0.8),
                maxHeight: winHeight - ui.pad * 3,
              },
            ]}
            testID="meter-digital-total-modal"
          >
            <View style={styles.modalHeader}>
              <FitText style={styles.modalTitle} size={ui.rowText}>
                FARE DUE
              </FitText>
              <TouchableOpacity
                onPress={() => setTotalOpen(false)}
                style={[styles.modalClose, { width: ui.headerButton, height: ui.headerButton }]}
                testID="meter-digital-total-close"
              >
                <X color={DASH.muted} size={Math.round(ui.headerButton * 0.6)} />
              </TouchableOpacity>
            </View>
            <View style={[styles.modalAmount, { gap: Math.round(ui.gap * 0.9) }]}>
              <Text
                style={[styles.currency, { fontSize: ui.currencySize }]}
                allowFontScaling={false}
              >
                RM
              </Text>
              <SegmentDisplay
                value={(lastTrip?.total ?? grandTotal).toFixed(2)}
                size={modalAmountSize}
                color={DASH.segment}
              />
            </View>
            {lastTrip ? (
              // Scrolls only where it has to: a short landscape phone has less
              // height for the breakdown than the breakdown wants.
              <ScrollView
                style={styles.modalRowsScroll}
                contentContainerStyle={[styles.modalRows, { gap: Math.round(ui.gap * 0.5) }]}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
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
                  <View key={row.label} style={[styles.modalRow, { gap: ui.gap }]}>
                    <Text
                      style={[styles.modalRowLabel, { fontSize: ui.bodyText }]}
                      allowFontScaling={false}
                    >
                      {row.label}
                    </Text>
                    <Text
                      style={[styles.modalRowValue, { fontSize: ui.bodyText }]}
                      allowFontScaling={false}
                    >
                      {row.value}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={[styles.modalActions, { gap: ui.gap }]}>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  styles.ghostButton,
                  printing && styles.buttonDisabled,
                ]}
                disabled={printing}
                onPress={() => void printReceipt(lastTrip)}
                activeOpacity={0.85}
                testID="meter-digital-total-print"
              >
                {printing ? (
                  <ActivityIndicator color={DASH.text} size="small" />
                ) : (
                  <>
                    <Printer color={DASH.text} size={ui.iconSize} />
                    <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                      PRINT RECEIPT
                    </FitText>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  { backgroundColor: DASH.accent },
                ]}
                onPress={() => {
                  setTotalOpen(false);
                  handleNewTrip();
                }}
                activeOpacity={0.85}
                testID="meter-digital-total-new"
              >
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  NEW TRIP
                </FitText>
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

/** A panel's own box: padding, inner spacing and corner, all to the viewport. */
function panelStyle(ui: MeterMetrics): {
  padding: number;
  gap: number;
  borderRadius: number;
} {
  return { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius };
}

/** Running text, with the leading a paragraph needs at whatever size it is. */
function bodyTextStyle(ui: MeterMetrics): { fontSize: number; lineHeight: number } {
  return { fontSize: ui.bodyText, lineHeight: Math.round(ui.bodyText * 1.5) };
}

/** A full-width action button's box. */
function wideButtonStyle(ui: MeterMetrics): {
  height: number;
  gap: number;
  borderRadius: number;
} {
  return {
    height: ui.wideButtonHeight,
    gap: Math.round(ui.gap * 0.8),
    borderRadius: Math.round(ui.radius * 0.8),
  };
}

/** A selectable chip (tariff, shift) — the same box at any viewport. */
function chipStyle(ui: MeterMetrics): {
  padding: number;
  gap: number;
  borderRadius: number;
} {
  return {
    padding: Math.round(ui.pad * 0.85),
    gap: Math.round(ui.gap * 0.45),
    borderRadius: Math.round(ui.radius * 0.8),
  };
}

/** The status dot beside a one-line status, sized with the type it sits by. */
function dotStyle(ui: MeterMetrics): { width: number; height: number; borderRadius: number } {
  const size = Math.max(6, Math.round(ui.bodyText * 0.75));
  return { width: size, height: size, borderRadius: size / 2 };
}

/** Narrow the telemetry reading to a finite, non-negative km/h value. */
function canbusSpeedOf(speed: number | undefined): number | null {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= 0
    ? speed
    : null;
}

/**
 * Layout and colour only.
 *
 * Every size a driver can see — padding, corner, icon, point size — comes from
 * `computeMeterMetrics` at render time and is applied inline, so nothing here
 * carries a number that would pin the console to one viewport. What is left is
 * how the boxes stack and what colour they are.
 */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DASH.bg },

  /* Header */
  headerSafe: { backgroundColor: DASH.bgDeep },
  header: { flexDirection: "row", alignItems: "center" },
  backButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  brandLogo: { flexShrink: 0 },
  brandTitle: {
    flexShrink: 1,
    color: DASH.text,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  headerSpacer: { flex: 1, minWidth: 8 },
  statusCluster: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  signalWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  signalLabel: { color: DASH.muted, fontWeight: "800" as const },
  headerDate: { color: DASH.text, fontWeight: "700" as const, letterSpacing: 0.5 },
  headerTime: { color: DASH.text, fontWeight: "700" as const, letterSpacing: 0.5 },

  /* Body */
  bodyWrap: { flex: 1 },
  grid: { flex: 1, flexDirection: "row" },
  gridStacked: { flexDirection: "column" },
  colLeft: { flex: 1 },
  colRight: { flex: 1.85 },
  pairRow: { flexDirection: "row", flex: 1 },

  panel: {
    backgroundColor: DASH.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
    // Overflow is the safety net behind the fitting maths: whatever the
    // viewport, a readout is clipped by its own panel rather than drawn over
    // the one beside it.
    overflow: "hidden",
  },
  panelLabel: { color: DASH.text, fontWeight: "800" as const, letterSpacing: 1 },

  /* Driver */
  driverPanel: { flex: 1.25 },
  driverRow: { flexDirection: "row", alignItems: "center", flex: 1 },
  avatar: {
    borderRadius: 999,
    flexShrink: 0,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  driverInfo: { flex: 1, minWidth: 0 },
  driverName: { color: DASH.text, fontWeight: "900" as const, letterSpacing: 0.4 },
  plateChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: DASH.plate,
    borderRadius: 8,
  },
  plateChipLabel: { color: "#5A4A00", fontWeight: "800" as const, flexShrink: 0 },
  plateChipValue: {
    color: "#1A1A1A",
    fontWeight: "900" as const,
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  licenseRow: { flexDirection: "row", alignItems: "center" },
  licenseLabel: { color: DASH.muted, fontWeight: "700" as const, flexShrink: 0 },
  licenseValue: { color: DASH.muted, fontWeight: "700" as const, flexShrink: 1 },

  /* Trip control */
  controlRow: { flexDirection: "row" },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "900" as const,
    letterSpacing: 1,
    flexShrink: 1,
  },
  pauseButton: {
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
  statValueInner: { flexDirection: "row", alignItems: "flex-end" },
  statUnit: { color: DASH.muted, fontWeight: "700" as const },

  /* Fare / extras */
  farePanel: { flex: 1 },
  moneyRow: { flex: 1, flexDirection: "row", alignItems: "center" },
  currency: { color: DASH.segment, fontWeight: "900" as const },
  keyRow: { flexDirection: "row" },
  key: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: DASH.accent,
    overflow: "hidden",
  },
  keyActive: { backgroundColor: DASH.accent },
  keyDisabled: { opacity: 0.4 },
  keyText: {
    color: DASH.accent,
    fontWeight: "800" as const,
    letterSpacing: 1,
    flexShrink: 1,
  },
  keyTextActive: { color: DASH.bgDeep },
  fareTotalLine: { color: DASH.muted, fontWeight: "700" as const, letterSpacing: 0.4 },

  /* Trip status */
  statusPanel: { flex: 0.7 },
  statusCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  statusHeadline: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  statusText: { color: DASH.text, fontWeight: "800" as const, letterSpacing: 1 },
  statusFlex: { flexShrink: 1 },
  statusDivider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: DASH.panelEdge,
  },
  statusSub: { color: DASH.muted, fontWeight: "600" as const, textAlign: "center" },

  /* Secondary tabs */
  // Capped: a 10-inch dash screen would otherwise run these paragraphs the
  // whole width of the glass, which is a line length nobody reads at a glance.
  tabBody: { flex: 1, width: "100%", maxWidth: 1180, alignSelf: "center" },
  tabScroll: { flex: 1 },
  tabScrollContent: { paddingBottom: 8 },
  runningStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: DASH.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
  },
  runningText: { flex: 1, color: DASH.text, fontWeight: "700" as const, letterSpacing: 0.4 },
  stripButton: { borderWidth: 1, borderColor: DASH.accent, flexShrink: 0 },
  stripButtonText: { color: DASH.accent, fontWeight: "800" as const },

  summaryRow: { flexDirection: "row" },
  summaryCard: { flex: 1 },
  summaryValue: { color: DASH.segment, fontWeight: "900" as const },
  clearCard: { alignItems: "center", justifyContent: "center" },
  clearCardText: { fontWeight: "800" as const, letterSpacing: 0.6 },

  tripRow: { flexDirection: "row", alignItems: "center" },
  tripWhen: { gap: 2, flexShrink: 0 },
  tripDate: { color: DASH.text, fontWeight: "800" as const },
  tripTime: { color: DASH.muted, fontWeight: "600" as const },
  tripFacts: { flex: 1, gap: 2, minWidth: 0 },
  tripFact: { color: DASH.text, fontWeight: "700" as const },
  tripMeta: { color: DASH.muted, fontWeight: "600" as const },
  tripTotal: { color: DASH.segment, fontWeight: "900" as const, flexShrink: 0 },
  tripPrint: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: DASH.panelEdge,
    flexShrink: 0,
  },

  statusLineRow: { flexDirection: "row", alignItems: "center" },
  statusLineText: { flex: 1, color: DASH.text, fontWeight: "700" as const },
  bodyText: { color: DASH.muted },
  bodyMuted: { color: DASH.dim },
  emptyText: { color: DASH.muted, lineHeight: 20 },
  receiptTotal: { color: DASH.segment, fontWeight: "900" as const },

  actionRow: { flexDirection: "row", marginTop: 2 },
  wideButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: DASH.panelEdge,
    overflow: "hidden",
  },
  ghostButton: { backgroundColor: "transparent" },
  /** A button that stands alone in a panel, rather than sharing an action row. */
  soloButton: { flex: 0, alignSelf: "flex-start" },
  wideButtonText: {
    color: DASH.text,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  buttonDisabled: { opacity: 0.45 },

  tariffRow: { flexDirection: "row" },
  tariffChip: { flex: 1, borderWidth: 1.5, borderColor: DASH.panelEdge },
  tariffChipActive: { borderColor: DASH.accent, backgroundColor: "rgba(59,169,232,0.12)" },
  tariffChipTitle: { fontWeight: "800" as const, letterSpacing: 0.6 },
  tariffChipHint: { color: DASH.muted },

  /* Tab bar */
  tabBar: {
    flexDirection: "row",
    backgroundColor: DASH.bgDeep,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DASH.panelEdge,
  },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontWeight: "800" as const, letterSpacing: 0.5, textAlign: "center" },
  tabDot: { position: "absolute", right: "32%" },
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
  },
  modalCard: {
    width: "100%",
    backgroundColor: DASH.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DASH.panelEdge,
  },
  modalHeader: { flexDirection: "row", alignItems: "center" },
  modalTitle: { flex: 1, color: DASH.text, fontWeight: "800" as const, letterSpacing: 1.2 },
  modalClose: { alignItems: "center", justifyContent: "center" },
  modalAmount: { flexDirection: "row", alignItems: "flex-end" },
  modalRowsScroll: { flexShrink: 1 },
  modalRows: {},
  modalRow: { flexDirection: "row", justifyContent: "space-between" },
  modalRowLabel: { color: DASH.muted, fontWeight: "600" as const },
  modalRowValue: { color: DASH.text, fontWeight: "700" as const },
  modalActions: { flexDirection: "row", marginTop: 2 },
});
