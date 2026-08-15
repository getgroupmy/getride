import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useIsPartner } from "@/hooks/useIsPartner";
import {
  acceptRideRequest,
  fetchOpenRequests,
  isPermissionDeniedError,
  REQUEST_EXPIRY_MS,
  RIDE_SIGN_IN_MESSAGE,
  subscribeToOpenRequests,
  type RideRequest,
} from "@/utils/rideRequestsStore";

/** Age past which an open request is no longer worth showing a driver. */
function isStale(row: RideRequest, now: number): boolean {
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) && now - created > REQUEST_EXPIRY_MS;
}

export default function PartnerEhailing() {
  const { ready } = useRequireAuth();
  const colors = useColors();
  const { authState } = useAuth();
  const { coords } = useLocation();
  const { isPartner, partner, loading: partnerLoading } = useIsPartner();

  const [rows, setRows] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const open = await fetchOpenRequests();
    setRows(open);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow the queue live. A request claimed by another driver stops being
  // 'open', and since 0069 this partner no longer receives its UPDATE at all —
  // so entries also age out on the clock below rather than relying on events.
  useEffect(() => {
    const unsubscribe = subscribeToOpenRequests((row, event) => {
      setRows((prev) => {
        if (event === "DELETE" || row.status !== "open") {
          return prev.filter((r) => r.id !== row.id);
        }
        const idx = prev.findIndex((r) => r.id === row.id);
        if (idx === -1) return [row, ...prev];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // One clock drives expiry, rather than a timer per card.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const live = useMemo(() => rows.filter((r) => !isStale(r, now)), [rows, now]);

  const accept = async (row: RideRequest) => {
    if (accepting) return;
    setAccepting(row.id);
    try {
      const claimed = await acceptRideRequest(row.id, {
        partnerId: authState.userId,
        partnerName: partner?.name ?? authState.profileName,
        partnerPhone: partner?.phone ?? authState.phone,
        partnerPhoto: partner?.avatar_url ?? null,
        acceptLat: coords?.latitude ?? null,
        acceptLng: coords?.longitude ?? null,
      });
      if (!claimed) {
        // The status='open' guard makes losing the race safe: it means another
        // driver got there first, not that anything went wrong.
        Alert.alert("Already taken", "Another driver accepted that one first.");
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        return;
      }
      router.replace({ pathname: "/ride-running", params: { id: claimed.id } });
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        Alert.alert("Sign in needed", RIDE_SIGN_IN_MESSAGE);
        return;
      }
      Alert.alert("Couldn't accept", "Please try again.");
    } finally {
      setAccepting(null);
    }
  };


  // A deep link can mount this route without passing through the launch
  // buffer, so the screen answers for its own access.
  if (!ready) return null;
  if (partnerLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!isPartner) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>Not set up to drive yet</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Finish partner onboarding to start receiving requests.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start partner onboarding"
          onPress={() => router.push("/partner-onboarding")}
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.ctaText, { color: colors.onAccent }]}>Get set up</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <FlatList
        data={live}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.leg}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
                {item.pickup_name ?? "Pickup"}
              </Text>
            </View>
            <View style={styles.leg}>
              <View style={[styles.dot, { backgroundColor: colors.error }]} />
              <Text style={[styles.place, { color: colors.text }]} numberOfLines={1}>
                {item.drop_name ?? "Destination"}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {item.distance_km != null ? `${item.distance_km.toFixed(1)} km` : "—"}
                {item.duration_min != null ? ` · ${Math.round(item.duration_min)} min` : ""}
              </Text>
              <Text style={[styles.fare, { color: colors.text }]}>
                {item.fare != null ? `RM ${item.fare.toFixed(2)}` : "—"}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Accept ride to ${item.drop_name ?? "destination"}`}
              onPress={() => accept(item)}
              disabled={accepting != null}
              style={[
                styles.accept,
                { backgroundColor: accepting ? colors.border : colors.primary },
              ]}
            >
              {accepting === item.id ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={[styles.ctaText, { color: colors.onAccent }]}>Accept</Text>
              )}
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.title, { color: colors.text }]}>No requests right now</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              New ones appear here as riders book.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  list: { padding: 16 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 10 },
  leg: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  place: { fontSize: 15, fontWeight: "600", flex: 1 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meta: { fontSize: 13 },
  fare: { fontSize: 18, fontWeight: "800" },
  accept: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  ctaText: { fontSize: 15, fontWeight: "700" },
  empty: { padding: 40, alignItems: "center", gap: 6 },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center" },
  cta: { borderRadius: 12, paddingVertical: 15, paddingHorizontal: 28, alignItems: "center", marginTop: 8 },
});
