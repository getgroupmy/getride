import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import RideMap from "@/components/RideMap";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "@/contexts/LocationContext";
import { useColors } from "@/hooks/useColors";
import { readLaunchSession, resolveRootRedirect } from "@/utils/launchSession";

/**
 * Rider home.
 *
 * The map is the screen; everything else sits over it. It shows where the
 * rider is and offers the one action that starts a ride — choosing a
 * destination. Fare, vehicle class and payment are decided on the next screen,
 * once there is a route to price.
 */
export default function Home() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authState, isLoading: authLoading } = useAuth();
  const { coords, address, granted, isLoading, error, refresh } = useLocation();

  // An unauthenticated rider cannot create a request (RLS is uid-scoped), so
  // send them to sign-in rather than letting them build a ride they can't book.
  //
  // An authenticated cold start goes through the launch buffer instead, which
  // decides whether a ride in progress should be resumed. The guard lives in
  // `launchSession` rather than a ref here because this screen sits inside the
  // navigator: anything that resets navigation state re-renders it, and a ref
  // would read that as a fresh launch and re-enter the buffer forever.
  useEffect(() => {
    if (authLoading) return;
    if (!authState.isAuthenticated) {
      router.replace("/phone-auth");
      return;
    }
    const redirect = resolveRootRedirect(readLaunchSession());
    if (redirect) router.replace(redirect as never);
  }, [authLoading, authState.isAuthenticated]);

  if (authLoading || !authState.isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const openSearch = () => {
    router.push({
      pathname: "/search",
      params: coords
        ? {
            pickupLat: String(coords.latitude),
            pickupLng: String(coords.longitude),
            pickupName: address ?? "Current location",
          }
        : {},
    });
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <RideMap
        center={coords}
        markers={
          coords
            ? [{ id: "pickup", kind: "pickup", title: address ?? "Pickup", ...coords }]
            : []
        }
      />

      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
        <Text style={[styles.greeting, { color: colors.text }]}>
          {authState.profileName ? `Hi ${authState.profileName}` : "Where are you going?"}
        </Text>

        <View style={styles.pickupRow}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.pickup, { color: colors.textSecondary }]} numberOfLines={1}>
            {isLoading
              ? "Finding you…"
              : (address ?? (coords ? "Current location" : "Pickup not set"))}
          </Text>
        </View>

        {granted === false || error ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry locating me"
            onPress={() => void refresh()}
          >
            <Text style={[styles.error, { color: colors.error }]}>
              {error ?? "Location is off."} Tap to try again.
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a destination"
          onPress={openSearch}
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.ctaText, { color: colors.onAccent }]}>Where to?</Text>
        </Pressable>

        <View style={styles.quickRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open wallet"
            onPress={() => router.push("/wallet")}
            style={[styles.quick, { borderColor: colors.border }]}
          >
            <Text style={[styles.quickText, { color: colors.text }]}>Wallet</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open driver requests"
            onPress={() => router.push("/partner-ehailing")}
            style={[styles.quick, { borderColor: colors.border }]}
          >
            <Text style={[styles.quickText, { color: colors.text }]}>Drive</Text>
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          {[
            { label: "Support", to: "/support" },
            { label: "Invite", to: "/referral" },
            { label: "SOS contacts", to: "/emergency-contacts" },
          ].map((l) => (
            <Pressable
              key={l.to}
              accessibilityRole="button"
              accessibilityLabel={l.label}
              onPress={() => router.push(l.to as never)}
              style={[styles.quick, { borderColor: colors.border }]}
            >
              <Text style={[styles.quickText, { color: colors.text }]}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  greeting: { fontSize: 20, fontWeight: "700" },
  pickupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pickup: { fontSize: 14, flex: 1 },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
  quickRow: { flexDirection: "row", gap: 10 },
  quick: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  quickText: { fontSize: 15, fontWeight: "600" },
});
