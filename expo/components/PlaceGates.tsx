import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { DoorOpen, Check } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const PLACES_KEY = "multi-gate-places" as const;
const AIRPORT_KEY = "airport-areas" as const;
const GATES_KEY = "multi-gate-place-gates" as const;

/** Maximum distance (km) for fuzzy coordinate match between a search result and an admin place. */
const MATCH_RADIUS_KM = 1.5;

const toNum = (v: number | string | undefined): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return n === undefined || !Number.isFinite(n as number) ? null : (n as number);
};

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type GateUsage = "pickup" | "drop";

export interface MatchedGate {
  id: string;
  name: string;
  lat: string;
  lon: string;
  mode: "both" | "pickup" | "drop";
}

export interface MatchedPlace {
  place: SettingEntry;
  gates: MatchedGate[];
  active: boolean;
  gateRequired: boolean;
}

/**
 * Returns the multi-gate place (and its assigned gates) that matches a coordinate,
 * or null if no admin-added place exists for the given lat/lon.
 */
export function useGatesForCoordinates(
  lat: number | string | undefined,
  lon: number | string | undefined,
  usage?: GateUsage,
  name?: string
): MatchedPlace | null {
  const { getEntries } = useAdminData();
  const places = getEntries(PLACES_KEY);
  const airports = getEntries(AIRPORT_KEY);
  const allGates = getEntries(GATES_KEY);

  return useMemo<MatchedPlace | null>(() => {
    const tLat = toNum(lat);
    const tLon = toNum(lon);
    const candidates: SettingEntry[] = [...places, ...airports];
    if (candidates.length === 0) return null;

    let place: SettingEntry | undefined;
    // 1) closest place within MATCH_RADIUS_KM
    if (tLat !== null && tLon !== null) {
      let bestKm = Number.POSITIVE_INFINITY;
      for (const p of candidates) {
        const pLat = toNum(p.values.lat as string | number | undefined);
        const pLon = toNum(p.values.lon as string | number | undefined);
        if (pLat === null || pLon === null) continue;
        const km = haversineKm(tLat, tLon, pLat, pLon);
        if (km < bestKm && km <= MATCH_RADIUS_KM) {
          bestKm = km;
          place = p;
        }
      }
    }
    // 2) name fallback when coords don't match
    if (!place && name && name.trim()) {
      const q = normalize(name);
      place = candidates.find((p) => {
        const pn = normalize(String(p.values.name ?? ""));
        if (!pn) return false;
        return pn === q || pn.includes(q) || q.includes(pn);
      });
    }
    if (!place) return null;
    const activeRaw = place.values.active;
    const active = activeRaw === undefined ? true : Boolean(activeRaw);
    if (!active) return null;
    const gateRequiredRaw = place.values.gateRequired;
    const gateRequired = gateRequiredRaw === undefined ? true : Boolean(gateRequiredRaw);
    const gates: MatchedGate[] = allGates
      .filter((g) => String(g.values.placeId ?? "") === place.id)
      .filter((g) => {
        const a = g.values.active;
        return a === undefined ? true : Boolean(a);
      })
      .filter((g) => {
        if (!usage) return true;
        const m = String(g.values.mode ?? "both");
        const mode = m === "pickup" || m === "drop" ? m : "both";
        return mode === "both" || mode === usage;
      })
      .sort((a, b) => {
        const pa = Number(a.values.displayPriority ?? 9999);
        const pb = Number(b.values.displayPriority ?? 9999);
        return pa - pb;
      })
      .map((g) => {
        const m = String(g.values.mode ?? "both");
        const mode: "both" | "pickup" | "drop" = m === "pickup" || m === "drop" ? m : "both";
        return {
          id: g.id,
          name: String(g.values.name ?? "Gate"),
          lat: String(g.values.lat ?? ""),
          lon: String(g.values.lon ?? ""),
          mode,
        };
      });
    return { place, gates, active, gateRequired };
  }, [lat, lon, name, places, airports, allGates, usage]);
}

interface PlaceGatesListProps {
  lat: number | string | undefined;
  lon: number | string | undefined;
  variant?: "light" | "dark";
  compact?: boolean;
  selectedGateId?: string | null;
  onSelectGate?: (gate: MatchedGate, place: MatchedPlace) => void;
  usage?: GateUsage;
  name?: string;
}

/**
 * Renders a compact list of gate chips for the place matching lat/lon, if any.
 * Shows nothing when the coordinate doesn't match any admin-added multi-gate place.
 */
export function PlaceGatesList({ lat, lon, variant = "light", compact, selectedGateId, onSelectGate, usage, name }: PlaceGatesListProps) {
  const Colors = useColors();
  const matched = useGatesForCoordinates(lat, lon, usage, name);
  if (!matched || matched.gates.length === 0) return null;

  const accent = Colors.accent;
  const dark = variant === "dark";
  const chipBg = dark ? accent + "33" : accent + "1A";
  const chipText = dark ? "#fff" : accent;
  const selectable = typeof onSelectGate === "function";

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID="place-gates-list">
      <View style={styles.chips}>
        {matched.gates.map((g) => {
          const isSelected = selectedGateId === g.id;
          const bg = isSelected ? accent : chipBg;
          const fg = isSelected ? "#fff" : chipText;
          if (selectable) {
            return (
              <TouchableOpacity
                key={g.id}
                activeOpacity={0.7}
                onPress={() => onSelectGate?.(g, matched)}
                style={[styles.chip, { backgroundColor: bg }]}
                testID={`gate-chip-${g.id}`}
              >
                {isSelected ? <Check color={fg} size={11} /> : <DoorOpen color={fg} size={11} />}
                <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
                  {g.name}
                </Text>
              </TouchableOpacity>
            );
          }
          return (
            <View key={g.id} style={[styles.chip, { backgroundColor: bg }]}>
              <DoorOpen color={fg} size={11} />
              <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
                {g.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    gap: 4,
  },
  wrapCompact: {
    marginTop: 4,
  },
  chips: {
    flexDirection: "column" as const,
    alignItems: "flex-start" as const,
    gap: 10,
  },
  chip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start" as const,
    maxWidth: "100%" as const,
  },
  chipText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
});

export default PlaceGatesList;
