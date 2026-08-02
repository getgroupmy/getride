/**
 * The vehicle's fuel profile — tank capacity, the driver's average
 * consumption, and the running measurement taken from their own fuel burn.
 *
 * Device-local (AsyncStorage) for the same reason the adapter book is: an
 * OBD-II reader and the car it is plugged into belong to one phone, so there
 * is nothing to migrate and nothing that stops working offline.
 *
 * All of the arithmetic lives in `utils/canbus/fuelRange.ts`; this module only
 * loads, validates and saves.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  defaultFuelProfile,
  learnConsumption,
  normalizeFuelProfile,
  profileForVin,
  type FuelProfile,
  type FuelSample,
} from "@/utils/canbus/fuelRange";

export const VEHICLE_FUEL_PROFILE_KEY = "@vehicle_fuel_profile_v1";

export async function loadFuelProfile(): Promise<FuelProfile> {
  try {
    const raw = await AsyncStorage.getItem(VEHICLE_FUEL_PROFILE_KEY);
    if (!raw) return defaultFuelProfile();
    return normalizeFuelProfile(JSON.parse(raw));
  } catch (e) {
    console.log("[vehicle-fuel] load failed", e);
    return defaultFuelProfile();
  }
}

export async function saveFuelProfile(profile: FuelProfile): Promise<FuelProfile> {
  const normalized = normalizeFuelProfile(profile);
  try {
    await AsyncStorage.setItem(VEHICLE_FUEL_PROFILE_KEY, JSON.stringify(normalized));
  } catch (e) {
    console.log("[vehicle-fuel] save failed", e);
  }
  return normalized;
}

/**
 * Load the profile for the vehicle currently on the reader, and — when the
 * scan saw both an odometer and a fuel level — fold that pair into the
 * running consumption measurement.
 *
 * Returns the profile the screen should render with; it is persisted first, so
 * the next scan measures against this reading.
 */
export async function recordFuelSample(
  vin: string | null,
  sample: FuelSample | null,
): Promise<{ profile: FuelProfile; learned: boolean }> {
  const stored = await loadFuelProfile();
  const profile = profileForVin(stored, vin);
  if (!sample) {
    // Nothing to measure against, but the VIN may have switched the profile.
    if (profile !== stored) await saveFuelProfile(profile);
    return { profile, learned: false };
  }
  const result = learnConsumption(sample, profile);
  const saved = await saveFuelProfile(result.profile);
  return { profile: saved, learned: result.learned };
}

/** Drop the measured consumption and its baseline, keeping what the driver typed. */
export async function resetMeasuredConsumption(): Promise<FuelProfile> {
  const profile = await loadFuelProfile();
  return saveFuelProfile({ ...profile, measuredL100: null, baseline: null });
}
