import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Platform,
  Dimensions,
  Image,
  Animated,
  PanResponder,
  TextInput,
  Keyboard,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack, useFocusEffect } from "expo-router";
import { 
  ArrowLeft, 
  Users, 
  Info, 
  Pencil, 
  Minus, 
  Plus, 
  CreditCard,
  SlidersHorizontal,
  Send,
  X,
  Check,
  Banknote,
  Route,
  Delete,
  Tag,
  ChevronRight,
  Equal,
} from "lucide-react-native";

import { useAudioPlayer } from "expo-audio";
import { useAdminData } from "@/contexts/AdminDataContext";
import OfferFareSideSheet from "@/components/OfferFareSideSheet";
import MenuSideSheet from "@/components/MenuSideSheet";
import { MapView, Marker, Polyline, calculateRoute } from "@/utils/maps";
import { estimateRouteWithGemini, type TollBooth } from "@/utils/geminiRoute";
import { useLocation } from "@/contexts/LocationContext";
import { Star } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { consumePendingLocationReturn } from "@/utils/locationReturn";

const CHIME_SOURCE = { uri: "https://cdn.pixabay.com/audio/2022/11/17/audio_febc508520.mp3" };

interface DriverOffer {
  id: string;
  name: string;
  photo: string;
  rating: number;
  totalRides: number;
  vehicle: string;
  tier: 'platinum' | 'gold' | 'silver' | 'standard';
  ltfrbNumber: string;
  price: number;
  eta: number;
  distance: number;
}

interface ViewingDriver {
  id: string;
  photo: string;
}

interface AvailableDriver {
  id: string;
  name: string;
  photo: string;
  rating: number;
  rides: number;
  vehicle: string;
  eta: string;
  distance: string;
}

