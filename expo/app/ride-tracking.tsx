import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Phone, MessageCircle, Star, X, Navigation, MapPin } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "@/contexts/LocationContext";
import { MapView, Marker, Polyline } from "@/utils/maps";

const { width, height } = Dimensions.get("window");

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

export default function RideTrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const [rideStatus, setRideStatus] = useState<
    "searching" | "found" | "arriving" | "in-progress"
  >("searching");
  const pulseAnim = useState(new Animated.Value(1))[0];
  const slideAnim = useState(new Animated.Value(400))[0];

  const pickup = (params.pickup as string) || "Current Location";
  const destination = (params.destination as string) || "Destination";
  const pickupLat = params.pickupLat ? parseFloat(params.pickupLat as string) : 37.7749;
  const pickupLng = params.pickupLng ? parseFloat(params.pickupLng as string) : -122.4194;
  const destLat = params.destLat ? parseFloat(params.destLat as string) : 37.7849;
  const destLng = params.destLng ? parseFloat(params.destLng as string) : -122.4094;
  const { currency } = useLocation();
  const price = (params.price as string) || `${currency.symbol} 12.50`;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    const statusTimer = setTimeout(() => {
      setRideStatus("found");
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();

      setTimeout(() => {
        setRideStatus("arriving");
      }, 2000);
    }, 3000);

    return () => clearTimeout(statusTimer);
  }, []);

  const pickupLocation = {
    latitude: pickupLat,
    longitude: pickupLng,
  };

  const destinationLocation = {
    latitude: destLat,
    longitude: destLng,
  };

  const driverLocation = {
    latitude: pickupLat - 0.005,
    longitude: pickupLng - 0.005,
  };

  const routeCoordinates = [driverLocation, pickupLocation];

  const centerLat = (pickupLat + destLat) / 2;
  const centerLng = (pickupLng + destLng) / 2;
  const latDelta = Math.abs(pickupLat - destLat) * 1.5 || 0.05;
  const lngDelta = Math.abs(pickupLng - destLng) * 1.5 || 0.05;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {Platform.OS !== "web" && MapView ? (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: centerLat,
            longitude: centerLng,
            latitudeDelta: latDelta,
            longitudeDelta: lngDelta,
          }}
          showsUserLocation
          customMapStyle={colorScheme === "dark" ? darkMapStyle : lightMapStyle}
        >
          {Marker && (
            <>
              <Marker coordinate={pickupLocation}>
                <View style={[styles.pickupMarker, { backgroundColor: Colors.accent, borderColor: Colors.secondary }]}>
                  <View style={[styles.pickupMarkerInner, { backgroundColor: Colors.secondary }]} />
                </View>
              </Marker>

              <Marker coordinate={destinationLocation}>
                <View style={styles.destinationMarkerContainer}>
                  <View style={[styles.destinationMarker, { backgroundColor: Colors.text }]}>
                    <MapPin color={Colors.secondary} size={20} />
                  </View>
                </View>
              </Marker>
            </>
          )}

          {rideStatus !== "searching" && Marker && Polyline && (
            <>
              <Marker coordinate={driverLocation}>
                <View style={[styles.driverMarker, { backgroundColor: Colors.secondary }]}>
                  <Text style={styles.driverMarkerText}>🚗</Text>
                </View>
              </Marker>

              <Polyline
                coordinates={routeCoordinates}
                strokeColor={Colors.accent}
                strokeWidth={3}
              />
            </>
          )}
        </MapView>
      ) : (
        <View style={[styles.map, styles.webMapPlaceholder, { backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#e8e8e8" }]}>
          <View style={styles.webMapContent}>
            <MapPin color={Colors.accent} size={48} />
            <Text style={[styles.webMapText, { color: Colors.text }]}>Map view</Text>
            <Text style={[styles.webMapSubtext, { color: Colors.textSecondary }]}>Available on mobile</Text>
          </View>
        </View>
      )}

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: Colors.secondary }]}
            onPress={() => router.push("/")}
          >
            <X color={Colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {rideStatus === "searching" && (
        <View style={styles.searchingOverlay}>
          <Animated.View
            style={[
              styles.searchingCircle,
              {
                backgroundColor: Colors.accent,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <View style={[styles.searchingContent, { backgroundColor: Colors.secondary }]}>
            <Text style={[styles.searchingText, { color: Colors.text }]}>Finding your ride...</Text>
            <Text style={[styles.searchingSubtext, { color: Colors.textSecondary }]}>
              This usually takes less than a minute
            </Text>
          </View>
        </View>
      )}

      {rideStatus !== "searching" && (
        <Animated.View
          style={[
            styles.driverCard,
            {
              backgroundColor: Colors.secondary,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: Colors.gray[300] }]} />

          <View style={styles.driverHeader}>
            <View style={styles.driverInfo}>
              <View style={[styles.driverAvatar, { backgroundColor: Colors.accent }]}>
                <Text style={[styles.driverAvatarText, { color: Colors.secondary }]}>JD</Text>
              </View>
              <View style={styles.driverDetails}>
                <Text style={[styles.driverName, { color: Colors.text }]}>John Doe</Text>
                <View style={styles.driverRating}>
                  <Star
                    color={Colors.warning}
                    size={16}
                    fill={Colors.warning}
                  />
                  <Text style={[styles.driverRatingText, { color: Colors.text }]}>4.9</Text>
                  <Text style={[styles.driverRatingCount, { color: Colors.textSecondary }]}>(234 trips)</Text>
                </View>
                <Text style={[styles.driverVehicle, { color: Colors.textSecondary }]}>
                  Toyota Camry • ABC 1234
                </Text>
              </View>
            </View>
            <View style={styles.driverActions}>
              <TouchableOpacity style={[styles.actionButton, { backgroundColor: Colors.gray[100] }]}>
                <Phone color={Colors.text} size={20} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, { backgroundColor: Colors.gray[100] }]}>
                <MessageCircle color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.rideStatus, { backgroundColor: Colors.gray[50] }]}>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: Colors.gray[400] },
                  rideStatus === "arriving" && [styles.statusDotActive, { backgroundColor: Colors.accent }],
                ]}
              />
              <Text style={[styles.statusText, { color: Colors.text }]}>
                {rideStatus === "found"
                  ? "Driver accepted your ride"
                  : rideStatus === "arriving"
                    ? "Driver is arriving in 2 minutes"
                    : "On the way"}
              </Text>
            </View>
            <TouchableOpacity style={[styles.navigationButton, { backgroundColor: Colors.accent + "20" }]}>
              <Navigation color={Colors.accent} size={20} />
              <Text style={[styles.navigationButtonText, { color: Colors.accent }]}>Navigate</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tripInfo}>
            <View style={styles.tripInfoRow}>
              <Text style={[styles.tripInfoLabel, { color: Colors.textSecondary }]}>Pickup</Text>
              <Text style={[styles.tripInfoValue, { color: Colors.text }]} numberOfLines={1}>{pickup}</Text>
            </View>
            <View style={styles.tripInfoRow}>
              <Text style={[styles.tripInfoLabel, { color: Colors.textSecondary }]}>Dropoff</Text>
              <Text style={[styles.tripInfoValue, { color: Colors.text }]} numberOfLines={1}>{destination}</Text>
            </View>
            <View style={styles.tripInfoRow}>
              <Text style={[styles.tripInfoLabel, { color: Colors.textSecondary }]}>Price</Text>
              <Text style={[styles.tripInfoValue, { color: Colors.text }]}>{price}</Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width,
    height,
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
  closeButton: {
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
  pickupMarker: {
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
  pickupMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute" as const,
    top: 3,
    left: 3,
  },
  destinationMarkerContainer: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  destinationMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  driverMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  driverMarkerText: {
    fontSize: 24,
  },
  searchingOverlay: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  searchingCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    opacity: 0.2,
    position: "absolute",
  },
  searchingContent: {
    alignItems: "center",
    padding: 24,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  searchingText: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  searchingSubtext: {
    fontSize: 14,
  },
  driverCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  driverHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  driverInfo: {
    flexDirection: "row",
    flex: 1,
  },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  driverAvatarText: {
    fontSize: 20,
    fontWeight: "700",
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  driverRating: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  driverRatingText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  driverRatingCount: {
    fontSize: 14,
    marginLeft: 4,
  },
  driverVehicle: {
    fontSize: 14,
  },
  driverActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  rideStatus: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusDotActive: {},
  statusText: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  navigationButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  navigationButtonText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  tripInfo: {
    gap: 12,
  },
  tripInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tripInfoLabel: {
    fontSize: 14,
  },
  tripInfoValue: {
    fontSize: 14,
    fontWeight: "600" as const,
    flex: 1,
    textAlign: "right" as const,
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
});
