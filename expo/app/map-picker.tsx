import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Navigation } from "lucide-react-native";
import MapView, { Region } from "react-native-maps";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { reverseGeocode as reverseGeocodeUtil } from "@/utils/maps";

export default function MapPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { location: currentLocation } = useLocation();
  const colors = useColors();
  const isLightMode = colors.background === '#FFFFFF';

  const activeField = (params.activeField as string) || "pickup";
  const initialLat = params.initialLat ? parseFloat(params.initialLat as string) : null;
  const initialLng = params.initialLng ? parseFloat(params.initialLng as string) : null;
  
  // Preserve previous state
  const currentPickup = (params.currentPickup as string) || "";
  const currentDestination = (params.currentDestination as string) || "";
  const currentPickupLat = (params.currentPickupLat as string) || "";
  const currentPickupLng = (params.currentPickupLng as string) || "";
  const currentLocationLat = (params.currentLocationLat as string) || "";
  const currentLocationLng = (params.currentLocationLng as string) || "";

  // Use initialLat/initialLng if provided, otherwise use current location from context
  const getInitialLatitude = () => {
    if (initialLat) return initialLat;
    if (currentLocation?.coords?.latitude) return currentLocation.coords.latitude;
    return 3.139;
  };

  const getInitialLongitude = () => {
    if (initialLng) return initialLng;
    if (currentLocation?.coords?.longitude) return currentLocation.coords.longitude;
    return 101.6869;
  };

  const [region, setRegion] = useState<Region>({
    latitude: getInitialLatitude(),
    longitude: getInitialLongitude(),
    latitudeDelta: 0.025,
    longitudeDelta: 0.025,
  });
  const hasInitializedFromContext = useRef(false);
  const [locationName, setLocationName] = useState<string>("Loading...");
  const [isLoading, setIsLoading] = useState(false);
  const isMapMoving = useRef(false);
  const isMapReady = useRef(false);
  const initialLoadComplete = useRef(false);

  // Pin animations
  const pinDropAnim = useRef(new Animated.Value(0)).current;
  const pinInnerScaleAnim = useRef(new Animated.Value(1)).current;
  const pinShadowOpacity = useRef(new Animated.Value(0)).current;
  const addressBarOpacity = useRef(new Animated.Value(1)).current;
  const loadingSpinnerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
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
  }, [isLoading, loadingSpinnerAnim]);

  // Immediately center on current location when map launches without initial coordinates
  useEffect(() => {
    if (!initialLat && !initialLng && currentLocation?.coords && !hasInitializedFromContext.current) {
      hasInitializedFromContext.current = true;
      const newRegion = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      };
      setRegion(newRegion);
      // Immediate centering without animation delay
      mapRef.current?.setCamera({
        center: {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        },
        zoom: 15,
      });
      reverseGeocode(currentLocation.coords.latitude, currentLocation.coords.longitude);
    }
  }, [currentLocation, initialLat, initialLng]);

  // Timeout fallback: if still showing "Loading..." after 3 seconds, use current region
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (locationName === "Loading...") {
        console.log("Timeout reached, using current region for address");
        reverseGeocode(region.latitude, region.longitude);
      }
    }, 3000);

    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const initializeLocation = async () => {
      // If we have initial coordinates from params, use those
      if (initialLat && initialLng) {
        reverseGeocode(initialLat, initialLng);
        return;
      }

      // If we already have current location from context, use it
      if (currentLocation?.coords) {
        reverseGeocode(currentLocation.coords.latitude, currentLocation.coords.longitude);
        return;
      }

      // Fallback: try to get location directly
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const newRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025,
          };
          setRegion(newRegion);
          reverseGeocode(location.coords.latitude, location.coords.longitude);
          return;
        }
      } catch (error) {
        console.log("Error getting location:", error);
      }

      // Ultimate fallback: use default coordinates so page doesn't hang
      console.log("Using default coordinates as fallback");
      reverseGeocode(region.latitude, region.longitude);
    };

    initializeLocation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLat, initialLng]);

  const reverseGeocode = async (latitude: number, longitude: number) => {
    setIsLoading(true);
    try {
      const result = await reverseGeocodeUtil(latitude, longitude, "map-picker");
      if (result) {
        setLocationName(result.name);
        console.log("Reverse geocoded location:", result.name);
      } else {
        setLocationName("Selected Location");
      }
    } catch (error) {
      console.log("Error reverse geocoding:", error);
      setLocationName("Selected Location");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegionChange = () => {
    // Skip region change events until map is ready and initial load is complete
    if (!isMapReady.current || !initialLoadComplete.current) {
      return;
    }
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

  const handleDone = () => {
    router.replace({
      pathname: "/search",
      params: {
        selectedField: activeField,
        selectedName: locationName,
        selectedLat: region.latitude.toString(),
        selectedLng: region.longitude.toString(),
        prevPickup: currentPickup,
        prevDestination: currentDestination,
        prevPickupLat: currentPickupLat,
        prevPickupLng: currentPickupLng,
        prevCurrentLat: currentLocationLat,
        prevCurrentLng: currentLocationLng,
      },
    });
  };

  const handleCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const location = await Location.getCurrentPositionAsync({});
        const newRegion = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        };
        mapRef.current?.animateToRegion(newRegion, 500);
        setRegion(newRegion);
        reverseGeocode(location.coords.latitude, location.coords.longitude);
      }
    } catch (error) {
      console.log("Error getting current location:", error);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        onMapReady={() => {
          isMapReady.current = true;
          // Delay enabling region change handling to skip initial positioning events
          setTimeout(() => {
            initialLoadComplete.current = true;
          }, 500);
        }}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={darkMapStyle}
      />

      <View style={[styles.backButton, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={[styles.backButtonInner, { backgroundColor: isLightMode ? '#fff' : 'rgba(0, 0, 0, 0.6)' }]}
          onPress={() => router.back()}
        >
          <ArrowLeft color={isLightMode ? '#000' : '#fff'} size={24} />
        </TouchableOpacity>
      </View>

      <View style={styles.pinContainer}>
        <Animated.View style={[styles.pinLabelContainer, { opacity: addressBarOpacity }]}>
          {isLoading ? (
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
                <View style={styles.loadingSpinnerTrack} />
                <View style={styles.loadingSpinnerHead} />
              </View>
            </Animated.View>
          ) : (
            <Text style={styles.pinLabel}>
              {locationName}
            </Text>
          )}
        </Animated.View>
        <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinDropAnim }] }]}>
          <View style={styles.pinOuter}>
            <Animated.View style={[styles.pinInner, { transform: [{ scale: pinInnerScaleAnim }], backgroundColor: isLightMode ? '#fff' : '#1a1a1a' }]} />
          </View>
          <View style={styles.pinPointer} />
        </Animated.View>
        <Animated.View style={[styles.pinShadowDot, { opacity: pinShadowOpacity }]} />
      </View>

      <TouchableOpacity
        style={[styles.currentLocationButton, { bottom: insets.bottom + 100, backgroundColor: isLightMode ? '#fff' : 'rgba(0, 0, 0, 0.6)' }]}
        onPress={handleCurrentLocation}
      >
        <Navigation color={isLightMode ? '#000' : '#fff'} size={22} />
      </TouchableOpacity>

      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  map: {
    flex: 1,
  },
  backButton: {
    position: "absolute" as const,
    left: 16,
    zIndex: 10,
  },
  backButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinContainer: {
    position: "absolute" as const,
    top: "50%",
    left: 0,
    right: 0,
    transform: [{ translateY: -100 }],
    alignItems: "center",
    zIndex: 5,
  },
  pinLabelContainer: {
    backgroundColor: "#5BA3E0",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
    maxWidth: "80%",
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  pinLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center" as const,
  },
  pinWrapper: {
    alignItems: "center",
  },
  pinOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#7ABAED",
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
    backgroundColor: "#1a1a1a",
  },
  pinPointer: {
    width: 3,
    height: 18,
    backgroundColor: "#7ABAED",
    marginTop: -2,
  },
  pinShadowDot: {
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: "rgba(122, 186, 237, 0.6)",
    marginTop: 3,
  },
  loadingSpinnerContainer: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingSpinner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    position: "relative" as const,
  },
  loadingSpinnerTrack: {
    position: "absolute" as const,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  loadingSpinnerHead: {
    position: "absolute" as const,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: "transparent",
    borderTopColor: "#fff",
    borderRightColor: "rgba(255, 255, 255, 0.5)",
  },
  currentLocationButton: {
    position: "absolute" as const,
    right: 16,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  bottomContainer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  doneButton: {
    backgroundColor: "#ce2883",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
  },
});
