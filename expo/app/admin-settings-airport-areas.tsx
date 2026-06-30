import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FlatList,
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
  Plane,
  Filter,
  Check,
  Map as MapIcon,
  Download,
  Eraser,
  Layers,
  PenLine,
  Move,
  Undo2,
  ChevronRight,
  DoorOpen,
  MapPin,
  CheckCircle2,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import { runWithMappingRotation, type MappingCallContext } from "@/utils/mappingClient";
import { GOOGLE_PLACES_KEY } from "@/constants/googleKeys";

let MapViewRN: any = null;
let PolygonRN: any = null;
let MarkerRN: any = null;
try {
  if (Platform.OS !== "web") {
    const Maps = require("react-native-maps");
    MapViewRN = Maps.default;
    PolygonRN = Maps.Polygon;
    MarkerRN = Maps.Marker;
  }
} catch (e) {
  console.log("[airport] react-native-maps unavailable", e);
}

const PAGE_ID = "airport-areas" as const;

interface LatLng { latitude: number; longitude: number }
interface BBox { north: number; south: number; east: number; west: number }
type BoundarySource = "osm" | "google" | "geonames" | "bbox" | "manual";
interface BoundaryShape { coords: LatLng[]; polygons?: LatLng[][]; bbox: BBox; source: BoundarySource }

interface BoundaryCandidate {
  displayName: string;
  type?: string;
  className?: string;
  osmType?: string;
  osmId?: number | string;
  shape: BoundaryShape;
}

function bboxToRect(b: BBox): LatLng[] {
  return [
    { latitude: b.north, longitude: b.west },
    { latitude: b.north, longitude: b.east },
    { latitude: b.south, longitude: b.east },
    { latitude: b.south, longitude: b.west },
  ];
}

function parseBoundary(raw: unknown): BoundaryShape | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const j = JSON.parse(raw) as BoundaryShape;
    if (!j || !Array.isArray(j.coords) || !j.bbox) return null;
    return j;
  } catch {
    return null;
  }
}

function regionForBoundary(b: BoundaryShape) {
  const latC = (b.bbox.north + b.bbox.south) / 2;
  const lngC = (b.bbox.east + b.bbox.west) / 2;
  const latD = Math.max(0.02, Math.abs(b.bbox.north - b.bbox.south) * 1.4);
  const lngD = Math.max(0.02, Math.abs(b.bbox.east - b.bbox.west) * 1.4);
  return { latitude: latC, longitude: lngC, latitudeDelta: latD, longitudeDelta: lngD };
}

function osmHitToShape(hit: {
  boundingbox?: [string, string, string, string];
  geojson?: { type: string; coordinates: unknown };
}): BoundaryShape | null {
  const bb = hit.boundingbox;
  if (!bb) return null;
  const bbox: BBox = {
    south: parseFloat(bb[0]),
    north: parseFloat(bb[1]),
    west: parseFloat(bb[2]),
    east: parseFloat(bb[3]),
  };
  let coords: LatLng[] = bboxToRect(bbox);
  let polygons: LatLng[][] = [];
  const gj = hit.geojson;
  if (gj?.type === "Polygon") {
    const ring = (gj.coordinates as [number, number][][])[0] ?? [];
    const mapped = ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    coords = mapped;
    polygons = [mapped];
  } else if (gj?.type === "MultiPolygon") {
    const polys = gj.coordinates as [number, number][][][];
    polygons = polys
      .map((p) => (p[0] ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })))
      .filter((r) => r.length > 0);
    let best: LatLng[] = [];
    for (const ring of polygons) {
      if (ring.length > best.length) best = ring;
    }
    coords = best.length > 0 ? best : coords;
  }
  return { coords, polygons: polygons.length > 0 ? polygons : undefined, bbox, source: "osm" };
}

async function fetchOsmCandidates(query: string, limit: number = 10, near?: { lat: number; lon: number; radiusDeg?: number }): Promise<BoundaryCandidate[]> {
  try {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    let viewboxParam = "";
    if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
      const r = near.radiusDeg ?? 0.5;
      const left = near.lon - r;
      const right = near.lon + r;
      const top = near.lat + r;
      const bottom = near.lat - r;
      viewboxParam = `&viewbox=${left},${top},${right},${bottom}&bounded=1`;
    }
    const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=${safeLimit}${viewboxParam}&q=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: { "User-Agent": "rork-admin/1.0" } });
    if (!r.ok) return [];
    const data = (await r.json()) as Array<{
      display_name?: string;
      type?: string;
      class?: string;
      osm_type?: string;
      osm_id?: number | string;
      boundingbox?: [string, string, string, string];
      geojson?: { type: string; coordinates: unknown };
    }>;
    const out: BoundaryCandidate[] = [];
    for (const hit of data ?? []) {
      const shape = osmHitToShape(hit);
      if (!shape) continue;
      out.push({
        displayName: hit.display_name ?? "",
        type: hit.type,
        className: hit.class,
        osmType: hit.osm_type,
        osmId: hit.osm_id,
        shape,
      });
    }
    return out;
  } catch (e) {
    console.log("[airport] osm error", e);
    return [];
  }
}

async function fetchOsmReverseCandidates(lat: number, lon: number): Promise<BoundaryCandidate[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const zooms = [16, 14, 12, 10, 8];
  const out: BoundaryCandidate[] = [];
  const seen = new Set<string>();
  for (const z of zooms) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&polygon_geojson=1&zoom=${z}&lat=${lat}&lon=${lon}`;
      const r = await fetch(url, { headers: { "User-Agent": "rork-admin/1.0" } });
      if (!r.ok) continue;
      const hit = (await r.json()) as {
        display_name?: string;
        type?: string;
        class?: string;
        osm_type?: string;
        osm_id?: number | string;
        boundingbox?: [string, string, string, string];
        geojson?: { type: string; coordinates: unknown };
        address?: Record<string, string>;
      };
      if (!hit) continue;
      const shape = osmHitToShape(hit);
      if (!shape) continue;
      const key = `${hit.osm_type ?? "x"}-${hit.osm_id ?? z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        displayName: hit.display_name ?? "",
        type: hit.type,
        className: hit.class,
        osmType: hit.osm_type,
        osmId: hit.osm_id,
        shape,
      });
    } catch (e) {
      console.log("[airport] reverse error", z, e);
    }
  }
  return out;
}

