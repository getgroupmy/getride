import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

/**
 * Push notification helpers (Expo push service).
 *
 * `registerForPushNotificationsAsync` requests OS permission, ensures the
 * Android notification channel exists, and returns the device's Expo push
 * token (e.g. `ExponentPushToken[...]`). It returns `null` — never throws —
 * when running on web, on a simulator, when permission is denied, or when the
 * project is not configured for push, so callers can treat it as best-effort.
 */

let handlerConfigured = false;

/**
 * Configure how notifications are presented while the app is foregrounded.
 * Idempotent — safe to call from multiple places.
 */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Resolve the EAS projectId required by getExpoPushTokenAsync. */
function getProjectId(): string | undefined {
  const fromExtra =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
  const fromEasConfig = (Constants as unknown as {
    easConfig?: { projectId?: string };
  }).easConfig?.projectId;
  return fromExtra ?? fromEasConfig;
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Expo push tokens are only meaningful on physical iOS/Android devices.
  if (Platform.OS === "web") return null;

  try {
    configureNotificationHandler();

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FFD400",
      });
    }

    if (!Device.isDevice) {
      console.log("[push] skipping token registration — not a physical device");
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      console.log("[push] notification permission not granted");
      return null;
    }

    const projectId = getProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenResponse.data ?? null;
  } catch (e) {
    console.log("[push] failed to register for push notifications", e);
    return null;
  }
}
