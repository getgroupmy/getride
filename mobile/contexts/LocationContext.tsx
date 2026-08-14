import createContextHook from "@nkzw/create-context-hook";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";

import { formatDisplayAddress } from "@/utils/addressFormatter";
import { reverseGeocode } from "@/utils/maps";

/**
 * Foreground location for the rider surface.
 *
 * Kept deliberately small: one fix, one address, one permission answer. The
 * legacy context also carried history recording and a "skip next detection"
 * flag for screen-to-screen handoff; neither belongs to the rider core and
 * both return with the features that need them.
 */

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface LocationState {
  coords: Coords | null;
  /** Human-readable address for `coords`, once the geocoder answers. */
  address: string | null;
  /** null while the permission has not been asked or answered yet. */
  granted: boolean | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL: LocationState = {
  coords: null,
  address: null,
  granted: null,
  isLoading: false,
  error: null,
};

export const [LocationProvider, useLocation] = createContextHook(() => {
  const [state, setState] = useState<LocationState>(INITIAL);

  /**
   * Ask for permission and take a fix.
   *
   * The address is filled in afterwards rather than awaited with the fix: the
   * map can centre the moment coordinates land, and a slow geocoder should
   * never hold that up.
   */
  const refresh = useCallback(async (): Promise<Coords | null> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setState((prev) => ({
          ...prev,
          granted: false,
          isLoading: false,
          error: "Location permission is off, so we cannot set your pickup automatically.",
        }));
        return null;
      }

      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: Coords = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
      };
      setState((prev) => ({ ...prev, coords, granted: true, isLoading: false }));

      void (async () => {
        try {
          const place = await reverseGeocode(coords.latitude, coords.longitude);
          if (!place) return;
          const address = formatDisplayAddress(place.name, place.address);
          // Only apply it if the fix it describes is still the current one —
          // a slow geocoder must not relabel a position the rider has left.
          setState((prev) =>
            prev.coords?.latitude === coords.latitude &&
            prev.coords?.longitude === coords.longitude
              ? { ...prev, address }
              : prev
          );
        } catch {
          // No address is a cosmetic loss; the fix still works.
        }
      })();

      return coords;
    } catch (e) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: e instanceof Error ? e.message : "Could not read your location.",
      }));
      return null;
    }
  }, []);

  // Take one fix on mount so the map opens where the rider is.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
});
