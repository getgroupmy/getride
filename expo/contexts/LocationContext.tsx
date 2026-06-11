import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { reverseGeocode } from "@/utils/maps";
import { CurrencyInfo, DEFAULT_CURRENCY, getCurrencyForCountry } from "@/constants/currency";

/** AsyncStorage key holding the last captured location + address for instant boot. */
const LAST_LOCATION_KEY = "@last_location_v1";

interface PersistedLocation {
  location: Location.LocationObject;
  currentAddress: { name: string; address: string } | null;
  countryCode: string;
}

async function saveLastLocation(data: PersistedLocation): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(data));
  } catch (e) {
    console.log("[LocationContext] Failed to persist last location:", e);
  }
}

interface LocationState {
  location: Location.LocationObject | null;
  currentAddress: { name: string; address: string } | null;
  errorMsg: string | null;
  isLoading: boolean;
  permissionStatus: Location.PermissionStatus | null;
  skipNextLocationDetection: boolean;
  countryCode: string;
  currency: CurrencyInfo;
}

const DEFAULT_LOCATION: Location.LocationObject = {
  coords: {
    latitude: 3.139,
    longitude: 101.6869,
    altitude: null,
    accuracy: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  },
  timestamp: Date.now(),
};

export const [LocationProvider, useLocation] = createContextHook(() => {
  const [state, setState] = useState<LocationState>({
    location: null,
    currentAddress: null,
    errorMsg: null,
    isLoading: true,
    permissionStatus: null,
    skipNextLocationDetection: false,
    countryCode: "MY",
    currency: DEFAULT_CURRENCY,
  });
  const hasInitialized = useRef(false);
  const hasRealtimeLocation = useRef(false);
  const skipNextLocationDetectionRef = useRef(false);

  // Hydrate from the last captured location (saved locally) so the index screen
  // shows a real position immediately, before realtime location is captured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as PersistedLocation;
        if (!parsed?.location?.coords) return;
        // Only use the cached location if realtime hasn't arrived yet.
        if (hasRealtimeLocation.current) return;
        console.log("[LocationContext] Hydrated last location from storage:", parsed.location.coords);
        setState(prev =>
          prev.location
            ? prev
            : {
                ...prev,
                location: parsed.location,
                currentAddress: parsed.currentAddress ?? prev.currentAddress,
                countryCode: parsed.countryCode || prev.countryCode,
                currency: getCurrencyForCountry(parsed.countryCode || prev.countryCode),
              },
        );
      } catch (e) {
        console.log("[LocationContext] Failed to hydrate last location:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchLocation = async () => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    console.log("[LocationContext] Starting location fetch at app launch...");
    
    try {
      console.log("[LocationContext] Requesting location permissions...");
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      setState(prev => ({ ...prev, permissionStatus: status }));
      
      if (status !== "granted") {
        console.log("[LocationContext] Location permission denied");
        setState(prev => ({
          ...prev,
          errorMsg: "Permission to access location was denied",
          location: DEFAULT_LOCATION,
          isLoading: false,
        }));
        return;
      }

      console.log("[LocationContext] Permission granted, getting current location...");

      try {
        const [geoResult] = await Location.reverseGeocodeAsync({
          latitude: DEFAULT_LOCATION.coords.latitude,
          longitude: DEFAULT_LOCATION.coords.longitude,
        });
        if (geoResult?.isoCountryCode) {
          const detectedCountry = geoResult.isoCountryCode;
          console.log("[LocationContext] Detected country:", detectedCountry);
          setState(prev => ({
            ...prev,
            countryCode: detectedCountry,
            currency: getCurrencyForCountry(detectedCountry),
          }));
        }
      } catch {
        console.log("[LocationContext] Country detection fallback, using default MY");
      }
      
      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
          timeInterval: 3000,
          mayShowUserSettingsDialog: true,
        });
        
        console.log("[LocationContext] Current location obtained:", currentLocation.coords);

        try {
          const [geoResult] = await Location.reverseGeocodeAsync({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
          });
          if (geoResult?.isoCountryCode) {
            const detectedCountry = geoResult.isoCountryCode;
            console.log("[LocationContext] Detected country from actual location:", detectedCountry);
            setState(prev => ({
              ...prev,
              countryCode: detectedCountry,
              currency: getCurrencyForCountry(detectedCountry),
            }));
          }
        } catch {
          console.log("[LocationContext] Country detection from location failed");
        }

        const addressData = await reverseGeocode(
          currentLocation.coords.latitude,
          currentLocation.coords.longitude
        );
        
        if (addressData) {
          console.log("[LocationContext] Reverse geocoded address:", addressData);
        }
        
        hasRealtimeLocation.current = true;
        setState(prev => ({
          ...prev,
          location: currentLocation,
          currentAddress: addressData,
          errorMsg: null,
          isLoading: false,
          permissionStatus: status,
        }));
        void saveLastLocation({
          location: currentLocation,
          currentAddress: addressData,
          countryCode: state.countryCode,
        });
      } catch (locationError: any) {
        console.error("[LocationContext] Error getting current position:", locationError);
        console.log("[LocationContext] Trying with last known position...");
        
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: 60000,
            requiredAccuracy: 1000,
          });
          
          if (lastKnown) {
            console.log("[LocationContext] Using last known location:", lastKnown.coords);
            
            const addressData = await reverseGeocode(
              lastKnown.coords.latitude,
              lastKnown.coords.longitude
            );
            
            hasRealtimeLocation.current = true;
            setState(prev => ({
              ...prev,
              location: lastKnown,
              currentAddress: addressData,
              errorMsg: null,
              isLoading: false,
              permissionStatus: status,
            }));
            void saveLastLocation({
              location: lastKnown,
              currentAddress: addressData,
              countryCode: state.countryCode,
            });
          } else {
            console.log("[LocationContext] No last known position available, using default");
            setState(prev => ({
              ...prev,
              location: DEFAULT_LOCATION,
              currentAddress: null,
              errorMsg: "Unable to get location. Using default location.",
              isLoading: false,
              permissionStatus: status,
            }));
          }
        } catch (lastKnownError: any) {
          console.error("[LocationContext] Error getting last known position:", lastKnownError);
          setState(prev => ({
            ...prev,
            location: DEFAULT_LOCATION,
            currentAddress: null,
            errorMsg: "Location unavailable. Using default location.",
            isLoading: false,
            permissionStatus: status,
          }));
        }
      }
    } catch (error: any) {
      console.error("[LocationContext] Error in location setup:", error);
      setState(prev => ({
        ...prev,
        location: DEFAULT_LOCATION,
        currentAddress: null,
        errorMsg: "Location service error. Using default location.",
        isLoading: false,
        permissionStatus: null,
      }));
    }
  };

  useEffect(() => {
    void fetchLocation();
  }, []);

  const updateAddress = useCallback((address: { name: string; address: string } | null) => {
    setState(prev => ({ ...prev, currentAddress: address }));
  }, []);

  const refreshLocation = useCallback(async () => {
    console.log("[LocationContext] Refreshing location...");
    setState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== "granted") {
          console.log("[LocationContext] Refresh: permission denied");
          setState(prev => ({
            ...prev,
            isLoading: false,
            errorMsg: "Permission to access location was denied",
            permissionStatus: req.status,
          }));
          return null;
        }
      }

      let currentLocation: Location.LocationObject | null = null;
      try {
        currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch (posError: any) {
        const code = posError?.code;
        const message = posError?.message ?? String(posError);
        console.log("[LocationContext] getCurrentPositionAsync failed:", { code, message });
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 60000,
          requiredAccuracy: 1000,
        }).catch(() => null);
        if (lastKnown) {
          console.log("[LocationContext] Using last known location for refresh");
          currentLocation = lastKnown;
        }
      }

      if (!currentLocation) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          errorMsg: "Unable to get location.",
        }));
        return null;
      }

      const addressData = await reverseGeocode(
        currentLocation.coords.latitude,
        currentLocation.coords.longitude
      ).catch(() => null);

      hasRealtimeLocation.current = true;
      setState(prev => ({
        ...prev,
        location: currentLocation,
        currentAddress: addressData,
        isLoading: false,
        errorMsg: null,
      }));
      void saveLastLocation({
        location: currentLocation,
        currentAddress: addressData,
        countryCode: state.countryCode,
      });

      return { location: currentLocation, address: addressData };
    } catch (error: any) {
      const code = error?.code;
      const message = error?.message ?? String(error);
      console.error("[LocationContext] Error refreshing location:", { code, message });
      setState(prev => ({ ...prev, isLoading: false }));
      return null;
    }
  }, []);

  const setSkipNextLocationDetection = useCallback((skip: boolean) => {
    console.log("[LocationContext] Setting skipNextLocationDetection:", skip);
    skipNextLocationDetectionRef.current = skip;
    setState(prev => ({ ...prev, skipNextLocationDetection: skip }));
  }, []);

  const shouldSkipLocationDetection = useCallback(() => {
    const shouldSkip = skipNextLocationDetectionRef.current;
    if (shouldSkip) {
      console.log("[LocationContext] Checking skip flag (ref):", shouldSkip);
      skipNextLocationDetectionRef.current = false;
      setState(prev => ({ ...prev, skipNextLocationDetection: false }));
    }
    return shouldSkip;
  }, []);

  return useMemo(() => ({
    ...state,
    updateAddress,
    refreshLocation,
    setSkipNextLocationDetection,
    shouldSkipLocationDetection,
  }), [state, updateAddress, refreshLocation, setSkipNextLocationDetection, shouldSkipLocationDetection]);
});
