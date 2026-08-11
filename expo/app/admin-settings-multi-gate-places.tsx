import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Inbox,
  Save,
  Building2,
  MapPin,
  DoorOpen,
  Loader,
  CheckCircle2,
  Settings2,
  Power,
  ShieldCheck,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import { GOOGLE_PLACES_KEY } from "@/constants/googleKeys";
import { runWithMappingRotation, type MappingCallContext } from "@/utils/mappingClient";

const STORAGE_KEY = "multi-gate-places" as const;
const PAGE_ID = "multi-gate-places" as const;

interface PlaceForm {
  name: string;
  gates: string;
  address: string;
  lat: string;
  lon: string;
  gateRequired: boolean;
  active: boolean;
}

interface OsmResult {
  id: string;
  name: string;
  address: string;
  lat: string;
  lon: string;
  type: string;
  source: "osm" | "google" | "mapbox" | "geoapify" | "locationiq" | "opencage" | "here" | "tomtom" | "foursquare" | "assigned";
}

async function searchWithAssigned(q: string, ctx: MappingCallContext): Promise<{ ok: boolean; value: OsmResult[] }> {
  const enc = encodeURIComponent(q);
  const slug = `${ctx.providerSlug}:${ctx.serviceSlug}`;
  try {
    if (ctx.providerSlug === "google") {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${enc}&key=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { status?: string; results?: Array<{ place_id: string; name: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } }; types?: string[] }> };
      const ok = r.status === "OK" || r.status === "ZERO_RESULTS";
      const items: OsmResult[] = (r.results ?? []).map((p) => ({
        id: `google-${p.place_id}`,
        name: p.name,
        address: p.formatted_address ?? p.name,
        lat: String(p.geometry?.location?.lat ?? ""),
        lon: String(p.geometry?.location?.lng ?? ""),
        type: (p.types && p.types[0]) || "place",
        source: "google" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok, value: items };
    }
    if (ctx.providerSlug === "openstreetmap") {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=12&q=${enc}`;
      const r = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } }).then((x) => x.json()) as Array<{ place_id: number; display_name: string; lat: string; lon: string; name?: string; type?: string; class?: string; address?: Record<string, string> }>;
      const items: OsmResult[] = (Array.isArray(r) ? r : []).map((d) => {
        const addr = d.address ?? {};
        const primary = d.name || addr.attraction || addr.building || addr.amenity || addr.tourism || addr.shop || d.display_name.split(",")[0];
        return {
          id: `osm-${d.place_id}`,
          name: primary,
          address: d.display_name,
          lat: d.lat,
          lon: d.lon,
          type: d.type ?? d.class ?? "place",
          source: "osm" as const,
        };
      });
      return { ok: true, value: items };
    }
    if (ctx.providerSlug === "mapbox") {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${enc}.json?limit=10&access_token=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { features?: Array<{ id: string; text: string; place_name: string; center: [number, number]; place_type?: string[] }> };
      const items: OsmResult[] = (r.features ?? []).map((f) => ({
        id: `mapbox-${f.id}`,
        name: f.text,
        address: f.place_name,
        lat: String(f.center?.[1] ?? ""),
        lon: String(f.center?.[0] ?? ""),
        type: (f.place_type && f.place_type[0]) || "place",
        source: "mapbox" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok: Array.isArray(r.features), value: items };
    }
    if (ctx.providerSlug === "geocoding" && ctx.serviceSlug === "geoapify") {
      const url = `https://api.geoapify.com/v1/geocode/search?text=${enc}&limit=12&apiKey=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { features?: Array<{ properties: { place_id?: string; name?: string; formatted: string; lat: number; lon: number; result_type?: string } }> };
      const items: OsmResult[] = (r.features ?? []).map((f, i) => ({
        id: `geoapify-${f.properties.place_id ?? i}`,
        name: f.properties.name || f.properties.formatted.split(",")[0],
        address: f.properties.formatted,
        lat: String(f.properties.lat),
        lon: String(f.properties.lon),
        type: f.properties.result_type ?? "place",
        source: "geoapify" as const,
      }));
      return { ok: Array.isArray(r.features), value: items };
    }
    if (ctx.providerSlug === "geocoding" && ctx.serviceSlug === "locationiq") {
      const url = `https://us1.locationiq.com/v1/search?key=${ctx.key}&q=${enc}&format=json&limit=12&addressdetails=1`;
      const r = await fetch(url).then((x) => x.json()) as Array<{ place_id: string; display_name: string; lat: string; lon: string; type?: string }>;
      const items: OsmResult[] = (Array.isArray(r) ? r : []).map((d) => ({
        id: `locationiq-${d.place_id}`,
        name: d.display_name.split(",")[0],
        address: d.display_name,
        lat: d.lat,
        lon: d.lon,
        type: d.type ?? "place",
        source: "locationiq" as const,
      }));
      return { ok: Array.isArray(r), value: items };
    }
    if (ctx.providerSlug === "geocoding" && ctx.serviceSlug === "opencage") {
      const url = `https://api.opencagedata.com/geocode/v1/json?q=${enc}&key=${ctx.key}&limit=12`;
      const r = await fetch(url).then((x) => x.json()) as { status?: { code: number }; results?: Array<{ formatted: string; geometry: { lat: number; lng: number }; components?: { _type?: string } }> };
      const items: OsmResult[] = (r.results ?? []).map((d, i) => ({
        id: `opencage-${i}`,
        name: d.formatted.split(",")[0],
        address: d.formatted,
        lat: String(d.geometry.lat),
        lon: String(d.geometry.lng),
        type: d.components?._type ?? "place",
        source: "opencage" as const,
      }));
      return { ok: r.status?.code === 200, value: items };
    }
    if (ctx.providerSlug === "here") {
      const url = `https://discover.search.hereapi.com/v1/discover?q=${enc}&at=0,0&limit=12&apiKey=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { items?: Array<{ id: string; title: string; address?: { label: string }; position?: { lat: number; lng: number }; resultType?: string }> };
      const items: OsmResult[] = (r.items ?? []).map((d) => ({
        id: `here-${d.id}`,
        name: d.title,
        address: d.address?.label ?? d.title,
        lat: String(d.position?.lat ?? ""),
        lon: String(d.position?.lng ?? ""),
        type: d.resultType ?? "place",
        source: "here" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok: Array.isArray(r.items), value: items };
    }
    if (ctx.providerSlug === "tomtom") {
      const url = `https://api.tomtom.com/search/2/search/${enc}.json?limit=12&key=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { results?: Array<{ id: string; poi?: { name: string }; address?: { freeformAddress: string }; position?: { lat: number; lon: number }; type?: string }> };
      const items: OsmResult[] = (r.results ?? []).map((d) => ({
        id: `tomtom-${d.id}`,
        name: d.poi?.name ?? d.address?.freeformAddress ?? "Place",
        address: d.address?.freeformAddress ?? "",
        lat: String(d.position?.lat ?? ""),
        lon: String(d.position?.lon ?? ""),
        type: d.type ?? "place",
        source: "tomtom" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok: Array.isArray(r.results), value: items };
    }
    if (ctx.providerSlug === "places" && ctx.serviceSlug === "foursquare") {
      const url = `https://api.foursquare.com/v3/places/search?query=${enc}&limit=12`;
      const r = await fetch(url, { headers: { Authorization: ctx.key, Accept: "application/json" } }).then((x) => x.json()) as { results?: Array<{ fsq_id: string; name: string; location?: { formatted_address?: string }; geocodes?: { main?: { latitude: number; longitude: number } }; categories?: Array<{ name: string }> }> };
      const items: OsmResult[] = (r.results ?? []).map((d) => ({
        id: `fsq-${d.fsq_id}`,
        name: d.name,
        address: d.location?.formatted_address ?? d.name,
        lat: String(d.geocodes?.main?.latitude ?? ""),
        lon: String(d.geocodes?.main?.longitude ?? ""),
        type: d.categories?.[0]?.name ?? "place",
        source: "foursquare" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok: Array.isArray(r.results), value: items };
    }
    console.log("[multi-gate] unsupported provider:service", slug);
    return { ok: false, value: [] };
  } catch (e) {
    console.log("[multi-gate] assigned search error", slug, e);
    return { ok: false, value: [] };
  }
}

const EMPTY_FORM: PlaceForm = { name: "", gates: "", address: "", lat: "", lon: "", gateRequired: true, active: true };

function sourceLabel(source: OsmResult["source"]): string {
  switch (source) {
    case "google": return "Google";
    case "osm": return "OSM";
    case "mapbox": return "Mapbox";
    case "geoapify": return "Geoapify";
    case "locationiq": return "LocationIQ";
    case "opencage": return "OpenCage";
    case "here": return "HERE";
    case "tomtom": return "TomTom";
    case "foursquare": return "Foursquare";
    default: return "Assigned";
  }
}

export default function AdminSettingsMultiGatePlacesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<OsmResult[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string>("");

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<PlaceForm>(EMPTY_FORM);

  const cancelRef = useRef<boolean>(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    cancelRef.current = false;
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(async () => {
      try {
        const fallback = async (): Promise<OsmResult[]> => {
          const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=12&q=${encodeURIComponent(q)}`;
          const googleUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${GOOGLE_PLACES_KEY}`;
          const [osmRes, googleRes] = await Promise.allSettled([
            fetch(osmUrl, { headers: { Accept: "application/json", "Accept-Language": "en" } }).then((r) => r.json()),
            fetch(googleUrl).then((r) => r.json()),
          ]);
          const osmList: OsmResult[] =
            osmRes.status === "fulfilled" && Array.isArray(osmRes.value)
              ? (osmRes.value as Array<{ place_id: number; display_name: string; lat: string; lon: string; name?: string; type?: string; class?: string; address?: Record<string, string> }>).map((d) => {
                  const addr = d.address ?? {};
                  const primary = d.name || addr.attraction || addr.building || addr.amenity || addr.tourism || addr.shop || d.display_name.split(",")[0];
                  return {
                    id: `osm-${d.place_id}`,
                    name: primary,
                    address: d.display_name,
                    lat: d.lat,
                    lon: d.lon,
                    type: d.type ?? d.class ?? "place",
                    source: "osm" as const,
                  };
                })
              : [];
          const googleList: OsmResult[] =
            googleRes.status === "fulfilled" && googleRes.value && Array.isArray((googleRes.value as { results?: unknown[] }).results)
              ? ((googleRes.value as { results: Array<{ place_id: string; name: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } }; types?: string[] }> }).results).map((p) => ({
                  id: `google-${p.place_id}`,
                  name: p.name,
                  address: p.formatted_address ?? p.name,
                  lat: String(p.geometry?.location?.lat ?? ""),
                  lon: String(p.geometry?.location?.lng ?? ""),
                  type: (p.types && p.types[0]) || "place",
                  source: "google" as const,
                })).filter((p) => p.lat && p.lon)
              : [];
          if (osmList.length === 0 && googleList.length === 0 && osmRes.status === "rejected" && googleRes.status === "rejected") {
            throw new Error("both providers failed");
          }
          return [...googleList, ...osmList];
        };

        const list = await runWithMappingRotation<OsmResult[]>(
          PAGE_ID,
          "places",
          (ctx) => searchWithAssigned(q, ctx),
          fallback
        );
        if (cancelRef.current) return;

        const seen = new Set<string>();
        const merged: OsmResult[] = [];
        list.forEach((item) => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(item);
        });
        setResults(merged);
      } catch (e) {
        console.log("[multi-gate] search error", e);
        if (!cancelRef.current) setSearchError("Search failed. Try again.");
      } finally {
        if (!cancelRef.current) setSearching(false);
      }
    }, 450);
    return () => {
      cancelRef.current = true;
      clearTimeout(timer);
    };
  }, [query]);

  const addedKey = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      const lat = String(e.values.lat ?? "");
      const lon = String(e.values.lon ?? "");
      if (lat && lon) set.add(`${lat},${lon}`);
    });
    return set;
  }, [entries]);

  const openAddFromSearch = (r: OsmResult) => {
    setForm({
      name: r.name,
      gates: "2",
      address: r.address,
      lat: r.lat,
      lon: r.lon,
      gateRequired: true,
      active: true,
    });
    setEditing(null);
    setModalOpen(true);
  };

  const openManualAdd = () => {
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const gateRequiredRaw = entry.values.gateRequired;
    const activeRaw = entry.values.active;
    setForm({
      name: String(entry.values.name ?? ""),
      gates: String(entry.values.gates ?? ""),
      address: String(entry.values.address ?? ""),
      lat: String(entry.values.lat ?? ""),
      lon: String(entry.values.lon ?? ""),
      gateRequired: gateRequiredRaw === undefined ? true : Boolean(gateRequiredRaw),
      active: activeRaw === undefined ? true : Boolean(activeRaw),
    });
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    const name = form.name.trim();
    const gatesNum = parseInt(form.gates, 10);
    if (!name) {
      Alert.alert("Missing field", "Please enter a place name.");
      return;
    }
    if (!Number.isFinite(gatesNum) || gatesNum < 1) {
      Alert.alert("Invalid gates", "Number of gates must be at least 1.");
      return;
    }
    const cleaned = {
      name,
      gates: gatesNum,
      address: form.address.trim(),
      lat: form.lat.trim(),
      lon: form.lon.trim(),
      gateRequired: form.gateRequired,
      active: form.active,
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, cleaned);
    } else {
      addEntry(STORAGE_KEY, cleaned);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this place?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const renderRow = (entry: SettingEntry) => {
    const name = String(entry.values.name ?? "Place");
    const gates = String(entry.values.gates ?? "0");
    const address = String(entry.values.address ?? "");
    const gateRequiredRaw = entry.values.gateRequired;
    const activeRaw = entry.values.active;
    const gateRequired = gateRequiredRaw === undefined ? true : Boolean(gateRequiredRaw);
    const active = activeRaw === undefined ? true : Boolean(activeRaw);
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, opacity: active ? 1 : 0.6 }]}
        testID={`mgp-row-${entry.id}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          <Building2 color={Colors.accentText} size={18} />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            <View style={[styles.gatePill, { backgroundColor: Colors.accent }]}>
              <DoorOpen color={Colors.onAccent} size={11} />
              <Text style={[styles.gateText, { color: Colors.onAccent }]}>{gates}</Text>
            </View>
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: (active ? Colors.accent : Colors.error) + "20" }]}>
              <Power color={active ? Colors.accent : Colors.error} size={10} />
              <Text style={[styles.statusBadgeText, { color: active ? Colors.accent : Colors.error }]}>
                {active ? "Active" : "Inactive"}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: Colors.accent + "15" }]}>
              <ShieldCheck color={Colors.accentText} size={10} />
              <Text style={[styles.statusBadgeText, { color: Colors.accentText }]}>
                {gateRequired ? "Gate required" : "Gate optional"}
              </Text>
            </View>
          </View>
          {!!address && (
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
              {address}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => router.push({ pathname: "/admin-settings-multi-gate-place-gates" as any, params: { placeId: entry.id } })}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`mgp-gates-${entry.id}`}
          accessibilityRole="button"
          accessibilityLabel="Manage gates"
        >
          <Settings2 color={Colors.accentText} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`mgp-edit-${entry.id}`}
          accessibilityRole="button"
          accessibilityLabel="Edit place"
        >
          <Pencil color={Colors.accentText} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`mgp-delete-${entry.id}`}
          accessibilityRole="button"
          accessibilityLabel="Delete place"
        >
          <Trash2 color={Colors.errorText} size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderSearchResult = (r: OsmResult) => {
    const already = addedKey.has(`${r.lat},${r.lon}`);
    return (
      <TouchableOpacity
        key={r.id}
        onPress={() => openAddFromSearch(r)}
        disabled={already}
        style={[
          styles.resultRow,
          {
            backgroundColor: Colors.background,
            borderColor: already ? Colors.accent : Colors.border,
            opacity: already ? 0.7 : 1,
          },
        ]}
        testID={`mgp-result-${r.id}`}
        accessibilityRole="button"
      >
        <View style={[styles.resultIcon, { backgroundColor: Colors.accent + "15" }]}>
          <MapPin color={Colors.accentText} size={16} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.resultTitleRow}>
            <Text style={[styles.resultName, { color: Colors.text }]} numberOfLines={1}>
              {r.name}
            </Text>
            <View
              style={[
                styles.sourceBadge,
                { backgroundColor: r.source === "google" ? "#4285F415" : Colors.accent + "15" },
              ]}
            >
              <Text
                style={[
                  styles.sourceBadgeText,
                  { color: r.source === "google" ? "#4285F4" : Colors.accent },
                ]}
              >
                {sourceLabel(r.source)}
              </Text>
            </View>
          </View>
          <Text style={[styles.resultAddr, { color: Colors.textSecondary }]} numberOfLines={2}>
            {r.address}
          </Text>
        </View>
        {already ? (
          <CheckCircle2 color={Colors.accentText} size={20} />
        ) : (
          <Plus color={Colors.accentText} size={20} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="mgp-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Building2 color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Multi-Gate Places
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {entries.length} {entries.length === 1 ? "place" : "places"} · Search & add
          </Text>
        </View>
        <TouchableOpacity
          onPress={openManualAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="mgp-add-manual"
          accessibilityRole="button"
          accessibilityLabel="Add a place manually"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search airports, malls, stations..."
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          autoCorrect={false}
          autoCapitalize="words"
          testID="mgp-search"
          accessibilityLabel="Search places"
        />
        {searching ? (
          <ActivityIndicator size="small" color={Colors.accentText} />
        ) : query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery("")} testID="mgp-search-clear" accessibilityRole="button">
            <X color={Colors.textSecondary} size={16} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {query.trim().length >= 3 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>SEARCH RESULTS</Text>
            {searching && results.length === 0 ? (
              <View style={[styles.loadingBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Loader color={Colors.textSecondary} size={20} />
                <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>Searching places…</Text>
              </View>
            ) : searchError ? (
              <View style={[styles.loadingBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Text style={{ color: Colors.errorText, fontSize: 13 }}>{searchError}</Text>
              </View>
            ) : results.length === 0 ? (
              <View style={[styles.loadingBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>No matches found</Text>
              </View>
            ) : (
              results.map(renderSearchResult)
            )}
          </View>
        ) : (
          <View style={[styles.hintBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Search color={Colors.textSecondary} size={18} />
            <Text style={[styles.hintText, { color: Colors.textSecondary }]}>
              Type at least 3 letters to search global places, then tap to add.
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>
              ADDED ({entries.length})
            </Text>
          </View>
          {entries.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Inbox color={Colors.textSecondary} size={28} />
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>No places yet</Text>
              <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
                Search above or add one manually to get started.
              </Text>
              <TouchableOpacity
                onPress={openManualAdd}
                style={[styles.cta, { backgroundColor: Colors.accent }]}
                testID="mgp-empty-add"
                accessibilityRole="button"
              >
                <Plus color={Colors.onAccent} size={16} />
                <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add manually</Text>
              </TouchableOpacity>
            </View>
          ) : (
            entries.map(renderRow)
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit Place" : "Add Place"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="mgp-modal-close"
                  accessibilityRole="button"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 12 }}>
                {([
                  { key: "name", label: "Place Name *", placeholder: "e.g. KLIA Terminal 1", kb: "default" },
                  { key: "gates", label: "Number of Gates *", placeholder: "e.g. 4", kb: "number-pad" },
                  { key: "address", label: "Address", placeholder: "Full address" },
                  { key: "lat", label: "Latitude", placeholder: "e.g. 2.7456", kb: "decimal-pad" },
                  { key: "lon", label: "Longitude", placeholder: "e.g. 101.7099", kb: "decimal-pad" },
                ] as const).map((f) => (
                  <View key={f.key} style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>{f.label}</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={form[f.key] as string}
                        onChangeText={(t) => setForm((p) => ({ ...p, [f.key]: t }))}
                        placeholder={f.placeholder}
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        keyboardType={(f as { kb?: string }).kb as never}
                        multiline={f.key === "address"}
                        testID={`mgp-field-${f.key}`}
                        accessibilityLabel={f.label}
                      />
                    </View>
                  </View>
                ))}

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={[styles.toggleIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <ShieldCheck color={Colors.accentText} size={18} />
                  </View>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.toggleTitle, { color: Colors.text }]}>Gate selection</Text>
                    <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
                      Compulsory for users to pick a gate at this place
                    </Text>
                  </View>
                  <Switch
                    value={form.gateRequired}
                    onValueChange={(v) => setForm((p) => ({ ...p, gateRequired: v }))}
                    trackColor={{ false: Colors.border, true: Colors.accent }}
                    thumbColor={Platform.OS === "android" ? Colors.secondary : undefined}
                    testID="mgp-field-gateRequired"
                    accessibilityLabel="Gate selection"
                  />
                </View>

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={[styles.toggleIcon, { backgroundColor: (form.active ? Colors.accent : Colors.error) + "20" }]}>
                    <Power color={form.active ? Colors.accent : Colors.error} size={18} />
                  </View>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.toggleTitle, { color: Colors.text }]}>Status</Text>
                    <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
                      {form.active ? "Active — visible in user search" : "Deactivated — hidden from users"}
                    </Text>
                  </View>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    trackColor={{ false: Colors.border, true: Colors.accent }}
                    thumbColor={Platform.OS === "android" ? Colors.secondary : undefined}
                    testID="mgp-field-active"
                    accessibilityLabel="Status"
                  />
                </View>
              </ScrollView>
              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="mgp-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Place"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  iconBtnSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 1,
  },
  hintBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  hintText: { fontSize: 13, flex: 1 },
  loadingBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  resultRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  resultName: { fontSize: 14, fontWeight: "700" as const, flexShrink: 1 },
  resultTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  sourceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.5 },
  resultAddr: { fontSize: 12, marginTop: 2 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const, flexShrink: 1 },
  gatePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  gateText: { fontSize: 11, fontWeight: "800" as const },
  rowDesc: { fontSize: 12, marginTop: 4 },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 4, flexWrap: "wrap" as const },
  statusBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { fontSize: 13, fontWeight: "800" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 12 },
  submitBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginTop: 6,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  toggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  toggleInfo: { flex: 1 },
  toggleTitle: { fontSize: 14, fontWeight: "700" as const },
  toggleDesc: { fontSize: 11, marginTop: 2 },
});
