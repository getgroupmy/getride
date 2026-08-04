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
 * A hire *opens* on the vehicle link, though: without one, START is greyed and
 * a press raises the connect popup instead of a fare — the press is held, the
 * link attempted, and the hire opens by itself the moment the car answers
 * (`evaluateMeterStart`). GPS is the fallback for a hire already running, not
 * the thing one begins on. Resuming from a pause is deliberately not gated: a
 * fare under way must keep measuring on whatever it still has.
 *
 * The TRIP STATUS panel names the connection type in both states — GPS, the
 * vehicle bus, or both — and once a hire is open it also carries the odometer
 * the cluster showed at pickup (mode-01 PID A6, read once) and where the
 * passenger got in (reverse-geocoded, or the raw fix when that fails). The
 * drop-off is stamped the same way when the hire ends, and both ends go onto
 * the trip log and the printed receipt: readings that answer after the record
 * is written are folded into it (`patchMeterTripWaypoints`), because the fare
 * may not wait for a dongle.
 *
 * Ending a hire is two steps, because a fare and a receipt are not the same
 * thing. END stops the meter at the instant it is pressed and freezes the
 * totals; what the machine cannot measure is then declared by the driver —
 * passengers, luggage, the tolls they laid out, and whether either end was an
 * airport (a flat surcharge the meter has no way to detect). Only once all of
 * that is answered is the record written, so a hire is never logged with the
 * meter guessing on the passenger's behalf; the other way out of the form is
 * back into the hire, which resumes accrual from now rather than billing the
 * seconds it took to fill in. That vocabulary is pure and tested in
 * `utils/meterTripDetails.ts`.
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
 * Leaving is a mode change, not a step back. The five tabs are panels of one
 * instrument, so back returns to the meter from any of them; back *from* the
 * meter raises a popup asking where the driver is going — passenger mode
 * (`/`), e-hailing (`/partner-ehailing`), or nowhere. While a fare is accruing
 * there is no leaving at all: the key is dead and the Android hardware back is
 * swallowed, so a running hire cannot be walked out of. `resolveMeterBack`
 * decides all three cases.
 *
 * The screen is landscape-only, and that is a gate rather than a hint: the
 * console is *not drawn at all* in a portrait viewport. It pins the device to
 * landscape while it is focused (`useLandscapeLock`) and hands rotation back on
 * the way out; where that pin cannot happen — the web build, or a binary made
 * before `expo-screen-orientation` shipped — the rotate notice takes the whole
 * screen until the driver turns the device. The pin and the check run on every
 * focus, so returning here from the reader settings (or anywhere else) with the
 * device back in portrait meets the notice again, not a squeezed meter.
 *
 * The gate covers the drawing only. The sensors, the link and the 1 Hz clock
 * live above it and keep running, because a hire that is open is a fare that is
 * accruing — turning the phone upright must never cost the driver the meter.
 *
 * Nothing here is drawn at a fixed point size. Every padding, icon, key and
 * word comes from `computeMeterMetrics` (pure + tested), which fits the whole
 * console to the viewport it is being drawn into — a phone in a cradle and a
 * 10-inch dash tablet get the same instrument, scaled. The segment readouts go
 * further: each is fitted to the box it was *measured* in (`fitReadoutBox`,
 * `fitMoneyPanel`) and to the value it is showing, so a clock that has gained an
 * hour digit, a distance that has gained a hundreds digit and a fare in a panel
 * squeezed by a landscape notch are all still drawn whole. Text that lives inside a control shrinks to its
 * box on top of that (`FitText`) and ignores the OS font-size setting, because
 * a clipped fare or a half-drawn key is not a thing a taxi meter may show.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
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
  Luggage as LuggageIcon,
  Minus,
  Moon,
  Pause,
  Plane,
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
  Users,
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
import { OBD_MODE_CURRENT } from "@/utils/canbus/obd";
import { PID_ODOMETER } from "@/utils/canbus/fuelRange";
import { decodeReading } from "@/utils/canbus/vehicleScan";
import { formatDisplayAddress } from "@/utils/addressFormatter";
import { MODAL_SUPPORTED_ORIENTATIONS } from "@/utils/modalOrientation";
import { reverseGeocode } from "@/utils/maps";
import { resolveOrientationGate } from "@/utils/orientationLock";
import {
  computeMeterMetrics,
  fitDigits,
  fitMoneyPanel,
  fitReadoutBox,
  type MeterMetrics,
} from "@/utils/meterScale";
import {
  describeMeterConnection,
  describeMeterSubline,
  evaluateMeterStart,
  formatDashDate,
  formatDashTime,
  formatOdometerSpan,
  formatPlaceSpan,
  formatWaypointOdometer,
  formatWaypointPlace,
  resolveMeterBack,
  type MeterLinkTone,
  type MeterWaypoint,
} from "@/utils/meterDashboard";
import {
  allowedMeterSources,
  describeMeterRates,
  hasMeterSurcharges,
  meterExtraSurcharge,
  meterOdometerGate,
  resolveMeterProfile,
  type MeterPanelId,
  type MeterProfile,
} from "@/utils/meterSettings";
import { fetchMeterProfiles } from "@/utils/meterSettingsStore";
  adjustCharges,
  AIRPORT_SURCHARGE,
  airportSurchargeFor,
  chargesFromText,
  chargesToText,
  createTripDetailsDraft,
  describeAirportLeg,
  describeMissingTripDetails,
  formatPaxLuggage,
  isTripDetailsComplete,
  MAX_CHARGES,
  MAX_LUGGAGE,
  MAX_PAX,
  MIN_LUGGAGE,
  MIN_PAX,
  resolveTripDetails,
  sanitizeChargesText,
  type MeterAirport,
  type MeterTripDetails,
  type MeterTripDetailsDraft,
} from "@/utils/meterTripDetails";
import { buildMeterReceiptHtml } from "@/utils/meterReceipt";
import {
  clearMeterTrips,
  loadMeterTrips,
  patchMeterTripWaypoints,
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
  describeMeterSource,
  formatMeterClock,
  formatMeterDistance,
  formatMeterKm,
  isNightPeriod,
  meterGrandTotal,
  pauseMeter,
  periodMultiplier,
  resetMeter,
  startMeter,
  TARIFF_RATES,
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
  /** A control that is present but cannot be used yet — START without a car. */
  disabled: "#2A4160",
} as const;

/** Status colours by tone, for the trip-status panel and the tab dots. */
const TONE_COLOR: Record<MeterLinkTone, string> = {
  ok: "#22C55E",
  info: "#3BA9E8",
  warn: "#F5A623",
  bad: "#E23B3B",
};

type MeterTab = "ehailing" | "trips" | "printer" | "obd" | "settings";

const TABS: { id: MeterTab; panel: MeterPanelId; label: string; icon: typeof CarTaxiFront }[] = [
  { id: "ehailing", panel: "meter", label: "Meter", icon: CarTaxiFront },
  { id: "trips", panel: "trips", label: "TRIPS", icon: ClipboardList },
  { id: "printer", panel: "printer", label: "PRINTER\nCONNECTION STATUS", icon: Printer },
  { id: "obd", panel: "obd", label: "OBD\nCONNECTION STATUS", icon: Cpu },
  { id: "settings", panel: "settings", label: "SETTINGS", icon: SettingsIcon },
];

interface LiveFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
}

/** Which end of the hire a stamp belongs to. */
type MeterEnd = "pickup" | "dropoff";

/**
 * A hire that has been ended but not yet closed.
 *
 * END stops the fare at the instant it is pressed — the passenger is never
 * billed for the time the declaration takes to fill in — so the totals and the
 * moment are frozen here while the driver answers, and the record is written
 * from this snapshot rather than from whatever the meter looks like at confirm.
 */
interface PendingEnd {
  state: MeterState;
  endedAt: number;
  dropoff: MeterWaypoint;
}

/** A box the layout pass actually gave a field, in points. */
interface MeasuredBox {
  width: number;
  height: number;
}

const UNMEASURED: MeasuredBox = { width: 0, height: 0 };

/**
 * The box a field was laid out in, reported back so the field can be fitted to
 * it rather than to a prediction of it.
 *
 * Both boxes this is used on are flex children whose size comes from the panel
 * above them, never from the readout inside them — so measuring cannot chase
 * its own tail: a bigger readout does not make the box report bigger. Updates
 * are gated on a real change, so a re-layout that lands on the same numbers does
 * not re-render the console.
 */
