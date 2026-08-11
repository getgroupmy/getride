import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  useWindowDimensions,
  Animated,
  Platform,
  Modal,
  Pressable,
  PanResponder,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { MapPin, Menu, ChevronRight, Navigation, Search, Users, X, Car, Clock, Bell, ShoppingBag, Package, Building2, Truck, Bike, Bus, Plane, Layers, type LucideIcon } from "lucide-react-native";
import { MapView, Marker, reverseGeocode } from "@/utils/maps";
import WebMap from "@/components/WebMap";
import { runWithMappingRotation } from "@/utils/mappingClient";
import NearbyVehicleMarker from "@/components/NearbyVehicleMarker";
import { setVehicles as setVehicleStore } from "@/utils/vehicleStore";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import MenuSideSheet from "@/components/MenuSideSheet";
import { useAdminData } from "@/contexts/AdminDataContext";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";

const { width, height } = Dimensions.get("window");
const BOTTOM_SHEET_MIN_HEIGHT = 310;
const BOTTOM_SHEET_MAX_HEIGHT = height * 0.75;
const MENU_WIDTH = width * 0.68;
// Swipes that begin within this many px of the screen's left/right border are
// ignored, so the very edge of the screen doesn't trigger the side menu.
const EDGE_SWIPE_DEAD_ZONE = 20;
// Horizontal swipes that begin within this many px of the screen's bottom border
// are ignored, so the iOS/Android system app-switch gesture (a horizontal swipe
// along the home indicator) doesn't start opening the side menu.
const BOTTOM_SWIPE_DEAD_ZONE = 32;

const lightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "on" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#5a5a5a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#c8e6c9" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#4caf50" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b3e5fc" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#039be5" }] },
];

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
];

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<any>(null);
  const [mapType, setMapType] = useState<"standard" | "satellite">("standard");
  // Live viewport dimensions — recompute on rotation so the map/content fill the
  // screen in landscape. The module-level `width`/`height` from Dimensions.get()
  // are captured once (in portrait) and never update; using them for the map's
  // width left it pinned to the portrait width, showing only a left-hand column
  // of map on a landscape screen.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const Colors = useColors();
  const { settings: displaySettings, refresh: refreshDisplaySettings } = useDisplaySettings();
  const { colorScheme } = useTheme();
  const { location, currentAddress: contextAddress, refreshLocation, shouldSkipLocationDetection } = useLocation();
  const hasInitializedFromParams = useRef(false);
  const [mapKey, setMapKey] = useState<number>(0);
  const [serviceComingSoonVisible, setServiceComingSoonVisible] = useState<boolean>(false);
  const prevColorScheme = useRef<string>(colorScheme);
  const [currentAddress, setCurrentAddress] = useState<{
    name: string;
    address: string;
  } | null>(null);
  const [menuFullyOpen, setMenuFullyOpen] = useState(false);
  const menuRevealAnim = useRef(new Animated.Value(0)).current;
  const currentMenuPosition = useRef(0);
  const swipeThreshold = width * 0.25;
  const [pinLocation, setPinLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState<boolean>(false);
  const loadingSpinnerAnim = useRef(new Animated.Value(0)).current;
  const [selectedRideType, setSelectedRideType] = useState<string>('ride');
  const [infoSheetModalVisible, setInfoSheetModalVisible] = useState(false);
  const [infoSheetRideType, setInfoSheetRideType] = useState<{id: string; name: string; capacity: number; image: string; description: string} | null>(null);
  const slideAnim = useRef(new Animated.Value(300)).current;
  const infoSheetAnim = useRef(new Animated.Value(300)).current;
  const infoSheetDragOffset = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pinInnerScaleAnim = useRef(new Animated.Value(1)).current;
  const pinShadowOpacity = useRef(new Animated.Value(0)).current;
  const pinDropAnim = useRef(new Animated.Value(0)).current;
  const addressBarOpacity = useRef(new Animated.Value(1)).current;
  const menuButtonAnim = useRef(new Animated.Value(0)).current;
  const bottomSheetAnim = useRef(new Animated.Value(0)).current;
  const bottomSheetDragAnim = useRef(new Animated.Value(0)).current;
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const bottomSheetExpandedRef = useRef(false);
  const isMapMoving = useRef(false);
  const menuHiddenBySheet = useRef(false);
  const skipRegionChangeRef = useRef(false);
  const pendingRecenterRef = useRef(false);

  useEffect(() => {
    const listenerId = menuRevealAnim.addListener(({ value }) => {
      currentMenuPosition.current = value;
    });
    return () => menuRevealAnim.removeListener(listenerId);
  }, [menuRevealAnim]);

  // Launch routing — restoring an in-progress ride, or opening a TEKSI driver
  // into the meter — now lives in the `/welcome-back` buffer, which runs before
  // this screen is ever reached. The home map is a destination, not a router.

  // Snap the menu to its nearest resting state (fully open or fully closed).
  // Used when a drag is terminated by the system (e.g. the app-switch gesture)
  // so the menu never gets stuck in a half-open position.
  const resolveMenuToRestingState = React.useCallback(() => {
    const shouldOpen = currentMenuPosition.current > MENU_WIDTH / 2;
    Animated.spring(menuRevealAnim, {
      toValue: shouldOpen ? MENU_WIDTH : 0,
      useNativeDriver: true,
      tension: shouldOpen ? 65 : 100,
      friction: shouldOpen ? 11 : 10,
    }).start(() => setMenuFullyOpen(shouldOpen));
  }, [menuRevealAnim]);

  const mainContentPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const startY = gestureState.moveY - gestureState.dy;
      if (startY >= height - BOTTOM_SWIPE_DEAD_ZONE) return false;
      // Never open the menu by swiping across the content/map — opening is only via the
      // menu button. Only claim horizontal swipes to CLOSE the menu when it's already open,
      // so a left/right drag on the map just pans the map instead of revealing the menu.
      const isRightToLeft = gestureState.dx < -10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2) && currentMenuPosition.current > 0;
      return isRightToLeft;
    },
    onPanResponderTerminate: () => {
      resolveMenuToRestingState();
    },
    onPanResponderGrant: () => {
      console.log("Index content swipe started");
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
        if (gestureState.dx > swipeThreshold || gestureState.vx > 0.5) {
          Animated.spring(menuRevealAnim, {
            toValue: MENU_WIDTH,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
          }).start(() => {
            setMenuFullyOpen(true);
          });
        } else {
          Animated.spring(menuRevealAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start();
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
          }).start();
        } else {
          Animated.spring(menuRevealAnim, {
            toValue: MENU_WIDTH,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
          }).start();
        }
      }
    },
  }), [swipeThreshold, menuRevealAnim]);

  const menuPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const startY = gestureState.moveY - gestureState.dy;
      if (startY >= height - BOTTOM_SWIPE_DEAD_ZONE) return false;
      return gestureState.dx < -5 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
    },
    onPanResponderGrant: () => {
      console.log("Menu swipe to close started");
    },
    onPanResponderTerminate: () => {
      resolveMenuToRestingState();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx < 0) {
        const newValue = Math.max(0, MENU_WIDTH + gestureState.dx);
        menuRevealAnim.setValue(newValue);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      const shouldClose = gestureState.dx < -MENU_WIDTH * 0.3 || gestureState.vx < -0.5;
      
      if (shouldClose) {
        setMenuFullyOpen(false);
        Animated.spring(menuRevealAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      } else {
        Animated.spring(menuRevealAnim, {
          toValue: MENU_WIDTH,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }).start();
      }
    },
  }), [menuRevealAnim]);

  const handleOpenMenu = () => {
    // Pull the latest admin display config (e.g. "Coming Soon" toggles) the
    // moment the drawer opens so changes apply immediately instead of waiting
    // for the next background poll. The home menu is always-mounted (inline),
    // so it can't rely on a visibility effect like the other side sheets.
    refreshDisplaySettings();
    Animated.spring(menuRevealAnim, {
      toValue: MENU_WIDTH,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start(() => {
      setMenuFullyOpen(true);
    });
  };

  const handleCloseMenu = () => {
    setMenuFullyOpen(false);
    Animated.spring(menuRevealAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  };

  const bottomSheetPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const startX = gestureState.moveX - gestureState.dx;
      const startY = gestureState.moveY - gestureState.dy;
      if (startY >= height - BOTTOM_SWIPE_DEAD_ZONE) return false;
      if (startX <= EDGE_SWIPE_DEAD_ZONE || startX >= width - EDGE_SWIPE_DEAD_ZONE) return false;
      return gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
    },
    onPanResponderGrant: () => {
      console.log("Bottom sheet pan started");
    },
    onPanResponderTerminate: () => {
      resolveMenuToRestingState();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx > 0 && currentMenuPosition.current < MENU_WIDTH) {
        const clampedDx = Math.min(gestureState.dx, MENU_WIDTH);
        menuRevealAnim.setValue(clampedDx);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx > swipeThreshold || gestureState.vx > 0.5) {
        Animated.spring(menuRevealAnim, {
          toValue: MENU_WIDTH,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }).start(() => {
          setMenuFullyOpen(true);
        });
      } else {
        Animated.spring(menuRevealAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      }
    },
  }), [swipeThreshold, menuRevealAnim]);

  const handlePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 10;
    },
    onPanResponderGrant: () => {
      console.log("Handle drag started, expanded:", bottomSheetExpandedRef.current);
    },
    onPanResponderMove: (_, gestureState) => {
      const maxDrag = BOTTOM_SHEET_MAX_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT;
      const hideMenuThreshold = height * 0.65 - BOTTOM_SHEET_MIN_HEIGHT;
      
      if (bottomSheetExpandedRef.current) {
        // When expanded (at 0.75), allow unlimited upward drag (more negative) and downward drag
        const dy = gestureState.dy;
        bottomSheetDragAnim.setValue(-maxDrag + dy);
        
        // Check if should show menu when dragging down from expanded
        const currentDragFromMin = Math.max(0, dy);
        const currentSheetHeight = BOTTOM_SHEET_MAX_HEIGHT - currentDragFromMin;
        if (currentSheetHeight < height * 0.65 && menuHiddenBySheet.current) {
          menuHiddenBySheet.current = false;
          Animated.timing(menuButtonAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      } else {
        // When collapsed, allow unlimited dragging up (negative dy) and down (positive dy)
        const dy = gestureState.dy;
        bottomSheetDragAnim.setValue(dy);
        
        // Check if should hide menu when expanding past 0.65 threshold
        if (-dy >= hideMenuThreshold && !menuHiddenBySheet.current) {
          menuHiddenBySheet.current = true;
          Animated.timing(menuButtonAnim, {
            toValue: -150,
            duration: 200,
            useNativeDriver: true,
          }).start();
        } else if (-dy < hideMenuThreshold && menuHiddenBySheet.current) {
          menuHiddenBySheet.current = false;
          Animated.timing(menuButtonAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      const maxDrag = BOTTOM_SHEET_MAX_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT;
      const threshold = maxDrag * 0.3;
      
      if (bottomSheetExpandedRef.current) {
        // Currently expanded - check if should collapse
        if (gestureState.dy > threshold || gestureState.vy > 0.5) {
          // Collapse
          console.log("Collapsing bottom sheet");
          bottomSheetExpandedRef.current = false;
          setIsBottomSheetExpanded(false);
          menuHiddenBySheet.current = false;
          Animated.parallel([
            Animated.spring(bottomSheetDragAnim, {
              toValue: 0,
              useNativeDriver: true,
              tension: 80,
              friction: 12,
            }),
            Animated.timing(menuButtonAnim, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        } else {
          // Stay expanded
          menuHiddenBySheet.current = true;
          Animated.parallel([
            Animated.spring(bottomSheetDragAnim, {
              toValue: -maxDrag,
              useNativeDriver: true,
              tension: 80,
              friction: 12,
            }),
            Animated.timing(menuButtonAnim, {
              toValue: -150,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        }
      } else {
        // Currently collapsed - check if should expand
        if (gestureState.dy < -threshold || gestureState.vy < -0.5) {
          // Expand to max (0.75) with spring effect
          console.log("Expanding bottom sheet to max");
          bottomSheetExpandedRef.current = true;
          setIsBottomSheetExpanded(true);
          menuHiddenBySheet.current = true;
          Animated.parallel([
            Animated.spring(bottomSheetDragAnim, {
              toValue: -maxDrag,
              useNativeDriver: true,
              tension: 80,
              friction: 12,
            }),
            Animated.timing(menuButtonAnim, {
              toValue: -150,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        } else {
          // Stay collapsed
          menuHiddenBySheet.current = false;
          Animated.parallel([
            Animated.spring(bottomSheetDragAnim, {
              toValue: 0,
              useNativeDriver: true,
              tension: 80,
              friction: 12,
            }),
            Animated.timing(menuButtonAnim, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();
        }
      }
    },
  }), [bottomSheetDragAnim, menuButtonAnim]);

  const menuButtonPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const startX = gestureState.moveX - gestureState.dx;
      const startY = gestureState.moveY - gestureState.dy;
      if (startY >= height - BOTTOM_SWIPE_DEAD_ZONE) return false;
      if (startX <= EDGE_SWIPE_DEAD_ZONE || startX >= width - EDGE_SWIPE_DEAD_ZONE) return false;
      return gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
    },
    onPanResponderGrant: () => {
      console.log("Menu button pan started");
    },
    onPanResponderTerminate: () => {
      resolveMenuToRestingState();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx > 0 && currentMenuPosition.current < MENU_WIDTH) {
        const clampedDx = Math.min(gestureState.dx, MENU_WIDTH);
        menuRevealAnim.setValue(clampedDx);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx > swipeThreshold || gestureState.vx > 0.5) {
        Animated.spring(menuRevealAnim, {
          toValue: MENU_WIDTH,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }).start(() => {
          setMenuFullyOpen(true);
        });
      } else {
        Animated.spring(menuRevealAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      }
    },
  }), [swipeThreshold, menuRevealAnim]);

  const infoSheetPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
    onPanResponderMove: (_, gestureState) => {
      // Allow unlimited upward drag (negative values) and limited downward
      infoSheetDragOffset.setValue(gestureState.dy);
    },
    onPanResponderRelease: () => {
      // Always spring back to original position
      Animated.spring(infoSheetDragOffset, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    },
  }), [infoSheetDragOffset]);

  const { getEntries } = useAdminData();
  const vehicleServiceEntries = getEntries("vehicle-services");
  const serviceSettingEntries = getEntries("service-settings");
  const rideTypes = useMemo(() => {
    const hidden = new Set(displaySettings.hiddenVehicleServiceIds ?? []);
    const order = displaySettings.vehicleBarOrder ?? [];
    const orderIndex = new Map<string, number>();
    order.forEach((id, idx) => orderIndex.set(id, idx));
    const visible = vehicleServiceEntries.filter((e) => {
      const v = e.values;
      const status = v.status === undefined ? true : Boolean(v.status);
      return status && !hidden.has(e.id);
    });
    const list = visible
      .map((e) => {
        const v = e.values;
        return {
          entryId: e.id,
          id: String(v.name ?? "").toLowerCase().replace(/\s+/g, "-") || `svc-${Math.random().toString(36).slice(2, 7)}`,
          name: String(v.name ?? ""),
          capacity: Number(v.maxPax ?? 0) || 0,
          image: String(v.heroImageUri ?? v.iconUri ?? ""),
          description: String(v.description ?? ""),
          displayPriority: Number(v.displayPriority ?? 0) || 0,
        };
      })
      .sort((a, b) => {
        const ai = orderIndex.has(a.entryId) ? (orderIndex.get(a.entryId) as number) : Number.MAX_SAFE_INTEGER;
        const bi = orderIndex.has(b.entryId) ? (orderIndex.get(b.entryId) as number) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.displayPriority - b.displayPriority;
      })
      .map(({ entryId, displayPriority, ...rest }) => rest);
    return list;
  }, [vehicleServiceEntries, displaySettings.hiddenVehicleServiceIds, displaySettings.vehicleBarOrder]);

  const rideTypeScrollRef = useRef<ScrollView>(null);
  const rideTypeAnimsRef = useRef<Record<string, Animated.Value>>({});
  rideTypes.forEach((type) => {
    if (!rideTypeAnimsRef.current[type.id]) {
      rideTypeAnimsRef.current[type.id] = new Animated.Value(type.id === selectedRideType ? 0 : 5);
    }
  });
  const rideTypeMargins = rideTypeAnimsRef.current;

  useEffect(() => {
    if (rideTypes.length === 0) return;
    if (!rideTypes.some((t) => t.id === selectedRideType)) {
      setSelectedRideType(rideTypes[0].id);
    }
  }, [rideTypes, selectedRideType]);

  type VehicleData = { id: string; type: string; latitude: number; longitude: number; heading: number };
  const nearbyVehiclesRef = useRef<VehicleData[]>([]);
  const [vehicleIds, setVehicleIds] = useState<{ id: string; type: string; latitude: number; longitude: number; heading: number }[]>([]);
  const setNearbyVehicles = React.useCallback((next: VehicleData[]) => {
    nearbyVehiclesRef.current = next;
    setVehicleStore(next);
  }, []);
  const replaceNearbyVehicles = React.useCallback((next: VehicleData[]) => {
    nearbyVehiclesRef.current = next;
    setVehicleStore(next);
    setVehicleIds(next.map((v) => ({ id: v.id, type: v.type, latitude: v.latitude, longitude: v.longitude, heading: v.heading })));
  }, []);

  const MAX_RADIUS_DEG = 0.0045;
  const ROADS_API_KEY = 'AIzaSyBj89Dt9v6SiDMvA3XUsoRm6ey6L-nKMfI';

  const snapPointsToRoads = React.useCallback(async (points: { latitude: number; longitude: number }[]): Promise<{ latitude: number; longitude: number }[]> => {
    try {
      if (points.length === 0) return points;
      const chunks: { latitude: number; longitude: number }[][] = [];
      for (let i = 0; i < points.length; i += 100) {
        chunks.push(points.slice(i, i + 100));
      }
      const results: { latitude: number; longitude: number }[] = points.map((p) => ({ ...p }));
      let offset = 0;
      for (const chunk of chunks) {
        const param = chunk.map((p) => `${p.latitude},${p.longitude}`).join('|');
        const buildUrl = (key: string) => `https://roads.googleapis.com/v1/nearestRoads?points=${param}&key=${key}`;
        const data = await runWithMappingRotation<any>(
          "rider-home",
          "maps",
          async (ctx) => {
            const k = ctx.key || ROADS_API_KEY;
            const r = await fetch(buildUrl(k));
            const j = await r.json();
            return { ok: r.ok && Array.isArray(j?.snappedPoints), value: j };
          },
          async () => {
            const r = await fetch(buildUrl(ROADS_API_KEY));
            return r.json();
          }
        );
        if (Array.isArray(data?.snappedPoints)) {
          for (const sp of data.snappedPoints) {
            const idx = (typeof sp.originalIndex === 'number' ? sp.originalIndex : 0) + offset;
            if (results[idx] && sp.location) {
              results[idx] = { latitude: sp.location.latitude, longitude: sp.location.longitude };
            }
          }
        }
        offset += chunk.length;
      }
      return results;
    } catch (e) {
      console.log('[HomeScreen] snapPointsToRoads failed, using raw points', e);
      return points;
    }
  }, []);

  const generateNearbyVehicles = React.useCallback(async (centerLat: number, centerLng: number) => {
    const types = ['ride', 'comfort', '6seater', 'premium'];
    const raw: { id: string; type: string; latitude: number; longitude: number; heading: number }[] = [];
    const lngScale = 1 / Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
    types.forEach((t) => {
      const count = t === 'ride' ? 12 : t === 'comfort' ? 8 : t === '6seater' ? 6 : 5;
      for (let i = 0; i < count; i++) {
        const radius = MAX_RADIUS_DEG * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        raw.push({
          id: `${t}-${i}`,
          type: t,
          latitude: centerLat + Math.cos(angle) * radius,
          longitude: centerLng + Math.sin(angle) * radius * lngScale,
          heading: Math.random() * 360,
        });
      }
    });
    const snapped = await snapPointsToRoads(raw.map((v) => ({ latitude: v.latitude, longitude: v.longitude })));
    return raw.map((v, idx) => ({ ...v, latitude: snapped[idx].latitude, longitude: snapped[idx].longitude }));
  }, [snapPointsToRoads]);

  useEffect(() => {
    let cancelled = false;
    if (pinLocation && nearbyVehiclesRef.current.length === 0) {
      (async () => {
        const initial = await generateNearbyVehicles(pinLocation.latitude, pinLocation.longitude);
        if (cancelled) return;
        console.log('[HomeScreen] Spawned road-snapped vehicles around pin:', initial.length);
        replaceNearbyVehicles(initial);
      })();
    }
    return () => { cancelled = true; };
  }, [pinLocation, generateNearbyVehicles, replaceNearbyVehicles]);

  useEffect(() => {
    if (!pinLocation) return;
    const { latitude: pLat, longitude: pLng } = pinLocation;
    let cancelled = false;
    const current = nearbyVehiclesRef.current;
    const needsRespawn = current.length > 0 && current.some((v) => {
      const dLat = v.latitude - pLat;
      const dLng = v.longitude - pLng;
      return Math.sqrt(dLat * dLat + dLng * dLng) > MAX_RADIUS_DEG;
    });
    if (needsRespawn) {
      (async () => {
        const fresh = await generateNearbyVehicles(pLat, pLng);
        if (cancelled) return;
        replaceNearbyVehicles(fresh);
      })();
    }
    return () => { cancelled = true; };
  }, [pinLocation, generateNearbyVehicles, replaceNearbyVehicles]);

  const tickCountRef = useRef<number>(0);
  useEffect(() => {
    if (!pinLocation) return;
    const TICK_MS = 1000;
    const SNAP_EVERY = 5;
    const interval = setInterval(async () => {
      const current = nearbyVehiclesRef.current;
      if (current.length === 0) return;
      const { latitude: pLat, longitude: pLng } = pinLocation;
      const proposed = current.map((v) => {
        const step = 0.00002 + Math.random() * 0.00003;
        const turn = (Math.random() - 0.5) * 12;
        let newHeading = (v.heading + turn + 360) % 360;
        let rad = (newHeading * Math.PI) / 180;
        let newLat = v.latitude + Math.cos(rad) * step;
        let newLng = v.longitude + Math.sin(rad) * step;
        const dLat = newLat - pLat;
        const dLng = newLng - pLng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist > MAX_RADIUS_DEG) {
          const towards = Math.atan2(pLat - v.latitude, pLng - v.longitude);
          newHeading = ((towards * 180) / Math.PI + 360) % 360;
          rad = (newHeading * Math.PI) / 180;
          newLat = v.latitude + Math.cos(rad) * step;
          newLng = v.longitude + Math.sin(rad) * step;
        }
        return { ...v, latitude: newLat, longitude: newLng, heading: newHeading };
      });

      tickCountRef.current = (tickCountRef.current + 1) % SNAP_EVERY;
      if (tickCountRef.current !== 0) {
        setNearbyVehicles(proposed);
        return;
      }

      const snapped = await snapPointsToRoads(proposed.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
      const next = proposed.map((p, idx) => {
        const newLat = snapped[idx].latitude;
        const newLng = snapped[idx].longitude;
        const heading = ((Math.atan2(newLng - p.longitude, newLat - p.latitude) * 180) / Math.PI + 360) % 360;
        const moved = Math.abs(newLat - p.latitude) + Math.abs(newLng - p.longitude) > 1e-6;
        return { ...p, latitude: newLat, longitude: newLng, heading: moved ? heading : p.heading };
      });
      setNearbyVehicles(next);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [pinLocation, snapPointsToRoads]);

  const visibleVehicles = useMemo(() => {
    if (!displaySettings.showVehicleMarkers) return [];
    if (!displaySettings.rideTypes) return [];
    if (rideTypes.length === 0) return [];
    if (!rideTypes.some((t) => t.id === selectedRideType)) return [];
    return vehicleIds.filter((v) => v.type === selectedRideType);
  }, [vehicleIds, selectedRideType, rideTypes, displaySettings.showVehicleMarkers, displaySettings.rideTypes]);

  const allRecentLocations = useMemo(() => [
    { id: '1', name: 'Shaftsbury Putrajaya', lat: 2.9264, lng: 101.6964 },
    { id: '2', name: 'MesaMall', lat: 2.8203, lng: 101.7635 },
    { id: '3', name: 'KLCC Suria', lat: 3.1579, lng: 101.7123 },
    { id: '4', name: 'Pavilion KL', lat: 3.1490, lng: 101.7130 },
    { id: '5', name: 'Mid Valley Megamall', lat: 3.1185, lng: 101.6776 },
    { id: '6', name: 'KL Sentral', lat: 3.1338, lng: 101.6869 },
    { id: '7', name: 'IOI City Mall', lat: 2.9682, lng: 101.7137 },
    { id: '8', name: 'Sunway Pyramid', lat: 3.0726, lng: 101.6075 },
  ], []);
  const recentLocations = useMemo(
    () => allRecentLocations.slice(0, displaySettings.recentLocationsCount),
    [allRecentLocations, displaySettings.recentLocationsCount]
  );

  const SERVICE_ICON_MAP: Record<string, LucideIcon> = {
    ShoppingBag, Car, Building2, Package, Truck, Bike, Bus, Plane, MapPin, Navigation, Clock, Bell,
  };
  const DEFAULT_BOX_PRESETS = [
    { id: 'groceries', title: 'Groceries\nin 30 min', accent: '#4CAF50' },
    { id: 'city-rides', title: 'City rides', accent: '#A8E063' },
    { id: 'city-to-city', title: 'City to City', accent: '#FFD54F' },
    { id: 'couriers', title: 'Couriers', accent: '#A8E063' },
    { id: 'freight', title: 'Freight', accent: '#A8E063' },
  ] as const;
  const serviceCategories = useMemo(() => {
    return DEFAULT_BOX_PRESETS.map((preset, idx) => {
      const cfg = displaySettings.serviceBoxes[idx];
      const linkedSvc = cfg?.serviceId
        ? serviceSettingEntries.find((s) => s.id === cfg.serviceId)
        : undefined;
      const title = (cfg?.name && cfg.name.trim())
        ? cfg.name
        : linkedSvc
          ? String(linkedSvc.values.name ?? preset.title)
          : preset.title;
      const Icon = SERVICE_ICON_MAP[cfg?.iconName ?? ''] ?? (idx === 0 ? ShoppingBag : idx === 1 ? Car : idx === 2 ? Building2 : idx === 3 ? Package : Truck);
      return {
        id: preset.id,
        title,
        badge: idx === 0 && displaySettings.serviceBoxBadge ? 'NEW' : undefined,
        Icon,
        imageUri: cfg?.imageUri,
        bg: '#2A2A2A',
        accent: preset.accent,
        large: idx === 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySettings.serviceBoxes, displaySettings.serviceBoxBadge, serviceSettingEntries]);

  useEffect(() => {
    if (location && !pinLocation) {
      console.log("[HomeScreen] Using location from context:", location.coords);
      setPinLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    }
  }, [location, pinLocation]);

  useEffect(() => {
    if (contextAddress && !currentAddress) {
      console.log("[HomeScreen] Using address from context:", contextAddress);
      setCurrentAddress(contextAddress);
    }
  }, [contextAddress, currentAddress]);

  useEffect(() => {
    if (location && mapRef.current) {
      console.log("Animating map to current location");
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        1000
      );
    }
  }, [location]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 8,
    }).start();
  }, [slideAnim]);

  const resetAnimations = React.useCallback(() => {
    console.log("Resetting index screen animations");
    bottomSheetExpandedRef.current = false;
    setIsBottomSheetExpanded(false);
    menuHiddenBySheet.current = false;
    isMapMoving.current = false;
    bottomSheetDragAnim.setValue(0);
    bottomSheetAnim.setValue(0);
    slideAnim.setValue(0);
    pinDropAnim.setValue(0);
    pinInnerScaleAnim.setValue(1);
    pinShadowOpacity.setValue(0);
    addressBarOpacity.setValue(1);
    Animated.timing(menuButtonAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [bottomSheetDragAnim, bottomSheetAnim, slideAnim, menuButtonAnim, pinDropAnim, pinInnerScaleAnim, pinShadowOpacity, addressBarOpacity]);

  const handleCityPress = React.useCallback(() => {
    console.log("City pressed - resetting animations and detecting location");
    resetAnimations();
    
    // Trigger location detection and animate map
    refreshLocation().then((result) => {
      if (result) {
        const { location: newLocation, address: newAddress } = result;
        console.log("Location detected:", newLocation.coords);
        setPinLocation({
          latitude: newLocation.coords.latitude,
          longitude: newLocation.coords.longitude,
        });
        if (newAddress) {
          setCurrentAddress(newAddress);
        }

        if (mapRef.current) {
          mapRef.current.animateToRegion(
            {
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            },
            500
          );
        }
      }
    }).catch((error) => {
      console.warn("Error detecting location:", error);
    });
  }, [resetAnimations, refreshLocation]);

  useFocusEffect(
    React.useCallback(() => {
      console.log("Index screen focused - resetting bottom sheet to collapsed state");
      
      // Check if coming from ride-confirm with pickup location params
      if (params.fromRideConfirm === 'true' && params.pickupLat && params.pickupLng && !hasInitializedFromParams.current) {
        hasInitializedFromParams.current = true;
        console.log("Coming from ride-confirm, setting pin to pickup location without animation");
        
        const pickupLat = parseFloat(params.pickupLat as string);
        const pickupLng = parseFloat(params.pickupLng as string);
        
        // Set pin location immediately without animation
        setPinLocation({
          latitude: pickupLat,
          longitude: pickupLng,
        });
        
        // Set address if provided
        if (params.pickupName) {
          setCurrentAddress({
            name: params.pickupName as string,
            address: params.pickupName as string,
          });
        }
        
        // Reset animations to default state without running them
        bottomSheetExpandedRef.current = false;
        setIsBottomSheetExpanded(false);
        menuHiddenBySheet.current = false;
        isMapMoving.current = false;
        bottomSheetDragAnim.setValue(0);
        bottomSheetAnim.setValue(0);
        slideAnim.setValue(0);
        pinDropAnim.setValue(0);
        pinInnerScaleAnim.setValue(1);
        pinShadowOpacity.setValue(0);
        addressBarOpacity.setValue(1);
        menuButtonAnim.setValue(0);
        
        // Move map to pickup location without animation
        // Set flag to skip region change handling during initial camera set
        skipRegionChangeRef.current = true;
        if (mapRef.current) {
          mapRef.current.setCamera({
            center: {
              latitude: pickupLat,
              longitude: pickupLng,
            },
            zoom: 16,
          });
          // Reset the skip flag after a short delay to allow normal interactions
          setTimeout(() => {
            skipRegionChangeRef.current = false;
          }, 500);
        } else {
          skipRegionChangeRef.current = false;
        }
        return;
      }
      
      // Reset hasInitializedFromParams when params change
      if (params.fromRideConfirm !== 'true') {
        hasInitializedFromParams.current = false;
      }
      
      resetAnimations();
      
      if (shouldSkipLocationDetection()) {
        console.log("Skipping location detection (coming from ride-confirm back button)");
      } else {
        console.log("Triggering location detection on focus");
        refreshLocation().then((result) => {
          if (result) {
            const { location: newLocation, address: newAddress } = result;
            console.log("Location detected on focus:", newLocation.coords);
            setPinLocation({
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
            });
            if (newAddress) {
              setCurrentAddress(newAddress);
            }

            if (mapRef.current) {
              mapRef.current.animateToRegion(
                {
                  latitude: newLocation.coords.latitude,
                  longitude: newLocation.coords.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                },
                500
              );
            }
          }
        }).catch((error) => {
          console.warn("Error detecting location on focus:", error);
        });
      }
    }, [resetAnimations, shouldSkipLocationDetection, refreshLocation, params.fromRideConfirm, params.pickupLat, params.pickupLng, params.pickupName])
  );

  useEffect(() => {
    if (prevColorScheme.current !== colorScheme) {
      console.log("Theme changed from", prevColorScheme.current, "to", colorScheme);
      prevColorScheme.current = colorScheme;
      setMapKey(prev => prev + 1);
    }
  }, [colorScheme]);

  useEffect(() => {
    if (location) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [location, pulseAnim]);

  useEffect(() => {
    if (isLoadingAddress) {
      Animated.loop(
        Animated.timing(loadingSpinnerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      loadingSpinnerAnim.setValue(0);
    }
  }, [isLoadingAddress, loadingSpinnerAnim]);

  const initialRegion = {
    latitude: location?.coords.latitude || 37.7749,
    longitude: location?.coords.longitude || -122.4194,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const handleRegionChange = () => {
    if (skipRegionChangeRef.current) {
      return;
    }
    if (!isMapMoving.current) {
      isMapMoving.current = true;
      // User is moving the map: invalidate any pending recenter refresh so a
      // late-resolving GPS fetch doesn't snap the pin back where they moved from.
      pendingRecenterRef.current = false;
      console.log("Map started moving - hiding menu button and sliding bottom sheet down");
      Animated.parallel([
        Animated.timing(menuButtonAnim, {
          toValue: -150,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(bottomSheetAnim, {
          toValue: BOTTOM_SHEET_MIN_HEIGHT + 56,
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
        Animated.timing(pinDropAnim, {
          toValue: -25,
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

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleRegionChangeComplete = async (region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }) => {
    console.log("Map region changed:", region.latitude, region.longitude);
    
    if (skipRegionChangeRef.current) {
      return;
    }
    
    if (isMapMoving.current) {
      isMapMoving.current = false;
      console.log("Map stopped moving - showing menu button and sliding bottom sheet up");
      pinShadowOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(menuButtonAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.spring(bottomSheetAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.spring(pinInnerScaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.spring(pinDropAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 200,
          friction: 8,
        }),
        Animated.timing(addressBarOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
    
    setPinLocation({ latitude: region.latitude, longitude: region.longitude });
    
    // Check if pin is very close to current location (within 30 meters)
    if (location && contextAddress) {
      const distanceToCurrentLocation = calculateDistance(
        region.latitude,
        region.longitude,
        location.coords.latitude,
        location.coords.longitude
      );
      
      console.log("Distance to current location:", distanceToCurrentLocation, "meters");
      
      if (distanceToCurrentLocation < 30) {
        console.log("Pin is near current location, using context address:", contextAddress);
        setCurrentAddress(contextAddress);
        return;
      }
    }
    
    setIsLoadingAddress(true);
    try {
      const addressData = await reverseGeocode(region.latitude, region.longitude);
      if (addressData) {
        console.log("New address from pin move:", addressData);
        setCurrentAddress(addressData);
      }
    } catch (error) {
      console.warn("Error getting address for new pin location:", error);
    } finally {
      setIsLoadingAddress(false);
    }
  };

  const menuOverlayOpacity = menuRevealAnim.interpolate({
    inputRange: [0, MENU_WIDTH],
    outputRange: [0, 0.5],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.outerContainer, { backgroundColor: Colors.background }]}>
      {/* Menu Side Sheet - positioned on the left */}
      <Animated.View
        style={[
          styles.inlineMenuContainer,
          {
            width: MENU_WIDTH,
            backgroundColor: Colors.secondary,
            transform: [{ translateX: Animated.subtract(menuRevealAnim, MENU_WIDTH) }],
          },
        ]}
        {...menuPanResponder.panHandlers}
      >
        <MenuSideSheet
          inline
          visible
          onClose={handleCloseMenu}
          onNavigateToIndex={handleCloseMenu}
        />
      </Animated.View>

      {/* Main Content Container */}
      <Animated.View
        style={[
          styles.container,
          {
            width: windowWidth,
            backgroundColor: Colors.background,
            transform: [{ translateX: menuRevealAnim }],
          },
        ]}
        {...mainContentPanResponder.panHandlers}
      >
        {/* Menu overlay when open */}
        <Pressable
          onPress={handleCloseMenu}
          style={[styles.menuOverlay, { pointerEvents: menuFullyOpen ? 'auto' : 'none' }]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: '#000', opacity: menuOverlayOpacity },
            ]}
          />
        </Pressable>

        {Platform.OS !== "web" && MapView ? (
          <MapView
            key={`map-${colorScheme}-${mapKey}`}
            ref={mapRef}
            style={[styles.map, { width: windowWidth, height: windowHeight + displaySettings.mapHeightOffset, marginTop: -displaySettings.mapHeightOffset }]}
            initialRegion={initialRegion}
            mapType={mapType}
            showsUserLocation
            showsMyLocationButton={false}
            customMapStyle={colorScheme === "dark" ? darkMapStyle : lightMapStyle}
            userInterfaceStyle={colorScheme === "dark" ? "dark" : "light"}
            onRegionChange={handleRegionChange}
            onRegionChangeComplete={handleRegionChangeComplete}
            scrollEnabled={!isBottomSheetExpanded && !menuFullyOpen}
            zoomEnabled={!isBottomSheetExpanded && !menuFullyOpen}
            rotateEnabled={!isBottomSheetExpanded && !menuFullyOpen}
            pitchEnabled={!isBottomSheetExpanded && !menuFullyOpen}
          >
            {Marker && visibleVehicles.map((v) => (
              <NearbyVehicleMarker
                key={v.id}
                id={v.id}
                type={v.type}
                initialLatitude={v.latitude}
                initialLongitude={v.longitude}
                initialHeading={v.heading}
              />
            ))}
          </MapView>
        ) : (
          <WebMap
            key={`webmap-${colorScheme}`}
            ref={mapRef}
            style={[styles.map, { width: windowWidth, height: windowHeight + displaySettings.mapHeightOffset, marginTop: -displaySettings.mapHeightOffset }]}
            initialRegion={initialRegion}
            dark={colorScheme === "dark"}
            satellite={mapType === "satellite"}
            accentColor={Colors.accent}
            userLocation={location ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null}
            markers={visibleVehicles.map((v) => ({
              id: v.id,
              coordinate: { latitude: v.latitude, longitude: v.longitude },
              kind: "vehicle" as const,
              heading: v.heading,
            }))}
            interactive={!isBottomSheetExpanded && !menuFullyOpen}
            onRegionChange={handleRegionChange}
            onRegionChangeComplete={handleRegionChangeComplete}
          />
        )}

        {/* Center Pin with Address Bar - positioned together */}
        <View style={[styles.centerPinContainer, { pointerEvents: "box-none" }]}>
          {displaySettings.addressBar ? (
          <Animated.View style={{ opacity: addressBarOpacity, transform: [{ translateY: displaySettings.addressBarTopOffset }] }}>
          <TouchableOpacity
            style={[
              styles.pickupAddressBar,
              { backgroundColor: Colors.secondary },
              isLoadingAddress && styles.pickupAddressBarLoading
            ]}
            onPress={() => {
              if (!displaySettings.serviceEnabled) {
                setServiceComingSoonVisible(true);
                return;
              }
              if (pinLocation) {
                router.push({
                  pathname: "/search" as any,
                  params: {
                    currentLat: pinLocation.latitude.toString(),
                    currentLng: pinLocation.longitude.toString(),
                    currentName: currentAddress?.name || "",
                  },
                });
              } else if (location) {
                router.push({
                  pathname: "/search" as any,
                  params: {
                    currentLat: location.coords.latitude.toString(),
                    currentLng: location.coords.longitude.toString(),
                    currentName: currentAddress?.name || "",
                  },
                });
              } else {
                router.push("/search" as any);
              }
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ busy: isLoadingAddress }}
            accessibilityLabel={
              isLoadingAddress
                ? "Finding your pickup point"
                : `Pickup point: ${currentAddress?.name || "not set"}. Change pickup location`
            }
          >
            {isLoadingAddress ? (
              <Animated.View 
                style={[
                  styles.loadingSpinnerContainer,
                  {
                    transform: [{
                      rotate: loadingSpinnerAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    }],
                  },
                ]}
              >
                <View style={styles.loadingSpinner}>
                  <View style={[styles.loadingSpinnerTrack, { borderColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)' }]} />
                  <View style={[styles.loadingSpinnerHead, { borderTopColor: colorScheme === 'dark' ? '#fff' : '#000', borderRightColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)' }]} />
                </View>
              </Animated.View>
            ) : (
              <>
                <View style={styles.pickupAddressContent}>
                  <Text style={[styles.pickupLabel, { color: Colors.textSecondary }]}>Pickup point</Text>
                  <Text style={[styles.pickupAddress, { color: Colors.text }]} numberOfLines={1}>
                    {currentAddress?.name || "Set pickup location"}
                  </Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={20} />
              </>
            )}
          </TouchableOpacity>
          </Animated.View>
          ) : null}
          
          {/* Pin directly below address bar */}
          <Animated.View style={[styles.centerPinWrapper, { marginTop: 24 + displaySettings.dropPinTopOffset, marginLeft: displaySettings.dropPinHorizontalOffset, transform: [{ translateY: pinDropAnim }], pointerEvents: "none" }]}>
            <View style={styles.centerPin}>
              <Animated.View style={[styles.centerPinInner, { transform: [{ scale: pinInnerScaleAnim }], backgroundColor: colorScheme === 'dark' ? '#1a1a1a' : '#fff' }]} />
            </View>
            <View style={styles.pinPointer} />
          </Animated.View>
          <Animated.View style={[styles.centerPinShadow, { opacity: pinShadowOpacity, pointerEvents: "none" }]} />
        </View>

        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <View style={styles.topBar}>
            <Animated.View 
              style={{ transform: [{ translateY: menuButtonAnim }] }}
              {...menuButtonPanResponder.panHandlers}
            >
              <TouchableOpacity
                style={[styles.menuButton, { backgroundColor: Colors.secondary }]}
                onPress={handleOpenMenu}
                accessibilityRole="button"
                accessibilityLabel="Open menu"
              >
                <Menu color={Colors.text} size={24} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </SafeAreaView>

      {/* Ride Type Info Bottom Sheet */}
      <Modal
        visible={infoSheetModalVisible}
        transparent
        animationType="none"
        onRequestClose={() => {
          Animated.timing(infoSheetAnim, {
            toValue: 300,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            setInfoSheetModalVisible(false);
            infoSheetDragOffset.setValue(0);
          });
        }}
      >
        <Pressable 
          style={styles.infoSheetOverlay}
          onPress={() => {
            Animated.timing(infoSheetAnim, {
              toValue: 300,
              duration: 150,
              useNativeDriver: true,
            }).start(() => setInfoSheetModalVisible(false));
          }}
        >
          <Animated.View 
            style={[styles.infoSheetContainer, { backgroundColor: Colors.secondary, transform: [{ translateY: Animated.add(infoSheetAnim, infoSheetDragOffset) }] }]}
            {...infoSheetPanResponder.panHandlers}
          >
            <TouchableOpacity
              style={styles.infoSheetCloseButton}
              // 32pt visual circle; hitSlop lifts the tap area to 48pt without
              // moving the icon off the sheet corner.
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => {
                Animated.timing(infoSheetAnim, {
                  toValue: 300,
                  duration: 150,
                  useNativeDriver: true,
                }).start(() => setInfoSheetModalVisible(false));
              }}
            >
              <X color={Colors.textSecondary} size={24} />
            </TouchableOpacity>
            
            <View style={styles.infoSheetCarContainer}>
              {infoSheetRideType?.image && (
                <Image
                  source={{ uri: infoSheetRideType.image }}
                  style={styles.infoSheetCarImage}
                  resizeMode="contain"
                />
              )}
            </View>
            
            <Text style={[styles.infoSheetTitle, { color: Colors.text }]}>
              {infoSheetRideType?.name}
            </Text>
            
            <Text style={[styles.infoSheetDescription, { color: Colors.textSecondary }]}>
              {infoSheetRideType?.description || ''}
            </Text>
            
            <TouchableOpacity
              style={[styles.infoSheetOkButton, { backgroundColor: Colors.gray[700] }]}
              accessibilityRole="button"
              accessibilityLabel="OK"
              onPress={() => {
                Animated.timing(infoSheetAnim, {
                  toValue: 300,
                  duration: 150,
                  useNativeDriver: true,
                }).start(() => setInfoSheetModalVisible(false));
              }}
            >
              <Text style={[styles.infoSheetOkButtonText, { color: Colors.text }]}>OK</Text>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>
      </Modal>

      {/* Recenter Button */}
      {displaySettings.recenterButton ? (
      <Animated.View
        style={[
          styles.recenterButtonContainer,
          { 
            bottom: displaySettings.recenterButtonBottom,
            transform: [
              { translateY: bottomSheetAnim },
              { translateY: bottomSheetDragAnim },
            ],
            opacity: Animated.multiply(
              addressBarOpacity,
              menuButtonAnim.interpolate({
                inputRange: [-150, 0],
                outputRange: [0, 1],
              })
            ),
          }
        ]}
      >
        <TouchableOpacity
          style={[
            styles.mapTypeButton,
            {
              backgroundColor: mapType === "satellite" ? Colors.accent : Colors.secondary,
            },
          ]}
          onPress={() => {
            setMapType((prev) => (prev === "standard" ? "satellite" : "standard"));
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: mapType === "satellite" }}
          accessibilityLabel="Satellite view"
          accessibilityHint={mapType === "satellite" ? "Switches back to the standard map" : "Switches the map to satellite imagery"}
          testID="map-type-toggle"
        >
          <Layers
            color={
              mapType === "satellite"
                ? "#fff"
                : colorScheme === "dark"
                  ? Colors.accent
                  : "#000"
            }
            size={22}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.recenterButton, { backgroundColor: Colors.secondary }]}
          onPress={() => {
            if (location && mapRef.current) {
              console.log("Recentering map to user location");
              // Move immediately to the location we already have so the pin
              // jumps without waiting for a fresh GPS fetch + reverse geocode.
              mapRef.current.animateToRegion(
                {
                  latitude: location.coords.latitude,
                  longitude: location.coords.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                },
                350
              );
              setPinLocation({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              });
              // Skip region-change handling triggered by this programmatic move,
              // then mark a recenter refresh as pending so we can cancel it if the
              // user starts dragging the map before it resolves.
              skipRegionChangeRef.current = true;
              pendingRecenterRef.current = true;
              setTimeout(() => {
                skipRegionChangeRef.current = false;
              }, 500);
              // Refresh in the background and fine-tune if the new fix differs.
              refreshLocation().then((result) => {
                if (result && mapRef.current && pendingRecenterRef.current) {
                  pendingRecenterRef.current = false;
                  const { location: newLocation, address: newAddress } = result;
                  mapRef.current.animateToRegion(
                    {
                      latitude: newLocation.coords.latitude,
                      longitude: newLocation.coords.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    },
                    350
                  );
                  setPinLocation({
                    latitude: newLocation.coords.latitude,
                    longitude: newLocation.coords.longitude,
                  });
                  if (newAddress) {
                    setCurrentAddress(newAddress);
                  }
                }
              });
            }
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on my location"
        >
          <Navigation color={colorScheme === 'dark' ? Colors.accent : '#000'} size={22} />
        </TouchableOpacity>
      </Animated.View>
      ) : null}

      <Animated.View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: Colors.secondary,
            transform: [
              { translateY: slideAnim },
              { translateY: bottomSheetAnim },
              { translateY: bottomSheetDragAnim },
            ],
          },
        ]}
        {...handlePanResponder.panHandlers}
      >
        <View style={[styles.handle, { backgroundColor: Colors.gray[400] }]} />

        {/* Ride Type Selector */}
        {displaySettings.rideTypes ? (
        <ScrollView 
          ref={rideTypeScrollRef}
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rideTypeContainer}
        >
          {rideTypes.map((type, index) => {
            const isSelected = selectedRideType === type.id;
            const cardWidth = 70;
            const selectedCardWidth = 100;
            return (
              <TouchableOpacity
                key={type.id}
                onPress={() => {
                  const animations = rideTypes.map((t) => {
                    const isNewSelected = t.id === type.id;
                    const targetMargin = isNewSelected ? 0 : 5;
                    return Animated.spring(rideTypeMargins[t.id], {
                      toValue: targetMargin,
                      useNativeDriver: false,
                      tension: 100,
                      friction: 10,
                    });
                  });
                  Animated.parallel(animations).start();
                  setSelectedRideType(type.id);
                  
                  // Auto-scroll to show selected card fully
                  if (rideTypeScrollRef.current) {
                    let scrollX = 0;
                    for (let i = 0; i < index; i++) {
                      const wasSelected = rideTypes[i].id === selectedRideType;
                      scrollX += wasSelected ? selectedCardWidth : cardWidth;
                    }
                    // Center the selected card
                    const screenPadding = 20;
                    const visibleWidth = width - (screenPadding * 2);
                    const centeredX = Math.max(0, scrollX - (visibleWidth / 2) + (selectedCardWidth / 2));
                    rideTypeScrollRef.current.scrollTo({ x: centeredX, animated: true });
                  }
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${type.name}, seats ${type.capacity}`}
              >
                <Animated.View
                  style={[
                    styles.rideTypeCard,
                    isSelected && [
                      styles.rideTypeCardSelected,
                      { backgroundColor: '#2A4A6B' },
                    ],
                    { marginLeft: rideTypeMargins[type.id], marginRight: rideTypeMargins[type.id] },
                  ]}
                >
                {isSelected && (
                  <TouchableOpacity
                    style={styles.rideTypeInfoBadge}
                    onPress={() => {
                      setInfoSheetRideType(type);
                      setInfoSheetModalVisible(true);
                      Animated.timing(infoSheetAnim, {
                        toValue: 0,
                        duration: 150,
                        useNativeDriver: true,
                      }).start();
                    }}
                    // 18pt badge; 14pt of slop on each side brings the tap area
                    // up to 46pt, over the 44pt minimum.
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel={`About ${type.name}`}
                  >
                    <Text style={styles.rideTypeInfoBadgeText}>i</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.rideTypeImageContainer}>
                  <Image
                    source={{ uri: type.image }}
                    style={styles.carImage}
                    resizeMode="contain"
                  />
                </View>
                <View style={[
                    styles.rideTypeInfo,
                    isSelected && styles.rideTypeInfoSelected
                  ]}>
                  <Text style={[
                    styles.rideTypeName,
                    { color: isSelected ? '#fff' : Colors.textSecondary }
                  ]}>
                    {type.name}
                  </Text>
                  <View style={styles.rideTypeCapacity}>
                    <Users color={isSelected ? '#ccc' : Colors.textSecondary} size={12} />
                    <Text style={[styles.rideTypeCapacityText, { color: isSelected ? '#ccc' : Colors.textSecondary }]}>
                      {type.capacity}
                    </Text>
                  </View>
                </View>
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        ) : null}

        <View {...bottomSheetPanResponder.panHandlers}>
          {displaySettings.searchBar ? (
          <TouchableOpacity
          style={[styles.searchButton, { backgroundColor: Colors.gray[100] }]}
          accessibilityRole="search"
          accessibilityLabel="Where to and for how much? Search a destination"
          onPress={() => {
            if (!displaySettings.serviceEnabled) {
              setServiceComingSoonVisible(true);
              return;
            }
            if (pinLocation) {
              router.push({
                pathname: "/search" as any,
                params: {
                  currentLat: pinLocation.latitude.toString(),
                  currentLng: pinLocation.longitude.toString(),
                  currentName: currentAddress?.name || "",
                },
              });
            } else if (location) {
              router.push({
                pathname: "/search" as any,
                params: {
                  currentLat: location.coords.latitude.toString(),
                  currentLng: location.coords.longitude.toString(),
                  currentName: currentAddress?.name || "",
                },
              });
            } else {
              router.push("/search" as any);
            }
          }}
        >
          <Search color={Colors.textSecondary} size={22} />
          <Text style={[styles.searchPlaceholder, { color: Colors.textSecondary }]}>
            Where to & for how much?
          </Text>
        </TouchableOpacity>
        ) : null}

        {displaySettings.recentLocations ? (
        <View style={styles.recentLocationsContainer}>
          {recentLocations.map((loc) => (
            <TouchableOpacity
              key={loc.id}
              style={styles.recentLocationItem}
              onPress={() => {
                if (!displaySettings.serviceEnabled) {
                  setServiceComingSoonVisible(true);
                  return;
                }
                const pickupCoords = pinLocation || (location ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null);
                if (pickupCoords) {
                  router.push({
                    pathname: "/ride-confirm" as any,
                    params: {
                      pickup: currentAddress?.name || "Current Location",
                      destination: loc.name,
                      pickupLat: pickupCoords.latitude.toString(),
                      pickupLng: pickupCoords.longitude.toString(),
                      destLat: loc.lat.toString(),
                      destLng: loc.lng.toString(),
                    },
                  });
                } else {
                  router.push({
                    pathname: "/ride-confirm" as any,
                    params: {
                      pickup: "Current Location",
                      destination: loc.name,
                      pickupLat: "3.139",
                      pickupLng: "101.6869",
                      destLat: loc.lat.toString(),
                      destLng: loc.lng.toString(),
                    },
                  });
                }
              }}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`Ride to ${loc.name}`}
            >
              <MapPin color={Colors.textSecondary} size={20} />
              <Text style={[styles.recentLocationText, { color: Colors.text }]}>
                {loc.name}
              </Text>
            </TouchableOpacity>
          ))}
          </View>
          ) : null}

          {displaySettings.serviceCategories ? (
          <View style={styles.serviceGrid}>
            <View style={styles.serviceColLeft}>
              {(() => {
                const item = serviceCategories[0];
                const IconComp = item.Icon;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.serviceCardLarge, { backgroundColor: item.bg }]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={item.badge ? `${item.title}, ${item.badge}` : item.title}
                    onPress={() => console.log('[HomeScreen] service tapped:', item.id)}
                  >
                    <View style={styles.serviceCardHeader}>
                      <Text style={[styles.serviceCardTitle, { color: Colors.text }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.badge && (
                        <View style={styles.serviceBadge}>
                          <Text style={styles.serviceBadgeText}>{item.badge}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.serviceIconWrapLarge}>
                      {item.imageUri ? (
                        <Image source={{ uri: item.imageUri }} style={styles.serviceIconImageLarge} resizeMode="cover" />
                      ) : (
                        <IconComp color={item.accent} size={72} strokeWidth={1.5} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })()}
              {(() => {
                const item = serviceCategories[3];
                const IconComp = item.Icon;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.serviceCardSmall, { backgroundColor: item.bg }]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => console.log('[HomeScreen] service tapped:', item.id)}
                  >
                    <Text style={[styles.serviceCardTitle, { color: Colors.text }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <View style={styles.serviceIconWrapSmall}>
                      {item.imageUri ? (
                        <Image source={{ uri: item.imageUri }} style={styles.serviceIconImageSmall} resizeMode="cover" />
                      ) : (
                        <IconComp color={item.accent} size={48} strokeWidth={1.5} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })()}
            </View>
            <View style={styles.serviceColRight}>
              {[serviceCategories[1], serviceCategories[2], serviceCategories[4]].map((item) => {
                const IconComp = item.Icon;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.serviceCardSmall, { backgroundColor: item.bg }]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => console.log('[HomeScreen] service tapped:', item.id)}
                  >
                    <Text style={[styles.serviceCardTitle, { color: Colors.text }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <View style={styles.serviceIconWrapSmall}>
                      {item.imageUri ? (
                        <Image source={{ uri: item.imageUri }} style={styles.serviceIconImageSmall} resizeMode="cover" />
                      ) : (
                        <IconComp color={item.accent} size={44} strokeWidth={1.5} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          ) : null}
        </View>
      </Animated.View>
      </Animated.View>

      <Modal
        visible={serviceComingSoonVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setServiceComingSoonVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.csOverlay}>
          <View style={[styles.csCard, { backgroundColor: Colors.secondary }]}>
            <Text style={[styles.csTitle, { color: Colors.text }]}>Coming Soon</Text>
            <Text style={[styles.csBody, { color: Colors.textSecondary }]}>This service isn&apos;t available yet. Please check back later.</Text>
            <TouchableOpacity
              style={[styles.csButton, { backgroundColor: Colors.accent }]}
              onPress={() => setServiceComingSoonVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="OK"
              testID="service-coming-soon-ok"
            >
              <Text style={[styles.csButtonText, { color: Colors.onAccent }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  csOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 40,
  },
  csCard: {
    width: "100%" as const,
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    alignItems: "center" as const,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  csTitle: {
    fontSize: 19,
    fontWeight: "700" as const,
    marginBottom: 8,
  },
  csBody: {
    fontSize: 15,
    textAlign: "center" as const,
    marginBottom: 20,
  },
  csButton: {
    alignSelf: "stretch" as const,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center" as const,
  },
  csButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  container: {
    flex: 1,
    width: width,
  },
  menuOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  inlineMenuContainer: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 50,
  },
  menuSafeArea: {
    flex: 1,
  },
  menuProfileSection: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  menuProfileContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  menuAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  menuAvatarText: {
    fontSize: 24,
    fontWeight: "700" as const,
  },
  menuProfileInfo: {
    flex: 1,
  },
  menuProfileName: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  menuRatingContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  menuRatingStar: {
    fontSize: 14,
    letterSpacing: 2,
  },
  menuRatingText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  menuItemsScroll: {
    flex: 1,
    paddingTop: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 20,
  },
  menuFooter: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  driverModeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 8,
  },
  driverModeText: {
    fontSize: 18,
    fontWeight: "700" as const,
  },
  adminLoginButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  adminLoginText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  socialContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
  },
  socialButton: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  facebookIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1877F2",
    justifyContent: "center",
    alignItems: "center",
  },
  instagramIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E4405F",
    justifyContent: "center",
    alignItems: "center",
  },
  socialIconText: {
    fontSize: 20,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  infoSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  infoSheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 5000,
    marginBottom: -4960,
  },
  infoSheetCloseButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  infoSheetCarContainer: {
    marginBottom: 16,
    marginTop: 8,
  },
  infoSheetCarImage: {
    width: 120,
    height: 72,
  },
  infoSheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  infoSheetDescription: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  infoSheetOkButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  infoSheetOkButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  map: {
    width,
    height: height + 365,
    marginTop: -365,
  },
  safeArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  recenterButtonContainer: {
    position: "absolute",
    right: 20,
    bottom: 459,
    zIndex: 20,
  },
  recenterButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  mapTypeButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: height,
    marginBottom: -height + 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  rideTypeContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  rideTypeCard: {
    minWidth: 50,
    height: 65,
    paddingTop: 0,
    paddingBottom: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    position: 'relative',
    justifyContent: 'flex-end',
    borderWidth: 0,
  },
  rideTypeCardSelected: {
    borderWidth: 0,
  },
  rideTypeInfoBadge: {
    position: 'absolute',
    top: 13,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#7BB8E8',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  rideTypeInfoBadgeText: {
    color: '#7BB8E8',
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  rideTypeImageContainer: {
    width: '100%',
    flex: 2,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  carImage: {
    width: 48,
    height: 28,
  },
  rideTypeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 0,
    gap: 8,
  },
  rideTypeInfoSelected: {
    justifyContent: 'flex-start',
    gap: 25,
  },
  rideTypeName: {
    fontSize: 13,
    fontWeight: '500',
  },
  rideTypeCapacity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rideTypeCapacityText: {
    fontSize: 12,
    fontWeight: '500',
  },
  searchButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 20,
    gap: 12,
  },
  searchPlaceholder: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  recentLocationsContainer: {
    gap: 4,
  },
  recentLocationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 16,
  },
  recentLocationText: {
    fontSize: 16,
    fontWeight: '600',
  },
  serviceGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  serviceColLeft: {
    flex: 1,
    gap: 10,
  },
  serviceColRight: {
    flex: 1,
    gap: 10,
  },
  serviceCardLarge: {
    borderRadius: 18,
    padding: 14,
    height: 210,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  serviceCardSmall: {
    borderRadius: 18,
    padding: 14,
    height: 100,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  serviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  serviceCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    flexShrink: 1,
  },
  serviceBadge: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  serviceBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  serviceIconWrapLarge: {
    alignSelf: 'flex-end',
  },
  serviceIconWrapSmall: {
    alignSelf: 'flex-end',
  },
  serviceIconImageLarge: {
    width: 84,
    height: 84,
    borderRadius: 14,
  },
  serviceIconImageSmall: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  bottomSheetSpacer: {
    height: 130,
  },
  markerContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 60,
    height: 60,
  },
  pulseRing: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute",
    top: 3,
    left: 3,
  },
  webMapPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  webMapContent: {
    alignItems: "center",
    gap: 12,
  },
  webMapText: {
    fontSize: 20,
    fontWeight: "700",
  },
  webMapSubtext: {
    fontSize: 14,
  },
  centerPinContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: height - BOTTOM_SHEET_MIN_HEIGHT + 80,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: ((height - BOTTOM_SHEET_MIN_HEIGHT + 80) / 2) - 197,
    zIndex: 5,
  },
  pickupAddressBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    minWidth: 160,
    maxWidth: width * 0.85,
  },
  pickupAddressBarLoading: {
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  pickupAddressContent: {
    flexShrink: 1,
    marginRight: 8,
  },
  pickupLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 2,
  },
  pickupAddress: {
    fontSize: 15,
    fontWeight: "600",
  },
  centerPinWrapper: {
    alignItems: "center",
    marginTop: 24,
  },
  centerPin: {
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
  },
  centerPinInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#1a1a1a",
  },
  pinPointer: {
    width: 3,
    height: 18,
    backgroundColor: "#4483e3",
    marginTop: -2,
  },
  centerPinShadow: {
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: "rgba(68, 131, 227, 0.6)",
    marginTop: 3,
  },
  loadingSpinnerContainer: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingSpinner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    position: 'relative',
  },
  loadingSpinnerTrack: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
  },
  loadingSpinnerHead: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
  },
});
