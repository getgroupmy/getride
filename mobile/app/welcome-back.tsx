import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useResponsive } from "@/hooks/useResponsive";
import { resolveLaunchDestination } from "@/utils/launchDestination";
import {
  buildPartnerRestoreTarget,
  buildRestoreTarget,
} from "@/utils/ongoingRequestRestore";
import {
  fetchOngoingRequestForPartner,
  fetchOngoingRequestForRider,
} from "@/utils/rideRequestsStore";
import { markLaunchDestination, markLaunchHandled } from "@/utils/launchSession";
import { isUnlocked, shouldRequirePin } from "@/utils/appLock";

/**
 * Launch buffer.
 *
 * Every authenticated launch comes through here rather than dropping straight
 * onto the map, so a rider mid-request or a driver mid-ride is put back where
 * they were instead of watching the home map render on the way to somewhere
 * else. The priority between destinations is `resolveLaunchDestination` —
 * pure and tested — and this screen only gathers its inputs and navigates.
 *
 * Two failure modes are designed for rather than assumed away:
 *
 * - The decision is started at most once and lands at most once, but is never
 *   cancelled. An auth refresh landing mid-launch must not abandon the lookups
 *   and leave the spinner up forever.
 * - The lookups are network reads with no timeout of their own, so a watchdog
 *   resolves the launch anyway. A greeting is never where the app comes to
 *   rest.
 */

/** Resolve the launch regardless, if the lookups have not come back. */
const LAUNCH_TIMEOUT_MS = 10_000;

export default function WelcomeBack() {
  const colors = useColors();
  const { authState, isLoading } = useAuth();
  const { isTablet } = useResponsive();

  const decidedRef = useRef(false);
  const navigatedRef = useRef(false);

  // Mark the launch handled the moment the buffer mounts, not when it leaves:
  // sign-in screens replace into here directly, and `index` re-enters the
  // buffer while the flag is unset — which would be a loop parked on a
  // greeting.
  useEffect(() => {
    markLaunchHandled();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const go = (pathname: string, params?: Record<string, string>) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      // Remember where the launch landed, so a navigation-state reset restores
      // the driver's screen instead of silently demoting them to the map.
      markLaunchDestination(pathname);
      router.replace(params ? { pathname: pathname as never, params } : (pathname as never));
    };

    if (!authState.isAuthenticated) {
      go("/phone-auth");
      return;
    }

    // Hold at the lock before resolving a destination. The profile carries
    // `hasPin`, so waiting for it is what stops a slow lookup waving a locked
    // account straight through to a signed-in wallet.
    if (!authState.profileLoaded) return;
    if (
      shouldRequirePin({
        isAuthenticated: authState.isAuthenticated,
        hasPin: authState.hasPin,
        unlocked: isUnlocked(),
      })
    ) {
      go("/pin-verify");
      return;
    }

    if (decidedRef.current) return;
    decidedRef.current = true;

    const watchdog = setTimeout(() => go("/"), LAUNCH_TIMEOUT_MS);

    void (async () => {
      try {
        const userId = authState.userId;
        const [riderRow, partnerRow] = await Promise.all([
          userId ? fetchOngoingRequestForRider(userId).catch(() => null) : null,
          userId ? fetchOngoingRequestForPartner(userId).catch(() => null) : null,
        ]);

        const riderTarget = riderRow ? buildRestoreTarget(riderRow) : null;
        const partnerTarget = partnerRow ? buildPartnerRestoreTarget(partnerRow) : null;

        const kind = resolveLaunchDestination({
          hasRiderRestore: !!riderTarget,
          hasPartnerRide: !!partnerTarget,
          // The meter arrives with the instruments phase; until then no rate
          // card can claim the launch.
          meterAutoLaunch: false,
          isTablet,
        });

        switch (kind) {
          case "ride-restore":
            go(riderTarget!.pathname, riderTarget!.params);
            break;
          case "partner-ride":
            go(partnerTarget!.pathname, partnerTarget!.params);
            break;
          case "partner-console":
            go("/partner-ehailing");
            break;
          default:
            go("/");
        }
      } catch {
        go("/");
      } finally {
        clearTimeout(watchdog);
      }
    })();

    return () => clearTimeout(watchdog);
  }, [
    isLoading,
    authState.isAuthenticated,
    authState.userId,
    authState.profileLoaded,
    authState.hasPin,
    isTablet,
  ]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>Welcome back</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  text: { fontSize: 16 },
});
