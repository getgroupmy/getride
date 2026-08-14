import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import RideMap, { type LatLng } from "@/components/RideMap";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { calculateFare, calculateRoute } from "@/utils/maps";
import {
  createRideRequest,
  isPermissionDeniedError,
  notifyPartnersOfNewRequest,
  RIDE_SIGN_IN_MESSAGE,
} from "@/utils/rideRequestsStore";

interface Estimate {
  distanceKm: number;
  durationMin: number;
  fare: number;
  route: LatLng[];
}

const num = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Price the trip, then book it.
 *
 * The fare comes from `calculateFare` — the same tested TEKSI arithmetic the
 * meter uses — rather than a second implementation, so a quoted fare and a
 * metered one cannot drift apart.
 */
export default function RideConfirm() {
  const colors = useColors();
  const { authState } = useAuth();
  const p = useLocalSearchParams<{
    pickupLat: string;
    pickupLng: string;
    pickupName: string;
    dropLat: string;
    dropLng: string;
    dropName: string;
    dropAddress: string;
  }>();

  const pickup =
    num(p.pickupLat) != null && num(p.pickupLng) != null
      ? { latitude: num(p.pickupLat)!, longitude: num(p.pickupLng)! }
      : null;
  const drop =
    num(p.dropLat) != null && num(p.dropLng) != null
      ? { latitude: num(p.dropLat)!, longitude: num(p.dropLng)! }
      : null;

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [pricing, setPricing] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = useCallback(async () => {
    if (!pickup || !drop) {
      setPricing(false);
      setError("That trip is missing a pickup or a destination.");
      return;
    }
    setPricing(true);
    setError(null);
    try {
      const route = await calculateRoute(pickup, drop);
      if (!route) {
        setError("We couldn't find a route for that trip.");
        setEstimate(null);
        return;
      }
      const distanceKm = route.distance / 1000;
      const durationMin = route.duration / 60;
      setEstimate({
        distanceKm,
        durationMin,
        fare: calculateFare(distanceKm, durationMin),
        // calculateRoute already returns decoded coordinates.
        route: route.coordinates?.length ? route.coordinates : [pickup, drop],
      });
    } catch {
      setError("We couldn't work out a fare just now.");
    } finally {
      setPricing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pickupLat, p.pickupLng, p.dropLat, p.dropLng]);

  useEffect(() => {
    void price();
  }, [price]);

  const book = async () => {
    if (!estimate || !pickup || !drop || booking) return;
    setBooking(true);
    setError(null);
    try {
      const created = await createRideRequest({
        riderId: authState.userId,
        riderName: authState.profileName,
        riderPhone: authState.phone,
        pickupName: p.pickupName ?? "Pickup",
        pickupAddress: p.pickupName ?? null,
        pickupLat: pickup.latitude,
        pickupLng: pickup.longitude,
        dropName: p.dropName ?? "Destination",
        dropAddress: p.dropAddress ?? null,
        dropLat: drop.latitude,
        dropLng: drop.longitude,
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        fare: estimate.fare,
        rideFare: estimate.fare,
        userAcceptLat: pickup.latitude,
        userAcceptLng: pickup.longitude,
      });

      if (!created) {
        setError("We couldn't send that request. Please try again.");
        setBooking(false);
        return;
      }

      // Best effort: the database trigger also notifies partners, so a failure
      // here must not block a request that has already been created.
      void notifyPartnersOfNewRequest(created).catch(() => {});

      router.replace({ pathname: "/ride-tracking", params: { id: created.id } });
    } catch (e) {
      setBooking(false);
      if (isPermissionDeniedError(e)) {
        Alert.alert("Sign in needed", RIDE_SIGN_IN_MESSAGE);
        return;
      }
      setError(e instanceof Error ? e.message : "We couldn't send that request.");
    }
  };

  const money = (v: number) => `RM ${v.toFixed(2)}`;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <RideMap
        center={pickup}
        route={estimate?.route}
        markers={[
          ...(pickup
            ? [{ id: "p", kind: "pickup" as const, title: p.pickupName, ...pickup }]
            : []),
          ...(drop ? [{ id: "d", kind: "drop" as const, title: p.dropName, ...drop }] : []),
        ]}
      />

      <ScrollView
        style={[styles.sheet, { backgroundColor: colors.card }]}
        contentContainerStyle={styles.sheetContent}
      >
        <Text style={[styles.heading, { color: colors.text }]} numberOfLines={1}>
          {p.dropName ?? "Your trip"}
        </Text>
        {p.dropAddress ? (
          <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={2}>
            {p.dropAddress}
          </Text>
        ) : null}

        {pricing ? (
          <View style={styles.pricing}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.sub, { color: colors.textSecondary }]}>Working out the fare…</Text>
          </View>
        ) : estimate ? (
          <View style={[styles.quote, { borderColor: colors.border }]}>
            <View style={styles.quoteRow}>
              <Text style={[styles.quoteLabel, { color: colors.textSecondary }]}>Distance</Text>
              <Text style={[styles.quoteValue, { color: colors.text }]}>
                {estimate.distanceKm.toFixed(1)} km
              </Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={[styles.quoteLabel, { color: colors.textSecondary }]}>Time</Text>
              <Text style={[styles.quoteValue, { color: colors.text }]}>
                {Math.round(estimate.durationMin)} min
              </Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={[styles.fareLabel, { color: colors.text }]}>Fare</Text>
              <Text style={[styles.fareValue, { color: colors.text }]}>
                {money(estimate.fare)}
              </Text>
            </View>
          </View>
        ) : null}

        {error ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={() => void price()}>
            <Text style={[styles.error, { color: colors.error }]}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request this ride"
          onPress={book}
          disabled={!estimate || booking}
          style={[
            styles.cta,
            { backgroundColor: estimate && !booking ? colors.primary : colors.border },
          ]}
        >
          {booking ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>
              {estimate ? `Request for ${money(estimate.fare)}` : "Request ride"}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "62%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetContent: { padding: 20, gap: 12, paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: "700" },
  sub: { fontSize: 14 },
  pricing: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  quote: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 10 },
  quoteRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  quoteLabel: { fontSize: 14 },
  quoteValue: { fontSize: 14, fontWeight: "600" },
  fareLabel: { fontSize: 16, fontWeight: "700" },
  fareValue: { fontSize: 20, fontWeight: "800" },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
