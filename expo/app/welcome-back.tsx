/**
 * Welcome-back — the launch buffer between sign-in and wherever the app opens.
 *
 * Every authenticated launch (a cold relaunch with a saved session, or the
 * instant sign-in finishes) is routed here first, instead of dropping the user
 * onto the passenger map and then jumping. The decisions a launch needs — is a
 * ride in progress, is this a TEKSI driver whose rate card opens the meter — are
 * async (a couple of Supabase reads and the cached rate cards), and doing them
 * on the map means the map renders and then yanks itself away. Here they happen
 * behind a short "Welcome back" instead, and the screen resolves straight to the
 * final destination with nothing drawn in between.
 *
 * The order it resolves in is a pure, tested rule (`resolveLaunchDestination`);
 * this screen only gathers the inputs and performs the `replace`. It decides
 * once per mount and never renders the app itself — it is a turnstile, not a
 * home.
 *
 * Nothing here may *block* the launch: the ride lookups are single rows, the
 * rate cards and geography are cached, and any failure falls through to the
 * ordinary home rather than stranding the user on a spinner. A legacy local-PIN
 * session (no Supabase `auth.uid()`) simply reads nothing and lands home, the
 * same way it sees no other partner-only surface.
 *
 * "Never blocks" is enforced rather than assumed, because a turnstile that does
 * not turn is the whole app hanging on a greeting. Two rules keep it honest:
 *
 *   * the decision is started once and is never cancelled by a re-render. It
 *     used to be started under a ref guard *and* cancelled by the effect's own
 *     cleanup, so any change to the effect's dependencies — an auth refresh
 *     landing mid-launch — tore down the in-flight lookups and then declined to
 *     start them again, leaving the spinner up forever;
 *   * a watchdog (`LAUNCH_DECISION_TIMEOUT_MS`) resolves the launch anyway. The
 *     lookups are network reads with no timeout of their own, so a request that
 *     never settles is a screen that never leaves. Whichever of the two gets
 *     there first navigates; `navigatedRef` makes sure only one of them does.
 */

import { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useResponsive } from "@/hooks/useResponsive";
import {
  fetchOngoingRequestForRider,
  fetchOngoingRequestForPartner,
} from "@/utils/rideRequestsStore";
import { buildRestoreTarget } from "@/utils/ongoingRequestRestore";
import { hasTeksiPartnerType, resolveMeterAutoLaunch } from "@/utils/meterAutoLaunch";
import { fetchMeterProfiles, readMeterGeo } from "@/utils/meterSettingsStore";
import { fetchPartnerForUser } from "@/utils/partnerOnboardingStore";
import { resolveLaunchDestination } from "@/utils/launchDestination";
import { markLaunchDestination, markLaunchHandled } from "@/utils/launchSession";
import { lockLandscape } from "@/utils/screenOrientation";

/**
 * How long the launch decision may take before the buffer gives up on it.
 *
 * Long enough for three or four Supabase round trips on a poor connection —
 * this is not a latency budget, it is the point past which the user is looking
 * at a stuck app. Whatever the lookups were going to say, the ordinary home is
 * a better answer than a spinner that never ends.
 */
const LAUNCH_DECISION_TIMEOUT_MS = 10000;

