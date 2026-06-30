import React, { useState, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MapPin, X, Search, Navigation, Bookmark } from "lucide-react-native";
import * as Location from "expo-location";
import { useColors } from "@/hooks/useColors";
import { POPULAR_LOCATIONS } from "@/constants/mockLocations";
import { runWithMappingRotation } from "@/utils/mappingClient";
import { PlaceGatesList, useGatesForCoordinates } from "@/components/PlaceGates";
import { useAirportAreas, applyAirportAreaFilter } from "@/utils/airportAreas";
import { setPendingLocationReturn } from "@/utils/locationReturn";

type LocationResult = {
  id: string;
  name: string;
  fullName: string;
  address: string;
  latitude: number;
  longitude: number;
};

type LocationWithDistance = LocationResult & {
  distance?: string;
};

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

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const Colors = useColors();
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [activeInput, setActiveInput] = useState<"pickup" | "destination">(
    "destination"
  );
  const [activeTab, setActiveTab] = useState<"results" | "suggested" | "saved">("suggested");
  const [loadingAddress, setLoadingAddress] = useState<boolean>(false);
  const [filteredLocations, setFilteredLocations] = useState<LocationWithDistance[]>(POPULAR_LOCATIONS);
  const [pickupCoords, setPickupCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [suggestedLocations, setSuggestedLocations] = useState<LocationWithDistance[]>([]);
  const [hasUserMadeSelection, setHasUserMadeSelection] = useState<boolean>(false);
  const [isFromRideConfirm, setIsFromRideConfirm] = useState<boolean>(false);
  const [isAddingNewDestination, setIsAddingNewDestination] = useState<boolean>(false);
  const [existingDestinations, setExistingDestinations] = useState<Array<{
    address: string;
    lat: number;
    lng: number;
  }>>([]);
  const [isFromOfferFare, setIsFromOfferFare] = useState<boolean>(false);
  const [originalParams, setOriginalParams] = useState<any>({});

  useEffect(() => {
    if (!currentLocation) {
      setSuggestedLocations([]);
      return;
    }

    const MAX_DISTANCE_KM = 30;
    const locationsWithDistance = POPULAR_LOCATIONS.map((loc) => {
      const distance = calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        loc.latitude,
        loc.longitude
      );
      return {
        ...loc,
        distance: formatDistance(distance),
        distanceValue: distance,
      };
    })
      .filter((loc) => loc.distanceValue <= MAX_DISTANCE_KM)
      .sort((a, b) => a.distanceValue - b.distanceValue);

    setSuggestedLocations(locationsWithDistance);
  }, [currentLocation]);

  useEffect(() => {
    const searchQuery = activeInput === "pickup" ? pickup : destination;
    
    if (!searchQuery.trim()) {
      setFilteredLocations(suggestedLocations);
      setIsSearching(false);
      return;
    }

    if (searchQuery.trim().length < 3) {
      setFilteredLocations([]);
      setIsSearching(false);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        console.log("Searching for locations:", searchQuery);
        
        const FALLBACK_KEY = "AIzaSyBj89Dt9v6SiDMvA3XUsoRm6ey6L-nKMfI";
        const buildAutoUrl = (key: string) =>
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            searchQuery
          )}&components=country:my&key=${key}`;
        let activeKey = FALLBACK_KEY;
        console.log("Fetching from Google Places API");
        const data = await runWithMappingRotation<any>(
          "rider-home",
          "autocomplete",
          async (ctx) => {
            const k = ctx.key || FALLBACK_KEY;
            activeKey = k;
            const r = await fetch(buildAutoUrl(k), { method: "GET", headers: { 'Accept': 'application/json' } });
            if (!r.ok) return { ok: false, value: { status: "HTTP_ERROR" } };
            const j = await r.json();
            return { ok: j?.status === "OK", value: j };
          },
          async () => {
            const r = await fetch(buildAutoUrl(FALLBACK_KEY), { method: "GET", headers: { 'Accept': 'application/json' } });
            return r.json();
          }
        );
        const GOOGLE_API_KEY = activeKey;
        console.log("Google Places response status:", data.status);

        if (data.status === "OK" && data.predictions && data.predictions.length > 0) {
          console.log("Found", data.predictions.length, "results");
          
          const placeDetailsPromises = data.predictions.slice(0, 5).map(async (prediction: any) => {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=geometry,name,formatted_address&key=${GOOGLE_API_KEY}`;
            const detailsResponse = await fetch(detailsUrl);
            const detailsData = await detailsResponse.json();
            return { prediction, details: detailsData.result };
          });
          
          const placesWithDetails = await Promise.all(placeDetailsPromises);
          
          const locationResults: LocationResult[] = placesWithDetails
            .filter((p) => p.details && p.details.geometry)
            .map((p) => {
              const { prediction, details } = p;
              const structuredFormatting = prediction.structured_formatting || {};
              const shortName = structuredFormatting.main_text || details.name || prediction.description.split(",")[0];
              const fullPlaceName = details.name || structuredFormatting.main_text || prediction.description.split(",")[0];
              
              return {
                id: prediction.place_id,
                name: shortName,
                fullName: fullPlaceName,
                address: structuredFormatting.secondary_text || details.formatted_address || prediction.description,
                latitude: details.geometry.location.lat,
                longitude: details.geometry.location.lng,
              };
            });

          console.log("Processed", locationResults.length, "results from Google Places");
          
          const locationsWithDistance = locationResults.map((loc) => {
            let refCoords = null;
            
            if (activeInput === "pickup") {
              refCoords = currentLocation;
            } else if (activeInput === "destination") {
              refCoords = pickupCoords || currentLocation;
            }
            
            if (refCoords) {
              const distance = calculateDistance(
                refCoords.latitude,
                refCoords.longitude,
                loc.latitude,
                loc.longitude
              );
              return {
                ...loc,
                distance: formatDistance(distance),
              };
            }
            
            return loc;
          });
          
          setFilteredLocations(locationsWithDistance);
        } else if (data.status === "ZERO_RESULTS") {
          console.log("No results from Google Places");
          setFilteredLocations([]);
        } else {
          console.warn("Google Places API error:", data.status, data.error_message);
          throw new Error(data.error_message || data.status);
        }
      } catch (error: any) {
        console.warn("Error searching locations:", error);
        console.warn("Error details:", error.message);
        
        console.log("Falling back to mock data search");
        const filtered = POPULAR_LOCATIONS.filter(
          (loc) =>
            loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            loc.address.toLowerCase().includes(searchQuery.toLowerCase())
        );
        
        const locationsWithDistance = filtered.map((loc) => {
          let refCoords = null;
          
          if (activeInput === "pickup") {
            refCoords = currentLocation;
          } else if (activeInput === "destination") {
            refCoords = pickupCoords || currentLocation;
          }
          
          if (refCoords) {
            const distance = calculateDistance(
              refCoords.latitude,
              refCoords.longitude,
              loc.latitude,
              loc.longitude
            );
            return {
              ...loc,
              distance: formatDistance(distance),
            };
          }
          
          return loc;
        });
        
        setFilteredLocations(locationsWithDistance);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(searchTimeout);
  }, [pickup, destination, activeInput, pickupCoords, currentLocation, suggestedLocations]);

  useEffect(() => {
    const fetchCurrentAddress = async () => {
      if (params.currentLat && params.currentLng) {
        setLoadingAddress(true);
        try {
          const latitude = parseFloat(params.currentLat as string);
          const longitude = parseFloat(params.currentLng as string);
          
          setCurrentLocation({ latitude, longitude });
          
          if (params.currentName && (params.currentName as string).trim()) {
            console.log("Using passed place name:", params.currentName);
            setPickup(params.currentName as string);
          } else {
            console.log("Reverse geocoding coordinates:", latitude, longitude);
            
            const addresses = await Location.reverseGeocodeAsync({
              latitude,
              longitude,
            });
            
            console.log("Geocoded addresses:", addresses);
            
            if (addresses && addresses.length > 0) {
              const address = addresses[0];
              const formattedAddress = [
                address.name,
                address.street,
                address.city,
                address.region,
              ]
                .filter(Boolean)
                .join(", ");
              
              console.log("Formatted address:", formattedAddress);
              setPickup(formattedAddress || "Current Location");
            } else {
              setPickup("Current Location");
            }
          }
        } catch (error) {
          console.error("Error reverse geocoding:", error);
          setPickup("Current Location");
        } finally {
          setLoadingAddress(false);
        }
      }
    };

    fetchCurrentAddress();
  }, [params.currentLat, params.currentLng, params.currentName]);

  useEffect(() => {
    if (params.editingField) {
      console.log("Received editingField from ride-confirm:", params.editingField);
      setActiveInput(params.editingField as "pickup" | "destination");
      setIsFromRideConfirm(true);
      
      if (params.currentPickup) {
        setPickup(params.currentPickup as string);
      }
      if (params.currentDestination) {
        setDestination(params.currentDestination as string);
      }
      if (params.pickupLat && params.pickupLng) {
        const lat = parseFloat(params.pickupLat as string);
        const lng = parseFloat(params.pickupLng as string);
        if (!isNaN(lat) && !isNaN(lng)) {
          setPickupCoords({ latitude: lat, longitude: lng });
          setCurrentLocation({ latitude: lat, longitude: lng });
        }
      }
      if (params.destLat && params.destLng) {
        const lat = parseFloat(params.destLat as string);
        const lng = parseFloat(params.destLng as string);
        if (!isNaN(lat) && !isNaN(lng)) {
          setDestinationCoords({ latitude: lat, longitude: lng });
        }
      }
      
      // Handle adding new destination mode
      if (params.addingNewDestination === 'true') {
        console.log("Adding new destination mode");
        setIsAddingNewDestination(true);
        setDestination('');
        setDestinationCoords(null);
      }
      
      // Parse existing destinations
      if (params.allDestinations) {
        try {
          const dests = JSON.parse(params.allDestinations as string);
          console.log("Existing destinations:", dests);
          setExistingDestinations(dests);
        } catch (e) {
          console.log("Error parsing allDestinations");
        }
      }
      
      // Check if coming from offer fare side sheet
      if (params.fromOfferFare === 'true') {
        console.log("Coming from OfferFareSideSheet");
        setIsFromOfferFare(true);
        setOriginalParams({
          pickup: params.currentPickup,
          destination: params.currentDestination,
          pickupLat: params.pickupLat,
          pickupLng: params.pickupLng,
          destLat: params.destLat,
          destLng: params.destLng,
          allDestinations: params.allDestinations,
        });
      }
    }
  }, [params.editingField, params.currentPickup, params.currentDestination, params.pickupLat, params.pickupLng, params.destLat, params.destLng, params.addingNewDestination, params.allDestinations]);

  useEffect(() => {
    if (params.selectedField && params.selectedName && params.selectedLat && params.selectedLng) {
      const field = params.selectedField as string;
      const name = params.selectedName as string;
      const lat = parseFloat(params.selectedLat as string);
      const lng = parseFloat(params.selectedLng as string);

      console.log("Received map selection:", field, name, lat, lng);

      // Restore previous state from map-picker
      if (params.prevPickup && field !== "pickup") {
        setPickup(params.prevPickup as string);
      }
      if (params.prevDestination && field !== "destination") {
        setDestination(params.prevDestination as string);
      }
      if (params.prevPickupLat && params.prevPickupLng && field !== "pickup") {
        const prevLat = parseFloat(params.prevPickupLat as string);
        const prevLng = parseFloat(params.prevPickupLng as string);
        if (!isNaN(prevLat) && !isNaN(prevLng)) {
          setPickupCoords({ latitude: prevLat, longitude: prevLng });
        }
      }
      if (params.prevCurrentLat && params.prevCurrentLng) {
        const prevLat = parseFloat(params.prevCurrentLat as string);
        const prevLng = parseFloat(params.prevCurrentLng as string);
        if (!isNaN(prevLat) && !isNaN(prevLng)) {
          setCurrentLocation({ latitude: prevLat, longitude: prevLng });
        }
      }

      if (field === "pickup") {
        setPickup(name);
        setPickupCoords({ latitude: lat, longitude: lng });
        setActiveInput("destination");
      } else if (field === "destination") {
        setDestination(name);
        setDestinationCoords({ latitude: lat, longitude: lng });
      }
    }
  }, [params.selectedField, params.selectedName, params.selectedLat, params.selectedLng, params.prevPickup, params.prevDestination, params.prevPickupLat, params.prevPickupLng, params.prevCurrentLat, params.prevCurrentLng]);

  const handleLocationSelect = (location: LocationResult) => {
    setHasUserMadeSelection(true);
    // Use fullName if available, otherwise fall back to name
    const displayName = location.fullName || location.name;
    console.log("Selected location:", displayName, "from", location.name);
    
    if (activeInput === "pickup") {
      setPickup(displayName);
      setPickupCoords({
        latitude: location.latitude,
        longitude: location.longitude,
      });
      setActiveInput("destination");
    } else {
      setDestination(displayName);
      setDestinationCoords({
        latitude: location.latitude,
        longitude: location.longitude,
      });
    }
  };

  

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return <Text style={styles.suggestionName}>{text}</Text>;
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);
    return (
      <Text style={styles.suggestionName}>
        {parts.map((part, index) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <Text key={index} style={styles.highlightedText}>{part}</Text>
          ) : (
            <Text key={index}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  const searchQuery = activeInput === "pickup" ? pickup : destination;
  const showSearchResultsTab = searchQuery.length >= 3;

  const airportAreas = useAirportAreas();
  const buildAirportItem = (area: { entry: { id: string }; name: string; code: string; centroid: { latitude: number; longitude: number } }): LocationWithDistance => {
    const refCoords = activeInput === "pickup" ? currentLocation : pickupCoords || currentLocation;
    let distance: string | undefined;
    if (refCoords) {
      const d = calculateDistance(refCoords.latitude, refCoords.longitude, area.centroid.latitude, area.centroid.longitude);
      distance = formatDistance(d);
    }
    return {
      id: `airport-${area.entry.id}`,
      name: area.name,
      fullName: area.name,
      address: area.code ? `${area.code} · Airport` : "Airport",
      latitude: area.centroid.latitude,
      longitude: area.centroid.longitude,
      distance,
    };
  };
  const visibleResults = useMemo<LocationWithDistance[]>(() => applyAirportAreaFilter(
    filteredLocations,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportItem,
    undefined,
    (it) => `${it.fullName ?? ""} ${it.name ?? ""} ${it.address ?? ""}`,
  ), [filteredLocations, airportAreas, currentLocation, pickupCoords, activeInput]);
  const visibleSuggested = useMemo<LocationWithDistance[]>(() => applyAirportAreaFilter(
    suggestedLocations,
    airportAreas,
    (it) => ({ lat: it.latitude, lon: it.longitude }),
    buildAirportItem,
    undefined,
    (it) => `${it.fullName ?? ""} ${it.name ?? ""} ${it.address ?? ""}`,
  ), [suggestedLocations, airportAreas, currentLocation, pickupCoords, activeInput]);

  useEffect(() => {
    if (!showSearchResultsTab && activeTab === "results") {
      setActiveTab("suggested");
    } else if (showSearchResultsTab && filteredLocations.length > 0 && activeTab !== "results") {
      setActiveTab("results");
    }
  }, [showSearchResultsTab, activeTab, filteredLocations.length]);

  useEffect(() => {
    // Don't auto-navigate if coming from ride-confirm with both locations already filled
    // Only navigate when user has made a new selection
    if (
      pickup.trim() &&
      destination.trim() &&
      destinationCoords &&
      (pickupCoords || currentLocation) &&
      (!isFromRideConfirm || hasUserMadeSelection)
    ) {
      console.log("Both locations set, auto-navigating to ride-confirm");
      Keyboard.dismiss();
      const timer = setTimeout(() => {
        // If we're adding a new destination, append to existing destinations
        if (isAddingNewDestination && existingDestinations.length > 0) {
          const newDestinations = [
            ...existingDestinations,
            {
              address: destination,
              lat: destinationCoords.latitude,
              lng: destinationCoords.longitude,
            }
          ];
          
          // Limit to 5 destinations
          const limitedDestinations = newDestinations.slice(0, 5);
          
          setPendingLocationReturn({
            pickup,
            pickupLat: (pickupCoords?.latitude || currentLocation?.latitude || "").toString(),
            pickupLng: (pickupCoords?.longitude || currentLocation?.longitude || "").toString(),
            destinations: limitedDestinations,
            fromOfferFare: isFromOfferFare,
          });
          router.back();
        } else {
          // Check if we're editing a destination at specific index from offer fare
          if (isFromOfferFare && params.editingDestinationIndex && existingDestinations.length > 0) {
            const editIndex = parseInt(params.editingDestinationIndex as string);
            const updatedDestinations = [...existingDestinations];
            updatedDestinations[editIndex] = {
              address: destination,
              lat: destinationCoords.latitude,
              lng: destinationCoords.longitude,
            };

            setPendingLocationReturn({
              pickup,
              pickupLat: (pickupCoords?.latitude || currentLocation?.latitude || "").toString(),
              pickupLng: (pickupCoords?.longitude || currentLocation?.longitude || "").toString(),
              destinations: updatedDestinations,
              fromOfferFare: true,
            });
            router.back();
          } else if (isFromRideConfirm || isFromOfferFare) {
            // Coming from ride-confirm/offer-fare: hand locations back to the existing screen
            setPendingLocationReturn({
              pickup,
              pickupLat: (pickupCoords?.latitude || currentLocation?.latitude || "").toString(),
              pickupLng: (pickupCoords?.longitude || currentLocation?.longitude || "").toString(),
              destinations: [{ address: destination, lat: destinationCoords.latitude, lng: destinationCoords.longitude }],
              fromOfferFare: isFromOfferFare,
            });
            router.back();
          } else {
            // Fresh route entered from the home screen: go to ride-confirm.
            // Search is presented as a modal, so router.replace params don't
            // reliably reach ride-confirm. Hand the locations off via the same
            // pending-return channel the editing flows use (consumed in
            // ride-confirm's focus effect), and also pass params as a fallback.
            const resolvedPickupLat = (pickupCoords?.latitude || currentLocation?.latitude || "").toString();
            const resolvedPickupLng = (pickupCoords?.longitude || currentLocation?.longitude || "").toString();
            setPendingLocationReturn({
              pickup,
              pickupLat: resolvedPickupLat,
              pickupLng: resolvedPickupLng,
              destinations: [{
                address: destination,
                lat: destinationCoords.latitude,
                lng: destinationCoords.longitude,
              }],
              fromOfferFare: false,
            });
            router.replace({
              pathname: "/ride-confirm" as any,
              params: {
                pickup,
                destination,
                pickupLat: resolvedPickupLat,
                pickupLng: resolvedPickupLng,
                destLat: destinationCoords.latitude.toString(),
                destLng: destinationCoords.longitude.toString(),
              },
            });
          }
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [pickup, destination, pickupCoords, destinationCoords, currentLocation, router, isFromRideConfirm, isFromOfferFare, hasUserMadeSelection, isAddingNewDestination, existingDestinations]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#1a1a1a' }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Enter your route</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => {
            if (isFromOfferFare) {
              // Go back to ride-confirm restoring original locations and reopening OfferFareSideSheet
              const destData = existingDestinations.length > 0 ? existingDestinations : [];
              const restoredPickup = (originalParams.pickup as string) || pickup;
              const restoredPickupLat = (originalParams.pickupLat as string) || (pickupCoords?.latitude || "").toString();
              const restoredPickupLng = (originalParams.pickupLng as string) || (pickupCoords?.longitude || "").toString();
              setPendingLocationReturn({
                pickup: restoredPickup,
                pickupLat: restoredPickupLat,
                pickupLng: restoredPickupLng,
                destinations: destData,
                fromOfferFare: true,
              });
            }
            router.back();
          }}
        >
          <X color="#999" size={24} />
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        {!isAddingNewDestination && (
          <TouchableOpacity 
            style={[styles.inputCard, activeInput === "pickup" && styles.inputCardActive]}
            onPress={() => setActiveInput("pickup")}
            activeOpacity={1}
          >
            <View style={styles.fromIconContainer}>
              <View style={styles.fromIcon} />
            </View>
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>From</Text>
              {activeInput === "pickup" ? (
                <TextInput
                  style={styles.inputText}
                  placeholder="Enter pickup location"
                  placeholderTextColor="#888"
                  value={pickup}
                  onChangeText={setPickup}
                  autoFocus
                  editable={!loadingAddress}
                />
              ) : (
                <Text style={[styles.inputValue, !pickup && styles.placeholderText]} numberOfLines={1}>
                  {pickup || "Enter pickup location"}
                </Text>
              )}
            </View>
            {loadingAddress && (
              <ActivityIndicator
                style={styles.loader}
                color={Colors.accent}
                size="small"
              />
            )}
            {pickup.length > 0 && activeInput === "pickup" && !loadingAddress && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={(e) => {
                  e.stopPropagation?.();
                  setPickup("");
                  setPickupCoords(null);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <View style={styles.clearButtonInner}>
                  <X color="#888" size={14} />
                </View>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={[styles.inputCard, activeInput === "destination" && styles.inputCardActive]}
          onPress={() => setActiveInput("destination")}
          activeOpacity={1}
        >
          <View style={styles.searchIconContainer}>
            <Search color="#888" size={20} />
          </View>
          <View style={styles.inputContent}>
            <Text style={styles.inputLabel}>To</Text>
            {activeInput === "destination" ? (
              <TextInput
                style={styles.inputText}
                placeholder="Enter destination"
                placeholderTextColor="#888"
                value={destination}
                onChangeText={setDestination}
                autoFocus
              />
            ) : (
              <Text style={[styles.inputValue, !destination && styles.placeholderText]} numberOfLines={1}>
                {destination || "Enter destination"}
              </Text>
            )}
          </View>
          {destination.length > 0 && activeInput === "destination" && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={(e) => {
                e.stopPropagation?.();
                setDestination("");
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.clearButtonInner}>
                <X color="#888" size={14} />
              </View>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.chooseOnMapButton}
          onPress={() => {
            router.back();
            setTimeout(() => {
              router.push({
                pathname: "/map-picker" as any,
                params: {
                  activeField: activeInput,
                  initialLat: activeInput === "pickup" 
                    ? (pickupCoords?.latitude || currentLocation?.latitude || "").toString()
                    : (currentLocation?.latitude || "").toString(),
                  initialLng: activeInput === "pickup"
                    ? (pickupCoords?.longitude || currentLocation?.longitude || "").toString()
                    : (currentLocation?.longitude || "").toString(),
                  currentPickup: pickup,
                  currentDestination: destination,
                  currentPickupLat: (pickupCoords?.latitude || "").toString(),
                  currentPickupLng: (pickupCoords?.longitude || "").toString(),
                  currentLocationLat: (currentLocation?.latitude || "").toString(),
                  currentLocationLng: (currentLocation?.longitude || "").toString(),
                },
              });
            }, 100);
          }}
        >
          <Navigation color="#3B9EFF" size={18} />
          <Text style={styles.chooseOnMapText}>Choose on map</Text>
        </TouchableOpacity>

        <View style={styles.tabsContainer}>
          {showSearchResultsTab && (
            <TouchableOpacity
              style={[styles.tab, activeTab === "results" && styles.tabActive]}
              onPress={() => setActiveTab("results")}
            >
              <Text style={[styles.tabText, activeTab === "results" && styles.tabTextActive]}>Search Results</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.tab, activeTab === "suggested" && styles.tabActive]}
            onPress={() => setActiveTab("suggested")}
          >
            <Text style={[styles.tabText, activeTab === "suggested" && styles.tabTextActive]}>Suggested</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "saved" && styles.tabActive]}
            onPress={() => setActiveTab("saved")}
          >
            <Text style={[styles.tabText, activeTab === "saved" && styles.tabTextActive]}>Saved</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.suggestionsContainer}>
        {isSearching && (
          <View style={styles.sectionHeader}>
            <ActivityIndicator color={Colors.accent} size="small" />
            <Text style={styles.sectionTitle}>Searching...</Text>
          </View>
        )}

        <FlatList
          data={activeTab === "saved" ? [] : (activeTab === "suggested" ? visibleSuggested : visibleResults)}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => Keyboard.dismiss()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MapPin color="#666" size={48} />
              <Text style={styles.emptyStateText}>
                {activeTab === "saved" ? "No saved locations" : "No locations found"}
              </Text>
              <Text style={styles.emptyStateSubtext}>
                {activeTab === "saved" ? "Save your frequent destinations" : "Try a different search term"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SuggestionRow
              item={item}
              searchQuery={searchQuery}
              highlightText={highlightText}
              onSelect={handleLocationSelect}
              styles={styles}
              usage={activeInput === "pickup" ? "pickup" : "drop"}
            />
          )}
        />
      </View>

      
    </SafeAreaView>
  );
}

interface SuggestionRowProps {
  item: LocationWithDistance;
  searchQuery: string;
  highlightText: (text: string, query: string) => React.ReactNode;
  onSelect: (loc: LocationWithDistance) => void;
  styles: { [key: string]: any };
  usage: "pickup" | "drop";
}

function SuggestionRow({ item, searchQuery, highlightText, onSelect, styles, usage }: SuggestionRowProps) {
  const matched = useGatesForCoordinates(item.latitude, item.longitude, usage, item.fullName || item.name);
  const blockPlaceTap = !!matched && matched.gateRequired && matched.gates.length > 0;
  return (
    <TouchableOpacity
      style={styles.suggestionItem}
      activeOpacity={blockPlaceTap ? 1 : 0.6}
      onPress={() => {
        if (blockPlaceTap) return;
        onSelect(item);
      }}
    >
      <View style={styles.suggestionIcon}>
        <MapPin color="#888" size={18} />
      </View>
      <View style={styles.suggestionText}>
        {highlightText(item.name, searchQuery)}
        <Text style={styles.suggestionAddress} numberOfLines={2}>{item.address}</Text>
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
      <View style={styles.suggestionRight}>
        {item.distance && (
          <Text style={styles.distanceText}>{item.distance}</Text>
        )}
        <TouchableOpacity style={styles.bookmarkButton}>
          <Bookmark color="#666" size={20} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    position: "relative" as const,
  },
  closeButton: {
    position: "absolute" as const,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  inputContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  inputCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3a3a3a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  inputCardActive: {
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  fromIconContainer: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  fromIcon: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#238baf",
    borderWidth: 2,
    borderColor: "#238baf",
  },
  inputContent: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    color: "#888",
    marginBottom: 2,
  },
  inputText: {
    fontSize: 15,
    color: "#fff",
    padding: 0,
  },
  inputValue: {
    fontSize: 15,
    color: "#fff",
  },
  placeholderText: {
    color: "#888",
  },
  clearButton: {
    marginLeft: 8,
  },
  clearButtonInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#555",
    justifyContent: "center",
    alignItems: "center",
  },
  searchIconContainer: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  loader: {
    marginLeft: 8,
  },
  chooseOnMapButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  chooseOnMapText: {
    fontSize: 15,
    color: "#3B9EFF",
    marginLeft: 10,
    fontWeight: "500",
  },
  tabsContainer: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
    flexWrap: "wrap",
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#3a3a3a",
  },
  tabActive: {
    backgroundColor: "#fff",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#999",
  },
  tabTextActive: {
    color: "#000",
  },
  suggestionsContainer: {
    flex: 1,
    paddingTop: 20,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#888",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  suggestionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    backgroundColor: "#3a3a3a",
    marginTop: 2,
  },
  suggestionText: {
    flex: 1,
    marginRight: 12,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
    color: "#fff",
  },
  highlightedText: {
    color: "#3B9EFF",
  },
  suggestionAddress: {
    fontSize: 13,
    color: "#888",
    lineHeight: 18,
  },
  suggestionRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  distanceText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#888",
  },
  bookmarkButton: {
    padding: 4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center" as const,
    color: "#fff",
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center" as const,
    color: "#888",
  },
  
});
