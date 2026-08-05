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
 */

import { useEffect, useRef } from "react";
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

export default function WelcomeBackScreen() {
  const router = useRouter();
  const { authState } = useAuth();
  const { isTablet } = useResponsive();
  const branding = useBranding();
  const decidedRef = useRef(false);

  const name = (authState.profileName ?? "").trim();
  const greeting = name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back";

  useEffect(() => {
    if (decidedRef.current) return;
    decidedRef.current = true;

    let cancelled = false;
    const go = (target: Parameters<typeof router.replace>[0]) => {
      if (!cancelled) router.replace(target);
    };

    void (async () => {
      const userId = authState.userId;
      if (!authState.isAuthenticated || !userId) {
        go("/onboarding" as never);
        return;
      }

      try {
        // 1. A rider's in-progress request wins outright.
        const ongoing = await fetchOngoingRequestForRider(userId);
        if (cancelled) return;
        const riderTarget = ongoing ? buildRestoreTarget(ongoing) : null;

        // 2. Otherwise a partner's in-progress ride.
        let partnerResumeId: string | null = null;
        if (!riderTarget) {
          const partnerOngoing = await fetchOngoingRequestForPartner(userId);
          if (cancelled) return;
          partnerResumeId = partnerOngoing?.id ?? null;
        }

        // 3. Otherwise the meter, but only for a TEKSI partner — a non-partner
        //    launch never pays for the rate-card fetch.
        let meterAutoLaunch = false;
        if (!riderTarget && !partnerResumeId) {
          const partner = await fetchPartnerForUser(userId);
          if (cancelled) return;
          if (hasTeksiPartnerType(partner?.partner_types)) {
            const [{ profiles }, geo] = await Promise.all([
              fetchMeterProfiles(),
              readMeterGeo(),
            ]);
            if (cancelled) return;
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
          isTablet,
        });
        console.log("[welcome-back] →", kind);

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
        go((isTablet ? "/partner-teksi" : "/") as never);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authState.isAuthenticated, authState.userId, isTablet, router]);

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
