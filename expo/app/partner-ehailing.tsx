import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Platform,
  Modal,
  Easing,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Menu,
  Smartphone,
  Power,
  MapPin,
  Navigation,
  Wallet,
  Route as RouteIcon,
  Timer,
  User,
  Star,
  X,
  Check,
  Zap,
  Minus,
  Plus,
  Tag,
  Clock,
  Wifi,
  WifiOff,
  Hexagon,
  TrafficCone,
  CreditCard,
  Banknote,
  Wallet as WalletIcon,
  Users,
  Briefcase,
  CheckCheck,
  Target,
  Trash2,
  Search,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaView } from "react-native-safe-area-context";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { POPULAR_LOCATIONS } from "@/constants/mockLocations";
import PartnerModeSelectModal, { type PartnerModeOption } from "@/components/PartnerModeSelectModal";
import { loadAssignedPartnerModeOptions } from "@/utils/partnerModeOptions";
import { checkPartnerModeDocuments, summarizeDocIssues } from "@/utils/partnerModeDocCheck";
import { Alert } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminData } from "@/contexts/AdminDataContext";
import { fetchWalletBalances } from "@/utils/walletStore";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { useIpAccess } from "@/contexts/IpAccessContext";
import {
  fetchOpenRequests,
  subscribeToOpenRequests,
  acceptRideRequest,
  submitRideOffer,
  fetchRideRequest,
  type RideRequest as DbRideRequest,
} from "@/utils/rideRequestsStore";
import { buildPartnerRestoreTarget } from "@/utils/ongoingRequestRestore";
import PartnerSideSheet from "@/components/PartnerSideSheet";
import WebMap from "@/components/WebMap";
import HeatmapOverlay from "@/components/HeatmapOverlay";
import { runWithMappingRotation } from "@/utils/mappingClient";
import { PlaceGatesList } from "@/components/PlaceGates";
import { useAirportAreas, applyAirportAreaFilter, AirportArea } from "@/utils/airportAreas";

let MapView: any = null;
if (Platform.OS !== "web") {
  const Maps = require("react-native-maps");
  MapView = Maps.default;
}

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type RideRequest = {
  id: string;
  passengerName: string;
  passengerRating: number;
  pickupName: string;
  pickupAddress: string;
  dropName: string;
  dropAddress: string;
  distanceKm: number;
  durationMin: number;
  fare: number;
  distanceToPickupKm: number;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  paymentMode: "Cash" | "Card" | "E-Wallet" | "Get Pay";
  passengers: number;
  luggage: number;
  offerMe: boolean;
  /** Set when this card is backed by a real Supabase ride_requests row. */
  dbId?: string;
  riderId?: string;
};

const PASSENGER_NAMES = [
  "Ahmad R.",
  "Siti N.",
  "Wei Ming",
  "Priya S.",
  "Daniel L.",
  "Aisha K.",
  "Hafiz B.",
  "Mei Ling",
];

const REQUEST_TIMEOUT_SECONDS = 35;

