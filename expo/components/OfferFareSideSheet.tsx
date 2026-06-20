import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Switch,
  Dimensions,
  Animated,
  Image,
  TouchableWithoutFeedback,
  PanResponder,
  ScrollView,
  TextInput,
  FlatList,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLocation } from "@/contexts/LocationContext";
import {
  ArrowLeft,
  Info,
  Plus,
  ChevronRight,
  SlidersHorizontal,
  Send,
  Delete,
  X,
  Search,
  MapPin,
  Bookmark,
} from "lucide-react-native";
import { POPULAR_LOCATIONS } from "@/constants/mockLocations";
import PartnerModeSelectModal from "@/components/PartnerModeSelectModal";
import MenuSideSheet from "@/components/MenuSideSheet";
import { runWithMappingRotation } from "@/utils/mappingClient";
import { PlaceGatesList, useGatesForCoordinates } from "@/components/PlaceGates";
import { useAirportAreas, applyAirportAreaFilter, AirportArea } from "@/utils/airportAreas";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const MENU_WIDTH = SCREEN_WIDTH * 0.68;
// Swipes that begin within this many px of the screen's left/right border are
// ignored, so the very edge of the screen doesn't trigger the side menu.
const EDGE_SWIPE_DEAD_ZONE = 20;

interface Destination {
  address: string;
  lat: number;
  lng: number;
}

