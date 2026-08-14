import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import RideMap, { type RideMapMarker } from "@/components/RideMap";
import { useColors } from "@/hooks/useColors";
import {
  cancelRideRequest,
  fetchRideRequest,
  subscribeToRideRequest,
  type RideRequest,
  type RideRequestStatus,
} from "@/utils/rideRequestsStore";

/** What the rider is told at each stage, in their words rather than the schema's. */
const STATUS_COPY: Record<RideRequestStatus, { title: string; detail: string }> = {
  open: { title: "Finding you a driver", detail: "We're asking nearby drivers now." },
  accepted: { title: "Driver on the way", detail: "They're heading to your pickup." },
  arrived: { title: "Your driver is here", detail: "Look for them at the pickup point." },
  on_trip: { title: "On the way", detail: "Enjoy the ride." },
  completed: { title: "You've arrived", detail: "Thanks for riding with us." },
  cancelled: { title: "Ride cancelled", detail: "This trip was cancelled." },
  expired: { title: "No driver found", detail: "Nobody picked this up in time." },
};

/** Stages where the rider may still call it off without asking the driver. */
const CANCELLABLE: RideRequestStatus[] = ["open", "accepted", "arrived"];

export default function RideTracking() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [ride, setRide] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Load once, then follow the row. The initial fetch matters because a status
  // that changed between booking and this screen mounting produces no realtime
  // event to catch up from.
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

  const onCancel = useCallback(() => {
    if (!id || cancelling) return;
    Alert.alert("Cancel this ride?", "Your driver will be told.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel ride",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          const ok = await cancelRideRequest(id, "Cancelled by rider");
          setCancelling(false);
          if (!ok) Alert.alert("Couldn't cancel", "Please try again.");
        },
      },
    ]);
  }, [id, cancelling]);

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
          accessibilityLabel="Back to home"
          onPress={() => router.replace("/")}
        >
          <Text style={[styles.link, { color: colors.primary }]}>Back to home</Text>
        </Pressable>
      </View>
    );
  }

  const copy = STATUS_COPY[ride.status];
  const finished =
    ride.status === "completed" || ride.status === "cancelled" || ride.status === "expired";

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
  // The driver's live position, published onto the row during an active ride.
  if (ride.partner_live_lat != null && ride.partner_live_lng != null) {
    markers.push({
      id: "driver",
      kind: "driver",
      title: ride.partner_name ?? "Driver",
      latitude: ride.partner_live_lat,
      longitude: ride.partner_live_lng,
    });
  }

  const center =
    ride.partner_live_lat != null && ride.partner_live_lng != null
      ? { latitude: ride.partner_live_lat, longitude: ride.partner_live_lng }
      : ride.pickup_lat != null && ride.pickup_lng != null
        ? { latitude: ride.pickup_lat, longitude: ride.pickup_lng }
        : null;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <RideMap center={center} markers={markers} />

      <View style={[styles.sheet, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>{copy.title}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>{copy.detail}</Text>

        {ride.partner_name ? (
          <View style={[styles.driver, { borderColor: colors.border }]}>
            <Text style={[styles.driverName, { color: colors.text }]}>{ride.partner_name}</Text>
            <Text style={[styles.driverMeta, { color: colors.textSecondary }]}>
              {[ride.partner_vehicle, ride.partner_plate].filter(Boolean).join(" · ") ||
                "Vehicle details to follow"}
            </Text>
          </View>
        ) : null}

        {ride.otp && ride.status !== "open" ? (
          <View style={styles.otpRow}>
            <Text style={[styles.driverMeta, { color: colors.textSecondary }]}>Trip PIN</Text>
            <Text style={[styles.otp, { color: colors.text }]}>{ride.otp}</Text>
          </View>
        ) : null}

        {ride.fare != null ? (
          <View style={styles.otpRow}>
            <Text style={[styles.driverMeta, { color: colors.textSecondary }]}>Fare</Text>
            <Text style={[styles.fare, { color: colors.text }]}>RM {ride.fare.toFixed(2)}</Text>
          </View>
        ) : null}

        {finished ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => router.replace("/")}
            style={[styles.cta, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Done</Text>
          </Pressable>
        ) : CANCELLABLE.includes(ride.status) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel ride"
            onPress={onCancel}
            disabled={cancelling}
            style={[styles.cta, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
          >
            {cancelling ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.error }]}>Cancel ride</Text>
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
    gap: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 20, fontWeight: "700" },
  detail: { fontSize: 14 },
  driver: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 4 },
  driverName: { fontSize: 16, fontWeight: "600" },
  driverMeta: { fontSize: 13 },
  otpRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  otp: { fontSize: 18, fontWeight: "800", letterSpacing: 3 },
  fare: { fontSize: 18, fontWeight: "800" },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
  link: { fontSize: 15 },
});