async function fetchGoogleCandidates(query: string, near?: { lat: number; lon: number }): Promise<BoundaryCandidate[]> {
  return runWithMappingRotation(
    PAGE_ID,
    "boundaries",
    async (ctx) => {
      try {
        if (ctx.providerSlug !== "google" || !ctx.key) {
          return { ok: false, value: [] as BoundaryCandidate[] };
        }
        const biasParam = near && Number.isFinite(near.lat) && Number.isFinite(near.lon)
          ? `&bounds=${near.lat - 0.5},${near.lon - 0.5}|${near.lat + 0.5},${near.lon + 0.5}`
          : "";
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}${biasParam}&key=${ctx.key}`;
        const r = await fetch(url);
        const j = await r.json();
        if (j.status !== "OK" || !j.results?.length) return { ok: false, value: [] };
        const out: BoundaryCandidate[] = [];
        for (let i = 0; i < (j.results as unknown[]).length; i++) {
          const res = j.results[i] as {
            formatted_address?: string;
            place_id?: string;
            types?: string[];
            geometry?: { viewport?: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } } };
          };
          const vp = res.geometry?.viewport;
          if (!vp) continue;
          const bbox: BBox = {
            north: vp.northeast.lat,
            east: vp.northeast.lng,
            south: vp.southwest.lat,
            west: vp.southwest.lng,
          };
          out.push({
            displayName: res.formatted_address ?? "",
            type: res.types?.[0],
            className: "google",
            osmType: "place",
            osmId: res.place_id ?? `g-${i}`,
            shape: { coords: bboxToRect(bbox), bbox, source: "google" },
          });
        }
        return { ok: out.length > 0, value: out };
      } catch (e) {
        console.log("[airport] google error", e);
        return { ok: false, value: [] };
      }
    },
    async () => [] as BoundaryCandidate[]
  );
}

async function fetchGeonamesCandidates(query: string, startRow: number = 0, maxRows: number = 10, near?: { lat: number; lon: number }): Promise<BoundaryCandidate[]> {
  try {
    const username = "demo";
    const biasParam = near && Number.isFinite(near.lat) && Number.isFinite(near.lon)
      ? `&north=${near.lat + 0.5}&south=${near.lat - 0.5}&east=${near.lon + 0.5}&west=${near.lon - 0.5}`
      : "";
    const url = `https://secure.geonames.org/searchJSON?q=${encodeURIComponent(query)}&maxRows=${maxRows}&startRow=${startRow}${biasParam}&username=${username}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const hits = (j?.geonames ?? []) as Array<{
      name?: string;
      toponymName?: string;
      countryName?: string;
      adminName1?: string;
      fcodeName?: string;
      fcl?: string;
      geonameId?: number;
      bbox?: { north: number; south: number; east: number; west: number };
      lat?: string | number;
      lng?: string | number;
    }>;
    const out: BoundaryCandidate[] = [];
    for (const hit of hits) {
      let bbox: BBox | null = null;
      if (hit.bbox) {
        bbox = { north: hit.bbox.north, south: hit.bbox.south, east: hit.bbox.east, west: hit.bbox.west };
      } else if (hit.lat != null && hit.lng != null) {
        const lat = typeof hit.lat === "string" ? parseFloat(hit.lat) : hit.lat;
        const lng = typeof hit.lng === "string" ? parseFloat(hit.lng) : hit.lng;
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          bbox = { north: lat + 0.05, south: lat - 0.05, east: lng + 0.05, west: lng - 0.05 };
        }
      }
      if (!bbox) continue;
      const label = [hit.name ?? hit.toponymName, hit.adminName1, hit.countryName].filter(Boolean).join(", ");
      out.push({
        displayName: label,
        type: hit.fcodeName,
        className: hit.fcl ?? "geonames",
        osmType: "geonames",
        osmId: hit.geonameId,
        shape: { coords: bboxToRect(bbox), bbox, source: "geonames" },
      });
    }
    return out;
  } catch (e) {
    console.log("[airport] geonames error", e);
    return [];
  }
}

const STORAGE_KEY = "airport-areas" as const;

interface AirportForm {
  name: string;
  code: string;
  country: string;
  state: string;
  city: string;
  address: string;
  lat: string;
  lon: string;
  placeName: string;
}

const EMPTY_FORM: AirportForm = {
  name: "",
  code: "",
  country: "",
  state: "",
  city: "",
  address: "",
  lat: "",
  lon: "",
  placeName: "",
};

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  lat: string;
  lon: string;
  source: "google" | "osm" | "assigned";
  addr?: Record<string, string>;
  components?: { country?: string; state?: string; city?: string };
}

async function searchPlacesAssigned(q: string, ctx: MappingCallContext): Promise<{ ok: boolean; value: PlaceResult[] }> {
  const enc = encodeURIComponent(q);
  try {
    if (ctx.providerSlug === "google") {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${enc}&key=${ctx.key}`;
      const r = await fetch(url).then((x) => x.json()) as { status?: string; results?: Array<{ place_id: string; name: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }> };
      const ok = r.status === "OK" || r.status === "ZERO_RESULTS";
      const items: PlaceResult[] = (r.results ?? []).map((p) => ({
        id: `google-${p.place_id}`,
        name: p.name,
        address: p.formatted_address ?? p.name,
        lat: String(p.geometry?.location?.lat ?? ""),
        lon: String(p.geometry?.location?.lng ?? ""),
        source: "google" as const,
      })).filter((p) => p.lat && p.lon);
      return { ok, value: items };
    }
    if (ctx.providerSlug === "openstreetmap") {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=12&q=${enc}`;
      const r = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } }).then((x) => x.json()) as Array<{ place_id: number; display_name: string; lat: string; lon: string; name?: string; address?: Record<string, string> }>;
      const items: PlaceResult[] = (Array.isArray(r) ? r : []).map((d) => {
        const addr = d.address ?? {};
        const primary = d.name || addr.aeroway || addr.attraction || addr.building || d.display_name.split(",")[0];
        return {
          id: `osm-${d.place_id}`,
          name: primary,
          address: d.display_name,
          lat: d.lat,
          lon: d.lon,
          source: "osm" as const,
          addr,
          components: {
            country: addr.country,
            state: addr.state ?? addr.region,
            city: addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county,
          },
        };
      });
      return { ok: true, value: items };
    }
    return { ok: false, value: [] };
  } catch (e) {
    console.log("[airport] place search err", e);
    return { ok: false, value: [] };
  }
}

export default function AdminSettingsAirportAreasScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [filterCountry, setFilterCountry] = useState<string>("");
  const [filterState, setFilterState] = useState<string>("");
  const [filterCity, setFilterCity] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState<null | "country" | "state" | "city">(null);

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<AirportForm>(EMPTY_FORM);

  const [geoEntry, setGeoEntry] = useState<SettingEntry | null>(null);
  const [boundary, setBoundary] = useState<BoundaryShape | null>(null);
  const [fetching, setFetching] = useState<BoundarySource | null>(null);
  const [bboxN, setBboxN] = useState<string>("");
  const [bboxS, setBboxS] = useState<string>("");
  const [bboxE, setBboxE] = useState<string>("");
  const [bboxW, setBboxW] = useState<string>("");
  const [candidates, setCandidates] = useState<BoundaryCandidate[] | null>(null);
  const [searchCtx, setSearchCtx] = useState<{ source: "osm" | "google" | "geonames"; query: string; exhausted: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [drawMode, setDrawMode] = useState<"off" | "draw" | "edit">("off");
  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const mapRef = useRef<unknown>(null);

  const countries = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      const c = String(e.values.country ?? "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [entries]);

  const states = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (filterCountry && String(e.values.country ?? "") !== filterCountry) return;
      const s = String(e.values.state ?? "").trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [entries, filterCountry]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (filterCountry && String(e.values.country ?? "") !== filterCountry) return;
      if (filterState && String(e.values.state ?? "") !== filterState) return;
      const c = String(e.values.city ?? "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [entries, filterCountry, filterState]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filterCountry && String(e.values.country ?? "") !== filterCountry) return false;
      if (filterState && String(e.values.state ?? "") !== filterState) return false;
      if (filterCity && String(e.values.city ?? "") !== filterCity) return false;
      if (!q) return true;
      return Object.values(e.values).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [entries, query, filterCountry, filterState, filterCity]);

  const [placeQuery, setPlaceQuery] = useState<string>("");
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState<boolean>(false);
  const [placeError, setPlaceError] = useState<string>("");
  const placeCancelRef = useRef<boolean>(false);

  useEffect(() => {
    if (!modalOpen) return;
    const q = placeQuery.trim();
    if (q.length < 3) {
      setPlaceResults([]);
      setPlaceSearching(false);
      setPlaceError("");
      return;
    }
    placeCancelRef.current = false;
    setPlaceSearching(true);
    setPlaceError("");
    const timer = setTimeout(async () => {
      try {
        const fallback = async (): Promise<PlaceResult[]> => {
          const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(q)}`;
          const googleUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${GOOGLE_PLACES_KEY}`;
          const [osmRes, googleRes] = await Promise.allSettled([
            fetch(osmUrl, { headers: { Accept: "application/json", "Accept-Language": "en" } }).then((r) => r.json()),
            fetch(googleUrl).then((r) => r.json()),
          ]);
          const osmList: PlaceResult[] =
            osmRes.status === "fulfilled" && Array.isArray(osmRes.value)
              ? (osmRes.value as Array<{ place_id: number; display_name: string; lat: string; lon: string; name?: string; address?: Record<string, string> }>).map((d) => {
                  const addr = d.address ?? {};
                  const primary = d.name || addr.aeroway || addr.attraction || addr.building || d.display_name.split(",")[0];
                  return {
                    id: `osm-${d.place_id}`,
                    name: primary,
                    address: d.display_name,
                    lat: d.lat,
                    lon: d.lon,
                    source: "osm" as const,
                    addr,
                    components: {
                      country: addr.country,
                      state: addr.state ?? addr.region,
                      city: addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county,
                    },
                  };
                })
              : [];
          const googleList: PlaceResult[] =
            googleRes.status === "fulfilled" && googleRes.value && Array.isArray((googleRes.value as { results?: unknown[] }).results)
              ? ((googleRes.value as { results: Array<{ place_id: string; name: string; formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }> }).results)
                  .map((p) => ({
                    id: `google-${p.place_id}`,
                    name: p.name,
                    address: p.formatted_address ?? p.name,
                    lat: String(p.geometry?.location?.lat ?? ""),
                    lon: String(p.geometry?.location?.lng ?? ""),
                    source: "google" as const,
                  }))
                  .filter((p) => p.lat && p.lon)
              : [];
          return [...googleList, ...osmList];
        };
        const list = await runWithMappingRotation<PlaceResult[]>(
          PAGE_ID,
          "places",
          (ctx) => searchPlacesAssigned(q, ctx),
          fallback
        );
        if (placeCancelRef.current) return;
        const seen = new Set<string>();
        const merged: PlaceResult[] = [];
        list.forEach((it) => {
          const lat = parseFloat(it.lat);
          const lon = parseFloat(it.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const k = `${lat.toFixed(4)},${lon.toFixed(4)}`;
          if (seen.has(k)) return;
          seen.add(k);
          merged.push(it);
        });
        setPlaceResults(merged);
      } catch (e) {
        console.log("[airport] place search err", e);
        if (!placeCancelRef.current) setPlaceError("Search failed. Try again.");
      } finally {
        if (!placeCancelRef.current) setPlaceSearching(false);
      }
    }, 450);
    return () => {
      placeCancelRef.current = true;
      clearTimeout(timer);
    };
  }, [placeQuery, modalOpen]);

  const pickPlace = useCallback((r: PlaceResult) => {
    setForm((p) => ({
      ...p,
      placeName: r.name,
      address: r.address,
      lat: r.lat,
      lon: r.lon,
      country: p.country.trim() ? p.country : (r.components?.country ?? p.country),
      state: p.state.trim() ? p.state : (r.components?.state ?? p.state),
      city: p.city.trim() ? p.city : (r.components?.city ?? p.city),
    }));
    setPlaceResults([]);
    setPlaceQuery("");
  }, []);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setPlaceQuery("");
    setPlaceResults([]);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setForm({
      name: String(entry.values.name ?? ""),
      code: String(entry.values.code ?? ""),
      country: String(entry.values.country ?? ""),
      state: String(entry.values.state ?? ""),
      city: String(entry.values.city ?? ""),
      address: String(entry.values.address ?? ""),
      lat: String(entry.values.lat ?? ""),
      lon: String(entry.values.lon ?? ""),
      placeName: String(entry.values.placeName ?? ""),
    });
    setEditing(entry);
    setPlaceQuery("");
    setPlaceResults([]);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setPlaceQuery("");
    setPlaceResults([]);
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.name.trim()) {
      Alert.alert("Missing field", "Please fill in Airport Name.");
      return;
    }
    if (!form.country.trim()) {
      Alert.alert("Missing field", "Please fill in Country.");
      return;
    }
    if (!form.placeName.trim()) {
      Alert.alert("Place required", "Please assign at least one place using Google or OSM search.");
      return;
    }
    const cleaned = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      country: form.country.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      address: form.address.trim(),
      lat: form.lat.trim(),
      lon: form.lon.trim(),
      placeName: form.placeName.trim(),
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, cleaned);
    } else {
      addEntry(STORAGE_KEY, cleaned);
    }
    closeModal();
  };

  const queryFromEntry = useCallback((e: SettingEntry): string => {
    return String(e.values.placeName ?? "").trim();
  }, []);

  const openGeo = useCallback((entry: SettingEntry) => {
    const placeName = String(entry.values?.placeName ?? "").trim();
    if (!placeName) {
      Alert.alert(
        "Place required",
        "Please assign at least one place (via Google or OSM search) to this airport before setting up geofence.",
        [
          {
            text: "OK",
            onPress: () => {
              setForm({
                name: String(entry.values.name ?? ""),
                code: String(entry.values.code ?? ""),
                country: String(entry.values.country ?? ""),
                state: String(entry.values.state ?? ""),
                city: String(entry.values.city ?? ""),
                address: String(entry.values.address ?? ""),
                lat: String(entry.values.lat ?? ""),
                lon: String(entry.values.lon ?? ""),
                placeName: String(entry.values.placeName ?? ""),
              });
              setEditing(entry);
              setPlaceQuery("");
              setPlaceResults([]);
              setModalOpen(true);
            },
          },
        ],
      );
      return;
    }
    setGeoEntry(entry);
    const existing = parseBoundary(entry.values?.boundary);
    setBoundary(existing);
    if (existing) {
      setBboxN(String(existing.bbox.north));
      setBboxS(String(existing.bbox.south));
      setBboxE(String(existing.bbox.east));
      setBboxW(String(existing.bbox.west));
    } else {
      setBboxN(""); setBboxS(""); setBboxE(""); setBboxW("");
    }
  }, []);

  const closeGeo = useCallback(() => {
    setGeoEntry(null);
    setBoundary(null);
    setFetching(null);
    setCandidates(null);
    setSearchCtx(null);
    setDrawMode("off");
    setDraftPoints([]);
  }, []);

  const startDraw = useCallback(() => { setDrawMode("draw"); setDraftPoints([]); }, []);
  const startEditPoly = useCallback(() => {
    if (!boundary || boundary.coords.length === 0) {
      Alert.alert("No polygon", "Fetch or draw a boundary first, then edit its vertices.");
      return;
    }
    setDrawMode("edit");
    setDraftPoints(boundary.coords);
  }, [boundary]);
  const cancelDraw = useCallback(() => { setDrawMode("off"); setDraftPoints([]); }, []);
  const undoVertex = useCallback(() => { setDraftPoints((p) => p.slice(0, -1)); }, []);

  const commitDraft = useCallback(() => {
    if (draftPoints.length < 3) {
      Alert.alert("Need at least 3 points", "A polygon requires three or more vertices.");
      return;
    }
    const lats = draftPoints.map((p) => p.latitude);
    const lngs = draftPoints.map((p) => p.longitude);
    const bbox: BBox = {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
    const shape: BoundaryShape = { coords: draftPoints, polygons: [draftPoints], bbox, source: "manual" };
    setBoundary(shape);
    setBboxN(String(bbox.north));
    setBboxS(String(bbox.south));
    setBboxE(String(bbox.east));
    setBboxW(String(bbox.west));
    setDrawMode("off");
    setDraftPoints([]);
  }, [draftPoints]);

  const onMapPress = useCallback((e: { nativeEvent: { coordinate: LatLng } }) => {
    if (drawMode !== "draw") return;
    const c = e.nativeEvent.coordinate;
    if (!c) return;
    setDraftPoints((p) => [...p, { latitude: c.latitude, longitude: c.longitude }]);
  }, [drawMode]);

  const onVertexDrag = useCallback((idx: number, coord: LatLng) => {
    setDraftPoints((p) => p.map((v, i) => (i === idx ? coord : v)));
  }, []);
  const removeVertex = useCallback((idx: number) => {
    setDraftPoints((p) => p.filter((_, i) => i !== idx));
  }, []);

  const candidateKey = useCallback((c: BoundaryCandidate, idx: number): string => {
    return `${c.osmType ?? "x"}-${c.osmId ?? idx}`;
  }, []);

  const pickCandidate = useCallback((c: BoundaryCandidate) => {
    setBoundary(c.shape);
    setBboxN(String(c.shape.bbox.north));
    setBboxS(String(c.shape.bbox.south));
    setBboxE(String(c.shape.bbox.east));
    setBboxW(String(c.shape.bbox.west));
    setCandidates(null);
    setSearchCtx(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!searchCtx || searchCtx.exhausted || loadingMore) return;
    setLoadingMore(true);
    try {
      const existing = candidates ?? [];
      const seen = new Set(existing.map((c, i) => candidateKey(c, i)));
      let appended: BoundaryCandidate[] = [];
      let exhausted = false;
      const latNum = parseFloat(String(geoEntry?.values.lat ?? ""));
      const lonNum = parseFloat(String(geoEntry?.values.lon ?? ""));
      const near = Number.isFinite(latNum) && Number.isFinite(lonNum)
        ? { lat: latNum, lon: lonNum }
        : undefined;
      if (searchCtx.source === "osm") {
        const nextLimit = Math.min(50, existing.length + 10);
        const fresh = await fetchOsmCandidates(searchCtx.query, nextLimit, near);
        appended = fresh.filter((c, i) => !seen.has(candidateKey(c, existing.length + i)));
        if (appended.length === 0 || nextLimit >= 50) exhausted = true;
      } else if (searchCtx.source === "geonames") {
        const fresh = await fetchGeonamesCandidates(searchCtx.query, existing.length, 10, near);
        appended = fresh.filter((c, i) => !seen.has(candidateKey(c, existing.length + i)));
        if (fresh.length < 10 || appended.length === 0) exhausted = true;
      } else {
        exhausted = true;
      }
      if (appended.length > 0) setCandidates([...existing, ...appended]);
      setSearchCtx({ ...searchCtx, exhausted });
    } catch (e) {
      console.log("[airport] load more error", e);
      setSearchCtx({ ...searchCtx, exhausted: true });
    } finally {
      setLoadingMore(false);
    }
  }, [searchCtx, loadingMore, candidates, candidateKey, geoEntry]);

  const doFetch = useCallback(async (src: Exclude<BoundarySource, "manual">) => {
    if (!geoEntry) return;
    setFetching(src);
    try {
      const q = queryFromEntry(geoEntry);
      const latNum = parseFloat(String(geoEntry.values.lat ?? ""));
      const lonNum = parseFloat(String(geoEntry.values.lon ?? ""));
      const near = Number.isFinite(latNum) && Number.isFinite(lonNum)
        ? { lat: latNum, lon: lonNum }
        : undefined;
      let result: BoundaryShape | null = null;
      if (src === "osm" || src === "google" || src === "geonames") {
        let list: BoundaryCandidate[] = [];
        if (src === "osm") {
          const [reverseList, forwardList] = await Promise.all([
            near ? fetchOsmReverseCandidates(near.lat, near.lon) : Promise.resolve([] as BoundaryCandidate[]),
            fetchOsmCandidates(q, 10, near),
          ]);
          const seen = new Set<string>();
          [...reverseList, ...forwardList].forEach((c, i) => {
            const key = `${c.osmType ?? "x"}-${c.osmId ?? i}`;
            if (seen.has(key)) return;
            seen.add(key);
            list.push(c);
          });
        } else if (src === "google") {
          list = await fetchGoogleCandidates(q, near);
        } else {
          list = await fetchGeonamesCandidates(q, 0, 10, near);
        }
        if (list.length === 0) {
          Alert.alert("No boundary found", `${src.toUpperCase()} returned no results for this query.`);
          return;
        }
        if (list.length === 1) {
          result = list[0].shape;
        } else {
          setCandidates(list);
          setSearchCtx({ source: src, query: q, exhausted: src === "google" });
          return;
        }
      } else if (src === "bbox") {
        const n = parseFloat(bboxN);
        const s = parseFloat(bboxS);
        const e = parseFloat(bboxE);
        const w = parseFloat(bboxW);
        if ([n, s, e, w].some((v) => Number.isNaN(v))) {
          Alert.alert("Invalid bbox", "Enter all four bounds (N, S, E, W).");
          return;
        }
        const bbox: BBox = { north: n, south: s, east: e, west: w };
        result = { coords: bboxToRect(bbox), bbox, source: "bbox" };
      }
      if (!result) {
        Alert.alert("No boundary found", `Could not fetch a boundary from ${src.toUpperCase()}.`);
        return;
      }
      setBoundary(result);
      setBboxN(String(result.bbox.north));
      setBboxS(String(result.bbox.south));
      setBboxE(String(result.bbox.east));
      setBboxW(String(result.bbox.west));
    } finally {
      setFetching(null);
    }
  }, [geoEntry, queryFromEntry, bboxN, bboxS, bboxE, bboxW]);

  const saveBoundary = useCallback(() => {
    if (!geoEntry || !boundary) return;
    const v = {
      ...geoEntry.values,
      boundary: JSON.stringify(boundary),
      boundarySource: boundary.source,
      boundaryUpdatedAt: new Date().toISOString(),
    };
    updateEntry(STORAGE_KEY, geoEntry.id, v);
    closeGeo();
  }, [geoEntry, boundary, updateEntry, closeGeo]);

  const clearBoundary = useCallback(() => {
    if (!geoEntry) { setBoundary(null); return; }
    const v = { ...geoEntry.values };
    delete (v as Record<string, unknown>).boundary;
    delete (v as Record<string, unknown>).boundarySource;
    delete (v as Record<string, unknown>).boundaryUpdatedAt;
    updateEntry(STORAGE_KEY, geoEntry.id, v);
    setBoundary(null);
  }, [geoEntry, updateEntry]);

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this airport?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const clearFilters = () => {
    setFilterCountry("");
    setFilterState("");
    setFilterCity("");
  };

  const pickerOptions = useMemo(() => {
    if (pickerOpen === "country") return countries;
    if (pickerOpen === "state") return states;
    if (pickerOpen === "city") return cities;
    return [];
  }, [pickerOpen, countries, states, cities]);

  const pickerValue = useMemo(() => {
    if (pickerOpen === "country") return filterCountry;
    if (pickerOpen === "state") return filterState;
    if (pickerOpen === "city") return filterCity;
    return "";
  }, [pickerOpen, filterCountry, filterState, filterCity]);

  const onPickFilter = (val: string) => {
    if (pickerOpen === "country") {
      setFilterCountry(val);
      setFilterState("");
      setFilterCity("");
    } else if (pickerOpen === "state") {
      setFilterState(val);
      setFilterCity("");
    } else if (pickerOpen === "city") {
      setFilterCity(val);
    }
    setPickerOpen(null);
  };

  const FilterChip = ({
    label,
    value,
    onPress,
    disabled,
  }: {
    label: string;
    value: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        {
          backgroundColor: value ? Colors.accent + "20" : Colors.gray[100],
          borderColor: value ? Colors.accent : Colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={`airport-filter-${label.toLowerCase()}`}
    >
      <Text
        style={[
          styles.chipText,
          { color: value ? Colors.accent : Colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {value || label}
      </Text>
    </TouchableOpacity>
  );

  const renderRow = (entry: SettingEntry) => {
    const name = String(entry.values.name ?? "Airport");
    const code = String(entry.values.code ?? "");
    const country = String(entry.values.country ?? "");
    const state = String(entry.values.state ?? "");
    const city = String(entry.values.city ?? "");
    const hasBoundary = !!parseBoundary(entry.values?.boundary);
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`airport-row-${entry.id}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          <Plane color={Colors.accent} size={18} />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            {!!code && (
              <View style={[styles.codePill, { backgroundColor: Colors.accent }]}>
                <Text style={[styles.codeText, { color: Colors.onAccent }]}>{code}</Text>
              </View>
            )}
            {hasBoundary && (
              <View style={[styles.codePill, { backgroundColor: Colors.accent + "22" }]}>
                <Text style={[styles.codeText, { color: Colors.accent }]}>GEO</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
            {[city, state, country].filter(Boolean).join(" • ")}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openGeo(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`airport-geo-${entry.id}`}
        >
          <MapIcon color={hasBoundary ? Colors.accent : Colors.textSecondary} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push({ pathname: "/admin-settings-multi-gate-place-gates" as any, params: { placeId: entry.id, parentKey: STORAGE_KEY } })}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`airport-gates-${entry.id}`}
        >
          <DoorOpen color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`airport-edit-${entry.id}`}
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`airport-delete-${entry.id}`}
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="airport-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Plane color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Airport Areas
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {filtered.length} of {entries.length} airports
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="airport-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search airport, code, city..."
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="airport-search"
        />
      </View>

      <View style={styles.filtersHeader}>
        <View style={styles.filtersTitle}>
          <Filter color={Colors.textSecondary} size={14} />
          <Text style={[styles.filtersTitleText, { color: Colors.textSecondary }]}>
            Filter by region
          </Text>
        </View>
        {(filterCountry || filterState || filterCity) && (
          <TouchableOpacity onPress={clearFilters} testID="airport-clear-filters">
            <Text style={[styles.clearText, { color: Colors.accent }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <FilterChip
          label="Country"
          value={filterCountry}
          onPress={() => setPickerOpen("country")}
        />
        <FilterChip
          label="State"
          value={filterState}
          onPress={() => setPickerOpen("state")}
          disabled={!filterCountry}
        />
        <FilterChip
          label="City"
          value={filterCity}
          onPress={() => setPickerOpen("city")}
          disabled={!filterCountry}
        />
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No airports match</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Adjust filters or add a new airport.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="airport-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add Airport</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map(renderRow)
        )}
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
                  {editing ? "Edit Airport" : "Add Airport"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="airport-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Search & Assign Place</Text>
                  <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <Search color={Colors.textSecondary} size={16} />
                    <TextInput
                      value={placeQuery}
                      onChangeText={setPlaceQuery}
                      placeholder="Search airport on Google or OSM"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text, marginLeft: 8 }]}
                      testID="airport-place-search"
                    />
                    {placeSearching ? <ActivityIndicator size="small" color={Colors.accent} /> : null}
                    {!placeSearching && placeQuery.length > 0 ? (
                      <TouchableOpacity onPress={() => { setPlaceQuery(""); setPlaceResults([]); }}>
                        <X color={Colors.textSecondary} size={16} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {placeError ? (
                    <Text style={{ color: Colors.error, fontSize: 12, marginTop: 6 }}>{placeError}</Text>
                  ) : null}
                  {placeResults.length > 0 ? (
                    <View style={[styles.resultsBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      {placeResults.slice(0, 8).map((r) => {
                        const picked = form.lat === r.lat && form.lon === r.lon;
                        return (
                          <TouchableOpacity
                            key={r.id}
                            onPress={() => pickPlace(r)}
                            style={[styles.placeRow, { borderBottomColor: Colors.border }]}
                            testID={`airport-place-${r.id}`}
                          >
                            <View style={[styles.resultIcon, { backgroundColor: Colors.accent + "15" }]}>
                              <MapPin color={Colors.accent} size={14} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={styles.resultTitleRow}>
                                <Text style={[styles.resultName, { color: Colors.text }]} numberOfLines={1}>{r.name}</Text>
                                <View style={[styles.sourceBadge, { backgroundColor: r.source === "google" ? "#4285F415" : Colors.accent + "15" }]}>
                                  <Text style={[styles.sourceBadgeText, { color: r.source === "google" ? "#4285F4" : Colors.accent }]}>
                                    {r.source === "google" ? "Google" : "OSM"}
                                  </Text>
                                </View>
                              </View>
                              <Text style={[styles.resultAddr, { color: Colors.textSecondary }]} numberOfLines={2}>{r.address}</Text>
                            </View>
                            {picked ? <CheckCircle2 color={Colors.accent} size={18} /> : <Plus color={Colors.accent} size={18} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                  {!!form.lat && !!form.lon ? (
                    <View style={[styles.coordsBox, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]}>
                      <MapPin color={Colors.accent} size={14} />
                      <View style={{ flex: 1 }}>
                        {!!form.placeName && (
                          <Text style={[styles.coordsTitle, { color: Colors.accent }]} numberOfLines={1}>
                            {form.placeName}
                          </Text>
                        )}
                        <Text style={[styles.resultAddr, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {parseFloat(form.lat).toFixed(5)}, {parseFloat(form.lon).toFixed(5)}
                        </Text>
                        {!!form.address && (
                          <Text style={[styles.resultAddr, { color: Colors.textSecondary }]} numberOfLines={2}>
                            {form.address}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => setForm((p) => ({ ...p, lat: "", lon: "", address: "", placeName: "" }))}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        testID="airport-coords-clear"
                      >
                        <X color={Colors.textSecondary} size={14} />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
                {([
                  { key: "name", label: "Airport Name *", placeholder: "e.g. Kuala Lumpur International" },
                  { key: "code", label: "IATA Code", placeholder: "e.g. KUL" },
                  { key: "country", label: "Country *", placeholder: "e.g. Malaysia" },
                  { key: "state", label: "State / Region", placeholder: "e.g. Selangor" },
                  { key: "city", label: "City", placeholder: "e.g. Sepang" },
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
                        value={form[f.key]}
                        onChangeText={(t) => setForm((p) => ({ ...p, [f.key]: t }))}
                        placeholder={f.placeholder}
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        autoCapitalize={f.key === "code" ? "characters" : "words"}
                        testID={`airport-field-${f.key}`}
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="airport-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Airport"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={geoEntry !== null}
        animationType="slide"
        transparent
        onRequestClose={closeGeo}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeGeo} activeOpacity={1} />
          <View style={[styles.modalSheet, { backgroundColor: Colors.background, maxHeight: "92%" }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>Geofence</Text>
                <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {geoEntry ? queryFromEntry(geoEntry) : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={closeGeo} style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}>
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: "100%" }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              <View style={[styles.mapBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                {Platform.OS !== "web" && MapViewRN ? (
                  <MapViewRN
                    ref={mapRef as never}
                    style={StyleSheet.absoluteFill}
                    region={
                      boundary
                        ? regionForBoundary(boundary)
                        : { latitude: 3.139, longitude: 101.6869, latitudeDelta: 4, longitudeDelta: 4 }
                    }
                    onPress={onMapPress}
                  >
                    {boundary && PolygonRN && drawMode === "off" ? (
                      (boundary.polygons && boundary.polygons.length > 0 ? boundary.polygons : [boundary.coords]).map((ring, idx) => (
                        <PolygonRN
                          key={`bnd-${idx}`}
                          coordinates={ring}
                          strokeColor={Colors.accent}
                          strokeWidth={2}
                          fillColor={`${Colors.accent}33`}
                        />
                      ))
                    ) : null}
                    {drawMode !== "off" && PolygonRN && draftPoints.length >= 3 ? (
                      <PolygonRN
                        key="draft-poly"
                        coordinates={draftPoints}
                        strokeColor={Colors.accent}
                        strokeWidth={2}
                        fillColor={`${Colors.accent}26`}
                      />
                    ) : null}
                    {drawMode !== "off" && MarkerRN
                      ? draftPoints.map((p, idx) => (
                          <MarkerRN
                            key={`vtx-${idx}`}
                            coordinate={p}
                            draggable={drawMode === "edit"}
                            anchor={{ x: 0.5, y: 0.5 }}
                            onDragEnd={(ev: { nativeEvent: { coordinate: LatLng } }) => {
                              const c = ev.nativeEvent.coordinate;
                              if (c) onVertexDrag(idx, { latitude: c.latitude, longitude: c.longitude });
                            }}
                            onPress={() => {
                              if (drawMode === "edit") {
                                Alert.alert("Vertex", `Vertex ${idx + 1} of ${draftPoints.length}`, [
                                  { text: "Cancel", style: "cancel" },
                                  { text: "Remove", style: "destructive", onPress: () => removeVertex(idx) },
                                ]);
                              }
                            }}
                          >
                            <View style={[styles.vertexDot, { backgroundColor: Colors.accent }]}>
                              <Text style={[styles.vertexDotText, { color: Colors.onAccent }]}>{idx + 1}</Text>
                            </View>
                          </MarkerRN>
                        ))
                      : null}
                  </MapViewRN>
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.mapFallback]}>
                    <Layers size={20} color={Colors.textSecondary} />
                    <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>
                      {drawMode !== "off"
                        ? `${drawMode === "draw" ? "Drawing" : "Editing"} · ${draftPoints.length} pts (mobile only)`
                        : boundary
                        ? `${boundary.polygons?.length ?? 1} poly · ${boundary.coords.length} pts · ${boundary.source.toUpperCase()}`
                        : "Map preview only on iOS / Android"}
                    </Text>
                  </View>
                )}
                {drawMode !== "off" ? (
                  <View style={[styles.drawHint, { pointerEvents: "none" }]}>
                    <Text style={styles.drawHintText}>
                      {drawMode === "draw"
                        ? `Tap map to add points · ${draftPoints.length} placed`
                        : `Drag pins to move · tap pin to remove · ${draftPoints.length} pts`}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.drawRow}>
                {drawMode === "off" ? (
                  <>
                    <TouchableOpacity
                      onPress={startDraw}
                      style={[styles.actionBtn, styles.actionBtnGhost, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                      testID="airport-draw-start"
                    >
                      <PenLine size={16} color={Colors.text} />
                      <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>Draw</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={startEditPoly}
                      style={[styles.actionBtn, styles.actionBtnGhost, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }, !boundary && { opacity: 0.5 }]}
                      disabled={!boundary}
                      testID="airport-draw-edit"
                    >
                      <Move size={16} color={Colors.text} />
                      <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>Edit polygon</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={cancelDraw}
                      style={[styles.actionBtn, styles.actionBtnGhost, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                      testID="airport-draw-cancel"
                    >
                      <X size={16} color={Colors.text} />
                      <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    {drawMode === "draw" ? (
                      <TouchableOpacity
                        onPress={undoVertex}
                        style={[styles.actionBtn, styles.actionBtnGhost, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }, draftPoints.length === 0 && { opacity: 0.5 }]}
                        disabled={draftPoints.length === 0}
                        testID="airport-draw-undo"
                      >
                        <Undo2 size={16} color={Colors.text} />
                        <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>Undo</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      onPress={commitDraft}
                      style={[styles.actionBtn, { backgroundColor: Colors.accent }, draftPoints.length < 3 && { opacity: 0.5 }]}
                      disabled={draftPoints.length < 3}
                      testID="airport-draw-finish"
                    >
                      <Check size={16} color={Colors.onAccent} />
                      <Text style={[styles.actionBtnGhostText, { color: Colors.onAccent }]}>Finish</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {(["osm", "google", "geonames", "bbox"] as const).map((src) => {
                  const active = fetching === src;
                  return (
                    <TouchableOpacity
                      key={src}
                      disabled={fetching !== null}
                      onPress={() => doFetch(src)}
                      style={[
                        styles.fetchChip,
                        {
                          backgroundColor: active ? Colors.accent : Colors.gray[100],
                          borderColor: active ? Colors.accent : Colors.border,
                        },
                        fetching !== null && !active && { opacity: 0.6 },
                      ]}
                      testID={`airport-fetch-${src}`}
                    >
                      {active ? (
                        <ActivityIndicator size="small" color={Colors.onAccent} />
                      ) : (
                        <Download size={14} color={Colors.text} />
                      )}
                      <Text style={{ color: active ? Colors.onAccent : Colors.text, fontSize: 13, fontWeight: "600" as const }}>
                        {src.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  { label: "North", value: bboxN, onChangeText: setBboxN },
                  { label: "South", value: bboxS, onChangeText: setBboxS },
                  { label: "East", value: bboxE, onChangeText: setBboxE },
                  { label: "West", value: bboxW, onChangeText: setBboxW },
                ] as const).map((c) => (
                  <View key={c.label} style={{ flex: 1, gap: 6 }}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>{c.label}</Text>
                    <TextInput
                      value={c.value}
                      onChangeText={c.onChangeText}
                      placeholder="—"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.bboxInput, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={clearBoundary}
                  style={[styles.actionBtn, styles.actionBtnGhost, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                  disabled={!boundary && !geoEntry?.values?.boundary}
                  testID="airport-clear-boundary"
                >
                  <Eraser size={16} color={Colors.text} />
                  <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveBoundary}
                  style={[styles.actionBtn, { backgroundColor: Colors.accent }, !boundary && { opacity: 0.5 }]}
                  disabled={!boundary}
                  testID="airport-save-boundary"
                >
                  <Download size={16} color={Colors.onAccent} />
                  <Text style={[styles.actionBtnGhostText, { color: Colors.onAccent }]}>Save geofence</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          {candidates !== null && (
            <View style={[StyleSheet.absoluteFill, styles.modalBackdrop]}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                onPress={() => { setCandidates(null); setSearchCtx(null); }}
                activeOpacity={1}
              />
              <View style={[styles.modalSheet, { backgroundColor: Colors.background, maxHeight: "80%" }]}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: Colors.text }]}>
                      Select {(candidates?.[0]?.shape.source ?? "osm").toUpperCase()} result
                    </Text>
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {(candidates?.length ?? 0)} matches found
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setCandidates(null); setSearchCtx(null); }}
                    style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  >
                    <X color={Colors.text} size={20} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={candidates ?? []}
                  keyExtractor={(item, idx) => `${item.osmType ?? "x"}-${item.osmId ?? idx}-${idx}`}
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  contentContainerStyle={{ paddingVertical: 8 }}
                  renderItem={({ item }) => {
                    const polyCount = item.shape.polygons?.length ?? 0;
                    const ptCount = item.shape.coords.length;
                    const tag = [item.className, item.type].filter(Boolean).join("/") || "result";
                    return (
                      <TouchableOpacity
                        style={[styles.candidateRow, { backgroundColor: Colors.gray[100] }]}
                        onPress={() => pickCandidate(item)}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={{ color: Colors.text, fontSize: 15 }} numberOfLines={2}>
                            {item.displayName || "(unnamed)"}
                          </Text>
                          <Text style={[styles.rowDesc, { color: Colors.textSecondary, marginTop: 4 }]} numberOfLines={1}>
                            {tag} · {polyCount > 0 ? `${polyCount} poly` : "bbox"} · {ptCount} pts
                          </Text>
                        </View>
                        <ChevronRight size={18} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    );
                  }}
                  ListFooterComponent={
                    <View style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
                      {searchCtx?.exhausted ? (
                        <Text style={[styles.rowDesc, { textAlign: "center", color: Colors.textSecondary }]}>0 more results</Text>
                      ) : (
                        <TouchableOpacity
                          onPress={loadMore}
                          disabled={loadingMore}
                          style={[styles.actionBtn, styles.actionBtnGhost, { alignSelf: "center", borderColor: Colors.border, backgroundColor: Colors.gray[100], flex: 0, paddingHorizontal: 18 }]}
                        >
                          {loadingMore ? (
                            <ActivityIndicator color={Colors.text} />
                          ) : (
                            <>
                              <Download size={14} color={Colors.text} />
                              <Text style={[styles.actionBtnGhostText, { color: Colors.text }]}>More results</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={pickerOpen !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background, maxHeight: "75%" }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>
                Select {pickerOpen ? pickerOpen.charAt(0).toUpperCase() + pickerOpen.slice(1) : ""}
              </Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(null)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="airport-picker-close"
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 480 }}>
              <TouchableOpacity
                onPress={() => onPickFilter("")}
                style={[styles.pickerItem, { borderBottomColor: Colors.border }]}
                testID="airport-picker-all"
              >
                <Text style={[styles.pickerText, { color: Colors.textSecondary }]}>All</Text>
                {!pickerValue && <Check color={Colors.accent} size={18} />}
              </TouchableOpacity>
              {pickerOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => onPickFilter(opt)}
                  style={[styles.pickerItem, { borderBottomColor: Colors.border }]}
                  testID={`airport-picker-${opt}`}
                >
                  <Text style={[styles.pickerText, { color: Colors.text }]}>{opt}</Text>
                  {pickerValue === opt && <Check color={Colors.accent} size={18} />}
                </TouchableOpacity>
              ))}
              {pickerOptions.length === 0 && (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: Colors.textSecondary }}>No options available</Text>
                </View>
              )}
            </ScrollView>
          </View>
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
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  filtersHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  filtersTitle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  filtersTitleText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.5 },
  clearText: { fontSize: 12, fontWeight: "700" as const },
  chipsRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center" as const,
    minWidth: 90,
    maxWidth: 200,
  },
  chipText: { fontSize: 13, fontWeight: "700" as const, textAlign: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
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
  codePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  codeText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 0.5 },
  rowDesc: { fontSize: 12, marginTop: 2 },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
    marginTop: 12,
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
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
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
  pickerItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerText: { fontSize: 15, fontWeight: "600" as const },
  mapBox: {
    height: 260,
    borderRadius: 14,
    overflow: "hidden" as const,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapFallback: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  drawHint: {
    position: "absolute" as const,
    left: 8,
    right: 8,
    bottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center" as const,
  },
  drawHintText: { color: "#fff", fontSize: 12, fontWeight: "600" as const },
  vertexDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  vertexDotText: { fontSize: 10, fontWeight: "700" as const },
  drawRow: { flexDirection: "row" as const, gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnGhost: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionBtnGhostText: { fontWeight: "700" as const, fontSize: 14 },
  fetchChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bboxInput: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
  },
  candidateRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  resultsBox: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden" as const,
  },
  placeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  resultTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  resultName: { fontSize: 14, fontWeight: "700" as const, flexShrink: 1 },
  resultAddr: { fontSize: 11, marginTop: 2 },
  sourceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 0.3 },
  coordsBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  coordsTitle: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 0.3 },
});