function useMeasuredBox(): [MeasuredBox, (event: LayoutChangeEvent) => void] {
  const [box, setBox] = useState<MeasuredBox>(UNMEASURED);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    setBox((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  }, []);
  return [box, onLayout];
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

  // Landscape-only: pinned while focused, re-asked on every focus, and gated on
  // the viewport the pin actually produced — the console below only renders on
  // `ready`. See `utils/orientationLock.ts`.
  const lockState = useLandscapeLock();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const gate = resolveOrientationGate(lockState, winWidth, winHeight);

  /**
   * Every size on the console, fitted to the glass it is drawn on — see
   * `utils/meterScale.ts`. Nothing below reads a hardcoded point size.
   *
   * The insets are handed over with the window, because they are not the
   * console's to draw in: a landscape phone gives ~100pt of its width to the
   * sensor housing and the home indicator, and sizing the panels off the raw
   * window is what pushed the clock's last digits outside its panel.
   */
  const ui = useMemo(
    () =>
      computeMeterMetrics(winWidth, winHeight, {
        horizontal: insets.left + insets.right,
        vertical: insets.top + insets.bottom,
      }),
    [insets.bottom, insets.left, insets.right, insets.top, winHeight, winWidth],
  );

  /* --- What the fields were actually laid out in --- */

  // The metrics above are a prediction of each panel's box; these are the boxes
  // themselves, reported by the layout pass. Every readout is fitted to its own
  // measurement, so nothing depends on the prediction being exact.
  const [timeBox, onTimeLayout] = useMeasuredBox();
  const [distanceBox, onDistanceLayout] = useMeasuredBox();
  const [fareBox, onFareLayout] = useMeasuredBox();
  const [extraBox, onExtraLayout] = useMeasuredBox();

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
  /** The two ends of the hire. Null until the meter stamps them. */
  const [pickup, setPickupState] = useState<MeterWaypoint | null>(null);
  const [dropoff, setDropoffState] = useState<MeterWaypoint | null>(null);
  /** The end-of-hire declaration, while the driver is filling it in. */
  const [detailsDraft, setDetailsDraft] = useState<MeterTripDetailsDraft>(() =>
    createTripDetailsDraft(),
  );
  /** The keyed charges field's own text, so a half-typed "12." survives a render. */
  const [chargesText, setChargesText] = useState<string>("");
  /** The hire that has been ended and is waiting on its declaration. */
  const [pendingEnd, setPendingEnd] = useState<PendingEnd | null>(null);
  /** What the driver declared for the hire just closed, once they confirmed it. */
  const [tripDetails, setTripDetails] = useState<MeterTripDetails | null>(null);
  /** The "connecting to the vehicle" popup, raised by a blocked START press. */
  const [connectPromptOpen, setConnectPromptOpen] = useState<boolean>(false);
  /** The "where to?" popup, raised by a back press off the idle meter. */
  const [exitPromptOpen, setExitPromptOpen] = useState<boolean>(false);

  const [trips, setTrips] = useState<MeterTrip[]>([]);
  const [lastTrip, setLastTrip] = useState<MeterTrip | null>(null);
  const [totalOpen, setTotalOpen] = useState<boolean>(false);
  const [printing, setPrinting] = useState<boolean>(false);

  /* --- The admin-configured rate card --- */

  // Every rule the meter is *told* rather than decides — which sensors it may
  // bill on, whether a hire needs an odometer, which panels exist, and the
  // rates themselves. Configured in Admin → Settings → Meter Digital Setting
  // and resolved for where this hire is starting; with nothing configured
  // anywhere the built-in TEKSI card is used and the driver keeps the OLD /
  // NEW tariff keys.
  const [cards, setCards] = useState<MeterProfile[]>([]);
  const [geo, setGeo] = useState<{
    country: string | null;
    state: string | null;
    city: string | null;
    suburb: string | null;
  } | null>(null);
  const [billing, setBilling] = useState(() =>
    resolveMeterProfile({ profiles: [] }),
  );
  /** How many bags and passengers the card is charging for on this hire. */
  const [luggage, setLuggage] = useState<number>(0);
  const [passengers, setPassengers] = useState<number>(1);
  /** True while a required odometer read is holding a START press. */
  const [odometerChecking, setOdometerChecking] = useState<boolean>(false);

  const profile = billing.profile;
  const configured = billing.level !== "default";
  const sources = allowedMeterSources(profile.sourceMode);

  /* --- Leaving the console --- */

  // The five tabs are panels of one instrument, not screens of their own, so a
  // back press off the trip log, the printer, the OBD panel or the settings
  // returns to the meter. A back press from the meter itself is the driver
  // leaving the console, which means changing mode rather than stepping back
  // one screen — so it raises the popup below instead of popping the route.
  // While a fare is accruing it does neither: the key is dead, and the Android
  // hardware/gesture back is swallowed rather than dropping the driver out of
  // the console mid-hire. `resolveMeterBack` owns that decision for both.
  const backAction = resolveMeterBack({
    onMeterPanel: tab === "ehailing",
    running: meter.running,
    // A hire that has stopped but has not been declared is not yet on the roll:
    // there is no leaving the console with one open either.
    ending: pendingEnd !== null,
  });
  const backBlocked = backAction === "blocked";

  const handleBack = useCallback(() => {
    if (backAction === "panel") {
      setTab("ehailing");
      return;
    }
    if (backAction === "blocked") return;
    setExitPromptOpen(true);
  }, [backAction]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        handleBack();
        // Always consumed: every outcome — panel, blocked, popup — is handled
        // here, and none of them is "pop the meter off the stack".
        return true;
      });
      return () => sub.remove();
    }, [handleBack]),
  );

  /** Leave the console for another mode. The meter is idle, so nothing is lost. */
  const leaveMeter = useCallback(
    (target: "/" | "/partner-ehailing") => {
      setExitPromptOpen(false);
      router.replace(target as never);
    },
    [router],
  );

  // Latest sensor readings, held in refs so the 1 Hz tick can read them without
  // re-creating the interval on every telemetry update.
  const fixRef = useRef<LiveFix | null>(null);
  const hasFixRef = useRef<boolean>(false);
  const canbusRef = useRef(canbus.state);
  useEffect(() => {
    canbusRef.current = canbus.state;
  }, [canbus.state]);
  // The session's command channel, held by ref so the one-off pickup read does
  // not tie its callback to the hook's render identity.
  const sendCommandRef = useRef(canbus.sendCommand);
  useEffect(() => {
    sendCommandRef.current = canbus.sendCommand;
  }, [canbus.sendCommand]);
  // Mirror the two ends for the sensor callbacks, which run outside React's tree.
  const pickupRef = useRef<MeterWaypoint | null>(null);
  const dropoffRef = useRef<MeterWaypoint | null>(null);
  // The log record the current ends belong to, so a late answer can be folded
  // into the row that is already on the roll.
  const recordedTripRef = useRef<string | null>(null);
  // A START press that is waiting for the vehicle link to come up.
  const pendingStartRef = useRef<boolean>(false);

  const canbusState = canbus.state;
  const online = canbusState.phase === "online";
  const obdLinked = online && !canbusState.simulated;
  const obdDemo = online && canbusState.simulated;

  const setWaypoint = useCallback((end: MeterEnd, next: MeterWaypoint | null) => {
    if (end === "pickup") {
      pickupRef.current = next;
      setPickupState(next);
    } else {
      dropoffRef.current = next;
      setDropoffState(next);
    }
  }, []);

  /**
   * Fold a late answer — the odometer, an address, a first fix — into one end
   * of the hire.
   *
   * Keyed on the moment that end was stamped, so an answer that arrives after
   * the driver has cleared the meter is dropped rather than attached to the
   * next passenger's trip. Once the hire is on the roll the same answer is
   * written through to the stored record, which was saved before it landed.
   */
  const patchWaypoint = useCallback(
    (end: MeterEnd, at: number, patch: Partial<MeterWaypoint>) => {
      const current = end === "pickup" ? pickupRef.current : dropoffRef.current;
      if (!current || current.at !== at) return;
      const next = { ...current, ...patch };
      setWaypoint(end, next);

      const tripId = recordedTripRef.current;
      if (!tripId) return;
      void patchMeterTripWaypoints(tripId, { [end]: next }).then(
        ({ trip, trips: list }) => {
          if (!trip) return;
          setTrips(list);
          setLastTrip((prev) => (prev && prev.id === trip.id ? trip : prev));
        },
      );
    },
    [setWaypoint],
  );

  /**
   * The odometer the cluster is showing, read once as an end is stamped.
   *
   * Generic OBD-II publishes it as mode-01 PID A6, which plenty of cars simply
   * do not implement — those answer NO DATA and the reading stays a dash. Demo
   * Mode has no adapter to ask at all, and a simulated odometer would be a
   * number the vehicle never reported.
   */
  const readOdometerOnce = useCallback(async (): Promise<number | null> => {
    const session = canbusRef.current;
    if (session.phase !== "online" || session.simulated) return null;
    try {
      const raw = await sendCommandRef.current(OBD_MODE_CURRENT + PID_ODOMETER);
      const reading = decodeReading(PID_ODOMETER, raw);
      return typeof reading?.numeric === "number" ? reading.numeric : null;
    } catch (e) {
      console.log("[meter-digital] odometer unavailable", e);
      return null;
    }
  }, []);

  const readWaypointOdometer = useCallback(
    async (end: MeterEnd, at: number) => {
      // A card can switch the read off for a fleet whose cars do not publish
      // PID A6 — there is nothing to gain by asking every one of them.
      if (!profile.readOdometer) return;
      const km = await readOdometerOnce();
      if (km !== null) patchWaypoint(end, at, { odometerKm: km });
    },
    [patchWaypoint, profile.readOdometer, readOdometerOnce],
  );

  /** Turn an end's fix into an address. It keeps the raw fix until this lands. */
  const resolveWaypointPlace = useCallback(
    async (end: MeterEnd, at: number, latitude: number, longitude: number) => {
      try {
        const result = await reverseGeocode(latitude, longitude, "meter-digital");
        const label = result
          ? formatDisplayAddress(result.name, result.address).trim()
          : "";
        if (label) patchWaypoint(end, at, { place: label });
      } catch (e) {
        console.log(`[meter-digital] ${end} reverse geocode failed`, e);
      }
    },
    [patchWaypoint],
  );

  /**
   * Stamp one end of the hire and chase the two readings that describe it.
   *
   * The stamp is immediate and the readings are not: neither may hold the meter
   * up. The fare starts the moment the driver presses START and stops the
   * moment they press END — not when a dongle or a geocoder answers.
   */
  const captureWaypoint = useCallback(
    (end: MeterEnd, at: number, odometerKm: number | null = null): MeterWaypoint => {
      const fix = fixRef.current;
      const waypoint: MeterWaypoint = {
        at,
        odometerKm,
        latitude: fix?.latitude ?? null,
        longitude: fix?.longitude ?? null,
        place: null,
      };
      setWaypoint(end, waypoint);
      // A reading the start gate already took is not asked for a second time —
      // the adapter answers one command at a time.
      if (odometerKm === null) void readWaypointOdometer(end, at);
      if (fix) void resolveWaypointPlace(end, at, fix.latitude, fix.longitude);
      return waypoint;
    },
    [readWaypointOdometer, resolveWaypointPlace, setWaypoint],
  );

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

  // --- The rate cards, and where this meter is ---
  useEffect(() => {
    let cancelled = false;
    void fetchMeterProfiles().then(({ profiles }) => {
      if (!cancelled) setCards(profiles);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Which card applies depends on where the taxi is, so the first fix is
   * turned into a country/state/city/suburb once.
   *
   * Structured geography, not the display address the waypoints use: a card is
   * matched on the place names, and picking those out of a formatted string
   * would be guesswork. Web has no `reverseGeocodeAsync`, so it simply stays on
   * the global card.
   */
  useEffect(() => {
    if (geo || !hasFix || Platform.OS === "web") return;
    const fix = fixRef.current;
    if (!fix) return;
    let cancelled = false;
    void (async () => {
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: fix.latitude,
          longitude: fix.longitude,
        });
        const p = places?.[0];
        if (cancelled || !p) return;
        setGeo({
          country: p.country ?? null,
          state: p.region ?? null,
          city: p.city ?? p.subregion ?? null,
          suburb: p.district ?? p.subregion ?? null,
        });
      } catch (e) {
        console.log("[meter-digital] rate-card geography lookup failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geo, hasFix]);

  const resolvedCard = useMemo(
    () => resolveMeterProfile({ profiles: cards, ...(geo ?? {}) }),
    [cards, geo],
  );

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
              // An end can be stamped before a fix lands (a cold start in a
              // basement car park). The first one that arrives is still the
              // closest thing to where it happened, so it backfills the stamp
              // rather than leaving it blank for good.
              const { latitude, longitude } = pos.coords;
              for (const end of ["pickup", "dropoff"] as const) {
                const stamped = end === "pickup" ? pickupRef.current : dropoffRef.current;
                if (!stamped || stamped.latitude !== null) continue;
                patchWaypoint(end, stamped.at, { latitude, longitude });
                void resolveWaypointPlace(end, stamped.at, latitude, longitude);
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
    }, [patchWaypoint, resolveWaypointPlace]),
  );

  // The card's sensor permission, mirrored for the tick below — which runs
  // outside React's tree and must not be rebuilt every time a card lands.
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  // --- The meter clock: one 1 Hz tick drives both the header and the accrual ---
  useEffect(() => {
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const can = canbusRef.current;
      const fix = fixRef.current;
      const allowed = sourcesRef.current;
      // Demo Mode telemetry is invented, so it must never bill a fare: the
      // meter treats a simulated link as "no OBD" and runs on GPS instead. A
      // card that names a single source takes the other one away outright — an
      // "OBD only" card must never quietly bill a fare on the phone's GPS.
      const useObd = allowed.obd && can.phase === "online" && !can.simulated;
      const useGps = allowed.gps && fix !== null;
      const sample: MeterSample = {
        at,
        obdSpeedKmh: useObd ? canbusSpeedOf(can.telemetry.speed) : null,
        obdUpdatedAt: useObd ? can.lastUpdate : null,
        gpsSpeedKmh: useGps ? (fix?.speedKmh ?? null) : null,
        gpsPoint:
          useGps && fix
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

  /**
   * The rates a hire is billed at.
   *
   * An admin-configured card wins over the OLD / NEW keys: the keys stay live
   * only when nothing has been configured anywhere, which is what the meter
   * did before rate cards existed.
   */
  const rates = configured ? profile.rates : TARIFF_RATES[tariff];
  const fare = useMemo(
    () =>
      computeMeterFare(meter, {
        rates,
        multiplier: periodMultiplier(period, profile.nightMultiplier),
      }),
    [meter, period, profile.nightMultiplier, rates],
  );
  /**
   * What the card charges for bags and passengers. Added onto the hand-entered
   * extras rather than into the fare: neither is something the meter measured.
   */
  const surcharge = meterExtraSurcharge(profile, { luggage, passengers });
  const extrasTotal = Math.round((extra + surcharge) * 100) / 100;
  const grandTotal = meterGrandTotal(fare.total, extrasTotal);
  // What the passenger owes: the metered fare, the keyed-in charges, and the
  // airport surcharge once the driver has declared one. Before that there is no
  // surcharge to add — the meter cannot tell an airport from any other kerb.
  const airportSurcharge = tripDetails?.airportSurcharge ?? 0;
  const grandTotal = meterGrandTotal(fare.total, extra, airportSurcharge);

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

  /**
   * Commit the resolved card — but never under a running hire.
   *
   * A card can arrive late (the fetch, the geocoded position) and a passenger
   * must not watch the tariff change mid-journey, so once a hire has opened the
   * card it opened on is the card it is billed on. It is picked up again the
   * moment the meter is cleared.
   */
  useEffect(() => {
    if (started) return;
    setBilling(resolvedCard);
  }, [resolvedCard, started]);

  // The shift the card's own night window says it is, re-picked when the card
  // lands. The DAY / NIGHT keys still override it.
  useEffect(() => {
    if (started) return;
    setPeriod(
      isNightPeriod(Date.now(), {
        startHour: profile.nightStartHour,
        endHour: profile.nightEndHour,
      })
        ? "night"
        : "day",
    );
  }, [profile.nightEndHour, profile.nightStartHour, started]);

  // What the meter *has* — both sensors, one of them, or neither. What it is
  // billing on is a different question, answered beside it while a hire runs.
  const link = describeMeterConnection({
    running: meter.running,
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
    // An operator card is not one of the two built-in tariffs, so the subline
    // does not claim to be either — the SETTINGS panel names the card instead.
    tariff: configured ? null : tariff,
  });
  // A hire opens on the vehicle link. Until there is one, START is a dead key
  // that raises the connect popup instead of starting a fare.
  const startGate = evaluateMeterStart({
    obdLinked,
    obdDemo,
    obdConnecting: canbus.connecting,
    obdError: canbusState.error,
  });
  const startBlocked = !started && !startGate.canStart;

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

  /** Open the hire: the fare starts accruing and the pickup is stamped. */
  const beginTrip = useCallback(
    (odometerKm: number | null = null) => {
      const at = Date.now();
      setMeter((prev) => startMeter(prev, at));
      // A fresh hire, so nothing from the last one may follow it onto the roll.
      recordedTripRef.current = null;
      setWaypoint("dropoff", null);
      captureWaypoint("pickup", at, odometerKm);
    },
    [captureWaypoint, setWaypoint],
  );

  /**
   * Open the hire, after the card's odometer condition.
   *
   * A card can require the vehicle's odometer before a fare may begin, so the
   * pickup mileage on the receipt is never a blank. The reading is taken here
   * rather than after the start, because a hire that has already opened cannot
   * be un-opened when the car turns out not to publish PID A6.
   */
  const startHire = useCallback(() => {
    if (profile.allowStartWithoutOdometer) {
      beginTrip();
      return;
    }
    setOdometerChecking(true);
    void readOdometerOnce().then((km) => {
      setOdometerChecking(false);
      const gate = meterOdometerGate(profile, km);
      if (!gate.canStart) {
        Alert.alert("Odometer required", gate.reason ?? "");
        return;
      }
      beginTrip(km);
    });
  }, [beginTrip, profile, readOdometerOnce]);
  const beginTrip = useCallback(() => {
    const at = Date.now();
    setMeter((prev) => startMeter(prev, at));
    // A fresh hire, so nothing from the last one may follow it onto the roll.
    recordedTripRef.current = null;
    setTripDetails(null);
    setWaypoint("dropoff", null);
    captureWaypoint("pickup", at);
  }, [captureWaypoint, setWaypoint]);

  /** Give up on the pending START — the driver closed the popup. */
  const closeConnectPrompt = useCallback(() => {
    pendingStartRef.current = false;
    setConnectPromptOpen(false);
  }, []);

  const handleStart = useCallback(() => {
    if (startGate.canStart) {
      startHire();
      return;
    }
    // The press is not thrown away: it is held, the link attempt is made, and
    // the hire opens by itself the moment the vehicle answers.
    pendingStartRef.current = true;
    setConnectPromptOpen(true);
    if (!canbus.connecting) {
      void canbus
        .connect()
        .catch((e) => console.log("[meter-digital] connect failed", e));
    }
  }, [canbus, startGate.canStart, startHire]);

  // The held START, released by the link coming up. It goes through the same
  // odometer gate as a direct press — a card that requires the reading requires
  // it however the hire was opened.
  useEffect(() => {
    if (!pendingStartRef.current) return;
    if (!startGate.canStart) return;
    pendingStartRef.current = false;
    setConnectPromptOpen(false);
    startHire();
  }, [startGate.canStart, startHire]);

  const handlePauseToggle = useCallback(() => {
    // Resuming is deliberately not gated on the link: a hire already under way
    // must keep measuring on whatever it has, GPS included.
    setMeter((prev) => (prev.running ? pauseMeter(prev) : startMeter(prev, Date.now())));
  }, []);

  const handleNewTrip = useCallback(() => {
    setMeter(resetMeter());
    setExtra(0);
    setLuggage(0);
    setPassengers(profile.freePassengers);
    setPeriod(
      isNightPeriod(Date.now(), {
        startHour: profile.nightStartHour,
        endHour: profile.nightEndHour,
      })
        ? "night"
        : "day",
    );
    setWaypoint("pickup", null);
    setWaypoint("dropoff", null);
    // The declaration belongs to the hire that carried it, never to the next
    // passenger: the form opens blank again.
    setTripDetails(null);
    setDetailsDraft(createTripDetailsDraft());
    setChargesText("");
    recordedTripRef.current = null;
  }, [profile.freePassengers, profile.nightEndHour, profile.nightStartHour, setWaypoint]);

  /**
   * End the hire: stop accruing, stamp the drop-off, and ask for the
   * declaration.
   *
   * The fare stops here and nowhere else. Passengers, luggage, the tolls the
   * driver laid out and whether either end was an airport are things only the
   * driver knows, and the meter has to be told them before it can print a
   * receipt — but the passenger is not billed for the asking, so the totals are
   * frozen the moment END is pressed and the record is written from that
   * snapshot once the form is answered (`confirmEndTrip`).
   */
  const handleEndTrip = useCallback(() => {
    const endedAt = Date.now();
    const stopped = pauseMeter(meter);
    setMeter(stopped);
    // Stamped now rather than at confirm: this is where the passenger got out.
    // The odometer and the address are folded in as they answer.
    const dropoffWaypoint = captureWaypoint("dropoff", endedAt);
    // Whatever was pressed into the EXTRA keys during the hire is the same
    // money the form asks about, so it opens with that already keyed in.
    setDetailsDraft(createTripDetailsDraft(extra));
    setChargesText(chargesToText(extra));
    setPendingEnd({ state: stopped, endedAt, dropoff: dropoffWaypoint });
  }, [captureWaypoint, extra, meter]);

  /**
   * Put the passenger back in the car: the hire never ended.
   *
   * The way out of the declaration that does not close a fare. Accrual resumes
   * from now (`startMeter`), so the seconds spent in the form are not billed,
   * and the drop-off stamp is dropped because the hire did not finish there.
   */
  const resumeEndedTrip = useCallback(() => {
    setPendingEnd(null);
    setWaypoint("dropoff", null);
    setMeter((prev) => startMeter(prev, Date.now()));
  }, [setWaypoint]);

  /** Close the hire on the declared details: write the record, show the total. */
  const confirmEndTrip = useCallback(() => {
    if (!pendingEnd) return;
    const details = resolveTripDetails(detailsDraft);
    // The confirm key is gated on the same check, so this is the backstop
    // rather than the gate: an undeclared hire is never written.
    if (!details) return;

    setPendingEnd(null);
    setTripDetails(details);
    // The console's EXTRA panel shows what was actually charged, not what the
    // keys happened to be on when the driver pressed END.
    setExtra(details.charges);

    void recordMeterTrip(pendingEnd.state, {
      id: uuidv4(),
      endedAt: pendingEnd.endedAt,
      tariff,
      period,
      // The card the hire was opened on, and the extras as they were actually
      // charged — the hand-entered ones plus the card's per-bag and
      // per-passenger surcharges, which are equally not measured.
      rates,
      nightMultiplier: profile.nightMultiplier,
      extra: extrasTotal,
      extra: details.charges,
      pax: details.pax,
      luggage: details.luggage,
      airport: details.airport,
      airportSurcharge: details.airportSurcharge,
      plate,
      driver: driverName,
      pickup: pickupRef.current,
      dropoff: dropoffRef.current ?? pendingEnd.dropoff,
    }).then(({ trip, trips: list }) => {
      setLastTrip(trip);
      setTrips(list);
      setTotalOpen(true);
      // From here a late answer knows which row to complete. Reconcile once
      // first: anything that answered while this write was in flight is in the
      // refs but did not make it into the record.
      recordedTripRef.current = trip.id;
      void patchMeterTripWaypoints(trip.id, {
        pickup: pickupRef.current,
        dropoff: dropoffRef.current,
      }).then(({ trip: patched, trips: patchedList }) => {
        if (!patched) return;
        setTrips(patchedList);
        setLastTrip((prev) => (prev && prev.id === patched.id ? patched : prev));
      });
    });
  }, [
    captureWaypoint,
    driverName,
    extrasTotal,
    meter,
    period,
    plate,
    profile.nightMultiplier,
    rates,
    tariff,
  ]);

  const handleExtra = useCallback(
    (steps: number) => {
      // The step and the ceiling come from the card: a fleet whose tolls are in
      // whole ringgit should not have to press a 50-sen key twice.
      setExtra((prev) =>
        adjustExtra(prev, steps, { step: profile.extraStep, max: profile.maxExtra }),
      );
    },
    [profile.extraStep, profile.maxExtra],
  );
  }, [detailsDraft, driverName, pendingEnd, period, plate, tariff]);

  /* --- The declaration's own keys --- */

  const setPax = useCallback((pax: number) => {
    setDetailsDraft((prev) => ({ ...prev, pax }));
  }, []);

  const setLuggage = useCallback((luggage: number) => {
    setDetailsDraft((prev) => ({ ...prev, luggage }));
  }, []);

  const setAirport = useCallback((airport: MeterAirport) => {
    setDetailsDraft((prev) => ({ ...prev, airport }));
  }, []);

  /** The keyed charges field: the text is the driver's, the value is the meter's. */
  const handleChargesText = useCallback((text: string) => {
    const cleaned = sanitizeChargesText(text);
    setChargesText(cleaned);
    setDetailsDraft((prev) => ({ ...prev, charges: chargesFromText(cleaned) }));
  }, []);

  /** The − / + keys beside the field, for a driver wearing gloves in the dark. */
  const handleChargesStep = useCallback(
    (steps: number) => {
      const charges = adjustCharges(detailsDraft.charges, steps);
      setChargesText(chargesToText(charges));
      setDetailsDraft((prev) => ({ ...prev, charges }));
    },
    [detailsDraft.charges],
  );

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
      {/* Greyed without a vehicle link, but never inert: the press is what
          raises the connect popup and holds the hire until the car answers. */}
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
                : startBlocked
                  ? DASH.disabled
                  : DASH.ok,
          },
          startBlocked && styles.primaryButtonBlocked,
        ]}
        onPress={meter.running ? handleEndTrip : started ? handleNewTrip : handleStart}
        // A card that requires the odometer holds the press while the reader is
        // asked. One press, one read — a second would queue behind it.
        disabled={odometerChecking}
        activeOpacity={0.85}
        testID="meter-digital-toggle"
      >
        {odometerChecking ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <CarTaxiFront
            color={startBlocked ? DASH.muted : "#fff"}
            size={Math.round(ui.buttonText * 1.3)}
          />
        )}
        <FitText
          style={[styles.primaryButtonText, startBlocked && styles.primaryButtonTextBlocked]}
          size={ui.buttonText}
        >
          {odometerChecking
            ? "READING ODOMETER…"
            : meter.running
              ? "END TRIP"
              : started
                ? "NEW TRIP"
                : "START TRIP"}
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

  const timeValue = formatMeterClock(meter.elapsedMs);
  const distanceValue = formatMeterKm(meter.distanceM);

  /**
   * One size for both stat readouts, fitted to what they are actually showing
   * inside the box they were actually given.
   *
   * Neither field has a fixed length — the clock gains a digit past ten hours,
   * the distance past ten and a hundred kilometres — so sizing them to a
   * guessed maximum either clips the long case or wastes the short one. Each
   * value is fitted to its own measured row (falling back to the predicted panel
   * width for the very first frame, before the layout pass has run) and the
   * tighter of the two wins, so the pair matches and every character of both is
   * drawn.
   */
  const statValueSize = useMemo(() => {
    const predicted = Math.max(0, ui.statPanelWidth - ui.pad * 2);
    const unitRoom = Math.round(ui.captionText * 1.8) + Math.round(ui.gap * 0.6);
    return Math.min(
      fitReadoutBox(
        timeBox.width > 0 ? timeBox.width : predicted,
        timeBox.height,
        timeValue.length,
        0,
        ui.statSizeMax,
      ),
      // The distance shares its row with the "km" label, which takes its width
      // out of the digits' before they are fitted.
      fitReadoutBox(
        distanceBox.width > 0 ? distanceBox.width : predicted,
        distanceBox.height,
        distanceValue.length,
        unitRoom,
        ui.statSizeMax,
      ),
    );
  }, [distanceBox, distanceValue.length, timeBox, timeValue.length, ui]);

  const statCard = (
    label: string,
    value: string,
    unit: string | null,
    testID: string,
    onValueRowLayout: (event: LayoutChangeEvent) => void,
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
      {/* The row is what gets measured: it takes its width from the panel and
          its height from whatever the label left, so the readout inside it can
          never influence the box it is being fitted to. */}
      <View style={styles.statValueRow} onLayout={onValueRowLayout}>
        <View style={[styles.statValueInner, { gap: Math.round(ui.gap * 0.6) }]}>
          <SegmentDisplay value={value} size={statValueSize} color={DASH.segment} />
          {unit ? (
            <Text
              style={[
                styles.statUnit,
                {
                  fontSize: ui.captionText,
                  marginBottom: Math.round(statValueSize * 0.14),
                },
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

  /* --- Fare / extras --- */

  const fareText = fare.total.toFixed(2);
  const extraText = extrasTotal.toFixed(2);

  /**
   * How the two money panels divide the height they were measured at.
   *
   * Both hold four things — a label, the RM readout, a row of keys, a caption —
   * inside a box that is a share of the glass, and on a short console their
   * natural sizes do not all fit. `fitMoneyPanel` divides the measured box
   * instead of letting the last row overflow it, which is what had EXTRA's
   * digits sliced across the top on a landscape phone.
   *
   * The two panels then take the tighter of the two answers: they sit side by
   * side showing the same currency, so a fare drawn a few points larger than the
   * extras beside it reads as a bug rather than as emphasis.
   */
  const money = useMemo(() => {
    const shared = {
      pad: ui.pad,
      gap: ui.gap,
      reservedWidth: ui.currencySize * 1.6 + Math.round(ui.gap * 0.9),
      maxReadout: ui.fareSize,
      maxKeyHeight: ui.keyHeight,
    };
    const fareFit = fitMoneyPanel({
      ...shared,
      width: fareBox.width,
      height: fareBox.height,
      chars: fareText.length,
      // The fare only carries its caption once there is an extra to total up.
      textLines: extrasTotal > 0 ? [ui.panelLabel, ui.smallText] : [ui.panelLabel],
      // The fare only carries its caption once there is something to total up.
      textLines:
        extra > 0 || airportSurcharge > 0
          ? [ui.panelLabel, ui.smallText]
          : [ui.panelLabel],
    });
    const extraFit = fitMoneyPanel({
      ...shared,
      width: extraBox.width,
      height: extraBox.height,
      chars: extraText.length,
      textLines: [ui.panelLabel, ui.smallText],
    });
    return {
      readoutSize: Math.min(fareFit.readoutSize, extraFit.readoutSize),
      keyHeight: Math.min(fareFit.keyHeight, extraFit.keyHeight),
    };
  }, [extrasTotal, extraBox, extraText.length, fareBox, fareText.length, ui]);
  }, [
    airportSurcharge,
    extra,
    extraBox,
    extraText.length,
    fareBox,
    fareText.length,
    ui,
  ]);

  const fareCard = (
    <View
      style={[
        styles.panel,
        styles.farePanel,
        { padding: ui.pad, gap: ui.gap, borderRadius: ui.radius },
      ]}
      onLayout={onFareLayout}
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
          value={fareText}
          size={money.readoutSize}
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
                  height: money.keyHeight,
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
      {extrasTotal > 0 ? (
        <FitText style={styles.fareTotalLine} size={ui.smallText}>
          TOTAL WITH EXTRA · RM {grandTotal.toFixed(2)}
      {extra > 0 || airportSurcharge > 0 ? (
        <FitText style={styles.fareTotalLine} size={ui.smallText} testID="meter-digital-grand">
          {airportSurcharge > 0 ? "TOTAL WITH EXTRA + AIRPORT" : "TOTAL WITH EXTRA"} · RM{" "}
          {grandTotal.toFixed(2)}
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
      onLayout={onExtraLayout}
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
          value={extraText}
          size={money.readoutSize}
          color={DASH.segment}
        />
      </View>
      <View style={[styles.keyRow, { gap: ui.gap }]}>
        <TouchableOpacity
          style={[
            styles.key,
            { height: money.keyHeight, borderRadius: Math.round(ui.radius * 0.65) },
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
            { height: money.keyHeight, borderRadius: Math.round(ui.radius * 0.65) },
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
        {surcharge > 0
          ? `RM ${surcharge.toFixed(2)} BAGS & SEATS · ${profile.currency} ${profile.extraStep.toFixed(2)} PER PRESS`
          : `RM ${profile.extraStep.toFixed(2)} PER PRESS · TOLLS, FEES, LUGGAGE`}
      </FitText>
    </View>
  );

  /* --- The end-of-hire declaration --- */

  // Priced off the snapshot END froze rather than off the live meter: the fare
  // stopped when the driver pressed the key, and nothing the form does moves it.
  const pendingFare = useMemo(
    () =>
      pendingEnd
        ? computeMeterFare(pendingEnd.state, {
            tariff,
            multiplier: periodMultiplier(period),
          })
        : null,
    [pendingEnd, period, tariff],
  );
  const draftAirportSurcharge = airportSurchargeFor(detailsDraft.airport);
  const declaredTotal = meterGrandTotal(
    pendingFare?.total ?? 0,
    detailsDraft.charges,
    draftAirportSurcharge,
  );
  const detailsComplete = isTripDetailsComplete(detailsDraft);
  const missingDetails = describeMissingTripDetails(detailsDraft);

  /** One question of the declaration: the heading, and the keys that answer it. */
  const detailSection = (
    Icon: typeof CarTaxiFront,
    label: string,
    hint: string | null,
    children: React.ReactNode,
  ) => (
    <View style={[styles.detailSection, { gap: Math.round(ui.gap * 0.6) }]}>
      <View style={[styles.detailHead, { gap: Math.round(ui.gap * 0.6) }]}>
        <Icon color={DASH.accent} size={ui.iconSize} />
        <FitText style={styles.panelLabel} size={ui.panelLabel}>
          {label}
        </FitText>
        {hint ? (
          <FitText style={styles.detailHint} size={ui.captionText}>
            {hint}
          </FitText>
        ) : null}
      </View>
      {children}
    </View>
  );

  /**
   * A row of count keys, `from` to `to`. The answer is one tap on a number the
   * driver can hit without looking — a keypad on a windscreen mount is not a
   * thing anyone uses at the kerb with a passenger waiting.
   */
  const countChips = (
    from: number,
    to: number,
    value: number | null,
    onSelect: (n: number) => void,
    testPrefix: string,
  ) => (
    <View style={[styles.chipWrap, { gap: Math.round(ui.gap * 0.6) }]}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => {
        const active = value === n;
        return (
          <TouchableOpacity
            key={n}
            style={[
              styles.countChip,
              {
                height: ui.keyHeight,
                minWidth: Math.round(ui.keyHeight * 1.15),
                paddingHorizontal: Math.round(ui.pad * 0.5),
                borderRadius: Math.round(ui.radius * 0.6),
              },
              active && styles.countChipActive,
            ]}
            onPress={() => onSelect(n)}
            activeOpacity={0.8}
            testID={`${testPrefix}-${n}`}
          >
            <FitText
              style={[styles.countChipText, active && styles.countChipTextActive]}
              size={ui.rowText}
            >
              {String(n)}
            </FitText>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  /* --- Trip status --- */

  // An open hire puts the pickup block in this panel, so the headline gives
  // some of its height back rather than pushing the block out of the box.
  const headlineSize = started ? Math.round(ui.statusSize * 0.85) : ui.statusSize;

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
      {/* This panel is the shortest on the console, and an open hire puts the
          most in it — so the spacing tightens rather than the content being
          clipped by the panel's own overflow. */}
      <View
        style={[styles.statusCenter, { gap: Math.round(ui.gap * (started ? 0.55 : 0.9)) }]}
      >
        <View style={[styles.statusHeadline, { gap: ui.gap }]}>
          {link.fromVehicle ? (
            <Cpu color={linkColor} size={Math.round(headlineSize * 1.15)} />
          ) : (
            <MapPin
              color={linkColor}
              size={Math.round(headlineSize * 1.15)}
              fill={linkColor}
            />
          )}
          {/* The headline is the one line the driver reads at a glance, so it
              shrinks to the panel rather than wrapping or being clipped. */}
          <FitText
            style={[styles.statusText, styles.statusFlex]}
            size={headlineSize}
            testID="meter-digital-connection"
          >
            {link.label}
          </FitText>
          {/* Demo Mode sits *beside* the connection type, never inside it — a
              simulator is not one of the meter's sensors. */}
          {link.demo ? (
            <FitText style={[styles.statusChip, styles.statusChipWarn]} size={ui.captionText}>
              DEMO
            </FitText>
          ) : null}
          {/* The link is not the same thing as the fare: with both sensors up,
              this is what the last billed sample actually came off. */}
          {meter.running ? (
            <FitText
              style={styles.statusChip}
              size={ui.captionText}
              testID="meter-digital-billing"
            >
              BILLING · {describeMeterSource(meter.source).toUpperCase()}
            </FitText>
          ) : null}
        </View>
        <View style={[styles.statusDivider, { marginHorizontal: ui.pad * 2 }]} />
        {started ? (
          // Once a hire is open the panel carries the facts that belong to the
          // moment the passenger got in — joined by the drop-off once they get
          // out, which is what the log row and the receipt then print.
          <View style={[styles.pickupRow, { gap: ui.gap, paddingHorizontal: ui.pad }]}>
            <View style={styles.pickupOdo}>
              <FitText style={styles.pickupLabel} size={ui.captionText}>
                {dropoff ? "ODO" : "AT PICKUP ODO"}
              </FitText>
              <FitText
                style={styles.pickupValue}
                size={ui.rowText}
                minimumScale={0.5}
                testID="meter-digital-pickup-odo"
              >
                {dropoff
                  ? (formatOdometerSpan(pickup, dropoff) ?? "—")
                  : formatWaypointOdometer(pickup?.odometerKm)}
              </FitText>
            </View>
            <View style={styles.pickupPlace}>
              <FitText style={styles.pickupLabel} size={ui.captionText}>
                {dropoff ? "PICKUP → DROP-OFF" : "PICKUP"}
              </FitText>
              <FitText
                style={styles.pickupValue}
                size={ui.rowText}
                minimumScale={0.5}
                testID="meter-digital-pickup-place"
              >
                {dropoff
                  ? (formatPlaceSpan(pickup, dropoff) ?? "—")
                  : formatWaypointPlace(pickup)}
              </FitText>
            </View>
          </View>
        ) : (
          <FitText style={styles.statusSub} size={ui.rowText}>
            {subline}
          </FitText>
        )}
      </View>
    </View>
  );

  /* --- The meter, as the mount sees it --- */

  const dashboard = (
    <View style={[styles.grid, { gap: ui.gap }]}>
      <View style={[styles.colLeft, { gap: ui.gap }]}>
        {driverCard}
        {tripControls}
        <View style={[styles.pairRow, { gap: ui.gap }]}>
          {statCard("TIME", timeValue, null, "meter-digital-time", onTimeLayout)}
          {statCard(
            "DISTANCE",
            distanceValue,
            "km",
            "meter-digital-distance",
            onDistanceLayout,
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
          trips.map((trip) => {
            // Both are null on a record from before the meter stamped its ends,
            // so those rows simply keep the shape they were written with.
            const odometerSpan = formatOdometerSpan(trip.pickup, trip.dropoff);
            const placeSpan = formatPlaceSpan(trip.pickup, trip.dropoff);
            // Likewise null on a record from before the meter asked for them.
            const occupancy = formatPaxLuggage(trip.pax, trip.luggage);
            const airportLeg = describeAirportLeg(trip.airport);
            return (
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
                  {occupancy ? ` · ${occupancy}` : ""}
                  {airportLeg ? ` · ${airportLeg.toLowerCase()}` : ""}
                  {trip.extra > 0 ? ` · charges RM ${trip.extra.toFixed(2)}` : ""}
                  {trip.airportSurcharge > 0
                    ? ` · airport RM ${trip.airportSurcharge.toFixed(2)}`
                    : ""}
                  {odometerSpan ? ` · ODO ${odometerSpan}` : ""}
                </FitText>
                {placeSpan ? (
                  <FitText
                    style={styles.tripRoute}
                    size={ui.captionText}
                    minimumScale={0.5}
                    testID={`meter-digital-trip-route-${trip.id}`}
                  >
                    {placeSpan}
                  </FitText>
                ) : null}
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
            );
          })
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
          {configured ? (
            /* An operator has set the rates for this region, so the tariff is
               not the driver's to pick — the card is shown instead of the
               keys, charge by charge, so the fare on the glass is never a
               number without a stated reason. */
            <>
              <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
                {profile.label ?? billing.scope}
                {profile.label ? ` · ${billing.scope}` : ""}
              </Text>
              {describeMeterRates(profile).map((line) => (
                <Text
                  key={line}
                  style={[
                    styles.bodyMuted,
                    {
                      fontSize: ui.captionText,
                      lineHeight: Math.round(ui.captionText * 1.45),
                    },
                  ]}
                  allowFontScaling={false}
                >
                  • {line}
                </Text>
              ))}
              <Text
                style={[
                  styles.bodyMuted,
                  { fontSize: ui.captionText, lineHeight: Math.round(ui.captionText * 1.45) },
                ]}
                allowFontScaling={false}
              >
                Set by your operator in Admin → Settings → Meter Digital Setting. The card
                is fixed for the life of a hire, so a fare never re-prices mid-journey.
              </Text>
            </>
          ) : (
            <>
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
            </>
          )}
        </View>

        <View style={[styles.panel, panelStyle(ui)]}>
          <PanelLabel ui={ui}>SHIFT</PanelLabel>
          <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
            The night shift adds {Math.round((profile.nightMultiplier - 1) * 100)}% to
            the whole fare and runs from{" "}
            {profile.nightStartHour.toString().padStart(2, "0")}:00 to{" "}
            {profile.nightEndHour.toString().padStart(2, "0")}:00. The meter picks the
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
                    {key === "day"
                      ? "No surcharge"
                      : `× ${profile.nightMultiplier.toFixed(2).replace(/\.?0+$/, "")}`}
                  </FitText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Only drawn when the card actually charges for them: a counter that
            adds nothing to the fare is a control that lies. */}
        {hasMeterSurcharges(profile) ? (
          <View style={[styles.panel, panelStyle(ui)]}>
            <PanelLabel ui={ui}>BAGS &amp; PASSENGERS</PanelLabel>
            <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
              Counted by hand — a meter cannot see them. They are added to the extras,
              not to the metered fare.
            </Text>
            {(
              [
                {
                  key: "luggage" as const,
                  label: "BAGS",
                  value: luggage,
                  set: setLuggage,
                  charge: profile.extraLuggageCharge,
                  free: profile.freeLuggage,
                },
                {
                  key: "passengers" as const,
                  label: "PASSENGERS",
                  value: passengers,
                  set: setPassengers,
                  charge: profile.extraPassengerCharge,
                  free: profile.freePassengers,
                },
              ] as const
            )
              .filter((row) => row.charge > 0)
              .map((row) => (
                <View key={row.key} style={[styles.tariffRow, { gap: ui.gap }]}>
                  <View style={{ flex: 1 }}>
                    <FitText style={styles.tariffChipTitle} size={ui.rowText}>
                      {`${row.label}: ${row.value}`}
                    </FitText>
                    <FitText style={styles.tariffChipHint} size={ui.captionText}>
                      {`${profile.currency} ${row.charge.toFixed(2)} each${
                        row.free > 0 ? ` after ${row.free}` : ""
                      }`}
                    </FitText>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.key,
                      {
                        height: Math.round(ui.rowText * 2.4),
                        borderRadius: Math.round(ui.radius * 0.65),
                      },
                      row.value <= 0 && styles.keyDisabled,
                    ]}
                    disabled={row.value <= 0}
                    onPress={() => row.set((prev) => Math.max(0, prev - 1))}
                    activeOpacity={0.8}
                    testID={`meter-digital-${row.key}-down`}
                  >
                    <Minus color={DASH.accent} size={ui.iconSize} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.key,
                      {
                        height: Math.round(ui.rowText * 2.4),
                        borderRadius: Math.round(ui.radius * 0.65),
                      },
                    ]}
                    onPress={() => row.set((prev) => Math.min(99, prev + 1))}
                    activeOpacity={0.8}
                    testID={`meter-digital-${row.key}-up`}
                  >
                    <Plus color={DASH.accent} size={ui.iconSize} />
                  </TouchableOpacity>
                </View>
              ))}
          </View>
        ) : null}

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

  // The panels the card leaves on the console. The meter itself is never
  // hidden — a console without one is not a meter — which `validateMeterProfile`
  // enforces on the admin side and this backstops on the driver's.
  const visibleTabs = TABS.filter(
    (item) => item.panel === "meter" || profile.panels[item.panel].show,
  );

  // A card can be re-resolved while the driver is standing on a panel it hides.
  // Rather than draw a panel that is no longer part of the console, fall back
  // to the meter.
  useEffect(() => {
    if (visibleTabs.some((item) => item.id === tab)) return;
    setTab("ehailing");
  }, [tab, visibleTabs]);

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

  /* --- The landscape gate --- */

  // Below this line is the instrument, and it is laid out for a windscreen
  // mount. In portrait it is not drawn: the driver gets the notice on its own
  // (`rotate`), or a blank console while the device is still turning
  // (`waiting`). Everything above — the link, the fix, the running hire — is
  // untouched, so a fare in progress survives the phone being picked up, and
  // the meter is drawn again the moment the glass is landscape.
  if (gate !== "ready") {
    return (
      <View style={styles.container} testID="meter-digital-gate">
        <StatusBar barStyle="light-content" hidden />
        {gate === "rotate" ? (
          <RotateDeviceNotice
            state={lockState}
            onBack={() => router.back()}
            testID="meter-digital-rotate"
          />
        ) : null}
      </View>
    );
  }

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
          {/* Dead while a fare is accruing: there is no leaving the console
              mid-hire, and a dimmed key says so before it is pressed. */}
          <TouchableOpacity
            style={[
              styles.backButton,
              {
                width: ui.headerButton,
                height: ui.headerButton,
                borderRadius: Math.round(ui.radius * 0.7),
              },
              backBlocked && styles.backButtonBlocked,
            ]}
            disabled={backBlocked}
            onPress={handleBack}
            testID="meter-digital-back"
          >
            <ArrowLeft
              color={backBlocked ? DASH.disabled : DASH.muted}
              size={Math.round(ui.headerButton * 0.6)}
            />
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
        {visibleTabs.map((item) => {
          const active = tab === item.id;
          // A panel the card leaves visible but locked keeps its place on the
          // foot — the driver can see the console has one — and simply does
          // not open. It is drawn dimmed so a dead key never reads as a
          // broken one.
          const tappable = profile.panels[item.panel].tap;
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
                  opacity: tappable ? 1 : 0.4,
                },
              ]}
              onPress={() => setTab(item.id)}
              disabled={!tappable}
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

      {/* The end-of-hire declaration. The fare has already stopped; what is
          still missing is everything the meter cannot measure — who was in the
          car, what they were carrying, what the driver laid out, and whether
          either end was an airport. The hire is not written until it is
          answered, and the only other way out is back into the hire. */}
      <Modal
        visible={pendingEnd !== null}
        transparent
        animationType="fade"
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        // Deliberately inert: a hire that has stopped but has not been declared
        // is not on the roll yet, so it cannot be dismissed away. The two keys
        // at the foot are the ways out — close it, or go back to driving it.
        onRequestClose={() => {}}
      >
        <View style={[styles.modalBackdrop, { padding: ui.pad }]}>
          <View
            style={[
              styles.modalCard,
              {
                padding: ui.pad * 1.2,
                gap: Math.round(ui.gap * 0.8),
                borderRadius: Math.round(ui.radius * 1.3),
                // Wider than the other popups: this one is a form, and its
                // count keys have to sit on one row apiece.
                maxWidth: Math.min(760, winWidth * 0.94),
                maxHeight: winHeight - ui.pad * 2,
              },
            ]}
            testID="meter-digital-details-modal"
          >
            <View style={[styles.modalHeader, { gap: ui.gap }]}>
              <FitText style={styles.modalTitle} size={ui.rowText}>
                END OF HIRE
              </FitText>
              <FitText
                style={styles.detailsHeaderAmount}
                size={ui.rowText}
                testID="meter-digital-details-total"
              >
                RM {declaredTotal.toFixed(2)}
              </FitText>
            </View>
            <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
              The meter has stopped — the fare below is settled. Declare the hire
              to close it: every answer goes on the receipt and into the trip log.
            </Text>

            <ScrollView
              style={styles.modalRowsScroll}
              contentContainerStyle={[styles.detailsBody, { gap: ui.gap }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {detailSection(
                Users,
                "PASSENGERS",
                null,
                countChips(
                  MIN_PAX,
                  MAX_PAX,
                  detailsDraft.pax,
                  setPax,
                  "meter-digital-details-pax",
                ),
              )}
              {detailSection(
                LuggageIcon,
                "LUGGAGE",
                "PIECES CARRIED",
                countChips(
                  MIN_LUGGAGE,
                  MAX_LUGGAGE,
                  detailsDraft.luggage,
                  setLuggage,
                  "meter-digital-details-luggage",
                ),
              )}
              {detailSection(
                Receipt,
                "TOLL / OTHER CHARGES",
                `UP TO RM ${MAX_CHARGES.toFixed(2)}`,
                <>
                  <View style={[styles.chargesRow, { gap: ui.gap }]}>
                    <TouchableOpacity
                      style={[
                        styles.key,
                        styles.chargesKey,
                        {
                          height: ui.keyHeight,
                          width: Math.round(ui.keyHeight * 1.5),
                          borderRadius: Math.round(ui.radius * 0.65),
                        },
                        detailsDraft.charges <= 0 && styles.keyDisabled,
                      ]}
                      disabled={detailsDraft.charges <= 0}
                      onPress={() => handleChargesStep(-1)}
                      activeOpacity={0.8}
                      testID="meter-digital-details-charges-down"
                    >
                      <Minus color={DASH.accent} size={ui.iconSize} />
                    </TouchableOpacity>
                    <View
                      style={[
                        styles.chargesField,
                        {
                          height: ui.keyHeight,
                          gap: Math.round(ui.gap * 0.7),
                          paddingHorizontal: ui.pad,
                          borderRadius: Math.round(ui.radius * 0.65),
                        },
                      ]}
                    >
                      <Text
                        style={[styles.currency, { fontSize: ui.currencySize }]}
                        allowFontScaling={false}
                      >
                        RM
                      </Text>
                      <TextInput
                        style={[
                          styles.chargesInput,
                          { fontSize: Math.round(ui.rowText * 1.25) },
                        ]}
                        value={chargesText}
                        onChangeText={handleChargesText}
                        placeholder="0.00"
                        placeholderTextColor={DASH.dim}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        selectionColor={DASH.accent}
                        allowFontScaling={false}
                        maxLength={7}
                        testID="meter-digital-details-charges"
                      />
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.key,
                        styles.chargesKey,
                        {
                          height: ui.keyHeight,
                          width: Math.round(ui.keyHeight * 1.5),
                          borderRadius: Math.round(ui.radius * 0.65),
                        },
                      ]}
                      onPress={() => handleChargesStep(1)}
                      activeOpacity={0.8}
                      testID="meter-digital-details-charges-up"
                    >
                      <Plus color={DASH.accent} size={ui.iconSize} />
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[
                      styles.bodyMuted,
                      {
                        fontSize: ui.captionText,
                        lineHeight: Math.round(ui.captionText * 1.45),
                      },
                    ]}
                    allowFontScaling={false}
                  >
                    Tolls you paid, a booking fee, a luggage charge. Type the
                    figure or step it in RM {EXTRA_STEP.toFixed(2)}. Leave it at
                    zero if there were none.
                  </Text>
                </>,
              )}
              {detailSection(
                Plane,
                "AIRPORT",
                `SURCHARGE RM ${AIRPORT_SURCHARGE.toFixed(2)}`,
                <View style={[styles.tariffRow, { gap: ui.gap }]}>
                  {(
                    [
                      { key: "none" as const, title: "NEITHER", hint: "No surcharge" },
                      {
                        key: "pickup" as const,
                        title: "AIRPORT PICKUP",
                        hint: `+ RM ${AIRPORT_SURCHARGE.toFixed(2)}`,
                      },
                      {
                        key: "dropoff" as const,
                        title: "AIRPORT DROP-OFF",
                        hint: `+ RM ${AIRPORT_SURCHARGE.toFixed(2)}`,
                      },
                    ]
                  ).map((opt) => {
                    const active = detailsDraft.airport === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[
                          styles.tariffChip,
                          chipStyle(ui),
                          active && styles.tariffChipActive,
                        ]}
                        onPress={() => setAirport(opt.key)}
                        activeOpacity={0.85}
                        testID={`meter-digital-details-airport-${opt.key}`}
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
                        <FitText style={styles.tariffChipHint} size={ui.captionText}>
                          {opt.hint}
                        </FitText>
                      </TouchableOpacity>
                    );
                  })}
                </View>,
              )}
            </ScrollView>

            {/* What the declaration has done to the fare, line by line, so the
                driver reads the total they are about to charge rather than
                discovering it on the receipt. */}
            <View style={[styles.detailsTotals, { gap: Math.round(ui.gap * 0.4) }]}>
              <View style={[styles.modalRow, { gap: ui.gap }]}>
                <Text
                  style={[styles.modalRowLabel, { fontSize: ui.bodyText }]}
                  allowFontScaling={false}
                >
                  Metered fare
                </Text>
                <Text
                  style={[styles.modalRowValue, { fontSize: ui.bodyText }]}
                  allowFontScaling={false}
                >
                  RM {(pendingFare?.total ?? 0).toFixed(2)}
                </Text>
              </View>
              {detailsDraft.charges > 0 ? (
                <View style={[styles.modalRow, { gap: ui.gap }]}>
                  <Text
                    style={[styles.modalRowLabel, { fontSize: ui.bodyText }]}
                    allowFontScaling={false}
                  >
                    Tolls &amp; charges
                  </Text>
                  <Text
                    style={[styles.modalRowValue, { fontSize: ui.bodyText }]}
                    allowFontScaling={false}
                  >
                    RM {detailsDraft.charges.toFixed(2)}
                  </Text>
                </View>
              ) : null}
              {draftAirportSurcharge > 0 ? (
                <View style={[styles.modalRow, { gap: ui.gap }]}>
                  <Text
                    style={[styles.modalRowLabel, { fontSize: ui.bodyText }]}
                    allowFontScaling={false}
                  >
                    {describeAirportLeg(detailsDraft.airport) ?? "Airport"}
                  </Text>
                  <Text
                    style={[styles.modalRowValue, { fontSize: ui.bodyText }]}
                    allowFontScaling={false}
                  >
                    RM {draftAirportSurcharge.toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>

            {missingDetails ? (
              <FitText
                style={styles.detailsMissing}
                size={ui.captionText}
                testID="meter-digital-details-missing"
              >
                {missingDetails.toUpperCase()}
              </FitText>
            ) : null}

            <View style={[styles.modalActions, { gap: ui.gap }]}>
              <TouchableOpacity
                style={[styles.wideButton, wideButtonStyle(ui), styles.ghostButton]}
                onPress={resumeEndedTrip}
                activeOpacity={0.85}
                testID="meter-digital-details-resume"
              >
                <Play color={DASH.text} size={ui.iconSize} />
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  RESUME HIRE
                </FitText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  { backgroundColor: detailsComplete ? DASH.ok : DASH.disabled },
                  !detailsComplete && styles.buttonDisabled,
                ]}
                disabled={!detailsComplete}
                onPress={confirmEndTrip}
                activeOpacity={0.85}
                testID="meter-digital-details-confirm"
              >
                <Receipt color={DASH.text} size={ui.iconSize} />
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  END TRIP · RM {declaredTotal.toFixed(2)}
                </FitText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* The end-of-hire total: the moment the receipt exists. */}
      <Modal
        visible={totalOpen}
        transparent
        animationType="fade"
        // The console is landscape-pinned, and an iOS modal that does not
        // declare landscape throws rather than presenting. See
        // `utils/modalOrientation.ts`.
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
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
                  // The ends first: this is the moment the receipt exists, and
                  // where the hire ran is the passenger's own record of it.
                  ...(lastTrip.pickup
                    ? [{ label: "Pickup", value: formatWaypointPlace(lastTrip.pickup) }]
                    : []),
                  ...(lastTrip.dropoff
                    ? [{ label: "Drop-off", value: formatWaypointPlace(lastTrip.dropoff) }]
                    : []),
                  ...(formatOdometerSpan(lastTrip.pickup, lastTrip.dropoff)
                    ? [
                        {
                          label: "Odometer",
                          value: formatOdometerSpan(lastTrip.pickup, lastTrip.dropoff) as string,
                        },
                      ]
                    : []),
                  { label: "Distance", value: formatMeterDistance(lastTrip.distanceM) },
                  { label: "Trip time", value: formatMeterClock(lastTrip.elapsedMs) },
                  { label: "Waiting", value: formatMeterClock(lastTrip.waitingMs) },
                  // What the driver declared, in the words the receipt uses.
                  ...(lastTrip.pax !== null
                    ? [{ label: "Passengers", value: String(lastTrip.pax) }]
                    : []),
                  ...(lastTrip.luggage !== null
                    ? [{ label: "Luggage", value: String(lastTrip.luggage) }]
                    : []),
                  ...(describeAirportLeg(lastTrip.airport)
                    ? [
                        {
                          label: "Airport",
                          value: describeAirportLeg(lastTrip.airport) as string,
                        },
                      ]
                    : []),
                  { label: "Metered fare", value: `RM ${lastTrip.fare.toFixed(2)}` },
                  ...(lastTrip.extra > 0
                    ? [
                        {
                          label: "Tolls & charges",
                          value: `RM ${lastTrip.extra.toFixed(2)}`,
                        },
                      ]
                    : []),
                  ...(lastTrip.airportSurcharge > 0
                    ? [
                        {
                          label: "Airport surcharge",
                          value: `RM ${lastTrip.airportSurcharge.toFixed(2)}`,
                        },
                      ]
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

      {/* The blocked START: what the meter is waiting for, and the two ways
          out of it. It closes itself — and opens the hire — the moment the
          vehicle answers. */}
      <Modal
        visible={connectPromptOpen}
        transparent
        animationType="fade"
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        onRequestClose={closeConnectPrompt}
      >
        <View style={[styles.modalBackdrop, { padding: ui.pad * 1.5 }]}>
          <View
            style={[
              styles.modalCard,
              {
                padding: ui.pad * 1.4,
                gap: ui.gap,
                borderRadius: Math.round(ui.radius * 1.3),
                maxWidth: Math.min(520, winWidth * 0.8),
                maxHeight: winHeight - ui.pad * 3,
              },
            ]}
            testID="meter-digital-connect-modal"
          >
            <View style={styles.modalHeader}>
              <FitText style={styles.modalTitle} size={ui.rowText}>
                VEHICLE LINK
              </FitText>
              <TouchableOpacity
                onPress={closeConnectPrompt}
                style={[
                  styles.modalClose,
                  { width: ui.headerButton, height: ui.headerButton },
                ]}
                testID="meter-digital-connect-close"
              >
                <X color={DASH.muted} size={Math.round(ui.headerButton * 0.6)} />
              </TouchableOpacity>
            </View>
            <View style={[styles.statusLineRow, { gap: Math.round(ui.gap * 0.8) }]}>
              {startGate.connecting ? (
                <ActivityIndicator color={DASH.warn} size="small" />
              ) : (
                <Cpu color={readerColor} size={ui.iconSize} />
              )}
              <FitText
                style={[styles.statusLineText, styles.statusFlex]}
                size={ui.rowText}
                testID="meter-digital-connect-title"
              >
                {startGate.title}
              </FitText>
            </View>
            <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
              {startGate.message}
            </Text>
            <View style={[styles.modalActions, { gap: ui.gap }]}>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  styles.ghostButton,
                ]}
                onPress={() => {
                  closeConnectPrompt();
                  router.push("/obd2-reader" as never);
                }}
                activeOpacity={0.85}
                testID="meter-digital-connect-settings"
              >
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  READER SETTINGS
                </FitText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  { backgroundColor: DASH.accent },
                  startGate.connecting && styles.buttonDisabled,
                ]}
                disabled={startGate.connecting}
                onPress={() => {
                  void canbus
                    .connect()
                    .catch((e) => console.log("[meter-digital] connect failed", e));
                }}
                activeOpacity={0.85}
                testID="meter-digital-connect-retry"
              >
                {startGate.connecting ? (
                  <ActivityIndicator color={DASH.text} size="small" />
                ) : (
                  <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                    TRY AGAIN
                  </FitText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Leaving the console. The meter is not a screen the driver steps back
          out of — off it there is only the mode they drive in — so the back
          key asks which one rather than popping the route. It is only ever
          raised with the meter idle (`resolveMeterBack`), so no fare is at
          stake in any of the three answers. */}
      <Modal
        visible={exitPromptOpen}
        transparent
        animationType="fade"
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        onRequestClose={() => setExitPromptOpen(false)}
      >
        <View style={[styles.modalBackdrop, { padding: ui.pad * 1.5 }]}>
          <View
            style={[
              styles.modalCard,
              {
                padding: ui.pad * 1.4,
                gap: ui.gap,
                borderRadius: Math.round(ui.radius * 1.3),
                maxWidth: Math.min(520, winWidth * 0.8),
                maxHeight: winHeight - ui.pad * 3,
              },
            ]}
            testID="meter-digital-exit-modal"
          >
            <View style={styles.modalHeader}>
              <FitText style={styles.modalTitle} size={ui.rowText}>
                LEAVE THE METER
              </FitText>
              <TouchableOpacity
                onPress={() => setExitPromptOpen(false)}
                style={[
                  styles.modalClose,
                  { width: ui.headerButton, height: ui.headerButton },
                ]}
                testID="meter-digital-exit-close"
              >
                <X color={DASH.muted} size={Math.round(ui.headerButton * 0.6)} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.bodyText, bodyTextStyle(ui)]} allowFontScaling={false}>
              The meter is idle. Where to?
            </Text>
            <View style={[styles.modalActions, { gap: ui.gap }]}>
              <TouchableOpacity
                style={[styles.wideButton, wideButtonStyle(ui), styles.ghostButton]}
                onPress={() => leaveMeter("/")}
                activeOpacity={0.85}
                testID="meter-digital-exit-passenger"
              >
                <User color={DASH.text} size={ui.iconSize} />
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  PASSENGER MODE
                </FitText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.wideButton, wideButtonStyle(ui), styles.ghostButton]}
                onPress={() => leaveMeter("/partner-ehailing")}
                activeOpacity={0.85}
                testID="meter-digital-exit-ehailing"
              >
                <CarTaxiFront color={DASH.text} size={ui.iconSize} />
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  E-HAILING
                </FitText>
              </TouchableOpacity>
            </View>
            <View style={[styles.modalActions, { gap: ui.gap }]}>
              <TouchableOpacity
                style={[
                  styles.wideButton,
                  wideButtonStyle(ui),
                  { backgroundColor: DASH.accent },
                ]}
                onPress={() => setExitPromptOpen(false)}
                activeOpacity={0.85}
                testID="meter-digital-exit-stay"
              >
                <FitText style={styles.wideButtonText} size={ui.wideButtonText}>
                  STAY ON THE METER
                </FitText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  backButtonBlocked: { backgroundColor: "rgba(255,255,255,0.02)" },
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
  // Always two columns: the console is only ever drawn in landscape (the gate
  // above), so there is no portrait fallback layout to fall back to.
  grid: { flex: 1, flexDirection: "row" },
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
  // Reads as unavailable without going invisible — it is still the key the
  // driver presses to find out why.
  primaryButtonBlocked: { borderWidth: 1, borderColor: DASH.panelEdge },
  primaryButtonTextBlocked: { color: DASH.muted },
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
  // The qualifiers that ride the headline: what is being billed, and whether
  // any of this is simulated.
  statusChip: {
    color: DASH.muted,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
    flexShrink: 0,
  },
  statusChipWarn: { color: DASH.warn },
  // The pickup pair sits across the panel rather than down it: this box is wide
  // and short, so two columns cost no height where two rows would.
  pickupRow: { flexDirection: "row", alignSelf: "stretch", alignItems: "flex-start" },
  pickupOdo: { flex: 1, minWidth: 0 },
  pickupPlace: { flex: 1.6, minWidth: 0 },
  pickupLabel: { color: DASH.dim, fontWeight: "800" as const, letterSpacing: 0.8 },
  pickupValue: { color: DASH.text, fontWeight: "700" as const },

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
  tripRoute: { color: DASH.accent, fontWeight: "700" as const },
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

  /* End-of-hire declaration */
  detailsHeaderAmount: {
    color: DASH.segment,
    fontWeight: "900" as const,
    letterSpacing: 0.6,
    flexShrink: 0,
  },
  detailsBody: { paddingBottom: 4 },
  detailSection: {},
  detailHead: { flexDirection: "row", alignItems: "center" },
  // The hint rides the far end of its heading — "up to RM 99.50", the surcharge
  // a key adds — where it answers the question before the key is pressed.
  detailHint: {
    flex: 1,
    textAlign: "right",
    color: DASH.dim,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
  },
  // The count keys wrap rather than scroll sideways: every answer has to be
  // visible at a glance, and a hidden "8" is an answer the driver cannot give.
  chipWrap: { flexDirection: "row", flexWrap: "wrap" },
  countChip: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: DASH.accent,
    overflow: "hidden",
  },
  countChipActive: { backgroundColor: DASH.accent },
  countChipText: { color: DASH.accent, fontWeight: "800" as const },
  countChipTextActive: { color: DASH.bgDeep },
  chargesRow: { flexDirection: "row", alignItems: "center" },
  chargesKey: { flex: 0 },
  chargesField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: DASH.bgDeep,
    borderWidth: 1,
    borderColor: DASH.panelEdge,
  },
  chargesInput: {
    flex: 1,
    color: DASH.segment,
    fontWeight: "900" as const,
    letterSpacing: 1,
    padding: 0,
  },
  detailsTotals: {
    alignSelf: "stretch",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DASH.panelEdge,
    paddingTop: 6,
  },
  detailsMissing: { color: DASH.warn, fontWeight: "800" as const, letterSpacing: 0.6 },
});
