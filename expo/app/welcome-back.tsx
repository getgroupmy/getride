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
 * The one place it pauses is the meter: a TEKSI driver auto-launched into the
 * taxi meter is first shown the vehicle picker, so a shift always opens on the
 * car it is being driven in. Picking a vehicle claims it (the same active-session
 * claim the Teksi screen makes) and then hands off to the meter with its plate;
 * dismissing the picker still opens the meter — the prompt lets the driver
 * choose, it does not trap them out of the console.
 *
 * Nothing here may *block* the launch: the ride lookups are single rows, the
 * rate cards and geography are cached, and any failure falls through to the
 * ordinary home rather than stranding the user on a spinner. A legacy local-PIN
 * session (no Supabase `auth.uid()`) simply reads nothing and lands home, the
 * same way it sees no other partner-only surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useResponsive } from "@/hooks/useResponsive";
import VehicleSelectModal from "@/components/VehicleSelectModal";
import {
  fetchOngoingRequestForRider,
  fetchOngoingRequestForPartner,
} from "@/utils/rideRequestsStore";
import { buildRestoreTarget } from "@/utils/ongoingRequestRestore";
import { hasTeksiPartnerType, resolveMeterAutoLaunch } from "@/utils/meterAutoLaunch";
import { fetchMeterProfiles, readMeterGeo } from "@/utils/meterSettingsStore";
import { fetchPartnerForUser } from "@/utils/partnerOnboardingStore";
import { resolveLaunchDestination } from "@/utils/launchDestination";
import {
  claimVehicle,
  fetchAssignableVehicles,
  type AssignableVehicle,
} from "@/utils/vehicleAssignmentStore";

export default function WelcomeBackScreen() {
  const router = useRouter();
  const { authState } = useAuth();
  const { isTablet } = useResponsive();
  const branding = useBranding();
  const decidedRef = useRef(false);
  const navigatedRef = useRef(false);

  // The meter path pauses here on the vehicle picker; every other path resolves
  // straight through without it ever being shown.
  const [vehiclePickerVisible, setVehiclePickerVisible] = useState(false);
  const [vehicles, setVehicles] = useState<AssignableVehicle[]>([]);
  const [vehiclesBusy, setVehiclesBusy] = useState(false);

  const name = (authState.profileName ?? "").trim();
  const greeting = name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back";

  /** Navigate exactly once — the modal handlers and the decision can't race. */
  const go = useCallback(
    (target: Parameters<typeof router.replace>[0]) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      router.replace(target);
    },
    [router],
  );

  /** Open the meter, carrying the chosen vehicle's plate onto the console. */
  const goMeter = useCallback(
    (plate?: string | null) => {
      go({
        pathname: "/meter-digital",
        params: {
          ...(plate ? { plate } : {}),
          ...(name ? { driver: name } : {}),
        },
      } as never);
    },
    [go, name],
  );

  useEffect(() => {
    if (decidedRef.current) return;
    decidedRef.current = true;

    let cancelled = false;

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
            // The meter opens on a vehicle: show the picker rather than
            // navigating, and let its handlers make the final hop.
            setVehiclePickerVisible(true);
            setVehiclesBusy(true);
            try {
              const list = await fetchAssignableVehicles(userId);
              if (!cancelled) setVehicles(list);
            } catch (e) {
              console.log("[welcome-back] vehicle load failed", e);
            } finally {
              if (!cancelled) setVehiclesBusy(false);
            }
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
  }, [authState.isAuthenticated, authState.userId, isTablet, go]);

  // --- Vehicle picker (meter path only) -------------------------------------

  const handleSelectVehicle = useCallback(
    async (row: AssignableVehicle) => {
      if (!row.selectable) return;
      const userId = authState.userId;
      if (userId) {
        setVehiclesBusy(true);
        const res = await claimVehicle(row.vehicle.id, userId);
        setVehiclesBusy(false);
        if (!res.ok) {
          const message =
            res.reason === "vehicle_in_use"
              ? "This vehicle is already being used by another driver. Please pick another one."
              : res.reason === "user_busy"
                ? "You're already driving another vehicle. Please go offline on that one first."
                : res.reason === "not_assigned"
                  ? "You're not assigned to this vehicle."
                  : "Couldn't select this vehicle. Please try again.";
          Alert.alert("Can't use this vehicle", message);
          // Refresh the list so its in-use markers reflect what just happened.
          try {
            const list = await fetchAssignableVehicles(userId);
            setVehicles(list);
          } catch {
            // Leave the current list up; the driver can retry or close.
          }
          return;
        }
      }
      setVehiclePickerVisible(false);
      goMeter(row.vehicle.plate);
    },
    [authState.userId, goMeter],
  );

  // Dismissing the picker still opens the meter — the prompt lets the driver
  // pick a vehicle, it does not gate the console behind one.
  const handleClosePicker = useCallback(() => {
    setVehiclePickerVisible(false);
    goMeter();
  }, [goMeter]);

  const handleAddNewVehicle = useCallback(() => {
    setVehiclePickerVisible(false);
    go({
      pathname: "/vehicle-onboarding",
      params: { partnerType: "teksi", addNew: "1" },
    } as never);
  }, [go]);

  const handleViewVehicleStatus = useCallback(
    (row: AssignableVehicle) => {
      setVehiclePickerVisible(false);
      const params: Record<string, string> = {
        partnerType: "teksi",
        vehicleId: row.vehicle.id,
      };
      if (row.incomplete) {
        params.resume = "1";
        params.role = row.role;
      } else {
        params.viewStatus = "1";
      }
      go({ pathname: "/vehicle-onboarding", params } as never);
    },
    [go],
  );

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

      <VehicleSelectModal
        visible={vehiclePickerVisible}
        loading={vehiclesBusy}
        vehicles={vehicles}
        serviceName="TEKSI"
        onClose={handleClosePicker}
        onSelect={handleSelectVehicle}
        onViewStatus={handleViewVehicleStatus}
        onAddNew={handleAddNewVehicle}
      />
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
