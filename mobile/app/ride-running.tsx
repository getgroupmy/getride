import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import RideMap, { type RideMapMarker } from "@/components/RideMap";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  completeRideRequest,
  fetchRideRequest,
  publishLiveLocation,
  subscribeToRideRequest,
  updateRideRequestStatus,
  type RideRequest,
  type RideRequestStatus,
} from "@/utils/rideRequestsStore";
import { chargeRideCommission } from "@/utils/walletStore";

/** How often the driver's position is published onto the row. */
const LIVE_INTERVAL_MS = 5_000;

/** The one forward move available at each stage, in the driver's words. */
const NEXT_STEP: Partial<
  Record<RideRequestStatus, { label: string; to: RideRequestStatus }>
> = {
  accepted: { label: "I've arrived", to: "arrived" },
  arrived: { label: "Start trip", to: "on_trip" },
  on_trip: { label: "End trip", to: "completed" },
};

const STATUS_TITLE: Record<RideRequestStatus, string> = {
  open: "Waiting",
  accepted: "Head to pickup",
  arrived: "Waiting for passenger",
  on_trip: "On the trip",
  completed: "Trip complete",
  cancelled: "Cancelled",
  expired: "Expired",
};

export default function RideRunning() {
  const colors = useColors();
  const { authState } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [ride, setRide] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const chargedRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      const row = await fetchRideRequest(id);
      if (!cancelled) {
        setRide(row);
        setLoading(false);
      }
    })();

    const unsubscribe = subscribeToRideRequest(id, (row) => {
      if (!cancelled) setRide(row);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  // Publish position while the ride is live, so the passenger's map can follow.
  // Stops the moment the trip is no longer active — a finished ride must not
  // keep broadcasting where the driver is.
  const active = ride?.status === "accepted" || ride?.status === "arrived" || ride?.status === "on_trip";

  useEffect(() => {
    if (!id || !active) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        await publishLiveLocation(
          id,
          "partner",
          fix.coords.latitude,
          fix.coords.longitude,
          fix.coords.heading
        );
      } catch {
        // A missed position is not worth interrupting a trip over.
      }
    };

    void tick();
    const timer = setInterval(tick, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, active]);

  const advance = useCallback(async () => {
    if (!ride || !id || working) return;
    const step = NEXT_STEP[ride.status];
    if (!step) return;

    setWorking(true);
    try {
      if (step.to === "completed") {
        const ok = await completeRideRequest(id);
        if (!ok) {
          Alert.alert("Couldn't end the trip", "Please try again.");
          return;
        }

        // Commission is charged once, and only after the trip is completed.
        // The RPC is idempotent (stamped on the ride row), and this guard just
        // avoids a pointless second call within the screen's life.
        if (!chargedRef.current && authState.userId && (ride.fare ?? 0) > 0) {
          chargedRef.current = true;
          const res = await chargeRideCommission({
            partnerId: authState.userId,
            fareTotal: ride.fare!,
            rideRequestId: id,
          });
          if (!res.ok) {
            // A failed charge must not read as a failed trip — the fare is
            // collected either way and the ledger is reconciled server-side.
            console.log("[ride-running] commission charge failed:", res.error);
          }
        }
      } else {
        const ok = await updateRideRequestStatus(id, step.to);
        if (!ok) {
          Alert.alert("Couldn't update", "Please try again.");
          return;
        }
      }
    } finally {
      setWorking(false);
    }
  }, [ride, id, working, authState.userId]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>Ride not found</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to requests"
          onPress={() => router.replace("/partner-ehailing")}
        >
          <Text style={[styles.link, { color: colors.primary }]}>Back to requests</Text>
        </Pressable>
      </View>
    );
  }

  const step = NEXT_STEP[ride.status];
  const finished =
    ride.status === "completed" || ride.status === "cancelled" || ride.status === "expired";

  // Before pickup the driver is heading to the passenger; after it, to the drop.
  const heading = ride.status === "on_trip" ? "drop" : "pickup";
  const markers: RideMapMarker[] = [];
  if (ride.pickup_lat != null && ride.pickup_lng != null) {
    markers.push({
      id: "pickup",
      kind: "pickup",
      title: ride.pickup_name ?? "Pickup",
      latitude: ride.pickup_lat,
      longitude: ride.pickup_lng,
    });
  }
  if (ride.drop_lat != null && ride.drop_lng != null) {
    markers.push({
      id: "drop",
      kind: "drop",
      title: ride.drop_name ?? "Destination",
      latitude: ride.drop_lat,
      longitude: ride.drop_lng,
    });
  }

  const center =
    heading === "drop" && ride.drop_lat != null && ride.drop_lng != null
      ? { latitude: ride.drop_lat, longitude: ride.drop_lng }
      : ride.pickup_lat != null && ride.pickup_lng != null
        ? { latitude: ride.pickup_lat, longitude: ride.pickup_lng }
        : null;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <RideMap center={center} markers={markers} />

      <View style={[styles.sheet, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>{STATUS_TITLE[ride.status]}</Text>

        <View style={styles.leg}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
            {ride.pickup_name ?? "Pickup"}
          </Text>
        </View>
        <View style={styles.leg}>
          <View style={[styles.dot, { backgroundColor: colors.error }]} />
          <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
            {ride.drop_name ?? "Destination"}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {ride.rider_name ?? "Passenger"}
          </Text>
          <Text style={[styles.fare, { color: colors.text }]}>
            {ride.fare != null ? `RM ${ride.fare.toFixed(2)}` : "—"}
          </Text>
        </View>

        {finished ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to requests"
            onPress={() => router.replace("/partner-ehailing")}
            style={[styles.cta, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Back to requests</Text>
          </Pressable>
        ) : step ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={step.label}
            onPress={advance}
            disabled={working}
            style={[styles.cta, { backgroundColor: working ? colors.border : colors.primary }]}
          >
            {working ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.onAccent }]}>{step.label}</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    gap: 10,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 20, fontWeight: "700" },
  leg: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  place: { fontSize: 15, flex: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  meta: { fontSize: 14 },
  fare: { fontSize: 18, fontWeight: "800" },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 6 },
  ctaText: { fontSize: 16, fontWeight: "700" },
  link: { fontSize: 15 },
});
