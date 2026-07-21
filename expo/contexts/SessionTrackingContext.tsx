import { useEffect, useRef, useCallback } from "react";
import { Platform, AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import * as Location from "expo-location";
import * as Device from "expo-device";
import * as Network from "expo-network";
import * as Cellular from "expo-cellular";
import * as Application from "expo-application";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Telemetry context: writes one row to `public.user_sessions` on every app
 * launch / relaunch / login, and pings `public.user_location_history` with
 * the current GPS coordinates every 30 seconds while a user is signed in.
 *
 * Both writes are best-effort: failures are logged but never throw.
 */

const LOCATION_PING_MS = 30_000;
const LOCATION_DISTANCE_M = 10;
const DEVICE_ID_STORAGE_KEY = "@session_device_id";

type EventType = "login" | "app_launch" | "app_relaunch";

interface DeviceSnapshot {
  os_name: string;
  os_version: string | null;
  device_brand: string | null;
  device_manufacturer: string | null;
  device_model_name: string | null;
  device_model_id: string | null;
  device_year_class: number | null;
  device_type: string | null;
  is_physical_device: boolean | null;
  app_version: string | null;
  app_build_version: string | null;
  app_id: string | null;
}

function deviceTypeLabel(t: Device.DeviceType | null | undefined): string | null {
  switch (t) {
    case Device.DeviceType.PHONE:
      return "PHONE";
    case Device.DeviceType.TABLET:
      return "TABLET";
    case Device.DeviceType.DESKTOP:
      return "DESKTOP";
    case Device.DeviceType.TV:
      return "TV";
    case Device.DeviceType.UNKNOWN:
      return "UNKNOWN";
    default:
      return null;
  }
}

async function captureDeviceSnapshot(): Promise<DeviceSnapshot> {
  let deviceType: Device.DeviceType | null = null;
  try {
    deviceType = await Device.getDeviceTypeAsync();
  } catch {}

  return {
    os_name: Platform.OS,
    os_version:
      (Device.osVersion ?? null) ||
      (typeof Platform.Version === "string"
        ? Platform.Version
        : Platform.Version != null
        ? String(Platform.Version)
        : null),
    device_brand: Device.brand ?? null,
    device_manufacturer: Device.manufacturer ?? null,
    device_model_name: Device.modelName ?? null,
    device_model_id: Device.modelId ?? null,
    device_year_class: Device.deviceYearClass ?? null,
    device_type: deviceTypeLabel(deviceType),
    is_physical_device: Device.isDevice ?? null,
    app_version: Application.nativeApplicationVersion ?? null,
    app_build_version: Application.nativeBuildVersion ?? null,
    app_id: Application.applicationId ?? null,
  };
}

interface NetworkSnapshot {
  network_type: string | null;
  network_is_connected: boolean | null;
  network_is_internet_reachable: boolean | null;
  network_operator: string | null;
  ip_address: string | null;
  connection_type: string | null;
  isp_provider: string | null;
  iccid: string | null;
  mobile_operator_name: string | null;
}

/**
 * Server-resolved public IP + ISP geolocation. The device can only read its
 * LAN/local IP (e.g. 192.168.x.x), which reveals nothing about the ISP. The
 * `ip-lookup` edge function reads the caller's PUBLIC IP from request headers
 * and resolves the ISP/geo via an IP geolocation provider.
 */
interface IpLookupResult {
  public_ip: string | null;
  isp_provider: string | null;
  isp_org: string | null;
  ip_city: string | null;
  ip_region: string | null;
  ip_country: string | null;
}

async function fetchIpLookup(): Promise<IpLookupResult | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke<IpLookupResult>(
      "ip-lookup",
      { body: {} }
    );
    if (error) {
      console.log("[session] ip-lookup error", error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.log("[session] ip-lookup threw", e);
    return null;
  }
}

function networkTypeLabel(t: Network.NetworkStateType | undefined): string | null {
  if (!t) return null;
  // The enum values are already strings like "WIFI", "CELLULAR", etc.
  return String(t).toUpperCase();
}

function connectionTypeLabel(t: Network.NetworkStateType | undefined): string | null {
  if (!t) return null;
  const upper = String(t).toUpperCase();
  if (upper === "WIFI") return "wifi";
  if (upper === "CELLULAR") return "mobile";
  if (upper === "ETHERNET") return "ethernet";
  if (upper === "NONE" || upper === "UNKNOWN") return "other";
  return "other";
}

async function captureNetworkSnapshot(): Promise<NetworkSnapshot> {
  let state: Network.NetworkState | null = null;
  let ip: string | null = null;
  try {
    state = await Network.getNetworkStateAsync();
  } catch (e) {
    console.log("[session] getNetworkStateAsync failed", e);
  }
  try {
    ip = await Network.getIpAddressAsync();
  } catch (e) {
    console.log("[session] getIpAddressAsync failed", e);
  }

  // Best-effort carrier / operator. Some SDK versions expose `details.carrier`
  // when on cellular; fall back gracefully when unavailable.
  let operator: string | null = null;
  let ispProvider: string | null = null;
  const anyState = state as unknown as {
    details?: { carrier?: string; isConnectionExpensive?: boolean };
  } | null;
  if (anyState?.details?.carrier) {
    operator = anyState.details.carrier;
    ispProvider = anyState.details.carrier;
  }

  // expo-cellular: carrier name / mobile operator (Android-only)
  let mobileOperatorName: string | null = null;
  try {
    const carrierName = await Cellular.getCarrierNameAsync();
    if (carrierName) {
      mobileOperatorName = carrierName;
      // Prefer cellular carrier as isp_provider when on mobile
      if (!ispProvider || connectionTypeLabel(state?.type) === "mobile") {
        ispProvider = carrierName;
      }
    }
  } catch (e) {
    console.log("[session] getCarrierNameAsync failed", e);
  }

  // ICCID — best-effort. expo-cellular does not expose it directly;
  // Android-only possible via native module. Leave null for now.
  let iccid: string | null = null;

  return {
    network_type: networkTypeLabel(state?.type),
    network_is_connected: state?.isConnected ?? null,
    network_is_internet_reachable: state?.isInternetReachable ?? null,
    network_operator: operator,
    ip_address: ip,
    connection_type: connectionTypeLabel(state?.type),
    isp_provider: ispProvider,
    iccid,
    mobile_operator_name: mobileOperatorName,
  };
}

/**
 * Stable per-device identifier, independent of the signed-in user/phone:
 *   - Android: the device's ANDROID_ID (`Application.androidId`).
 *   - iOS    : `identifierForVendor` (`Application.getIosIdForVendorAsync()`).
 *   - other  : a client-generated UUID, persisted in AsyncStorage so it
 *              survives app restarts (but not reinstalls).
 * Resolved once per app run and cached in-memory thereafter.
 */
let cachedDeviceId: string | null = null;

async function getOrCreateDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    if (Platform.OS === "android") {
      const id = Application.androidId ?? null;
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
    console.log("[session] native device id lookup failed", e);
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
    console.log("[session] device id persistence failed", e);
    return null;
  }
}