interface LocationResult {
  id: string;
  name: string;
  fullName: string;
  address: string;
  latitude: number;
  longitude: number;
  distance?: string;
  source?: 'google' | 'local';
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

function formatDistance(distanceInKm: number): string {
  if (distanceInKm < 1) {
    return "<1 km";
  }
  return `${distanceInKm.toFixed(1)}km`;
}

interface OfferFareSideSheetProps {
  visible: boolean;
  onClose: () => void;
  pickup?: string;
  destination?: string;
  destinations?: Destination[];
  recommendedFare?: number;
  entrance?: string;
  paymentMethod?: string;
  pickupLat?: number;
  pickupLng?: number;
  onFindDriver?: (fare: number, autoAccept: boolean) => void;
  onPickupPress?: () => void;
  onDestinationPress?: (index: number) => void;
  onAddStop?: () => void;
  onRemoveStop?: (index: number) => void;
  onFareUpdate?: (fare: number) => void;
  onEntrancePress?: () => void;
  onRouteStopsPress?: () => void;
  onOpenMenu?: () => void;
  onLocationSelect?: (field: 'pickup' | 'destination', location: { address: string; lat: number; lng: number }, destinationIndex?: number) => void;
}

export default function OfferFareSideSheet({
  visible,
  onClose,
  pickup = "Current Location",
  destination = "Destination",
  destinations = [],
  recommendedFare = 47,
  entrance = "",
  paymentMethod = "duitnow",
  pickupLat,
  pickupLng,
  onFindDriver,
  onPickupPress,
  onDestinationPress,
  onAddStop,
  onRemoveStop,
  onFareUpdate,
  onEntrancePress,
  onRouteStopsPress,
  onOpenMenu,
  onLocationSelect,
}: OfferFareSideSheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const { currency } = useLocation();
  const slideAnim = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const menuRevealAnim = useRef(new Animated.Value(0)).current;

  const minFare = Math.round(recommendedFare * 0.7);
  const maxFare = Math.round(recommendedFare * 4);

  const [fareValue, setFareValue] = useState(recommendedFare.toString());
  const [isEditing, setIsEditing] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [menuFullyOpen, setMenuFullyOpen] = useState(false);
  const [driverModeVisible, setDriverModeVisible] = useState<boolean>(false);
  const swipeThreshold = SCREEN_WIDTH * 0.25;

  // Embedded search state
  const [showEmbeddedSearch, setShowEmbeddedSearch] = useState(false);
  const [searchActiveField, setSearchActiveField] = useState<'pickup' | 'destination'>('destination');
  const [editingDestinationIndex, setEditingDestinationIndex] = useState<number | null>(null);
  const [isAddingNewStop, setIsAddingNewStop] = useState(false);
  const [searchPickup, setSearchPickup] = useState('');
  const [searchDestination, setSearchDestination] = useState('');
  const [searchResults, setSearchResults] = useState<LocationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'results' | 'suggested' | 'saved'>('suggested');
  const searchSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const currentMenuPosition = useRef(0);

  useEffect(() => {
    const listenerId = menuRevealAnim.addListener(({ value }) => {
      currentMenuPosition.current = value;
    });
    return () => menuRevealAnim.removeListener(listenerId);
  }, [menuRevealAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const startX = gestureState.moveX - gestureState.dx;
      const fromScreenEdge = startX <= EDGE_SWIPE_DEAD_ZONE || startX >= SCREEN_WIDTH - EDGE_SWIPE_DEAD_ZONE;
      const isLeftToRight = !fromScreenEdge && gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2);
      const isRightToLeft = gestureState.dx < -10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 2) && currentMenuPosition.current > 0;
      return isLeftToRight || isRightToLeft;
    },
    onPanResponderGrant: () => {
      console.log("OfferFare swipe started");
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
      return gestureState.dx < -5 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
    },
    onPanResponderGrant: () => {
      console.log("Menu swipe to close started");
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

  const handleCloseMenu = () => {
    setMenuFullyOpen(false);
    Animated.spring(menuRevealAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  };

  const currentFare = parseInt(fareValue) || 0;
  const isBelowMin = currentFare < minFare && currentFare > 0;
  const isAboveMax = currentFare > maxFare;
  const isValidFare = currentFare >= minFare && currentFare <= maxFare;

  useEffect(() => {
    if (visible) {
      setFareValue(recommendedFare.toString());
      menuRevealAnim.setValue(0);
      setMenuFullyOpen(false);
      setShowEmbeddedSearch(false);
      searchSlideAnim.setValue(SCREEN_HEIGHT);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, recommendedFare]);

  // Suggested locations with distance
  const suggestedLocations = useMemo((): LocationResult[] => {
    if (!pickupLat || !pickupLng) {
      return POPULAR_LOCATIONS.slice(0, 5).map((loc) => ({
        ...loc,
        fullName: loc.name,
        distance: undefined,
      }));
    }
    const MAX_DISTANCE_KM = 30;
    return POPULAR_LOCATIONS.map((loc) => {
      const dist = calculateDistance(
        pickupLat,
        pickupLng,
        loc.latitude,
        loc.longitude
      );
      return {
        ...loc,
        fullName: loc.name,
        distance: formatDistance(dist),
        distanceValue: dist,
      };
    })
      .filter((loc) => loc.distanceValue !== undefined && loc.distanceValue <= MAX_DISTANCE_KM)
      .sort((a, b) => (a.distanceValue ?? 0) - (b.distanceValue ?? 0))
      .slice(0, 10)
      .map(({ distanceValue, ...rest }) => rest);
  }, [pickupLat, pickupLng]);

  // Search effect
  useEffect(() => {
    if (!showEmbeddedSearch) return;
    
    const searchQuery = searchActiveField === 'pickup' ? searchPickup : searchDestination;
    
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const FALLBACK_KEY = "AIzaSyBj89Dt9v6SiDMvA3XUsoRm6ey6L-nKMfI";
        const buildAutoUrl = (key: string) =>
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            searchQuery
          )}&components=country:my&key=${key}`;
        let activeKey = FALLBACK_KEY;
        const data = await runWithMappingRotation<any>(
          "offer-fare",
          "autocomplete",
          async (ctx) => {
            const k = ctx.key || FALLBACK_KEY;
            activeKey = k;
            const r = await fetch(buildAutoUrl(k));
            const j = await r.json();
            return { ok: j?.status === "OK", value: j };
          },
          async () => {
            const r = await fetch(buildAutoUrl(FALLBACK_KEY));
            return r.json();
          }
        );
        const GOOGLE_API_KEY = activeKey;

        const q = searchQuery.trim().toLowerCase();
        const localMatches: LocationResult[] = POPULAR_LOCATIONS
          .filter((loc) => loc.name.toLowerCase().includes(q) || (loc.address ?? '').toLowerCase().includes(q))
          .map((loc) => {
            let dist: string | undefined;
            if (pickupLat && pickupLng) {
              const d = calculateDistance(pickupLat, pickupLng, loc.latitude, loc.longitude);
              dist = formatDistance(d);
            }
            return {
              id: `local-${loc.id}`,
              name: loc.name,
              fullName: loc.name,
              address: loc.address ?? loc.name,
              latitude: loc.latitude,
              longitude: loc.longitude,
              distance: dist,
              source: 'local' as const,
            };
          });

        let googleResults: LocationResult[] = [];
        if (data.status === "OK" && data.predictions?.length > 0) {
          const placeDetailsPromises = data.predictions.slice(0, 5).map(async (prediction: any) => {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,name,formatted_address&key=${GOOGLE_API_KEY}`;
            const detailsResponse = await fetch(detailsUrl);
            const detailsData = await detailsResponse.json();
            return { prediction, details: detailsData.result };
          });

          const placesWithDetails = await Promise.all(placeDetailsPromises);

          googleResults = placesWithDetails
            .filter((p) => p.details?.geometry)
            .map((p) => {
              const { prediction, details } = p;
              const structuredFormatting = prediction.structured_formatting || {};
              const shortName = structuredFormatting.main_text || details.name || prediction.description.split(",")[0];
              const fullPlaceName = details.name || structuredFormatting.main_text || prediction.description.split(",")[0];

              let dist: string | undefined;
              if (pickupLat && pickupLng) {
                const d = calculateDistance(pickupLat, pickupLng, details.geometry.location.lat, details.geometry.location.lng);
                dist = formatDistance(d);
              }

              return {
                id: prediction.place_id,
                name: shortName,
                fullName: fullPlaceName,
                address: structuredFormatting.secondary_text || details.formatted_address || prediction.description,
                latitude: details.geometry.location.lat,
                longitude: details.geometry.location.lng,
                distance: dist,
                source: 'google' as const,
              };
            });
        }

