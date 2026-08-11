import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Platform,
  TextInput,
  ScrollView,
  Keyboard,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Menu,
  Navigation,
  MapPin,
  Search,
  X,
  Car,
  Clock,
  Route,
  Timer,
  Wallet,
  CheckCircle2,
  ShieldCheck,
  User,
  Hash,
  Calendar,
  Building2,
  Play,
  BadgeCheck,
  Zap,
  Hexagon,
  TrafficCone,
  Banknote,
  Activity,
  Satellite,
  Cpu,
  Monitor,
  Printer,
  Signal,
  Camera,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  CreditCard,
  Gauge,
  Wifi,
  Bluetooth,
  BluetoothConnected,
  Usb,
  Check,
  Layers,
} from "lucide-react-native";
import { Modal } from "react-native";
import * as Location from "expo-location";
import { useSafeAreaInsets, SafeAreaView } from "react-native-safe-area-context";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { reverseGeocode as reverseGeocodeUtil, calculateRoute, calculateFare, type TariffType } from "@/utils/maps";
import WebMap from "@/components/WebMap";
import { POPULAR_LOCATIONS } from "@/constants/mockLocations";
import { GOOGLE_PLACES_KEY } from "@/constants/googleKeys";
import { runWithMappingRotation } from "@/utils/mappingClient";
import { PlaceGatesList } from "@/components/PlaceGates";
import PartnerModeSelectModal, { type PartnerModeOption } from "@/components/PartnerModeSelectModal";
import { loadAssignedPartnerModeOptions } from "@/utils/partnerModeOptions";
import { loadDriverPermitData, type DriverPermitData } from "@/utils/driverPermitSource";
import { PERMIT_STOCK_PHOTO } from "@/utils/meterDriverIdentity";
import { checkPartnerModeDocuments, summarizeDocIssues } from "@/utils/partnerModeDocCheck";
import {
  fetchAssignableVehicles,
  claimVehicle,
  type AssignableVehicle,
} from "@/utils/vehicleAssignmentStore";
import VehicleSelectModal from "@/components/VehicleSelectModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminData } from "@/contexts/AdminDataContext";
import { fetchWalletBalances } from "@/utils/walletStore";
import PartnerSideSheet from "@/components/PartnerSideSheet";
import HeatmapOverlay from "@/components/HeatmapOverlay";
import { useAirportAreas, applyAirportAreaFilter, AirportArea } from "@/utils/airportAreas";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { useCanbus } from "@/hooks/useCanbus";
import { TRANSPORT_LABEL, type CanTransportKind } from "@/utils/canbus/types";
import { formatTelemetryValue } from "@/utils/canbus/obd";

type PlaceSuggestion = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

/** Glyph per transport — MFi gets its own so it reads as a separate link. */
const TRANSPORT_ICON: Record<CanTransportKind, typeof Wifi> = {
  wifi: Wifi,
  bluetooth: Bluetooth,
  mfi: BluetoothConnected,
  usb: Usb,
};

/** OBD-II communication types offered in the connection picker. */
type CommOptionId = "wifi" | "ble" | "mfi" | "usb" | "demo";

interface CommOption {
  id: CommOptionId;
  title: string;
  lines: string[];
  /** Underlying transport this option maps to (demo has none). */
  kind: CanTransportKind | null;
  iosOnly?: boolean;
  androidOnly?: boolean;
}

const COMM_OPTIONS: CommOption[] = [
  {
    id: "wifi",
    title: "Wi-Fi",
    kind: "wifi",
    lines: [
      "ELM327 compatible Wi-Fi adapters",
      "It may be necessary to configure additional settings for your Wi-Fi adapter on the preferences page.",
    ],
  },
  {
    id: "ble",
    title: "Bluetooth LE",
    kind: "bluetooth",
    lines: [
      "ELM327 compatible Bluetooth LE (Low Energy) adapters.",
      "Do NOT pair your adapter in the Bluetooth settings app. It will be found automatically when connecting.",
    ],
  },
  {
    id: "mfi",
    title: "Bluetooth MFi",
    kind: "mfi",
    iosOnly: true,
    lines: [
      "Supported Bluetooth MFi Devices such as OBDLink MX+.",
      "You must pair your adapter in the iOS Bluetooth settings",
    ],
  },
  {
    id: "usb",
    title: "USB",
    kind: "usb",
    androidOnly: true,
    lines: ["USB serial OBD-II adapters connected with an OTG cable."],
  },
  {
    id: "demo",
    title: "Demo Mode",
    kind: null,
    lines: ["View virtual data without connecting to a vehicle"],
  },
];

