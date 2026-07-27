import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
  Image,
  Linking,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import {
  Phone,
  MessageCircle,
  Star,
  X,
  MapPin,
  Navigation,
  Shield,
  Share2,
  ChevronRight,
  Crosshair,
  Copy,
  CheckCircle2,
  Car,
  XCircle,
  ShieldAlert,
  Check,
  Coins,
  Layers,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "@/contexts/LocationContext";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { MapView, Marker, Polyline, calculateRoute } from "@/utils/maps";
import WebMap from "@/components/WebMap";
import {
  cancelRideRequest,
  completeRideRequest,
  updateRideRequestStatus,
  requestRideCancellation,
  subscribeToRideRequest,
  fetchRideRequest,
  publishLiveLocation,
} from "@/utils/rideRequestsStore";
import { AppAlertModal } from "@/components/AppAlertModal";
import { useAuth } from "@/contexts/AuthContext";
import { awardRideCoins, redeemCoinsForFare } from "@/utils/walletStore";
import { formatCoins } from "@/utils/getCoinStore";

const { width, height } = Dimensions.get("window");

interface Coord {
  latitude: number;
  longitude: number;
}

type Phase = "arriving" | "arrived" | "onTrip" | "completed";

const lightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "on" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#c8e6c9" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b3e5fc" }] },
];

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
];