export default function WelcomeBackScreen() {
  const router = useRouter();
  const { authState } = useAuth();
  const { isTablet } = useResponsive();
  const branding = useBranding();
  /** The decision has been started. Never unset — it is started at most once. */
  const decidedRef = useRef(false);
  /** A `replace` has been issued. The first one wins; the rest are no-ops. */
  const navigatedRef = useRef(false);
  /** False once the buffer is gone, so a late answer never touches the router. */
  const mountedRef = useRef(true);

  const name = (authState.profileName ?? "").trim();
  const greeting = name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back";

  // The watchdog fires long after the render it was armed in, so it reads the
  // fallback off refs rather than off the values it closed over.
  const isTabletRef = useRef(isTablet);
  isTabletRef.current = isTablet;
  const authedRef = useRef(authState.isAuthenticated);
  authedRef.current = authState.isAuthenticated;

  /** Leave the buffer. Only the first call does anything. */
  const go = useCallback(
    (target: Parameters<typeof router.replace>[0]) => {
      if (navigatedRef.current || !mountedRef.current) return;
      navigatedRef.current = true;
      if (typeof target === "string") markLaunchDestination(target);
      router.replace(target);
    },
    [router],
  );

  useEffect(() => {
    // Entering the buffer *is* the launch being handled, whichever screen sent
    // us here — the sign-in screens replace into it directly, and without this
    // their arrival at home would read as a cold start and come straight back.
    markLaunchHandled();
    // Set here rather than only at declaration: a double-invoked effect (React
    // strict mode) runs the cleanup below between the two, and a `mountedRef`
    // that only ever goes false would wedge the buffer shut for good.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The watchdog. Armed once, on its own, so it survives every re-render of the
  // decision below and is never restarted by one.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (navigatedRef.current) return;
      console.log("[welcome-back] launch decision timed out — landing home");
      if (!authedRef.current) {
        go("/onboarding" as never);
        return;
      }
      go((isTabletRef.current ? "/partner-teksi" : "/") as never);
    }, LAUNCH_DECISION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [go]);

  useEffect(() => {
    if (decidedRef.current) return;
    const userId = authState.userId;
    if (!authState.isAuthenticated || !userId) {
      // Auth may still be settling on the way in from a sign-in screen. Wait
      // for it rather than bouncing to onboarding on a half-built session; the
      // watchdog is already armed if it never arrives.
      return;
    }
    // From here the decision runs to completion. Nothing below cancels it: a
    // dependency changing mid-flight must not be able to strand the launch.
    decidedRef.current = true;

    void (async () => {
      try {
        // 1. A rider's in-progress request wins outright.
        const ongoing = await fetchOngoingRequestForRider(userId);
        const riderTarget = ongoing ? buildRestoreTarget(ongoing) : null;

        // 2. Otherwise a partner's in-progress ride.
        let partnerResumeId: string | null = null;
        if (!riderTarget) {
          const partnerOngoing = await fetchOngoingRequestForPartner(userId);
          partnerResumeId = partnerOngoing?.id ?? null;
        }

        // 3. Otherwise the meter, but only for a TEKSI partner — a non-partner
        //    launch never pays for the rate-card fetch.
        let meterAutoLaunch = false;
        if (!riderTarget && !partnerResumeId) {
          const partner = await fetchPartnerForUser(userId);
          if (hasTeksiPartnerType(partner?.partner_types)) {
            const [{ profiles }, geo] = await Promise.all([
              fetchMeterProfiles(),
              readMeterGeo(),
            ]);
            meterAutoLaunch = resolveMeterAutoLaunch({
              profiles,
              partnerTypes: partner?.partner_types ?? null,
              geo,
            }).launch;
          }
        }

        const kind = resolveLaunchDestination({
          hasRiderRestore: !!riderTarget,
          hasPartnerRide: !!partnerResumeId,
          meterAutoLaunch,
          isTablet: isTabletRef.current,
        });
        console.log("[welcome-back] →", kind);

        // The console is landscape-only and it owns its own pin, but asking for
        // it here as well is worth the line: this screen is settled, whereas the
        // meter asks from inside a stack transition, and a rotation requested
        // mid-transition is the one iOS quietly drops. Asking from here means
        // the device is already turning as the console mounts, instead of the
        // driver watching a dark rectangle while it catches up. It is not
        // awaited on any other destination and never needs unwinding: the meter
        // re-asserts the lock on focus and hands it back on blur.
        if (kind === "meter") await lockLandscape();

        switch (kind) {
          case "ride-restore":
            go(riderTarget as never);
            break;
          case "partner-ride":
            go({
              pathname: "/partner-ehailing",
              params: { resumeRequestId: partnerResumeId as string },
            } as never);
            break;
          case "meter":
            go("/meter-digital" as never);
            break;
          case "partner-console":
            go("/partner-teksi" as never);
            break;
          default:
            go("/" as never);
        }
      } catch (e) {
        // The launch is never held hostage by this screen: on any failure the
        // user lands where they would have without it.
        console.log("[welcome-back] launch decision failed", e);
        go((isTabletRef.current ? "/partner-teksi" : "/") as never);
      }
    })();
    // No cleanup: the decision is deliberately not cancellable. It is started
    // at most once (`decidedRef`) and lands at most once (`navigatedRef`), so
    // re-running this effect can neither duplicate the launch nor abandon it.
  }, [authState.isAuthenticated, authState.userId, go]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: branding.splashBgColor || "#2dabe2" },
      ]}
      testID="welcome-back"
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {branding.splashImageUri ? (
        <Image
          source={{ uri: branding.splashImageUri }}
          style={styles.logo}
          contentFit="contain"
        />
      ) : null}
      <Text style={styles.greeting}>{greeting}</Text>
      <ActivityIndicator color="#fff" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: 12,
  },
  greeting: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  spinner: {
    marginTop: 20,
  },
});