        // Google results always appear before other source (local) results
        setSearchResults([...googleResults, ...localMatches]);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(searchTimeout);
  }, [searchPickup, searchDestination, searchActiveField, showEmbeddedSearch, pickupLat, pickupLng]);

  const openEmbeddedSearch = (field: 'pickup' | 'destination', destIndex?: number, addingNew?: boolean) => {
    setSearchActiveField(field);
    setEditingDestinationIndex(destIndex ?? null);
    setIsAddingNewStop(addingNew ?? false);
    setSearchPickup(pickup);
    setSearchDestination(addingNew ? '' : (destIndex !== undefined ? destinations[destIndex]?.address || '' : destination));
    setSearchResults([]);
    setActiveTab('suggested');
    setShowEmbeddedSearch(true);
    Animated.timing(searchSlideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const closeEmbeddedSearch = () => {
    Keyboard.dismiss();
    Animated.timing(searchSlideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setShowEmbeddedSearch(false);
    });
  };

  const handleSearchLocationSelect = (location: LocationResult) => {
    const selectedLocation = {
      address: location.fullName || location.name,
      lat: location.latitude,
      lng: location.longitude,
    };

    if (searchActiveField === 'pickup') {
      onLocationSelect?.('pickup', selectedLocation);
    } else {
      onLocationSelect?.('destination', selectedLocation, isAddingNewStop ? -1 : editingDestinationIndex ?? 0);
    }
    
    closeEmbeddedSearch();
  };

  const searchQuery = searchActiveField === 'pickup' ? searchPickup : searchDestination;
  const showSearchResultsTab = searchQuery.length >= 3;

  const airportAreas = useAirportAreas();
  const buildAirportItem = (area: AirportArea): LocationResult => {
    let dist: string | undefined;
    if (pickupLat && pickupLng) {
      const d = calculateDistance(pickupLat, pickupLng, area.centroid.latitude, area.centroid.longitude);
      dist = formatDistance(d);
    }
    return {
      id: `airport-${area.entry.id}`,
      name: area.name,
      fullName: area.name,
      address: area.code ? `${area.code} · Airport` : "Airport",
      latitude: area.centroid.latitude,
      longitude: area.centroid.longitude,
      distance: dist,
      source: 'local' as const,
    };
  };
  const visibleSearchResults = useMemo<LocationResult[]>(() => applyAirportAreaFilter(
    searchResults,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportItem,
  ), [searchResults, airportAreas, pickupLat, pickupLng]);
  const visibleSuggested = useMemo<LocationResult[]>(() => applyAirportAreaFilter(
    suggestedLocations,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportItem,
  ), [suggestedLocations, airportAreas, pickupLat, pickupLng]);

  useEffect(() => {
    if (!showSearchResultsTab && activeTab === 'results') {
      setActiveTab('suggested');
    } else if (showSearchResultsTab && searchResults.length > 0 && activeTab !== 'results') {
      setActiveTab('results');
    }
  }, [showSearchResultsTab, searchResults.length, activeTab]);

  const handleKeyPress = (key: string) => {
    if (key === "backspace") {
      setFareValue((prev) => prev.slice(0, -1));
    } else if (key === ".") {
      if (!fareValue.includes(".")) {
        setFareValue((prev) => prev + ".");
      }
    } else {
      if (fareValue.length < 6) {
        setFareValue((prev) => (prev === "0" ? key : prev + key));
      }
    }
  };

  const handleDone = () => {
    setIsEditing(false);
  };

  const handleFindDriver = () => {
    onFindDriver?.(currentFare, autoAccept);
    onClose();
  };

  const handleClose = () => {
    setIsEditing(false);
    const finalFare = parseInt(fareValue) || 0;
    if (finalFare >= minFare && finalFare <= maxFare) {
      onFareUpdate?.(finalFare);
    }
    onClose();
  };

  const getValidationMessage = () => {
    if (isBelowMin) {
      return { text: `Minimum fare is ${currency.symbol} ${minFare}`, color: "#EF4444" };
    }
    if (isAboveMax) {
      return { text: `Maximum fare is ${currency.symbol} ${maxFare}`, color: "#EF4444" };
    }
    return { text: `Recommended fare: ${currency.symbol} ${recommendedFare}`, color: "#000" };
  };

  const validation = getValidationMessage();

  if (!visible) return null;

  const menuOverlayOpacity = menuRevealAnim.interpolate({
    inputRange: [0, MENU_WIDTH],
    outputRange: [0, 0.5],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.overlay}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.5],
              }),
            },
          ]}
        />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.combinedContainer,
          {
            transform: [
              { translateX: slideAnim },
              { translateX: menuRevealAnim },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.inlineMenuContainer,
            {
              width: MENU_WIDTH,
              backgroundColor: Colors.secondary,
            },
          ]}
          {...menuPanResponder.panHandlers}
        >
          <MenuSideSheet
            visible
            inline
            onClose={() => {
              handleCloseMenu();
              onClose();
            }}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.menuOverlay,
            {
              opacity: menuOverlayOpacity,
            },
          ]}
          pointerEvents={menuFullyOpen ? 'auto' : 'none'}
          {...panResponder.panHandlers}
        >
          <TouchableWithoutFeedback onPress={handleCloseMenu}>
            <View style={styles.menuOverlayTouchable} />
          </TouchableWithoutFeedback>
        </Animated.View>

        <View
          style={[
            styles.container,
            {
              paddingTop: insets.top,
              paddingBottom: isEditing ? 0 : insets.bottom,
            },
          ]}
          {...panResponder.panHandlers}
        >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleClose}>
            <ArrowLeft color="#000" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Offer your fare</Text>
          <View style={styles.placeholderButton} />
        </View>

        <View style={styles.content}>
          {isEditing && (
            <Text style={styles.instructionText}>You can change the recommended fare</Text>
          )}

          <TouchableOpacity
            style={styles.fareContainer}
            onPress={() => setIsEditing(true)}
            activeOpacity={0.8}
          >
            <View style={styles.fareRow}>
              <Text style={styles.fareCurrency}>{currency.symbol}</Text>
              <Text style={styles.fareAmount}>{fareValue || "0"}</Text>
              {isEditing && <View style={styles.fareCursor} />}
            </View>
            <View style={styles.fareDivider} />
          </TouchableOpacity>

          <Text style={[styles.validationText, { color: validation.color }]}>
            {validation.text}
          </Text>

          <View style={styles.infoRow}>
            <Info color="#6B7280" size={20} style={styles.infoIcon} />
            <Text style={styles.infoText}>
              Fare doesn&apos;t include state entry tax, tolls, or parking fees
            </Text>
          </View>

          <TouchableOpacity style={styles.paymentRow}>
            {paymentMethod === 'cash' ? (
              <View style={[styles.paymentImage, { backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontSize: 20 }}>💵</Text>
              </View>
            ) : (
              <Image
                source={{
                  uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3drcunhhotpoqbujxqkwp",
                }}
                style={styles.paymentImage}
                resizeMode="contain"
              />
            )}
            <Text style={styles.paymentText}>{paymentMethod === 'cash' ? 'Cash' : 'DuItNow manual transfer'}</Text>
            <ChevronRight color="#9CA3AF" size={20} />
          </TouchableOpacity>

          <View style={styles.autoAcceptRow}>
            <Send color="#000" size={20} style={styles.autoAcceptIcon} />
            <View style={styles.autoAcceptTextContainer}>
              <Text style={styles.autoAcceptText}>
                Automatically accept the nearest{"\n"}driver for {currency.symbol} {currentFare || recommendedFare}
              </Text>
            </View>
            <Switch
              value={autoAccept}
              onValueChange={setAutoAccept}
              trackColor={{ false: "#E5E5E5", true: "#4a5a3a" }}
              thumbColor={autoAccept ? "#ff007f" : "#fff"}
            />
          </View>

          <View style={styles.locationSection}>
            <TouchableOpacity 
              style={styles.locationRow}
              onPress={() => openEmbeddedSearch('pickup')}
              activeOpacity={0.7}
            >
              <View style={[styles.locationDot, styles.pickupDot]} />
              <Text style={styles.locationText} numberOfLines={3}>
                {pickup}
              </Text>
              <TouchableOpacity 
                style={styles.entranceBadge}
                onPress={onEntrancePress}
                activeOpacity={0.7}
              >
                <Text style={styles.entranceText}>
                  Entrance{entrance ? ` ${entrance}` : ""}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>

            {destinations.length > 1 ? (
              <TouchableOpacity 
                style={styles.locationRow}
                onPress={onRouteStopsPress}
                activeOpacity={0.7}
              >
                <View style={[styles.locationDot, styles.destDot]} />
                <Text style={styles.locationText} numberOfLines={3}>
                  {destinations.length} route stops
                </Text>
                {destinations.length < 5 && (
                  <TouchableOpacity 
                    style={styles.addButton}
                    onPress={() => openEmbeddedSearch('destination', undefined, true)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Plus color="#000" size={20} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={styles.locationRow}
                onPress={() => openEmbeddedSearch('destination', 0)}
                activeOpacity={0.7}
              >
                <View style={[styles.locationDot, styles.destDot]} />
                <Text style={styles.locationText} numberOfLines={3}>
                  {destinations[0]?.address || destination}
                </Text>
                <TouchableOpacity 
                  style={styles.addButton}
                  onPress={() => openEmbeddedSearch('destination', undefined, true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Plus color="#000" size={20} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isEditing ? (
          <View>
            <View style={styles.doneContainer}>
              <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.keyboardContainer, { paddingBottom: insets.bottom + 10 }]}>
              <View style={styles.keypadRow}>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("1")}
                >
                  <Text style={styles.keypadNumber}>1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("2")}
                >
                  <Text style={styles.keypadNumber}>2</Text>
                  <Text style={styles.keypadLetters}>ABC</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("3")}
                >
                  <Text style={styles.keypadNumber}>3</Text>
                  <Text style={styles.keypadLetters}>DEF</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("4")}
                >
                  <Text style={styles.keypadNumber}>4</Text>
                  <Text style={styles.keypadLetters}>GHI</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("5")}
                >
                  <Text style={styles.keypadNumber}>5</Text>
                  <Text style={styles.keypadLetters}>JKL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("6")}
                >
                  <Text style={styles.keypadNumber}>6</Text>
                  <Text style={styles.keypadLetters}>MNO</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("7")}
                >
                  <Text style={styles.keypadNumber}>7</Text>
                  <Text style={styles.keypadLetters}>PQRS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("8")}
                >
                  <Text style={styles.keypadNumber}>8</Text>
                  <Text style={styles.keypadLetters}>TUV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("9")}
                >
                  <Text style={styles.keypadNumber}>9</Text>
                  <Text style={styles.keypadLetters}>WXYZ</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress(".")}
                >
                  <Text style={styles.keypadNumber}>.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButton}
                  onPress={() => handleKeyPress("0")}
                >
                  <Text style={styles.keypadNumber}>0</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keypadButtonBackspace}
                  onPress={() => handleKeyPress("backspace")}
                >
                  <Delete color="#000" size={26} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.bottomContainer}>
            <View style={styles.bottomBar}>
              <TouchableOpacity
                style={isValidFare ? styles.findDriverButton : styles.findDriverButtonDisabled}
                onPress={handleFindDriver}
                disabled={!isValidFare}
              >
                <Text style={isValidFare ? styles.findDriverText : styles.findDriverTextDisabled}>
                  Find a driver
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.settingsButton}>
                <SlidersHorizontal color="#000" size={22} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        </View>
      </Animated.View>

      {/* Embedded Search Overlay */}
      {showEmbeddedSearch && (
        <Animated.View
          style={[
            styles.embeddedSearchContainer,
            {
              transform: [{ translateY: searchSlideAnim }],
            },
          ]}
        >
          <View style={[styles.embeddedSearchHeader, { paddingTop: insets.top }]}>
            <Text style={styles.embeddedSearchTitle}>Enter your route</Text>
            <TouchableOpacity
              style={styles.embeddedSearchClose}
              onPress={closeEmbeddedSearch}
            >
              <X color="#999" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.embeddedSearchInputs}>
            {!isAddingNewStop && (
              <TouchableOpacity
                style={[
                  styles.embeddedSearchInputCard,
                  searchActiveField === 'pickup' && styles.embeddedSearchInputCardActive,
                ]}
                onPress={() => setSearchActiveField('pickup')}
                activeOpacity={1}
              >
                <View style={styles.embeddedSearchFromIcon}>
                  <View style={styles.embeddedSearchFromDot} />
                </View>
                <View style={styles.embeddedSearchInputContent}>
                  <Text style={styles.embeddedSearchInputLabel}>From</Text>
                  {searchActiveField === 'pickup' ? (
                    <TextInput
                      style={styles.embeddedSearchInputText}
                      placeholder="Enter pickup location"
                      placeholderTextColor="#888"
                      value={searchPickup}
                      onChangeText={setSearchPickup}
                      autoFocus
                    />
                  ) : (
                    <Text style={styles.embeddedSearchInputValue} numberOfLines={1}>
                      {searchPickup || "Enter pickup location"}
                    </Text>
                  )}
                </View>
                {searchPickup.length > 0 && searchActiveField === 'pickup' && (
                  <TouchableOpacity
                    style={styles.embeddedSearchClearButton}
                    onPress={() => setSearchPickup('')}
                  >
                    <View style={styles.embeddedSearchClearInner}>
                      <X color="#888" size={14} />
                    </View>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.embeddedSearchInputCard,
                searchActiveField === 'destination' && styles.embeddedSearchInputCardActive,
              ]}
              onPress={() => setSearchActiveField('destination')}
              activeOpacity={1}
            >
              <View style={styles.embeddedSearchSearchIcon}>
                <Search color="#888" size={20} />
              </View>
              <View style={styles.embeddedSearchInputContent}>
                <Text style={styles.embeddedSearchInputLabel}>To</Text>
                {searchActiveField === 'destination' ? (
                  <TextInput
                    style={styles.embeddedSearchInputText}
                    placeholder="Enter destination"
                    placeholderTextColor="#888"
                    value={searchDestination}
                    onChangeText={setSearchDestination}
                    autoFocus={isAddingNewStop}
                  />
                ) : (
                  <Text style={styles.embeddedSearchInputValue} numberOfLines={1}>
                    {searchDestination || "Enter destination"}
                  </Text>
                )}
              </View>
              {searchDestination.length > 0 && searchActiveField === 'destination' && (
                <TouchableOpacity
                  style={styles.embeddedSearchClearButton}
                  onPress={() => setSearchDestination('')}
                >
                  <View style={styles.embeddedSearchClearInner}>
                    <X color="#888" size={14} />
                  </View>
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <View style={styles.embeddedSearchTabs}>
              {showSearchResultsTab && (
                <TouchableOpacity
                  style={[styles.embeddedSearchTab, activeTab === 'results' && styles.embeddedSearchTabActive]}
                  onPress={() => setActiveTab('results')}
                >
                  <Text style={[styles.embeddedSearchTabText, activeTab === 'results' && styles.embeddedSearchTabTextActive]}>Search Results</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.embeddedSearchTab, activeTab === 'suggested' && styles.embeddedSearchTabActive]}
                onPress={() => setActiveTab('suggested')}
              >
                <Text style={[styles.embeddedSearchTabText, activeTab === 'suggested' && styles.embeddedSearchTabTextActive]}>Suggested</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.embeddedSearchTab, activeTab === 'saved' && styles.embeddedSearchTabActive]}
                onPress={() => setActiveTab('saved')}
              >
                <Text style={[styles.embeddedSearchTabText, activeTab === 'saved' && styles.embeddedSearchTabTextActive]}>Saved</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.embeddedSearchResults}>
            {isSearching && (
              <View style={styles.embeddedSearchLoading}>
                <ActivityIndicator color="#ff007f" size="small" />
                <Text style={styles.embeddedSearchLoadingText}>Searching...</Text>
              </View>
            )}

            <FlatList
              data={activeTab === 'saved' ? [] : (activeTab === 'suggested' ? visibleSuggested : visibleSearchResults)}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.embeddedSearchListContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={() => Keyboard.dismiss()}
              ListEmptyComponent={
                <View style={styles.embeddedSearchEmpty}>
                  <MapPin color="#666" size={48} />
                  <Text style={styles.embeddedSearchEmptyText}>
                    {activeTab === 'saved' ? 'No saved locations' : 'No locations found'}
                  </Text>
                  <Text style={styles.embeddedSearchEmptySubtext}>
                    {activeTab === 'saved' ? 'Save your frequent destinations' : 'Try a different search term'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <EmbeddedSearchRow item={item} onSelect={handleSearchLocationSelect} usage={searchActiveField === 'pickup' ? 'pickup' : 'drop'} />
              )}
            />
          </View>
        </Animated.View>
      )}
      <PartnerModeSelectModal
        visible={driverModeVisible}
        onClose={() => setDriverModeVisible(false)}
        onSelect={(mode) => console.log("Partner mode selected:", mode)}
      />
    </View>
  );
}

