import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import createContextHook from "@nkzw/create-context-hook";
import { useAuth } from "@/contexts/AuthContext";
import {
  configureNotificationHandler,
  registerForPushNotificationsAsync,
} from "@/utils/pushNotifications";
import { savePushToken } from "@/utils/adminSync";

/**
 * Owns the device's push-notification lifecycle:
 *   * configures the foreground presentation handler at startup,
 *   * registers for an Expo push token once a profile is signed in and stores
 *     it (with the profile id) in `public.push_tokens`,
 *   * keeps in-app listeners for received notifications and taps.
 *
 * Everything here is best-effort and a no-op on web / simulators, so it never
 * blocks the rest of the app.
 */
export const [PushNotificationProvider, usePushNotifications] = createContextHook(() => {
  const { authState } = useAuth();
  const profileId: string | null = authState.userId ?? null;

  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [lastNotification, setLastNotification] =
    useState<Notifications.Notification | null>(null);

  // Avoid re-registering the same (profile, token) pair on every render.
  const registeredKeyRef = useRef<string | null>(null);

  // ---- Foreground handler + tap/receive listeners --------------------------
  useEffect(() => {
    if (Platform.OS === "web") return;
    configureNotificationHandler();

    const receivedSub = Notifications.addNotificationReceivedListener((n) => {
      setLastNotification(n);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        setLastNotification(response.notification);
        console.log(
          "[push] notification tapped",
          response.notification.request.content.title
        );
      }
    );

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  // ---- Register + persist the token whenever the signed-in profile changes --
  const register = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (!authState.isAuthenticated) return;

    const key = `${profileId ?? "anon"}`;
    if (registeredKeyRef.current === key && expoPushToken) return;

    const token = await registerForPushNotificationsAsync();
    if (!token) {
      setPermissionGranted(false);
      return;
    }
    setPermissionGranted(true);
    setExpoPushToken(token);
    registeredKeyRef.current = key;

    await savePushToken(
      token,
      profileId,
      Platform.OS,
      Device.deviceName ?? null
    );
  }, [authState.isAuthenticated, profileId, expoPushToken]);

  useEffect(() => {
    register().catch((e) => console.log("[push] register failed", e));
  }, [register]);

  return {
    expoPushToken,
    permissionGranted,
    lastNotification,
    /** Manually (re)trigger registration, e.g. from a settings screen. */
    register,
  };
});