/** Compass bearing between two coordinates, in degrees. */
/** Great-circle distance between two coordinates in kilometres. */
function haversineKm(a: Coord, b: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Average city driving speed used to convert distance into an ETA. */
const AVG_CITY_SPEED_KMH = 26;

function computeBearing(from: Coord, to: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export default function RideTrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const { currency } = useLocation();
  const { authState } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);

  const pickup = (params.pickup as string) || "Current Location";
  const destination = (params.destination as string) || "Destination";
  const pickupLat = params.pickupLat ? parseFloat(params.pickupLat as string) : 3.139;
  const pickupLng = params.pickupLng ? parseFloat(params.pickupLng as string) : 101.6869;
  const destLat = params.destLat ? parseFloat(params.destLat as string) : 3.1569;
  const destLng = params.destLng ? parseFloat(params.destLng as string) : 101.7123;

  const requestId = (params.requestId as string) || "";
  // "Use GET.coin" toggle from booking: redeem coins towards the fare at drop-off.
  const useCoinsParam = (params.useCoins as string) === "1";
  const driverName = (params.driverName as string) || "Your driver";
  const driverPhoto = (params.driverPhoto as string) || "";
  const driverRating = (params.driverRating as string) || "5.0";
  const driverVehicle = (params.driverVehicle as string) || "Sedan";
  const priceParam = (params.price as string) || "0";
  const priceDisplay = useMemo<string>(() => {
    const n = parseFloat(priceParam.replace(/[^0-9.]/g, ""));
    if (isNaN(n)) return `${currency.symbol}${priceParam}`;
    return `${currency.symbol}${Math.round(n)}`;
  }, [priceParam, currency.symbol]);

  const plateNo = useMemo<string>(() => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const r = (n: number) => Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
    return `${r(3)} ${Math.floor(1000 + Math.random() * 9000)}`;
  }, []);
  const otp = useMemo<string>(() => `${Math.floor(1000 + Math.random() * 9000)}`, []);

  const pickupCoord = useMemo<Coord>(() => ({ latitude: pickupLat, longitude: pickupLng }), [pickupLat, pickupLng]);
  const destCoord = useMemo<Coord>(() => ({ latitude: destLat, longitude: destLng }), [destLat, destLng]);
  // Driver starts a short distance from the pickup point.
  const driverStart = useMemo<Coord>(
    () => ({ latitude: pickupLat - 0.012, longitude: pickupLng - 0.009 }),
    [pickupLat, pickupLng]
  );

  // When restored after an app restart, resume the matching phase instead of
  // replaying the driver-arriving leg from scratch.
  const restoreStatus = params.restoreStatus as string | undefined;
  const initialPhase: Phase =
    restoreStatus === "on_trip"
      ? "onTrip"
      : restoreStatus === "arrived"
        ? "arrived"
        : "arriving";
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [routeCoords, setRouteCoords] = useState<Coord[]>([]);
  const [driverPos, setDriverPos] = useState<Coord>(driverStart);
  const [progress, setProgress] = useState<number>(0);
  const [etaMin, setEtaMin] = useState<number>(4);
  const [heading, setHeading] = useState<number>(0);
  const [followDriver, setFollowDriver] = useState<boolean>(true);
  const [showCancel, setShowCancel] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelOtherText, setCancelOtherText] = useState<string>("");
  // True while the passenger's cancellation is waiting for driver approval
  // (only used once the trip has started — the driver must accept the cancel).
  const [cancelPending, setCancelPending] = useState<boolean>(false);
  const [showCancelDeclined, setShowCancelDeclined] = useState<boolean>(false);
  const cancelPendingRef = useRef<boolean>(false);

  // Admin "Mock / Simulation" switch: when off, the car is not animated and
  // phases follow the real ride request status written by the partner.
  const { settings: displaySettings } = useDisplaySettings();
  const tripSimEnabled = displaySettings.riderTripSimEnabled;
  const tripSimEnabledRef = useRef<boolean>(tripSimEnabled);

  const phaseRef = useRef<Phase>("arriving");
  const prevPosRef = useRef<Coord | null>(null);
  const didFitRef = useRef<boolean>(false);
  const recenterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideAnim = useRef(new Animated.Value(60)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const cancelAnim = useRef(new Animated.Value(0)).current;

  // GET.coin toast shown when the trip completes (coins earned / redeemed).
  const [mapType, setMapType] = useState<"standard" | "satellite">("standard");
  const [coinToast, setCoinToast] = useState<{
    earned: number;
    redeemedCoins: number;
    redeemedValue: number;
  } | null>(null);
  // Coin discount applied to the fare, shown in the completed summary card.
  const [coinRedeemInfo, setCoinRedeemInfo] = useState<{
    coinsUsed: number;
    coinValue: number;
  } | null>(null);
  const coinToastAnim = useRef(new Animated.Value(0)).current;
  const coinToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slide the coin toast in when set, auto-dismiss after a few seconds.
  useEffect(() => {
    if (!coinToast) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    Animated.spring(coinToastAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 9,
    }).start();
    if (coinToastTimerRef.current) clearTimeout(coinToastTimerRef.current);
    coinToastTimerRef.current = setTimeout(() => {
      Animated.timing(coinToastAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(() => setCoinToast(null));
    }, 4500);
    return () => {
      if (coinToastTimerRef.current) clearTimeout(coinToastTimerRef.current);
    };
  }, [coinToast, coinToastAnim]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    cancelPendingRef.current = cancelPending;
  }, [cancelPending]);

  useEffect(() => {
    tripSimEnabledRef.current = tripSimEnabled;
  }, [tripSimEnabled]);

  // Watch the live request row. If the driver approves a cancellation the
  // status flips to "cancelled" (leave the screen); if they decline, the
  // cancel_requested_at stamp is cleared and the trip continues.
  useEffect(() => {
    if (!requestId) return;
    const unsub = subscribeToRideRequest(requestId, (row) => {
      if (row.status === "cancelled") {
        console.log("[ride-tracking] ride cancelled", requestId);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
        router.replace("/" as any);
        return;
      }
      if (cancelPendingRef.current && !row.cancel_requested_at) {
        console.log("[ride-tracking] driver declined cancellation", requestId);
        setCancelPending(false);
        setShowCancelDeclined(true);
      }
      // Simulation off: follow the partner's real live GPS position so the
      // car marker mirrors the driver's actual movement.
      if (!tripSimEnabledRef.current && row.partner_live_lat != null && row.partner_live_lng != null) {
        setDriverPos({ latitude: row.partner_live_lat, longitude: row.partner_live_lng });
      }
      // Simulation off: mirror the real status the partner writes to the request.
      if (!tripSimEnabledRef.current) {
        const current = phaseRef.current;
        if (row.status === "arrived" && current === "arriving") {
          console.log("[ride-tracking] real status -> arrived");
          setPhase("arrived");
        } else if (row.status === "on_trip" && current !== "onTrip" && current !== "completed") {
          console.log("[ride-tracking] real status -> on trip");
          setPhase("onTrip");
        } else if (row.status === "completed" && current !== "completed") {
          console.log("[ride-tracking] real status -> completed");
          setPhase("completed");
        }
      }
    });
    return unsub;
  }, [requestId, router]);

  // Polling fallback for live tracking: realtime events can be missed
  // (backgrounded app, dropped socket), so while the simulation is off the
  // partner's live position is re-fetched every few seconds.
  useEffect(() => {
    if (!requestId || tripSimEnabled) return;
    const interval = setInterval(() => {
      void fetchRideRequest(requestId)
        .then((row) => {
          if (row && row.partner_live_lat != null && row.partner_live_lng != null) {
            setDriverPos({ latitude: row.partner_live_lat, longitude: row.partner_live_lng });
          }
        })
        .catch((e) => {
          console.log("[ride-tracking] live position poll failed", e);
        });
    }, 4000);
    return () => clearInterval(interval);
  }, [requestId, tripSimEnabled]);

  // Share the passenger's live GPS with the partner (throttled) so the driver
  // can see where the rider is while heading to the pickup.
  useEffect(() => {
    if (!requestId || Platform.OS === "web") return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let lastPublish = 0;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) {
          console.log("[ride-tracking] location permission not granted for live sharing");
          return;
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 10 },
          (pos) => {
            const now = Date.now();
            if (now - lastPublish < 4000) return;
            lastPublish = now;
            void publishLiveLocation(requestId, "user", pos.coords.latitude, pos.coords.longitude);
          }
        );
      } catch (e) {
        console.log("[ride-tracking] live GPS share failed", e);
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [requestId]);

  // GET.coin at trip completion: redeem coins towards the fare when the rider
  // enabled the toggle at booking, then award ride-reward GC at the
  // admin-configured earn rate (both idempotent per ride). Surfaces a toast
  // with what was earned / used.
  const coinAwardFiredRef = useRef<boolean>(false);
  const simRideKeyRef = useRef<string>(`sim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  useEffect(() => {
    if (phase !== "completed" || coinAwardFiredRef.current) return;
    coinAwardFiredRef.current = true;
    const uid = authState.userId ?? "";
    const fare = parseFloat(priceParam.replace(/[^0-9.]/g, ""));
    if (!uid || !(fare > 0)) return;
    const rideKey = requestId || simRideKeyRef.current;
    void (async () => {
      let redeemedCoins = 0;
      let redeemedValue = 0;
      if (useCoinsParam) {
        try {
          const r = await redeemCoinsForFare({ userId: uid, fareTotal: fare, rideKey });
          if (r.ok && r.coinsUsed > 0) {
            redeemedCoins = r.coinsUsed;
            redeemedValue = r.coinValue;
            setCoinRedeemInfo({ coinsUsed: r.coinsUsed, coinValue: r.coinValue });
            console.log("[ride-tracking] fare coins redeemed", r.coinsUsed, "GC");
          }
        } catch (e) {
          console.log("[ride-tracking] coin redemption failed", e);
        }
      }
      const res = await awardRideCoins({
        userId: uid,
        fareTotal: fare,
        rideRequestId: requestId || null,
        rideKey,
      });
      const earned = res.ok ? res.coins : 0;
      if (earned > 0) {
        console.log("[ride-tracking] ride reward granted", earned, "GC");
      }
      if (earned > 0 || redeemedCoins > 0) {
        setCoinToast({ earned, redeemedCoins, redeemedValue });
      }
    })();
  }, [phase, authState.userId, priceParam, requestId, useCoinsParam]);

  // Keep the ride request row in sync with the trip lifecycle so a finished
  // trip never lingers as "ongoing" and blocks the rider's next request.
  useEffect(() => {
    if (!requestId) return;
    // Simulation off: the partner is the source of truth for lifecycle
    // statuses, so the rider must not write them back.
    if (!tripSimEnabled) return;
    if (phase === "arrived") {
      void updateRideRequestStatus(requestId, "arrived");
    } else if (phase === "onTrip") {
      void updateRideRequestStatus(requestId, "on_trip");
    } else if (phase === "completed") {
      console.log("[ride-tracking] marking request completed", requestId);
      void completeRideRequest(requestId);
    }
  }, [phase, requestId, tripSimEnabled]);

  // Entrance + driver pulse
  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, [slideAnim, cardOpacity, pulseAnim]);

  // Fetch the route for the current leg (driver→pickup, then pickup→destination).
  useEffect(() => {
    if (phase === "completed" || phase === "arrived") return;
    let cancelled = false;
    const from = phase === "arriving" ? driverStart : pickupCoord;
    const to = phase === "arriving" ? pickupCoord : destCoord;

    const fetchRoute = async () => {
      try {
        const result = await calculateRoute(from, to, undefined, "ride-tracking");
        if (cancelled) return;
        if (result?.coordinates && result.coordinates.length > 1) {
          setRouteCoords(result.coordinates);
          setDriverPos(result.coordinates[0]);
          if (typeof result.duration === "number" && result.duration > 0) {
            setEtaMin(Math.max(1, Math.round(result.duration)));
          }
        } else {
          setRouteCoords([from, to]);
          setDriverPos(from);
        }
      } catch {
        if (!cancelled) {
          setRouteCoords([from, to]);
          setDriverPos(from);
        }
      }
      if (!cancelled) {
        setProgress(0);
        didFitRef.current = false;
      }
    };
    fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [phase, driverStart, pickupCoord, destCoord]);

  // Animate the driver marker along the active route (simulation only).
  useEffect(() => {
    if (!tripSimEnabled) return;
    if (routeCoords.length < 2) return;
    if (phase === "arrived" || phase === "completed") return;

    const total = routeCoords.length - 1;
    const tickMs = 700;
    const totalMs = phase === "arriving" ? 14000 : 20000;
    const stepPerTick = total / (totalMs / tickMs);

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + stepPerTick;
        if (next >= total) {
          clearInterval(interval);
          setDriverPos(routeCoords[routeCoords.length - 1]);
          if (phaseRef.current === "arriving") {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setPhase("arrived");
            setTimeout(() => setPhase("onTrip"), 3500);
          } else if (phaseRef.current === "onTrip") {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setPhase("completed");
          }
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
        const legMin = phaseRef.current === "arriving" ? etaMin : Math.max(etaMin, 8);
        setEtaMin(Math.max(0, Math.round(legMin * (1 - pct))));
        return next;
      });
    }, tickMs);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCoords, phase, tripSimEnabled]);

  // Heading for the car marker.
  useEffect(() => {
    const prev = prevPosRef.current;
    if (prev) {
      const moved = Math.abs(driverPos.latitude - prev.latitude) + Math.abs(driverPos.longitude - prev.longitude);
      if (moved > 1e-7) setHeading(computeBearing(prev, driverPos));
    }
    prevPosRef.current = driverPos;
  }, [driverPos]);

  // Camera follow.
  useEffect(() => {
    if (!mapRef.current || !followDriver) return;
    mapRef.current?.animateCamera?.(
      { center: { latitude: driverPos.latitude, longitude: driverPos.longitude }, zoom: 16, heading: 0, pitch: 0 },
      { duration: 700 }
    );
  }, [driverPos, followDriver]);

  // Initial fit to show both driver and target.
  useEffect(() => {
    if (!mapRef.current || routeCoords.length < 2 || didFitRef.current) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates?.(routeCoords, {
        edgePadding: { top: 140, right: 80, bottom: 420, left: 80 },
        animated: true,
      });
      didFitRef.current = true;
    }, 400);
    return () => clearTimeout(t);
  }, [routeCoords]);

  const handlePanDrag = useCallback(() => {
    if (followDriver) setFollowDriver(false);
    if (recenterTimer.current) clearTimeout(recenterTimer.current);
    recenterTimer.current = setTimeout(() => setFollowDriver(true), 8000);
  }, [followDriver]);

  useEffect(() => {
    return () => {
      if (recenterTimer.current) clearTimeout(recenterTimer.current);
    };
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowDriver(true);
    mapRef.current?.animateCamera?.(
      { center: { latitude: driverPos.latitude, longitude: driverPos.longitude }, zoom: 16 },
      { duration: 500 }
    );
  }, [driverPos]);

  const handleCall = useCallback(() => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    Linking.openURL("tel:+60123456789").catch(() => {});
  }, []);

  const handleMessage = useCallback(() => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    Linking.openURL("sms:+60123456789").catch(() => {});
  }, []);

  const openCancel = useCallback(() => {
    if (cancelPendingRef.current) return;
    setCancelReason("");
    setCancelOtherText("");
    setShowCancel(true);
    Animated.spring(cancelAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 11 }).start();
  }, [cancelAnim]);

  const closeCancel = useCallback((cb?: () => void) => {
    Animated.timing(cancelAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setShowCancel(false);
      if (cb) cb();
    });
  }, [cancelAnim]);

  const handleSos = useCallback(() => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Linking.openURL("tel:999").catch(() => {});
  }, []);

  const confirmCancel = useCallback(() => {
    const reason = cancelReason === "other" ? cancelOtherText.trim() : cancelReason;
    if (!reason) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    // Once the trip has started the driver must approve the cancellation:
    // stamp the request and wait instead of cancelling straight away.
    if (requestId && phase === "onTrip") {
      console.log("[ride-tracking] requesting driver-approved cancellation", requestId, reason);
      setCancelPending(true);
      void requestRideCancellation(requestId, "rider", reason);
      closeCancel();
      return;
    }
    if (requestId) {
      console.log("[ride-tracking] cancelling request", requestId, reason);
      void cancelRideRequest(requestId, reason);
    }
    closeCancel(() => router.replace("/" as any));
  }, [closeCancel, router, requestId, phase, cancelReason, cancelOtherText]);

  const remainingCoords = useMemo<Coord[]>(() => {
    if (routeCoords.length === 0) return [];
    const idx = Math.floor(progress);
    return [driverPos, ...routeCoords.slice(Math.min(idx + 1, routeCoords.length - 1))];
  }, [routeCoords, progress, driverPos]);

  const initialRegion = {
    latitude: (driverStart.latitude + pickupLat) / 2,
    longitude: (driverStart.longitude + pickupLng) / 2,
    latitudeDelta: Math.abs(driverStart.latitude - pickupLat) * 2.2 || 0.04,
    longitudeDelta: Math.abs(driverStart.longitude - pickupLng) * 2.2 || 0.04,
  };

  // Remaining driving distance for the current leg. Prefer summing the
  // remaining route polyline (road distance); fall back to the straight-line
  // distance to the leg target when no route is loaded yet.
  const remainingKm = useMemo<number>(() => {
    if (remainingCoords.length > 1) {
      let sum = 0;
      for (let i = 0; i < remainingCoords.length - 1; i++) {
        sum += haversineKm(remainingCoords[i], remainingCoords[i + 1]);
      }
      return sum;
    }
    const target = phase === "arriving" ? pickupCoord : destCoord;
    return haversineKm(driverPos, target);
  }, [remainingCoords, driverPos, phase, pickupCoord, destCoord]);

  // Distance-based ETA (minutes) and projected arrival clock time.
  const distanceEtaMin = useMemo<number>(
    () => Math.max(1, Math.ceil((remainingKm / AVG_CITY_SPEED_KMH) * 60)),
    [remainingKm]
  );
  const arrivalClock = useMemo<string>(() => {
    const d = new Date(Date.now() + distanceEtaMin * 60_000);
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = ((h + 11) % 12) + 1;
    const ampm = h >= 12 ? "PM" : "AM";
    return `${hh}:${m < 10 ? `0${m}` : m} ${ampm}`;
  }, [distanceEtaMin]);
  const showEtaChip = phase === "arriving" || phase === "onTrip";
  const distanceLabel =
    remainingKm < 1 ? `${Math.max(50, Math.round(remainingKm * 1000 / 10) * 10)} m` : `${remainingKm.toFixed(1)} km`;

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  const statusText =
    phase === "arriving"
      ? `${driverName.split(" ")[0]} is on the way`
      : phase === "arrived"
        ? `${driverName.split(" ")[0]} has arrived`
        : phase === "onTrip"
          ? "On the way to destination"
          : "You've arrived";

  const subStatus = cancelPending
    ? "Waiting for driver to approve cancellation…"
    : phase === "arriving"
      ? etaMin <= 0
        ? "Arriving now"
        : `Arriving in ${etaMin} min`
      : phase === "arrived"
        ? "Meet your driver at the pickup point"
        : phase === "onTrip"
          ? etaMin <= 0
            ? "Almost there"
            : `${etaMin} min to destination`
          : "Hope you enjoyed the ride";

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {Platform.OS !== "web" && MapView ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          mapType={mapType}
          customMapStyle={colorScheme === "dark" ? darkMapStyle : lightMapStyle}
          showsCompass={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          onPanDrag={handlePanDrag}
        >
          {Marker && (
            <Marker coordinate={pickupCoord} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.pickupMarker, { borderColor: Colors.background, backgroundColor: Colors.accent }]}>
                <View style={[styles.pickupDot, { backgroundColor: Colors.background }]} />
              </View>
            </Marker>
          )}

          {Marker && (phase === "onTrip" || phase === "completed") && (
            <Marker coordinate={destCoord} anchor={{ x: 0.5, y: 1 }}>
              <View style={[styles.destPin, { backgroundColor: Colors.text }]}>
                <MapPin color={Colors.background} size={18} />
              </View>
            </Marker>
          )}

          {Polyline && remainingCoords.length > 1 && (
            <Polyline coordinates={remainingCoords} strokeColor={Colors.accent} strokeWidth={6} />
          )}

          {Marker && phase !== "completed" && (
            <Marker coordinate={driverPos} anchor={{ x: 0.5, y: 0.5 }} flat rotation={heading}>
              <View style={styles.carWrap}>
                <Animated.View
                  style={[
                    styles.pulseRing,
                    { backgroundColor: Colors.accent, transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                  ]}
                />
                <View style={[styles.carDot, { backgroundColor: Colors.accent, borderColor: Colors.background }]}>
                  <Navigation color={Colors.background} size={16} fill={Colors.background} />
                </View>
              </View>
            </Marker>
          )}
        </MapView>
      ) : (
        <WebMap
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          dark={colorScheme === "dark"}
          satellite={mapType === "satellite"}
          accentColor={Colors.accent}
          onPanDrag={handlePanDrag}
          markers={[
            { id: "pickup", coordinate: pickupCoord, kind: "pickup" as const },
            ...(phase === "onTrip" || phase === "completed"
              ? [{ id: "dest", coordinate: destCoord, kind: "dest" as const }]
              : []),
            ...(phase !== "completed"
              ? [{ id: "driver", coordinate: driverPos, kind: "driver" as const, heading }]
              : []),
          ]}
          polylines={
            remainingCoords.length > 1
              ? [{ id: "route", coordinates: remainingCoords, color: Colors.accent, width: 6 }]
              : []
          }
        />
      )}

      {/* Map type toggle */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          setMapType((prev) => {
            const next = prev === "standard" ? "satellite" : "standard";
            console.log("[ride-tracking] map type", next);
            return next;
          });
        }}
        style={[
          styles.mapTypeBtn,
          {
            top: insets.top + 116,
            backgroundColor: mapType === "satellite" ? Colors.accent : Colors.background,
          },
        ]}
        testID="ride-tracking-maptype"
      >
        <Layers
          color={mapType === "satellite" ? "#FFFFFF" : Colors.text}
          size={20}
        />
      </TouchableOpacity>

      {/* Distance-based ETA chip */}
      {showEtaChip && (
        <View style={[styles.etaChipWrap, { top: insets.top + 64 }]} pointerEvents="none">
          <View style={[styles.etaChip, { backgroundColor: Colors.background }]}>
            <View style={[styles.etaChipBadge, { backgroundColor: Colors.accent }]}>
              <Text style={styles.etaChipBadgeText}>{distanceEtaMin} min</Text>
            </View>
            <Text style={[styles.etaChipText, { color: Colors.text }]} numberOfLines={1}>
              {distanceLabel} · {phase === "arriving" ? "pickup" : "arrival"} {arrivalClock}
            </Text>
          </View>
        </View>
      )}

      {/* Top status pill */}
      <SafeAreaView edges={["top"]} style={[styles.topOverlay, { pointerEvents: "box-none" }]}>
        <View style={[styles.statusPill, { backgroundColor: Colors.background }]}>
          <View
            style={[
              styles.liveDot,
              { backgroundColor: phase === "completed" || phase === "arrived" ? Colors.success : Colors.accent },
            ]}
          />
          <Text style={[styles.statusPillText, { color: Colors.text }]} numberOfLines={1}>
            {subStatus}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            if (phase === "completed") {
              router.replace("/" as any);
            } else {
              openCancel();
            }
          }}
          style={[styles.closeBtn, { backgroundColor: Colors.background }]}
        >
          <X color={Colors.text} size={22} />
        </TouchableOpacity>
      </SafeAreaView>

      {/* GET.coin toast — coins earned / redeemed on trip completion */}
      {coinToast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.coinToast,
            {
              top: insets.top + 64,
              backgroundColor: colorScheme === "dark" ? "#2A2410" : "#FFFBEB",
              borderColor: "#F3E8C0",
              opacity: coinToastAnim,
              transform: [
                {
                  translateY: coinToastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-24, 0],
                  }),
                },
              ],
            },
          ]}
          testID="ride-coin-toast"
        >
          <View style={styles.coinToastBadge}>
            <Coins color="#B45309" size={18} />
          </View>
          <View style={styles.coinToastTextWrap}>
            {coinToast.earned > 0 && (
              <Text style={[styles.coinToastTitle, { color: Colors.text }]}>
                +{formatCoins(coinToast.earned)} earned
              </Text>
            )}
            {coinToast.redeemedCoins > 0 && (
              <Text
                style={[
                  coinToast.earned > 0 ? styles.coinToastSub : styles.coinToastTitle,
                  { color: coinToast.earned > 0 ? Colors.textSecondary : Colors.text },
                ]}
              >
                −{formatCoins(coinToast.redeemedCoins)} used • RM
                {coinToast.redeemedValue.toFixed(2)} off fare
              </Text>
            )}
          </View>
        </Animated.View>
      )}

      {/* Recenter */}
      {!followDriver && Platform.OS !== "web" && phase !== "completed" && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleRecenter}
          style={[
            styles.recenterBtn,
            {
              backgroundColor: Colors.background,
              bottom: 360 + insets.bottom,
              transform: [
                { translateX: displaySettings.rtRecenterHorizontal },
                { translateY: displaySettings.rtRecenterVertical },
              ],
            },
          ]}
        >
          <Crosshair color={Colors.accent} size={22} />
        </TouchableOpacity>
      )}

      {/* Bottom sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: Colors.background,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
            transform: [{ translateY: slideAnim }],
            opacity: cardOpacity,
            shadowColor: colorScheme === "dark" ? "#000" : "#0f172a",
          },
        ]}
      >
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: Colors.gray[300] }]} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.sheetContent}
        >
          {/* Status header */}
          <View style={styles.statusHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusTitle, { color: Colors.text }]}>{statusText}</Text>
              <Text style={[styles.statusSub, { color: Colors.textSecondary }]}>{subStatus}</Text>
            </View>
            {phase === "arrived" && (
              <View style={[styles.otpBox, { backgroundColor: Colors.accent + "1A", borderColor: Colors.accent }]}>
                <Text style={[styles.otpLabel, { color: Colors.textSecondary }]}>PIN</Text>
                <Text style={[styles.otpValue, { color: Colors.accent }]}>{otp}</Text>
              </View>
            )}
            {phase === "completed" && (
              <View style={[styles.doneIcon, { backgroundColor: Colors.success + "1A" }]}>
                <CheckCircle2 color={Colors.success} size={28} />
              </View>
            )}
          </View>

          {phase !== "completed" ? (
            <>
              {/* Driver card */}
              <View style={[styles.driverCard, { backgroundColor: Colors.gray[50], borderColor: Colors.gray[200] }]}>
                <View style={styles.driverRow}>
                  {driverPhoto ? (
                    <Image source={{ uri: driverPhoto }} style={styles.driverPhoto} />
                  ) : (
                    <View style={[styles.driverPhoto, styles.driverPhotoFallback, { backgroundColor: Colors.accent }]}>
                      <Text style={[styles.driverInitial, { color: Colors.background }]}>
                        {driverName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.driverName, { color: Colors.text }]} numberOfLines={1}>
                      {driverName}
                    </Text>
                    <View style={styles.ratingRow}>
                      <Star color={Colors.warning} size={14} fill={Colors.warning} />
                      <Text style={[styles.ratingText, { color: Colors.text }]}>{driverRating}</Text>
                      <Text style={[styles.dotSep, { color: Colors.textSecondary }]}>•</Text>
                      <Car color={Colors.textSecondary} size={14} />
                      <Text style={[styles.vehicleText, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {driverVehicle}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.plateChip, { backgroundColor: Colors.text }]}>
                    <Text style={[styles.plateText, { color: Colors.background }]}>{plateNo}</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleCall}
                    style={[styles.actionBtn, { backgroundColor: Colors.accent }]}
                  >
                    <Phone color={Colors.onAccent} size={18} />
                    <Text style={[styles.actionText, { color: Colors.onAccent }]}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleMessage}
                    style={[styles.actionBtn, { backgroundColor: Colors.gray[200] }]}
                  >
                    <MessageCircle color={Colors.text} size={18} />
                    <Text style={[styles.actionText, { color: Colors.text }]}>Message</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Trip route */}
              <View style={[styles.tripCard, { backgroundColor: Colors.gray[50], borderColor: Colors.gray[200] }]}>
                <View style={styles.locRow}>
                  <View style={styles.locIconCol}>
                    <View style={[styles.originDot, { backgroundColor: Colors.success ?? Colors.accent }]} />
                    <View style={[styles.connector, { backgroundColor: Colors.gray[300] }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.locLabel, { color: Colors.textSecondary }]}>Pickup</Text>
                    <Text style={[styles.locValue, { color: Colors.text }]} numberOfLines={1}>{pickup}</Text>
                  </View>
                </View>
                <View style={styles.locRow}>
                  <View style={styles.locIconCol}>
                    <MapPin color={Colors.accent} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.locLabel, { color: Colors.textSecondary }]}>Dropoff</Text>
                    <Text style={[styles.locValue, { color: Colors.text }]} numberOfLines={1}>{destination}</Text>
                  </View>
                </View>
                <View style={[styles.fareRow, { borderTopColor: Colors.gray[200] }]}>
                  <Text style={[styles.fareLabel, { color: Colors.textSecondary }]}>Total fare · Cash</Text>
                  <Text style={[styles.fareValue, { color: Colors.text }]}>{priceDisplay}</Text>
                </View>
                {useCoinsParam && (
                  <View style={styles.coinNoteRow}>
                    <Coins color="#B45309" size={13} />
                    <Text style={[styles.coinNoteText, { color: Colors.textSecondary }]}>
                      GET.coin will be applied at drop-off
                    </Text>
                  </View>
                )}
              </View>

              {/* Secondary actions */}
              <View style={styles.secondaryRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[styles.secondaryBtn, { borderColor: Colors.gray[200] }]}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                    Linking.openURL("sms:?body=Track my ride").catch(() => {});
                  }}
                >
                  <Share2 color={Colors.text} size={16} />
                  <Text style={[styles.secondaryText, { color: Colors.text }]}>Share trip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[styles.secondaryBtn, { borderColor: Colors.gray[200] }]}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                  }}
                >
                  <Shield color={Colors.text} size={16} />
                  <Text style={[styles.secondaryText, { color: Colors.text }]}>Safety</Text>
                </TouchableOpacity>
              </View>

              {phase === "arriving" && (
                <TouchableOpacity activeOpacity={0.8} style={styles.cancelLink} onPress={openCancel}>
                  <Text style={[styles.cancelLinkText, { color: Colors.error }]}>Cancel ride</Text>
                </TouchableOpacity>
              )}

              {phase === "onTrip" && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={[styles.sosBtn, { backgroundColor: Colors.error }]}
                  onPress={handleSos}
                >
                  <ShieldAlert color="#FFFFFF" size={20} />
                  <Text style={styles.sosText}>SOS · Emergency</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              {/* Completed summary */}
              <View style={[styles.tripCard, { backgroundColor: Colors.gray[50], borderColor: Colors.gray[200] }]}>
                <View style={styles.completedDriver}>
                  {driverPhoto ? (
                    <Image source={{ uri: driverPhoto }} style={styles.completedPhoto} />
                  ) : (
                    <View style={[styles.completedPhoto, styles.driverPhotoFallback, { backgroundColor: Colors.accent }]}>
                      <Text style={[styles.driverInitial, { color: Colors.background }]}>
                        {driverName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.driverName, { color: Colors.text }]}>{driverName}</Text>
                    <Text style={[styles.vehicleText, { color: Colors.textSecondary }]}>
                      {driverVehicle} · {plateNo}
                    </Text>
                  </View>
                  <View style={styles.completedFareCol}>
                    <Text style={[styles.completedFare, { color: Colors.text }]}>{priceDisplay}</Text>
                    {coinRedeemInfo && (
                      <Text style={styles.completedCoinText}>
                        −RM{coinRedeemInfo.coinValue.toFixed(2)} coins
                      </Text>
                    )}
                  </View>
                </View>
                {coinRedeemInfo && (
                  <View style={[styles.completedCoinRow, { borderTopColor: Colors.gray[200] }]}>
                    <Coins color="#B45309" size={14} />
                    <Text style={[styles.coinNoteText, { color: Colors.textSecondary }]}>
                      {formatCoins(coinRedeemInfo.coinsUsed)} redeemed • pay RM
                      {Math.max(
                        parseFloat(priceParam.replace(/[^0-9.]/g, "")) - coinRedeemInfo.coinValue,
                        0
                      ).toFixed(2)}{" "}
                      in cash
                    </Text>
                  </View>
                )}
              </View>

              <Text style={[styles.rateTitle, { color: Colors.text }]}>Rate your trip</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <TouchableOpacity
                    key={s}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                    }}
                  >
                    <Star color={Colors.warning} size={36} fill={Colors.warning} />
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.replace("/" as any)}
                style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
              >
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Done</Text>
                <ChevronRight color={Colors.onAccent} size={20} />
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </Animated.View>

      {/* Cancel modal */}
      <Modal visible={showCancel} transparent animationType="none" onRequestClose={() => closeCancel()}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Animated.View
            style={[
              styles.cancelCard,
              {
                backgroundColor: Colors.background,
                opacity: cancelAnim,
                transform: [
                  { translateY: cancelAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) },
                  { scale: cancelAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              },
            ]}
          >
            <View style={[styles.warnWrap, { backgroundColor: Colors.error + "1A" }]}>
              <XCircle color={Colors.error} size={32} />
            </View>
            <Text style={[styles.cancelTitle, { color: Colors.text }]}>Cancel this ride?</Text>
            <Text style={[styles.cancelBody, { color: Colors.textSecondary }]}>
              {phase === "onTrip" && requestId
                ? "Your trip has already started, so the driver must approve the cancellation. Let us know why you’re cancelling."
                : "Your driver is already on the way. Let us know why you’re cancelling."}
            </Text>

            <View style={styles.cancelReasonList}>
              {[
                { id: "driver_too_long", label: "Driver taking too long" },
                { id: "driver_not_moving", label: "Driver isn’t moving" },
                { id: "changed_plans", label: "Changed my plans" },
                { id: "booked_by_mistake", label: "Booked by mistake" },
                { id: "driver_asked_cancel", label: "Driver asked me to cancel" },
                { id: "other", label: "Other" },
              ].map((opt) => {
                const isSelected = cancelReason === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    testID={`rider-cancel-reason-${opt.id}`}
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
                    <Text style={[styles.cancelReasonLabel, { color: Colors.text }]}>{opt.label}</Text>
                    <View
                      style={[
                        styles.cancelReasonRadio,
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
                  styles.cancelOtherWrap,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] },
                ]}
              >
                <TextInput
                  testID="rider-cancel-reason-other-input"
                  value={cancelOtherText}
                  onChangeText={setCancelOtherText}
                  placeholder="Type your reason"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.cancelOtherInput, { color: Colors.text }]}
                  autoFocus
                />
              </View>
            )}

            <View style={styles.cancelActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => closeCancel()}
                style={[styles.cancelGhost, { backgroundColor: Colors.gray[100] }]}
              >
                <Text style={[styles.cancelGhostText, { color: Colors.text }]}>Keep ride</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="rider-cancel-confirm"
                activeOpacity={0.85}
                onPress={confirmCancel}
                disabled={!cancelReason || (cancelReason === "other" && !cancelOtherText.trim())}
                style={[
                  styles.cancelConfirm,
                  {
                    backgroundColor:
                      !cancelReason || (cancelReason === "other" && !cancelOtherText.trim())
                        ? Colors.gray[300]
                        : Colors.error,
                  },
                ]}
              >
                <Text style={styles.cancelConfirmText}>
                  {phase === "onTrip" && requestId ? "Request cancel" : "Cancel ride"}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <AppAlertModal
        visible={showCancelDeclined}
        title="Cancellation declined"
        message="Your driver declined the cancellation request, so the ride will continue."
        onClose={() => setShowCancelDeclined(false)}
      />
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 10,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    flex: 1,
    marginRight: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusPillText: { fontSize: 14, fontWeight: "600", flex: 1 },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },

  mapTypeBtn: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  etaChipWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9,
  },
  etaChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingRight: 14,
    paddingLeft: 4,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 5,
  },
  etaChipBadge: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  etaChipBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800" as const,
  },
  etaChipText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },

  recenterBtn: {
    position: "absolute",
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 10,
  },

  pickupMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  pickupDot: { width: 6, height: 6, borderRadius: 3 },
  destPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  carWrap: { width: 56, height: 56, justifyContent: "center", alignItems: "center" },
  pulseRing: { position: "absolute", width: 28, height: 28, borderRadius: 14 },
  carDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    justifyContent: "center",
    alignItems: "center",
  },

  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: height * 0.72,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  handleWrap: { alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8 },

  statusHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  statusTitle: { fontSize: 20, fontWeight: "800", marginBottom: 2 },
  statusSub: { fontSize: 14, fontWeight: "500" },
  otpBox: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  otpLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 1 },
  otpValue: { fontSize: 20, fontWeight: "800", letterSpacing: 2 },
  doneIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: "center", alignItems: "center" },

  driverCard: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12 },
  driverRow: { flexDirection: "row", alignItems: "center" },
  driverPhoto: { width: 52, height: 52, borderRadius: 26, marginRight: 12 },
  driverPhotoFallback: { justifyContent: "center", alignItems: "center" },
  driverInitial: { fontSize: 22, fontWeight: "800" },
  driverName: { fontSize: 16, fontWeight: "700", marginBottom: 3 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, fontWeight: "700" },
  dotSep: { fontSize: 13, marginHorizontal: 2 },
  vehicleText: { fontSize: 13, flexShrink: 1 },
  plateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  plateText: { fontSize: 13, fontWeight: "800", letterSpacing: 1 },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  actionText: { fontSize: 15, fontWeight: "700" },

  tripCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12 },
  locRow: { flexDirection: "row" },
  locIconCol: { width: 28, alignItems: "center", marginRight: 8 },
  originDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  connector: { width: 2, flex: 1, marginVertical: 4, minHeight: 18 },
  locLabel: { fontSize: 12, fontWeight: "500", marginBottom: 2 },
  locValue: { fontSize: 15, fontWeight: "600", marginBottom: 12 },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 2,
  },
  fareLabel: { fontSize: 13, fontWeight: "500" },
  fareValue: { fontSize: 18, fontWeight: "800" },

  secondaryRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryText: { fontSize: 14, fontWeight: "600" },

  cancelLink: { alignItems: "center", paddingVertical: 14 },
  cancelLinkText: { fontSize: 15, fontWeight: "700" },

  sosBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  sosText: { fontSize: 15, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.3 },

  completedDriver: { flexDirection: "row", alignItems: "center" },
  completedPhoto: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  completedFare: { fontSize: 18, fontWeight: "800" },
  completedFareCol: { alignItems: "flex-end" },
  completedCoinText: { fontSize: 12, fontWeight: "700", color: "#B45309", marginTop: 2 },
  completedCoinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
  },
  coinNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  coinNoteText: { fontSize: 12, flex: 1 },
  coinToast: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 60,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  coinToastBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  coinToastTextWrap: { flex: 1 },
  coinToastTitle: { fontSize: 14, fontWeight: "800" },
  coinToastSub: { fontSize: 12, marginTop: 1 },
  rateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: 8, marginBottom: 12 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 20 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 16,
    borderRadius: 16,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "800" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  cancelCard: { width: "100%", borderRadius: 24, padding: 24, alignItems: "center" },
  warnWrap: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center", marginBottom: 16 },
  cancelTitle: { fontSize: 19, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  cancelBody: { fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 22 },
  cancelReasonList: { width: "100%", gap: 8, marginBottom: 14 },
  cancelReasonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  cancelReasonLabel: { fontSize: 14, fontWeight: "600" },
  cancelReasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelOtherWrap: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 14,
  },
  cancelOtherInput: { fontSize: 14, paddingVertical: 12, paddingHorizontal: 14 },
  cancelActions: { flexDirection: "row", gap: 12, width: "100%" },
  cancelGhost: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  cancelGhostText: { fontSize: 15, fontWeight: "700" },
  cancelConfirm: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  cancelConfirmText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