export const [SessionTrackingProvider, useSessionTracking] = createContextHook(
  () => {
    const { authState } = useAuth();
    const userId = authState.userId ?? null;
    const phone = authState.phoneNumber ?? null;
    const isAuthed = authState.isAuthenticated;

    const sessionIdRef = useRef<string | null>(null);
    const lastLoggedUserIdRef = useRef<string | null>(null);
    const launchLoggedRef = useRef<boolean>(false);
    const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
    const lastWriteAtRef = useRef<number>(0);
    const permissionAskedRef = useRef<boolean>(false);

    const logSession = useCallback(
      async (eventType: EventType) => {
        if (!isSupabaseConfigured || !supabase) return;
        try {
          const sid = uuidv4();
          sessionIdRef.current = sid;

          const [device, network, ipInfo, deviceId] = await Promise.all([
            captureDeviceSnapshot(),
            captureNetworkSnapshot(),
            fetchIpLookup(),
            getOrCreateDeviceId(),
          ]);

          const row = {
            id: sid,
            user_id: userId,
            phone,
            event_type: eventType,
            device_id: deviceId,
            ...device,
            ...network,
            // Server-resolved public IP + ISP take priority over the device's
            // best-effort carrier guess; fall back to the device value.
            public_ip: ipInfo?.public_ip ?? null,
            isp_provider: ipInfo?.isp_provider ?? network.isp_provider,
            isp_org: ipInfo?.isp_org ?? null,
            ip_city: ipInfo?.ip_city ?? null,
            ip_region: ipInfo?.ip_region ?? null,
            ip_country: ipInfo?.ip_country ?? null,
            raw: {
              platform: Platform.OS,
              platformVersion: Platform.Version,
            },
          };
          console.log("[session] logging session", {
            sid,
            eventType,
            userId,
            os: device.os_name,
            model: device.device_model_name,
            net: network.network_type,
          });
          const { error } = await supabase.from("user_sessions").insert(row);
          if (error) {
            console.log("[session] insert error", error.message);
          }
        } catch (e) {
          console.log("[session] logSession threw", e);
        }
      },
      [userId, phone]
    );

    const writeLocationRow = useCallback(
      async (pos: Location.LocationObject) => {
        if (!isSupabaseConfigured || !supabase) return;
        try {
          const deviceId = await getOrCreateDeviceId();
          const row = {
            user_id: userId,
            phone,
            session_id: sessionIdRef.current,
            device_id: deviceId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            altitude: pos.coords.altitude ?? null,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
          };
          const { error } = await supabase
            .from("user_location_history")
            .insert(row);
          if (error) {
            console.log("[session] location insert error", error.message);
          } else {
            lastWriteAtRef.current = Date.now();
          }
        } catch (e) {
          console.log("[session] writeLocationRow threw", e);
        }
      },
      [userId, phone]
    );

    const pingLocation = useCallback(async () => {
      if (!isSupabaseConfigured || !supabase) return;
      if (!isAuthed) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        let pos: Location.LocationObject | null = null;
        try {
          pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        } catch {
          pos = await Location.getLastKnownPositionAsync({
            maxAge: 60_000,
            requiredAccuracy: 1000,
          });
        }
        if (!pos) return;
        await writeLocationRow(pos);
      } catch (e) {
        console.log("[session] pingLocation threw", e);
      }
    }, [isAuthed, writeLocationRow]);

    // Log the cold-start launch exactly once.
    useEffect(() => {
      if (launchLoggedRef.current) return;
      launchLoggedRef.current = true;
      void logSession("app_launch");
    }, [logSession]);

    // Log a "login" event whenever the signed-in user id changes to a new
    // non-null value (covers fresh logins after the splash launch event).
    useEffect(() => {
      if (!userId) {
        lastLoggedUserIdRef.current = null;
        return;
      }
      if (lastLoggedUserIdRef.current === userId) return;
      // Skip if this is the very first auth resolution at boot — the
      // app_launch event already captured device info; we still want a
      // dedicated "login" row though so admins can audit sign-ins.
      lastLoggedUserIdRef.current = userId;
      void logSession("login");
    }, [userId, logSession]);

    // Log a relaunch whenever the app comes back to the foreground.
    useEffect(() => {
      const sub = AppState.addEventListener(
        "change",
        (next: AppStateStatus) => {
          if (next === "active") {
            // Skip the very first "active" emit at boot (already handled by
            // the launch effect above).
            if (!launchLoggedRef.current) return;
            void logSession("app_relaunch");
          }
        }
      );
      return () => sub.remove();
    }, [logSession]);

    // Continuous foreground location tracking while signed in.
    // - Requests permission once.
    // - Uses `watchPositionAsync` so we capture every movement while the
    //   app is open (not just every 30s).
    // - Writes are throttled: at least every LOCATION_PING_MS, OR
    //   sooner if the user has moved LOCATION_DISTANCE_M meters.
    useEffect(() => {
      let cancelled = false;

      const stop = () => {
        if (locationTimerRef.current) {
          clearInterval(locationTimerRef.current);
          locationTimerRef.current = null;
        }
        if (locationWatchRef.current) {
          try {
            locationWatchRef.current.remove();
          } catch {}
          locationWatchRef.current = null;
        }
      };
      stop();
      if (!isAuthed) return;

      (async () => {
        try {
          let perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== "granted" && !permissionAskedRef.current) {
            permissionAskedRef.current = true;
            perm = await Location.requestForegroundPermissionsAsync();
          }
          if (perm.status !== "granted") {
            console.log("[session] foreground location permission denied");
            return;
          }
          if (cancelled) return;

          // Initial fix.
          void pingLocation();

          // Heartbeat — guarantees at least one write per 30s even if the
          // user is stationary (the watch only fires when position changes).
          const id = setInterval(() => {
            const since = Date.now() - lastWriteAtRef.current;
            if (since >= LOCATION_PING_MS) void pingLocation();
          }, LOCATION_PING_MS);
          locationTimerRef.current = id;

          // Movement-based stream.
          const sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: LOCATION_PING_MS,
              distanceInterval: LOCATION_DISTANCE_M,
            },
            (pos) => {
              // Throttle: skip if we just wrote one within 5s.
              if (Date.now() - lastWriteAtRef.current < 5_000) return;
              void writeLocationRow(pos);
            }
          );
          if (cancelled) {
            try {
              sub.remove();
            } catch {}
            return;
          }
          locationWatchRef.current = sub;
        } catch (e) {
          console.log("[session] watchPositionAsync threw", e);
        }
      })();

      return () => {
        cancelled = true;
        stop();
      };
    }, [isAuthed, pingLocation, writeLocationRow]);

    return { sessionId: sessionIdRef.current };
  }
);
