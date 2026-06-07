import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  Alert,
  Modal,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import {
  Navigation,
  MapPin,
  Clock,
  Route as RouteIcon,
  Wallet,
  Power,
  AlertTriangle,
  X,
  Receipt,
  Check,
  Crosshair,
  CheckCircle2,
  Banknote,
  CreditCard,
  QrCode,
  Building2,
  Smartphone,
  ChevronRight,
  Plus,
  Coins,
  HandCoins,
  XCircle,
  Navigation2,
  Map as MapIcon,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "@/contexts/LocationContext";
import { useVoiceProtection } from "@/contexts/VoiceProtectionContext";
import { MapView, Marker, Polyline, calculateRoute, reverseGeocode, calculateFare, type TariffType } from "@/utils/maps";

const { width, height } = Dimensions.get("window");

const CANCELLATION_FEE = 3;

const lightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b3e5fc" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#c8e6c9" }] },
];

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
];

interface Coord {
  latitude: number;
  longitude: number;
}

interface RecalcResult {
  distance: number;
  duration: number;
  baseFare: number;
  total: number;
  endCoord: Coord;
  endName: string;
  endAddress: string;
}

export default function RideRunningScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const { location, currency } = useLocation();
  const { startTripRecording, stopTripRecording, isRecording } = useVoiceProtection();
  const recDotAnim = useRef(new Animated.Value(1)).current;
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);

  const dropName = (params.dropName as string) || "Drop location";
  const dropLat = parseFloat((params.dropLat as string) || "3.139");
  const dropLng = parseFloat((params.dropLng as string) || "101.6869");
  const fareParam = parseFloat((params.fare as string) || "0");
  const distanceParam = parseFloat((params.distance as string) || "0");
  const etaParam = parseFloat((params.eta as string) || "0");
  const pickupLatParam = parseFloat(
    (params.pickupLat as string) ||
      (location?.coords.latitude !== undefined ? String(location.coords.latitude) : "3.139")
  );
  const pickupLngParam = parseFloat(
    (params.pickupLng as string) ||
      (location?.coords.longitude !== undefined ? String(location.coords.longitude) : "101.6869")
  );
  const pickupName = (params.pickupName as string) || "Pickup";
  const pickupAddress = (params.pickupAddress as string) || "";
  const dropAddress = (params.dropAddress as string) || "";
  const driverMode = ((params.driverMode as string) || "TEKSI") as "TEKSI" | "eHailing";
  const tariff = (((params.tariff as string) || "old") as TariffType);
  const driverLatParam = params.driverLat ? parseFloat(params.driverLat as string) : null;
  const driverLngParam = params.driverLng ? parseFloat(params.driverLng as string) : null;
  const distanceToPickupParam = parseFloat((params.distanceToPickup as string) || "0");
  const initialPhase = ((params.initialPhase as string) || "toDestination") as "toPickup" | "toDestination";
  const [phase, setPhase] = useState<"toPickup" | "toDestination">(
    initialPhase === "toPickup" && driverLatParam !== null && driverLngParam !== null
      ? "toPickup"
      : "toDestination"
  );
  const bookingNo = useMemo<string>(
    () => (params.bookingNo as string) || `TKS${Math.floor(100000 + Math.random() * 900000)}`,
    [params.bookingNo]
  );
  const tripStartedAt = useRef<string>(new Date().toISOString());

  const startLat = pickupLatParam;
  const startLng = pickupLngParam;

  const segStartLat = phase === "toPickup" && driverLatParam !== null ? driverLatParam : pickupLatParam;
  const segStartLng = phase === "toPickup" && driverLngParam !== null ? driverLngParam : pickupLngParam;
  const segEndLat = phase === "toPickup" ? pickupLatParam : dropLat;
  const segEndLng = phase === "toPickup" ? pickupLngParam : dropLng;

  const segDistance = phase === "toPickup" ? Math.max(0.4, distanceToPickupParam) : distanceParam;
  const segEta = phase === "toPickup" ? Math.max(2, Math.round(segDistance * 2.6)) : etaParam;

  const [routeCoords, setRouteCoords] = useState<Coord[]>([]);
  const [driverPos, setDriverPos] = useState<Coord>({ latitude: segStartLat, longitude: segStartLng });
  const [progress, setProgress] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [remainingMin, setRemainingMin] = useState<number>(segEta);
  const [remainingKm, setRemainingKm] = useState<number>(segDistance);
  const [arrived, setArrived] = useState<boolean>(false);
  const [pickupArrivedConfirmed, setPickupArrivedConfirmed] = useState<boolean>(false);
  const [traveledKm, setTraveledKm] = useState<number>(0);
  const [followDriver, setFollowDriver] = useState<boolean>(true);
  const [heading, setHeading] = useState<number>(0);
  const didInitialFitRef = useRef<boolean>(false);
  const prevDriverPosRef = useRef<Coord | null>(null);

  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [showCompleteModal, setShowCompleteModal] = useState<boolean>(false);
  const [completeModalDismissed, setCompleteModalDismissed] = useState<boolean>(false);
  const [showTollsModal, setShowTollsModal] = useState<boolean>(false);
  const [tollsAmount, setTollsAmount] = useState<string>("");
  const [extrasAmount, setExtrasAmount] = useState<string>("");
  const [extrasNote, setExtrasNote] = useState<string>("");
  const [showPaymentReceivedModal, setShowPaymentReceivedModal] = useState<boolean>(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState<boolean>(false);
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [cancelOtherText, setCancelOtherText] = useState<string>("");
  const cancelModalAnim = useRef(new Animated.Value(0)).current;
  const [showNavMenu, setShowNavMenu] = useState<boolean>(false);
  const [showRecalcSheet, setShowRecalcSheet] = useState<boolean>(false);
  const [isRecalculating, setIsRecalculating] = useState<boolean>(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const slideUpAnim = useRef(new Animated.Value(60)).current;
  const endModalAnim = useRef(new Animated.Value(0)).current;
  const completeModalAnim = useRef(new Animated.Value(0)).current;
  const tollsModalAnim = useRef(new Animated.Value(0)).current;
  const paymentReceivedAnim = useRef(new Animated.Value(0)).current;
  const recalcSheetAnim = useRef(new Animated.Value(0)).current;
  const paymentSheetAnim = useRef(new Animated.Value(0)).current;

  const dropCoord = useMemo<Coord>(
    () => ({ latitude: dropLat, longitude: dropLng }),
    [dropLat, dropLng]
  );

  const segEndCoord = useMemo<Coord>(
    () => ({ latitude: segEndLat, longitude: segEndLng }),
    [segEndLat, segEndLng]
  );

  const ratePerKm = useMemo<number>(() => {
    if (distanceParam > 0) return fareParam / distanceParam;
    return 1.5;
  }, [fareParam, distanceParam]);

  useEffect(() => {
    Animated.spring(slideUpAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim, slideUpAnim]);

  useEffect(() => {
    let cancelled = false;
    const fetchRoute = async () => {
      try {
        const result = await calculateRoute(
          { latitude: segStartLat, longitude: segStartLng },
          segEndCoord,
          undefined,
          "ride-running"
        );
        if (cancelled) return;
        if (result?.coordinates && result.coordinates.length > 0) {
          setRouteCoords(result.coordinates);
          setDriverPos(result.coordinates[0]);
        } else {
          const fallback: Coord[] = [
            { latitude: segStartLat, longitude: segStartLng },
            segEndCoord,
          ];
          setRouteCoords(fallback);
        }
      } catch (e) {
        console.log("[ride-running] route error", e);
        setRouteCoords([{ latitude: segStartLat, longitude: segStartLng }, segEndCoord]);
      }
    };
    fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [segStartLat, segStartLng, segEndCoord]);

  useEffect(() => {
    if (routeCoords.length === 0) return;
    if (arrived) return;
    const total = Math.max(1, routeCoords.length - 1);
    const tickMs = 800;
    const totalMs =
      driverMode === "eHailing"
        ? phase === "toPickup"
          ? 30000
          : 45000
        : Math.max(15000, segEta * 60 * 1000);
    const stepPerTick = total / (totalMs / tickMs);

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + stepPerTick;
        if (next >= total) {
          clearInterval(interval);
          setArrived(true);
          setDriverPos(routeCoords[routeCoords.length - 1]);
          return total;
        }
        const idx = Math.floor(next);
        const frac = next - idx;
        const a = routeCoords[idx];
        const b = routeCoords[Math.min(idx + 1, routeCoords.length - 1)];
        setDriverPos({
          latitude: a.latitude + (b.latitude - a.latitude) * frac,
          longitude: a.longitude + (b.longitude - a.longitude) * frac,
        });
        const pct = next / total;
        setRemainingMin(Math.max(0, Math.round(segEta * (1 - pct))));
        setRemainingKm(Math.max(0, +(segDistance * (1 - pct)).toFixed(1)));
        setTraveledKm(Math.max(0, +(segDistance * pct).toFixed(2)));
        return next;
      });
    }, tickMs);

    return () => clearInterval(interval);
  }, [routeCoords, segEta, segDistance, arrived, driverMode, phase]);

  useEffect(() => {
    if (arrived) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [arrived]);

  const CENTER_OFFSET_LAT = 0;

  const computeBearing = useCallback((from: Coord, to: Coord): number => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const lat1 = toRad(from.latitude);
    const lat2 = toRad(to.latitude);
    const dLng = toRad(to.longitude - from.longitude);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
  }, []);

  useEffect(() => {
    const prev = prevDriverPosRef.current;
    if (prev) {
      const dLat = driverPos.latitude - prev.latitude;
      const dLng = driverPos.longitude - prev.longitude;
      if (Math.abs(dLat) + Math.abs(dLng) > 1e-7) {
        const b = computeBearing(prev, driverPos);
        setHeading(b);
      }
    }
    prevDriverPosRef.current = driverPos;
  }, [driverPos, computeBearing]);

  useEffect(() => {
    if (!mapRef.current || routeCoords.length === 0 || Platform.OS === "web") return;
    if (didInitialFitRef.current) return;
    const t = setTimeout(() => {
      mapRef.current?.animateCamera?.(
        {
          center: {
            latitude: driverPos.latitude + CENTER_OFFSET_LAT,
            longitude: driverPos.longitude,
          },
          zoom: 21,
          heading,
          pitch: 0,
        },
        { duration: 600 }
      );
      didInitialFitRef.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, [routeCoords.length, driverPos, CENTER_OFFSET_LAT, heading]);

  useEffect(() => {
    if (!mapRef.current || Platform.OS === "web") return;
    if (showRecalcSheet) return;
    if (!followDriver) return;
    mapRef.current?.animateCamera?.(
      {
        center: {
          latitude: driverPos.latitude + CENTER_OFFSET_LAT,
          longitude: driverPos.longitude,
        },
        zoom: 21,
        heading,
        pitch: 0,
      },
      { duration: 700 }
    );
  }, [driverPos, showRecalcSheet, followDriver, CENTER_OFFSET_LAT, heading]);

  const recenterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePanDrag = useCallback(() => {
    if (followDriver) {
      console.log("[ride-running] user panned map, disabling follow");
      setFollowDriver(false);
    }
    if (recenterTimerRef.current) {
      clearTimeout(recenterTimerRef.current);
    }
    recenterTimerRef.current = setTimeout(() => {
      console.log("[ride-running] auto recenter after 10s");
      setFollowDriver(true);
    }, 10000);
  }, [followDriver]);

  useEffect(() => {
    return () => {
      if (recenterTimerRef.current) {
        clearTimeout(recenterTimerRef.current);
      }
    };
  }, []);

  const handleRecenter = useCallback(() => {
    console.log("[ride-running] recenter pressed");
    if (recenterTimerRef.current) {
      clearTimeout(recenterTimerRef.current);
      recenterTimerRef.current = null;
    }
    setFollowDriver(true);
    if (Platform.OS !== "web" && mapRef.current) {
      mapRef.current?.animateCamera?.(
        {
          center: {
            latitude: driverPos.latitude + CENTER_OFFSET_LAT,
            longitude: driverPos.longitude,
          },
          zoom: 21,
          heading,
          pitch: 0,
        },
        { duration: 500 }
      );
    }
  }, [driverPos, CENTER_OFFSET_LAT, heading]);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const openEndModal = useCallback(() => {
    setShowEndModal(true);
    Animated.spring(endModalAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 11,
    }).start();
  }, [endModalAnim]);

  const closeEndModal = useCallback(() => {
    Animated.timing(endModalAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setShowEndModal(false));
  }, [endModalAnim]);

  const openRecalcSheet = useCallback(() => {
    setShowRecalcSheet(true);
    Animated.spring(recalcSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  }, [recalcSheetAnim]);

  const closeRecalcSheet = useCallback(() => {
    Animated.timing(recalcSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowRecalcSheet(false));
  }, [recalcSheetAnim]);

  const openTollsModal = useCallback(() => {
    console.log("[ride-running] opening tolls modal");
    setShowTollsModal(true);
    Animated.spring(tollsModalAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 11,
    }).start();
  }, [tollsModalAnim]);

  const closeTollsModal = useCallback((cb?: () => void) => {
    Animated.timing(tollsModalAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setShowTollsModal(false);
      if (cb) cb();
    });
  }, [tollsModalAnim]);

  const handleCompleteContinue = useCallback(() => {
    console.log("[ride-running] closing complete modal, opening tolls modal");
    setCompleteModalDismissed(true);
    Animated.timing(completeModalAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setShowCompleteModal(false);
      openTollsModal();
    });
  }, [completeModalAnim, openTollsModal]);

  const openPaymentReceivedModal = useCallback(() => {
    console.log("[ride-running] opening payment received confirmation");
    setShowPaymentReceivedModal(true);
    Animated.spring(paymentReceivedAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 11,
    }).start();
  }, [paymentReceivedAnim]);

  const closePaymentReceivedModal = useCallback((cb?: () => void) => {
    Animated.timing(paymentReceivedAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setShowPaymentReceivedModal(false);
      if (cb) cb();
    });
  }, [paymentReceivedAnim]);

  const handleTollsContinue = useCallback(() => {
    closeTollsModal(() => {
      openPaymentReceivedModal();
    });
  }, [closeTollsModal, openPaymentReceivedModal]);

  const handleTollsBack = useCallback(() => {
    closeTollsModal(() => {
      setCompleteModalDismissed(false);
      setShowCompleteModal(true);
      Animated.spring(completeModalAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 11,
      }).start();
    });
  }, [closeTollsModal, completeModalAnim]);

  const openPaymentSheet = useCallback(() => {
    console.log("[ride-running] opening payment mode sheet");
    setShowPaymentSheet(true);
    Animated.spring(paymentSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  }, [paymentSheetAnim]);

  const handlePaymentReceivedConfirm = useCallback(() => {
    closePaymentReceivedModal(() => {
      openPaymentSheet();
    });
  }, [closePaymentReceivedModal, openPaymentSheet]);

  const closePaymentSheet = useCallback(() => {
    Animated.timing(paymentSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowPaymentSheet(false));
  }, [paymentSheetAnim]);

  const parsedTolls = useMemo<number>(() => {
    const n = parseFloat(tollsAmount.replace(/,/g, "."));
    return isNaN(n) || n < 0 ? 0 : n;
  }, [tollsAmount]);

  const parsedExtras = useMemo<number>(() => {
    const n = parseFloat(extrasAmount.replace(/,/g, "."));
    return isNaN(n) || n < 0 ? 0 : n;
  }, [extrasAmount]);

  const finalizeCompletedRide = useCallback((paymentMethod: string) => {
    const tripDurationMin = Math.max(1, Math.round(elapsedSec / 60));
    const actualKm = traveledKm > 0 ? traveledKm : distanceParam;
    const recalculatedFare = calculateFare(actualKm, tripDurationMin, 1, tariff);
    const baseFare = Math.ceil(recalculatedFare);
    console.log("[ride-running] ride completed - actual fare recalc", {
      elapsedSec,
      tripDurationMin,
      actualKm,
      estimatedFare: fareParam,
      recalculatedFare,
      baseFare,
      paymentMethod,
      parsedTolls,
      parsedExtras,
    });
    const total = baseFare + parsedTolls + parsedExtras;
    router.replace({
      pathname: "/ride-detail" as any,
      params: {
        bookingNo,
        fare: String(total),
        baseFare: String(baseFare),
        tolls: String(parsedTolls),
        extras: String(parsedExtras),
        extrasNote,
        pickupName,
        pickupAddress,
        dropName,
        dropAddress,
        pickupLat: String(startLat),
        pickupLng: String(startLng),
        dropLat: String(dropLat),
        dropLng: String(dropLng),
        distance: String(actualKm),
        duration: String(tripDurationMin),
        pickupTime: tripStartedAt.current,
        dropTime: new Date().toISOString(),
        status: "completed",
        paymentMethod,
        driverMode,
        tariff,
      },
    });
  }, [elapsedSec, fareParam, traveledKm, router, bookingNo, pickupName, pickupAddress, dropName, dropAddress, startLat, startLng, dropLat, dropLng, distanceParam, parsedTolls, parsedExtras, extrasNote, driverMode, tariff]);

  const finalizeEndedEarlyRide = useCallback((paymentMethod: string) => {
    const result = recalcResult;
    const tripDurationMin = Math.max(1, Math.round(elapsedSec / 60));
    const actualKm = result?.distance ?? (traveledKm > 0 ? traveledKm : distanceParam);
    const actualMin = result?.duration ?? tripDurationMin;
    const recalculatedFare = calculateFare(actualKm, actualMin, 1, tariff);
    const baseFare = Math.ceil(recalculatedFare);
    console.log("[ride-running] ride ended early - actual fare recalc", {
      paymentMethod,
      actualKm,
      actualMin,
      recalculatedFare,
      baseFare,
      parsedTolls,
      parsedExtras,
    });
    const total = baseFare + parsedTolls + parsedExtras;
    router.replace({
      pathname: "/ride-detail" as any,
      params: {
        bookingNo,
        fare: String(total),
        baseFare: String(baseFare),
        tolls: String(parsedTolls),
        extras: String(parsedExtras),
        extrasNote,
        pickupName,
        pickupAddress,
        dropName: result?.endName ?? dropName,
        dropAddress: result?.endAddress ?? "",
        pickupLat: String(startLat),
        pickupLng: String(startLng),
        dropLat: String(result?.endCoord.latitude ?? dropLat),
        dropLng: String(result?.endCoord.longitude ?? dropLng),
        distance: String(actualKm),
        duration: String(actualMin),
        pickupTime: tripStartedAt.current,
        dropTime: new Date().toISOString(),
        status: "ended_early",
        paymentMethod,
        driverMode,
        tariff,
      },
    });
  }, [recalcResult, elapsedSec, traveledKm, router, bookingNo, fareParam, pickupName, pickupAddress, dropName, dropAddress, startLat, startLng, dropLat, dropLng, distanceParam, parsedTolls, parsedExtras, extrasNote, driverMode, tariff]);

  const handleSelectPayment = useCallback((method: string) => {
    console.log("[ride-running] payment method selected", method);
    setSelectedPayment(method);
    const isEndedEarly = recalcResult !== null;
    Animated.timing(paymentSheetAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setShowPaymentSheet(false);
      setTimeout(() => {
        if (isEndedEarly) {
          finalizeEndedEarlyRide(method);
        } else {
          finalizeCompletedRide(method);
        }
      }, 80);
    });
  }, [paymentSheetAnim, finalizeCompletedRide, finalizeEndedEarlyRide, recalcResult]);

  useEffect(() => {
    if (phase !== "toDestination") return;
    if (arrived && !showCompleteModal && !completeModalDismissed) {
      console.log("[ride-running] driver arrived, showing complete modal");
      setShowCompleteModal(true);
      Animated.spring(completeModalAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 11,
      }).start();
    }
  }, [arrived, showCompleteModal, completeModalDismissed, completeModalAnim, phase]);

  // VoiceProtection: record trip audio (device mic) once the ride is underway.
  // Recording is gated by the user's VoiceProtection toggle inside the context.
  useEffect(() => {
    if (phase === "toDestination") {
      void startTripRecording({
        rideId: bookingNo,
        label: `${pickupName} \u2192 ${dropName}`,
      });
    }
  }, [phase, bookingNo, pickupName, dropName, startTripRecording]);

  // Always stop + persist the recording when leaving the active ride screen.
  useEffect(() => {
    return () => {
      void stopTripRecording();
    };
  }, [stopTripRecording]);

  // Subtle pulse for the "recording active" indicator.
  useEffect(() => {
    if (!isRecording) {
      recDotAnim.stopAnimation();
      recDotAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recDotAnim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(recDotAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, recDotAnim]);

  const handleStartTrip = useCallback(() => {
    console.log("[ride-running] driver tapped Start trip, switching to toDestination");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    tripStartedAt.current = new Date().toISOString();
    setProgress(0);
    setArrived(false);
    setElapsedSec(0);
    setTraveledKm(0);
    setRouteCoords([]);
    didInitialFitRef.current = false;
    setRemainingMin(etaParam);
    setRemainingKm(distanceParam);
    setPhase("toDestination");
  }, [etaParam, distanceParam]);

  const distanceMeters = useCallback((a: Coord, b: Coord): number => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }, []);

  const handleEndRide = () => {
    if (phase === "toPickup") {
      if (arrived) {
        if (!pickupArrivedConfirmed) {
          setPickupArrivedConfirmed(true);
          return;
        }
        handleStartTrip();
        return;
      }
      const meters = distanceMeters(driverPos, { latitude: pickupLatParam, longitude: pickupLngParam });
      console.log("[ride-running] driver distance to pickup", meters);
      if (meters <= 100) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        setArrived(true);
        setDriverPos({ latitude: pickupLatParam, longitude: pickupLngParam });
        setProgress(Math.max(0, routeCoords.length - 1));
        setRemainingMin(0);
        setRemainingKm(0);
      } else {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
        const km = (meters / 1000).toFixed(2);
        Alert.alert(
          "Not at pickup yet",
          `You are still ${km} km from the pickup location. Please proceed to the correct pickup point before marking as arrived.`,
          [{ text: "OK" }]
        );
      }
      return;
    }
    if (arrived) {
      setShowCompleteModal(true);
      Animated.spring(completeModalAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 11,
      }).start();
      return;
    }
    openEndModal();
  };

  const handleConfirmEndEarly = useCallback(async () => {
    closeEndModal();
    setIsRecalculating(true);
    setRecalcResult(null);
    openRecalcSheet();

    const endCoord: Coord = { latitude: driverPos.latitude, longitude: driverPos.longitude };
    try {
      const [routeResult, geo] = await Promise.all([
        calculateRoute({ latitude: startLat, longitude: startLng }, endCoord, undefined, "ride-running"),
        reverseGeocode(endCoord.latitude, endCoord.longitude, "ride-running").catch(() => null),
      ]);
      let dist: number;
      let dur: number;
      if (routeResult && typeof routeResult.distance === "number" && typeof routeResult.duration === "number") {
        dist = routeResult.distance;
        dur = routeResult.duration;
      } else {
        const totalSegs = Math.max(1, routeCoords.length - 1);
        const completed = Math.min(progress / totalSegs, 1);
        dist = +(distanceParam * completed).toFixed(1);
        dur = Math.max(1, Math.round(etaParam * completed));
      }
      const baseFare = Math.ceil(dist * ratePerKm);
      const total = baseFare + CANCELLATION_FEE;
      setRecalcResult({
        distance: +dist.toFixed(1),
        duration: dur,
        baseFare,
        total,
        endCoord,
        endName: geo?.name || "Stop point",
        endAddress: geo?.address || "",
      });
    } catch (e) {
      console.log("[ride-running] recalc error", e);
      const totalSegs = Math.max(1, routeCoords.length - 1);
      const completed = Math.min(progress / totalSegs, 1);
      const dist = +(distanceParam * completed).toFixed(1);
      const dur = Math.max(1, Math.round(etaParam * completed));
      const baseFare = Math.ceil(dist * ratePerKm);
      setRecalcResult({
        distance: dist,
        duration: dur,
        baseFare,
        total: baseFare + CANCELLATION_FEE,
        endCoord,
        endName: "Stop point",
        endAddress: "",
      });
    } finally {
      setIsRecalculating(false);
    }
  }, [
    closeEndModal,
    openRecalcSheet,
    driverPos.latitude,
    driverPos.longitude,
    startLat,
    startLng,
    routeCoords.length,
    progress,
    distanceParam,
    etaParam,
    ratePerKm,
  ]);

  const handleConfirmCompletion = () => {
    console.log("[ride-running] ride ended early, opening tolls modal", {
      total: recalcResult?.total,
      distance: recalcResult?.distance,
      duration: recalcResult?.duration,
    });
    closeRecalcSheet();
    setTimeout(() => {
      openTollsModal();
    }, 250);
  };

  const openCancelModal = useCallback(() => {
    console.log("[ride-running] opening cancel order modal");
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setShowCancelModal(true);
    Animated.spring(cancelModalAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 11,
    }).start();
  }, [cancelModalAnim]);

  const closeCancelModal = useCallback((cb?: () => void) => {
    Animated.timing(cancelModalAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setShowCancelModal(false);
      if (cb) cb();
    });
  }, [cancelModalAnim]);

  const handleConfirmCancelOrder = useCallback(() => {
    const reason = cancelReason === "other" ? cancelOtherText.trim() : cancelReason;
    if (!reason) return;
    console.log("[ride-running] order cancelled", { reason });
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    closeCancelModal(() => {
      const target = "/partner-ehailing" as any;
      try {
        if (typeof (router as any).dismissTo === "function") {
          (router as any).dismissTo(target);
          return;
        }
      } catch (e) {
        console.log("[ride-running] dismissTo unavailable", e);
      }
      try {
        router.navigate(target);
      } catch (e) {
        console.log("[ride-running] navigate failed, replacing", e);
        router.replace(target);
      }
    });
  }, [cancelReason, cancelOtherText, closeCancelModal, router]);

  const remainingCoords = useMemo(() => {
    if (routeCoords.length === 0) return [];
    const idx = Math.floor(progress);
    return [driverPos, ...routeCoords.slice(Math.min(idx + 1, routeCoords.length - 1))];
  }, [routeCoords, progress, driverPos]);

  const completedCoords = useMemo(() => {
    if (routeCoords.length === 0) return [];
    const idx = Math.floor(progress);
    return [...routeCoords.slice(0, idx + 1), driverPos];
  }, [routeCoords, progress, driverPos]);

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  const initialRegion = {
    latitude: (segStartLat + segEndLat) / 2,
    longitude: (segStartLng + segEndLng) / 2,
    latitudeDelta: 0.001,
    longitudeDelta: 0.001,
  };

  const endModalTranslate = endModalAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [60, 0],
  });

  const recalcSheetTranslate = recalcSheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {Platform.OS !== "web" && MapView ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          customMapStyle={colorScheme === "dark" ? darkMapStyle : lightMapStyle}
          showsCompass={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          scrollEnabled
          zoomEnabled
          rotateEnabled
          pitchEnabled
          onPanDrag={handlePanDrag}
        >
          {Polyline && completedCoords.length > 1 && (
            <Polyline
              coordinates={completedCoords}
              strokeColor={Colors.gray[400]}
              strokeWidth={10}
            />
          )}
          {Polyline && remainingCoords.length > 1 && (
            <Polyline
              coordinates={remainingCoords}
              strokeColor={Colors.accent}
              strokeWidth={12}
            />
          )}
          {Marker && (
            <>
              <Marker coordinate={segEndCoord} anchor={{ x: 0.5, y: 1 }}>
                <View style={[styles.dropPin, { backgroundColor: Colors.text }]}>
                  <MapPin color={Colors.background} size={18} />
                </View>
              </Marker>
              <Marker coordinate={driverPos} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.carWrap}>
                  <Animated.View
                    style={[
                      styles.pulseRing,
                      {
                        backgroundColor: Colors.accent,
                        transform: [{ scale: pulseScale }],
                        opacity: pulseOpacity,
                      },
                    ]}
                  />
                  <View style={[styles.carDot, { backgroundColor: Colors.accent, borderColor: Colors.background }]}>
                    <View style={{ transform: [{ rotate: "-45deg" }] }}>
                      <Navigation color={Colors.background} size={18} fill={Colors.background} />
                    </View>
                  </View>
                </View>
              </Marker>
            </>
          )}
        </MapView>
      ) : (
        <View style={[styles.map, styles.webMap, { backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#eef2f5" }]}>
          <Navigation color={Colors.accent} size={56} />
          <Text style={[styles.webText, { color: Colors.text }]}>Live tracking</Text>
          <Text style={[styles.webSub, { color: Colors.textSecondary }]}>Available on mobile</Text>
        </View>
      )}

      {driverMode === "eHailing" && (phase === "toPickup" || (phase === "toDestination" && distanceMeters(driverPos, { latitude: pickupLatParam, longitude: pickupLngParam }) < 100)) && (
        <TouchableOpacity
          testID="cancel-order-button"
          activeOpacity={0.9}
          onPress={openCancelModal}
          style={[
            styles.cancelFab,
            {
              top: insets.top + 64,
              backgroundColor: Colors.error,
              shadowColor: "#000",
            },
          ]}
        >
          <XCircle color="#FFFFFF" size={18} />
          <Text style={styles.cancelFabText}>Cancel</Text>
        </TouchableOpacity>
      )}

      {driverMode === "eHailing" && (
        <TouchableOpacity
          testID="nav-app-button"
          activeOpacity={0.9}
          onPress={() => {
            if (Platform.OS !== "web") {
              Haptics.selectionAsync().catch(() => {});
            }
            setShowNavMenu(true);
          }}
          style={[
            styles.navFab,
            {
              top: insets.top + 64 + 52,
              backgroundColor: Colors.background,
              shadowColor: "#000",
              borderColor: Colors.gray[200],
            },
          ]}
        >
          <Navigation2 color={Colors.accent} size={22} />
        </TouchableOpacity>
      )}

      {!followDriver && Platform.OS !== "web" && (
        <TouchableOpacity
          testID="recenter-button"
          activeOpacity={0.85}
          onPress={handleRecenter}
          style={[
            styles.recenterBtn,
            {
              backgroundColor: Colors.background,
              bottom: insets.bottom + 360,
            },
          ]}
        >
          <Crosshair color={Colors.accent} size={22} />
        </TouchableOpacity>
      )}

      <SafeAreaView edges={["top"]} style={styles.topOverlay} pointerEvents="box-none">
        <View style={[styles.statusPill, { backgroundColor: Colors.background }]}>
          <View style={[styles.liveDot, { backgroundColor: arrived ? Colors.success : Colors.accent }]} />
          <Text style={[styles.statusText, { color: Colors.text }]}>
            {phase === "toPickup"
              ? arrived
                ? "Arrived at pickup"
                : "Heading to pickup · Live"
              : arrived
                ? "Arrived at destination"
                : "On trip · Live"}
          </Text>
          <View style={[styles.statusSep, { backgroundColor: Colors.gray[300] }]} />
          <Text style={[styles.kmText, { color: Colors.accent }]} testID="on-trip-traveled-km">
            {traveledKm.toFixed(2)} km
          </Text>
          <Text style={[styles.elapsedText, { color: Colors.textSecondary }]}>{formatElapsed(elapsedSec)}</Text>
        </View>
        {isRecording && (
          <View
            style={[styles.recPill, { backgroundColor: Colors.background }]}
            testID="voice-protection-indicator"
          >
            <Animated.View
              style={[styles.recDot, { backgroundColor: Colors.error, opacity: recDotAnim }]}
            />
            <Text style={[styles.recText, { color: Colors.textSecondary }]}>
              VoiceProtection recording
            </Text>
          </View>
        )}
      </SafeAreaView>

      {!showRecalcSheet && (
        <Animated.View
          style={[
            styles.bottomCard,
            {
              backgroundColor: Colors.background,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
              transform: [{ translateY: slideUpAnim }],
              shadowColor: colorScheme === "dark" ? "#000" : "#0f172a",
            },
          ]}
        >
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: Colors.gray[300] }]} />
          </View>

          {(() => {
            const showPickToDrop = phase === "toDestination" || (phase === "toPickup" && pickupArrivedConfirmed);
            return (
              <View style={styles.locationsBlock}>
                <View style={styles.locRow}>
                  <View style={styles.locIconCol}>
                    <View style={[styles.pickDot, { backgroundColor: Colors.success ?? Colors.accent }]} />
                    <View style={[styles.locConnector, { backgroundColor: Colors.gray[300] }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropLabel, { color: Colors.textSecondary }]}>
                      {showPickToDrop ? "Pick from" : "Driver location"}
                    </Text>
                    <Text style={[styles.dropName, { color: Colors.text }]} numberOfLines={1}>
                      {showPickToDrop ? pickupName : "Your current location"}
                    </Text>
                    {showPickToDrop && pickupAddress ? (
                      <Text style={[styles.locSubText, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {pickupAddress}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.locRow}>
                  <View style={styles.locIconCol}>
                    <View style={[styles.dropIcon, { backgroundColor: Colors.accent + "1A" }]}>
                      <MapPin color={Colors.accent} size={20} />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropLabel, { color: Colors.textSecondary }]}>
                      {showPickToDrop ? "Heading to" : "Pickup"}
                    </Text>
                    <Text style={[styles.dropName, { color: Colors.text }]} numberOfLines={1}>
                      {showPickToDrop ? dropName : pickupName}
                    </Text>
                    {showPickToDrop && dropAddress ? (
                      <Text style={[styles.locSubText, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {dropAddress}
                      </Text>
                    ) : !showPickToDrop && pickupAddress ? (
                      <Text style={[styles.locSubText, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {pickupAddress}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })()}

          <View style={[styles.statsRow, { borderColor: Colors.gray[200] }]}>
            <View style={styles.statItem}>
              <Clock color={Colors.accent} size={18} />
              <Text style={[styles.statValue, { color: Colors.text }]}>{remainingMin}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>min left</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
            <View style={styles.statItem}>
              <RouteIcon color={Colors.accent} size={18} />
              <Text style={[styles.statValue, { color: Colors.text }]}>{remainingKm}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>km to go</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
            <View style={styles.statItem}>
              <Wallet color={Colors.accent} size={18} />
              <Text style={[styles.statValue, { color: Colors.text }]}>
                {currency.symbol}{Math.ceil(fareParam)}
              </Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>fare</Text>
            </View>
          </View>

          <View style={[styles.progressTrack, { backgroundColor: Colors.gray[200] }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: Colors.accent,
                  width: `${routeCoords.length > 1 ? Math.min(100, (progress / (routeCoords.length - 1)) * 100) : 0}%`,
                },
              ]}
            />
          </View>

          <TouchableOpacity
            testID="end-ride-button"
            activeOpacity={0.9}
            onPress={handleEndRide}
            style={[
              styles.endButton,
              {
                backgroundColor:
                  phase === "toPickup"
                    ? arrived
                      ? Colors.accent
                      : Colors.warning ?? Colors.accent
                    : arrived
                      ? Colors.success
                      : Colors.error,
              },
            ]}
          >
            {phase === "toPickup" ? (
              <Navigation color="#FFFFFF" size={20} />
            ) : (
              <Power color="#FFFFFF" size={20} />
            )}
            <Text style={styles.endButtonText}>
              {phase === "toPickup"
                ? arrived
                  ? pickupArrivedConfirmed
                    ? "Start ride"
                    : "Arrived"
                  : "Driving to pickup…"
                : arrived
                  ? "Complete ride"
                  : "End ride"}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <Modal
        visible={showCompleteModal}
        transparent
        animationType="none"
        onRequestClose={() => {}}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.endModalCard,
              {
                backgroundColor: Colors.background,
                opacity: completeModalAnim,
                transform: [
                  {
                    translateY: completeModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [60, 0],
                    }),
                  },
                  {
                    scale: completeModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.warnIconWrap, { backgroundColor: (Colors.success ?? Colors.accent) + "1A" }]}>
              <CheckCircle2 color={Colors.success ?? Colors.accent} size={36} />
            </View>
            <Text style={[styles.endModalTitle, { color: Colors.text }]}>Ride completed</Text>
            <Text style={[styles.endModalBody, { color: Colors.textSecondary }]}>
              You’ve arrived at {dropName}. Confirm to finalize the trip.
            </Text>

            <View style={[styles.completeStats, { borderColor: Colors.gray[200] }]}>
              <View style={styles.statItem}>
                <Clock color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>{formatElapsed(elapsedSec)}</Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>duration</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
              <View style={styles.statItem}>
                <RouteIcon color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>{distanceParam}</Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>km</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
              <View style={styles.statItem}>
                <Wallet color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {currency.symbol}{Math.ceil(fareParam)}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>fare</Text>
              </View>
            </View>

            <View style={styles.endModalActions}>
              <TouchableOpacity
                testID="complete-modal-cancel"
                style={[styles.endModalBtn, styles.endModalGhost, { borderColor: Colors.gray[300] }]}
                activeOpacity={0.85}
                onPress={() => {
                  console.log("[ride-running] complete modal cancelled");
                  setCompleteModalDismissed(true);
                  Animated.timing(completeModalAnim, {
                    toValue: 0,
                    duration: 180,
                    useNativeDriver: true,
                  }).start(() => setShowCompleteModal(false));
                }}
              >
                <Text style={[styles.endModalGhostText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="complete-modal-confirm"
                activeOpacity={0.9}
                onPress={handleCompleteContinue}
                style={[styles.endModalBtn, { backgroundColor: Colors.success ?? Colors.accent }]}
              >
                <Text style={styles.endModalConfirmText}>Continue</Text>
                <ChevronRight color="#FFFFFF" size={18} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showEndModal}
        transparent
        animationType="none"
        onRequestClose={closeEndModal}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.endModalCard,
              {
                backgroundColor: Colors.background,
                opacity: endModalAnim,
                transform: [{ translateY: endModalTranslate }],
              },
            ]}
          >
            <View style={[styles.warnIconWrap, { backgroundColor: Colors.error + "1A" }]}>
              <AlertTriangle color={Colors.error} size={28} />
            </View>
            <Text style={[styles.endModalTitle, { color: Colors.text }]}>End ride early?</Text>
            <Text style={[styles.endModalBody, { color: Colors.textSecondary }]}>
              You haven&apos;t arrived at the drop location yet. Ending now will recalculate the fare from pickup to your current location and apply a {currency.symbol}{CANCELLATION_FEE} cancellation fee.
            </Text>

            <View style={styles.endModalActions}>
              <TouchableOpacity
                testID="end-modal-cancel"
                style={[styles.endModalBtn, styles.endModalGhost, { borderColor: Colors.gray[300] }]}
                activeOpacity={0.85}
                onPress={closeEndModal}
              >
                <Text style={[styles.endModalGhostText, { color: Colors.text }]}>Keep driving</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="end-modal-confirm"
                style={[styles.endModalBtn, { backgroundColor: Colors.error }]}
                activeOpacity={0.9}
                onPress={handleConfirmEndEarly}
              >
                <Power color="#FFFFFF" size={18} />
                <Text style={styles.endModalConfirmText}>End ride</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {showRecalcSheet && (
        <View style={styles.recalcOverlay} pointerEvents="box-none">
          <View style={styles.recalcDim} />
          <Animated.View
            style={[
              styles.recalcSheet,
              {
                backgroundColor: Colors.background,
                paddingBottom: Math.max(insets.bottom, 16) + 16,
                transform: [{ translateY: recalcSheetTranslate }],
                shadowColor: colorScheme === "dark" ? "#000" : "#0f172a",
              },
            ]}
          >
            <View style={styles.handleBar}>
              <View style={[styles.handle, { backgroundColor: Colors.gray[300] }]} />
            </View>

            <View style={styles.recalcHeaderRow}>
              <View style={[styles.recalcIcon, { backgroundColor: Colors.accent + "1A" }]}>
                <Receipt color={Colors.accent} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.recalcTitle, { color: Colors.text }]}>Ride ended early</Text>
                <Text style={[styles.recalcSub, { color: Colors.textSecondary }]}>
                  Fare recalculated to your stop point
                </Text>
              </View>
              <TouchableOpacity onPress={closeRecalcSheet} style={[styles.recalcClose, { backgroundColor: Colors.gray[100] }]}>
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            {isRecalculating || !recalcResult ? (
              <View style={styles.recalcLoading}>
                <ActivityIndicator color={Colors.accent} />
                <Text style={[styles.recalcLoadingText, { color: Colors.textSecondary }]}>
                  Recalculating fare…
                </Text>
              </View>
            ) : (
              <>
                <View style={[styles.routeRow, { backgroundColor: Colors.gray[100] }]}>
                  <View style={styles.routeCol}>
                    <View style={[styles.routeDot, { backgroundColor: Colors.accent }]} />
                    <View style={[styles.routeLine, { backgroundColor: Colors.gray[300] }]} />
                    <View style={[styles.routeSquare, { backgroundColor: Colors.text }]} />
                  </View>
                  <View style={{ flex: 1, gap: 14 }}>
                    <View>
                      <Text style={[styles.routeLabel, { color: Colors.textSecondary }]}>Pickup</Text>
                      <Text style={[styles.routeText, { color: Colors.text }]} numberOfLines={1}>
                        {pickupName}
                      </Text>
                    </View>
                    <View>
                      <Text style={[styles.routeLabel, { color: Colors.textSecondary }]}>New drop (ended)</Text>
                      <Text style={[styles.routeText, { color: Colors.text }]} numberOfLines={1}>
                        {recalcResult.endName}
                      </Text>
                      {recalcResult.endAddress ? (
                        <Text style={[styles.routeSubText, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {recalcResult.endAddress}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>

                <View style={[styles.statsRow, { borderColor: Colors.gray[200], marginTop: 14 }]}>
                  <View style={styles.statItem}>
                    <RouteIcon color={Colors.accent} size={18} />
                    <Text style={[styles.statValue, { color: Colors.text }]}>{recalcResult.distance}</Text>
                    <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>km</Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
                  <View style={styles.statItem}>
                    <Clock color={Colors.accent} size={18} />
                    <Text style={[styles.statValue, { color: Colors.text }]}>{recalcResult.duration}</Text>
                    <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>min</Text>
                  </View>
                </View>

                <View style={styles.breakdown}>
                  <View style={styles.breakdownRow}>
                    <Text style={[styles.breakdownLabel, { color: Colors.textSecondary }]}>
                      Trip fare ({recalcResult.distance} km)
                    </Text>
                    <Text style={[styles.breakdownValue, { color: Colors.text }]}>
                      {currency.symbol}{recalcResult.baseFare}
                    </Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={[styles.breakdownLabel, { color: Colors.textSecondary }]}>
                      Cancellation fee
                    </Text>
                    <Text style={[styles.breakdownValue, { color: Colors.text }]}>
                      {currency.symbol}{CANCELLATION_FEE}
                    </Text>
                  </View>
                  <View style={[styles.breakdownDivider, { backgroundColor: Colors.gray[200] }]} />
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: Colors.text }]}>Total</Text>
                    <Text style={[styles.totalValue, { color: Colors.text }]}>
                      {currency.symbol}{recalcResult.total}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  testID="confirm-end-ride"
                  activeOpacity={0.9}
                  onPress={handleConfirmCompletion}
                  style={[styles.confirmBtn, { backgroundColor: Colors.text }]}
                >
                  <Check color={Colors.background} size={20} />
                  <Text style={[styles.confirmBtnText, { color: Colors.background }]}>
                    Confirm & finish
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      )}

      <Modal
        visible={showTollsModal}
        transparent
        animationType="none"
        onRequestClose={() => {}}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Animated.View
            style={[
              styles.tollsModalCard,
              {
                backgroundColor: Colors.background,
                opacity: tollsModalAnim,
                transform: [
                  {
                    translateY: tollsModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [60, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 22 }}
            >
              <View style={[styles.warnIconWrap, { backgroundColor: Colors.accent + "1A", alignSelf: "center" }]}>
                <HandCoins color={Colors.accent} size={30} />
              </View>
              <Text style={[styles.endModalTitle, { color: Colors.text }]}>Add tolls or extras</Text>
              <Text style={[styles.endModalBody, { color: Colors.textSecondary }]}>
                Add any tolls paid or extra charges for this trip. Leave blank if none.
              </Text>

              <View style={[styles.tollsBaseRow, { backgroundColor: Colors.gray[100] }]}>
                <Text style={[styles.tollsBaseLabel, { color: Colors.textSecondary }]}>Base fare</Text>
                <Text style={[styles.tollsBaseValue, { color: Colors.text }]}>
                  {currency.symbol}{recalcResult ? recalcResult.total : Math.ceil(fareParam)}
                </Text>
              </View>

              <Text style={[styles.tollsLabel, { color: Colors.textSecondary }]}>Toll charges</Text>
              <View style={[styles.tollsInputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
                <View style={[styles.tollsInputIcon, { backgroundColor: Colors.background }]}>
                  <Coins color={Colors.accent} size={18} />
                </View>
                <Text style={[styles.tollsCurrency, { color: Colors.textSecondary }]}>{currency.symbol}</Text>
                <TextInput
                  testID="tolls-input"
                  value={tollsAmount}
                  onChangeText={setTollsAmount}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.tollsInput, { color: Colors.text }]}
                />
              </View>

              <Text style={[styles.tollsLabel, { color: Colors.textSecondary }]}>Other charges</Text>
              <View style={[styles.tollsInputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
                <View style={[styles.tollsInputIcon, { backgroundColor: Colors.background }]}>
                  <Plus color={Colors.accent} size={18} />
                </View>
                <Text style={[styles.tollsCurrency, { color: Colors.textSecondary }]}>{currency.symbol}</Text>
                <TextInput
                  testID="extras-input"
                  value={extrasAmount}
                  onChangeText={setExtrasAmount}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.tollsInput, { color: Colors.text }]}
                />
              </View>

              <Text style={[styles.tollsLabel, { color: Colors.textSecondary }]}>Note (optional)</Text>
              <View style={[styles.tollsInputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
                <TextInput
                  testID="extras-note-input"
                  value={extrasNote}
                  onChangeText={setExtrasNote}
                  placeholder="e.g. Parking, waiting time"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.tollsInput, { color: Colors.text, paddingLeft: 14 }]}
                />
              </View>

              <View style={[styles.tollsTotalRow, { borderColor: Colors.gray[200] }]}>
                <Text style={[styles.totalLabel, { color: Colors.text }]}>New total</Text>
                <Text style={[styles.totalValue, { color: Colors.text }]}>
                  {currency.symbol}{(recalcResult ? recalcResult.total : Math.ceil(fareParam)) + parsedTolls + parsedExtras}
                </Text>
              </View>

              <View style={[styles.endModalActions, { marginTop: 18 }]}>
                <TouchableOpacity
                  testID="tolls-modal-back"
                  style={[styles.endModalBtn, styles.endModalGhost, { borderColor: Colors.gray[300] }]}
                  activeOpacity={0.85}
                  onPress={handleTollsBack}
                >
                  <Text style={[styles.endModalGhostText, { color: Colors.text }]}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tolls-modal-continue"
                  activeOpacity={0.9}
                  onPress={handleTollsContinue}
                  style={[styles.endModalBtn, { backgroundColor: Colors.text }]}
                >
                  <Text style={[styles.endModalConfirmText, { color: Colors.background }]}>Continue</Text>
                  <ChevronRight color={Colors.background} size={18} />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showPaymentReceivedModal}
        transparent
        animationType="none"
        onRequestClose={() => {}}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.endModalCard,
              {
                backgroundColor: Colors.background,
                opacity: paymentReceivedAnim,
                transform: [
                  {
                    translateY: paymentReceivedAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [60, 0],
                    }),
                  },
                  {
                    scale: paymentReceivedAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.warnIconWrap, { backgroundColor: (Colors.success ?? Colors.accent) + "1A" }]}>
              <Wallet color={Colors.success ?? Colors.accent} size={32} />
            </View>
            <Text style={[styles.endModalTitle, { color: Colors.text }]}>Payment received?</Text>
            <Text style={[styles.endModalBody, { color: Colors.textSecondary }]}>
              Confirm you have collected {currency.symbol}{(recalcResult ? recalcResult.total : Math.ceil(fareParam)) + parsedTolls + parsedExtras} from the passenger before selecting payment mode.
            </Text>

            <View style={[styles.completeStats, { borderColor: Colors.gray[200] }]}>
              <View style={styles.statItem}>
                <Wallet color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {currency.symbol}{recalcResult ? recalcResult.total : Math.ceil(fareParam)}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>fare</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
              <View style={styles.statItem}>
                <Coins color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {currency.symbol}{parsedTolls}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>tolls</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: Colors.gray[200] }]} />
              <View style={styles.statItem}>
                <Plus color={Colors.accent} size={18} />
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {currency.symbol}{parsedExtras}
                </Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>extras</Text>
              </View>
            </View>

            <View style={styles.endModalActions}>
              <TouchableOpacity
                testID="payment-received-cancel"
                style={[styles.endModalBtn, styles.endModalGhost, { borderColor: Colors.gray[300] }]}
                activeOpacity={0.85}
                onPress={() => {
                  closePaymentReceivedModal(() => {
                    openTollsModal();
                  });
                }}
              >
                <Text style={[styles.endModalGhostText, { color: Colors.text }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="payment-received-confirm"
                activeOpacity={0.9}
                onPress={handlePaymentReceivedConfirm}
                style={[styles.endModalBtn, { backgroundColor: Colors.success ?? Colors.accent }]}
              >
                <Check color="#FFFFFF" size={18} />
                <Text style={styles.endModalConfirmText}>Yes, received</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showNavMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNavMenu(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.navMenuOverlay}
          onPress={() => setShowNavMenu(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.navMenuSheet, { backgroundColor: Colors.background, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={[styles.navMenuHandle, { backgroundColor: Colors.gray[300] }]} />
            <Text style={[styles.navMenuTitle, { color: Colors.text }]}>Open in navigation app</Text>
            {(() => {
              const targetLat = phase === "toPickup" ? pickupLatParam : dropLat;
              const targetLng = phase === "toPickup" ? pickupLngParam : dropLng;
              const label = phase === "toPickup" ? "Pickup" : "Destination";
              const openUrl = async (url: string, fallback?: string) => {
                setShowNavMenu(false);
                try {
                  const supported = await Linking.canOpenURL(url);
                  if (supported) {
                    await Linking.openURL(url);
                  } else if (fallback) {
                    await Linking.openURL(fallback);
                  } else {
                    Alert.alert("App not installed", "The selected navigation app is not available on this device.");
                  }
                } catch {
                  if (fallback) {
                    Linking.openURL(fallback).catch(() => {});
                  }
                }
              };
              const apps: { id: string; name: string; color: string; icon: React.ReactNode; onPress: () => void }[] = [
                {
                  id: "waze",
                  name: "Waze",
                  color: "#33CCFF",
                  icon: <Navigation2 color="#FFFFFF" size={18} />,
                  onPress: () => openUrl(`waze://?ll=${targetLat},${targetLng}&navigate=yes`, `https://waze.com/ul?ll=${targetLat},${targetLng}&navigate=yes`),
                },
                {
                  id: "gmaps",
                  name: "Google Maps",
                  color: "#34A853",
                  icon: <MapIcon color="#FFFFFF" size={18} />,
                  onPress: () => {
                    const native = Platform.select({
                      ios: `comgooglemaps://?daddr=${targetLat},${targetLng}&directionsmode=driving`,
                      android: `google.navigation:q=${targetLat},${targetLng}&mode=d`,
                      default: `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`,
                    }) as string;
                    openUrl(native, `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`);
                  },
                },
              ];
              if (Platform.OS === "ios") {
                apps.push({
                  id: "applemaps",
                  name: "Apple Maps",
                  color: "#0A84FF",
                  icon: <MapIcon color="#FFFFFF" size={18} />,
                  onPress: () => openUrl(`http://maps.apple.com/?daddr=${targetLat},${targetLng}&dirflg=d`),
                });
              }
              return (
                <>
                  <Text style={{ color: Colors.textSecondary, fontSize: 13, paddingHorizontal: 4, marginBottom: 10 }} numberOfLines={1}>
                    Navigate to {label}
                  </Text>
                  {apps.map((app) => (
                    <TouchableOpacity
                      key={app.id}
                      testID={`nav-app-${app.id}`}
                      activeOpacity={0.85}
                      onPress={app.onPress}
                      style={[styles.navMenuItem, { borderColor: Colors.gray[200], backgroundColor: Colors.gray[50] ?? Colors.background }]}
                    >
                      <View style={[styles.navMenuIconWrap, { backgroundColor: app.color }]}>
                        {app.icon}
                      </View>
                      <Text style={[styles.navMenuLabel, { color: Colors.text }]}>{app.name}</Text>
                      <ChevronRight color={Colors.textSecondary} size={18} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    testID="nav-app-cancel"
                    activeOpacity={0.85}
                    onPress={() => setShowNavMenu(false)}
                    style={[styles.navMenuCancel, { backgroundColor: Colors.gray[100] }]}
                  >
                    <Text style={[styles.navMenuCancelText, { color: Colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showCancelModal}
        transparent
        animationType="none"
        onRequestClose={() => closeCancelModal()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Animated.View
            style={[
              styles.endModalCard,
              {
                backgroundColor: Colors.background,
                opacity: cancelModalAnim,
                transform: [
                  {
                    translateY: cancelModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [60, 0],
                    }),
                  },
                  {
                    scale: cancelModalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.warnIconWrap, { backgroundColor: Colors.error + "1A" }]}>
              <XCircle color={Colors.error} size={32} />
            </View>
            <Text style={[styles.endModalTitle, { color: Colors.text }]}>Cancel order?</Text>
            <Text style={[styles.endModalBody, { color: Colors.textSecondary }]}>
              Let us know why you&apos;re cancelling this ride.
            </Text>

            <View style={{ width: "100%", gap: 8, marginBottom: 14 }}>
              {[
                { id: "passenger_no_show", label: "Passenger no-show" },
                { id: "wrong_address", label: "Wrong pickup address" },
                { id: "passenger_cancelled", label: "Passenger asked to cancel" },
                { id: "traffic_too_far", label: "Too far / heavy traffic" },
                { id: "vehicle_issue", label: "Vehicle issue" },
                { id: "other", label: "Other" },
              ].map((opt) => {
                const isSelected = cancelReason === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    testID={`cancel-reason-${opt.id}`}
                    activeOpacity={0.85}
                    onPress={() => {
                      setCancelReason(opt.id);
                      if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                    }}
                    style={[
                      styles.cancelReasonRow,
                      {
                        borderColor: isSelected ? Colors.error : Colors.gray[200],
                        backgroundColor: isSelected ? Colors.error + "10" : "transparent",
                      },
                    ]}
                  >
                    <Text style={[styles.cancelReasonLabel, { color: Colors.text }]}>
                      {opt.label}
                    </Text>
                    <View
                      style={[
                        styles.paymentRadio,
                        {
                          borderColor: isSelected ? Colors.error : Colors.gray[300],
                          backgroundColor: isSelected ? Colors.error : "transparent",
                        },
                      ]}
                    >
                      {isSelected && <Check color="#FFFFFF" size={14} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {cancelReason === "other" && (
              <View
                style={[
                  styles.tollsInputWrap,
                  {
                    backgroundColor: Colors.gray[100],
                    borderColor: Colors.gray[200],
                    width: "100%",
                    marginBottom: 14,
                  },
                ]}
              >
                <TextInput
                  testID="cancel-reason-other-input"
                  value={cancelOtherText}
                  onChangeText={setCancelOtherText}
                  placeholder="Type your reason"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.tollsInput, { color: Colors.text, paddingLeft: 14 }]}
                  autoFocus
                />
              </View>
            )}

            <View style={styles.endModalActions}>
              <TouchableOpacity
                testID="cancel-modal-keep"
                style={[styles.endModalBtn, styles.endModalGhost, { borderColor: Colors.gray[300] }]}
                activeOpacity={0.85}
                onPress={() => closeCancelModal()}
              >
                <Text style={[styles.endModalGhostText, { color: Colors.text }]}>Keep order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="cancel-modal-confirm"
                style={[
                  styles.endModalBtn,
                  {
                    backgroundColor:
                      !cancelReason || (cancelReason === "other" && !cancelOtherText.trim())
                        ? Colors.gray[300]
                        : Colors.error,
                  },
                ]}
                activeOpacity={0.9}
                disabled={!cancelReason || (cancelReason === "other" && !cancelOtherText.trim())}
                onPress={handleConfirmCancelOrder}
              >
                <Power color="#FFFFFF" size={18} />
                <Text style={styles.endModalConfirmText}>Cancel order</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {showPaymentSheet && (
        <View style={styles.recalcOverlay} pointerEvents="box-none">
          <TouchableOpacity
            activeOpacity={1}
            onPress={closePaymentSheet}
            style={styles.recalcDim}
          />
          <Animated.View
            style={[
              styles.recalcSheet,
              {
                backgroundColor: Colors.background,
                paddingBottom: Math.max(insets.bottom, 16) + 16,
                transform: [
                  {
                    translateY: paymentSheetAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [600, 0],
                    }),
                  },
                ],
                shadowColor: colorScheme === "dark" ? "#000" : "#0f172a",
              },
            ]}
          >
            <View style={styles.handleBar}>
              <View style={[styles.handle, { backgroundColor: Colors.gray[300] }]} />
            </View>

            <View style={styles.recalcHeaderRow}>
              <View style={[styles.recalcIcon, { backgroundColor: Colors.accent + "1A" }]}>
                <Wallet color={Colors.accent} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.recalcTitle, { color: Colors.text }]}>Select payment mode</Text>
                <Text style={[styles.recalcSub, { color: Colors.textSecondary }]}>
                  Total {currency.symbol}{(recalcResult ? recalcResult.total : Math.ceil(fareParam)) + parsedTolls + parsedExtras}
                </Text>
              </View>
              <TouchableOpacity onPress={closePaymentSheet} style={[styles.recalcClose, { backgroundColor: Colors.gray[100] }]}>
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 10, marginTop: 4 }}>
              {[
                { id: "cash", label: "Cash", icon: Banknote, tint: "#22C55E" },
                { id: "card", label: "Card", icon: CreditCard, tint: "#3B82F6" },
                { id: "qr", label: "QR Pay", icon: QrCode, tint: "#8B5CF6" },
                { id: "online", label: "Online transfer", icon: Building2, tint: "#0EA5E9" },
                { id: "tng", label: "Touch n' Go", icon: Smartphone, tint: "#F59E0B" },
                { id: "getpay", label: "GetPay", icon: Wallet, tint: "#10B981" },
              ].map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedPayment === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    testID={`payment-option-${opt.id}`}
                    activeOpacity={0.85}
                    onPress={() => handleSelectPayment(opt.id)}
                    style={[
                      styles.paymentOptionRow,
                      {
                        borderColor: isSelected ? Colors.accent : Colors.gray[200],
                        backgroundColor: isSelected ? Colors.accent + "10" : "transparent",
                      },
                    ]}
                  >
                    <View style={[styles.paymentOptionIconWrap, { backgroundColor: opt.tint + "1A" }]}>
                      <Icon color={opt.tint} size={22} />
                    </View>
                    <Text style={[styles.paymentOptionLabel, { color: Colors.text }]}>
                      {opt.label}
                    </Text>
                    <View
                      style={[
                        styles.paymentRadio,
                        {
                          borderColor: isSelected ? Colors.accent : Colors.gray[300],
                          backgroundColor: isSelected ? Colors.accent : "transparent",
                        },
                      ]}
                    >
                      {isSelected && <Check color="#FFFFFF" size={14} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width, height },
  webMap: { justifyContent: "center", alignItems: "center", gap: 10 },
  webText: { fontSize: 20, fontWeight: "700" },
  webSub: { fontSize: 14 },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingTop: 8,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 8,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: "700" },
  recPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
    gap: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  recDot: { width: 7, height: 7, borderRadius: 3.5 },
  recText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  statusSep: { width: 1, height: 14, marginHorizontal: 2 },
  kmText: { fontSize: 13, fontWeight: "800" },
  elapsedText: { fontSize: 12, fontWeight: "600", marginLeft: 4 },
  dropPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  carWrap: { width: 60, height: 60, justifyContent: "center", alignItems: "center" },
  pulseRing: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  carDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  bottomCard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  handleBar: { alignItems: "center", paddingBottom: 12 },
  handle: { width: 44, height: 4, borderRadius: 2 },
  dropRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  locationsBlock: {
    marginBottom: 16,
    gap: 10,
  },
  locRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  locIconCol: {
    width: 42,
    alignItems: "center",
  },
  pickDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 14,
  },
  locConnector: {
    width: 2,
    flex: 1,
    marginTop: 4,
    marginBottom: -2,
    minHeight: 14,
  },
  locSubText: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  dropIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  dropLabel: { fontSize: 12, fontWeight: "600", marginBottom: 2 },
  dropName: { fontSize: 16, fontWeight: "700" },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "600" },
  divider: { width: 1, height: 32 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: { height: "100%", borderRadius: 3 },
  endButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  endButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  endModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
  },
  warnIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  endModalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  endModalBody: { fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 22 },
  endModalActions: { flexDirection: "row", gap: 10, width: "100%" },
  endModalBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  endModalGhost: { borderWidth: 1, backgroundColor: "transparent" },
  endModalGhostText: { fontSize: 15, fontWeight: "700" },
  endModalConfirmText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  completeStats: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 18,
    width: "100%",
  },

  recalcOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
  recalcDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  recalcSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 14,
  },
  recalcHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  recalcIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  recalcTitle: { fontSize: 18, fontWeight: "800" },
  recalcSub: { fontSize: 13, fontWeight: "500", marginTop: 2 },
  recalcClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  recalcLoading: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 12,
  },
  recalcLoadingText: { fontSize: 14, fontWeight: "600" },
  routeRow: {
    flexDirection: "row",
    padding: 14,
    borderRadius: 16,
    gap: 12,
  },
  routeCol: { width: 14, alignItems: "center", paddingTop: 6 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, marginVertical: 4 },
  routeSquare: { width: 10, height: 10, borderRadius: 2 },
  routeLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  routeText: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  routeSubText: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  breakdown: { marginTop: 14 },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  breakdownLabel: { fontSize: 14, fontWeight: "500" },
  breakdownValue: { fontSize: 15, fontWeight: "700" },
  breakdownDivider: { height: 1, marginVertical: 6 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  totalLabel: { fontSize: 15, fontWeight: "700" },
  totalValue: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 16,
  },
  confirmBtnText: { fontSize: 16, fontWeight: "800" },
  paymentOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  paymentOptionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  paymentOptionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  paymentRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  tollsModalCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "90%",
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
    overflow: "hidden",
  },
  tollsBaseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 16,
  },
  tollsBaseLabel: { fontSize: 13, fontWeight: "600" },
  tollsBaseValue: { fontSize: 17, fontWeight: "800" },
  tollsLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 6,
  },
  tollsInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingLeft: 6,
    paddingRight: 12,
    marginBottom: 10,
  },
  tollsInputIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 6,
    marginRight: 4,
  },
  tollsCurrency: {
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 6,
    marginRight: 4,
  },
  tollsInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    paddingHorizontal: 4,
  },
  tollsTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    marginTop: 8,
  },
  navFab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5,
  },
  navMenuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  navMenuSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  navMenuHandle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  navMenuTitle: {
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  navMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  navMenuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  navMenuLabel: { fontSize: 15, fontWeight: "700", flex: 1 },
  navMenuCancel: {
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 14,
    marginTop: 4,
  },
  navMenuCancelText: { fontSize: 15, fontWeight: "700" },
  cancelFab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  cancelFabText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  cancelReasonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  cancelReasonLabel: { fontSize: 14, fontWeight: "700", flex: 1 },
  recenterBtn: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
});