function EmbeddedSearchRow({ item, onSelect, usage }: { item: LocationResult; onSelect: (loc: LocationResult) => void; usage: 'pickup' | 'drop' }) {
  const matched = useGatesForCoordinates(item.latitude, item.longitude, usage, item.fullName || item.name);
  const blockPlaceTap = !!matched && matched.gateRequired && matched.gates.length > 0;
  return (
    <TouchableOpacity
      style={styles.embeddedSearchItem}
      activeOpacity={blockPlaceTap ? 1 : 0.6}
      onPress={() => {
        if (blockPlaceTap) return;
        onSelect(item);
      }}
    >
      <View style={styles.embeddedSearchItemIcon}>
        <MapPin color={item.source === 'google' ? "#4285F4" : "#888"} size={18} />
      </View>
      <View style={styles.embeddedSearchItemText}>
        <Text style={styles.embeddedSearchItemName}>{item.name}</Text>
        <Text style={styles.embeddedSearchItemAddress} numberOfLines={2}>{item.address}</Text>
        <PlaceGatesList
          lat={item.latitude}
          lon={item.longitude}
          variant="dark"
          usage={usage}
          name={item.fullName || item.name}
          onSelectGate={(g, m) => {
            const gLat = parseFloat(g.lat);
            const gLon = parseFloat(g.lon);
            const baseName = String(m.place.values.name ?? item.name);
            onSelect({
              ...item,
              name: `${baseName} - ${g.name}`,
              fullName: `${baseName} - ${g.name}`,
              latitude: Number.isFinite(gLat) ? gLat : item.latitude,
              longitude: Number.isFinite(gLon) ? gLon : item.longitude,
            });
          }}
        />
      </View>
      <View style={styles.embeddedSearchItemRight}>
        {item.distance && (
          <Text style={styles.embeddedSearchItemDistance}>{item.distance}</Text>
        )}
        <TouchableOpacity style={styles.embeddedSearchBookmark}>
          <Bookmark color="#666" size={20} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  combinedContainer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH + MENU_WIDTH,
    flexDirection: "row",
    marginLeft: -MENU_WIDTH,
  },
  inlineMenuContainer: {
    height: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
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
  menuOverlay: {
    position: "absolute",
    top: 0,
    left: MENU_WIDTH,
    width: SCREEN_WIDTH,
    bottom: 0,
    backgroundColor: "#000",
    zIndex: 10,
  },
  menuOverlayTouchable: {
    flex: 1,
  },
  container: {
    width: SCREEN_WIDTH,
    height: "100%",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderButton: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  instructionText: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 8,
  },
  fareContainer: {
    marginBottom: 8,
  },
  fareRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  fareCurrency: {
    fontSize: 48,
    fontWeight: "300",
    color: "#EF4444",
    marginRight: 4,
  },
  fareAmount: {
    fontSize: 48,
    fontWeight: "300",
    color: "#000",
  },
  fareCursor: {
    width: 2,
    height: 50,
    backgroundColor: "#000",
    marginLeft: 2,
    marginBottom: 6,
  },
  fareDivider: {
    height: 1,
    backgroundColor: "#E5E5E5",
    marginTop: 12,
  },
  validationText: {
    fontSize: 15,
    marginTop: 12,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F9FAFB",
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  paymentImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 14,
  },
  paymentText: {
    flex: 1,
    fontSize: 15,
    color: "#000",
  },
  autoAcceptRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  autoAcceptIcon: {
    marginRight: 14,
  },
  autoAcceptTextContainer: {
    flex: 1,
  },
  autoAcceptText: {
    fontSize: 15,
    color: "#000",
    lineHeight: 20,
  },
  locationSection: {
    marginTop: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
  },
  locationDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    marginRight: 14,
    marginTop: 3,
  },
  pickupDot: {
    borderColor: "#22C55E",
    backgroundColor: "#fff",
  },
  destDot: {
    borderColor: "#EF4444",
    backgroundColor: "#fff",
  },
  stopDot: {
    borderColor: "#3B82F6",
    backgroundColor: "#fff",
  },
  locationText: {
    flex: 1,
    fontSize: 15,
    color: "#000",
  },
  entranceBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  entranceText: {
    fontSize: 13,
    color: "#000",
    fontWeight: "500",
  },
  addButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  removeButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#fff",
  },
  doneContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#fff",
  },
  doneButton: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  doneButtonText: {
    fontSize: 16,
    color: "#3B82F6",
    fontWeight: "500",
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  findDriverButton: {
    flex: 1,
    backgroundColor: "#ff007f",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  findDriverButtonDisabled: {
    flex: 1,
    backgroundColor: "#E5E5E5",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  findDriverText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
  },
  findDriverTextDisabled: {
    fontSize: 16,
    fontWeight: "700",
    color: "#9CA3AF",
  },
  settingsButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#ff007f",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 12,
  },
  keyboardContainer: {
    backgroundColor: "#d1d5db",
    paddingHorizontal: 6,
    paddingTop: 10,
  },
  keypadRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 8,
  },
  keypadButton: {
    width: (SCREEN_WIDTH - 36) / 3,
    height: 52,
    backgroundColor: "#fff",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 3,
  },
  keypadButtonBackspace: {
    width: (SCREEN_WIDTH - 36) / 3,
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 3,
  },
  keypadNumber: {
    fontSize: 28,
    fontWeight: "400",
    color: "#000",
  },
  keypadLetters: {
    fontSize: 10,
    fontWeight: "600",
    color: "#000",
    letterSpacing: 2,
    marginTop: -2,
  },
  embeddedSearchContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#1a1a1a",
    zIndex: 2000,
  },
  embeddedSearchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    position: "relative" as const,
  },
  embeddedSearchTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  embeddedSearchClose: {
    position: "absolute" as const,
    right: 20,
    bottom: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  embeddedSearchInputs: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  embeddedSearchInputCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3a3a3a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  embeddedSearchInputCardActive: {
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  embeddedSearchFromIcon: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  embeddedSearchFromDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#ce2883",
    borderWidth: 2,
    borderColor: "#ce2883",
  },
  embeddedSearchSearchIcon: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  embeddedSearchInputContent: {
    flex: 1,
  },
  embeddedSearchInputLabel: {
    fontSize: 12,
    color: "#888",
    marginBottom: 2,
  },
  embeddedSearchInputText: {
    fontSize: 15,
    color: "#fff",
    padding: 0,
  },
  embeddedSearchInputValue: {
    fontSize: 15,
    color: "#fff",
  },
  embeddedSearchClearButton: {
    marginLeft: 8,
  },
  embeddedSearchClearInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#555",
    justifyContent: "center",
    alignItems: "center",
  },
  embeddedSearchTabs: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
    flexWrap: "wrap",
  },
  embeddedSearchTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#3a3a3a",
  },
  embeddedSearchTabActive: {
    backgroundColor: "#fff",
  },
  embeddedSearchTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#999",
  },
  embeddedSearchTabTextActive: {
    color: "#000",
  },
  embeddedSearchResults: {
    flex: 1,
    paddingTop: 20,
  },
  embeddedSearchLoading: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  embeddedSearchLoadingText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#888",
  },
  embeddedSearchListContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  embeddedSearchEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  embeddedSearchEmptyText: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center" as const,
    color: "#fff",
  },
  embeddedSearchEmptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center" as const,
    color: "#888",
  },
  embeddedSearchItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  embeddedSearchItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    backgroundColor: "#3a3a3a",
    marginTop: 2,
  },
  embeddedSearchItemText: {
    flex: 1,
    marginRight: 12,
  },
  embeddedSearchItemName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
    color: "#fff",
  },
  embeddedSearchItemAddress: {
    fontSize: 13,
    color: "#888",
    lineHeight: 18,
  },
  embeddedSearchItemRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  embeddedSearchItemDistance: {
    fontSize: 13,
    fontWeight: "500",
    color: "#888",
  },
  embeddedSearchBookmark: {
    padding: 4,
  },
});
