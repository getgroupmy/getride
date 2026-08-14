import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLocation } from "@/contexts/LocationContext";
import { searchPlaces, type PlaceResult } from "@/utils/placeSearch";

/** Wait for a pause in typing before searching, so each keystroke isn't a request. */
const DEBOUNCE_MS = 350;

export default function Search() {
  const colors = useColors();
  const { coords } = useLocation();
  const params = useLocalSearchParams<{
    pickupLat: string;
    pickupLng: string;
    pickupName: string;
  }>();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      // Drop the previous lookup — its answer is for a query the rider has
      // already typed past.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const found = await searchPlaces(trimmed, { near: coords, signal: controller.signal });
      if (!controller.signal.aborted) {
        setResults(found);
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, coords]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = (place: PlaceResult) => {
    router.push({
      pathname: "/ride-confirm",
      params: {
        pickupLat: params.pickupLat,
        pickupLng: params.pickupLng,
        pickupName: params.pickupName,
        dropLat: String(place.latitude),
        dropLng: String(place.longitude),
        dropName: place.name,
        dropAddress: place.address,
      },
    });
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TextInput
          accessibilityLabel="Search for a destination"
          value={query}
          onChangeText={setQuery}
          placeholder="Where to?"
          placeholderTextColor={colors.subtext}
          autoFocus
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choose ${item.name}`}
            onPress={() => choose(item)}
            style={styles.row}
          >
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.address, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.address}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {searching ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.subtext }]}>
                {query.trim().length < 2
                  ? "Type at least two letters."
                  : "No places matched that."}
              </Text>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { padding: 16 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  row: { paddingHorizontal: 16, paddingVertical: 14, gap: 2 },
  name: { fontSize: 16, fontWeight: "600" },
  address: { fontSize: 13 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { fontSize: 14 },
});
