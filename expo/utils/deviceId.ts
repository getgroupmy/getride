import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { uuidv4 } from "@/utils/supabase";

/**
 * Stable per-device identifier, independent of the signed-in user/phone.
 * Used both for session telemetry and for device-based duplicate-account
 * detection at sign-up, so it lives in its own module for reuse.
 *
 *   - Android: ANDROID_ID (`Application.getAndroidId()`) — survives reinstalls
 *     (per app signing key), the best fraud fingerprint available.
 *   - iOS    : identifierForVendor (`Application.getIosIdForVendorAsync()`).
 *   - other  : a client-generated UUID, persisted in AsyncStorage so it
 *              survives app restarts (but not reinstalls).
 *
 * Resolved once per app run and cached in-memory thereafter.
 */

const DEVICE_ID_STORAGE_KEY = "@session_device_id";

let cachedDeviceId: string | null = null;

export async function getOrCreateDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    if (Platform.OS === "android") {
      const id = Application.getAndroidId?.() ?? null;
      if (id) {
        cachedDeviceId = id;
        return id;
      }
    } else if (Platform.OS === "ios") {
      const id = await Application.getIosIdForVendorAsync();
      if (id) {
        cachedDeviceId = id;
        return id;
      }
    }
  } catch (e) {
    console.log("[deviceId] native device id lookup failed", e);
  }

  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
    const generated = uuidv4();
    await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    cachedDeviceId = generated;
    return generated;
  } catch (e) {
    console.log("[deviceId] persistence failed", e);
    return null;
  }
}