const MOCK_VIEWING_DRIVERS: ViewingDriver[] = [
  { id: 'v1', photo: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { id: 'v2', photo: 'https://randomuser.me/api/portraits/men/45.jpg' },
  { id: 'v3', photo: 'https://randomuser.me/api/portraits/women/44.jpg' },
];

const MOCK_AVAILABLE_DRIVERS: AvailableDriver[] = [
  {
    id: 'a1',
    name: 'Aura',
    photo: 'https://randomuser.me/api/portraits/men/22.jpg',
    rating: 5.0,
    rides: 9,
    vehicle: 'Aura',
    eta: '1 min',
    distance: '0 km',
  },
  {
    id: 'a2',
    name: 'Dzire',
    photo: 'https://randomuser.me/api/portraits/men/35.jpg',
    rating: 5.0,
    rides: 26,
    vehicle: 'Dzire',
    eta: '1 min',
    distance: '0 km',
  },
  {
    id: 'a3',
    name: 'zire tour',
    photo: 'https://randomuser.me/api/portraits/men/42.jpg',
    rating: 5.0,
    rides: 5,
    vehicle: 'zire tour',
    eta: '1 min',
    distance: '0 km',
  },
];

const MOCK_FARE_VIEWERS: ViewingDriver[] = [
  { id: 'f1', photo: 'https://randomuser.me/api/portraits/men/11.jpg' },
  { id: 'f2', photo: 'https://randomuser.me/api/portraits/men/12.jpg' },
  { id: 'f3', photo: 'https://randomuser.me/api/portraits/women/13.jpg' },
  { id: 'f4', photo: 'https://randomuser.me/api/portraits/men/14.jpg' },
];

const MOCK_DRIVER_OFFERS: DriverOffer[] = [
  {
    id: '1',
    name: 'Patrick',
    photo: 'https://randomuser.me/api/portraits/men/32.jpg',
    rating: 5.0,
    totalRides: 2553,
    vehicle: 'Toyota Innova',
    tier: 'platinum',
    ltfrbNumber: '2024 81173',
    price: 772,
    eta: 15,
    distance: 3,
  },
  {
    id: '2',
    name: 'Mellier',
    photo: 'https://randomuser.me/api/portraits/men/45.jpg',
    rating: 4.62,
    totalRides: 789,
    vehicle: 'Mitsubishi G4',
    tier: 'standard',
    ltfrbNumber: '2022-14060',
    price: 772,
    eta: 7,
    distance: 1,
  },
  {
    id: '3',
    name: 'Gomer',
    photo: 'https://randomuser.me/api/portraits/men/52.jpg',
    rating: 4.79,
    totalRides: 692,
    vehicle: 'Toyota Avanza',
    tier: 'standard',
    ltfrbNumber: '2023-85031',
    price: 772,
    eta: 14,
    distance: 3,
  },
];

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const MENU_WIDTH = SCREEN_WIDTH * 0.68;

const FIXED_BOTTOM_HEIGHT = 130;
const BOTTOM_SHEET_MIN_HEIGHT = SCREEN_HEIGHT * 0.55 - FIXED_BOTTOM_HEIGHT + 150;
const BOTTOM_SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.78 + 90;
const BOTTOM_SHEET_MAP_DRAG_HEIGHT = SCREEN_HEIGHT * 0.10;

const CAR_IMAGES = {
  economy: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/35o4qbizzq6n6k49op0mv",
  comfort: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/c8ck0gnn45nc8rhbbnegp",
  premium: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3xa9mgdbyyt7ztpzvdlw9",
  sixseater: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/hd401jwvfmsjl8b9h440e",
};

const FALLBACK_RIDE = {
  id: "economy",
  name: "Ride",
  description: "Affordable rides",
  priceMultiplier: 1.0,
  eta: 3,
  icon: "car",
  color: "#6B7280",
  capacity: 4,
  image: CAR_IMAGES.economy,
};

export default function RideConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { settings: displaySettings } = useDisplaySettings();
  const { setSkipNextLocationDetection, currency } = useLocation();
  const { getEntries } = useAdminData();
  const vehicleServiceEntries = getEntries("vehicle-services");

  /**
   * Ride options sourced from the admin Vehicle Services list.
   * Filters: status active, and (if defined) serviceTypes includes "Passenger".
   * Sorted by displayPriority ascending.
   */
  const EXTENDED_RIDE_TYPES = useMemo(() => {
    const filtered = vehicleServiceEntries
      .filter((e) => {
        const v = e.values as Record<string, unknown>;
        const active = v.status === undefined ? true : Boolean(v.status);
        const types = Array.isArray(v.serviceTypes) ? (v.serviceTypes as string[]) : [];
        const allowsPassenger = types.length === 0 || types.includes("Passenger");
        return active && allowsPassenger;
      })
      .sort((a, b) => {
        const pa = Number((a.values as Record<string, unknown>).displayPriority ?? 9999);
        const pb = Number((b.values as Record<string, unknown>).displayPriority ?? 9999);
        return pa - pb;
      });

    if (filtered.length === 0) {
      return [FALLBACK_RIDE];
    }

    return filtered.map((e, i) => {
      const v = e.values as Record<string, unknown>;
      const costPerKm = Number(v.costPerKm ?? 1.5) || 1.5;
      return {
        id: e.id,
        name: String(v.name ?? "Ride"),
        description: String(v.shortDescription ?? ""),
        priceMultiplier: costPerKm / 1.5,
        eta: 3 + i * 2,
        icon: "car",
        color: colors.textSecondary,
        capacity: Number(v.maxPax ?? 4) || 4,
        image: String(v.iconUri ?? CAR_IMAGES.economy),
      };
    });
  }, [vehicleServiceEntries]);

  const [selectedRide, setSelectedRide] = useState(() => EXTENDED_RIDE_TYPES[0] ?? FALLBACK_RIDE);

  useEffect(() => {
    if (!EXTENDED_RIDE_TYPES.find((r) => r.id === selectedRide.id)) {
      const next = EXTENDED_RIDE_TYPES[0] ?? FALLBACK_RIDE;
      setSelectedRide(next);
    }
  }, [EXTENDED_RIDE_TYPES, selectedRide.id]);
  const [fareAdjustment, setFareAdjustment] = useState(0);
  const [autoAccept, setAutoAccept] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [isCalculatingFare, setIsCalculatingFare] = useState(false);
  const [routeCoords, setRouteCoords] = useState<{latitude: number, longitude: number}[]>([]);
  const [tollBooths, setTollBooths] = useState<TollBooth[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'cash' | 'duitnow'>('cash');
  const [showTollSheet, setShowTollSheet] = useState(false);
  const [showEntranceSheet, setShowEntranceSheet] = useState(false);
  const [entranceValue, setEntranceValue] = useState('');
  const [isSearchingDriver, setIsSearchingDriver] = useState(false);
  const [driverOffers, setDriverOffers] = useState<DriverOffer[]>([]);
  const [searchCountdown, setSearchCountdown] = useState(60);
  const [searchFareAdjustment, setSearchFareAdjustment] = useState(0);
  const [committedFareRaise, setCommittedFareRaise] = useState(0);
  const [searchAutoAccept, setSearchAutoAccept] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [viewingDrivers, setViewingDrivers] = useState<ViewingDriver[]>([]);
  const [showRaiseFareSheet, setShowRaiseFareSheet] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState<AvailableDriver[]>([]);
  const [fareViewers, setFareViewers] = useState<ViewingDriver[]>([]);
  const [hasRespondedToFarePopup, setHasRespondedToFarePopup] = useState(false);
  const [showFareRaisedToast, setShowFareRaisedToast] = useState(false);
  const [showCancelConfirmSheet, setShowCancelConfirmSheet] = useState(false);
  const [showNoFareRaiseCancelSheet, setShowNoFareRaiseCancelSheet] = useState(false);
  const [showPromoCodeSheet, setShowPromoCodeSheet] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoCodeError, setPromoCodeError] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [isPromoInputFocused, setIsPromoInputFocused] = useState(false);
  const [showDestinationsSheet, setShowDestinationsSheet] = useState(false);
  const [showOfferFareSheet, setShowOfferFareSheet] = useState(false);
  const [showMenuSideSheet, setShowMenuSideSheet] = useState(false);
  const [menuFullyOpen, setMenuFullyOpen] = useState(false);
  const [isMenuDragging, setIsMenuDragging] = useState(false);
  const chimePlayer = useAudioPlayer(CHIME_SOURCE);
  const raiseFareSheetAnim = useRef(new Animated.Value(0)).current;
  const fareRaisedToastAnim = useRef(new Animated.Value(0)).current;
  const cancelConfirmSheetAnim = useRef(new Animated.Value(0)).current;
  const noFareRaiseCancelSheetAnim = useRef(new Animated.Value(0)).current;
  const promoCodeSheetAnim = useRef(new Animated.Value(0)).current;
  const promoLoadingSpinnerAnim = useRef(new Animated.Value(0)).current;
  const destinationsSheetAnim = useRef(new Animated.Value(0)).current;
  const menuRevealAnim = useRef(new Animated.Value(0)).current;
  const currentMenuPosition = useRef(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const itemAnimatedValues = useRef<{ [key: number]: Animated.Value }>({}).current;
  const offerAnimations = useRef<{ [key: string]: { acceptProgress: Animated.Value; cardSlide: Animated.Value; slideIn: Animated.Value; swipeX: Animated.Value; timeoutId?: ReturnType<typeof setTimeout> } }>({}).current;
  const offerCardPanResponders = useRef<{ [key: string]: ReturnType<typeof PanResponder.create> }>({}).current;
  const searchProgressAnim = useRef(new Animated.Value(1)).current;
  const [isMapMoved, setIsMapMoved] = useState(false);
  const paymentSheetAnim = useRef(new Animated.Value(0)).current;
  const tollSheetAnim = useRef(new Animated.Value(0)).current;
  const entranceSheetAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const collapsedScrollRef = useRef<ScrollView>(null);
  const isAtScrollTop = useRef(true);
  
  const bottomSheetHeight = useRef(new Animated.Value(BOTTOM_SHEET_MIN_HEIGHT)).current;
  const lastGestureY = useRef(0);
  const currentHeight = useRef(BOTTOM_SHEET_MIN_HEIGHT);
  const selectedRideRef = useRef(selectedRide);

  useEffect(() => {
    selectedRideRef.current = selectedRide;
  }, [selectedRide]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const initialRegionSet = useRef(false);
  const recenterButtonAnim = useRef(new Animated.Value(0)).current;
  const pulse1Anim = useRef(new Animated.Value(0)).current;
  const pulse2Anim = useRef(new Animated.Value(0)).current;
  const pulse3Anim = useRef(new Animated.Value(0)).current;
  const detectionPausedRef = useRef(false);
  const detectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDelayPassedRef = useRef(false);
  const isMapDragging = useRef(false);
  const mapDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fixedBottomSlideAnim = useRef(new Animated.Value(0)).current;
  const topButtonsHideAnim = useRef(new Animated.Value(1)).current;
  const menuSwipeThreshold = SCREEN_WIDTH * 0.25;

  useEffect(() => {
    const listenerId = menuRevealAnim.addListener(({ value }) => {
      currentMenuPosition.current = value;
    });
    return () => menuRevealAnim.removeListener(listenerId);
  }, [menuRevealAnim]);

  const menuPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const isLeftToRight = gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
        const isRightToLeft = gestureState.dx < -10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2) && currentMenuPosition.current > 0;
        return isLeftToRight || isRightToLeft;
      },
      onPanResponderGrant: () => {
        console.log("Menu swipe started on ride-confirm");
        setIsMenuDragging(true);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0 && currentMenuPosition.current < MENU_WIDTH) {
          const clampedDx = Math.min(gestureState.dx, MENU_WIDTH);
          menuRevealAnim.setValue(clampedDx);
        } else if (gestureState.dx < 0 && currentMenuPosition.current > 0) {
          const newValue = Math.max(0, MENU_WIDTH + gestureState.dx);
          menuRevealAnim.setValue(newValue);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 0) {
          if (gestureState.dx > menuSwipeThreshold || gestureState.vx > 0.5) {
            Animated.spring(menuRevealAnim, {
              toValue: MENU_WIDTH,
              useNativeDriver: true,
              tension: 65,
              friction: 11,
            }).start(() => {
              setMenuFullyOpen(true);
              setShowMenuSideSheet(true);
              setIsMenuDragging(false);
            });
          } else {
            Animated.spring(menuRevealAnim, {
              toValue: 0,
              useNativeDriver: true,
              tension: 100,
              friction: 10,
            }).start(() => {
              setIsMenuDragging(false);
            });
          }
        } else {
          const shouldClose = gestureState.dx < -MENU_WIDTH * 0.3 || gestureState.vx < -0.5;
          if (shouldClose) {
            setMenuFullyOpen(false);
            Animated.spring(menuRevealAnim, {
              toValue: 0,
              useNativeDriver: true,
              tension: 100,
              friction: 10,
            }).start(() => {
              setShowMenuSideSheet(false);
              setIsMenuDragging(false);
            });
          } else {
            Animated.spring(menuRevealAnim, {
              toValue: MENU_WIDTH,
              useNativeDriver: true,
              tension: 65,
              friction: 11,
            }).start(() => {
              setIsMenuDragging(false);
            });
          }
        }
      },
    })
  ).current;

  const handleCloseMenuFromOverlay = () => {
    setMenuFullyOpen(false);
    Animated.spring(menuRevealAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start(() => {
      setShowMenuSideSheet(false);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        lastGestureY.current = currentHeight.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const newHeight = lastGestureY.current - gestureState.dy;
        const clampedHeight = Math.max(
          BOTTOM_SHEET_MIN_HEIGHT,
          Math.min(BOTTOM_SHEET_MAX_HEIGHT, newHeight)
        );
        bottomSheetHeight.setValue(clampedHeight);
        currentHeight.current = clampedHeight;
      },
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        const currentPos = currentHeight.current;
        const midPoint = (BOTTOM_SHEET_MIN_HEIGHT + BOTTOM_SHEET_MAX_HEIGHT) / 2;
        
        let targetHeight: number;
        if (velocity < -0.5) {
          targetHeight = BOTTOM_SHEET_MAX_HEIGHT;
        } else if (velocity > 0.5) {
          targetHeight = BOTTOM_SHEET_MIN_HEIGHT;
        } else {
          targetHeight = currentPos > midPoint ? BOTTOM_SHEET_MAX_HEIGHT : BOTTOM_SHEET_MIN_HEIGHT;
        }
        
        Animated.spring(bottomSheetHeight, {
          toValue: targetHeight,
          useNativeDriver: false,
          tension: 100,
          friction: 12,
        }).start();
        currentHeight.current = targetHeight;
        const willCollapse = targetHeight === BOTTOM_SHEET_MIN_HEIGHT;
        setIsExpanded(!willCollapse);
        
        // When expanding, scroll to show the selected card above the disclaimer bar
        if (!willCollapse) {
          const currentSelected = selectedRideRef.current;
          const selectedIndex = EXTENDED_RIDE_TYPES.findIndex(r => r.id === currentSelected.id);
          
          const SELECTED_CARD_HEIGHT = 200;
          const NON_SELECTED_CARD_HEIGHT = 80;
          const DISCLAIMER_HEIGHT = 100;
          const BOTTOM_PADDING = 150;
          
          setTimeout(() => {
            let itemOffset = 0;
            for (let i = 0; i < selectedIndex; i++) {
              itemOffset += NON_SELECTED_CARD_HEIGHT;
            }
            
            // Calculate scroll to position card above disclaimer
            const visibleAreaHeight = BOTTOM_SHEET_MAX_HEIGHT - 40 - DISCLAIMER_HEIGHT - BOTTOM_PADDING;
            const cardBottom = itemOffset + SELECTED_CARD_HEIGHT;
            const scrollY = cardBottom - visibleAreaHeight + 50;
            
            scrollViewRef.current?.scrollTo({
              y: Math.max(0, scrollY),
              animated: true,
            });
          }, 150);
        }
        
        // When collapsing, scroll to show the selected card above 150px from screen bottom
        if (willCollapse) {
          const currentSelected = selectedRideRef.current;
          const selectedIndex = EXTENDED_RIDE_TYPES.findIndex(r => r.id === currentSelected.id);
          
          const SELECTED_CARD_HEIGHT = 200;
          const NON_SELECTED_CARD_HEIGHT = 80;
          const CONTENT_PADDING_TOP = 20;
          const DRAG_HANDLE_HEIGHT = 40;
          const CARD_BOTTOM_FROM_SCREEN = 160;
          
          setTimeout(() => {
            let itemOffset = CONTENT_PADDING_TOP;
            for (let i = 0; i < selectedIndex; i++) {
              itemOffset += NON_SELECTED_CARD_HEIGHT;
            }
            
            // Calculate scroll to position card bottom at 150px from screen bottom
            const cardBottom = itemOffset + SELECTED_CARD_HEIGHT;
            const targetCardBottomInSheet = BOTTOM_SHEET_MIN_HEIGHT - CARD_BOTTOM_FROM_SCREEN - DRAG_HANDLE_HEIGHT;
            const scrollY = cardBottom - targetCardBottomInSheet;
            
            collapsedScrollRef.current?.scrollTo({
              y: Math.max(0, scrollY),
              animated: true,
            });
          }, 150);
        }
      },
    })
  ).current;

  const pickup = (params.pickup as string) || "Current Location";
  const pickupLat = params.pickupLat ? parseFloat(params.pickupLat as string) : 3.139;
  const pickupLng = params.pickupLng ? parseFloat(params.pickupLng as string) : 101.6869;
  
  // Support multiple destinations (up to 5)
  const [destinations, setDestinations] = useState<Array<{
    address: string;
    lat: number;
    lng: number;
  }>>([]);

  // Initialize destinations from params
  useEffect(() => {
    // Check if we have additional destinations from params
    if (params.additionalDestinations) {
      try {
        const additionalDests = JSON.parse(params.additionalDestinations as string);
        setDestinations(additionalDests);
      } catch (e) {
        console.log("Error parsing additional destinations");
      }
    } else if (params.destination && params.destLat && params.destLng) {
      // Initialize with single destination from params
      const destLat = parseFloat(params.destLat as string);
      const destLng = parseFloat(params.destLng as string);
      if (!isNaN(destLat) && !isNaN(destLng)) {
        setDestinations([{
          address: params.destination as string,
          lat: destLat,
          lng: destLng,
        }]);
      }
    }
  }, [params.destination, params.destLat, params.destLng, params.additionalDestinations]);

  // Auto-open OfferFareSideSheet when coming back from search
  useEffect(() => {
    if (params.fromOfferFare === 'true') {
      console.log("Coming back from search via OfferFareSideSheet, re-opening sheet");
      setShowOfferFareSheet(true);
    }
  }, [params.fromOfferFare]);

  // Apply location changes returned from the search screen without creating a new screen instance
  useFocusEffect(
    React.useCallback(() => {
      const pending = consumePendingLocationReturn();
      if (pending) {
        router.setParams({
          pickup: pending.pickup,
          pickupLat: pending.pickupLat,
          pickupLng: pending.pickupLng,
          additionalDestinations: JSON.stringify(pending.destinations),
          ...(pending.fromOfferFare ? { fromOfferFare: 'true' } : {}),
        });
      }
    }, [router])
  );

  // Get the last destination for display
  const lastDestination = destinations[destinations.length - 1];
  const destLat = lastDestination?.lat ?? 2.9264;
  const destLng = lastDestination?.lng ?? 101.6964;
  const destination = lastDestination?.address ?? "Destination";

  // State for segment durations
  const [segmentDurations, setSegmentDurations] = useState<number[]>([]);
  const [totalRouteDuration, setTotalRouteDuration] = useState<number | null>(null);
  const [aiTollCount, setAiTollCount] = useState<number | null>(null);
  const [aiTollTotal, setAiTollTotal] = useState<number | null>(null);
  const [aiTollBooths, setAiTollBooths] = useState<{ name?: string; charge: number }[]>([]);

  const basePrice = distance ? distance * 1.5 : 35;
  const estimatedPrice = Math.round(basePrice * selectedRide.priceMultiplier) + fareAdjustment;

  useEffect(() => {
    const initialDelayTimer = setTimeout(() => {
      console.log("Initial 5-second delay passed, detection now active");
      initialDelayPassedRef.current = true;
    }, 5000);

    return () => {
      clearTimeout(initialDelayTimer);
    };
  }, []);

  useEffect(() => {
    if (isValidatingPromo) {
      Animated.loop(
        Animated.timing(promoLoadingSpinnerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      promoLoadingSpinnerAnim.setValue(0);
    }
  }, [isValidatingPromo, promoLoadingSpinnerAnim]);

  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  useEffect(() => {
    // Guard against stale async runs overwriting newer ones. When destinations
    // change, the previous run is marked cancelled so its (slower) Gemini /
    // Directions result can never clobber the latest one.
    let isCancelled = false;

    const fetchRouteDetails = async () => {
      // Only run once we have a real destination. Running before destinations is
      // populated would use the placeholder default coords and produce a wrong
      // estimate that races with and overwrites the correct one.
      if (!pickupLat || !pickupLng || destinations.length === 0) {
        return;
      }

      console.log("Calculating route with", destinations.length, "destinations via Google Directions");
      setIsCalculatingFare(true);

      try {
        const finalDest = destinations[destinations.length - 1];
        const intermediateWaypoints = destinations.slice(0, -1).map(d => ({ latitude: d.lat, longitude: d.lng }));

        const result = await calculateRoute(
          { latitude: pickupLat, longitude: pickupLng },
          { latitude: finalDest.lat, longitude: finalDest.lng },
          intermediateWaypoints,
          "ride-confirm"
        );
        if (isCancelled) return;

        if (result) {
          setSegmentDurations(result.legDurations || []);
          setTotalRouteDuration(result.duration);
          setDistance(result.distance);
          setDuration(result.duration);
          if (result.coordinates) setRouteCoords(result.coordinates);
        } else {
          console.log("Failed to calculate route, using defaults");
          setDistance(35);
          setDuration(43);
          setTotalRouteDuration(43);
        }

        // Override distance/time with Gemini's traffic-aware estimate for fare
        // (runs regardless of the Directions result)
        const gemini = await estimateRouteWithGemini(
          { latitude: pickupLat, longitude: pickupLng },
          { latitude: finalDest.lat, longitude: finalDest.lng }
        );
        if (isCancelled) return;
        if (gemini) {
          console.log("Using Gemini traffic estimate for fare:", gemini.summary);
          setDistance(gemini.distanceKm);
          setDuration(gemini.durationMin);
          setTotalRouteDuration(gemini.durationMin);
          if (typeof gemini.tollCount === "number") setAiTollCount(gemini.tollCount);
          if (typeof gemini.tollTotal === "number") setAiTollTotal(gemini.tollTotal);
          const aiTolls = gemini.tolls ?? [];
          setAiTollBooths(aiTolls);
          setTollBooths(aiTolls);
          console.log(
            "Toll estimate:",
            gemini.tollCount,
            "booth(s), total",
            gemini.tollTotal
          );
        } else {
          setTollBooths([]);
          setAiTollBooths([]);
          setAiTollCount(null);
          setAiTollTotal(null);
          Alert.alert(
            "Unable to fetch current traffic conditions",
            "Actual travel time and distance may vary",
            [{ text: "OK" }]
          );
        }
      } catch (error) {
        if (isCancelled) return;
        console.error("Error calculating route:", error);
        setDistance(35);
        setDuration(43);
        setTotalRouteDuration(43);
      } finally {
        if (!isCancelled) setIsCalculatingFare(false);
      }
    };

    fetchRouteDetails();

    return () => {
      isCancelled = true;
    };
  }, [pickupLat, pickupLng, destinations]);

  // Helper function to decode polyline
  const decodePolyline = (encoded: string, precision: number = 5): { latitude: number; longitude: number }[] => {
    const coordinates: { latitude: number; longitude: number }[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const factor = Math.pow(10, precision);

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte: number;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      coordinates.push({
        latitude: lat / factor,
        longitude: lng / factor,
      });
    }

    return coordinates;
  };

  useEffect(() => {
    console.log("Route coords updated:", routeCoords.length, "points");
    if (mapRef.current && routeCoords.length > 0) {
      setTimeout(() => {
        const allCoords = [
          { latitude: pickupLat, longitude: pickupLng },
          ...destinations.map(d => ({ latitude: d.lat, longitude: d.lng })),
          ...routeCoords,
        ];
        mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 120, right: 100, bottom: 500, left: 100 },
          animated: true,
        });
      }, 300);
    }
  }, [routeCoords, pickupLat, pickupLng, destinations]);

  useEffect(() => {
    if (isSearchingDriver) {
      const createPulseAnimation = (anim: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const pulse1 = createPulseAnimation(pulse1Anim, 0);
      const pulse2 = createPulseAnimation(pulse2Anim, 666);
      const pulse3 = createPulseAnimation(pulse3Anim, 1333);

      pulse1.start();
      pulse2.start();
      pulse3.start();

      return () => {
        pulse1.stop();
        pulse2.stop();
        pulse3.stop();
        pulse1Anim.setValue(0);
        pulse2Anim.setValue(0);
        pulse3Anim.setValue(0);
      };
    }
  }, [isSearchingDriver]);

  useEffect(() => {
    if (isSearchingDriver && mapRef.current && Platform.OS !== "web") {
      console.log("Search screen active - zooming to pickup location only");
      mapRef.current.animateToRegion(
        {
          latitude: pickupLat,
          longitude: pickupLng,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        500
      );
    } else if (!isSearchingDriver && mapRef.current && routeCoords.length > 0 && Platform.OS !== "web") {
      console.log("Search cancelled - fitting to route");
      const allCoords = [
        { latitude: pickupLat, longitude: pickupLng },
        ...routeCoords,
        { latitude: destLat, longitude: destLng },
      ];
      mapRef.current.fitToCoordinates(allCoords, {
        edgePadding: { top: 125, right: 100, bottom: 880, left: 100 },
        animated: true,
      });
    }
  }, [isSearchingDriver, driverOffers.length, pickupLat, pickupLng, destLat, destLng, routeCoords]);

  const handleOpenOfferFare = () => {
    setShowOfferFareSheet(true);
  };

  const handleOfferFareFindDriver = (fare: number, autoAcceptValue: boolean) => {
    console.log('Find driver with fare:', fare, 'autoAccept:', autoAcceptValue);
    
    // Update fare adjustment based on the offered fare
    const recommendedFare = Math.round(basePrice * selectedRide.priceMultiplier);
    const adjustment = fare - recommendedFare;
    setFareAdjustment(adjustment);
    
    // Set auto accept value
    setAutoAccept(autoAcceptValue);
    
    // Close the sheet and trigger find driver
    setShowOfferFareSheet(false);
    
    // Start searching for driver
    setIsSearchingDriver(true);
    setDriverOffers([]);
    setSearchCountdown(60);
    setSearchFareAdjustment(0);
    searchProgressAnim.setValue(1);
    
    countdownRef.current = setInterval(() => {
      setSearchCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          setTimeout(() => {
            setAvailableDrivers(MOCK_AVAILABLE_DRIVERS);
            setFareViewers(MOCK_FARE_VIEWERS.slice(0, 4));
            setShowRaiseFareSheet(true);
            Animated.spring(raiseFareSheetAnim, {
              toValue: 1,
              useNativeDriver: true,
              tension: 100,
              friction: 12,
            }).start();
          }, 300);
          return 0;
        }
        const newValue = prev - 1;
        Animated.timing(searchProgressAnim, {
          toValue: newValue / 60,
          duration: 1000,
          useNativeDriver: false,
        }).start();
        return newValue;
      });
    }, 1000);
    
    setTimeout(() => {
      setViewingDrivers(MOCK_VIEWING_DRIVERS.slice(0, 2));
    }, 1500);

    MOCK_DRIVER_OFFERS.forEach((offer, index) => {
      setTimeout(() => {
        offerAnimations[offer.id] = {
          acceptProgress: new Animated.Value(0),
          cardSlide: new Animated.Value(0),
          slideIn: new Animated.Value(1),
          swipeX: new Animated.Value(0),
        };
        
        offerCardPanResponders[offer.id] = PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_, gestureState) => {
            return gestureState.dx < -10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
          },
          onPanResponderGrant: () => {
            if (offerAnimations[offer.id]?.timeoutId) {
              clearTimeout(offerAnimations[offer.id].timeoutId);
            }
            offerAnimations[offer.id]?.acceptProgress?.stopAnimation();
          },
          onPanResponderMove: (_, gestureState) => {
            if (gestureState.dx < 0) {
              offerAnimations[offer.id]?.swipeX?.setValue(gestureState.dx);
            }
          },
          onPanResponderRelease: (_, gestureState) => {
            const shouldDismiss = gestureState.dx < -SCREEN_WIDTH * 0.6;
            if (shouldDismiss) {
              Animated.timing(offerAnimations[offer.id]?.swipeX || new Animated.Value(0), {
                toValue: -SCREEN_WIDTH - 50,
                duration: 200,
                useNativeDriver: true,
              }).start(() => {
                setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
                delete offerAnimations[offer.id];
                delete offerCardPanResponders[offer.id];
              });
            } else {
              Animated.spring(offerAnimations[offer.id]?.swipeX || new Animated.Value(0), {
                toValue: 0,
                useNativeDriver: true,
                tension: 100,
                friction: 10,
              }).start(() => {
                if (!offerAnimations[offer.id]) return;
                const currentProgress = (offerAnimations[offer.id]?.acceptProgress as any)?._value || 0;
                const remainingDuration = (1 - currentProgress) * 10000;
                if (remainingDuration > 0) {
                  Animated.timing(offerAnimations[offer.id].acceptProgress, {
                    toValue: 1,
                    duration: remainingDuration,
                    useNativeDriver: false,
                  }).start(() => {
                    if (!offerAnimations[offer.id]) return;
                    Animated.timing(offerAnimations[offer.id].cardSlide, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: true,
                      }).start(() => {
                        setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
                        delete offerAnimations[offer.id];
                        delete offerCardPanResponders[offer.id];
                      });
                  });
                }
              });
            }
          },
        });
        
        setDriverOffers(prev => [...prev, offer]);
        setViewingDrivers([]);
        
        chimePlayer.seekTo(0);
        chimePlayer.play();
        
        Animated.spring(offerAnimations[offer.id].slideIn, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
        
        Animated.timing(offerAnimations[offer.id].acceptProgress, {
          toValue: 1,
          duration: 10000,
          useNativeDriver: false,
        }).start(() => {
          if (!offerAnimations[offer.id]) return;
          Animated.timing(offerAnimations[offer.id].cardSlide, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }).start(() => {
              setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
              delete offerAnimations[offer.id];
              delete offerCardPanResponders[offer.id];
            });
        });
      }, (index + 1) * 3000);
    });
  };

  const handleRideSelect = (ride: (typeof EXTENDED_RIDE_TYPES)[0]) => {
    setSelectedRide(ride);
    selectedRideRef.current = ride;
    // Collapse bottom sheet to 45% when option is selected
    Animated.spring(bottomSheetHeight, {
      toValue: BOTTOM_SHEET_MIN_HEIGHT,
      useNativeDriver: false,
      tension: 100,
      friction: 12,
    }).start();
    currentHeight.current = BOTTOM_SHEET_MIN_HEIGHT;
    setIsExpanded(false);
    
    // Scroll to show the selected card above 150px from screen bottom
    const selectedIndex = EXTENDED_RIDE_TYPES.findIndex(r => r.id === ride.id);
    
    const SELECTED_CARD_HEIGHT = 200;
    const NON_SELECTED_CARD_HEIGHT = 80;
    const CONTENT_PADDING_TOP = 20;
    const DRAG_HANDLE_HEIGHT = 40;
    const CARD_BOTTOM_FROM_SCREEN = 160;
    
    setTimeout(() => {
      let itemOffset = CONTENT_PADDING_TOP;
      for (let i = 0; i < selectedIndex; i++) {
        itemOffset += NON_SELECTED_CARD_HEIGHT;
      }
      
      // Calculate scroll to position card bottom at 150px from screen bottom
      const cardBottom = itemOffset + SELECTED_CARD_HEIGHT;
      const targetCardBottomInSheet = BOTTOM_SHEET_MIN_HEIGHT - CARD_BOTTOM_FROM_SCREEN - DRAG_HANDLE_HEIGHT;
      const scrollY = cardBottom - targetCardBottomInSheet;
      
      collapsedScrollRef.current?.scrollTo({
        y: Math.max(0, scrollY),
        animated: true,
      });
    }, 150);
  };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const adjustFare = (amount: number) => {
    const newFare = fareAdjustment + amount;
    if (newFare >= -10 && newFare <= 20) {
      setFareAdjustment(newFare);
    } else {
      triggerShake();
    }
  };

  const openPaymentSheet = () => {
    setShowPaymentSheet(true);
    Animated.spring(paymentSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  };

  const closePaymentSheet = () => {
    Animated.timing(paymentSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowPaymentSheet(false);
    });
  };

  const selectPaymentMethod = (method: 'cash' | 'duitnow') => {
    setSelectedPaymentMethod(method);
    closePaymentSheet();
  };

  const openTollSheet = () => {
    setShowTollSheet(true);
    Animated.spring(tollSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  };

  const closeTollSheet = () => {
    Animated.timing(tollSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowTollSheet(false);
    });
  };

  const openEntranceSheet = () => {
    setShowEntranceSheet(true);
    Animated.spring(entranceSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  };

  const closeEntranceSheet = () => {
    Animated.timing(entranceSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowEntranceSheet(false);
    });
  };

  const handleEntranceDone = () => {
    closeEntranceSheet();
  };

  const handleConfirmRide = () => {
    setIsSearchingDriver(true);
    setDriverOffers([]);
    setSearchCountdown(60);
    setSearchFareAdjustment(0);
    searchProgressAnim.setValue(1);
    
    countdownRef.current = setInterval(() => {
      setSearchCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          setTimeout(() => {
            setAvailableDrivers(MOCK_AVAILABLE_DRIVERS);
            setFareViewers(MOCK_FARE_VIEWERS.slice(0, 4));
            setShowRaiseFareSheet(true);
            Animated.spring(raiseFareSheetAnim, {
              toValue: 1,
              useNativeDriver: true,
              tension: 100,
              friction: 12,
            }).start();
          }, 300);
          return 0;
        }
        const newValue = prev - 1;
        Animated.timing(searchProgressAnim, {
          toValue: newValue / 60,
          duration: 1000,
          useNativeDriver: false,
        }).start();
        return newValue;
      });
    }, 1000);
    
    setTimeout(() => {
      setViewingDrivers(MOCK_VIEWING_DRIVERS.slice(0, 2));
    }, 1500);

    MOCK_DRIVER_OFFERS.forEach((offer, index) => {
      setTimeout(() => {
        offerAnimations[offer.id] = {
          acceptProgress: new Animated.Value(0),
          cardSlide: new Animated.Value(0),
          slideIn: new Animated.Value(1),
          swipeX: new Animated.Value(0),
        };
        
        offerCardPanResponders[offer.id] = PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_, gestureState) => {
            return gestureState.dx < -10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
          },
          onPanResponderGrant: () => {
            if (offerAnimations[offer.id]?.timeoutId) {
              clearTimeout(offerAnimations[offer.id].timeoutId);
            }
            offerAnimations[offer.id]?.acceptProgress?.stopAnimation();
          },
          onPanResponderMove: (_, gestureState) => {
            if (gestureState.dx < 0) {
              offerAnimations[offer.id]?.swipeX?.setValue(gestureState.dx);
            }
          },
          onPanResponderRelease: (_, gestureState) => {
            const shouldDismiss = gestureState.dx < -SCREEN_WIDTH * 0.6;
            if (shouldDismiss) {
              Animated.timing(offerAnimations[offer.id]?.swipeX || new Animated.Value(0), {
                toValue: -SCREEN_WIDTH - 50,
                duration: 200,
                useNativeDriver: true,
              }).start(() => {
                setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
                delete offerAnimations[offer.id];
                delete offerCardPanResponders[offer.id];
              });
            } else {
              Animated.spring(offerAnimations[offer.id]?.swipeX || new Animated.Value(0), {
                toValue: 0,
                useNativeDriver: true,
                tension: 100,
                friction: 10,
              }).start(() => {
                if (!offerAnimations[offer.id]) return;
                const currentProgress = (offerAnimations[offer.id]?.acceptProgress as any)?._value || 0;
                const remainingDuration = (1 - currentProgress) * 10000;
                if (remainingDuration > 0) {
                  Animated.timing(offerAnimations[offer.id].acceptProgress, {
                    toValue: 1,
                    duration: remainingDuration,
                    useNativeDriver: false,
                  }).start(() => {
                    if (!offerAnimations[offer.id]) return;
                    Animated.timing(offerAnimations[offer.id].cardSlide, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: true,
                      }).start(() => {
                        setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
                        delete offerAnimations[offer.id];
                        delete offerCardPanResponders[offer.id];
                      });
                  });
                }
              });
            }
          },
        });
        
        setDriverOffers(prev => [...prev, offer]);
        setViewingDrivers([]);
        
        chimePlayer.seekTo(0);
        chimePlayer.play();
        
        Animated.spring(offerAnimations[offer.id].slideIn, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
        
        Animated.timing(offerAnimations[offer.id].acceptProgress, {
          toValue: 1,
          duration: 10000,
          useNativeDriver: false,
        }).start(() => {
          if (!offerAnimations[offer.id]) return;
          Animated.timing(offerAnimations[offer.id].cardSlide, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }).start(() => {
              setDriverOffers(prev => prev.filter(o => o.id !== offer.id));
              delete offerAnimations[offer.id];
              delete offerCardPanResponders[offer.id];
            });
        });
      }, (index + 1) * 3000);
    });
  };

  const openCancelConfirmSheet = () => {
    if (committedFareRaise === 0 && searchFareAdjustment === 0) {
      setShowNoFareRaiseCancelSheet(true);
      Animated.spring(noFareRaiseCancelSheetAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start();
    } else {
      setShowCancelConfirmSheet(true);
      Animated.spring(cancelConfirmSheetAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start();
    }
  };

  const closeNoFareRaiseCancelSheet = () => {
    Animated.timing(noFareRaiseCancelSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowNoFareRaiseCancelSheet(false);
    });
  };

  const handleSearchHigherFare = () => {
    closeNoFareRaiseCancelSheet();
    setSearchFareAdjustment(10);
    setCommittedFareRaise(10);
    showFareRaisedNotification();
  };

  const handleConfirmCancelFromNoFare = () => {
    closeNoFareRaiseCancelSheet();
    setIsSearchingDriver(false);
    setDriverOffers([]);
    setViewingDrivers([]);
    setShowRaiseFareSheet(false);
    setAvailableDrivers([]);
    setFareViewers([]);
    setHasRespondedToFarePopup(false);
    setCommittedFareRaise(0);
    raiseFareSheetAnim.setValue(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    searchProgressAnim.stopAnimation();
  };

  const openPromoCodeSheet = () => {
    setShowPromoCodeSheet(true);
    setPromoCode('');
    setPromoCodeError('');
    Animated.spring(promoCodeSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  };

  const openDestinationsSheet = () => {
    setShowDestinationsSheet(true);
    Animated.spring(destinationsSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start();
  };

  const closeDestinationsSheet = () => {
    Animated.timing(destinationsSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowDestinationsSheet(false);
    });
  };

  const removeDestination = (index: number) => {
    if (destinations.length > 1) {
      const newDestinations = destinations.filter((_, i) => i !== index);
      setDestinations(newDestinations);
    }
  };

  const ITEM_HEIGHT = 65;

  const getItemAnimatedValue = (index: number) => {
    if (!itemAnimatedValues[index]) {
      itemAnimatedValues[index] = new Animated.Value(0);
    }
    return itemAnimatedValues[index];
  };

  const createDragResponder = (index: number) => {
    let startY = 0;
    let currentIndex = index;
    
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setDraggingIndex(index);
        startY = 0;
        currentIndex = index;
        dragY.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        dragY.setValue(gestureState.dy);
        
        const newIndex = Math.round((gestureState.dy) / ITEM_HEIGHT) + index;
        const clampedNewIndex = Math.max(0, Math.min(destinations.length - 1, newIndex));
        
        if (clampedNewIndex !== currentIndex) {
          destinations.forEach((_, i) => {
            if (i === index) return;
            
            const itemAnim = getItemAnimatedValue(i);
            let targetValue = 0;
            
            if (index < clampedNewIndex) {
              if (i > index && i <= clampedNewIndex) {
                targetValue = -ITEM_HEIGHT;
              }
            } else if (index > clampedNewIndex) {
              if (i >= clampedNewIndex && i < index) {
                targetValue = ITEM_HEIGHT;
              }
            }
            
            Animated.spring(itemAnim, {
              toValue: targetValue,
              useNativeDriver: true,
              tension: 300,
              friction: 20,
            }).start();
          });
          
          currentIndex = clampedNewIndex;
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const newIndex = Math.round((gestureState.dy) / ITEM_HEIGHT) + index;
        const clampedNewIndex = Math.max(0, Math.min(destinations.length - 1, newIndex));
        
        Object.keys(itemAnimatedValues).forEach((key) => {
          itemAnimatedValues[parseInt(key)].setValue(0);
        });
        
        if (clampedNewIndex !== index) {
          const newDestinations = [...destinations];
          const [removed] = newDestinations.splice(index, 1);
          newDestinations.splice(clampedNewIndex, 0, removed);
          setDestinations(newDestinations);
        }
        
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 300,
          friction: 20,
        }).start(() => {
          setDraggingIndex(null);
        });
      },
      onPanResponderTerminate: () => {
        Object.keys(itemAnimatedValues).forEach((key) => {
          itemAnimatedValues[parseInt(key)].setValue(0);
        });
        
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 300,
          friction: 20,
        }).start(() => {
          setDraggingIndex(null);
        });
      },
    });
  };

  

  const formatTotalDuration = () => {
    const dur = totalRouteDuration || duration;
    if (!dur) return '';
    if (dur >= 60) {
      const hours = Math.floor(dur / 60);
      const mins = dur % 60;
      return `~${hours} hr${hours > 1 ? 's' : ''}${mins > 0 ? `, ${mins} min` : ''}`;
    }
    return `~${dur} min`;
  };

  const closePromoCodeSheet = () => {
    Animated.timing(promoCodeSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowPromoCodeSheet(false);
      setPromoCode('');
      setPromoCodeError('');
    });
  };

  const handleApplyPromoCode = () => {
    if (!promoCode.trim()) return;
    
    setIsValidatingPromo(true);
    setPromoCodeError('');
    
    setTimeout(() => {
      setIsValidatingPromo(false);
      if (promoCode.toUpperCase() === 'PROMO2026') {
        closePromoCodeSheet();
      } else {
        setPromoCodeError('Promo code is not valid');
      }
    }, 1500);
  };

  const closeCancelConfirmSheet = () => {
    Animated.timing(cancelConfirmSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowCancelConfirmSheet(false);
    });
  };

  const handleCancelRequest = () => {
    closeCancelConfirmSheet();
    setIsSearchingDriver(false);
    setDriverOffers([]);
    setViewingDrivers([]);
    setShowRaiseFareSheet(false);
    setAvailableDrivers([]);
    setFareViewers([]);
    setHasRespondedToFarePopup(false);
    setCommittedFareRaise(0);
    raiseFareSheetAnim.setValue(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    searchProgressAnim.stopAnimation();
  };

  const showFareRaisedNotification = () => {
    setShowFareRaisedToast(true);
    Animated.timing(fareRaisedToastAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
    
    setTimeout(() => {
      Animated.timing(fareRaisedToastAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowFareRaisedToast(false);
      });
    }, 2000);
  };

  const handleRaiseFare = () => {
    setSearchFareAdjustment(prev => prev + 5);
    setShowRaiseFareSheet(false);
    raiseFareSheetAnim.setValue(0);
    setAvailableDrivers([]);
    setFareViewers([]);
    setHasRespondedToFarePopup(true);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    searchProgressAnim.setValue(0);
    showFareRaisedNotification();
  };

  const handleKeepFare = () => {
    setShowRaiseFareSheet(false);
    raiseFareSheetAnim.setValue(0);
    setAvailableDrivers([]);
    setFareViewers([]);
    setHasRespondedToFarePopup(true);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    searchProgressAnim.setValue(0);
  };

  const adjustSearchFare = (amount: number) => {
    setSearchFareAdjustment(prev => prev + amount);
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAcceptOffer = (offer: DriverOffer) => {
    if (offerAnimations[offer.id]?.timeoutId) {
      clearTimeout(offerAnimations[offer.id].timeoutId);
    }
    router.push({
      pathname: "/ride-tracking",
      params: {
        pickup,
        destination,
        pickupLat,
        pickupLng,
        destLat,
        destLng,
        price: `${offer.price}`,
        driverName: offer.name,
        driverPhoto: offer.photo,
        driverRating: `${offer.rating}`,
        driverVehicle: offer.vehicle,
      },
    } as any);
  };

  const handleDeclineOffer = (offerId: string) => {
    if (offerAnimations[offerId]?.timeoutId) {
      clearTimeout(offerAnimations[offerId].timeoutId);
    }
    offerAnimations[offerId]?.acceptProgress?.stopAnimation();
    Animated.timing(offerAnimations[offerId]?.swipeX || new Animated.Value(0), {
      toValue: -SCREEN_WIDTH - 50,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setDriverOffers(prev => prev.filter(o => o.id !== offerId));
      delete offerAnimations[offerId];
      delete offerCardPanResponders[offerId];
    });
  };

  const getTierColor = (tier: DriverOffer['tier']) => {
    switch (tier) {
      case 'platinum': return '#10B981';
      case 'gold': return '#F59E0B';
      case 'silver': return '#9CA3AF';
      default: return 'transparent';
    }
  };

  const getTierLabel = (tier: DriverOffer['tier']) => {
    switch (tier) {
      case 'platinum': return 'Platinum driver';
      case 'gold': return 'Gold driver';
      case 'silver': return 'Silver driver';
      default: return null;
    }
  };

  const truncateAddress = (address: string, maxLength: number = 45) => {
    if (address.length <= maxLength) return address;
    return address.substring(0, maxLength) + "...";
  };

  const handleMapRegionChange = () => {
    if (initialRegionSet.current && initialDelayPassedRef.current && !isMapMoved && !detectionPausedRef.current) {
      setIsMapMoved(true);
      Animated.spring(recenterButtonAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start();
    }
  };

  const handleMapDragStart = () => {
    if (mapDragTimeoutRef.current) {
      clearTimeout(mapDragTimeoutRef.current);
    }
    
    if (!isMapDragging.current && !isSearchingDriver && !isExpanded) {
      isMapDragging.current = true;
      Animated.parallel([
        Animated.timing(bottomSheetHeight, {
          toValue: BOTTOM_SHEET_MAP_DRAG_HEIGHT,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(fixedBottomSlideAnim, {
          toValue: FIXED_BOTTOM_HEIGHT + insets.bottom + 50,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(topButtonsHideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
      currentHeight.current = BOTTOM_SHEET_MAP_DRAG_HEIGHT;
    }
  };

  const handleMapDragEnd = () => {
    if (mapDragTimeoutRef.current) {
      clearTimeout(mapDragTimeoutRef.current);
    }
    
    mapDragTimeoutRef.current = setTimeout(() => {
      if (isMapDragging.current && !isExpanded) {
        isMapDragging.current = false;
        Animated.parallel([
          Animated.spring(bottomSheetHeight, {
            toValue: BOTTOM_SHEET_MIN_HEIGHT,
            useNativeDriver: false,
            tension: 100,
            friction: 12,
          }),
          Animated.spring(fixedBottomSlideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 12,
          }),
          Animated.spring(topButtonsHideAnim, {
            toValue: 1,
            useNativeDriver: true,
            tension: 100,
            friction: 12,
          }),
        ]).start();
        currentHeight.current = BOTTOM_SHEET_MIN_HEIGHT;
      }
    }, 100);
  };

  const handleRecenterMap = () => {
    if (mapRef.current && routeCoords.length > 0) {
      // Hide button immediately
      setIsMapMoved(false);
      Animated.timing(recenterButtonAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Pause detection for 10 seconds
      detectionPausedRef.current = true;
      if (detectionTimeoutRef.current) {
        clearTimeout(detectionTimeoutRef.current);
      }

      const allCoords = [
        { latitude: pickupLat, longitude: pickupLng },
        ...routeCoords,
        { latitude: destLat, longitude: destLng },
      ];
      mapRef.current.fitToCoordinates(allCoords, {
        edgePadding: { top: 120, right: 100, bottom: 500, left: 100 },
        animated: true,
      });

      // Re-enable detection after 10 seconds
      detectionTimeoutRef.current = setTimeout(() => {
        detectionPausedRef.current = false;
      }, 10000);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    calcModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 32,
    },
    calcModalCard: {
      width: "100%" as const,
      maxWidth: 320,
      backgroundColor: colors.card,
      borderRadius: 20,
      paddingVertical: 32,
      paddingHorizontal: 24,
      alignItems: "center" as const,
    },
    calcModalTitle: {
      marginTop: 18,
      fontSize: 18,
      fontWeight: "700" as const,
      color: colors.text,
    },
    calcModalSubtitle: {
      marginTop: 8,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      textAlign: "center" as const,
    },
    menuSideContainer: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      bottom: 0,
      width: MENU_WIDTH,
      zIndex: 1,
    },
    mainContentContainer: {
      flex: 1,
      backgroundColor: colors.background,
      zIndex: 2,
    },
    menuOverlayTouchable: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
    },
    menuOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "#000",
    },
    mapContainer: {
      flex: 1,
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    map: {
      flex: 1,
    },
    mapSearching: {
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT + 365,
      marginTop: -365,
    },
    topOverlay: {
      position: "absolute" as const,
      top: insets.top + 8,
      left: 16,
      right: 16,
      backgroundColor: colors.background === "#000000" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      zIndex: 1100,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.background === "#000000" ? 0.3 : 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    locationRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      marginBottom: 12,
    },
    locationRowLast: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      marginBottom: 0,
    },
    locationIconContainer: {
      alignItems: "center" as const,
      marginRight: 12,
      width: 18,
    },
    locationDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 4,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    pickupDot: {
      borderColor: "#22C55E",
      backgroundColor: colors.background,
    },
    destDot: {
      borderColor: "#EF4444",
      backgroundColor: colors.background,
    },
    locationConnector: {
      width: 3,
      height: 20,
      backgroundColor: "#22C55E",
      marginVertical: -4,
    },
    locationText: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      fontWeight: "500" as const,
    },
    destTextContainer: {
      flex: 1,
      flexDirection: "column" as const,
    },
    destAddressText: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      fontWeight: "500" as const,
    },
    durationText: {
      fontSize: 15,
      color: "#6e6d72",
      fontWeight: "500" as const,
    },
    entranceButton: {
      backgroundColor: colors.gray[100],
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
      marginLeft: 10,
    },
    entranceText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "500" as const,
    },
    addButton: {
      marginLeft: 10,
      backgroundColor: colors.accent,
      borderRadius: 16,
      width: 32,
      height: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    backButton: {
      position: "absolute" as const,
      bottom: SCREEN_HEIGHT * 0.50 + 110,
      left: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background === "#000000" ? "rgba(30, 30, 30, 0.9)" : "rgba(255, 255, 255, 0.95)",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.background === "#000000" ? 0.3 : 0.15,
      shadowRadius: 6,
      elevation: 3,
    },
    recenterButton: {
      position: "absolute" as const,
      bottom: SCREEN_HEIGHT * 0.50 + 110,
      right: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background === "#000000" ? "rgba(30, 30, 30, 0.9)" : "rgba(255, 255, 255, 0.95)",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.background === "#000000" ? 0.3 : 0.15,
      shadowRadius: 6,
      elevation: 3,
    },
    bottomSheet: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.gray[50],
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      zIndex: 1200,
    },
    promoBanner: {
      backgroundColor: colors.gray[50],
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.gray[200],
    },
    promoBannerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    promoBannerText: {
      flex: 1,
      fontSize: 14,
      fontWeight: "500" as const,
      color: colors.text,
      marginLeft: 10,
    },
    fixedBottomContainer: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.gray[50],
      paddingBottom: insets.bottom,
      zIndex: 1400,
    },
    dragHandleArea: {
      width: "100%" as const,
      alignItems: "center" as const,
      paddingVertical: 12,
    },
    dragHandle: {
      width: 36,
      height: 4,
      backgroundColor: colors.gray[300],
      borderRadius: 2,
    },
    rideOptionsContainer: {
      paddingHorizontal: 12,
      flex: 1,
    },
    collapsedCarouselContainer: {
      flex: 1,
      paddingHorizontal: 12,
    },
    collapsedCarousel: {
      flex: 1,
    },
    collapsedCarouselContent: {
      paddingTop: 20,
      paddingBottom: 210,
    },
    rideListSpacer: {
      height: 0,
    },
    collapsedRideCard: {
      backgroundColor: "transparent",
      borderRadius: 12,
      marginBottom: 0,
    },
    collapsedRideCardSelected: {
      backgroundColor: colors.gray[100],
      borderRadius: 24,
      borderWidth: 2,
      borderColor: colors.gray[100],
      overflow: "hidden" as const,
      padding: 2,
      paddingBottom: 0,
    },
    collapsedRideContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 14,
      paddingHorizontal: 12,
    },
    collapsedRideContentSelected: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.gray[200],
      borderRadius: 22,
    },
    selectedRideContainer: {
      backgroundColor: colors.gray[100],
      borderRadius: 24,
      marginBottom: 0,
      overflow: "hidden" as const,
      borderWidth: 2,
      borderColor: colors.gray[100],
      padding: 2,
      paddingBottom: 0,
    },
    selectedRideCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.gray[200],
      borderRadius: 22,
    },
    rideOptionCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 14,
      paddingHorizontal: 12,
      marginBottom: 0,
      borderRadius: 12,
    },
    rideCarImageContainer: {
      width: 72,
      height: 45,
      marginRight: 14,
    },
    rideCarImage: {
      width: 72,
      height: 45,
      borderRadius: 4,
    },
    rideOptionInfo: {
      flex: 1,
    },
    rideOptionTitleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    rideOptionTitle: {
      fontSize: 16,
      fontWeight: "500" as const,
      color: colors.text,
      marginRight: 4,
    },
    rideOptionCapacity: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      marginTop: 3,
    },
    rideCapacityText: {
      fontSize: 14,
      color: colors.textSecondary,
      marginLeft: 3,
    },
    rideOptionDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    rideOptionPrice: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    editButton: {
      padding: 8,
    },
    fareSection: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 5,
      paddingTop: 20,
      paddingBottom: 5,
    },
    fareButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.background === "#FFFFFF" ? "#FFFFFF" : colors.gray[200],
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    fareCenter: {
      alignItems: "center" as const,
      flex: 1,
    },
    fareAmount: {
      fontSize: 22,
      fontWeight: "600" as const,
      color: colors.text,
    },
    fareLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    tollChargesRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      marginTop: 8,
      backgroundColor: colors.gray[200],
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    tollChargesText: {
      fontSize: 13,
      color: "#FF9500",
      fontWeight: "500" as const,
    },
    tollTotalLineRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginTop: 6,
      paddingHorizontal: 4,
    },
    tollTotalLineLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: "500" as const,
    },
    tollTotalLineAmount: {
      fontSize: 13,
      color: "#FF9500",
      fontWeight: "700" as const,
    },
    tollSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      justifyContent: "flex-end" as const,
    },
    tollSheetContainer: {
      backgroundColor: colors.gray[50],
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
      maxHeight: SCREEN_HEIGHT * 0.5,
    },
    tollSheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tollSheetTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
    },
    tollSheetClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.gray[200],
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    tollListContainer: {
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    tollItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tollItemLast: {
      borderBottomWidth: 0,
    },
    tollItemIcon: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: "#FF9500",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginRight: 14,
    },
    tollItemInfo: {
      flex: 1,
    },
    tollItemName: {
      fontSize: 15,
      fontWeight: "500" as const,
      color: colors.text,
    },
    tollItemPrice: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    tollItemCoords: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
      fontVariant: ["tabular-nums"] as const,
    },
    tollTotalRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: colors.gray[100],
      marginTop: 12,
    },
    tollTotalLabel: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.text,
    },
    tollTotalAmount: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: "#FF9500",
    },
    disclaimerBox: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: colors.gray[100],
      marginHorizontal: 16,
      marginTop: 16,
      marginBottom: 150,
      padding: 14,
      borderRadius: 12,
    },
    disclaimerIcon: {
      marginRight: 10,
    },
    disclaimerText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    autoAcceptRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    autoAcceptLeft: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    autoAcceptIcon: {
      marginRight: 10,
    },
    autoAcceptText: {
      fontSize: 14,
      color: colors.text,
    },
    bottomBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    paymentIcon: {
      width: 36,
      height: 36,
      borderRadius: 6,
      backgroundColor: colors.gray[100],
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    findDriverButton: {
      flex: 1,
      backgroundColor: "#ff007f",
      borderRadius: 12,
      paddingVertical: 16,
      marginHorizontal: 12,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    findDriverText: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: colors.text,
    },
    settingsIcon: {
      width: 36,
      height: 36,
      borderRadius: 6,
      backgroundColor: colors.gray[100],
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    paymentSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      justifyContent: "flex-end" as const,
    },
    paymentSheetContainer: {
      backgroundColor: colors.gray[50],
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
    },
    paymentSheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    paymentSheetTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
    },
    paymentSheetClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.gray[200],
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    paymentOption: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    paymentOptionSelected: {
      backgroundColor: "rgba(74, 144, 217, 0.15)",
    },
    paymentOptionIcon: {
      width: 40,
      height: 40,
      borderRadius: 8,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginRight: 14,
    },
    cashIcon: {
      backgroundColor: "#2E7D32",
    },
    duitnowIcon: {
      backgroundColor: "#E91E63",
    },
    paymentOptionText: {
      flex: 1,
      fontSize: 16,
      fontWeight: "500" as const,
      color: colors.text,
    },
    paymentCheckIcon: {
      marginLeft: 10,
    },
    tollBadge: {
      position: "absolute" as const,
      top: SCREEN_HEIGHT * 0.25,
      left: SCREEN_WIDTH * 0.35,
      backgroundColor: colors.gray[50],
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 4,
    },
    tollText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "500" as const,
    },
    entranceSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      justifyContent: "flex-end" as const,
      zIndex: 1100,
    },
    entranceSheetContainer: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    entranceSheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 20,
      paddingVertical: 18,
    },
    entranceSheetTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
      flex: 1,
      textAlign: "center" as const,
    },
    entranceSheetClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "#e5e5e5",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    entranceSheetPlaceholder: {
      width: 32,
    },
    entranceDisplayContainer: {
      paddingHorizontal: 20,
      paddingVertical: 24,
      borderBottomWidth: 1,
      borderBottomColor: "#e5e5e5",
    },
    entranceDisplayText: {
      fontSize: 48,
      fontWeight: "400" as const,
      color: colors.text,
      textAlign: "center" as const,
      minHeight: 60,
    },
    entranceDoneButton: {
      backgroundColor: "#ff007f",
      marginHorizontal: 20,
      marginTop: 20,
      marginBottom: 16,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    entranceDoneText: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
    },
    keypadContainer: {
      backgroundColor: "#d1d5db",
      paddingHorizontal: 6,
      paddingTop: 10,
      paddingBottom: insets.bottom + 10,
    },
    keypadRow: {
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      marginBottom: 8,
    },
    keypadButton: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: colors.background,
      borderRadius: 8,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginHorizontal: 3,
    },
    keypadButtonEmpty: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: "transparent",
      marginHorizontal: 3,
    },
    keypadButtonBackspace: {
      width: (SCREEN_WIDTH - 36) / 3,
      height: 52,
      backgroundColor: "transparent",
      borderRadius: 8,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginHorizontal: 3,
    },
    keypadNumber: {
      fontSize: 28,
      fontWeight: "400" as const,
      color: colors.text,
    },
    keypadLetters: {
      fontSize: 10,
      fontWeight: "600" as const,
      color: colors.text,
      letterSpacing: 2,
      marginTop: -2,
    },
    cancelRequestButton: {
      position: "absolute" as const,
      top: insets.top + 8,
      left: 16,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: "#FFE4E6",
      borderRadius: 20,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    cancelRequestText: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.text,
      marginLeft: 8,
    },
    driverOffersOverlay: {
      position: "absolute" as const,
      top: insets.top + 60,
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    chooseDriverTitle: {
      fontSize: 26,
      fontWeight: "700" as const,
      color: colors.text,
      marginBottom: 16,
    },
    driverOffersScroll: {
      flex: 1,
    },
    driverOfferCard: {
      backgroundColor: colors.background,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    },
    driverOfferHeader: {
      flexDirection: "row" as const,
      marginBottom: 12,
    },
    driverPhotoContainer: {
      position: "relative" as const,
      marginRight: 12,
    },
    driverPhoto: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: "#7C3AED",
    },
    driverBadge: {
      position: "absolute" as const,
      bottom: -2,
      right: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#7C3AED",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      borderWidth: 2,
      borderColor: "#fff",
    },
    driverBadgeText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "700" as const,
    },
    driverInfoContainer: {
      flex: 1,
    },
    driverNameRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    driverName: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
      marginRight: 6,
    },
    driverRatingContainer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    driverRating: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.text,
      marginLeft: 3,
    },
    driverRides: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    driverVehicle: {
      fontSize: 14,
      color: "#374151",
      marginTop: 2,
    },
    driverTier: {
      fontSize: 13,
      fontWeight: "500" as const,
      marginTop: 2,
    },
    driverEtaContainer: {
      alignItems: "flex-end" as const,
    },
    driverEta: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.text,
    },
    driverDistance: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    ltfrbNumber: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    driverPrice: {
      fontSize: 32,
      fontWeight: "700" as const,
      color: colors.text,
      marginBottom: 14,
    },
    offerButtonsRow: {
      flexDirection: "row" as const,
      gap: 12,
    },
    declineButton: {
      flex: 1,
      backgroundColor: "#F3F4F6",
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    declineButtonText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    acceptButton: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      overflow: "hidden" as const,
    },
    acceptButtonBackground: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row" as const,
    },
    acceptButtonUnfilled: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "#ff007f",
    },
    acceptButtonFilled: {
      position: "absolute" as const,
      top: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "#ce2883",
    },
    acceptButtonText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    searchingBottomSheet: {
      position: "absolute" as const,
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom,
    },
    searchingContent: {
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    searchingHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      marginBottom: 12,
    },
    searchingTitle: {
      fontSize: 18,
      fontWeight: "500" as const,
      color: colors.text,
    },
    searchingTimer: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
    },
    searchProgressBar: {
      height: 4,
      backgroundColor: "#E5E5E5",
      borderRadius: 2,
      marginBottom: 24,
      overflow: "hidden" as const,
    },
    searchProgressFill: {
      height: "100%" as const,
      backgroundColor: "#000",
      borderRadius: 2,
    },
    searchProgressFillStatic: {
      height: "100%" as const,
      width: "100%" as const,
      backgroundColor: "#D1D5DB",
      borderRadius: 2,
    },
    searchFareSection: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 16,
    },
    searchFareButton: {
      width: 100,
      height: 48,
      borderRadius: 8,
      backgroundColor: "#F5F5F5",
      borderWidth: 1,
      borderColor: "#E5E5E5",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    searchFareButtonDisabled: {
      width: 100,
      height: 48,
      borderRadius: 8,
      backgroundColor: "#F5F5F5",
      borderWidth: 1,
      borderColor: "#E5E5E5",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      opacity: 0.5,
    },
    searchFareButtonText: {
      fontSize: 18,
      fontWeight: "500" as const,
      color: colors.text,
    },
    searchFareButtonTextDisabled: {
      fontSize: 18,
      fontWeight: "500" as const,
      color: colors.textSecondary,
    },
    searchFareCenter: {
      paddingHorizontal: 32,
      alignItems: "center" as const,
    },
    searchFareAmount: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.text,
    },
    raiseFareButton: {
      backgroundColor: "#ff007f",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      marginBottom: 16,
    },
    raiseFareButtonDisabled: {
      backgroundColor: "#F3F4F6",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      marginBottom: 16,
    },
    raiseFareText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    raiseFareTextDisabled: {
      fontSize: 16,
      fontWeight: "500" as const,
      color: colors.textSecondary,
    },
    searchAutoAcceptRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: "#E5E5E5",
    },
    searchAutoAcceptLeft: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flex: 1,
    },
    searchAutoAcceptIcon: {
      marginRight: 12,
    },
    searchAutoAcceptText: {
      fontSize: 15,
      color: colors.text,
      flex: 1,
    },
    searchPaymentRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: "#E5E5E5",
    },
    searchPaymentIcon: {
      width: 32,
      height: 32,
      marginRight: 12,
    },
    searchPaymentText: {
      fontSize: 15,
      color: colors.text,
    },
    viewingDriversContainer: {
      position: "absolute" as const,
      left: 0,
      right: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      backgroundColor: "#E0F7FA",
      paddingHorizontal: 20,
      paddingTop: 6,
      paddingBottom: 22,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    viewingDriversText: {
      fontSize: 15,
      fontWeight: "500" as const,
      color: colors.text,
      flex: 1,
    },
    viewingDriversAvatars: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    viewingDriverAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: "#fff",
    },
    viewingDriverAvatarOverlap: {
      marginLeft: -12,
    },
    viewingDriversBarPosition: {
      bottom: 328 + insets.bottom,
    },
    raiseFareSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end" as const,
    },
    raiseFareSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 16,
    },
    raiseFareContent: {
      paddingHorizontal: 20,
      paddingTop: 24,
    },
    raiseFareTitle: {
      fontSize: 24,
      fontWeight: "700" as const,
      color: colors.text,
      marginBottom: 8,
    },
    raiseFareSubtitleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginBottom: 20,
    },
    raiseFareSubtitle: {
      fontSize: 15,
      color: colors.text,
      lineHeight: 20,
    },
    fareViewersAvatars: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    fareViewerAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: "#fff",
    },
    fareViewerAvatarOverlap: {
      marginLeft: -10,
    },
    availableDriverCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: "#F5F5F5",
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    availableDriverPhoto: {
      width: 48,
      height: 48,
      borderRadius: 24,
      marginRight: 12,
    },
    availableDriverInfo: {
      flex: 1,
    },
    availableDriverRatingRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    availableDriverRating: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.text,
      marginLeft: 4,
    },
    availableDriverRides: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    availableDriverName: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    availableDriverEtaContainer: {
      alignItems: "flex-end" as const,
    },
    availableDriverEta: {
      fontSize: 14,
      fontWeight: "500" as const,
      color: colors.text,
    },
    availableDriverDistance: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    raiseFareActionButton: {
      backgroundColor: "#ff007f",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginTop: 16,
    },
    raiseFareActionText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    keepFareButton: {
      backgroundColor: colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#E5E5E5",
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginTop: 10,
    },
    keepFareText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    fareRaisedToast: {
      position: "absolute" as const,
      bottom: 15 + insets.bottom,
      left: 20,
      right: 20,
      backgroundColor: colors.gray[50],
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    fareRaisedToastIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.background,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginRight: 12,
    },
    fareRaisedToastText: {
      fontSize: 15,
      fontWeight: "500" as const,
      color: colors.text,
    },
    cancelConfirmSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end" as const,
    },
    cancelConfirmSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
      paddingHorizontal: 20,
      paddingTop: 28,
    },
    cancelConfirmTitle: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: colors.text,
      textAlign: "center" as const,
      marginBottom: 28,
    },
    keepSearchingButton: {
      backgroundColor: "#ff007f",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 12,
    },
    keepSearchingText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    confirmCancelButton: {
      backgroundColor: "#F3F4F6",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    confirmCancelText: {
      fontSize: 16,
      fontWeight: "500" as const,
      color: colors.text,
    },
    noFareRaiseCancelSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end" as const,
    },
    noFareRaiseCancelSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    noFareRaiseCancelHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      marginBottom: 8,
    },
    noFareRaiseCancelTitle: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: colors.text,
      flex: 1,
      lineHeight: 28,
    },
    noFareRaiseCancelClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "#F3F4F6",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginLeft: 12,
    },
    noFareRaiseCancelSubtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      marginBottom: 20,
    },
    searchHigherFareButton: {
      backgroundColor: "#ff007f",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: 8,
    },
    searchHigherFareText: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: colors.text,
    },
    searchHigherFareHint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center" as const,
      marginBottom: 16,
    },
    wantToCancelButton: {
      backgroundColor: "#F3F4F6",
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    wantToCancelText: {
      fontSize: 16,
      fontWeight: "500" as const,
      color: colors.text,
    },
    promoCodeSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end" as const,
    },
    promoCodeSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    promoCodeHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      marginBottom: 8,
    },
    promoCodeTitle: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: colors.text,
    },
    promoCodeClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "#F3F4F6",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoCodeSubtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      marginBottom: 24,
      lineHeight: 20,
    },
    promoCodeInputRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
    },
    promoCodeInputContainer: {
      flex: 1,
    },
    promoCodeInputWrapper: {
      borderWidth: 1,
      borderColor: "#E5E5E5",
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 10,
      paddingRight: 50,
      backgroundColor: colors.background,
      position: "relative" as const,
    },
    promoCodeInputWrapperError: {
      borderWidth: 1,
      borderColor: "#EF4444",
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 10,
      paddingRight: 50,
      backgroundColor: colors.background,
      position: "relative" as const,
    },
    promoCodeInputLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    promoCodeInputInner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    promoCodeInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      padding: 0,
      minHeight: 24,
    },
    promoCodeClearButton: {
      position: "absolute" as const,
      right: 10,
      top: 0,
      bottom: 0,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoCodeClearCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: '#696a6e',
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoCodeErrorText: {
      fontSize: 13,
      color: "#EF4444",
      marginTop: 8,
    },
    promoCodeSubmitButton: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: "#ff007f",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoCodeSubmitButtonDisabled: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: "#ff007f",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      opacity: 0.7,
    },
    promoCodeSubmitButtonInactive: {
      width: 56,
      height: 56,
      borderRadius: 12,
      backgroundColor: "#E5E5E5",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoLoadingSpinnerContainer: {
      width: 28,
      height: 28,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoLoadingSpinner: {
      width: 24,
      height: 24,
      borderRadius: 12,
      position: "relative" as const,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    promoLoadingSpinnerTrack: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 3,
    },
    promoLoadingSpinnerHead: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 3,
      borderColor: "transparent",
    },
    destinationsSheetOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end" as const,
      zIndex: 1100,
    },
    destinationsSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 20,
      maxHeight: SCREEN_HEIGHT * 0.6,
    },
    destinationsSheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 16,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: "#E5E5E5",
    },
    destinationsSheetBack: {
      width: 32,
      height: 32,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    destinationsSheetTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.text,
    },
    destinationsSheetPlaceholder: {
      width: 32,
    },
    destinationsList: {
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    destinationItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#F3F4F6",
      backgroundColor: colors.background,
    },
    destinationItemDragging: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#F3F4F6",
      backgroundColor: "#F9FAFB",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 8,
      borderRadius: 8,
      zIndex: 999,
    },
    destinationItemDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      marginRight: 14,
      borderWidth: 2.5,
    },
    destinationItemDotMid: {
      borderColor: "#3B82F6",
    },
    destinationItemDotLast: {
      borderColor: "#EF4444",
    },
    destinationItemText: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      fontWeight: "400" as const,
    },
    destinationRemoveButton: {
      width: 36,
      height: 36,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      marginLeft: 8,
    },
    destinationDragHandle: {
      width: 36,
      height: 36,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    destinationDragHandleActive: {
      width: 36,
      height: 36,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      borderWidth: 2,
      borderColor: "#EF4444",
      borderRadius: 18,
    },
  });

  const getCarImage = (rideId: string) => {
    const found = EXTENDED_RIDE_TYPES.find((r) => r.id === rideId);
    if (found?.image) return found.image;
    return CAR_IMAGES[rideId as keyof typeof CAR_IMAGES] || CAR_IMAGES.economy;
  };

  const menuOverlayOpacity = menuRevealAnim.interpolate({
    inputRange: [0, MENU_WIDTH],
    outputRange: [0, 0.5],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Menu Side Sheet - positioned behind main content */}
      {(showMenuSideSheet || isMenuDragging) && (
        <View style={styles.menuSideContainer}>
          <MenuSideSheet
            visible={true}
            onClose={handleCloseMenuFromOverlay}
            inline={true}
          />
        </View>
      )}

      {/* Main Content Container that slides */}
      <Animated.View
        style={[
          styles.mainContentContainer,
          {
            transform: [{ translateX: menuRevealAnim }],
          },
        ]}
      >
      
      {/* Map Background */}
      <View style={styles.mapContainer}>
        {Platform.OS !== "web" ? (
          <MapView
            ref={mapRef}
            style={isSearchingDriver ? styles.mapSearching : styles.map}
            initialRegion={{
              latitude: (pickupLat + destLat) / 2,
              longitude: (pickupLng + destLng) / 2,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            }}
            customMapStyle={darkMapStyle}
            scrollEnabled={!isSearchingDriver}
            zoomEnabled={!isSearchingDriver}
            rotateEnabled={!isSearchingDriver}
            pitchEnabled={!isSearchingDriver}
            onMapReady={() => {
              console.log("Map is ready");
              if (mapRef.current) {
                setTimeout(() => {
                  mapRef.current?.fitToCoordinates(
                    [
                      { latitude: pickupLat, longitude: pickupLng },
                      { latitude: destLat, longitude: destLng },
                    ],
                    {
                      edgePadding: { top: 120, right: 100, bottom: 500, left: 100 },
                      animated: true,
                    }
                  );
                  setTimeout(() => {
                    initialRegionSet.current = true;
                  }, 500);
                }, 300);
              }
            }}
            onRegionChange={() => {
              handleMapRegionChange();
              handleMapDragStart();
            }}
            onRegionChangeComplete={handleMapDragEnd}
          >
            {/* Pickup marker */}
            <Marker
              coordinate={{ latitude: pickupLat, longitude: pickupLng }}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={isSearchingDriver}
            >
              {isSearchingDriver ? (
                <View style={{ alignItems: "center", width: SCREEN_WIDTH, height: SCREEN_WIDTH }}>
                  {/* Pulse rings */}
                  <Animated.View
                    style={{
                      position: "absolute",
                      top: SCREEN_WIDTH / 2 - 23,
                      left: SCREEN_WIDTH / 2 - 23,
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      borderWidth: 23,
                      borderColor: "#FFFFFF",
                      opacity: pulse1Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 0],
                      }),
                      transform: [{
                        scale: pulse1Anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, (SCREEN_WIDTH * 0.30) / 46],
                        }),
                      }],
                    }}
                  />
                  <Animated.View
                    style={{
                      position: "absolute",
                      top: SCREEN_WIDTH / 2 - 23,
                      left: SCREEN_WIDTH / 2 - 23,
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      borderWidth: 23,
                      borderColor: "#FFFFFF",
                      opacity: pulse2Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 0],
                      }),
                      transform: [{
                        scale: pulse2Anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, (SCREEN_WIDTH * 0.70) / 46],
                        }),
                      }],
                    }}
                  />
                  <Animated.View
                    style={{
                      position: "absolute",
                      top: SCREEN_WIDTH / 2 - 23,
                      left: SCREEN_WIDTH / 2 - 23,
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      borderWidth: 23,
                      borderColor: "#FFFFFF",
                      opacity: pulse3Anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 0],
                      }),
                      transform: [{
                        scale: pulse3Anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, (SCREEN_WIDTH * 1.1) / 46],
                        }),
                      }],
                    }}
                  />
                  {/* Main marker */}
                  <View style={{ position: "absolute", top: SCREEN_WIDTH / 2 - 23, left: SCREEN_WIDTH / 2 - 23, alignItems: "center" }}>
                    <View style={{
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      backgroundColor: "#4483e3",
                      justifyContent: "center",
                      alignItems: "center",
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 5,
                    }}>
                      <View style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: colors.gray[50],
                      }} />
                    </View>
                    <View style={{
                      width: 3,
                      height: 18,
                      backgroundColor: "#4483e3",
                      marginTop: -2,
                    }} />
                  </View>
                </View>
              ) : (
                <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                  <View style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.background,
                    borderWidth: 3,
                    borderColor: "#22C55E",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 3,
                    elevation: 5,
                  }} />
                </View>
              )}
            </Marker>
            
            {/* Intermediate stop markers - blue circles */}
            {!isSearchingDriver && destinations.length > 1 && destinations.slice(0, -1).map((dest, index) => (
              <Marker
                key={`stop-${index}`}
                coordinate={{ latitude: dest.lat, longitude: dest.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                  <View style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.background,
                    borderWidth: 3,
                    borderColor: "#3B82F6",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 3,
                    elevation: 5,
                  }} />
                </View>
              </Marker>
            ))}

            {/* Final destination marker - red circle */}
            {!isSearchingDriver && destinations.length > 0 && (
              <Marker
                coordinate={{ latitude: destLat, longitude: destLng }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                  <View style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: colors.background,
                    borderWidth: 3,
                    borderColor: "#EF4444",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 3,
                    elevation: 5,
                  }} />
                </View>
              </Marker>
            )}

            {/* Route polyline - hide during search */}
            {routeCoords.length > 0 && !isSearchingDriver && (
              <Polyline
                coordinates={routeCoords}
                strokeColor="#4A90D9"
                strokeWidth={4}
                lineDashPattern={undefined}
                lineCap="round"
                lineJoin="round"
              />
            )}

            {/* Real per-booth markers when the AI returned coordinates */}
            {!isSearchingDriver && displaySettings.showAiTollBooths && tollBooths.map((toll) => {
              if (typeof toll.latitude !== "number" || typeof toll.longitude !== "number") return null;
              return (
                <Marker
                  key={`tollmarker-${toll.id ?? `${toll.latitude},${toll.longitude}`}`}
                  coordinate={{ latitude: toll.latitude, longitude: toll.longitude }}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={false}
                  onPress={openTollSheet}
                >
                  <View style={{ alignItems: "center" }}>
                    <View style={{
                      backgroundColor: colors.background,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                      marginBottom: 4,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 2,
                      elevation: 3,
                    }}>
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: "600" as const }} numberOfLines={1}>
                        {toll.name ?? "Toll"}
                      </Text>
                    </View>
                    <Image
                      source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/rbcp6pta8wb645cowvq8g' }}
                      style={{ width: 32, height: 32, borderRadius: 16 }}
                      resizeMode="contain"
                    />
                  </View>
                </Marker>
              );
            })}

            {/* Fallback single toll icon at route midpoint when no booth coordinates exist */}
            {!isSearchingDriver && displaySettings.showAiTollBooths && tollBooths.length > 0 && tollBooths.every((t) => typeof t.latitude !== "number") && routeCoords.length > 0 && (() => {
              let midPoint;
              
              if (destinations.length > 1) {
                // If there are additional stops, show toll icon in the middle of last stop to drop location segment
                const lastIntermediateStop = destinations[destinations.length - 2];
                
                // Find the closest point in routeCoords to the last intermediate stop
                let closestIndex = 0;
                let minDistance = Infinity;
                
                for (let i = 0; i < routeCoords.length; i++) {
                  const coord = routeCoords[i];
                  const dist = Math.sqrt(
                    Math.pow(coord.latitude - lastIntermediateStop.lat, 2) +
                    Math.pow(coord.longitude - lastIntermediateStop.lng, 2)
                  );
                  if (dist < minDistance) {
                    minDistance = dist;
                    closestIndex = i;
                  }
                }
                
                // Calculate midpoint between last stop and end of route
                const segmentLength = routeCoords.length - closestIndex;
                const midIndex = closestIndex + Math.floor(segmentLength / 2);
                midPoint = routeCoords[Math.min(midIndex, routeCoords.length - 1)];
              } else {
                // If no additional stops, show toll icon in the middle of entire route
                const midIndex = Math.floor(routeCoords.length / 2);
                midPoint = routeCoords[midIndex];
              }
              
              return (
                <Marker
                  coordinate={{ latitude: midPoint.latitude, longitude: midPoint.longitude }}
                  anchor={{ x: 0.7, y: 0.8 }}
                  tracksViewChanges={false}
                >
                  <View style={{ alignItems: "flex-start" }}>
                    <View style={{
                      backgroundColor: colors.background,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 4,
                      marginBottom: 4,
                      marginLeft: -20,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 2,
                      elevation: 3,
                    }}>
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: "500" as const }}>Toll road</Text>
                    </View>
                    <View style={{ marginLeft: 30 }}>
                      <Image
                        source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/rbcp6pta8wb645cowvq8g' }}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                        }}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                </Marker>
              );
            })()}
          </MapView>
        ) : (
          <View style={[styles.map, { backgroundColor: "#1a1a1a" }]}>
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Map view</Text>
            </View>
          </View>
        )}
      </View>

      {/* Top Location Overlay - hide when searching or sheet is expanded */}
      {!isSearchingDriver && !isExpanded && <Animated.View style={styles.topOverlay} {...menuPanResponder.panHandlers}>
        <View style={{ flexDirection: "row" }}>
          <View style={styles.locationIconContainer}>
            <View style={[styles.locationDot, styles.pickupDot]} />
          </View>
          <TouchableOpacity 
            style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", marginBottom: 12 }}
            onPress={() => {
              setSkipNextLocationDetection(true);
              router.push({
                pathname: '/search',
                params: {
                  editingField: 'pickup',
                  currentPickup: pickup,
                  currentDestination: destination,
                  pickupLat: pickupLat.toString(),
                  pickupLng: pickupLng.toString(),
                  destLat: destLat.toString(),
                  destLng: destLng.toString(),
                },
              });
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.locationText}>
              {pickup}
            </Text>
            <TouchableOpacity style={styles.entranceButton} onPress={openEntranceSheet}>
              <Text style={styles.entranceText}>Entrance{entranceValue ? ` ${entranceValue}` : ''}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
        {destinations.length === 1 ? (
          <View style={{ flexDirection: "row" }}>
            <View style={styles.locationIconContainer}>
              <View style={[styles.locationDot, styles.destDot]} />
            </View>
            <TouchableOpacity 
              style={{ flex: 1, flexDirection: "row", alignItems: "flex-start" }}
              onPress={() => {
                setSkipNextLocationDetection(true);
                router.push({
                  pathname: '/search',
                  params: {
                    editingField: 'destination',
                    editingDestinationIndex: '0',
                    currentPickup: pickup,
                    currentDestination: destinations[0].address,
                    pickupLat: pickupLat.toString(),
                    pickupLng: pickupLng.toString(),
                    destLat: destinations[0].lat.toString(),
                    destLng: destinations[0].lng.toString(),
                    allDestinations: JSON.stringify(destinations),
                  },
                });
              }}
              activeOpacity={0.7}
            >
            <View style={styles.destTextContainer}>
              <Text style={styles.destAddressText}>
                {destinations[0].address}{duration && !isCalculatingFare ? <Text style={styles.durationText}>  {formatTotalDuration()}</Text> : ''}
              </Text>
            </View>
              {destinations.length < 5 && (
                <TouchableOpacity 
                  style={styles.addButton}
                  onPress={() => {
                    setSkipNextLocationDetection(true);
                    router.push({
                      pathname: '/search',
                      params: {
                        editingField: 'destination',
                        addingNewDestination: 'true',
                        currentPickup: pickup,
                        currentDestination: '',
                        pickupLat: pickupLat.toString(),
                        pickupLng: pickupLng.toString(),
                        allDestinations: JSON.stringify(destinations),
                      },
                    });
                  }}
                >
                  <Plus color="#fff" size={20} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: "row" }}>
            <View style={styles.locationIconContainer}>
              <View style={[styles.locationDot, styles.destDot]} />
            </View>
            <TouchableOpacity 
              style={{ flex: 1, flexDirection: "row", alignItems: "flex-start" }}
              onPress={openDestinationsSheet}
              activeOpacity={0.7}
            >
            <View style={styles.destTextContainer}>
              <Text style={styles.destAddressText}>
                {destinations.length} route stops{duration && !isCalculatingFare ? <Text style={styles.durationText}>  {formatTotalDuration()}</Text> : ''}
              </Text>
            </View>
              {destinations.length < 5 && (
                <TouchableOpacity 
                  style={styles.addButton}
                  onPress={() => {
                    setSkipNextLocationDetection(true);
                    router.push({
                      pathname: '/search',
                      params: {
                        editingField: 'destination',
                        addingNewDestination: 'true',
                        currentPickup: pickup,
                        currentDestination: '',
                        pickupLat: pickupLat.toString(),
                        pickupLng: pickupLng.toString(),
                        allDestinations: JSON.stringify(destinations),
                      },
                    });
                  }}
                >
                  <Plus color="#fff" size={20} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>}

      {/* Menu overlay when menu is open or dragging */}
      {(showMenuSideSheet || isMenuDragging) && (
        <Animated.View
          style={[styles.menuOverlayTouchable]}
          {...menuPanResponder.panHandlers}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={handleCloseMenuFromOverlay}
          >
            <Animated.View
              style={[
                styles.menuOverlay,
                { opacity: menuOverlayOpacity },
              ]}
            />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Cancel Request Button - show when searching but not when raise fare sheet is shown */}
      {isSearchingDriver && !showRaiseFareSheet && (
        <TouchableOpacity style={styles.cancelRequestButton} onPress={openCancelConfirmSheet}>
          <X color="#000" size={20} />
          <Text style={styles.cancelRequestText}>Cancel request</Text>
        </TouchableOpacity>
      )}

      {/* Back Button - hide when searching or map moving */}
      {!isSearchingDriver && (
        <Animated.View
          style={[
            styles.backButton,
            {
              opacity: topButtonsHideAnim,
              transform: [{ scale: topButtonsHideAnim }],
            }
          ]}
          pointerEvents="auto"
        >
          <TouchableOpacity
            style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}
            onPress={() => {
              setSkipNextLocationDetection(true);
              router.back();
            }}
          >
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Recenter Button - hide when searching or map moving */}
      {Platform.OS !== "web" && !isSearchingDriver && (
        <Animated.View
          pointerEvents={isMapMoved ? "auto" : "none"}
          style={[
            styles.recenterButton,
            {
              opacity: Animated.multiply(recenterButtonAnim, topButtonsHideAnim),
              transform: [{
                scale: Animated.multiply(
                  recenterButtonAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                  topButtonsHideAnim
                )
              }]
            }
          ]}
        >
          <TouchableOpacity
            style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}
            onPress={handleRecenterMap}
          >
            <Route color={colors.text} size={22} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Driver Offers Overlay - show when searching and has offers */}
      {isSearchingDriver && driverOffers.length > 0 && (
        <View style={styles.driverOffersOverlay}>
          <Text style={styles.chooseDriverTitle}>Choose a driver</Text>
          <ScrollView 
            style={styles.driverOffersScroll} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            scrollEnabled={driverOffers.length > 3}
          >
            {driverOffers.map((offer) => (
              <Animated.View 
                key={offer.id}
                {...(offerCardPanResponders[offer.id]?.panHandlers || {})}
                style={[
                  styles.driverOfferCard,
                  {
                    transform: [
                      {
                        translateY: offerAnimations[offer.id]?.slideIn?.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 300],
                        }) || 0
                      },
                      {
                        translateX: Animated.add(
                          offerAnimations[offer.id]?.cardSlide?.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, -SCREEN_WIDTH - 50],
                          }) || new Animated.Value(0),
                          offerAnimations[offer.id]?.swipeX || new Animated.Value(0)
                        )
                      },
                      {
                        rotate: Animated.add(
                          offerAnimations[offer.id]?.cardSlide?.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, -15],
                          }) || new Animated.Value(0),
                          offerAnimations[offer.id]?.swipeX?.interpolate({
                            inputRange: [-SCREEN_WIDTH, 0],
                            outputRange: [-15, 0],
                            extrapolate: 'clamp',
                          }) || new Animated.Value(0)
                        ).interpolate({
                          inputRange: [-30, 0],
                          outputRange: ['-15deg', '0deg'],
                          extrapolate: 'clamp',
                        })
                      }
                    ],
                    opacity: Animated.multiply(
                      offerAnimations[offer.id]?.slideIn?.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }) || new Animated.Value(1),
                      Animated.multiply(
                        offerAnimations[offer.id]?.cardSlide?.interpolate({
                          inputRange: [0, 0.5, 1],
                          outputRange: [1, 0.8, 0],
                        }) || new Animated.Value(1),
                        offerAnimations[offer.id]?.swipeX?.interpolate({
                          inputRange: [-SCREEN_WIDTH, -SCREEN_WIDTH * 0.5, 0],
                          outputRange: [0, 0.7, 1],
                          extrapolate: 'clamp',
                        }) || new Animated.Value(1)
                      )
                    )
                  }
                ]}
              >
                <View style={styles.driverOfferHeader}>
                  <View style={styles.driverPhotoContainer}>
                    <Image source={{ uri: offer.photo }} style={styles.driverPhoto} />
                    {offer.tier === 'platinum' && (
                      <View style={styles.driverBadge}>
                        <Text style={styles.driverBadgeText}>◆</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.driverInfoContainer}>
                    <View style={styles.driverNameRow}>
                      <Text style={styles.driverName}>{offer.name}</Text>
                      <View style={styles.driverRatingContainer}>
                        <Star color="#FBBF24" fill="#FBBF24" size={14} />
                        <Text style={styles.driverRating}>{offer.rating.toFixed(offer.rating % 1 === 0 ? 1 : 2)}</Text>
                      </View>
                      <Text style={styles.driverRides}> ({offer.totalRides.toLocaleString()} rides)</Text>
                    </View>
                    <Text style={styles.driverVehicle}>{offer.vehicle}</Text>
                    {getTierLabel(offer.tier) && (
                      <Text style={[styles.driverTier, { color: getTierColor(offer.tier) }]}>
                        {getTierLabel(offer.tier)}
                      </Text>
                    )}
                  </View>
                  <View style={styles.driverEtaContainer}>
                    <Text style={styles.driverEta}>{offer.eta} min</Text>
                    <Text style={styles.driverDistance}>{offer.distance} km</Text>
                  </View>
                </View>
                <Text style={styles.ltfrbNumber}>LTFRB Case Number: {offer.ltfrbNumber}</Text>
                <Text style={styles.driverPrice}>{currency.symbol} {offer.price}</Text>
                <View style={styles.offerButtonsRow}>
                  <TouchableOpacity 
                    style={styles.declineButton}
                    onPress={() => handleDeclineOffer(offer.id)}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.acceptButton}
                    onPress={() => handleAcceptOffer(offer)}
                  >
                    <View style={styles.acceptButtonBackground}>
                      <View style={styles.acceptButtonUnfilled} />
                      <Animated.View 
                        style={[
                          styles.acceptButtonFilled,
                          {
                            width: offerAnimations[offer.id]?.acceptProgress?.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            }) || '0%'
                          }
                        ]} 
                      />
                    </View>
                    <Text style={styles.acceptButtonText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Viewing Drivers Bar - show when searching and drivers are viewing - positioned above bottom sheet */}
      {isSearchingDriver && driverOffers.length === 0 && viewingDrivers.length > 0 && !showRaiseFareSheet && (
        <View style={[styles.viewingDriversContainer, styles.viewingDriversBarPosition]}>
          <Text style={styles.viewingDriversText}>
            {viewingDrivers.length} {viewingDrivers.length === 1 ? 'driver is' : 'drivers are'} viewing your request
          </Text>
          <View style={styles.viewingDriversAvatars}>
            {viewingDrivers.map((driver, index) => (
              <Image
                key={driver.id}
                source={{ uri: driver.photo }}
                style={[
                  styles.viewingDriverAvatar,
                  index > 0 && styles.viewingDriverAvatarOverlap,
                ]}
              />
            ))}
          </View>
        </View>
      )}

      {/* Searching Bottom Sheet - show when searching but no offers yet and not showing raise fare sheet */}
      {isSearchingDriver && driverOffers.length === 0 && !showRaiseFareSheet && (
        <View style={styles.searchingBottomSheet}>
          <View style={styles.searchingContent}>
            <View style={styles.searchingHeader}>
              <Text style={styles.searchingTitle}>Waiting for offers from drivers</Text>
              {!hasRespondedToFarePopup && (
                <Text style={styles.searchingTimer}>{formatCountdown(searchCountdown)}</Text>
              )}
            </View>
            <View style={styles.searchProgressBar}>
              {hasRespondedToFarePopup ? (
                <View style={styles.searchProgressFillStatic} />
              ) : (
                <Animated.View 
                  style={[
                    styles.searchProgressFill,
                    {
                      width: searchProgressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    }
                  ]} 
                />
              )}
            </View>
            <View style={styles.searchFareSection}>
              <TouchableOpacity 
                style={searchFareAdjustment > 0 ? styles.searchFareButton : styles.searchFareButtonDisabled}
                onPress={() => adjustSearchFare(-10)}
                disabled={searchFareAdjustment <= 0}
              >
                <Text style={searchFareAdjustment > 0 ? styles.searchFareButtonText : styles.searchFareButtonTextDisabled}>- 10</Text>
              </TouchableOpacity>
              <View style={styles.searchFareCenter}>
                <Text style={styles.searchFareAmount}>{currency.symbol} {estimatedPrice + committedFareRaise + searchFareAdjustment}</Text>
              </View>
              <TouchableOpacity 
                style={styles.searchFareButton}
                onPress={() => adjustSearchFare(10)}
              >
                <Text style={styles.searchFareButtonText}>+ 10</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity 
              style={searchFareAdjustment > 0 ? styles.raiseFareButton : styles.raiseFareButtonDisabled}
              disabled={searchFareAdjustment <= 0}
              onPress={() => {
                setCommittedFareRaise(prev => prev + searchFareAdjustment);
                setSearchFareAdjustment(0);
                showFareRaisedNotification();
              }}
            >
              <Text style={searchFareAdjustment > 0 ? styles.raiseFareText : styles.raiseFareTextDisabled}>Raise fare</Text>
            </TouchableOpacity>
            <View style={styles.searchAutoAcceptRow}>
              <View style={styles.searchAutoAcceptLeft}>
                <Send color="#000" size={20} style={styles.searchAutoAcceptIcon} />
                <Text style={styles.searchAutoAcceptText}>
                  Auto-accept an offer of {currency.symbol} {estimatedPrice + committedFareRaise + searchFareAdjustment} up to 5 min away
                </Text>
              </View>
              <Switch
                value={searchAutoAccept}
                onValueChange={setSearchAutoAccept}
                trackColor={{ false: "#E5E5E5", true: "#4a5a3a" }}
                thumbColor={searchAutoAccept ? "#ff007f" : "#fff"}
              />
            </View>
            <View style={styles.searchPaymentRow}>
              {selectedPaymentMethod === 'cash' ? (
                <View style={[styles.searchPaymentIcon, { backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center', borderRadius: 15 }]}>
                  <Text style={{ fontSize: 16 }}>💵</Text>
                </View>
              ) : (
                <Image 
                  source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3drcunhhotpoqbujxqkwp' }}
                  style={styles.searchPaymentIcon}
                  resizeMode="contain"
                />
              )}
              <Text style={styles.searchPaymentText}>{currency.symbol} {estimatedPrice + committedFareRaise + searchFareAdjustment} {selectedPaymentMethod === 'cash' ? 'Cash' : 'DuItNow'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Bottom Sheet - hide when searching */}
      {!isSearchingDriver && <Animated.View style={[styles.bottomSheet, { height: bottomSheetHeight }]} {...menuPanResponder.panHandlers}>
        <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
          <View style={styles.dragHandle} />
        </View>

        {/* Promo Code Banner - always at top of bottom sheet */}
        <TouchableOpacity style={styles.promoBanner} onPress={openPromoCodeSheet} activeOpacity={0.7}>
          <View style={styles.promoBannerContent}>
            <Tag color="#6B7280" size={18} />
            <Text style={styles.promoBannerText}>Got promo code? Use it here</Text>
            <ChevronRight color="#6B7280" size={20} />
          </View>
        </TouchableOpacity>

        {/* Content based on expanded state */}
        {!isExpanded ? (
          // Collapsed state - show carousel with selected in middle
          <View style={styles.collapsedCarouselContainer}>
            <ScrollView
              ref={collapsedScrollRef}
              style={styles.collapsedCarousel}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              contentContainerStyle={styles.collapsedCarouselContent}
              onScrollBeginDrag={() => {
                Animated.spring(bottomSheetHeight, {
                  toValue: BOTTOM_SHEET_MAX_HEIGHT,
                  useNativeDriver: false,
                  tension: 100,
                  friction: 12,
                }).start();
                currentHeight.current = BOTTOM_SHEET_MAX_HEIGHT;
                setIsExpanded(true);
                
                // Scroll expanded view to show selected card above disclaimer
                const currentSelected = selectedRideRef.current;
                const selectedIndex = EXTENDED_RIDE_TYPES.findIndex(r => r.id === currentSelected.id);
                
                const SELECTED_CARD_HEIGHT = 200;
                const NON_SELECTED_CARD_HEIGHT = 80;
                const DISCLAIMER_HEIGHT = 100;
                const BOTTOM_PADDING = 150;
                
                setTimeout(() => {
                  let itemOffset = 0;
                  for (let i = 0; i < selectedIndex; i++) {
                    itemOffset += NON_SELECTED_CARD_HEIGHT;
                  }
                  
                  const visibleAreaHeight = BOTTOM_SHEET_MAX_HEIGHT - 40 - DISCLAIMER_HEIGHT - BOTTOM_PADDING;
                  const cardBottom = itemOffset + SELECTED_CARD_HEIGHT;
                  const scrollY = cardBottom - visibleAreaHeight + 50;
                  
                  scrollViewRef.current?.scrollTo({
                    y: Math.max(0, scrollY),
                    animated: true,
                  });
                }, 200);
              }}
            >
              {EXTENDED_RIDE_TYPES.map((ride, index) => {
                const ridePrice = Math.round(basePrice * ride.priceMultiplier);
                const isSelected = ride.id === selectedRide.id;
                const displayName = ride.name;
                const description = ride.description;
                const adjustedRidePrice = isSelected ? ridePrice + fareAdjustment : ridePrice;
                const recommendedPrice = ridePrice;
                const isLastItem = index === EXTENDED_RIDE_TYPES.length - 1;
                
                return (
                  <Animated.View
                    key={ride.id}
                    style={[
                      styles.collapsedRideCard,
                      isSelected && styles.collapsedRideCardSelected,
                      isLastItem && isSelected && { marginBottom: 80 },
                      isLastItem && !isSelected && { marginBottom: 0 },
                      isSelected && { transform: [{ translateX: shakeAnim }] },
                    ]}
                  >
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => isSelected ? handleOpenOfferFare() : handleRideSelect(ride)}
                    activeOpacity={0.8}
                  >
                    <View style={isSelected ? styles.collapsedRideContentSelected : styles.collapsedRideContent}>
                      <View style={styles.rideCarImageContainer}>
                        <Image
                          source={{ uri: getCarImage(ride.id) }}
                          style={styles.rideCarImage}
                          resizeMode="contain"
                        />
                      </View>
                      <View style={styles.rideOptionInfo}>
                        <View style={styles.rideOptionTitleRow}>
                          <Text style={styles.rideOptionTitle}>{displayName}</Text>
                          {isSelected && <TouchableOpacity onPress={(e) => { e.stopPropagation(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Info color="#6B7280" size={14} /></TouchableOpacity>}
                        </View>
                        <View style={styles.rideOptionCapacity}>
                          <Users color="#9CA3AF" size={13} />
                          <Text style={styles.rideCapacityText}>{ride.capacity}</Text>
                        </View>
                        <Text style={styles.rideOptionDesc}>{description}</Text>
                      </View>
                      {isSelected ? (
                        <TouchableOpacity style={styles.editButton} onPress={(e) => { e.stopPropagation(); }}>
                          <Pencil color="#9CA3AF" size={18} />
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.rideOptionPrice}>{currency.symbol} {ridePrice}</Text>
                      )}
                    </View>
                    
                    </TouchableOpacity>
                    {/* Fare Adjustment - only for selected */}
                    {isSelected && (
                      <View style={styles.fareSection}>
                        <TouchableOpacity 
                          style={styles.fareButton} 
                          onPress={(e) => { e.stopPropagation(); adjustFare(-5); }}
                        >
                          <Minus color={colors.text} size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fareCenter} onPress={handleOpenOfferFare} activeOpacity={0.7}>
                          <Text style={styles.fareAmount}>{currency.symbol} {adjustedRidePrice}</Text>
                          <Text style={styles.fareLabel}>
                            {fareAdjustment === 0 
                              ? "Recommended fare" 
                              : `Recommended fare: ${currency.symbol} ${recommendedPrice}`}
                          </Text>
                          {displaySettings.showAiTollBooths && tollBooths.length > 0 && (
                            <TouchableOpacity style={styles.tollChargesRow} onPress={(e) => { e.stopPropagation(); openTollSheet(); }}>
                              <Text style={styles.tollChargesText}>
                                Est. Toll Booths: {tollBooths.length}
                              </Text>
                            </TouchableOpacity>
                          )}
                          {displaySettings.showAiTollCharges && (() => {
                            const inlineTollTotal = aiTollTotal != null && aiTollTotal > 0
                              ? aiTollTotal
                              : (tollBooths.length > 0 ? tollBooths.length * 3.5 : 0);
                            if (inlineTollTotal <= 0) return null;
                            return (
                              <View style={styles.tollTotalLineRow}>
                                <Text style={styles.tollTotalLineLabel}>Est. Toll Charges</Text>
                                <Text style={styles.tollTotalLineAmount}>{currency.symbol} {inlineTollTotal.toFixed(2)}</Text>
                              </View>
                            );
                          })()}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.fareButton}
                          onPress={(e) => { e.stopPropagation(); adjustFare(5); }}
                        >
                          <Plus color={colors.text} size={24} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </Animated.View>
                );
              })}

            </ScrollView>
          </View>
        ) : (
          // Expanded state - show all ride options
          <ScrollView 
            ref={scrollViewRef}
            style={styles.rideOptionsContainer} 
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const offsetY = e.nativeEvent.contentOffset.y;
              isAtScrollTop.current = offsetY <= 0;
            }}
          >
            {EXTENDED_RIDE_TYPES.map((ride) => {
              const ridePrice = Math.round(basePrice * ride.priceMultiplier);
              const isSelected = ride.id === selectedRide.id;
              const displayName = ride.name;
              const description = ride.description;
              const adjustedRidePrice = isSelected ? ridePrice + fareAdjustment : ridePrice;
              const recommendedPrice = ridePrice;
              
              return (
                <View key={ride.id}>
                  {isSelected ? (
                    <Animated.View style={[styles.selectedRideContainer, { transform: [{ translateX: shakeAnim }] }]}>
                      <TouchableOpacity
                        style={styles.selectedRideCard}
                        onPress={handleOpenOfferFare}
                        activeOpacity={0.8}
                      >
                        <View style={styles.rideCarImageContainer}>
                          <Image
                            source={{ uri: getCarImage(ride.id) }}
                            style={styles.rideCarImage}
                            resizeMode="contain"
                          />
                        </View>
                        <View style={styles.rideOptionInfo}>
                          <View style={styles.rideOptionTitleRow}>
                            <Text style={styles.rideOptionTitle}>{displayName}</Text>
                            <TouchableOpacity onPress={(e) => { e.stopPropagation(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Info color="#6B7280" size={14} /></TouchableOpacity>
                          </View>
                          <View style={styles.rideOptionCapacity}>
                            <Users color="#9CA3AF" size={13} />
                            <Text style={styles.rideCapacityText}>{ride.capacity}</Text>
                          </View>
                          <Text style={styles.rideOptionDesc}>{description}</Text>
                        </View>
                        <TouchableOpacity style={styles.editButton} onPress={(e) => { e.stopPropagation(); }}>
                          <Pencil color="#9CA3AF" size={18} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                      
                      {/* Fare Adjustment Section - Inside Selected Card */}
                      <View style={styles.fareSection}>
                        <TouchableOpacity 
                          style={styles.fareButton} 
                          onPress={(e) => { e.stopPropagation(); adjustFare(-5); }}
                        >
                          <Minus color={colors.text} size={24} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fareCenter} onPress={handleOpenOfferFare} activeOpacity={0.7}>
                          <Text style={styles.fareAmount}>{currency.symbol} {adjustedRidePrice}</Text>
                          <Text style={styles.fareLabel}>
                            {fareAdjustment === 0 
                              ? "Recommended fare" 
                              : `Recommended fare: ${currency.symbol} ${recommendedPrice}`}
                          </Text>
                          {displaySettings.showAiTollBooths && tollBooths.length > 0 && (
                            <TouchableOpacity style={styles.tollChargesRow} onPress={(e) => { e.stopPropagation(); openTollSheet(); }}>
                              <Text style={styles.tollChargesText}>
                                Est. Toll Booths: {tollBooths.length}
                              </Text>
                            </TouchableOpacity>
                          )}
                          {displaySettings.showAiTollCharges && (() => {
                            const inlineTollTotal = aiTollTotal != null && aiTollTotal > 0
                              ? aiTollTotal
                              : (tollBooths.length > 0 ? tollBooths.length * 3.5 : 0);
                            if (inlineTollTotal <= 0) return null;
                            return (
                              <View style={styles.tollTotalLineRow}>
                                <Text style={styles.tollTotalLineLabel}>Est. Toll Charges</Text>
                                <Text style={styles.tollTotalLineAmount}>{currency.symbol} {inlineTollTotal.toFixed(2)}</Text>
                              </View>
                            );
                          })()}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.fareButton}
                          onPress={(e) => { e.stopPropagation(); adjustFare(5); }}
                        >
                          <Plus color={colors.text} size={24} />
                        </TouchableOpacity>
                      </View>
                    </Animated.View>
                  ) : (
                    <TouchableOpacity
                      style={styles.rideOptionCard}
                      onPress={() => handleRideSelect(ride)}
                    >
                      <View style={styles.rideCarImageContainer}>
                        <Image
                          source={{ uri: getCarImage(ride.id) }}
                          style={styles.rideCarImage}
                          resizeMode="contain"
                        />
                      </View>
                      <View style={styles.rideOptionInfo}>
                        <View style={styles.rideOptionTitleRow}>
                          <Text style={styles.rideOptionTitle}>{displayName}</Text>
                        </View>
                        <View style={styles.rideOptionCapacity}>
                          <Users color="#9CA3AF" size={13} />
                          <Text style={styles.rideCapacityText}>{ride.capacity}</Text>
                        </View>
                        <Text style={styles.rideOptionDesc}>{description}</Text>
                      </View>
                      <Text style={styles.rideOptionPrice}>{currency.symbol} {ridePrice}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Disclaimer - Only visible when expanded */}
        {isExpanded && (
          <View style={styles.disclaimerBox}>
            <Info color="#9CA3AF" size={18} style={styles.disclaimerIcon} />
            <Text style={styles.disclaimerText}>
              Fare does not include state entry tax, tolls, or parking fees
            </Text>
          </View>
        )}

      </Animated.View>}

      {/* Fixed Bottom Container - hide when searching */}
      {!isSearchingDriver && (
      <Animated.View style={[
        styles.fixedBottomContainer,
        {
          transform: [{ translateY: fixedBottomSlideAnim }],
        }
      ]} {...menuPanResponder.panHandlers}>
        {/* Auto Accept Toggle */}
        <View style={styles.autoAcceptRow}>
          <View style={styles.autoAcceptLeft}>
            <Send color="#ff007f" size={18} style={styles.autoAcceptIcon} />
            <Text style={styles.autoAcceptText}>
              Auto-accept offer of {currency.symbol} {estimatedPrice}
            </Text>
          </View>
          <Switch
            value={autoAccept}
            onValueChange={setAutoAccept}
            trackColor={{ false: "#3a3a3a", true: "#4a5a3a" }}
            thumbColor={autoAccept ? "#ff007f" : "#6B7280"}
          />
        </View>

        {/* Bottom Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.paymentIcon} onPress={openPaymentSheet}>
            <CreditCard color="#ff007f" size={20} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.findDriverButton}
            onPress={handleConfirmRide}
          >
            <Text style={styles.findDriverText}>Find a driver</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsIcon}>
            <SlidersHorizontal color="#fff" size={20} />
          </TouchableOpacity>
        </View>
      </Animated.View>
      )}

      {/* Payment Method Bottom Sheet */}
      {showPaymentSheet && (
        <Animated.View 
          style={[
            styles.paymentSheetOverlay,
            {
              opacity: paymentSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closePaymentSheet} 
          />
          <Animated.View 
            style={[
              styles.paymentSheetContainer,
              {
                transform: [{
                  translateY: paymentSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  })
                }]
              }
            ]}
          >
            <View style={styles.paymentSheetHeader}>
              <Text style={styles.paymentSheetTitle}>Payment method</Text>
              <TouchableOpacity style={styles.paymentSheetClose} onPress={closePaymentSheet}>
                <X color="#fff" size={18} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[
                styles.paymentOption,
                selectedPaymentMethod === 'cash' && styles.paymentOptionSelected
              ]}
              onPress={() => selectPaymentMethod('cash')}
            >
              <View style={[styles.paymentOptionIcon, styles.cashIcon]}>
                <Banknote color="#fff" size={22} />
              </View>
              <Text style={styles.paymentOptionText}>Cash</Text>
              {selectedPaymentMethod === 'cash' && (
                <Check color="#4A90D9" size={22} style={styles.paymentCheckIcon} />
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={[
                styles.paymentOption,
                selectedPaymentMethod === 'duitnow' && styles.paymentOptionSelected
              ]}
              onPress={() => selectPaymentMethod('duitnow')}
            >
              <Image 
                source={{ uri: 'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3drcunhhotpoqbujxqkwp' }}
                style={{ width: 40, height: 40, borderRadius: 8 }}
                resizeMode="contain"
              />
              <Text style={styles.paymentOptionText}>DuItNow manual transfer</Text>
              {selectedPaymentMethod === 'duitnow' && (
                <Check color="#4A90D9" size={22} style={styles.paymentCheckIcon} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {/* Entrance Bottom Sheet */}
      {showEntranceSheet && (
        <Animated.View 
          style={[
            styles.entranceSheetOverlay,
            {
              opacity: entranceSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closeEntranceSheet} 
          />
          <Animated.View 
            style={[
              styles.entranceSheetContainer,
              {
                transform: [{
                  translateY: entranceSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [500, 0],
                  })
                }]
              }
            ]}
          >
            <View style={styles.entranceSheetHeader}>
              <View style={styles.entranceSheetPlaceholder} />
              <Text style={styles.entranceSheetTitle}>Set entrance</Text>
              <TouchableOpacity style={styles.entranceSheetClose} onPress={closeEntranceSheet}>
                <X color="#000" size={18} />
              </TouchableOpacity>
            </View>

            <View style={styles.entranceDisplayContainer}>
              <Text style={styles.entranceDisplayText}>{entranceValue}</Text>
            </View>

            <TouchableOpacity style={styles.entranceDoneButton} onPress={handleEntranceDone}>
              <Text style={styles.entranceDoneText}>Done</Text>
            </TouchableOpacity>

            <View style={styles.keypadContainer}>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '1')}>
                  <Text style={styles.keypadNumber}>1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '2')}>
                  <Text style={styles.keypadNumber}>2</Text>
                  <Text style={styles.keypadLetters}>ABC</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '3')}>
                  <Text style={styles.keypadNumber}>3</Text>
                  <Text style={styles.keypadLetters}>DEF</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '4')}>
                  <Text style={styles.keypadNumber}>4</Text>
                  <Text style={styles.keypadLetters}>GHI</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '5')}>
                  <Text style={styles.keypadNumber}>5</Text>
                  <Text style={styles.keypadLetters}>JKL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '6')}>
                  <Text style={styles.keypadNumber}>6</Text>
                  <Text style={styles.keypadLetters}>MNO</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '7')}>
                  <Text style={styles.keypadNumber}>7</Text>
                  <Text style={styles.keypadLetters}>PQRS</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '8')}>
                  <Text style={styles.keypadNumber}>8</Text>
                  <Text style={styles.keypadLetters}>TUV</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '9')}>
                  <Text style={styles.keypadNumber}>9</Text>
                  <Text style={styles.keypadLetters}>WXYZ</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <View style={styles.keypadButtonEmpty} />
                <TouchableOpacity style={styles.keypadButton} onPress={() => setEntranceValue(prev => prev + '0')}>
                  <Text style={styles.keypadNumber}>0</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButtonBackspace} onPress={() => setEntranceValue(prev => prev.slice(0, -1))}>
                  <Delete color="#000" size={26} />
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      )}

      {/* Raise Fare Sheet */}
      {showRaiseFareSheet && (
        <Animated.View
          style={[
            styles.raiseFareSheetOverlay,
            {
              opacity: raiseFareSheetAnim,
            }
          ]}
        >
          <Animated.View
            style={[
              styles.raiseFareSheet,
              {
                transform: [{
                  translateY: raiseFareSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [600, 0],
                  })
                }]
              }
            ]}
          >
          <View style={styles.raiseFareContent}>
            <Text style={styles.raiseFareTitle}>Raise your fare to get{"\n"}drivers&apos; attention</Text>
            <View style={styles.raiseFareSubtitleRow}>
              <Text style={styles.raiseFareSubtitle}>{fareViewers.length} drivers viewed{"\n"}your request</Text>
              <View style={styles.fareViewersAvatars}>
                {fareViewers.map((viewer, index) => (
                  <Image
                    key={viewer.id}
                    source={{ uri: viewer.photo }}
                    style={[
                      styles.fareViewerAvatar,
                      index > 0 && styles.fareViewerAvatarOverlap,
                    ]}
                  />
                ))}
              </View>
            </View>
            
            {availableDrivers.map((driver) => (
              <View key={driver.id} style={styles.availableDriverCard}>
                <Image source={{ uri: driver.photo }} style={styles.availableDriverPhoto} />
                <View style={styles.availableDriverInfo}>
                  <View style={styles.availableDriverRatingRow}>
                    <Star color="#000" fill="#000" size={14} />
                    <Text style={styles.availableDriverRating}>{driver.rating.toFixed(1)}</Text>
                    <Text style={styles.availableDriverRides}> ({driver.rides} rides)</Text>
                  </View>
                  <Text style={styles.availableDriverName}>{driver.vehicle}</Text>
                </View>
                <View style={styles.availableDriverEtaContainer}>
                  <Text style={styles.availableDriverEta}>{driver.eta}</Text>
                  <Text style={styles.availableDriverDistance}>{driver.distance}</Text>
                </View>
              </View>
            ))}
            
            <TouchableOpacity style={styles.raiseFareActionButton} onPress={handleRaiseFare}>
              <Text style={styles.raiseFareActionText}>Raise fare to {currency.symbol} {estimatedPrice + searchFareAdjustment + 5}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.keepFareButton} onPress={handleKeepFare}>
              <Text style={styles.keepFareText}>Keep {currency.symbol} {estimatedPrice + searchFareAdjustment}</Text>
            </TouchableOpacity>
          </View>
          </Animated.View>
        </Animated.View>
      )}

      {/* Fare Raised Toast */}
      {showFareRaisedToast && (
        <Animated.View
          style={[
            styles.fareRaisedToast,
            {
              opacity: fareRaisedToastAnim,
              transform: [{
                translateY: fareRaisedToastAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                })
              }]
            }
          ]}
        >
          <View style={styles.fareRaisedToastIcon}>
            <Check color="#000" size={14} strokeWidth={3} />
          </View>
          <Text style={styles.fareRaisedToastText}>You raised the fare</Text>
        </Animated.View>
      )}

      {/* Cancel Confirmation Bottom Sheet */}
      {showCancelConfirmSheet && (
        <Animated.View
          style={[
            styles.cancelConfirmSheetOverlay,
            {
              opacity: cancelConfirmSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closeCancelConfirmSheet} 
          />
          <Animated.View
            style={[
              styles.cancelConfirmSheet,
              {
                transform: [{
                  translateY: cancelConfirmSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  })
                }]
              }
            ]}
          >
            <Text style={styles.cancelConfirmTitle}>Sure you want to cancel{"\n"}your request?</Text>
            <TouchableOpacity style={styles.keepSearchingButton} onPress={closeCancelConfirmSheet}>
              <Text style={styles.keepSearchingText}>Keep searching</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelButton} onPress={handleCancelRequest}>
              <Text style={styles.confirmCancelText}>Cancel request</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {/* No Fare Raise Cancel Sheet */}
      {showNoFareRaiseCancelSheet && (
        <Animated.View
          style={[
            styles.noFareRaiseCancelSheetOverlay,
            {
              opacity: noFareRaiseCancelSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closeNoFareRaiseCancelSheet} 
          />
          <Animated.View
            style={[
              styles.noFareRaiseCancelSheet,
              {
                transform: [{
                  translateY: noFareRaiseCancelSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  })
                }]
              }
            ]}
          >
            <View style={styles.noFareRaiseCancelHeader}>
              <Text style={styles.noFareRaiseCancelTitle}>Still need a ride? Search again with the higher fare</Text>
              <TouchableOpacity style={styles.noFareRaiseCancelClose} onPress={closeNoFareRaiseCancelSheet}>
                <X color="#000" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.noFareRaiseCancelSubtitle}>Increase your chances of getting a ride</Text>
            <TouchableOpacity style={styles.searchHigherFareButton} onPress={handleSearchHigherFare}>
              <Text style={styles.searchHigherFareText}>Search at {currency.symbol} {estimatedPrice + 20}</Text>
            </TouchableOpacity>
            <Text style={styles.searchHigherFareHint}>Most passengers get a ride at this fare on similar routes</Text>
            <TouchableOpacity style={styles.wantToCancelButton} onPress={handleConfirmCancelFromNoFare}>
              <Text style={styles.wantToCancelText}>I want to cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {/* Promo Code Bottom Sheet */}
      {showPromoCodeSheet && (
        <Animated.View
          style={[
            styles.promoCodeSheetOverlay,
            {
              opacity: promoCodeSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closePromoCodeSheet} 
          />
          <Animated.View
            style={[
              styles.promoCodeSheet,
              {
                transform: [{
                  translateY: promoCodeSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  })
                }],
                paddingBottom: keyboardHeight > 0 ? keyboardHeight + 20 : 30,
              }
            ]}
          >
            <View style={styles.promoCodeHeader}>
              <Text style={styles.promoCodeTitle}>Enter promo code</Text>
              <TouchableOpacity style={styles.promoCodeClose} onPress={closePromoCodeSheet}>
                <X color="#000" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.promoCodeSubtitle}>Promo code will be applied right after you enter it</Text>
            
            <View style={styles.promoCodeInputRow}>
              <View style={styles.promoCodeInputContainer}>
                <View style={promoCodeError ? styles.promoCodeInputWrapperError : styles.promoCodeInputWrapper}>
                  <Text style={styles.promoCodeInputLabel}>Promo code</Text>
                  <View style={styles.promoCodeInputInner}>
                    <TextInput
                      style={styles.promoCodeInput}
                      value={promoCode}
                      onChangeText={(text) => {
                        setPromoCode(text);
                        if (promoCodeError) setPromoCodeError('');
                      }}
                      placeholder=""
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      onFocus={() => setIsPromoInputFocused(true)}
                      onBlur={() => setIsPromoInputFocused(false)}
                    />
                  </View>
                  {promoCode.length > 0 && (
                    <TouchableOpacity 
                      style={styles.promoCodeClearButton} 
                      onPress={() => {
                        setPromoCode('');
                        setPromoCodeError('');
                      }}
                    >
                      <View style={styles.promoCodeClearCircle}>
                        <X color="#fff" size={14} />
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
                {promoCodeError ? (
                  <Text style={styles.promoCodeErrorText}>{promoCodeError}</Text>
                ) : null}
              </View>
              
              <TouchableOpacity 
                style={isValidatingPromo ? styles.promoCodeSubmitButtonDisabled : (!promoCode.trim() ? styles.promoCodeSubmitButtonInactive : styles.promoCodeSubmitButton)}
                onPress={handleApplyPromoCode}
                disabled={isValidatingPromo || !promoCode.trim()}
              >
                {isValidatingPromo ? (
                  <Animated.View 
                    style={[
                      styles.promoLoadingSpinnerContainer,
                      {
                        transform: [{
                          rotate: promoLoadingSpinnerAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '360deg'],
                          }),
                        }],
                      },
                    ]}
                  >
                    <View style={styles.promoLoadingSpinner}>
                      <View style={[styles.promoLoadingSpinnerTrack, { borderColor: 'rgba(0, 0, 0, 0.2)' }]} />
                      <View style={[styles.promoLoadingSpinnerHead, { borderTopColor: '#000', borderRightColor: 'rgba(0, 0, 0, 0.5)' }]} />
                    </View>
                  </Animated.View>
                ) : (
                  <ArrowLeft color={promoCode.trim() ? "#000" : "#9CA3AF"} size={24} style={{ transform: [{ rotate: '180deg' }] }} />
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      )}

      </Animated.View>

      <OfferFareSideSheet
        visible={showOfferFareSheet}
        onClose={() => setShowOfferFareSheet(false)}
        pickup={pickup}
        destination={destination}
        destinations={destinations}
        recommendedFare={Math.round(basePrice * selectedRide.priceMultiplier)}
        entrance={entranceValue}
        paymentMethod={selectedPaymentMethod}
        pickupLat={pickupLat}
        pickupLng={pickupLng}
        onFindDriver={handleOfferFareFindDriver}
        onRemoveStop={(index) => {
          if (destinations.length > 1) {
            const newDestinations = destinations.filter((_, i) => i !== index);
            setDestinations(newDestinations);
          }
        }}
        onFareUpdate={(fare) => {
          const recommendedFare = Math.round(basePrice * selectedRide.priceMultiplier);
          const adjustment = fare - recommendedFare;
          setFareAdjustment(adjustment);
        }}
        onEntrancePress={openEntranceSheet}
        onRouteStopsPress={openDestinationsSheet}
        onOpenMenu={() => {
          setShowOfferFareSheet(false);
          setShowMenuSideSheet(true);
        }}
        onLocationSelect={(field, location, destinationIndex) => {
          console.log('Location selected from embedded search:', field, location, destinationIndex);
          if (field === 'pickup') {
            router.setParams({
              pickup: location.address,
              pickupLat: location.lat.toString(),
              pickupLng: location.lng.toString(),
            });
          } else {
            if (destinationIndex === -1) {
              const newDestinations = [
                ...destinations,
                { address: location.address, lat: location.lat, lng: location.lng }
              ].slice(0, 5);
              setDestinations(newDestinations);
            } else if (destinationIndex !== undefined && destinationIndex >= 0) {
              const newDestinations = [...destinations];
              newDestinations[destinationIndex] = {
                address: location.address,
                lat: location.lat,
                lng: location.lng,
              };
              setDestinations(newDestinations);
            } else {
              setDestinations([{ address: location.address, lat: location.lat, lng: location.lng }]);
            }
          }
        }}
      />

      {/* Destinations Management Bottom Sheet */}
      {showDestinationsSheet && (
        <Animated.View
          style={[
            styles.destinationsSheetOverlay,
            {
              opacity: destinationsSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closeDestinationsSheet} 
          />
          <Animated.View
            style={[
              styles.destinationsSheet,
              {
                transform: [{
                  translateY: destinationsSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  })
                }]
              }
            ]}
          >
            <View style={styles.destinationsSheetHeader}>
              <TouchableOpacity style={styles.destinationsSheetBack} onPress={closeDestinationsSheet}>
                <ArrowLeft color="#000" size={22} />
              </TouchableOpacity>
              <Text style={styles.destinationsSheetTitle}>Destination addresses</Text>
              <View style={styles.destinationsSheetPlaceholder} />
            </View>

            <View style={styles.destinationsList}>
              {destinations.map((dest, index) => {
                const isDragging = draggingIndex === index;
                const itemAnim = getItemAnimatedValue(index);
                const dragResponder = createDragResponder(index);
                
                return (
                  <Animated.View 
                    key={`dest-manage-${index}`} 
                    style={[
                      isDragging ? styles.destinationItemDragging : styles.destinationItem,
                      {
                        transform: [
                          { translateY: isDragging ? dragY : itemAnim },
                          { scale: isDragging ? 1.02 : 1 }
                        ],
                        zIndex: isDragging ? 999 : 1,
                      }
                    ]}
                  >
                    <View style={[styles.destinationItemDot, index === destinations.length - 1 ? styles.destinationItemDotLast : styles.destinationItemDotMid]} />
                    <Text style={styles.destinationItemText} numberOfLines={1}>
                      {dest.address}
                    </Text>
                    <TouchableOpacity 
                      style={styles.destinationRemoveButton}
                      onPress={() => removeDestination(index)}
                      disabled={destinations.length <= 1}
                    >
                      <X color={destinations.length <= 1 ? "#D1D5DB" : "#6B7280"} size={20} />
                    </TouchableOpacity>
                    <Animated.View 
                      style={isDragging ? styles.destinationDragHandleActive : styles.destinationDragHandle}
                      {...dragResponder.panHandlers}
                    >
                      <Equal color={isDragging ? "#EF4444" : "#6B7280"} size={20} />
                    </Animated.View>
                  </Animated.View>
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      )}

      {/* Toll Booths Bottom Sheet */}
      <Modal
        visible={showTollSheet}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeTollSheet}
      >
        <Animated.View 
          style={[
            styles.tollSheetOverlay,
            {
              opacity: tollSheetAnim,
            }
          ]}
        >
          <TouchableOpacity 
            style={{ flex: 1 }} 
            activeOpacity={1} 
            onPress={closeTollSheet} 
          />
          <Animated.View 
            style={[
              styles.tollSheetContainer,
              {
                transform: [{
                  translateY: tollSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  })
                }]
              }
            ]}
          >
            <View style={styles.tollSheetHeader}>
              <Text style={styles.tollSheetTitle}>Toll Booths on Route</Text>
              <TouchableOpacity style={styles.tollSheetClose} onPress={closeTollSheet}>
                <X color="#fff" size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.tollListContainer} showsVerticalScrollIndicator={false}>
              {tollBooths.map((toll, index) => {
                const aiCharge = aiTollBooths[index]?.charge;
                const fallbackCharge =
                  aiTollTotal != null && tollBooths.length > 0
                    ? aiTollTotal / tollBooths.length
                    : 3.5;
                const boothCharge = typeof aiCharge === "number" ? aiCharge : fallbackCharge;
                return (
                  <View
                    key={toll.id}
                    style={[
                      styles.tollItem,
                      index === tollBooths.length - 1 && styles.tollItemLast
                    ]}
                  >
                    <View style={styles.tollItemIcon}>
                      <Text style={{ color: colors.text, fontSize: 10, fontWeight: "700" as const }}>TOLL</Text>
                    </View>
                    <View style={styles.tollItemInfo}>
                      <Text style={styles.tollItemName}>{aiTollBooths[index]?.name ?? toll.name ?? `Toll Plaza ${index + 1}`}</Text>
                      <Text style={styles.tollItemPrice}>Est. {currency.symbol} {boothCharge.toFixed(2)}</Text>
                      {typeof toll.latitude === "number" && typeof toll.longitude === "number" && (
                        <Text style={styles.tollItemCoords}>
                          {toll.latitude.toFixed(5)}, {toll.longitude.toFixed(5)}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.tollTotalRow}>
              <Text style={styles.tollTotalLabel}>Total Estimated Toll</Text>
              <Text style={styles.tollTotalAmount}>{currency.symbol} {(aiTollTotal != null ? aiTollTotal : tollBooths.length * 3.5).toFixed(2)}</Text>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Calculating fare modal - blocks until route/fare calculation finishes */}
      <Modal
        visible={isCalculatingFare}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.calcModalOverlay}>
          <View style={styles.calcModalCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.calcModalTitle}>Calculating fare</Text>
            <Text style={styles.calcModalSubtitle}>
              Checking live traffic and distance for the best estimate…
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#263c3f" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b9a76" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca5b3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#746855" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2835" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f3d19c" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2f3948" }],
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#515c6d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#17263c" }],
  },
];