function generateRandomRequest(driverLat: number, driverLng: number): RideRequest {
  const pickup = POPULAR_LOCATIONS[Math.floor(Math.random() * POPULAR_LOCATIONS.length)];
  let drop = POPULAR_LOCATIONS[Math.floor(Math.random() * POPULAR_LOCATIONS.length)];
  let safety = 0;
  while (drop.id === pickup.id && safety < 5) {
    drop = POPULAR_LOCATIONS[Math.floor(Math.random() * POPULAR_LOCATIONS.length)];
    safety += 1;
  }
  const dx = (drop.latitude - pickup.latitude) * 111;
  const dy = (drop.longitude - pickup.longitude) * 111 * Math.cos((pickup.latitude * Math.PI) / 180);
  const distanceKm = Math.max(1.2, Math.sqrt(dx * dx + dy * dy));
  const durationMin = Math.max(5, Math.round(distanceKm * 2.6));
  const fare = Math.max(6, Math.round(3 + distanceKm * 1.5 + durationMin * 0.2));
  const pdx = (pickup.latitude - driverLat) * 111;
  const pdy = (pickup.longitude - driverLng) * 111 * Math.cos((driverLat * Math.PI) / 180);
  const distanceToPickupKm = Math.max(0.4, Math.sqrt(pdx * pdx + pdy * pdy));
  const name = PASSENGER_NAMES[Math.floor(Math.random() * PASSENGER_NAMES.length)];
  const rating = Math.round((4.4 + Math.random() * 0.6) * 10) / 10;
  const paymentModes: RideRequest["paymentMode"][] = ["Cash", "Card", "E-Wallet", "Get Pay"];
  const paymentMode = paymentModes[Math.floor(Math.random() * paymentModes.length)];
  const passengers = 1 + Math.floor(Math.random() * 4);
  const luggage = Math.floor(Math.random() * 4);
  // Incoming offers default to OfferMe (Bidding) unless explicitly disabled.
  const offerMe = true;
  return {
    id: `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    passengerName: name,
    passengerRating: rating,
    pickupName: pickup.name,
    pickupAddress: pickup.address,
    dropName: drop.name,
    dropAddress: drop.address,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin,
    fare,
    distanceToPickupKm: Math.round(distanceToPickupKm * 10) / 10,
    pickupLat: pickup.latitude,
    pickupLng: pickup.longitude,
    dropLat: drop.latitude,
    dropLng: drop.longitude,
    paymentMode,
    passengers,
    luggage,
    offerMe,
  };
}

export default function DriverEhailingScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ resumeRequestId?: string }>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<any>(null);
  const { location: currentLocation, refreshLocation } = useLocation();
  const Colors = useColors();
  const isLightMode = Colors.background === "#FFFFFF";

  const driverLat = currentLocation?.coords?.latitude ?? 3.139;
  const driverLng = currentLocation?.coords?.longitude ?? 101.6869;

  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [driverModeVisible, setDriverModeVisible] = useState<boolean>(false);
  const [partnerModeOptions, setPartnerModeOptions] = useState<PartnerModeOption[]>([]);
  const { authState } = useAuth();
  const { getEntries } = useAdminData();
  const { settings: displaySettings } = useDisplaySettings();
  const { isBlacklisted } = useIpAccess();
  const partnerMockEnabledRef = useRef<boolean>(true);
  const openPartnerModeSelector = React.useCallback(async () => {
    const opts = await loadAssignedPartnerModeOptions(authState.userId, getEntries);
    setPartnerModeOptions(opts);
    setDriverModeVisible(true);
  }, [authState.userId, getEntries]);

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
          console.log("[partner-ehailing] wallet balance load failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [authState.userId])
  );
  const [sideSheetVisible, setSideSheetVisible] = useState<boolean>(false);
  const [request, setRequest] = useState<RideRequest | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(REQUEST_TIMEOUT_SECONDS);
  const [todayEarnings] = useState<number>(0);
  const [todayTrips] = useState<number>(0);
  const [heatmapVisible, setHeatmapVisible] = useState<boolean>(false);
  const [trafficVisible, setTrafficVisible] = useState<boolean>(false);
  const [allowOfferMe, setAllowOfferMe] = useState<boolean>(true);
  const allowOfferMeRef = useRef<boolean>(true);
  const [autoAccept, setAutoAccept] = useState<boolean>(false);
  const autoAcceptRef = useRef<boolean>(false);
  const [destinationsVisible, setDestinationsVisible] = useState<boolean>(false);
  const [savedDestinations, setSavedDestinations] = useState<{ id: string; name: string; address: string; latitude: number; longitude: number }[]>([]);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(null);
  const [destinationEnabled, setDestinationEnabled] = useState<boolean>(false);
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  type EhailingSearchItem = { id: string; name: string; address: string; latitude: number; longitude: number };
  const [searchResults, setSearchResults] = useState<EhailingSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [offerVisible, setOfferVisible] = useState<boolean>(false);
  const [offerAmount, setOfferAmount] = useState<number>(0);
  const [offerPendingVisible, setOfferPendingVisible] = useState<boolean>(false);
  const [offerPendingSeconds, setOfferPendingSeconds] = useState<number>(45);
  const [pendingOfferAmount, setPendingOfferAmount] = useState<number>(0);
  // Tracks the request a pending counter-offer belongs to, so realtime updates
  // (e.g. the passenger raising their fare) can re-surface that exact request.
  const pendingOfferReqRef = useRef<RideRequest | null>(null);
  // Tracks the real (Supabase-backed) request this partner is currently engaged
  // with — whether it's shown as a card, sitting behind a pending counter-offer,
  // or recently expired. Lets passenger fare raises reach the partner even after
  // the original popup has closed. Holds the latest mapped request.
  const engagedReqRef = useRef<RideRequest | null>(null);
  // Highest passenger fare already surfaced per request id, so repeated realtime
  // UPDATE events for the same raise don't re-trigger over and over.
  const raisedFareSeenRef = useRef<Map<string, number>>(new Map());
  const offerVisibleRef = useRef<boolean>(false);
  const offerPendingTick = useRef<ReturnType<typeof setInterval> | null>(null);
  const offerPendingAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    offerVisibleRef.current = offerVisible;
  }, [offerVisible]);

  // Resume an ongoing trip after an app restart: when the home screen detects
  // this partner still has an accepted/arrived/on_trip ride, it lands here with
  // `resumeRequestId`. Verify the ride is still ongoing and belongs to this
  // partner, then push ride-running on top so back returns to this screen.
  const resumeHandledRef = useRef<boolean>(false);
  useEffect(() => {
    const resumeId =
      typeof searchParams.resumeRequestId === "string" && searchParams.resumeRequestId.length > 0
        ? searchParams.resumeRequestId
        : null;
    if (!resumeId || resumeHandledRef.current) return;
    if (!authState.userId) return;
    resumeHandledRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchRideRequest(resumeId);
        if (cancelled || !row) return;
        if (row.partner_id !== authState.userId) {
          console.log("[partner-ehailing] resume skipped - ride belongs to another partner", resumeId);
          return;
        }
        const target = buildPartnerRestoreTarget(row);
        if (!target) {
          console.log("[partner-ehailing] resume skipped - ride no longer ongoing", resumeId, row.status);
          return;
        }
        console.log("[partner-ehailing] resuming ongoing ride", row.id, row.status);
        router.push(target as any);
      } catch (e) {
        console.log("[partner-ehailing] resume ongoing failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams.resumeRequestId, authState.userId, router]);

  useEffect(() => {
    if (!heatmapVisible) return;
    console.log("[partner-ehailing] heatmap location refresh started (15s)");
    const id = setInterval(() => {
      void refreshLocation();
    }, 15000);
    return () => {
      clearInterval(id);
      console.log("[partner-ehailing] heatmap location refresh stopped");
    };
  }, [heatmapVisible, refreshLocation]);

  const region = useMemo<Region>(() => ({
    latitude: driverLat,
    longitude: driverLng,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  }), [driverLat, driverLng]);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;
  const [bottomSheetHeight, setBottomSheetHeight] = useState<number>(0);
  const requestAnim = useRef(new Animated.Value(0)).current;
  const timerAnim = useRef(new Animated.Value(1)).current;
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const recenterMap = React.useCallback(() => {
    mapRef.current?.animateCamera?.({ center: { latitude: driverLat, longitude: driverLng } }, { duration: 500 });
    mapRef.current?.animateToRegion?.(region, 500);
  }, [driverLat, driverLng, region]);

  useEffect(() => {
    const t = setTimeout(() => {
      recenterMap();
    }, 600);
    return () => clearTimeout(t);
  }, [recenterMap]);

  useEffect(() => {
    if (!isOnline) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isOnline, pulseAnim]);

  const clearRequestTimers = () => {
    if (requestTimer.current) {
      clearTimeout(requestTimer.current);
      requestTimer.current = null;
    }
    if (tickInterval.current) {
      clearInterval(tickInterval.current);
      tickInterval.current = null;
    }
  };

  const closeRequest = (animated: boolean = true) => {
    clearRequestTimers();
    if (animated) {
      Animated.timing(requestAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setRequest(null);
      });
    } else {
      requestAnim.setValue(0);
      setRequest(null);
    }
  };

  const scheduleNextRequest = () => {
    if (!isOnline) return;
    if (!partnerMockEnabledRef.current) return;
    const delay = 6000 + Math.floor(Math.random() * 8000);
    console.log("[partner-ehailing] scheduling next request in", delay, "ms");
    requestTimer.current = setTimeout(() => {
      let req = generateRandomRequest(driverLat, driverLng);
      if (!allowOfferMeRef.current && req.offerMe) {
        req = { ...req, offerMe: false };
      }
      console.log("[partner-ehailing] incoming request:", req.id, req.passengerName);
      if (autoAcceptRef.current) {
        console.log("[partner-ehailing] auto-accepting request", req.id);
        acceptRequest(req);
        return;
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
      setRequest(req);
      const allowed = 30 + Math.floor(Math.random() * 16);
      setSecondsLeft(allowed);
      timerAnim.setValue(1);
      Animated.spring(requestAnim, {
        toValue: 1,
        tension: 60,
        friction: 11,
        useNativeDriver: true,
      }).start();
      Animated.timing(timerAnim, {
        toValue: 0,
        duration: allowed * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
      if (tickInterval.current) clearInterval(tickInterval.current);
      tickInterval.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            console.log("[partner-ehailing] request timed out");
            if (tickInterval.current) {
              clearInterval(tickInterval.current);
              tickInterval.current = null;
            }
            handleRequestTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, delay);
  };

  const handleRequestTimeout = () => {
    closeRequest(true);
    setTimeout(() => {
      scheduleNextRequest();
    }, 400);
  };

  useEffect(() => {
    if (isOnline && !request) {
      scheduleNextRequest();
    }
    if (!isOnline) {
      clearRequestTimers();
      closeRequest(false);
    }
    return () => {
      clearRequestTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    allowOfferMeRef.current = allowOfferMe;
  }, [allowOfferMe]);

  useEffect(() => {
    partnerMockEnabledRef.current = displaySettings.partnerMockEnabled;
    if (!displaySettings.partnerMockEnabled) {
      clearRequestTimers();
      closeRequest(false);
    } else if (isOnline && !request) {
      scheduleNextRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySettings.partnerMockEnabled]);

  useEffect(() => {
    autoAcceptRef.current = autoAccept;
  }, [autoAccept]);

  useEffect(() => {
    (async () => {
      try {
        // Migrate legacy @ehailing/* keys to @partner-ehailing/* (one-time)
        const legacyKeys = [
          ["@ehailing/destinations", "@partner-ehailing/destinations"],
          ["@ehailing/activeDestination", "@partner-ehailing/activeDestination"],
          ["@ehailing/destinationEnabled", "@partner-ehailing/destinationEnabled"],
        ] as const;
        for (const [oldKey, newKey] of legacyKeys) {
          try {
            const existsNew = await AsyncStorage.getItem(newKey);
            if (existsNew !== null) continue;
            const oldVal = await AsyncStorage.getItem(oldKey);
            if (oldVal !== null) {
              await AsyncStorage.setItem(newKey, oldVal);
              await AsyncStorage.removeItem(oldKey);
            }
          } catch {}
        }
        const raw = await AsyncStorage.getItem("@partner-ehailing/destinations");
        const activeRaw = await AsyncStorage.getItem("@partner-ehailing/activeDestination");
        const enabledRaw = await AsyncStorage.getItem("@partner-ehailing/destinationEnabled");
        if (raw) {
          const parsed = JSON.parse(raw) as typeof savedDestinations;
          if (Array.isArray(parsed)) setSavedDestinations(parsed.slice(0, 3));
        }
        if (activeRaw) setActiveDestinationId(activeRaw);
        if (enabledRaw === "1") setDestinationEnabled(true);
      } catch (e) {
        console.log("[partner-ehailing] failed to load destinations", e);
      }
    })();
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`;
        const data = (await runWithMappingRotation<any>(
          "partner-ehailing",
          "geocoding",
          async (ctx) => {
            const headers: Record<string, string> = { "Accept": "application/json", "Accept-Language": "en" };
            // Some providers (Google, LocationIQ etc.) require keys appended,
            // but Nominatim works keyless. Append key only when present.
            const finalUrl = ctx.key ? `${url}&key=${ctx.key}` : url;
            const r = await fetch(finalUrl, { headers });
            const j = await r.json();
            return { ok: r.ok && Array.isArray(j), value: j };
          },
          async () => {
            const r = await fetch(url, { headers: { "Accept": "application/json", "Accept-Language": "en" } });
            return r.json();
          }
        )) as Array<{
          place_id: number;
          display_name: string;
          lat: string;
          lon: string;
          name?: string;
          address?: { [k: string]: string };
        }>;
        if (cancelled) return;
        const mapped = (Array.isArray(data) ? data : []).map((d) => {
          const addr = d.address ?? {};
          const primary =
            d.name ||
            addr.attraction ||
            addr.building ||
            addr.amenity ||
            addr.shop ||
            addr.tourism ||
            addr.road ||
            addr.suburb ||
            addr.city ||
            d.display_name.split(",")[0];
          return {
            id: `osm-${d.place_id}`,
            name: primary,
            address: d.display_name,
            latitude: parseFloat(d.lat),
            longitude: parseFloat(d.lon),
          };
        });
        setSearchResults(mapped);
      } catch (e) {
        if (!cancelled) {
          console.log("[partner-ehailing] place search failed", e);
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const airportAreas = useAirportAreas();
  const buildAirportSearchItem = (area: AirportArea): EhailingSearchItem => ({
    id: `airport-${area.entry.id}`,
    name: area.name,
    address: area.code ? `${area.code} · Airport` : "Airport",
    latitude: area.centroid.latitude,
    longitude: area.centroid.longitude,
  });
  const visibleSearchResults = applyAirportAreaFilter(
    searchResults,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportSearchItem,
    undefined,
    (it) => `${it.name ?? ""} ${it.address ?? ""}`,
  );

  const persistDestinations = async (list: typeof savedDestinations) => {
    try {
      await AsyncStorage.setItem("@partner-ehailing/destinations", JSON.stringify(list));
    } catch (e) {
      console.log("[partner-ehailing] failed to persist destinations", e);
    }
  };

  const persistActiveDestination = async (id: string | null) => {
    try {
      if (id) await AsyncStorage.setItem("@partner-ehailing/activeDestination", id);
      else await AsyncStorage.removeItem("@partner-ehailing/activeDestination");
    } catch (e) {
      console.log("[partner-ehailing] failed to persist active destination", e);
    }
  };

  const handleToggleDestinationEnabled = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setDestinationEnabled((v) => {
      const next = !v;
      AsyncStorage.setItem("@partner-ehailing/destinationEnabled", next ? "1" : "0").catch(() => {});
      console.log("[partner-ehailing] destination feature", next ? "ON" : "OFF");
      return next;
    });
  };

  const handleSelectActiveDestination = (id: string) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    const next = activeDestinationId === id ? null : id;
    setActiveDestinationId(next);
    void persistActiveDestination(next);
    console.log("[partner-ehailing] active destination", next);
  };

  const handleAddDestination = (loc: { id: string; name: string; address: string; latitude: number; longitude: number }) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setSavedDestinations((prev) => {
      if (prev.find((p) => p.id === loc.id)) return prev;
      const next = [loc, ...prev].slice(0, 3);
      void persistDestinations(next);
      return next;
    });
    setPickerVisible(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleRemoveDestination = (id: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setSavedDestinations((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void persistDestinations(next);
      return next;
    });
    if (activeDestinationId === id) {
      setActiveDestinationId(null);
      void persistActiveDestination(null);
    }
  };

  const handleToggleAutoAccept = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setAutoAccept((v) => {
      console.log("[partner-ehailing] auto-accept", !v ? "ON" : "OFF");
      return !v;
    });
  };

  const handleToggleAllowOfferMe = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setAllowOfferMe((v) => {
      console.log("[partner-ehailing] allow OfferMe", !v ? "ON" : "OFF");
      return !v;
    });
  };

  const handleToggleOnline = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setIsOnline((v) => {
      const next = !v;
      console.log("[partner-ehailing] driver is now", next ? "ONLINE" : "OFFLINE");
      return next;
    });
  };

  const acceptRequest = async (accepted: RideRequest) => {
    console.log("[partner-ehailing] accepted request", accepted.id);
    // Blacklisted partners cannot accept rides.
    if (isBlacklisted) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      Alert.alert(
        "Service Not Available",
        "Your device has been blocked and cannot accept ride requests. Please contact support."
      );
      return;
    }
    // Real request: claim it atomically. If another partner already took it,
    // bail out gracefully instead of starting a trip on a taken request.
    if (accepted.dbId) {
      const claimed = await acceptRideRequest(accepted.dbId, {
        partnerId: authState.userId ?? null,
        partnerName: authState.profileName ?? "Driver",
        partnerPhone: authState.phoneNumber ?? null,
        partnerPhoto: authState.profileAvatar ?? null,
        partnerRating: 4.9,
        acceptLat: driverLat,
        acceptLng: driverLng,
      });
      if (!claimed) {
        console.log("[partner-ehailing] request already taken", accepted.dbId);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        engagedReqRef.current = null;
        closeRequest(true);
        Alert.alert("Request taken", "Another driver accepted this ride first.");
        return;
      }
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    closeRequest(false);
    router.push({
      pathname: "/ride-running" as any,
      params: {
        driverMode: "eHailing",
        ...(accepted.dbId ? { requestId: accepted.dbId } : {}),
        dropName: accepted.dropName,
        dropLat: accepted.dropLat.toString(),
        dropLng: accepted.dropLng.toString(),
        pickupLat: accepted.pickupLat.toString(),
        pickupLng: accepted.pickupLng.toString(),
        pickupName: accepted.pickupName,
        pickupAddress: accepted.pickupAddress,
        fare: String(accepted.fare),
        distance: accepted.distanceKm.toFixed(1),
        eta: String(accepted.durationMin),
        passengerName: accepted.passengerName,
        driverLat: driverLat.toString(),
        driverLng: driverLng.toString(),
        distanceToPickup: accepted.distanceToPickupKm.toFixed(1),
        initialPhase: "toPickup",
      },
    });
  };

  // Keep a ref of the currently displayed request so realtime callbacks (which
  // capture a stale `request`) can read the latest value.
  const currentRequestRef = useRef<RideRequest | null>(null);
  useEffect(() => {
    currentRequestRef.current = request;
  }, [request]);

  /** Maps a Supabase ride_requests row into the local request card shape. */
  const mapDbToLocal = React.useCallback(
    (row: DbRideRequest): RideRequest => {
      const pLat = row.pickup_lat ?? driverLat;
      const pLng = row.pickup_lng ?? driverLng;
      const pdx = (pLat - driverLat) * 111;
      const pdy = (pLng - driverLng) * 111 * Math.cos((driverLat * Math.PI) / 180);
      const distanceToPickupKm = Math.max(0.4, Math.sqrt(pdx * pdx + pdy * pdy));
      const pm: RideRequest["paymentMode"] =
        row.payment_mode === "Card" ||
        row.payment_mode === "E-Wallet" ||
        row.payment_mode === "Get Pay"
          ? row.payment_mode
          : "Cash";
      return {
        id: row.id,
        dbId: row.id,
        riderId: row.rider_id ?? undefined,
        passengerName: row.rider_name ?? "Passenger",
        passengerRating: row.rider_rating ?? 5,
        pickupName: row.pickup_name ?? "Pickup",
        pickupAddress: row.pickup_address ?? "",
        dropName: row.drop_name ?? "Destination",
        dropAddress: row.drop_address ?? "",
        distanceKm: row.distance_km ?? 1,
        durationMin: row.duration_min ?? 5,
        fare: row.fare ?? 0,
        distanceToPickupKm: Math.round(distanceToPickupKm * 10) / 10,
        pickupLat: pLat,
        pickupLng: pLng,
        dropLat: row.drop_lat ?? driverLat,
        dropLng: row.drop_lng ?? driverLng,
        paymentMode: pm,
        passengers: row.passengers ?? 1,
        luggage: row.luggage ?? 0,
        // Default to OfferMe (Bidding) unless the row explicitly opts out
        // or the partner has turned off Allow OfferMe requests.
        offerMe: allowOfferMeRef.current ? row.offer_me !== false : false,
      };
    },
    [driverLat, driverLng]
  );

  /** Presents a real incoming request using the same card animation as mocks. */
  const showRealRequest = (req: RideRequest, opts?: { force?: boolean }) => {
    if (currentRequestRef.current && !opts?.force) return;
    if (autoAcceptRef.current) {
      void acceptRequest(req);
      return;
    }
    if (req.dbId) {
      engagedReqRef.current = req;
      raisedFareSeenRef.current.set(req.dbId, req.fare);
    }
    currentRequestRef.current = req;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    setRequest(req);
    const allowed = REQUEST_TIMEOUT_SECONDS;
    setSecondsLeft(allowed);
    timerAnim.setValue(1);
    Animated.spring(requestAnim, {
      toValue: 1,
      tension: 60,
      friction: 11,
      useNativeDriver: true,
    }).start();
    Animated.timing(timerAnim, {
      toValue: 0,
      duration: allowed * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    if (tickInterval.current) clearInterval(tickInterval.current);
    tickInterval.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (tickInterval.current) {
            clearInterval(tickInterval.current);
            tickInterval.current = null;
          }
          closeRequest(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Subscribe to REAL passenger requests while online. New open requests are
  // shown as incoming cards; ones taken/cancelled by others are dismissed.
  useEffect(() => {
    if (!isOnline) return;
    let active = true;
    void fetchOpenRequests().then((rows) => {
      if (!active) return;
      const first = rows[0];
      if (first && !currentRequestRef.current) {
        showRealRequest(mapDbToLocal(first));
      }
    });
    const unsub = subscribeToOpenRequests((row, event) => {
      if (event === "INSERT" && row.status === "open") {
        if (!currentRequestRef.current) showRealRequest(mapDbToLocal(row));
      } else if (event === "UPDATE") {
        if (row.status !== "open") {
          const cur = currentRequestRef.current;
          if (cur?.dbId === row.id) closeRequest(true);
          const pending = pendingOfferReqRef.current;
          if (pending?.dbId === row.id) dismissPendingForRaise();
          if (engagedReqRef.current?.dbId === row.id) engagedReqRef.current = null;
          raisedFareSeenRef.current.delete(row.id);
          return;
        }
        // Passenger raised their fare on a request this partner is engaged with.
        // Detect a genuine increase (deduped across repeated realtime events)
        // and surface it — in place if a card is up, or as a fresh card if the
        // previous popup already closed.
        const engaged = engagedReqRef.current;
        if (engaged?.dbId === row.id && row.offered_fare == null) {
          const newFare = row.fare ?? 0;
          const lastSeen = raisedFareSeenRef.current.get(row.id) ?? engaged.fare;
          if (newFare > lastSeen) {
            raisedFareSeenRef.current.set(row.id, newFare);
            presentRaisedFare(mapDbToLocal(row));
          }
        }
      }
    });
    return () => {
      active = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const handleAccept = () => {
    if (!request) return;
    void acceptRequest(request);
  };

  const handleDecline = () => {
    if (!request) return;
    console.log("[partner-ehailing] declined request", request.id);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    // Keep the partner engaged with this request after declining so a later
    // passenger fare raise re-surfaces it. Baseline the seen fare at the current
    // amount so only a genuine increase pops the card back up.
    if (request.dbId) {
      engagedReqRef.current = request;
      raisedFareSeenRef.current.set(request.dbId, request.fare);
    }
    closeRequest(true);
    setTimeout(() => {
      scheduleNextRequest();
    }, 400);
  };

  const handleOpenOffer = () => {
    if (!request) return;
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setOfferAmount(request.fare);
    setOfferVisible(true);
  };

  const clearOfferPendingTimer = () => {
    if (offerPendingTick.current) {
      clearInterval(offerPendingTick.current);
      offerPendingTick.current = null;
    }
    offerPendingAnim.stopAnimation();
  };

  const startOfferPending = (sentAmount: number) => {
    if (!request) return;
    setPendingOfferAmount(sentAmount);
    pendingOfferReqRef.current = request;
    setOfferVisible(false);
    closeRequest(false);
    setOfferPendingSeconds(45);
    offerPendingAnim.setValue(1);
    setOfferPendingVisible(true);
    Animated.timing(offerPendingAnim, {
      toValue: 0,
      duration: 45000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    if (offerPendingTick.current) clearInterval(offerPendingTick.current);
    offerPendingTick.current = setInterval(() => {
      setOfferPendingSeconds((prev) => {
        if (prev <= 1) {
          if (offerPendingTick.current) {
            clearInterval(offerPendingTick.current);
            offerPendingTick.current = null;
          }
          handleOfferPendingExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /** Records the partner's fare offer on a real (Supabase-backed) request. */
  const persistOffer = (req: RideRequest, amount: number) => {
    if (!req.dbId) return;
    void submitRideOffer(
      req.dbId,
      { offeredFare: amount },
      {
        partnerId: authState.userId ?? null,
        partnerName: authState.profileName ?? "Driver",
        partnerPhone: authState.phoneNumber ?? null,
        partnerPhoto: authState.profileAvatar ?? null,
        partnerRating: 4.9,
        acceptLat: driverLat,
        acceptLng: driverLng,
      }
    );
  };

  const handleSubmitOffer = () => {
    if (!request) return;
    console.log("[partner-ehailing] sent counter offer", request.id, "RM", offerAmount);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    persistOffer(request, offerAmount);
    startOfferPending(offerAmount);
  };

  const handleQuickOffer = (percent: number) => {
    if (!request) return;
    const amount = Math.round(request.fare * (1 + percent / 100));
    console.log("[partner-ehailing] quick offer", request.id, `+${percent}%`, "RM", amount);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    persistOffer(request, amount);
    startOfferPending(amount);
  };

  /**
   * Tears down the pending-offer popup because the passenger raised their fare
   * (or the request closed). Does NOT schedule a mock next request — the caller
   * re-surfaces the same real request instead.
   */
  const dismissPendingForRaise = () => {
    clearOfferPendingTimer();
    setOfferPendingVisible(false);
    pendingOfferReqRef.current = null;
  };

  /**
   * Surfaces a passenger fare raise on a request this partner is engaged with.
   * Updates the live card in place when one is already showing, otherwise tears
   * down any pending-offer popup / mock card and re-opens a fresh card with the
   * raised amount.
   */
  const presentRaisedFare = (updated: RideRequest) => {
    engagedReqRef.current = updated;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    // A counter-offer is pending: drop it and re-surface so the partner can
    // re-offer or accept the higher fare.
    if (pendingOfferReqRef.current?.dbId === updated.dbId) {
      dismissPendingForRaise();
      closeRequest(false);
      showRealRequest(updated, { force: true });
      return;
    }
    // The card for this exact request is on screen: update its fare in place so
    // the partner immediately sees the new amount (and bump the offer sheet
    // baseline if they're mid-offer).
    if (currentRequestRef.current?.dbId === updated.dbId) {
      setRequest(updated);
      currentRequestRef.current = updated;
      if (offerVisibleRef.current) {
        setOfferAmount((prev) => (prev < updated.fare ? updated.fare : prev));
      }
      return;
    }
    // Nothing is showing for this request (the old popup already closed) —
    // re-open a fresh card with the raised amount.
    closeRequest(false);
    showRealRequest(updated, { force: true });
  };

  const handleOfferPendingExpired = () => {
    console.log("[partner-ehailing] offer expired - passenger did not accept");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    clearOfferPendingTimer();
    setOfferPendingVisible(false);
    // Offer lapsed but keep the partner engaged so a later passenger raise can
    // still re-surface this request. pendingOfferReqRef tracks the *visible*
    // pending popup, so clear it now that the popup is gone.
    pendingOfferReqRef.current = null;
    setTimeout(() => {
      scheduleNextRequest();
    }, 400);
  };

  const handleCancelPendingOffer = () => {
    console.log("[partner-ehailing] driver cancelled pending offer");
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    clearOfferPendingTimer();
    setOfferPendingVisible(false);
    const cancelled = pendingOfferReqRef.current;
    pendingOfferReqRef.current = null;
    // The partner backed out of this request entirely — stop tracking it so a
    // later raise won't drag them back in.
    if (cancelled?.dbId && engagedReqRef.current?.dbId === cancelled.dbId) {
      engagedReqRef.current = null;
      raisedFareSeenRef.current.delete(cancelled.dbId);
    }
    setTimeout(() => {
      scheduleNextRequest();
    }, 400);
  };

  const adjustOffer = (delta: number) => {
    if (!request) return;
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setOfferAmount((prev) => {
      const next = prev + delta;
      if (next < request.fare) return request.fare;
      return next;
    });
  };

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const timerWidth = timerAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  const statusColor = isOnline ? "#10B981" : "#EF4444";

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {Platform.OS !== "web" && MapView ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          showsTraffic={trafficVisible}
          userInterfaceStyle={isLightMode ? "light" : "dark"}
          mapPadding={{ top: 0, right: 0, left: 0, bottom: bottomSheetHeight + 30 }}
        >
          <HeatmapOverlay
            center={{ latitude: driverLat, longitude: driverLng }}
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
          accentColor={Colors.accent}
          userLocation={{ latitude: driverLat, longitude: driverLng }}
        />
      )}

      {/* Online pulse on the map center */}
      {isOnline && (
        <View style={[styles.pulseWrap, { pointerEvents: "none" }]}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                backgroundColor: statusColor,
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
              },
            ]}
          />
          <View style={[styles.pulseDot, { backgroundColor: statusColor }]} />
        </View>
      )}

      {/* Header */}
      <SafeAreaView style={[styles.headerSafe, { pointerEvents: "box-none" }]} edges={["top"]}>
        <View style={[styles.headerRow, { pointerEvents: "box-none" }]}>
          <TouchableOpacity
            style={[
              styles.iconButton,
              { backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)" },
            ]}
            onPress={() => setSideSheetVisible(true)}
            testID="partner-ehailing-menu"
          >
            <Menu color={isLightMode ? "#000" : "#fff"} size={22} />
          </TouchableOpacity>

          <View style={[styles.headerBadgeCenter, { pointerEvents: "box-none" }]}>
            <TouchableOpacity
              style={[styles.headerBadge, { backgroundColor: Colors.accent }]}
              onPress={openPartnerModeSelector}
              activeOpacity={0.8}
              testID="partner-ehailing-mode-switch"
            >
              <Smartphone color="#000000" size={16} />
              <Text style={styles.headerBadgeText}>eHAILING</Text>
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
              testID="partner-ehailing-wallet-credit"
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
              testID="partner-ehailing-wallet-cash"
            >
              <View style={styles.walletTopRow}>
                <View style={[styles.walletIconBubble, { backgroundColor: Colors.accent + "22" }]}>
                  <WalletIcon color={Colors.accent} size={12} />
                </View>
                <Text style={[styles.walletLabel, { color: Colors.subtext }]} numberOfLines={1}>GET.wallet</Text>
              </View>
              <Text style={[styles.walletValue, { color: Colors.text }]}>RM {walletBalance.toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Status pill */}
      <View
        style={[
          styles.statusPillWrap,
          { top: insets.top + 70 },
          { pointerEvents: "box-none" },
        ]}
      >
        <View
          style={[
            styles.statusPill,
            { backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.75)" },
          ]}
        >
          {isOnline ? (
            <Wifi color={statusColor} size={14} />
          ) : (
            <WifiOff color={statusColor} size={14} />
          )}
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusPillText, { color: Colors.text }]}>
            {isOnline ? "You're online" : "You're offline"}
          </Text>
        </View>
      </View>

      {/* My Destination button (above traffic) */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 178,
            backgroundColor: destinationEnabled
              ? Colors.accent
              : isLightMode
              ? "#fff"
              : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={() => {
          if (Platform.OS !== "web") {
            Haptics.selectionAsync().catch(() => {});
          }
          setDestinationsVisible(true);
        }}
        testID="partner-ehailing-mydestination"
      >
        <Target
          color={destinationEnabled ? "#fff" : isLightMode ? "#000" : "#fff"}
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
          if (Platform.OS !== "web") {
            Haptics.selectionAsync().catch(() => {});
          }
          setTrafficVisible((v) => {
            console.log("[partner-ehailing] traffic", !v ? "ON" : "OFF");
            return !v;
          });
        }}
        testID="partner-ehailing-traffic"
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
          if (Platform.OS !== "web") {
            Haptics.selectionAsync().catch(() => {});
          }
          setHeatmapVisible((v) => {
            console.log("[partner-ehailing] heatmap", !v ? "ON" : "OFF");
            return !v;
          });
        }}
        testID="partner-ehailing-heatmap"
      >
        <Hexagon
          color={heatmapVisible ? "#fff" : isLightMode ? "#000" : "#fff"}
          size={20}
        />
      </TouchableOpacity>

      {/* Recenter button */}
      <TouchableOpacity
        style={[
          styles.currentLocationButton,
          {
            bottom: bottomSheetHeight + 10,
            backgroundColor: isLightMode ? "#fff" : "rgba(0,0,0,0.7)",
          },
        ]}
        onPress={() => {
          recenterMap();
        }}
        testID="partner-ehailing-locate"
      >
        <Navigation color={isLightMode ? "#000" : "#fff"} size={20} />
      </TouchableOpacity>

      {/* Bottom sheet */}
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
            paddingBottom: insets.bottom + 20,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: Colors.border }]} />

        <View style={styles.sheetHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sheetTitle, { color: Colors.text }]}>
              {isOnline ? "Listening for request" : "Go online to earn"}
            </Text>
            <Text style={[styles.sheetSubtitle, { color: Colors.textSecondary }]}>
              {isOnline
                ? "We'll notify you the moment a request comes in."
                : "Turn on availability to start receiving ride requests."}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: isOnline ? "#10B98122" : "#EF444422",
              },
            ]}
          >
            <View style={[styles.statusBadgeDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {isOnline ? "ONLINE" : "OFFLINE"}
            </Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
            <View style={[styles.statIcon, { backgroundColor: Colors.accent + "22" }]}>
              <Wallet color={Colors.accent} size={16} />
            </View>
            <Text style={[styles.statValue, { color: Colors.text }]}>RM {todayEarnings.toFixed(2)}</Text>
            <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Today</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
            <View style={[styles.statIcon, { backgroundColor: Colors.accent + "22" }]}>
              <RouteIcon color={Colors.accent} size={16} />
            </View>
            <Text style={[styles.statValue, { color: Colors.text }]}>{todayTrips}</Text>
            <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Trips</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
            <View style={[styles.statIcon, { backgroundColor: Colors.accent + "22" }]}>
              <Star color={Colors.accent} size={16} />
            </View>
            <Text style={[styles.statValue, { color: Colors.text }]}>4.92</Text>
            <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Rating</Text>
          </View>
        </View>

        {/* Auto-accept toggle */}
        <TouchableOpacity
          style={[
            styles.offerMeRow,
            { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
          ]}
          activeOpacity={0.85}
          onPress={handleToggleAutoAccept}
          testID="partner-ehailing-autoaccept-toggle"
        >
          <View style={[styles.offerMeIcon, { backgroundColor: "#10B98122" }]}>
            <CheckCheck color="#10B981" size={16} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.offerMeTitle, { color: Colors.text }]}>Auto Accept</Text>
            <Text style={[styles.offerMeSubtitle, { color: Colors.textSecondary }]}>
              {autoAccept ? "Accepting all requests automatically" : "Manually review each request"}
            </Text>
          </View>
          <View
            style={[
              styles.switchTrack,
              {
                backgroundColor: autoAccept ? "#10B981" : (isLightMode ? "#D1D5DB" : "#3a3a3a"),
              },
            ]}
          >
            <View
              style={[
                styles.switchThumb,
                { transform: [{ translateX: autoAccept ? 20 : 2 }] },
              ]}
            />
          </View>
        </TouchableOpacity>

        {/* OfferMe toggle */}
        <TouchableOpacity
          style={[
            styles.offerMeRow,
            { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
          ]}
          activeOpacity={0.85}
          onPress={handleToggleAllowOfferMe}
          testID="partner-ehailing-offerme-toggle"
        >
          <View style={[styles.offerMeIcon, { backgroundColor: Colors.accent + "22" }]}>
            <Tag color={Colors.accent} size={16} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.offerMeTitle, { color: Colors.text }]}>Allow OfferMe requests</Text>
            <Text style={[styles.offerMeSubtitle, { color: Colors.textSecondary }]}>
              {allowOfferMe ? "Receiving passenger price offers" : "Only standard fare requests"}
            </Text>
          </View>
          <View
            style={[
              styles.switchTrack,
              {
                backgroundColor: allowOfferMe ? Colors.accent : (isLightMode ? "#D1D5DB" : "#3a3a3a"),
              },
            ]}
          >
            <View
              style={[
                styles.switchThumb,
                { transform: [{ translateX: allowOfferMe ? 20 : 2 }] },
              ]}
            />
          </View>
        </TouchableOpacity>

        {/* Toggle button */}
        <TouchableOpacity
          style={[
            styles.toggleBtn,
            {
              backgroundColor: isOnline ? "#EF4444" : Colors.accent,
            },
          ]}
          onPress={handleToggleOnline}
          activeOpacity={0.85}
          testID="partner-ehailing-toggle"
        >
          <Power color="#fff" size={18} />
          <Text style={styles.toggleBtnText}>
            {isOnline ? "Go Offline" : "Go Online"}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Incoming request modal */}
      <Modal
        visible={!!request && !offerVisible}
        transparent
        animationType="fade"
        onRequestClose={handleDecline}
        statusBarTranslucent
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[
              styles.requestCard,
              {
                backgroundColor: Colors.background,
                paddingBottom: insets.bottom + 20,
                transform: [
                  {
                    translateY: requestAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [600, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* Timer bar */}
            <View style={[styles.timerTrack, { backgroundColor: Colors.border }]}>
              <Animated.View
                style={[
                  styles.timerFill,
                  {
                    width: timerWidth,
                    backgroundColor: secondsLeft <= 10 ? "#EF4444" : Colors.accent,
                  },
                ]}
              />
            </View>

            <View style={styles.requestHeader}>
              <View
                style={[
                  styles.newRequestBadge,
                  { backgroundColor: Colors.accent + "1A" },
                ]}
              >
                <Zap color={Colors.accent} size={14} />
                <Text style={[styles.newRequestText, { color: Colors.accent }]}>NEW REQUEST</Text>
              </View>
              <View style={styles.timerWrap}>
                <Timer color={secondsLeft <= 10 ? "#EF4444" : Colors.textSecondary} size={14} />
                <Text
                  style={[
                    styles.timerText,
                    { color: secondsLeft <= 10 ? "#EF4444" : Colors.textSecondary },
                  ]}
                >
                  {secondsLeft}s
                </Text>
              </View>
            </View>

            {request && (
              <>
                {/* Passenger row */}
                <View style={styles.passengerRow}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: Colors.accent + "1A" },
                    ]}
                  >
                    <User color={Colors.accent} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.passengerName, { color: Colors.text }]}>
                      {request.passengerName}
                    </Text>
                    <View style={styles.ratingRow}>
                      <Star color="#F59E0B" size={12} fill="#F59E0B" />
                      <Text style={[styles.ratingText, { color: Colors.textSecondary }]}>
                        {request.passengerRating.toFixed(1)} · {request.distanceToPickupKm.toFixed(1)} km away
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.fareChip, { backgroundColor: Colors.accent }]}>
                    <Text style={styles.fareChipCurrency}>RM</Text>
                    <Text style={styles.fareChipAmount}>{request.fare}</Text>
                  </View>
                </View>

                {/* Locations */}
                <View
                  style={[
                    styles.locationsCard,
                    { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                  ]}
                >
                  <View style={styles.locationRow}>
                    <View style={[styles.dot, { backgroundColor: "#10B981" }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.locName, { color: Colors.text }]} numberOfLines={1}>
                        {request.pickupName}
                      </Text>
                      <Text
                        style={[styles.locAddr, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {request.pickupAddress}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.dashed, { borderColor: Colors.border }]} />
                  <View style={styles.locationRow}>
                    <View style={[styles.dot, { backgroundColor: "#EF4444" }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.locName, { color: Colors.text }]} numberOfLines={1}>
                        {request.dropName}
                      </Text>
                      <Text
                        style={[styles.locAddr, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {request.dropAddress}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Payment + pax/luggage */}
                <View style={styles.infoChipsRow}>
                  <View
                    style={[
                      styles.infoChip,
                      { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                    ]}
                  >
                    {request.paymentMode === "Cash" ? (
                      <Banknote color={Colors.accent} size={14} />
                    ) : request.paymentMode === "Card" ? (
                      <CreditCard color={Colors.accent} size={14} />
                    ) : (
                      <WalletIcon color={Colors.accent} size={14} />
                    )}
                    <Text style={[styles.infoChipText, { color: Colors.text }]}>
                      {request.paymentMode}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.infoChip,
                      { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                    ]}
                  >
                    <Users color={Colors.accent} size={14} />
                    <Text style={[styles.infoChipText, { color: Colors.text }]}>
                      {request.passengers} pax
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.infoChip,
                      { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                    ]}
                  >
                    <Briefcase color={Colors.accent} size={14} />
                    <Text style={[styles.infoChipText, { color: Colors.text }]}>
                      {request.luggage} {request.luggage === 1 ? "bag" : "bags"}
                    </Text>
                  </View>
                </View>

                {/* Trip mini stats */}
                <View style={styles.miniStatsRow}>
                  <View style={styles.miniStat}>
                    <RouteIcon color={Colors.textSecondary} size={14} />
                    <Text style={[styles.miniStatText, { color: Colors.text }]}>
                      {request.distanceKm.toFixed(1)} km
                    </Text>
                  </View>
                  <View style={[styles.miniSep, { backgroundColor: Colors.border }]} />
                  <View style={styles.miniStat}>
                    <Timer color={Colors.textSecondary} size={14} />
                    <Text style={[styles.miniStatText, { color: Colors.text }]}>
                      ~{request.durationMin} min
                    </Text>
                  </View>
                  <View style={[styles.miniSep, { backgroundColor: Colors.border }]} />
                  <View style={styles.miniStat}>
                    <MapPin color={Colors.textSecondary} size={14} />
                    <Text style={[styles.miniStatText, { color: Colors.text }]}>
                      {request.distanceToPickupKm.toFixed(1)} km pickup
                    </Text>
                  </View>
                </View>

                {/* Quick offer presets */}
                {request.offerMe && (
                  <View style={styles.quickOfferRow}>
                    {[20, 30, 50].map((p) => {
                      const amt = Math.round(request.fare * (1 + p / 100));
                      return (
                        <TouchableOpacity
                          key={`quick-${p}`}
                          style={[
                            styles.quickOfferBtn,
                            {
                              borderColor: Colors.accent,
                              backgroundColor: Colors.accent,
                            },
                          ]}
                          onPress={() => handleQuickOffer(p)}
                          testID={`ehailing-quick-${p}`}
                        >
                          <Text style={[styles.quickOfferAmt, { color: "#fff" }]}>RM {amt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Actions */}
                <View style={styles.actionsRow}>
                  {request.offerMe ? (
                    <TouchableOpacity
                      style={[styles.declineBtn, { borderColor: Colors.accent, backgroundColor: Colors.accent + "14" }]}
                      onPress={handleOpenOffer}
                      testID="ehailing-offer"
                    >
                      <Tag color={Colors.accent} size={18} />
                      <Text style={[styles.declineText, { color: Colors.accent }]}>Offer</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.declineBtn, { borderColor: Colors.border }]}
                      onPress={handleDecline}
                      testID="ehailing-decline"
                    >
                      <X color={Colors.text} size={18} />
                      <Text style={[styles.declineText, { color: Colors.text }]}>Decline</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.acceptBtn, { backgroundColor: Colors.accent }]}
                    onPress={handleAccept}
                    testID="ehailing-accept"
                  >
                    <Check color="#000000" size={18} />
                    <Text style={styles.acceptText}>Accept · RM {request.fare}</Text>
                  </TouchableOpacity>
                </View>

                {request.offerMe && (
                  <TouchableOpacity
                    style={[styles.declineBtnFull, { borderColor: Colors.border }]}
                    onPress={handleDecline}
                    testID="ehailing-decline-offerme"
                  >
                    <X color={Colors.text} size={18} />
                    <Text style={[styles.declineText, { color: Colors.text }]}>Decline</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* Offer Pending Modal */}
      <Modal
        visible={offerPendingVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelPendingOffer}
        statusBarTranslucent
      >
        <View style={styles.offerBackdrop}>
          <View style={[styles.offerCard, { backgroundColor: Colors.background }]}>
            <View style={[styles.offerIconWrap, { backgroundColor: Colors.accent + "1A" }]}>
              <Clock color={Colors.accent} size={22} />
            </View>
            <Text style={[styles.offerTitle, { color: Colors.text }]}>Offer sent</Text>
            <Text style={[styles.offerSubtitle, { color: Colors.textSecondary }]}>
              Waiting for passenger to accept your offer of RM {pendingOfferAmount}.
            </Text>

            <View style={styles.pendingTimerWrap}>
              <Text style={[styles.pendingTimerText, { color: Colors.text }]}>
                {offerPendingSeconds}s
              </Text>
              <Text style={[styles.pendingTimerLabel, { color: Colors.textSecondary }]}>
                pending acceptance
              </Text>
            </View>

            <View style={[styles.pendingTimerTrack, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}>
              <Animated.View
                style={[
                  styles.pendingTimerFill,
                  {
                    backgroundColor: Colors.accent,
                    width: offerPendingAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>

            <View style={styles.offerActionsRow}>
              <TouchableOpacity
                style={[styles.offerSendBtn, { backgroundColor: "#EF4444", flex: 1 }]}
                onPress={handleCancelPendingOffer}
                testID="offer-pending-cancel"
              >
                <X color="#fff" size={18} />
                <Text style={styles.acceptText}>Cancel offer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Counter Offer Modal */}
      <Modal
        visible={offerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOfferVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.offerBackdrop}>
          <View style={[styles.offerCard, { backgroundColor: Colors.background }]}>
            <View style={[styles.offerIconWrap, { backgroundColor: Colors.accent + "1A" }]}>
              <Tag color={Colors.accent} size={22} />
            </View>
            <Text style={[styles.offerTitle, { color: Colors.text }]}>Send your offer</Text>
            <Text style={[styles.offerSubtitle, { color: Colors.textSecondary }]}>
              Passenger offered RM {request?.fare ?? 0}. You can only counter higher.
            </Text>

            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[
                  styles.stepBtn,
                  {
                    backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a",
                    opacity: request && offerAmount <= request.fare ? 0.4 : 1,
                  },
                ]}
                onPress={() => adjustOffer(-1)}
                disabled={!!request && offerAmount <= request.fare}
                testID="offer-decrease"
              >
                <Minus color={Colors.text} size={22} />
              </TouchableOpacity>
              <View style={styles.offerAmountWrap}>
                <Text style={[styles.offerCurrency, { color: Colors.textSecondary }]}>RM</Text>
                <Text style={[styles.offerAmount, { color: Colors.text }]}>{offerAmount}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.stepBtn,
                  { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                ]}
                onPress={() => adjustOffer(1)}
                testID="offer-increase"
              >
                <Plus color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>

            {!!request && offerAmount === request.fare && (
              <Text style={[styles.offerHint, { color: Colors.textSecondary }]}>
                Minimum is the passenger's offer (RM {request.fare}).
              </Text>
            )}

            <View style={styles.offerActionsRow}>
              <TouchableOpacity
                style={[styles.offerCancelBtn, { borderColor: Colors.border }]}
                onPress={() => setOfferVisible(false)}
                testID="offer-cancel"
              >
                <Text style={[styles.declineText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.offerSendBtn, { backgroundColor: Colors.accent }]}
                onPress={handleSubmitOffer}
                testID="offer-send"
              >
                <Check color="#000000" size={18} />
                <Text style={styles.acceptText}>Send Offer · RM {offerAmount}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* My Destination Modal */}
      <Modal
        visible={destinationsVisible && !pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDestinationsVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.offerBackdrop}>
          <View style={[styles.offerCard, { backgroundColor: Colors.background, alignItems: "stretch" }]}>
            <View style={{ alignItems: "center" as const }}>
              <View style={[styles.offerIconWrap, { backgroundColor: Colors.accent + "1A" }]}>
                <Target color={Colors.accent} size={22} />
              </View>
              <Text style={[styles.offerTitle, { color: Colors.text }]}>My Destination</Text>
              <Text style={[styles.offerSubtitle, { color: Colors.textSecondary }]}>
                Save up to 3 destinations. We'll prioritise requests heading to your selected one.
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.offerMeRow,
                { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
              ]}
              activeOpacity={0.85}
              onPress={handleToggleDestinationEnabled}
              testID="dest-enabled-toggle"
            >
              <View style={[styles.offerMeIcon, { backgroundColor: Colors.accent + "22" }]}>
                <Target color={Colors.accent} size={16} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.offerMeTitle, { color: Colors.text }]}>My Destination</Text>
                <Text style={[styles.offerMeSubtitle, { color: Colors.textSecondary }]}>
                  {destinationEnabled ? "Prioritising requests toward destination" : "Turn on to prioritise requests"}
                </Text>
              </View>
              <View
                style={[
                  styles.switchTrack,
                  {
                    backgroundColor: destinationEnabled ? Colors.accent : (isLightMode ? "#D1D5DB" : "#3a3a3a"),
                  },
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    { transform: [{ translateX: destinationEnabled ? 20 : 2 }] },
                  ]}
                />
              </View>
            </TouchableOpacity>

            <View style={{ gap: 10 }}>
              {[0, 1, 2].map((idx) => {
                const dest = savedDestinations[idx];
                if (!dest) {
                  return (
                    <TouchableOpacity
                      key={`slot-${idx}`}
                      style={[
                        styles.destSlotEmpty,
                        {
                          borderColor: Colors.border,
                          backgroundColor: isLightMode ? "#F9FAFB" : "#141414",
                        },
                      ]}
                      onPress={() => setPickerVisible(true)}
                      testID={`dest-add-${idx}`}
                    >
                      <Plus color={Colors.accent} size={18} />
                      <Text style={[styles.destSlotEmptyText, { color: Colors.textSecondary }]}>
                        Add destination
                      </Text>
                    </TouchableOpacity>
                  );
                }
                const isActive = activeDestinationId === dest.id;
                return (
                  <View
                    key={dest.id}
                    style={[
                      styles.destSlot,
                      {
                        backgroundColor: isActive
                          ? Colors.accent + "1A"
                          : isLightMode
                          ? "#F3F4F6"
                          : "#1a1a1a",
                        borderColor: isActive ? Colors.accent : "transparent",
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.destSlotMain}
                      onPress={() => handleSelectActiveDestination(dest.id)}
                      testID={`dest-select-${idx}`}
                    >
                      <View
                        style={[
                          styles.destDot,
                          {
                            backgroundColor: isActive ? Colors.accent : Colors.border,
                          },
                        ]}
                      >
                        {isActive ? <Check color="#fff" size={12} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.destName, { color: Colors.text }]} numberOfLines={1}>
                          {dest.name}
                        </Text>
                        <Text
                          style={[styles.destAddr, { color: Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {dest.address}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.destDelete}
                      onPress={() => handleRemoveDestination(dest.id)}
                      testID={`dest-remove-${idx}`}
                    >
                      <Trash2 color={"#EF4444"} size={18} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {savedDestinations.length < 3 && savedDestinations.length > 0 && (
              <TouchableOpacity
                style={[styles.destAddMoreBtn, { borderColor: Colors.accent }]}
                onPress={() => setPickerVisible(true)}
                testID="dest-add-more"
              >
                <Plus color={Colors.accent} size={16} />
                <Text style={[styles.declineText, { color: Colors.accent, fontSize: 13 }]}>Add another</Text>
              </TouchableOpacity>
            )}

            <View style={styles.offerActionsRow}>
              <TouchableOpacity
                style={[styles.offerSendBtn, { backgroundColor: Colors.accent, flex: 1 }]}
                onPress={() => setDestinationsVisible(false)}
                testID="dest-done"
              >
                <Check color="#000000" size={18} />
                <Text style={styles.acceptText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Destination Picker */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setPickerVisible(false);
          setSearchQuery("");
          setSearchResults([]);
        }}
        statusBarTranslucent
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.requestCard,
              {
                backgroundColor: Colors.background,
                paddingBottom: insets.bottom + 20,
                maxHeight: "75%" as const,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: Colors.border, marginTop: 8 }]} />
            <View style={styles.pickerHeader}>
              <Text style={[styles.offerTitle, { color: Colors.text }]}>Select destination</Text>
              <TouchableOpacity
                style={[styles.iconButton, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a", width: 36, height: 36, borderRadius: 18 }]}
                onPress={() => {
                  setPickerVisible(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                testID="dest-picker-close"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
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
              <Search color={Colors.textSecondary} size={18} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search a place or address"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                returnKeyType="search"
                autoCorrect={false}
                testID="dest-search-input"
              />
              {searchLoading ? (
                <ActivityIndicator size="small" color={Colors.accent} />
              ) : searchQuery.length > 0 ? (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  testID="dest-search-clear"
                >
                  <X color={Colors.textSecondary} size={16} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView
              style={{ maxHeight: 460 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {searchQuery.trim().length > 0 ? (
                visibleSearchResults.length === 0 && !searchLoading ? (
                  <Text style={[styles.searchEmpty, { color: Colors.textSecondary }]}>
                    {searchQuery.trim().length < 3 ? "Type at least 3 characters" : "No places found"}
                  </Text>
                ) : (
                  visibleSearchResults.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      style={[
                        styles.pickerItem,
                        { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                      ]}
                      onPress={() => {
                        Keyboard.dismiss();
                        handleAddDestination(loc);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      testID={`dest-search-pick-${loc.id}`}
                    >
                      <View style={[styles.destDot, { backgroundColor: Colors.accent + "33" }]}>
                        <MapPin color={Colors.accent} size={14} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.destName, { color: Colors.text }]} numberOfLines={1}>
                          {loc.name}
                        </Text>
                        <Text
                          style={[styles.destAddr, { color: Colors.textSecondary }]}
                          numberOfLines={2}
                        >
                          {loc.address}
                        </Text>
                        <PlaceGatesList lat={loc.latitude} lon={loc.longitude} name={loc.name} />
                      </View>
                    </TouchableOpacity>
                  ))
                )
              ) : (
                <>
                  <Text style={[styles.searchSectionLabel, { color: Colors.textSecondary }]}>
                    Suggested
                  </Text>
                  {POPULAR_LOCATIONS.filter((l) => !savedDestinations.find((s) => s.id === l.id)).map(
                (loc) => (
                  <TouchableOpacity
                    key={loc.id}
                    style={[
                      styles.pickerItem,
                      { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" },
                    ]}
                    onPress={() =>
                      handleAddDestination({
                        id: loc.id,
                        name: loc.name,
                        address: loc.address,
                        latitude: loc.latitude,
                        longitude: loc.longitude,
                      })
                    }
                    testID={`dest-pick-${loc.id}`}
                  >
                    <View style={[styles.destDot, { backgroundColor: Colors.accent + "33" }]}>
                      <MapPin color={Colors.accent} size={14} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.destName, { color: Colors.text }]} numberOfLines={1}>
                        {loc.name}
                      </Text>
                      <Text
                        style={[styles.destAddr, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        {loc.address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )
              )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PartnerModeSelectModal
        visible={driverModeVisible}
        onClose={() => setDriverModeVisible(false)}
        options={partnerModeOptions}
        onSelect={async (mode) => {
          console.log("Partner mode selected from partner-ehailing:", mode);
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
            console.log("[partner-ehailing] doc-check failed", e);
          }
          if (n === "teksi" || n.includes("taxi")) {
            router.replace("/partner-teksi" as any);
          }
        }}
      />

      <PartnerSideSheet
        visible={sideSheetVisible}
        onClose={() => setSideSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: "#000000",
    fontSize: 14,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  statusPillWrap: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  pulseWrap: {
    position: "absolute" as const,
    top: "42%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 4,
  },
  pulseRing: {
    position: "absolute" as const,
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  pulseDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: "#fff",
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: "#000",
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
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "800" as const,
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: "flex-start",
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "800" as const,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  offerMeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  offerMeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  offerMeTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  offerMeSubtitle: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  toggleBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800" as const,
    letterSpacing: 0.4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  requestCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    overflow: "hidden" as const,
  },
  timerTrack: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  timerFill: {
    height: 4,
  },
  requestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    marginTop: 4,
  },
  newRequestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  newRequestText: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
  },
  timerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timerText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  passengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  passengerName: {
    fontSize: 16,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  fareChip: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    gap: 2,
  },
  fareChipCurrency: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  fareChipAmount: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
  },
  locationsCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dashed: {
    marginLeft: 4,
    borderLeftWidth: 1,
    borderStyle: "dashed" as const,
    height: 16,
    marginVertical: 6,
  },
  locName: {
    fontSize: 14,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  locAddr: {
    fontSize: 12,
  },
  miniStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  miniStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    justifyContent: "center",
  },
  miniStatText: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  miniSep: {
    width: 1,
    height: 14,
  },
  infoChipsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  infoChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  infoChipText: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  declineText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  acceptText: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  offerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  offerCard: {
    width: "100%",
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 14,
  },
  offerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  offerTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    marginBottom: 6,
  },
  offerSubtitle: {
    fontSize: 13,
    textAlign: "center" as const,
    lineHeight: 18,
    marginBottom: 18,
  },
  declineBtnFull: {
    marginTop: 10,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  quickOfferRow: {
    flexDirection: "row" as const,
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  quickOfferBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
  },
  quickOfferPct: {
    fontSize: 13,
    fontWeight: "800" as const,
  },
  quickOfferAmt: {
    fontSize: 14,
    fontWeight: "800" as const,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  offerAmountWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    minWidth: 120,
    justifyContent: "center",
    gap: 4,
  },
  offerCurrency: {
    fontSize: 14,
    fontWeight: "700" as const,
    marginBottom: 6,
  },
  offerAmount: {
    fontSize: 36,
    fontWeight: "900" as const,
    letterSpacing: -1,
  },
  offerHint: {
    fontSize: 11,
    marginTop: 4,
    marginBottom: 4,
  },
  offerActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    width: "100%",
  },
  offerCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  offerSendBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  pendingTimerWrap: {
    alignItems: "center",
    marginBottom: 12,
  },
  pendingTimerText: {
    fontSize: 40,
    fontWeight: "900" as const,
    letterSpacing: -1,
  },
  pendingTimerLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginTop: 2,
  },
  pendingTimerTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden" as const,
    marginTop: 4,
  },
  pendingTimerFill: {
    height: "100%",
    borderRadius: 3,
  },
  destSlot: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  destSlotMain: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  destSlotEmpty: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    gap: 8,
  },
  destSlotEmptyText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  destDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  destName: {
    fontSize: 14,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  destAddr: {
    fontSize: 12,
  },
  destDelete: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  destAddMoreBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  pickerHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  pickerItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 6,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500" as const,
    padding: 0,
  },
  searchSectionLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  searchEmpty: {
    fontSize: 13,
    textAlign: "center" as const,
    paddingVertical: 24,
  },
});