let MapView: any = null;
let RegionType: any = null;
if (Platform.OS !== "web") {
  const Maps = require("react-native-maps");
  MapView = Maps.default;
  RegionType = Maps.Region;
}

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export default function DriverTeksiScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);
  const { location: currentLocation, refreshLocation } = useLocation();
  const Colors = useColors();
  const isLightMode = Colors.background === "#FFFFFF";

  // Live CANBus / OBD-II vehicle link. Falls back to the telemetry simulator
  // only when partner-side simulation is enabled (honestly flagged as sim).
  const { settings: displaySettings } = useDisplaySettings();
  const canbus = useCanbus({
    autoConnect: true,
    allowSimulator: displaySettings.partnerDriveSimEnabled,
    // Link only the reader the driver set up in Settings — never blind-scan for
    // a device on the Teksi console.
    autoConnectSavedOnly: true,
  });

  const [region, setRegion] = useState<Region>({
    latitude: currentLocation?.coords?.latitude ?? 3.139,
    longitude: currentLocation?.coords?.longitude ?? 101.6869,
    latitudeDelta: 0.025,
    longitudeDelta: 0.025,
  });
  const [locationName, setLocationName] = useState<string>("Loading...");
  const [locationAddress, setLocationAddress] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchVisible, setSearchVisible] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [fareModalVisible, setFareModalVisible] = useState<boolean>(false);
  const [routeDistance, setRouteDistance] = useState<number>(0);
  const [routeDuration, setRouteDuration] = useState<number>(0);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [placeResults, setPlaceResults] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [pickupName, setPickupName] = useState<string>("Pickup");
  const [pickupAddress, setPickupAddress] = useState<string>("");
  const [driverModeVisible, setDriverModeVisible] = useState<boolean>(false);
  const [partnerModeOptions, setPartnerModeOptions] = useState<PartnerModeOption[]>([]);
  const { authState } = useAuth();
  const { getEntries } = useAdminData();
  const openPartnerModeSelector = React.useCallback(async () => {
    const opts = await loadAssignedPartnerModeOptions(authState.userId, getEntries);
    setPartnerModeOptions(opts);
    setDriverModeVisible(true);
  }, [authState.userId, getEntries]);
  const [sideSheetVisible, setSideSheetVisible] = useState<boolean>(false);
  const [isIdle, setIsIdle] = useState<boolean>(true);
  const [heatmapVisible, setHeatmapVisible] = useState<boolean>(false);
  const [trafficVisible, setTrafficVisible] = useState<boolean>(false);
  const [mapType, setMapType] = useState<"standard" | "satellite">("standard");
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [walletBalance, setWalletBalance] = useState<number>(0);

  // Live GET.credit balance from the wallet store (refreshes on focus).
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!authState.userId) return;
        try {
          const b = await fetchWalletBalances(authState.userId);
          if (!cancelled) {
            setCreditBalance(b.getCredit);
            setWalletBalance(b.getWallet);
          }
        } catch (e) {
          console.log("[partner-teksi] wallet balance load failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [authState.userId])
  );
  const [startConfirmVisible, setStartConfirmVisible] = useState<boolean>(false);
  const startConfirmAnim = useRef(new Animated.Value(0)).current;
  const [statusModalVisible, setStatusModalVisible] = useState<boolean>(false);
  const [commTypeVisible, setCommTypeVisible] = useState<boolean>(false);
  const [commChoice, setCommChoice] = useState<CommOptionId | null>(null);
  const [docPreviewVisible, setDocPreviewVisible] = useState<boolean>(false);
  const [docPreviewLoading, setDocPreviewLoading] = useState<boolean>(true);
  const [docPreviewError, setDocPreviewError] = useState<boolean>(false);
  const [tariffPickerVisible, setTariffPickerVisible] = useState<boolean>(false);
  const [tariff, setTariff] = useState<TariffType>("old");
  const [selectedVehicle, setSelectedVehicle] = useState<AssignableVehicle | null>(null);
  const [vehiclePickerVisible, setVehiclePickerVisible] = useState<boolean>(false);
  const [vehiclePickerLoading, setVehiclePickerLoading] = useState<boolean>(false);
  const [pickerVehicles, setPickerVehicles] = useState<AssignableVehicle[]>([]);

  type SystemStatus = "ok" | "warn" | "error";

  // --- Live CANBus row, derived from the real OBD-II connection state ---
  const canbusState = canbus.state;
  const canbusDevice = canbusState.device;
  const canbusOnline = canbusState.phase === "online";
  const canbusConnecting = canbus.connecting;
  const canbusRowStatus: SystemStatus = canbusOnline
    ? "ok"
    : canbusConnecting
    ? "warn"
    : "error";
  const canbusIcon = canbusDevice ? TRANSPORT_ICON[canbusDevice.transport] : Cpu;
  const canbusSub = canbusDevice
    ? `${TRANSPORT_LABEL[canbusDevice.transport]} · ${canbusDevice.name}`
    : "Vehicle ECU telemetry";
  const canbusDetail = canbusOnline
    ? [
        canbusState.bitrateKbps ? `${canbusState.bitrateKbps} kbps` : null,
        canbusState.simulated ? "linked (sim)" : "linked",
        typeof canbusState.telemetry.speed === "number"
          ? formatTelemetryValue("speed", canbusState.telemetry.speed)
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : canbusConnecting
    ? "Connecting…"
    : canbusState.error ?? "Not connected";

  const systemStatuses: { id: string; label: string; sub: string; status: SystemStatus; detail: string; icon: typeof Satellite }[] = [
    { id: "gnss", label: "GNSS", sub: "GPS / GLONASS / BEIDOU", status: "ok", detail: "14 sats · ±3.2m", icon: Satellite },
    { id: "canbus", label: "CANBus", sub: canbusSub, status: canbusRowStatus, detail: canbusDetail, icon: canbusIcon },
    { id: "display", label: "Passenger Display", sub: "Sub-mirror display", status: "ok", detail: "Connected · 1080p", icon: Monitor },
    { id: "printer", label: "Wired Printer", sub: "Receipt printer", status: "warn", detail: "Low paper roll", icon: Printer },
    { id: "mobile", label: "Mobile Data", sub: "4G / 5G / LTE", status: "ok", detail: "5G · -68 dBm", icon: Signal },
    { id: "camera", label: "360 Camera", sub: "External vehicle view", status: "error", detail: "No signal from rear cam", icon: Camera },
  ];
  const overallStatus: SystemStatus = systemStatuses.some(s => s.status === "error")
    ? "error"
    : systemStatuses.some(s => s.status === "warn")
    ? "warn"
    : "ok";
  const statusColor = overallStatus === "ok" ? "#22C55E" : overallStatus === "warn" ? "#F59E0B" : "#EF4444";
  const statusLabel = overallStatus === "ok" ? "All systems normal" : overallStatus === "warn" ? "Attention needed" : "Issues detected";

  // --- Speed pill: prefer live CANBus speed (green), fall back to GPS (blue) ---
  // The app-wide location context only takes one-shot fixes (speed is stale/0),
  // so while this screen is focused we run a continuous high-accuracy GPS watch
  // purely to feed the speedometer.
  const [watchedGpsSpeedMs, setWatchedGpsSpeedMs] = useState<number | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;
      (async () => {
        try {
          let { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") {
            status = (await Location.requestForegroundPermissionsAsync()).status;
          }
          if (status !== "granted" || cancelled) return;
          sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.BestForNavigation,
              timeInterval: 1000,
              distanceInterval: 0,
            },
            (pos) => {
              if (cancelled) return;
              const s = pos.coords.speed;
              setWatchedGpsSpeedMs(typeof s === "number" && Number.isFinite(s) ? s : null);
            },
          );
          if (cancelled) {
            sub.remove();
            sub = null;
          }
        } catch (e) {
          console.log("[partner-teksi] GPS speed watch failed", e);
        }
      })();
      return () => {
        cancelled = true;
        sub?.remove();
        sub = null;
        setWatchedGpsSpeedMs(null);
      };
    }, [])
  );

  const canbusSpeed = canbusState.telemetry.speed;
  // Only a REAL adapter link drives the speedometer. In Demo Mode the CANBus
  // telemetry is simulated, so the speed pill silently falls back to live GPS
  // in the background — the demo never fakes the vehicle's actual speed.
  const speedFromCanbus =
    canbusOnline && !canbusState.simulated && typeof canbusSpeed === "number";
  const gpsSpeedMs = watchedGpsSpeedMs ?? currentLocation?.coords?.speed;
  const gpsSpeedKmh =
    typeof gpsSpeedMs === "number" && gpsSpeedMs > 0
      ? Math.round(gpsSpeedMs * 3.6)
      : 0;
  const speedKmh = speedFromCanbus
    ? Math.max(0, Math.round(canbusSpeed as number))
    : gpsSpeedKmh;
  const speedColor = speedFromCanbus ? "#22C55E" : "#3B82F6";
  const speedSource = speedFromCanbus ? "CANBus" : "GPS";

  // --- OBD2 connection pill + communication-type picker ---
  const obdLinked = canbusOnline && !canbusState.simulated;
  const obdDemo = canbusOnline && canbusState.simulated;
  const obdColor = obdLinked
    ? "#22C55E"
    : obdDemo || canbusConnecting
    ? "#F59E0B"
    : "#EF4444";
  const obdStatusText = obdLinked
    ? `${TRANSPORT_LABEL[canbusDevice?.transport ?? "bluetooth"]} linked`
    : obdDemo
    ? "Demo"
    : canbusConnecting
    ? "Connecting…"
    : "Not connected";

  const commOptions = useMemo(
    () =>
      COMM_OPTIONS.filter(
        (o) =>
          (!o.iosOnly || Platform.OS === "ios") &&
          (!o.androidOnly || Platform.OS === "android"),
      ),
    [],
  );

  // Checkmark: explicit user choice wins, else derive from the live connection.
  const derivedComm: CommOptionId | null = obdDemo
    ? "demo"
    : obdLinked && canbusDevice
    ? canbusDevice.transport === "wifi"
      ? "wifi"
      : canbusDevice.transport === "usb"
      ? "usb"
      : canbusDevice.transport === "mfi"
      ? "mfi"
      : "ble"
    : null;
  const selectedComm = commChoice ?? derivedComm;

  const handleSelectCommType = React.useCallback(
    (opt: CommOption) => {
      console.log("[partner-teksi] OBD2 comm type selected:", opt.id);
      if (opt.kind === null) {
        setCommChoice(opt.id);
        setCommTypeVisible(false);
        canbus.connectDemo();
        return;
      }
      const avail = canbus.availability.find((a) => a.kind === opt.kind);
      if (!avail?.available) {
        // Be honest instead of silently failing. `guidance` knows which build
        // this is — Expo Go, web, or an installed one that predates the
        // transport — so it never sends a TestFlight tester hunting for a
        // "preview build" setting that does not exist.
        Alert.alert(
          `${opt.title} not available`,
          `${avail?.guidance ?? `Connecting to a real OBD-II adapter over ${opt.title} needs a native module this build does not have.`}\n\nUse Demo Mode to preview live vehicle data in the meantime.`,
          [
            { text: "Use Demo Mode", onPress: () => handleSelectCommType(COMM_OPTIONS[COMM_OPTIONS.length - 1]) },
            { text: "OK", style: "cancel" },
          ],
        );
        return;
      }
      setCommChoice(opt.id);
      setCommTypeVisible(false);
      void canbus.connect(opt.kind);
    },
    [canbus],
  );

  useEffect(() => {
    if (!heatmapVisible) return;
    console.log("[partner-teksi] heatmap location refresh started (15s)");
    const id = setInterval(() => {
      void refreshLocation();
    }, 15000);
    return () => {
      clearInterval(id);
      console.log("[partner-teksi] heatmap location refresh stopped");
    };
  }, [heatmapVisible, refreshLocation]);

  const [permitLoaded, setPermitLoaded] = useState<boolean>(false);
  const [permit, setPermit] = useState<DriverPermitData>({
    name: "—",
    driverType: "—",
    icNumber: "—",
    profileIcNumber: null,
    profileIcCandidates: [],
    permitIcNumber: null,
    expiryDateRaw: null,
    permitNumber: "—",
    vehiclePlate: "—",
    licenseClass: "—",
    companyClass: "TEKSI",
    issueDate: "—",
    expiryDate: "—",
    address: "—",
    authority: "KETUA PENGARAH",
    photoUri: PERMIT_STOCK_PHOTO,
    linked: false,
    sourceDoc: null,
    requiredDocumentId: null,
    requiredDocumentName: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await loadDriverPermitData(authState.userId, getEntries, "TEKSI");
      if (cancelled) return;
      console.log("[partner-teksi] permit linked:", data.linked, "requiredDoc:", data.requiredDocumentName ?? "(none)", "sourceDoc:", data.sourceDoc?.id ?? "(none)");
      setPermit(data);
      setPermitLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authState.userId, getEntries]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!authState.userId) return;
      try {
        const list = await fetchAssignableVehicles(authState.userId);
        if (cancelled) return;
        setPickerVehicles(list);
        const byParam = params.vehicleId
          ? list.find((v) => v.vehicle.id === params.vehicleId)
          : undefined;
        const active = byParam ?? list.find((v) => v.inUseByMe) ?? null;
        setSelectedVehicle(active);
        console.log(
          "[partner-teksi] selected vehicle:",
          active?.vehicle.plate ?? "(none)"
        );
      } catch (e) {
        console.log("[partner-teksi] vehicle load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authState.userId, params.vehicleId]);

  const fareModalAnim = useRef(new Animated.Value(0)).current;

  const previewDocUrl: string | null = useMemo(() => {
    const front = permit.sourceDoc?.file_url;
    if (typeof front === "string" && front.trim().length > 0) return front;
    const photo = permit.photoUri;
    if (
      typeof photo === "string" &&
      photo.trim().length > 0 &&
      !photo.includes("images.unsplash.com")
    ) {
      return photo;
    }
    return null;
  }, [permit.sourceDoc?.file_url, permit.photoUri]);

  const distanceKm = routeDistance;
  const estimatedMinutes = routeDuration;
  const baseFare = 3;
  const perKm = 1.5;
  const fareEstimate = calculateFare(distanceKm, estimatedMinutes, 1, tariff);

  const isMapMoving = useRef(false);
  const isMapReady = useRef(false);
  const initialLoadComplete = useRef(false);
  const hasInitializedFromContext = useRef(false);

  const pinDropAnim = useRef(new Animated.Value(0)).current;
  const pinInnerScaleAnim = useRef(new Animated.Value(1)).current;
  const pinShadowOpacity = useRef(new Animated.Value(0)).current;
  const addressBarOpacity = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const [bottomSheetHeight, setBottomSheetHeight] = useState<number>(0);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  useEffect(() => {
    if (currentLocation?.coords && !hasInitializedFromContext.current) {
      hasInitializedFromContext.current = true;
      const newRegion = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      };
      setRegion(newRegion);
      mapRef.current?.setCamera?.({
        center: {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        },
        zoom: 15,
      });
      reverseGeocode(
        currentLocation.coords.latitude,
        currentLocation.coords.longitude
      );
    } else if (!hasInitializedFromContext.current) {
      reverseGeocode(region.latitude, region.longitude);
      hasInitializedFromContext.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation]);

  const reverseGeocode = async (latitude: number, longitude: number) => {
    setIsLoading(true);
    try {
      const result = await reverseGeocodeUtil(latitude, longitude, "partner-teksi");
      if (result) {
        console.log("[partner-teksi] reverseGeocode resolved:", result.name, "-", result.address);
        setLocationName(result.name);
        setLocationAddress(result.address ?? "");
      } else {
        setLocationName("Selected location");
        setLocationAddress("");
      }
    } catch (error) {
      console.log("Error reverse geocoding:", error);
      setLocationName("Selected location");
      setLocationAddress("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegionChange = () => {
    if (!isMapReady.current || !initialLoadComplete.current) return;
    if (!isMapMoving.current) {
      isMapMoving.current = true;
      Animated.parallel([
        Animated.timing(pinDropAnim, {
          toValue: -25,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(pinInnerScaleAnim, {
          toValue: 2,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }),
        Animated.timing(pinShadowOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(addressBarOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const handleRegionChangeComplete = (newRegion: Region) => {
    if (isMapMoving.current) {
      isMapMoving.current = false;
      pinShadowOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(pinDropAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 200,
          friction: 8,
        }),
        Animated.spring(pinInnerScaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(addressBarOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
    setRegion(newRegion);
    reverseGeocode(newRegion.latitude, newRegion.longitude);
  };

  const handleCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        const newRegion = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        };
        mapRef.current?.animateToRegion?.(newRegion, 500);
        setRegion(newRegion);
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch (error) {
      console.log("Error getting current location:", error);
    }
  };

  const handleConfirm = async () => {
    console.log("TEKSI drop location set:", locationName, region);
    const origin = currentLocation?.coords
      ? { latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude }
      : { latitude: region.latitude, longitude: region.longitude };
    setIsCalculatingRoute(true);
    setFareModalVisible(true);
    Animated.spring(fareModalAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 11,
    }).start();
    try {
      const [result, pickupGeo] = await Promise.all([
        calculateRoute(origin, { latitude: region.latitude, longitude: region.longitude }, undefined, "partner-teksi"),
        reverseGeocodeUtil(origin.latitude, origin.longitude, "partner-teksi").catch(() => null),
      ]);
      if (result) {
        setRouteDistance(result.distance);
        setRouteDuration(result.duration);
      } else {
        setRouteDistance(0);
        setRouteDuration(0);
      }
      if (pickupGeo) {
        console.log("[partner-teksi] pickup reverseGeocode:", pickupGeo.name, "-", pickupGeo.address);
        setPickupName(pickupGeo.name || "Pickup");
        setPickupAddress(pickupGeo.address || "");
      }
    } catch (e) {
      console.warn("Failed to calculate TEKSI route:", e);
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const handleCloseFareModal = () => {
    Animated.timing(fareModalAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setFareModalVisible(false);
    });
  };

  const handleStartTestRide = () => {
    const pickupLat = currentLocation?.coords?.latitude ?? region.latitude;
    const pickupLng = currentLocation?.coords?.longitude ?? region.longitude;

    const angle = Math.random() * Math.PI * 2;
    const distanceKmRandom = 1.5 + Math.random() * 3.5;
    const latOffset = (distanceKmRandom / 111) * Math.cos(angle);
    const lngOffset =
      (distanceKmRandom / (111 * Math.cos((pickupLat * Math.PI) / 180))) *
      Math.sin(angle);
    const dropLat = pickupLat + latOffset;
    const dropLng = pickupLng + lngOffset;

    const testFare = calculateFare(distanceKmRandom, 0.5, 1, tariff);
    const destinations = [
      "KLCC",
      "Pavilion KL",
      "Mid Valley",
      "Sunway Pyramid",
      "KL Sentral",
      "Bangsar Village",
      "The Gardens Mall",
      "TRX Exchange",
    ];
    const randomDest = destinations[Math.floor(Math.random() * destinations.length)];

    console.log("[partner-teksi] Starting test ride", { dropLat, dropLng, distanceKmRandom, randomDest });

    router.replace({
      pathname: "/ride-running" as any,
      params: {
        driverMode: "TEKSI",
        dropName: randomDest,
        dropLat: dropLat.toString(),
        dropLng: dropLng.toString(),
        pickupLat: String(pickupLat),
        pickupLng: String(pickupLng),
        pickupName: "Current location",
        pickupAddress: "",
        fare: String(Math.ceil(testFare)),
        distance: distanceKmRandom.toFixed(1),
        eta: "0.5",
        tariff,
      },
    });
  };

  const handleStartDriving = () => {
    console.log("[partner-teksi] open fullscreen start confirm");
    setFareModalVisible(false);
    setStartConfirmVisible(true);
    startConfirmAnim.setValue(0);
    Animated.spring(startConfirmAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const handleCloseStartConfirm = () => {
    Animated.timing(startConfirmAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setStartConfirmVisible(false));
  };

  const handleConfirmStart = () => {
    console.log("Driver starting TEKSI mode", { locationName, distanceKm, fareEstimate, estimatedMinutes });
    const pickupLat = currentLocation?.coords?.latitude ?? region.latitude;
    const pickupLng = currentLocation?.coords?.longitude ?? region.longitude;
    setStartConfirmVisible(false);
    router.replace({
      pathname: "/ride-running" as any,
      params: {
        driverMode: "TEKSI",
        dropName: locationName,
        dropLat: region.latitude.toString(),
        dropLng: region.longitude.toString(),
        pickupLat: String(pickupLat),
        pickupLng: String(pickupLng),
        pickupName: pickupName,
        pickupAddress: pickupAddress,
        fare: String(Math.ceil(fareEstimate)),
        distance: distanceKm.toFixed(1),
        eta: String(estimatedMinutes),
        tariff,
      },
    });
  };

  const normalizeIc = (v: string | null | undefined): string =>
    (v ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

  const isPermitExpired = (): boolean => {
    const raw = permit.expiryDateRaw;
    if (!raw) return false;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  };

  const goToDocuments = () => router.push("/partner-documents" as never);

  const normalizePlate = (v: string | null | undefined): string =>
    (v ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

  /**
   * True when both the permit's vehicle number and the given vehicle plate are
   * known and they don't match. Returns false when either side is missing so
   * we never block on incomplete data.
   */
  const platesMismatch = (vehiclePlate: string | null | undefined): boolean => {
    const permitPlate = normalizePlate(permit.vehiclePlate);
    const veh = normalizePlate(vehiclePlate);
    if (!permitPlate || !veh) return false;
    return permitPlate !== veh;
  };

  /**
   * IC + expiry checks shared by the initial start-pickup tap and the re-check
   * after the driver picks a different vehicle. Shows a blocking popup on
   * failure. Returns true when these checks pass.
   */
  const validateIcAndExpiry = (): boolean => {
    const permitIc = normalizeIc(permit.permitIcNumber);
    const candidates = (
      permit.profileIcCandidates && permit.profileIcCandidates.length > 0
        ? permit.profileIcCandidates
        : [permit.profileIcNumber ?? ""]
    )
      .map((c) => normalizeIc(c))
      .filter((c): c is string => !!c);
    const hasProfileIc = candidates.length > 0;
    const matchesAny = !!permitIc && candidates.includes(permitIc);

    if (hasProfileIc && permitIc && !matchesAny) {
      const displayProfileIc =
        permit.profileIcCandidates && permit.profileIcCandidates.length > 0
          ? permit.profileIcCandidates.join(" / ")
          : permit.profileIcNumber ?? "—";
      console.log("[partner-teksi] IC mismatch", {
        candidates: permit.profileIcCandidates,
        permitIc: permit.permitIcNumber,
      });
      Alert.alert(
        "IC number mismatch",
        `Your profile IC number does not match the IC number on your taxi driver permit.\n\nProfile IC: ${displayProfileIc}\nPermit IC: ${permit.permitIcNumber ?? "—"}\n\nPlease update your documents so they match before starting a pickup.`,
        [{ text: "OK", onPress: goToDocuments }]
      );
      return false;
    }

    if (isPermitExpired()) {
      console.log("[partner-teksi] permit expired", permit.expiryDateRaw);
      Alert.alert(
        "Permit expired",
        `Your taxi driver permit expired on ${permit.expiryDate}.\n\nPlease renew and update your permit document before starting a pickup.`,
        [{ text: "OK", onPress: goToDocuments }]
      );
      return false;
    }

    return true;
  };

  const openVehiclePicker = React.useCallback(async () => {
    setVehiclePickerVisible(true);
    if (!authState.userId) return;
    setVehiclePickerLoading(true);
    try {
      const list = await fetchAssignableVehicles(authState.userId);
      setPickerVehicles(list);
    } catch (e) {
      console.log("[partner-teksi] vehicle picker load failed", e);
    } finally {
      setVehiclePickerLoading(false);
    }
  }, [authState.userId]);

  /**
   * Entry point for the Start Pickup button. Runs IC + expiry checks, then
   * verifies the selected vehicle's plate matches the permit's vehicle number.
   * On a plate mismatch it opens the vehicle picker so the driver can pick the
   * correct vehicle (which then re-runs the check). On full success it opens
   * the tariff picker.
   */
  const attemptStartPickup = () => {
    if (!validateIcAndExpiry()) return;
    if (platesMismatch(selectedVehicle?.vehicle.plate)) {
      console.log("[partner-teksi] vehicle plate mismatch", {
        permitPlate: permit.vehiclePlate,
        selectedPlate: selectedVehicle?.vehicle.plate ?? "(none)",
      });
      Alert.alert(
        "Vehicle mismatch",
        `The selected vehicle does not match your permit.\n\nPermit vehicle: ${permit.vehiclePlate}\nSelected vehicle: ${selectedVehicle?.vehicle.plate ?? "\u2014"}\n\nPlease select the vehicle that matches your permit.`,
        [{ text: "Select vehicle", onPress: () => void openVehiclePicker() }]
      );
      return;
    }
    setTariffPickerVisible(true);
  };

  /** Called when the driver picks a vehicle from the mismatch picker. Claims
   *  the vehicle, sets it as selected, then re-checks the plate. */
  const handleSelectVehicleForPickup = async (row: AssignableVehicle) => {
    if (!row.selectable) return;
    if (authState.userId) {
      setVehiclePickerLoading(true);
      const res = await claimVehicle(row.vehicle.id, authState.userId);
      setVehiclePickerLoading(false);
      if (!res.ok) {
        const message =
          res.reason === "vehicle_in_use"
            ? "This vehicle is already being used by another driver. Please pick another one."
            : res.reason === "user_busy"
            ? "You're already driving another vehicle. Please go offline on that one first."
            : res.reason === "not_assigned"
            ? "You're not assigned to this vehicle."
            : "Couldn't select this vehicle. Please try again.";
        Alert.alert("Can't use this vehicle", message);
        return;
      }
    }
    setSelectedVehicle(row);
    setVehiclePickerVisible(false);
    if (platesMismatch(row.vehicle.plate)) {
      console.log("[partner-teksi] picked vehicle still mismatches permit", {
        permitPlate: permit.vehiclePlate,
        pickedPlate: row.vehicle.plate,
      });
      Alert.alert(
        "Still doesn't match",
        `The vehicle you picked (${row.vehicle.plate}) still doesn't match your permit vehicle (${permit.vehiclePlate}). Please choose the matching vehicle.`,
        [
          { text: "Choose another", onPress: () => void openVehiclePicker() },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return;
    }
    if (!validateIcAndExpiry()) return;
    setTariffPickerVisible(true);
  };

  const handleAddNewVehicle = () => {
    setVehiclePickerVisible(false);
    setTimeout(
      () =>
        router.push({
          pathname: "/vehicle-onboarding" as never,
          params: { partnerType: "teksi", addNew: "1" },
        } as never),
      200
    );
  };

  const handleViewVehicleStatus = (row: AssignableVehicle) => {
    setVehiclePickerVisible(false);
    const statusParams: Record<string, string> = {
      partnerType: "teksi",
      vehicleId: row.vehicle.id,
    };
    if (row.incomplete) {
      statusParams.resume = "1";
      statusParams.role = row.role;
    } else {
      statusParams.viewStatus = "1";
    }
    setTimeout(
      () =>
        router.push({
          pathname: "/vehicle-onboarding" as never,
          params: statusParams,
        } as never),
      200
    );
  };

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setPlaceResults([]);
      setIsSearching(false);
      return;
    }
    if (q.length < 2) {
      setPlaceResults([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const biasLat = currentLocation?.coords?.latitude ?? region.latitude;
        const biasLng = currentLocation?.coords?.longitude ?? region.longitude;
        const buildUrl = (key: string) =>
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            q
          )}&location=${biasLat},${biasLng}&radius=50000&components=country:my&key=${key}`;
        console.log("[partner-teksi] places autocomplete", q);
        const data = await runWithMappingRotation<any>(
          "partner-teksi",
          "autocomplete",
          async (ctx) => {
            const k = ctx.key || GOOGLE_PLACES_KEY;
            const r = await fetch(buildUrl(k), { headers: { Accept: "application/json" } });
            const j = await r.json();
            return { ok: j?.status === "OK", value: j };
          },
          async () => {
            const r = await fetch(buildUrl(GOOGLE_PLACES_KEY), { headers: { Accept: "application/json" } });
            return r.json();
          }
        );
        console.log("[partner-teksi] autocomplete status:", data.status, "count:", data.predictions?.length);
        if (cancelled) return;
        if (data.status !== "OK" || !data.predictions?.length) {
          setPlaceResults([]);
          return;
        }
        const top = data.predictions.slice(0, 6);
        const detailed = await Promise.all(
          top.map(async (p: any) => {
            try {
              const dData = await runWithMappingRotation<any>(
                "partner-teksi",
                "places",
                async (ctx) => {
                  const k = ctx.key || GOOGLE_PLACES_KEY;
                  const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=geometry,name,formatted_address&key=${k}`;
                  const r = await fetch(dUrl);
                  const j = await r.json();
                  return { ok: j?.status === "OK", value: j };
                },
                async () => {
                  const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=geometry,name,formatted_address&key=${GOOGLE_PLACES_KEY}`;
                  const r = await fetch(dUrl);
                  return r.json();
                }
              );
              const r = dData.result;
              if (!r?.geometry?.location) return null;
              const sf = p.structured_formatting || {};
              return {
                id: p.place_id,
                name: sf.main_text || r.name || p.description.split(",")[0],
                address: sf.secondary_text || r.formatted_address || p.description,
                latitude: r.geometry.location.lat,
                longitude: r.geometry.location.lng,
              } as PlaceSuggestion;
            } catch (e) {
              console.log("[partner-teksi] details error", e);
              return null;
            }
          })
        );
        if (cancelled) return;
        setPlaceResults(detailed.filter((x): x is PlaceSuggestion => x !== null));
      } catch (e) {
        console.log("[partner-teksi] autocomplete error", e);
        if (!cancelled) setPlaceResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [searchQuery, currentLocation, region.latitude, region.longitude]);

  const airportAreas = useAirportAreas();
  const buildAirportSuggestion = (area: AirportArea): PlaceSuggestion => ({
    id: `airport-${area.entry.id}`,
    name: area.name,
    address: area.code ? `${area.code} · Airport` : "Airport",
    latitude: area.centroid.latitude,
    longitude: area.centroid.longitude,
  });
  const baseSuggestions: PlaceSuggestion[] = searchQuery.trim()
    ? placeResults
    : POPULAR_LOCATIONS.slice(0, 8).map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        latitude: l.latitude,
        longitude: l.longitude,
      }));
  const filteredSuggestions: PlaceSuggestion[] = applyAirportAreaFilter(
    baseSuggestions,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportSuggestion,
    undefined,
    (it) => `${it.name ?? ""} ${it.address ?? ""}`,
  );

  const handlePickSuggestion = (loc: PlaceSuggestion) => {
    Keyboard.dismiss();
    const newRegion: Region = {
      latitude: loc.latitude,
      longitude: loc.longitude,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    };
    setRegion(newRegion);
    setLocationName(loc.name);
    setLocationAddress(loc.address ?? "");
    console.log("[partner-teksi] picked from autocomplete:", loc.name, "-", loc.address);
    setSearchVisible(false);
    setSearchQuery("");
    mapRef.current?.animateToRegion?.(newRegion, 500);
  };

  if (isIdle) {
    return (
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <SafeAreaView style={styles.idleHeader} edges={["top"]}>
          <TouchableOpacity
            style={[
              styles.iconButton,
              { backgroundColor: isLightMode ? "#fff" : "#1a1a1a" },
            ]}
            onPress={() => setSideSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            testID="partner-teksi-idle-menu"
          >
            <Menu color={isLightMode ? "#000" : "#fff"} size={22} />
          </TouchableOpacity>
          <View style={styles.idleBadgeStack}>
            <TouchableOpacity
              style={[styles.headerBadge, { backgroundColor: Colors.accent }]}
              onPress={openPartnerModeSelector}
              activeOpacity={0.8}
              testID="partner-teksi-idle-mode-switch"
              accessibilityRole="button"
            >
              <Car color="#000000" size={16} />
              <Text style={styles.headerBadgeText}>TEKSI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statusPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "#1a1a1a",
                  borderColor: statusColor + "55",
                },
              ]}
              onPress={() => setStatusModalVisible(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Status: ${statusLabel}. Change status`}
              testID="partner-teksi-idle-status"
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Activity color={statusColor} size={12} />
              <Text style={[styles.statusPillText, { color: Colors.text }]} numberOfLines={1}>
                {statusLabel}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.iconButtonPlaceholder} />
        </SafeAreaView>

        <ScrollView
          contentContainerStyle={[
            styles.idleScroll,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.idleTitleWrap}>
            <Text style={[styles.idleEyebrow, { color: Colors.accentText }]}>
              DRIVER PERMIT
            </Text>
            <Text
              style={[styles.idleSubtitle, { color: Colors.textSecondary }]}
            >
              Review your active permit details below, then start your pickup
              when you&apos;re ready to drive.
            </Text>
          </View>

          <View
            style={[
              styles.permitCard,
              { backgroundColor: Colors.accent },
            ]}
          >
            <View style={styles.permitTopRow}>
              <View style={styles.permitBadgeRow}>
                <View style={styles.permitBadge}>
                  <ShieldCheck color="#fff" size={14} />
                  <Text style={styles.permitBadgeText}>VERIFIED</Text>
                </View>
                {previewDocUrl ? (
                  <TouchableOpacity
                    style={styles.permitDocIcon}
                    onPress={() => {
                      setDocPreviewLoading(true);
                      setDocPreviewError(false);
                      setDocPreviewVisible(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="View permit document"
                    testID="partner-teksi-doc-preview-link"
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <FileText color="#fff" size={16} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={styles.permitClassWrap}>
                <Text style={styles.permitClassText}>
                  {permit.companyClass}
                </Text>
                {permit.address && permit.address !== "—" ? (
                  <Text style={styles.permitClassAddress}>
                    {permit.address}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.permitIdentityRow}>
              <View style={styles.permitPhotoFrame} testID="partner-teksi-permit-photo">
                <Image
                  source={{ uri: permit.photoUri }}
                  style={styles.permitPhoto}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.permitIdentityText}>
                <Text style={styles.permitAuthority}>NAME</Text>
                <Text style={styles.permitName}>{permit.name}</Text>
                {permit.driverType && permit.driverType !== "—" ? (
                  <Text style={styles.permitDriverType}>{permit.driverType}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.permitDivider} />

            <View style={styles.permitGrid}>
              <View style={styles.permitGridItem}>
                <Text style={styles.permitGridLabel}>REF. NUMBER</Text>
                <Text style={styles.permitGridValue}>
                  {permit.permitNumber}
                </Text>
              </View>
              <View style={styles.permitGridItem}>
                <Text style={styles.permitGridLabel}>VEHICLE REG. NUMBER</Text>
                <Text style={styles.permitGridValue}>
                  {permit.vehiclePlate}
                </Text>
              </View>
            </View>

            <View style={styles.permitGrid}>
              <View style={styles.permitGridItem}>
                <Text style={styles.permitGridLabel}>IC NO.</Text>
                <Text style={styles.permitGridValue}>{permit.icNumber}</Text>
              </View>
              <View style={styles.permitGridItem}>
                <Text style={styles.permitGridLabel}>CLASS</Text>
                <Text style={styles.permitGridValue}>
                  {permit.licenseClass}
                </Text>
              </View>
            </View>

            <View style={styles.permitValidity}>
              <Calendar color="#fff" size={14} />
              <Text style={styles.permitValidityText}>
                {permit.issueDate} — {permit.expiryDate}
              </Text>
            </View>

            <View style={styles.permitQrRow}>
              <View style={styles.permitQrBox} testID="partner-teksi-permit-qr">
                <Image
                  source={{
                    uri: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(
                      `PERMIT:${permit.permitNumber}|IC:${permit.icNumber}|PLATE:${permit.vehiclePlate}|NAME:${permit.name}|EXP:${permit.expiryDate}`
                    )}`,
                  }}
                  style={styles.permitQrImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.permitQrTextWrap}>
                <Text style={styles.permitQrLabel}>SCAN TO VERIFY</Text>
                <Text style={styles.permitQrHint}>
                  QR code extracted from permit PDF. Authorities can scan to
                  verify your active permit details.
                </Text>
              </View>
            </View>
          </View>


          {false && (
          <View
            style={[
              styles.detailsCard,
              {
                backgroundColor: isLightMode ? "#fff" : "#111",
                borderColor: Colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.detailsHeader,
                { color: Colors.textSecondary },
              ]}
            >
              PERMIT DETAILS
            </Text>

            {[
              { icon: User, label: "NAMA", value: permit.name },
              { icon: Hash, label: "IC Number", value: permit.icNumber },
              {
                icon: BadgeCheck,
                label: "Permit Number",
                value: permit.permitNumber,
              },
              { icon: Car, label: "Vehicle Plate", value: permit.vehiclePlate },
              {
                icon: ShieldCheck,
                label: "License Class",
                value: permit.licenseClass,
              },
              {
                icon: Calendar,
                label: "Issued",
                value: permit.issueDate,
              },
              {
                icon: Calendar,
                label: "Expires",
                value: permit.expiryDate,
              },
              {
                icon: Building2,
                label: "Issued By",
                value: permit.authority,
              },
              { icon: MapPin, label: "Address", value: permit.address },
            ].map((row, idx, arr) => (
              <View
                key={row.label}
                style={[
                  styles.detailRow,
                  idx < arr.length - 1 && {
                    borderBottomColor: Colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View
                  style={[
                    styles.detailIcon,
                    { backgroundColor: Colors.accent + "1A" },
                  ]}
                >
                  <row.icon color={Colors.accentText} size={16} />
                </View>
                <View style={styles.detailTextWrap}>
                  <Text
                    style={[
                      styles.detailLabel,
                      { color: Colors.textSecondary },
                    ]}
                  >
                    {row.label}
                  </Text>
                  <Text
                    style={[styles.detailValue, { color: Colors.text }]}
                  >
                    {row.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.idleFooter,
            {
              backgroundColor: Colors.background,
              borderTopColor: Colors.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.meterDigitalBtn,
              {
                backgroundColor: isLightMode ? "#fff" : "#1a1a1a",
                borderColor: Colors.accent,
              },
            ]}
            onPress={() => {
              console.log("[partner-teksi] Meter Digital pressed");
              // The meter renders the driver card off the permit. Only hosted
              // photos travel as a param — a cropped permit portrait is a data
              // URL, far too long for a route.
              const permitPhoto = permit.photoUri?.startsWith("http")
                ? permit.photoUri
                : null;
              router.push({
                pathname: "/meter-digital",
                params: {
                  tariff,
                  ...(permit.vehiclePlate && permit.vehiclePlate !== "—"
                    ? { plate: permit.vehiclePlate }
                    : {}),
                  ...(permit.name && permit.name !== "—"
                    ? { driver: permit.name }
                    : {}),
                  ...(permit.permitNumber && permit.permitNumber !== "—"
                    ? { license: permit.permitNumber }
                    : {}),
                  ...(permitPhoto ? { photo: permitPhoto } : {}),
                },
              } as never);
            }}
            activeOpacity={0.85}
            testID="partner-teksi-meter-digital"
            accessibilityRole="button"
          >
            <Gauge color={Colors.accentText} size={18} />
            <Text style={[styles.meterDigitalText, { color: Colors.accentText }]}>
              Meter Digital
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.startPickupBtn,
              { backgroundColor: Colors.accent },
              !permitLoaded && styles.startPickupBtnDisabled,
            ]}
            onPress={() => {
              if (!permitLoaded) return;
              console.log("[partner-teksi] Start pickup pressed - validating permit");
              attemptStartPickup();
            }}
            disabled={!permitLoaded}
            activeOpacity={0.9}
            testID="partner-teksi-start-pickup"
            accessibilityRole="button"
          >
            {permitLoaded ? (
              <>
                <Play color="#fff" size={18} fill="#fff" />
                <Text style={styles.startPickupText}>Start Pickup</Text>
              </>
            ) : (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.startPickupText}>Loading permit…</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.testRideBtn,
              {
                backgroundColor: isLightMode ? "#fff" : "#1a1a1a",
                borderColor: Colors.accent,
              },
            ]}
            onPress={handleStartTestRide}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Test ride"
            testID="partner-teksi-test-ride"
          >
            <Zap color={Colors.accentText} size={16} />
            <Text style={[styles.testRideText, { color: Colors.accentText }]}>
              Test Ride (30s)
            </Text>
          </TouchableOpacity>
        </View>

        <PartnerModeSelectModal
          visible={driverModeVisible}
          onClose={() => setDriverModeVisible(false)}
          options={partnerModeOptions}
          onSelect={async (mode) => {
            console.log("Partner mode selected from partner-teksi idle:", mode);
            const n = mode.trim().toLowerCase();
            try {
              const docCheck = await checkPartnerModeDocuments(
                authState.userId,
                mode,
                getEntries
              );
              if (docCheck.blockingIssues.length > 0) {
                const body = summarizeDocIssues(docCheck.blockingIssues);
                Alert.alert(
                  "Update required documents",
                  `Before you can go online as ${mode}, please update the following:\n\n${body}`,
                  [
                    { text: "Not now", style: "cancel" as const },
                    {
                      text: "Update documents",
                      onPress: () => router.push("/partner-documents" as never),
                    },
                  ]
                );
                return;
              }
            } catch (e) {
              console.log("[partner-teksi-idle] doc-check failed", e);
            }
            if (n === "teksi" || n.includes("taxi")) {
              return;
            }
            router.replace("/partner-ehailing" as any);
          }}
        />

        <PartnerSideSheet
          visible={sideSheetVisible}
          onClose={() => setSideSheetVisible(false)}
        />

        <Modal
          visible={tariffPickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setTariffPickerVisible(false)}
        >
          <TouchableOpacity
            style={styles.tariffBackdrop}
            activeOpacity={1}
            onPress={() => setTariffPickerVisible(false)}
            accessibilityRole="button"
          >
            <TouchableOpacity
              activeOpacity={1}
              style={[
                styles.tariffSheet,
                {
                  backgroundColor: Colors.background,
                  paddingBottom: insets.bottom + 20,
                },
              ]}
            >
              <View style={[styles.handle, { backgroundColor: Colors.border, marginTop: 12 }]} />
              <View style={styles.tariffHeader}>
                <View style={[styles.tariffHeaderIcon, { backgroundColor: Colors.accent + "22" }]}>
                  <Banknote color={Colors.accentText} size={22} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tariffHeaderTitle, { color: Colors.text }]}>Select tariff</Text>
                  <Text style={[styles.tariffHeaderSub, { color: Colors.textSecondary }]}>
                    Choose the fare structure for this pickup.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.tariffOption,
                  {
                    backgroundColor: isLightMode ? "#fff" : "#111",
                    borderColor: Colors.accent,
                  },
                ]}
                onPress={() => {
                  console.log("[partner-teksi] tariff selected: NEW");
                  setTariff("new");
                  setTariffPickerVisible(false);
                  setIsIdle(false);
                }}
                testID="tariff-option-new"
                accessibilityRole="button"
              >
                <View style={styles.tariffOptionTop}>
                  <View style={[styles.tariffBadge, { backgroundColor: Colors.accent }]}>
                    <Text style={styles.tariffBadgeText}>NEW</Text>
                  </View>
                  <Text style={[styles.tariffOptionTitle, { color: Colors.text }]}>New Tariff</Text>
                </View>
                <Text style={[styles.tariffOptionFormula, { color: Colors.text }]}>
                  RM4 + RM1 / KM + RM0.30 / minute
                </Text>
                <Text style={[styles.tariffOptionHint, { color: Colors.textSecondary }]}>
                  Flat per-km and per-minute pricing. Simpler and predictable.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.tariffOption,
                  {
                    backgroundColor: isLightMode ? "#fff" : "#111",
                    borderColor: Colors.border,
                  },
                ]}
                onPress={() => {
                  console.log("[partner-teksi] tariff selected: OLD");
                  setTariff("old");
                  setTariffPickerVisible(false);
                  setIsIdle(false);
                }}
                testID="tariff-option-old"
                accessibilityRole="button"
              >
                <View style={styles.tariffOptionTop}>
                  <View style={[styles.tariffBadge, { backgroundColor: "#6B7280" }]}>
                    <Text style={styles.tariffBadgeText}>OLD</Text>
                  </View>
                  <Text style={[styles.tariffOptionTitle, { color: Colors.text }]}>Old Tariff</Text>
                </View>
                <Text style={[styles.tariffOptionFormula, { color: Colors.text }]}>
                  a) RM4.00 per KM or part{"\n"}
                  b) RM0.35 per 200 meters or{"\n"}
                  c) RM0.35 per 36 seconds
                </Text>
                <Text style={[styles.tariffOptionHint, { color: Colors.textSecondary }]}>
                  Standard regulated meter — increments by distance or time.
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <Modal
          visible={docPreviewVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setDocPreviewVisible(false)}
        >
          <View style={styles.docPreviewBackdrop}>
            <View style={[styles.docPreviewHeader, { paddingTop: insets.top + 8 }]}>
              <Text style={styles.docPreviewTitle} numberOfLines={1}>
                {permit.sourceDoc?.file_name ?? permit.requiredDocumentName ?? "Uploaded Document"}
              </Text>
              <TouchableOpacity
                onPress={() => setDocPreviewVisible(false)}
                style={styles.docPreviewClose}
                testID="partner-teksi-doc-preview-close-idle"
                accessibilityRole="button"
              >
                <X color="#fff" size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.docPreviewScroll}
              contentContainerStyle={styles.docPreviewScrollContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
            >
              {previewDocUrl ? (
                <View style={styles.docPreviewImageWrap}>
                  <Image
                    source={{ uri: previewDocUrl }}
                    style={styles.docPreviewImage}
                    resizeMode="contain"
                    onLoadStart={() => {
                      setDocPreviewLoading(true);
                      setDocPreviewError(false);
                    }}
                    onLoadEnd={() => setDocPreviewLoading(false)}
                    onError={(e) => {
                      console.log(
                        "[partner-teksi] doc preview image failed",
                        previewDocUrl,
                        e.nativeEvent?.error
                      );
                      setDocPreviewLoading(false);
                      setDocPreviewError(true);
                    }}
                  />
                  {docPreviewLoading ? (
                    <View style={styles.docPreviewOverlay}>
                      <ActivityIndicator color="#fff" size="large" />
                    </View>
                  ) : null}
                  {docPreviewError ? (
                    <View style={styles.docPreviewOverlay}>
                      <AlertCircle color="#fff" size={28} />
                      <Text style={styles.docPreviewErrorText}>
                        Couldn&apos;t load the document image.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.docPreviewImageWrap}>
                  <View style={styles.docPreviewOverlay}>
                    <AlertCircle color="#fff" size={28} />
                    <Text style={styles.docPreviewErrorText}>
                      No document image available.
                    </Text>
                  </View>
                </View>
              )}
              {permit.sourceDoc?.file_url_back ? (
                <View style={styles.docPreviewImageWrap}>
                  <Image
                    source={{ uri: permit.sourceDoc.file_url_back }}
                    style={styles.docPreviewImage}
                    resizeMode="contain"
                  />
                </View>
              ) : null}
            </ScrollView>
          </View>
        </Modal>

        <VehicleSelectModal
          visible={vehiclePickerVisible}
          loading={vehiclePickerLoading}
          vehicles={pickerVehicles}
          serviceName="TEKSI"
          onClose={() => setVehiclePickerVisible(false)}
          onSelect={(v) => void handleSelectVehicleForPickup(v)}
          onViewStatus={handleViewVehicleStatus}
          onAddNew={handleAddNewVehicle}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {Platform.OS !== "web" && MapView ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          onMapReady={() => {
            isMapReady.current = true;
            setTimeout(() => {
              initialLoadComplete.current = true;
            }, 500);
          }}
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          showsTraffic={trafficVisible}
          mapType={mapType}
          userInterfaceStyle={isLightMode ? "light" : "dark"}
        >
          <HeatmapOverlay
            center={{ latitude: region.latitude, longitude: region.longitude }}
            visible={heatmapVisible}
            hotspots={POPULAR_LOCATIONS.map((l) => ({
              latitude: l.latitude,
              longitude: l.longitude,
            }))}
            animated
          />
        </MapView>
      ) : (
        <WebMap
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          dark={!isLightMode}
          satellite={mapType === "satellite"}
          accentColor={Colors.accent}
          userLocation={
            currentLocation?.coords
              ? {
                  latitude: currentLocation.coords.latitude,
                  longitude: currentLocation.coords.longitude,
                }
              : null
          }
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
        />
      )}

      {/* Header */}
      <SafeAreaView style={[styles.headerSafe, { pointerEvents: "box-none" }]} edges={["top"]}>
        <View style={[styles.headerRow, { pointerEvents: "box-none" }]}>
          <TouchableOpacity
            style={[
              styles.iconButton,
              {
                backgroundColor: isLightMode
                  ? "#fff"
                  : "rgba(0,0,0,0.7)",
              },
            ]}
            onPress={() => setSideSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            testID="partner-teksi-menu"
          >
            <Menu color={isLightMode ? "#000" : "#fff"} size={22} />
          </TouchableOpacity>

          <View style={[styles.headerBadgeCenter, { pointerEvents: "box-none" }]}>
            <TouchableOpacity
              style={[
                styles.headerBadge,
                {
                  backgroundColor: Colors.accent,
                },
              ]}
              onPress={openPartnerModeSelector}
              activeOpacity={0.8}
              testID="partner-teksi-mode-switch"
              accessibilityRole="button"
            >
              <Car color="#000000" size={16} />
              <Text style={styles.headerBadgeText}>TEKSI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statusPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
                  borderColor: statusColor + "55",
                  marginTop: 8,
                },
              ]}
              onPress={() => setStatusModalVisible(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Status: ${statusLabel}. Change status`}
              testID="partner-teksi-status"
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Activity color={statusColor} size={12} />
              <Text style={[styles.statusPillText, { color: Colors.text }]} numberOfLines={1}>
                {statusLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.speedPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
                  borderColor: speedColor + "55",
                },
              ]}
              onPress={() => setStatusModalVisible(true)}
              activeOpacity={0.8}
              testID="partner-teksi-speed"
              accessibilityRole="button"
            >
              <Gauge color={speedColor} size={12} />
              <Text style={[styles.speedValue, { color: speedColor }]}>{speedKmh}</Text>
              <Text style={[styles.speedUnit, { color: Colors.subtext }]}>km/h</Text>
              <Text style={[styles.speedSource, { color: speedColor }]}>{speedSource}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.speedPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
                  borderColor: obdColor + "55",
                },
              ]}
              onPress={() => setCommTypeVisible(true)}
              activeOpacity={0.8}
              testID="partner-teksi-obd2"
              accessibilityRole="button"
            >
              <Cpu color={obdColor} size={12} />
              <Text style={[styles.obdPillLabel, { color: Colors.text }]}>OBD2</Text>
              <Text style={[styles.speedSource, { color: obdColor }]} numberOfLines={1}>
                {obdStatusText}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.walletGapSpacer, { pointerEvents: "none" }]} />

          <View style={styles.walletStack}>
            <TouchableOpacity
              style={[
                styles.walletPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
                },
              ]}
              onPress={() => router.push("/wallet?mode=partner&focus=credit" as any)}
              testID="partner-teksi-wallet-credit"
              accessibilityRole="button"
            >
              <View style={styles.walletTopRow}>
                <View style={[styles.walletIconBubble, { backgroundColor: "#F59E0B22" }]}>
                  <CreditCard color="#F59E0B" size={12} />
                </View>
                <Text style={[styles.walletLabel, { color: Colors.subtext }]} numberOfLines={1}>GET.credit</Text>
              </View>
              <Text style={[styles.walletValue, { color: Colors.text }]}>RM {creditBalance.toFixed(2)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.walletPill,
                {
                  backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
                },
              ]}
              onPress={() => router.push("/wallet?mode=partner&focus=wallet" as any)}
              testID="partner-teksi-wallet-cash"
              accessibilityRole="button"
            >
              <View style={styles.walletTopRow}>
                <View style={[styles.walletIconBubble, { backgroundColor: Colors.accent + "22" }]}>
                  <Wallet color={Colors.accentText} size={12} />
                </View>
                <Text style={[styles.walletLabel, { color: Colors.subtext }]} numberOfLines={1}>GET.wallet</Text>
              </View>
              <Text style={[styles.walletValue, { color: Colors.text }]}>RM {walletBalance.toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Center Pin */}
      <View style={[styles.pinContainer, { pointerEvents: "none" }]}>
        <Animated.View
          style={[
            styles.pinLabelContainer,
            {
              opacity: addressBarOpacity,
              backgroundColor: Colors.accent,
            },
          ]}
        >
          <Text style={styles.pinLabel} numberOfLines={1}>
            {isLoading ? "Locating…" : locationName}
          </Text>
          {!isLoading && locationAddress ? (
            <Text style={styles.pinSubLabel} numberOfLines={1}>
              {locationAddress}
            </Text>
          ) : null}
        </Animated.View>
        <Animated.View
          style={[styles.pinWrapper, { transform: [{ translateY: pinDropAnim }] }]}
        >
          <View style={[styles.pinOuter, { backgroundColor: Colors.accent }]}>
            <Animated.View
              style={[
                styles.pinInner,
                {
                  transform: [{ scale: pinInnerScaleAnim }],
                  backgroundColor: "#fff",
                },
              ]}
            />
          </View>
          <View style={[styles.pinPointer, { backgroundColor: Colors.accent }]} />
        </Animated.View>
        <Animated.View
          style={[
            styles.pinShadowDot,
            {
              opacity: pinShadowOpacity,
              backgroundColor: Colors.accent + "99",
            },
          ]}
        />
      </View>

      {/* Map type toggle (above traffic) */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 178,
            backgroundColor:
              mapType === "satellite"
                ? Colors.accent
                : isLightMode
                ? "#fff"
                : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={() => {
          setMapType((prev) => {
            const next = prev === "standard" ? "satellite" : "standard";
            console.log("[partner-teksi] map type", next);
            return next;
          });
        }}
        testID="partner-teksi-maptype"
        accessibilityRole="button"
        accessibilityLabel="Map type"
      >
        <Layers
          color={mapType === "satellite" ? "#fff" : isLightMode ? "#000" : "#fff"}
          size={20}
        />
      </TouchableOpacity>

      {/* Traffic toggle button (above heatmap) */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 122,
            backgroundColor: trafficVisible
              ? Colors.accent
              : isLightMode
              ? "#fff"
              : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={() => {
          setTrafficVisible((v) => {
            console.log("[partner-teksi] traffic", !v ? "ON" : "OFF");
            return !v;
          });
        }}
        testID="partner-teksi-traffic"
        accessibilityRole="button"
        accessibilityLabel="Traffic overlay"
      >
        <TrafficCone
          color={trafficVisible ? "#fff" : isLightMode ? "#000" : "#fff"}
          size={20}
        />
      </TouchableOpacity>

      {/* Heatmap toggle button (above recenter) */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 66,
            backgroundColor: heatmapVisible
              ? Colors.accent
              : isLightMode
              ? "#fff"
              : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={() => {
          setHeatmapVisible((v) => {
            console.log("[partner-teksi] heatmap", !v ? "ON" : "OFF");
            return !v;
          });
        }}
        testID="partner-teksi-heatmap"
        accessibilityRole="button"
        accessibilityLabel="Demand heatmap"
      >
        <Hexagon
          color={heatmapVisible ? "#fff" : isLightMode ? "#000" : "#fff"}
          size={20}
        />
      </TouchableOpacity>

      {/* Current location button */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 10,
            backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={handleCurrentLocation}
        accessibilityRole="button"
        accessibilityLabel="Recenter map on my location"
        testID="partner-teksi-locate"
      >
        <Navigation color={isLightMode ? "#000" : "#fff"} size={20} />
      </TouchableOpacity>

      {/* Bottom Sheet */}
      <Animated.View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h && Math.abs(h - bottomSheetHeight) > 0.5) {
            setBottomSheetHeight(h);
          }
        }}
        style={[
          styles.bottomSheet,
          {
            backgroundColor: Colors.background,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
            shadowColor: "#000",
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: Colors.border }]} />

        <Text style={[styles.sheetTitle, { color: Colors.text }]}>
          Set your drop location
        </Text>
        <Text style={[styles.sheetSubtitle, { color: Colors.textSecondary }]}>
          Where are you heading? We&apos;ll match nearby riders going your way.
        </Text>

        <TouchableOpacity
          style={[
            styles.searchInputBox,
            {
              backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a",
              borderColor: Colors.border,
            },
          ]}
          onPress={() => setSearchVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Search"
          testID="partner-teksi-search"
        >
          <Search color={Colors.textSecondary} size={18} />
          <View style={styles.searchInputTextWrap}>
            <Text
              style={[styles.searchInputText, { color: Colors.text }]}
              numberOfLines={1}
            >
              {locationName && !isLoading ? locationName : "Search drop location"}
            </Text>
            {locationAddress && !isLoading ? (
              <Text
                style={[styles.searchInputSubText, { color: Colors.textSecondary }]}
                numberOfLines={1}
              >
                {locationAddress}
              </Text>
            ) : null}
          </View>
          <View
            style={[
              styles.pinChip,
              { backgroundColor: Colors.accent + "1A" },
            ]}
          >
            <MapPin color={Colors.accentText} size={12} />
            <Text style={[styles.pinChipText, { color: Colors.accentText }]}>
              Pin
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.confirmButton, { backgroundColor: Colors.accent }]}
          onPress={handleConfirm}
          testID="partner-teksi-confirm"
          accessibilityRole="button"
        >
          <Text style={styles.confirmButtonText}>Confirm drop location</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Fare summary modal */}
      <Modal
        visible={fareModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseFareModal}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.modalCard,
              {
                backgroundColor: Colors.background,
                paddingBottom: insets.bottom + 20,
                transform: [
                  {
                    translateY: fareModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [400, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: Colors.border, marginTop: 12 }]} />

            <View style={[styles.modalIconWrap, { backgroundColor: Colors.accent + "1A" }]}>
              <CheckCircle2 color={Colors.accentText} size={32} />
            </View>

            <Text style={[styles.modalTitle, { color: Colors.text }]}>Trip summary</Text>
            <Text style={[styles.modalSubtitle, { color: Colors.textSecondary }]} numberOfLines={2}>
              Heading to {locationName}{locationAddress ? `, ${locationAddress}` : ""}
            </Text>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
                <View style={[styles.statIcon, { backgroundColor: Colors.accent + "22" }]}>
                  <Route color={Colors.accentText} size={18} />
                </View>
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {isCalculatingRoute ? "…" : `${distanceKm.toFixed(1)} km`}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Distance</Text>
              </View>

              <View style={[styles.statCard, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
                <View style={[styles.statIcon, { backgroundColor: Colors.accent + "22" }]}>
                  <Timer color={Colors.accentText} size={18} />
                </View>
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {isCalculatingRoute ? "…" : `${estimatedMinutes} min`}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Duration</Text>
              </View>
            </View>

            <View style={[styles.fareCard, { backgroundColor: Colors.accent }]}>
              <View style={styles.fareLabelRow}>
                <Wallet color="#fff" size={18} />
                <Text style={styles.fareLabel}>Estimated fare</Text>
              </View>
              <View style={styles.fareAmountRow}>
                <Text style={styles.fareCurrency}>RM</Text>
                <Text style={styles.fareAmount}>{isCalculatingRoute ? "…" : Math.ceil(fareEstimate)}</Text>
              </View>
              <View style={styles.fareTariffList}>
                {tariff === "new" ? (
                  <>
                    <Text style={styles.fareTariffLine}>RM4.00 base fare</Text>
                    <Text style={styles.fareTariffLine}>+ RM1.00 per KM</Text>
                    <Text style={styles.fareTariffLine}>+ RM0.30 per minute</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.fareTariffLine}>a) RM4.00 per KM or part</Text>
                    <Text style={styles.fareTariffLine}>b) RM0.35 per 200 meters or</Text>
                    <Text style={styles.fareTariffLine}>c) RM0.35 per 36 seconds</Text>
                  </>
                )}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: Colors.border }]}
                onPress={handleCloseFareModal}
                testID="fare-modal-cancel"
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
                onPress={handleStartDriving}
                testID="fare-modal-start"
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>Start driving</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Search overlay */}
      {searchVisible && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: Colors.background, zIndex: 50 },
          ]}
        >
          <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
            <View style={styles.searchHeader}>
              <TouchableOpacity
                onPress={() => {
                  setSearchVisible(false);
                  setSearchQuery("");
                  Keyboard.dismiss();
                }}
                style={styles.searchClose}
                testID="partner-teksi-search-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={24} />
              </TouchableOpacity>
              <Text style={[styles.searchTitle, { color: Colors.text }]}>
                Drop location
              </Text>
              <View style={styles.searchClose} />
            </View>

            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a",
                  borderColor: Colors.border,
                },
              ]}
            >
              <Search color={Colors.textSecondary} size={20} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search a place"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                autoFocus
                accessibilityLabel="Search a place"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")} accessibilityRole="button">
                  <X color={Colors.textSecondary} size={18} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.suggestionsContent}
            >
              <Text
                style={[
                  styles.suggestionsHeader,
                  { color: Colors.textSecondary },
                ]}
              >
                {searchQuery.trim() ? (isSearching ? "Searching…" : "Results") : "Popular places"}
              </Text>
              {filteredSuggestions.length === 0 ? (
                <View style={styles.emptyState}>
                  <MapPin color={Colors.textSecondary} size={36} />
                  <Text style={[styles.emptyText, { color: Colors.text }]}>
                    {isSearching ? "Searching…" : searchQuery.trim().length > 0 && searchQuery.trim().length < 2 ? "Type at least 2 characters" : "No places found"}
                  </Text>
                </View>
              ) : (
                filteredSuggestions.map((loc) => (
                  <TouchableOpacity
                    key={loc.id}
                    style={[
                      styles.suggestionRow,
                      { borderBottomColor: Colors.border },
                    ]}
                    onPress={() => handlePickSuggestion(loc)}
                    accessibilityRole="button"
                  >
                    <View
                      style={[
                        styles.suggestionIcon,
                        { backgroundColor: Colors.accent + "1A" },
                      ]}
                    >
                      <Clock color={Colors.accentText} size={18} />
                    </View>
                    <View style={styles.suggestionTextWrap}>
                      <Text
                        style={[styles.suggestionName, { color: Colors.text }]}
                        numberOfLines={1}
                      >
                        {loc.name}
                      </Text>
                      <Text
                        style={[
                          styles.suggestionAddress,
                          { color: Colors.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {loc.address}
                      </Text>
                      <PlaceGatesList lat={loc.latitude} lon={loc.longitude} name={loc.name} />
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      )}

      <PartnerModeSelectModal
        visible={driverModeVisible}
        onClose={() => setDriverModeVisible(false)}
        options={partnerModeOptions}
        onSelect={(mode) => {
          console.log("Partner mode selected from partner-teksi:", mode);
          const n = mode.trim().toLowerCase();
          if (n === "teksi" || n.includes("taxi")) {
            return;
          }
          router.replace("/partner-ehailing" as any);
        }}
      />

      <PartnerSideSheet
        visible={sideSheetVisible}
        onClose={() => setSideSheetVisible(false)}
      />

      {/* OBD2 Communication Type Modal */}
      <Modal
        visible={commTypeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCommTypeVisible(false)}
      >
        <TouchableOpacity
          style={styles.statusBackdrop}
          activeOpacity={1}
          onPress={() => setCommTypeVisible(false)}
          accessibilityRole="button"
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.statusSheet,
              {
                backgroundColor: Colors.background,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: Colors.border, marginTop: 12 }]} />
            <View style={styles.commHeaderRow}>
              <Text style={[styles.commHeaderText, { color: Colors.text }]}>COMMUNICATION TYPE</Text>
              <TouchableOpacity
                onPress={() => setCommTypeVisible(false)}
                style={[styles.statusClose, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}
                testID="comm-type-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.commSubText, { color: Colors.textSecondary }]}>
              {obdLinked && canbusDevice
                ? `Connected via ${TRANSPORT_LABEL[canbusDevice.transport]} — ${canbusDevice.name}`
                : obdDemo
                ? "Demo Mode — virtual vehicle data"
                : "No OBD-II adapter connected. Select how to connect to your vehicle."}
            </Text>

            <ScrollView
              style={{ maxHeight: 480 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={[
                  styles.commCard,
                  {
                    backgroundColor: isLightMode ? "#F9FAFB" : "#111",
                    borderColor: Colors.border,
                  },
                ]}
              >
                {commOptions.map((opt, idx) => {
                  const avail = opt.kind
                    ? canbus.availability.find((a) => a.kind === opt.kind)
                    : null;
                  const unavailable = !!opt.kind && !(avail?.available ?? false);
                  const isSelected = selectedComm === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.commRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: Colors.border,
                        },
                      ]}
                      onPress={() => handleSelectCommType(opt)}
                      activeOpacity={0.7}
                      testID={`comm-type-${opt.id}`}
                      accessibilityRole="button"
                    >
                      <View style={{ flex: 1, opacity: unavailable ? 0.55 : 1 }}>
                        <Text style={[styles.commTitle, { color: Colors.text }]}>{opt.title}</Text>
                        {opt.lines.map((line, i) => (
                          <Text
                            key={`${opt.id}-line-${i}`}
                            style={[styles.commLine, { color: Colors.textSecondary }]}
                          >
                            {line}
                          </Text>
                        ))}
                        {unavailable ? (
                          <Text style={[styles.commHint, { color: Colors.textSecondary }]}>Not available in this build</Text>
                        ) : null}
                      </View>
                      <View style={styles.commCheckSlot}>
                        {isSelected ? <Check color={Colors.accentText} size={24} strokeWidth={3} /> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* System Status Modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.statusBackdrop}
          activeOpacity={1}
          onPress={() => setStatusModalVisible(false)}
          accessibilityRole="button"
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.statusSheet,
              {
                backgroundColor: Colors.background,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: Colors.border, marginTop: 12 }]} />
            <View style={styles.statusHeader}>
              <View style={[styles.statusHeaderIcon, { backgroundColor: statusColor + "22" }]}>
                <Activity color={statusColor} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusTitle, { color: Colors.text }]}>System Status</Text>
                <Text style={[styles.statusSubtitle, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setStatusModalVisible(false)}
                style={[styles.statusClose, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}
                testID="status-modal-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: 460 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {systemStatuses.map((s) => {
                const c = s.status === "ok" ? "#22C55E" : s.status === "warn" ? "#F59E0B" : "#EF4444";
                const StatusIcon = s.status === "ok" ? CheckCircle : s.status === "warn" ? AlertCircle : XCircle;
                return (
                  <View
                    key={s.id}
                    style={[
                      styles.statusRow,
                      {
                        backgroundColor: isLightMode ? "#F9FAFB" : "#111",
                        borderColor: Colors.border,
                      },
                    ]}
                    testID={`status-row-${s.id}`}
                  >
                    <View style={[styles.statusRowIcon, { backgroundColor: c + "22" }]}>
                      <s.icon color={c} size={20} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.statusRowLabel, { color: Colors.text }]}>{s.label}</Text>
                      <Text style={[styles.statusRowSub, { color: Colors.textSecondary }]}>{s.sub}</Text>
                      <Text style={[styles.statusRowDetail, { color: c }]}>{s.detail}</Text>
                    </View>
                    <StatusIcon color={c} size={22} />
                  </View>
                );
              })}

              {/* CANBus / OBD-II vehicle link controls */}
              <View
                style={[
                  styles.canbusPanel,
                  { backgroundColor: isLightMode ? "#F9FAFB" : "#111", borderColor: Colors.border },
                ]}
                testID="canbus-panel"
              >
                <View style={styles.canbusPanelHeader}>
                  <Cpu color={Colors.text} size={16} />
                  <Text style={[styles.canbusPanelTitle, { color: Colors.text }]}>Vehicle link (CANBus)</Text>
                </View>

                <Text style={[styles.canbusPanelSub, { color: Colors.textSecondary }]}>
                  {canbusDevice
                    ? `Connected via ${TRANSPORT_LABEL[canbusDevice.transport]} — ${canbusDevice.name}`
                    : canbusConnecting
                    ? "Searching for an OBD-II adapter…"
                    : "No adapter connected"}
                </Text>
                {canbusState.protocol ? (
                  <Text style={[styles.canbusPanelSub, { color: Colors.textSecondary }]}>
                    {canbusState.protocol}
                  </Text>
                ) : null}

                {/* Which physical transports this build can attempt */}
                <View style={styles.canbusTransportRow}>
                  {canbus.availability.map((a) => {
                    const TIcon = TRANSPORT_ICON[a.kind];
                    const active = canbusDevice?.transport === a.kind && canbusOnline;
                    const tint = active ? "#22C55E" : a.available ? Colors.textSecondary : "#9CA3AF";
                    return (
                      <View
                        key={a.kind}
                        style={[styles.canbusChip, { borderColor: tint + "55", opacity: a.available ? 1 : 0.5 }]}
                      >
                        <TIcon color={tint} size={12} />
                        <Text style={[styles.canbusChipText, { color: tint }]}>
                          {TRANSPORT_LABEL[a.kind]}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Live telemetry grid when online */}
                {canbusOnline ? (
                  <View style={styles.canbusTelemetryGrid}>
                    {(Object.keys(canbusState.telemetry) as (keyof typeof canbusState.telemetry)[]).map((k) => {
                      const v = canbusState.telemetry[k];
                      if (typeof v !== "number") return null;
                      return (
                        <View key={k} style={styles.canbusTelemetryCell}>
                          <Text style={[styles.canbusTelemetryValue, { color: Colors.text }]}>
                            {formatTelemetryValue(k, v)}
                          </Text>
                          <Text style={[styles.canbusTelemetryKey, { color: Colors.textSecondary }]}>{k}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.canbusButton,
                    { backgroundColor: canbusOnline ? "#EF444422" : Colors.accent },
                  ]}
                  disabled={canbusConnecting}
                  onPress={() => {
                    if (canbusOnline) void canbus.disconnect();
                    else void canbus.connect();
                  }}
                  testID="canbus-connect-button"
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.canbusButtonText,
                      { color: canbusOnline ? "#EF4444" : "#000" },
                    ]}
                  >
                    {canbusConnecting
                      ? "Connecting…"
                      : canbusOnline
                      ? "Disconnect"
                      : canbus.availableTransports.length > 0
                      ? "Connect adapter"
                      : "Retry"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Uploaded Document Preview Modal */}
      <Modal
        visible={docPreviewVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setDocPreviewVisible(false)}
      >
        <View style={styles.docPreviewBackdrop}>
          <View style={[styles.docPreviewHeader, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.docPreviewTitle} numberOfLines={1}>
              {permit.sourceDoc?.file_name ?? permit.requiredDocumentName ?? "Uploaded Document"}
            </Text>
            <TouchableOpacity
              onPress={() => setDocPreviewVisible(false)}
              style={styles.docPreviewClose}
              testID="partner-teksi-doc-preview-close"
              accessibilityRole="button"
            >
              <X color="#fff" size={20} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.docPreviewScroll}
            contentContainerStyle={styles.docPreviewScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsVerticalScrollIndicator={false}
          >
            {previewDocUrl ? (
              <View style={styles.docPreviewImageWrap}>
                <Image
                  source={{ uri: previewDocUrl }}
                  style={styles.docPreviewImage}
                  resizeMode="contain"
                  onLoadStart={() => {
                    setDocPreviewLoading(true);
                    setDocPreviewError(false);
                  }}
                  onLoadEnd={() => setDocPreviewLoading(false)}
                  onError={(e) => {
                    console.log(
                      "[partner-teksi] doc preview image failed",
                      previewDocUrl,
                      e.nativeEvent?.error
                    );
                    setDocPreviewLoading(false);
                    setDocPreviewError(true);
                  }}
                />
                {docPreviewLoading ? (
                  <View style={styles.docPreviewOverlay}>
                    <ActivityIndicator color="#fff" size="large" />
                  </View>
                ) : null}
                {docPreviewError ? (
                  <View style={styles.docPreviewOverlay}>
                    <AlertCircle color="#fff" size={28} />
                    <Text style={styles.docPreviewErrorText}>
                      Couldn&apos;t load the document image.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.docPreviewImageWrap}>
                <View style={styles.docPreviewOverlay}>
                  <AlertCircle color="#fff" size={28} />
                  <Text style={styles.docPreviewErrorText}>
                    No document image available.
                  </Text>
                </View>
              </View>
            )}
            {permit.sourceDoc?.file_url_back ? (
              <View style={styles.docPreviewImageWrap}>
                <Image
                  source={{ uri: permit.sourceDoc.file_url_back }}
                  style={styles.docPreviewImage}
                  resizeMode="contain"
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      {/* Fullscreen Start Driving confirmation */}
      <Modal
        visible={startConfirmVisible}
        animationType="none"
        transparent={false}
        onRequestClose={handleCloseStartConfirm}
        presentationStyle="fullScreen"
      >
        <Animated.View
          style={[
            styles.startFullContainer,
            {
              backgroundColor: Colors.background,
              opacity: startConfirmAnim,
              transform: [
                {
                  scale: startConfirmAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
            <View style={styles.startFullHeader}>
              <TouchableOpacity
                style={[
                  styles.startFullClose,
                  { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                ]}
                onPress={handleCloseStartConfirm}
                testID="start-confirm-close"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <ArrowLeft color={Colors.text} size={22} />
              </TouchableOpacity>
              <Text style={[styles.startFullEyebrow, { color: Colors.accentText }]}>
                READY TO ROLL
              </Text>
              <View style={styles.startFullClose} />
            </View>

            <ScrollView
              contentContainerStyle={styles.startFullContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.startFullTitle, { color: Colors.text }]}>
                Confirm your trip
              </Text>
              <Text
                style={[styles.startFullSubtitle, { color: Colors.textSecondary }]}
                numberOfLines={3}
              >
                Heading to {locationName}
                {locationAddress ? `, ${locationAddress}` : ""}
              </Text>

              <View style={[styles.startFareHero, { backgroundColor: Colors.accent }]}>
                <View style={styles.startFareTopRow}>
                  <View style={styles.startFareIconBubble}>
                    <Wallet color="#fff" size={18} />
                  </View>
                  <Text style={styles.startFareLabel}>Estimated fare</Text>
                </View>
                <View style={styles.startFareAmountRow}>
                  <Text style={styles.startFareCurrency}>RM</Text>
                  <Text style={styles.startFareAmount}>
                    {isCalculatingRoute ? "…" : Math.ceil(fareEstimate)}
                  </Text>
                </View>
                <View style={styles.startFareTariffList}>
                  {tariff === "new" ? (
                    <>
                      <Text style={styles.startFareTariffLine}>RM4.00 base fare</Text>
                      <Text style={styles.startFareTariffLine}>+ RM1.00 per KM</Text>
                      <Text style={styles.startFareTariffLine}>+ RM0.30 per minute</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.startFareTariffLine}>a) RM4.00 per KM or part</Text>
                      <Text style={styles.startFareTariffLine}>b) RM0.35 per 200 meters or</Text>
                      <Text style={styles.startFareTariffLine}>c) RM0.35 per 36 seconds</Text>
                    </>
                  )}
                </View>
              </View>

              <View style={styles.startStatsRow}>
                <View
                  style={[
                    styles.startStatCard,
                    {
                      backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a",
                      borderColor: Colors.border,
                    },
                  ]}
                >
                  <View style={[styles.startStatIcon, { backgroundColor: Colors.accent + "22" }]}>
                    <Route color={Colors.accentText} size={18} />
                  </View>
                  <Text style={[styles.startStatValue, { color: Colors.text }]}>
                    {isCalculatingRoute ? "…" : `${distanceKm.toFixed(1)} km`}
                  </Text>
                  <Text style={[styles.startStatLabel, { color: Colors.textSecondary }]}>
                    Distance
                  </Text>
                </View>
                <View
                  style={[
                    styles.startStatCard,
                    {
                      backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a",
                      borderColor: Colors.border,
                    },
                  ]}
                >
                  <View style={[styles.startStatIcon, { backgroundColor: Colors.accent + "22" }]}>
                    <Timer color={Colors.accentText} size={18} />
                  </View>
                  <Text style={[styles.startStatValue, { color: Colors.text }]}>
                    {isCalculatingRoute ? "…" : `${estimatedMinutes} min`}
                  </Text>
                  <Text style={[styles.startStatLabel, { color: Colors.textSecondary }]}>
                    Duration
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.startRouteCard,
                  {
                    backgroundColor: isLightMode ? "#fff" : "#111",
                    borderColor: Colors.border,
                  },
                ]}
              >
                <View style={styles.startRouteRow}>
                  <View style={[styles.startRouteDot, { backgroundColor: "#22C55E" }]} />
                  <View style={styles.startRouteTextWrap}>
                    <Text style={[styles.startRouteLabel, { color: Colors.textSecondary }]}>
                      PICKUP
                    </Text>
                    <Text
                      style={[styles.startRouteValue, { color: Colors.text }]}
                      numberOfLines={1}
                    >
                      {pickupName}
                    </Text>
                    {pickupAddress ? (
                      <Text
                        style={[styles.startRouteSub, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {pickupAddress}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View
                  style={[styles.startRouteDivider, { backgroundColor: Colors.border }]}
                />
                <View style={styles.startRouteRow}>
                  <View style={[styles.startRouteDot, { backgroundColor: Colors.accent }]} />
                  <View style={styles.startRouteTextWrap}>
                    <Text style={[styles.startRouteLabel, { color: Colors.textSecondary }]}>
                      DROP-OFF
                    </Text>
                    <Text
                      style={[styles.startRouteValue, { color: Colors.text }]}
                      numberOfLines={1}
                    >
                      {locationName}
                    </Text>
                    {locationAddress ? (
                      <Text
                        style={[styles.startRouteSub, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {locationAddress}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>

              <View style={styles.startTipRow}>
                <ShieldCheck color={Colors.accentText} size={14} />
                <Text style={[styles.startTipText, { color: Colors.textSecondary }]}>
                  Drive safely. Fare is an estimate; final amount may vary based on actual route and traffic.
                </Text>
              </View>
            </ScrollView>

            <View
              style={[
                styles.startFullFooter,
                {
                  backgroundColor: Colors.background,
                  borderTopColor: Colors.border,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.startGoBtn,
                  {
                    backgroundColor: Colors.accent,
                    opacity: isCalculatingRoute || !Number.isFinite(fareEstimate) || fareEstimate <= 0 ? 0.5 : 1,
                  },
                ]}
                onPress={handleConfirmStart}
                disabled={isCalculatingRoute || !Number.isFinite(fareEstimate) || fareEstimate <= 0}
                activeOpacity={0.9}
                testID="start-confirm-go"
                accessibilityRole="button"
              >
                <Play color="#fff" size={18} fill="#fff" />
                <Text style={styles.startGoBtnText}>
                  {isCalculatingRoute || !Number.isFinite(fareEstimate) || fareEstimate <= 0 ? "Calculating fare…" : "Start"}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  startFullContainer: {
    flex: 1,
  },
  startFullHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  startFullClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  startFullEyebrow: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 1.4,
  },
  startFullContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  startFullTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    letterSpacing: -0.4,
  },
  startFullSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 22,
  },
  startFareHero: {
    borderRadius: 22,
    padding: 32,
    marginBottom: 16,
    alignItems: "center" as const,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 6,
  },
  startFareTopRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 14,
  },
  startFareIconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  startFareLabel: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
  },
  startFareAmountRow: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    justifyContent: "center" as const,
    marginTop: 20,
    gap: 10,
  },
  startFareCurrency: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "700" as const,
    marginBottom: 16,
    opacity: 0.9,
  },
  startFareAmount: {
    color: "#fff",
    fontSize: 120,
    fontWeight: "900" as const,
    letterSpacing: -3,
    lineHeight: 120,
    textAlign: "center" as const,
  },
  startFareSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 20,
    fontWeight: "600" as const,
    marginTop: 12,
    textAlign: "center" as const,
  },
  startFareTariffList: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.35)",
    alignSelf: "stretch" as const,
    gap: 4,
  },
  startFareTariffLine: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  startStatsRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 16,
  },
  startStatCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  startStatIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 8,
  },
  startStatValue: {
    fontSize: 18,
    fontWeight: "800" as const,
  },
  startStatLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    marginTop: 2,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  startRouteCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  startRouteRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
  },
  startRouteDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  startRouteTextWrap: {
    flex: 1,
  },
  startRouteLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  startRouteValue: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  startRouteSub: {
    fontSize: 12,
    marginTop: 2,
  },
  startRouteDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
    marginLeft: 22,
  },
  startTipRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  startTipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  startFullFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  startGoBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  startGoBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800" as const,
    letterSpacing: 0.4,
  },
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  webPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  webText: {
    fontSize: 18,
    fontWeight: "700" as const,
    marginTop: 12,
  },
  webSubtext: {
    fontSize: 13,
    marginTop: 4,
  },
  headerSafe: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    position: "relative" as const,
  },
  headerBadgeCenter: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    pointerEvents: "box-none" as const,
  },
  walletGapSpacer: {
    width: 5,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  iconButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  walletStack: {
    gap: 6,
    alignItems: "flex-end" as const,
  },
  walletPill: {
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    minWidth: 110,
  },
  walletIconBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  walletLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
  },
  walletValue: {
    fontSize: 12,
    fontWeight: "800" as const,
    textAlign: "center" as const,
    alignSelf: "center" as const,
  },
  walletTextRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  walletTopRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    alignSelf: "center" as const,
    gap: 6,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  headerBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  idleBadgeStack: {
    alignItems: "center" as const,
    gap: 8,
  },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
    maxWidth: 220,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.2,
  },
  speedPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  speedValue: {
    fontSize: 13,
    fontWeight: "800" as const,
    letterSpacing: 0.2,
  },
  speedUnit: {
    fontSize: 10,
    fontWeight: "600" as const,
  },
  speedSource: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
    marginLeft: 2,
  },
  obdPillLabel: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  commHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  commHeaderText: {
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  commSubText: {
    fontSize: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  commCard: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  commRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
  },
  commTitle: {
    fontSize: 17,
    fontWeight: "800" as const,
    marginBottom: 6,
  },
  commLine: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  commHint: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: "#9CA3AF",
    marginTop: 2,
  },
  commCheckSlot: {
    width: 28,
    alignItems: "center" as const,
  },
  statusBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  canbusPanel: {
    marginTop: 4,
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  canbusPanelHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 6,
  },
  canbusPanelTitle: {
    fontSize: 14,
    fontWeight: "800" as const,
  },
  canbusPanelSub: {
    fontSize: 12,
    marginBottom: 2,
  },
  canbusTransportRow: {
    flexDirection: "row" as const,
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  canbusChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  canbusChipText: {
    fontSize: 11,
    fontWeight: "700" as const,
  },
  canbusTelemetryGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
    marginTop: 10,
  },
  canbusTelemetryCell: {
    minWidth: 78,
  },
  canbusTelemetryValue: {
    fontSize: 13,
    fontWeight: "800" as const,
  },
  canbusTelemetryKey: {
    fontSize: 10,
    textTransform: "capitalize" as const,
  },
  canbusButton: {
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center" as const,
  },
  canbusButtonText: {
    fontSize: 14,
    fontWeight: "800" as const,
  },
  statusSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  statusHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingTop: 16,
    paddingBottom: 16,
  },
  statusHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: "800" as const,
    letterSpacing: -0.2,
  },
  statusSubtitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    marginTop: 2,
  },
  statusClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  statusRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  statusRowLabel: {
    fontSize: 15,
    fontWeight: "800" as const,
  },
  statusRowSub: {
    fontSize: 12,
    marginTop: 1,
  },
  statusRowDetail: {
    fontSize: 12,
    fontWeight: "700" as const,
    marginTop: 4,
  },
  pinContainer: {
    position: "absolute" as const,
    top: "42%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  pinLabelContainer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
    maxWidth: "80%",
  },
  pinLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  pinSubLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "500" as const,
    textAlign: "center" as const,
    marginTop: 2,
  },
  pinWrapper: {
    alignItems: "center",
  },
  pinOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  pinInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pinPointer: {
    width: 3,
    height: 16,
    marginTop: -2,
  },
  pinShadowDot: {
    width: 10,
    height: 4,
    borderRadius: 5,
    marginTop: 3,
  },
  currentLocationButton: {
    position: "absolute" as const,
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  bottomSheet: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 12,
  },
  handle: {
    alignSelf: "center" as const,
    width: 44,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "800" as const,
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  searchInputBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    marginBottom: 14,
  },
  searchInputTextWrap: {
    flex: 1,
  },
  searchInputText: {
    fontSize: 15,
    fontWeight: "600" as const,
  },
  searchInputSubText: {
    fontSize: 12,
    fontWeight: "500" as const,
    marginTop: 2,
  },
  pinChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pinChipText: {
    fontSize: 11,
    fontWeight: "700" as const,
  },
  confirmButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  searchTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  suggestionsContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  suggestionsHeader: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
    marginBottom: 8,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  suggestionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  suggestionAddress: {
    fontSize: 13,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 4,
    alignItems: "center",
  },
  modalIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800" as const,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: "center" as const,
    marginBottom: 20,
    paddingHorizontal: 12,
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: "row",
    width: "100%",
    gap: 12,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignItems: "flex-start",
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800" as const,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  fareCard: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderRadius: 20,
    marginBottom: 18,
  },
  fareLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  fareLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  fareLabel: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  fareAmountRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  fareTariffList: {
    marginTop: 10,
    alignItems: "center" as const,
    gap: 2,
  },
  fareTariffLine: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "500" as const,
  },
  fareCurrency: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700" as const,
    marginTop: 8,
    marginRight: 4,
  },
  fareSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center" as const,
  },
  fareAmount: {
    color: "#fff",
    fontSize: 56,
    fontWeight: "900" as const,
    letterSpacing: -1,
    lineHeight: 64,
  },
  modalActions: {
    width: "100%",
    flexDirection: "row",
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  primaryBtn: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  idleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  idleScroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  idleTitleWrap: {
    marginBottom: 20,
  },
  idleEyebrow: {
    fontSize: 28,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: "center" as const,
  },
  idleTitle: {
    fontSize: 28,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  idleSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  permitCard: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  permitTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  permitBadgeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  permitDocIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  permitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  permitBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  permitClassWrap: {
    alignItems: "flex-end",
    flexShrink: 1,
  },
  permitClassText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900" as const,
    letterSpacing: 2,
  },
  permitClassAddress: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "600" as const,
    textAlign: "right" as const,
    marginTop: 2,
  },
  docPreviewLink: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
  },
  docPreviewLinkText: {
    fontSize: 15,
    fontWeight: "700" as const,
    textDecorationLine: "underline" as const,
  },
  docPreviewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
  },
  docPreviewHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  docPreviewTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "700" as const,
  },
  docPreviewClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  docPreviewScroll: {
    flex: 1,
  },
  docPreviewScrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 40,
    gap: 16,
  },
  docPreviewImageWrap: {
    width: Dimensions.get("window").width - 24,
    height: (Dimensions.get("window").width - 24) / 0.7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    overflow: "hidden" as const,
  },
  docPreviewImage: {
    width: "100%" as const,
    height: "100%" as const,
  },
  docPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 10,
    padding: 20,
  },
  docPreviewErrorText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  permitAuthority: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  permitDriverType: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 18,
    fontWeight: "700" as const,
    marginTop: 2,
  },
  permitName: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  permitIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  permitIdentityText: {
    flex: 1,
  },
  permitPhotoFrame: {
    width: 72,
    height: 88,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  permitPhoto: {
    width: "100%",
    height: "100%",
  },
  permitDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginVertical: 18,
  },
  permitGrid: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 14,
  },
  permitGridItem: {
    flex: 1,
  },
  permitGridLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  permitGridValue: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800" as const,
  },
  permitValidity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  permitValidityText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  permitQrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 18,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  permitQrBox: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  permitQrImage: {
    width: "100%",
    height: "100%",
  },
  permitQrTextWrap: {
    flex: 1,
  },
  permitQrLabel: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  permitQrHint: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600" as const,
  },
  detailsCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  detailsHeader: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  detailTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  idleFooter: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  meterDigitalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  meterDigitalText: {
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  startPickupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  startPickupBtnDisabled: {
    opacity: 0.55,
  },
  startPickupText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900" as const,
    letterSpacing: 0.4,
  },
  testRideBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    marginTop: 10,
  },
  testRideText: {
    fontSize: 14,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  tariffBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  tariffSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  tariffHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingTop: 4,
    paddingBottom: 18,
  },
  tariffHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  tariffHeaderTitle: {
    fontSize: 20,
    fontWeight: "800" as const,
    letterSpacing: -0.2,
  },
  tariffHeaderSub: {
    fontSize: 13,
    marginTop: 2,
  },
  tariffOption: {
    borderWidth: 2,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  tariffOptionTop: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    marginBottom: 10,
  },
  tariffBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tariffBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900" as const,
    letterSpacing: 1,
  },
  tariffOptionTitle: {
    fontSize: 17,
    fontWeight: "800" as const,
  },
  tariffOptionFormula: {
    fontSize: 14,
    fontWeight: "700" as const,
    lineHeight: 20,
    marginBottom: 6,
  },
  tariffOptionHint: {
    fontSize: 12,
    lineHeight: 17,
  },
});
