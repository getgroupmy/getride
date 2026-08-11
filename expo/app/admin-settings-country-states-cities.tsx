import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Trash2,
  X,
  Search,
  Inbox,
  Globe2,
  MapPin,
  Building2,
  Home,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Check,
  Map as MapIcon,
  Download,
  Eraser,
  Layers,
  PenLine,
  Move,
  Undo2,
  Wrench,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import { Country, State, City, ICountry } from "country-state-city";
import { runWithMappingRotation } from "@/utils/mappingClient";

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
  console.log("[csc] react-native-maps unavailable", e);
}

const PAGE_ID = "country-states-cities" as const;

interface LatLng { latitude: number; longitude: number }
interface BBox { north: number; south: number; east: number; west: number }
interface BoundaryShape { coords: LatLng[]; polygons?: LatLng[][]; bbox: BBox; source: BoundarySource }
type BoundarySource = "osm" | "google" | "geonames" | "bbox" | "manual";

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

interface BoundaryCandidate {
  displayName: string;
  type?: string;
  className?: string;
  osmType?: string;
  osmId?: number | string;
  shape: BoundaryShape;
}
type OsmCandidate = BoundaryCandidate;

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

async function fetchOsmCandidates(query: string, limit: number = 10): Promise<OsmCandidate[]> {
  try {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=${safeLimit}&q=${encodeURIComponent(query)}`;
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
    const out: OsmCandidate[] = [];
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
    console.log("[csc] osm candidates error", e);
    return [];
  }
}

async function fetchGoogleCandidates(query: string): Promise<BoundaryCandidate[]> {
  return runWithMappingRotation(
    PAGE_ID,
    "boundaries",
    async (ctx) => {
      try {
        if (ctx.providerSlug !== "google" || !ctx.key) {
          return { ok: false, value: [] as BoundaryCandidate[] };
        }
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${ctx.key}`;
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
        console.log("[csc] google viewport error", e);
        return { ok: false, value: [] };
      }
    },
    async () => [] as BoundaryCandidate[]
  );
}

async function fetchGeonamesCandidates(query: string, startRow: number = 0, maxRows: number = 10): Promise<BoundaryCandidate[]> {
  try {
    const username = "demo";
    const url = `https://secure.geonames.org/searchJSON?q=${encodeURIComponent(query)}&maxRows=${maxRows}&startRow=${startRow}&username=${username}`;
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
    console.log("[csc] geonames bbox error", e);
    return [];
  }
}

const COUNTRY_LANGUAGE_MAP: Record<string, string> = {
  MY: "ms-MY", US: "en-US", GB: "en-GB", SG: "en-SG", ID: "id-ID", TH: "th-TH",
  PH: "en-PH", VN: "vi-VN", JP: "ja-JP", KR: "ko-KR", CN: "zh-CN", HK: "zh-HK",
  TW: "zh-TW", IN: "en-IN", PK: "ur-PK", BD: "bn-BD", LK: "si-LK", NP: "ne-NP",
  AU: "en-AU", NZ: "en-NZ", CA: "en-CA", FR: "fr-FR", DE: "de-DE", IT: "it-IT",
  ES: "es-ES", PT: "pt-PT", BR: "pt-BR", MX: "es-MX", AR: "es-AR", CL: "es-CL",
  CO: "es-CO", PE: "es-PE", RU: "ru-RU", UA: "uk-UA", AE: "ar-AE", SA: "ar-SA",
  QA: "ar-QA", KW: "ar-KW", OM: "ar-OM", BH: "ar-BH", EG: "ar-EG", MA: "ar-MA",
  TR: "tr-TR", NL: "nl-NL", SE: "sv-SE", NO: "nb-NO", DK: "da-DK", FI: "fi-FI",
  PL: "pl-PL", CH: "de-CH", AT: "de-AT", BE: "nl-BE", IE: "en-IE", ZA: "en-ZA",
  NG: "en-NG", KE: "en-KE", GH: "en-GH", TZ: "sw-TZ", UG: "en-UG", ET: "am-ET",
  IL: "he-IL", GR: "el-GR", CZ: "cs-CZ", HU: "hu-HU", RO: "ro-RO", BG: "bg-BG",
};

const COUNTRY_EMERGENCY_MAP: Record<string, string> = {
  MY: "999", US: "911", GB: "999", SG: "999", ID: "112", TH: "191",
  PH: "911", VN: "113", JP: "110", KR: "112", CN: "110", HK: "999",
  TW: "110", IN: "112", PK: "15", BD: "999", LK: "119", NP: "100",
  AU: "000", NZ: "111", CA: "911", FR: "112", DE: "112", IT: "112",
  ES: "112", PT: "112", BR: "190", MX: "911", AR: "911", CL: "133",
  CO: "123", PE: "105", RU: "112", UA: "112", AE: "999", SA: "999",
  QA: "999", KW: "112", OM: "9999", BH: "999", EG: "122", MA: "19",
  TR: "112", NL: "112", SE: "112", NO: "112", DK: "112", FI: "112",
  PL: "112", CH: "112", AT: "112", BE: "112", IE: "999", ZA: "10111",
  NG: "112", KE: "999", GH: "112", TZ: "112", UG: "999", ET: "991",
  IL: "100", GR: "112", CZ: "112", HU: "112", RO: "112", BG: "112",
};

/** Derive the locale's typical date format like DD/MM/YYYY using Intl. */
function deriveDateFormat(locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.UTC(2000, 0, 2)));
    const out = parts
      .map((p) => {
        if (p.type === "year") return "YYYY";
        if (p.type === "month") return "MM";
        if (p.type === "day") return "DD";
        return p.value;
      })
      .join("");
    return out || "DD/MM/YYYY";
  } catch {
    return "DD/MM/YYYY";
  }
}

/** Country-level defaults derived from ISO code (editable in the form). */
function getCountryDefaults(iso: string): {
  emergencyNumber: string;
  languageCode: string;
  dateFormat: string;
} {
  const code = (iso ?? "").toUpperCase();
  const languageCode = COUNTRY_LANGUAGE_MAP[code] ?? (code ? `en-${code}` : "");
  const emergencyNumber = COUNTRY_EMERGENCY_MAP[code] ?? "";
  const dateFormat = deriveDateFormat(languageCode || "en-US");
  return { emergencyNumber, languageCode, dateFormat };
}

const STORAGE_KEY = "country-states-cities" as const;
const SERVICE_STORAGE_KEY = "service-settings" as const;
const RESET_FLAG_KEY = "@csc_reset_v3";

/** Parse the services map persisted as JSON string in entry.values.services. */
function parseServicesMap(raw: unknown): Record<string, boolean> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, boolean>;
    if (!j || typeof j !== "object") return {};
    const out: Record<string, boolean> = {};
    Object.keys(j).forEach((k) => {
      out[k] = !!j[k];
    });
    return out;
  } catch {
    return {};
  }
}

type Level = "country" | "state" | "city" | "suburb";

interface RegionRow {
  id: string;
  level: Level;
  country: string;
  state: string;
  city: string;
  suburb: string;
  lat?: number;
  lng?: number;
  entry?: SettingEntry;
}

const rowKey = (country: string, state: string, city: string, suburb: string): string =>
  `${country.toLowerCase()}|${state.toLowerCase()}|${city.toLowerCase()}|${suburb.toLowerCase()}`;

export default function AdminSettingsCountryStatesCitiesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry, entries: allEntries } = useAdminData();
  const entries = getEntries(STORAGE_KEY);
  const serviceEntries = getEntries(SERVICE_STORAGE_KEY);
  const services = useMemo(
    () => {
      const list = serviceEntries.map((e, idx) => ({
        id: e.id,
        name: String(e.values.name ?? "Unnamed service"),
        description: String(e.values.description ?? ""),
        priority:
          typeof e.values.displayPriority === "number"
            ? (e.values.displayPriority as number)
            : Number.isFinite(parseFloat(String(e.values.displayPriority ?? "")))
            ? parseFloat(String(e.values.displayPriority))
            : Number.MAX_SAFE_INTEGER,
        idx,
      }));
      list.sort((a, b) => (a.priority - b.priority) || (a.idx - b.idx));
      return list.map(({ id, name, description }) => ({ id, name, description }));
    },
    [serviceEntries]
  );

  // One-time clear of all persisted entries for this key.
  useEffect(() => {
    (async () => {
      try {
        const flag = await AsyncStorage.getItem(RESET_FLAG_KEY);
        if (flag === "done") return;
        const list = allEntries[STORAGE_KEY] ?? [];
        list.forEach((e) => removeEntry(STORAGE_KEY, e.id));
        await AsyncStorage.setItem(RESET_FLAG_KEY, "done");
        console.log("[csc] one-time reset complete, cleared", list.length, "entries");
      } catch (e) {
        console.log("[csc] reset error", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [query, setQuery] = useState<string>("");
  const [selCountry, setSelCountry] = useState<string>("");
  const [selState, setSelState] = useState<string>("");
  const [selCity, setSelCity] = useState<string>("");

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [editEntry, setEditEntry] = useState<SettingEntry | null>(null);
  const [formCountry, setFormCountry] = useState<string>("");
  const [formState, setFormState] = useState<string>("");
  const [formCity, setFormCity] = useState<string>("");
  const [formSuburb, setFormSuburb] = useState<string>("");
  const [formLat, setFormLat] = useState<string>("");
  const [formLng, setFormLng] = useState<string>("");
  const [formServices, setFormServices] = useState<Record<string, boolean>>({});
  const [formBiddingEnabled, setFormBiddingEnabled] = useState<boolean>(true);
  // Country-level metadata
  const [formCurrencyName, setFormCurrencyName] = useState<string>("");
  const [formCurrencySymbol, setFormCurrencySymbol] = useState<string>("");
  const [formEmergencyNumber, setFormEmergencyNumber] = useState<string>("");
  const [formLanguageCode, setFormLanguageCode] = useState<string>("");
  const [formDateFormat, setFormDateFormat] = useState<string>("");
  const [formCallingCode, setFormCallingCode] = useState<string>("");
  // Timezone applies to country, state, and city
  const [formTimezone, setFormTimezone] = useState<string>("");
  const [tzPickerOpen, setTzPickerOpen] = useState<boolean>(false);
  const [tzPickerQuery, setTzPickerQuery] = useState<string>("");
  const [picker, setPicker] = useState<null | "country" | "state" | "city">(null);
  const [pickerQuery, setPickerQuery] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // Map / boundary sheet state
  const [mapRow, setMapRow] = useState<RegionRow | null>(null);
  const [boundary, setBoundary] = useState<BoundaryShape | null>(null);
  const [fetching, setFetching] = useState<BoundarySource | null>(null);
  const [bboxN, setBboxN] = useState<string>("");
  const [bboxS, setBboxS] = useState<string>("");
  const [bboxE, setBboxE] = useState<string>("");
  const [bboxW, setBboxW] = useState<string>("");
  const [osmCandidates, setOsmCandidates] = useState<OsmCandidate[] | null>(null);
  const [searchCtx, setSearchCtx] = useState<{ source: "osm" | "google" | "geonames"; query: string; exhausted: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [drawMode, setDrawMode] = useState<"off" | "draw" | "edit">("off");
  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const mapRef = useRef<unknown>(null);

  const worldCountries: ICountry[] = useMemo(() => Country.getAllCountries(), []);
  const countryByName = useMemo(() => {
    const m = new Map<string, ICountry>();
    worldCountries.forEach((c) => m.set(c.name, c));
    return m;
  }, [worldCountries]);

  const overridesByKey = useMemo(() => {
    const map = new Map<string, SettingEntry>();
    entries.forEach((e) => {
      const c = String(e.values.country ?? "").trim();
      const s = String(e.values.state ?? "").trim();
      const ci = String(e.values.city ?? "").trim();
      const sb = String(e.values.suburb ?? "").trim();
      map.set(rowKey(c, s, ci, sb), e);
    });
    return map;
  }, [entries]);

  const currentLevel: Level = !selCountry
    ? "country"
    : !selState
    ? "state"
    : !selCity
    ? "city"
    : "suburb";

  const rows = useMemo<RegionRow[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string): boolean => !q || label.toLowerCase().includes(q);

    if (currentLevel === "country") {
      const seen = new Set<string>();
      const out: RegionRow[] = [];
      worldCountries.forEach((c) => {
        seen.add(c.name.toLowerCase());
        const k = rowKey(c.name, "", "", "");
        out.push({
          id: k,
          level: "country",
          country: c.name,
          state: "",
          city: "",
          suburb: "",
          entry: overridesByKey.get(k),
        });
      });
      entries.forEach((e) => {
        const cn = String(e.values.country ?? "").trim();
        if (!cn) return;
        if (seen.has(cn.toLowerCase())) return;
        seen.add(cn.toLowerCase());
        const k = rowKey(cn, "", "", "");
        out.push({
          id: k,
          level: "country",
          country: cn,
          state: "",
          city: "",
          suburb: "",
          entry: e,
        });
      });
      return out
        .filter((r) => matches(r.country))
        .sort((a, b) => a.country.localeCompare(b.country));
    }

    if (currentLevel === "state") {
      const c = countryByName.get(selCountry);
      const states = c
        ? State.getStatesOfCountry(c.isoCode).map((s) => s.name)
        : [];
      const seen = new Set<string>(states.map((s) => s.toLowerCase()));
      const out: RegionRow[] = states.map((s) => {
        const k = rowKey(selCountry, s, "", "");
        return {
          id: k,
          level: "state",
          country: selCountry,
          state: s,
          city: "",
          suburb: "",
          entry: overridesByKey.get(k),
        };
      });
      entries.forEach((e) => {
        const cn = String(e.values.country ?? "").trim();
        const sn = String(e.values.state ?? "").trim();
        const ci = String(e.values.city ?? "").trim();
        if (!sn || ci) return;
        if (cn.toLowerCase() !== selCountry.toLowerCase()) return;
        if (seen.has(sn.toLowerCase())) return;
        seen.add(sn.toLowerCase());
        const k = rowKey(selCountry, sn, "", "");
        out.push({
          id: k,
          level: "state",
          country: selCountry,
          state: sn,
          city: "",
          suburb: "",
          entry: e,
        });
      });
      return out
        .filter((r) => matches(r.state))
        .sort((a, b) => a.state.localeCompare(b.state));
    }

    if (currentLevel === "city") {
      const c = countryByName.get(selCountry);
      const st = c
        ? State.getStatesOfCountry(c.isoCode).find((s) => s.name === selState)
        : undefined;
      const cities = c && st ? City.getCitiesOfState(c.isoCode, st.isoCode).map((x) => x.name) : [];
      const seen = new Set<string>(cities.map((s) => s.toLowerCase()));
      const out: RegionRow[] = cities.map((cn) => {
        const k = rowKey(selCountry, selState, cn, "");
        return {
          id: k,
          level: "city",
          country: selCountry,
          state: selState,
          city: cn,
          suburb: "",
          entry: overridesByKey.get(k),
        };
      });
      entries.forEach((e) => {
        const cn = String(e.values.country ?? "").trim();
        const sn = String(e.values.state ?? "").trim();
        const ci = String(e.values.city ?? "").trim();
        const sb = String(e.values.suburb ?? "").trim();
        if (!ci || sb) return;
        if (
          cn.toLowerCase() !== selCountry.toLowerCase() ||
          sn.toLowerCase() !== selState.toLowerCase()
        )
          return;
        if (seen.has(ci.toLowerCase())) return;
        seen.add(ci.toLowerCase());
        const k = rowKey(selCountry, selState, ci, "");
        out.push({
          id: k,
          level: "city",
          country: selCountry,
          state: selState,
          city: ci,
          suburb: "",
          entry: e,
        });
      });
      return out
        .filter((r) => matches(r.city))
        .sort((a, b) => a.city.localeCompare(b.city));
    }

    // Suburbs — only from saved entries.
    const out: RegionRow[] = [];
    entries.forEach((e) => {
      const cn = String(e.values.country ?? "").trim();
      const sn = String(e.values.state ?? "").trim();
      const ci = String(e.values.city ?? "").trim();
      const sb = String(e.values.suburb ?? "").trim();
      if (!sb) return;
      if (
        cn.toLowerCase() !== selCountry.toLowerCase() ||
        sn.toLowerCase() !== selState.toLowerCase() ||
        ci.toLowerCase() !== selCity.toLowerCase()
      )
        return;
      out.push({
        id: rowKey(cn, sn, ci, sb),
        level: "suburb",
        country: cn,
        state: sn,
        city: ci,
        suburb: sb,
        lat: typeof e.values.lat === "number" ? e.values.lat : undefined,
        lng: typeof e.values.lng === "number" ? e.values.lng : undefined,
        entry: e,
      });
    });
    return out
      .filter((r) => matches(r.suburb))
      .sort((a, b) => a.suburb.localeCompare(b.suburb));
  }, [
    currentLevel,
    entries,
    overridesByKey,
    query,
    selCity,
    selCountry,
    selState,
    worldCountries,
    countryByName,
  ]);

  const totalLabel = useMemo(() => {
    const map: Record<Level, string> = {
      country: "countries",
      state: "states",
      city: "cities",
      suburb: "suburbs",
    };
    return `${rows.length} ${map[currentLevel]}`;
  }, [rows.length, currentLevel]);

  const openRow = useCallback((r: RegionRow) => {
    if (r.level === "country") {
      setSelCountry(r.country);
      setQuery("");
    } else if (r.level === "state") {
      setSelState(r.state);
      setQuery("");
    } else if (r.level === "city") {
      setSelCity(r.city);
      setQuery("");
    }
  }, []);

  const goBackBreadcrumb = useCallback(() => {
    if (selCity) {
      setSelCity("");
    } else if (selState) {
      setSelState("");
    } else if (selCountry) {
      setSelCountry("");
    }
    setQuery("");
  }, [selCity, selCountry, selState]);

  const openAdd = useCallback(() => {
    setEditEntry(null);
    setFormCountry(selCountry);
    setFormState(selState);
    setFormCity(selCity);
    setFormSuburb("");
    setFormLat("");
    setFormLng("");
    setFormServices({});
    setFormBiddingEnabled(true);
    setFormCurrencyName("");
    setFormCurrencySymbol("");
    setFormEmergencyNumber("");
    setFormLanguageCode("");
    setFormDateFormat("");
    setFormCallingCode("");
    setFormTimezone("");
    setAddOpen(true);
  }, [selCity, selCountry, selState]);

  const openEdit = useCallback((r: RegionRow) => {
    void countryByName;
    if (r.entry) {
      const v = r.entry.values;
      setEditEntry(r.entry);
      setFormCountry(String(v.country ?? ""));
      setFormState(String(v.state ?? ""));
      setFormCity(String(v.city ?? ""));
      setFormSuburb(String(v.suburb ?? ""));
      setFormLat(typeof v.lat === "number" ? String(v.lat) : "");
      setFormLng(typeof v.lng === "number" ? String(v.lng) : "");
      setFormServices(parseServicesMap(v.services));
      setFormBiddingEnabled(v.biddingEnabled !== false);
      // Fill in country defaults for any missing country-level fields, but keep saved overrides.
      const cn = String(v.country ?? "");
      const isCountryRow = !v.state && !v.city && !v.suburb;
      const ciMeta = countryByName.get(cn);
      const def = isCountryRow && ciMeta ? getCountryDefaults(ciMeta.isoCode) : null;
      const defCurName = ciMeta?.currency ?? "";
      const defCurSym = (ciMeta as { currencySymbol?: string } | undefined)?.currencySymbol ?? "";
      const defCalling = ciMeta?.phonecode
        ? (ciMeta.phonecode.startsWith("+") ? ciMeta.phonecode : `+${ciMeta.phonecode}`)
        : "";
      const defTz = ciMeta?.timezones?.[0]?.zoneName ?? "";
      setFormCurrencyName(String(v.currencyName ?? (isCountryRow ? defCurName : "")));
      setFormCurrencySymbol(String(v.currencySymbol ?? (isCountryRow ? defCurSym : "")));
      setFormEmergencyNumber(String(v.emergencyNumber ?? def?.emergencyNumber ?? ""));
      setFormLanguageCode(String(v.languageCode ?? def?.languageCode ?? ""));
      setFormDateFormat(String(v.dateFormat ?? def?.dateFormat ?? ""));
      setFormCallingCode(String(v.callingCode ?? (isCountryRow ? defCalling : "")));
      setFormTimezone(String(v.timezone ?? (isCountryRow && !v.state && !v.city ? defTz : "")));
    } else {
      // Built-in row — open the form pre-filled so the user can customize it.
      setEditEntry(null);
      // re-reference to satisfy deps below
      void countryByName;
      setFormCountry(r.country);
      setFormState(r.state);
      setFormCity(r.city);
      setFormSuburb(r.suburb);
      setFormLat(typeof r.lat === "number" ? String(r.lat) : "");
      setFormLng(typeof r.lng === "number" ? String(r.lng) : "");
      setFormServices({});
      setFormBiddingEnabled(true);
      // Prefill country defaults from country-state-city when adding a country row.
      const ci = countryByName.get(r.country);
      if (r.level === "country" && ci) {
        setFormCurrencySymbol((ci as { currencySymbol?: string }).currencySymbol ?? "");
        setFormCurrencyName(ci.currency ?? "");
        setFormCallingCode(ci.phonecode ? (ci.phonecode.startsWith("+") ? ci.phonecode : `+${ci.phonecode}`) : "");
        const tz0 = (ci.timezones && ci.timezones[0]?.zoneName) ?? "";
        setFormTimezone(tz0);
        const defaults = getCountryDefaults(ci.isoCode);
        setFormEmergencyNumber(defaults.emergencyNumber);
        setFormLanguageCode(defaults.languageCode);
        setFormDateFormat(defaults.dateFormat);
      } else {
        setFormCurrencyName("");
        setFormCurrencySymbol("");
        setFormCallingCode("");
        setFormTimezone("");
        setFormEmergencyNumber("");
        setFormLanguageCode("");
        setFormDateFormat("");
      }
    }
    setAddOpen(true);
  }, [countryByName]);

  const closeForm = useCallback(() => {
    setAddOpen(false);
    setEditEntry(null);
    setPicker(null);
    setPickerQuery("");
  }, []);

  const onSave = useCallback(async () => {
    if (!guard()) return;
    const c = formCountry.trim();
    const s = formState.trim();
    const ci = formCity.trim();
    const sb = formSuburb.trim();
    if (!c) {
      Alert.alert("Country required", "Please choose or enter a country.");
      return;
    }
    if (currentLevel === "state" && !s) {
      Alert.alert("State required", "Please enter a state name.");
      return;
    }
    if (currentLevel === "city" && (!s || !ci)) {
      Alert.alert("City required", "State and city names are required.");
      return;
    }
    if (currentLevel === "suburb" && (!s || !ci || !sb)) {
      Alert.alert("Suburb required", "State, city and suburb names are required.");
      return;
    }
    const values: Record<string, string | number | boolean> = {
      country: c,
      state: s,
      city: ci,
      suburb: sb,
    };
    const lat = parseFloat(formLat);
    const lng = parseFloat(formLng);
    if (!Number.isNaN(lat)) values.lat = lat;
    if (!Number.isNaN(lng)) values.lng = lng;

    // Country-level metadata persists only when this is a country row (no state/city/suburb)
    const isCountryRow = !s && !ci && !sb;
    if (isCountryRow) {
      values.currencyName = formCurrencyName.trim();
      values.currencySymbol = formCurrencySymbol.trim();
      values.emergencyNumber = formEmergencyNumber.trim();
      values.languageCode = formLanguageCode.trim();
      values.dateFormat = formDateFormat.trim();
      values.callingCode = formCallingCode.trim();
    }
    // Timezone applies at country/state/city (not suburb)
    if (!sb) {
      values.timezone = formTimezone.trim();
    }
    // Persist services map as JSON string (only enabled ones to keep it small).
    const enabledServices: Record<string, boolean> = {};
    Object.keys(formServices).forEach((k) => {
      if (formServices[k]) enabledServices[k] = true;
    });
    values.services = JSON.stringify(enabledServices);
    values.biddingEnabled = formBiddingEnabled;

    setSaving(true);
    try {
      if (editEntry) {
        updateEntry(STORAGE_KEY, editEntry.id, { ...editEntry.values, ...values });
      } else {
        // If a custom override already exists for this exact key, update it instead of duplicating.
        const k = rowKey(c, s, ci, sb);
        const dup = entries.find((e) => {
          const ec = String(e.values.country ?? "");
          const es = String(e.values.state ?? "");
          const eci = String(e.values.city ?? "");
          const esb = String(e.values.suburb ?? "");
          return rowKey(ec, es, eci, esb) === k;
        });
        if (dup) {
          updateEntry(STORAGE_KEY, dup.id, { ...dup.values, ...values });
        } else {
          addEntry(STORAGE_KEY, values);
        }
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  }, [
    addEntry,
    closeForm,
    currentLevel,
    editEntry,
    entries,
    formCity,
    formCountry,
    formLat,
    formLng,
    formState,
    formSuburb,
    formServices,
    formCurrencyName,
    formCurrencySymbol,
    formEmergencyNumber,
    formLanguageCode,
    formDateFormat,
    formCallingCode,
    formTimezone,
    updateEntry,
  ]);

  const openMap = useCallback((r: RegionRow) => {
    setMapRow(r);
    const existing = parseBoundary(r.entry?.values?.boundary);
    setBoundary(existing);
    if (existing) {
      setBboxN(String(existing.bbox.north));
      setBboxS(String(existing.bbox.south));
      setBboxE(String(existing.bbox.east));
      setBboxW(String(existing.bbox.west));
    } else {
      setBboxN("");
      setBboxS("");
      setBboxE("");
      setBboxW("");
    }
  }, []);

  const closeMap = useCallback(() => {
    setMapRow(null);
    setBoundary(null);
    setFetching(null);
    setOsmCandidates(null);
    setSearchCtx(null);
    setDrawMode("off");
    setDraftPoints([]);
  }, []);

  const startDraw = useCallback(() => {
    setDrawMode("draw");
    setDraftPoints([]);
  }, []);

  const startEdit = useCallback(() => {
    if (!boundary || boundary.coords.length === 0) {
      Alert.alert("No polygon", "Fetch or draw a boundary first, then edit its vertices.");
      return;
    }
    setDrawMode("edit");
    setDraftPoints(boundary.coords);
  }, [boundary]);

  const cancelDraw = useCallback(() => {
    setDrawMode("off");
    setDraftPoints([]);
  }, []);

  const undoVertex = useCallback(() => {
    setDraftPoints((prev) => prev.slice(0, -1));
  }, []);

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
    const shape: BoundaryShape = {
      coords: draftPoints,
      polygons: [draftPoints],
      bbox,
      source: "manual",
    };
    setBoundary(shape);
    setBboxN(String(bbox.north));
    setBboxS(String(bbox.south));
    setBboxE(String(bbox.east));
    setBboxW(String(bbox.west));
    setDrawMode("off");
    setDraftPoints([]);
  }, [draftPoints]);

  const onMapPress = useCallback(
    (e: { nativeEvent: { coordinate: LatLng } }) => {
      if (drawMode !== "draw") return;
      const c = e.nativeEvent.coordinate;
      if (!c) return;
      setDraftPoints((prev) => [...prev, { latitude: c.latitude, longitude: c.longitude }]);
    },
    [drawMode]
  );

  const onVertexDrag = useCallback(
    (idx: number, coord: LatLng) => {
      setDraftPoints((prev) => prev.map((p, i) => (i === idx ? coord : p)));
    },
    []
  );

  const removeVertex = useCallback((idx: number) => {
    setDraftPoints((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const pickOsmCandidate = useCallback((c: OsmCandidate) => {
    setBoundary(c.shape);
    setBboxN(String(c.shape.bbox.north));
    setBboxS(String(c.shape.bbox.south));
    setBboxE(String(c.shape.bbox.east));
    setBboxW(String(c.shape.bbox.west));
    setOsmCandidates(null);
    setSearchCtx(null);
  }, []);

  const candidateKey = useCallback((c: BoundaryCandidate, idx: number): string => {
    return `${c.osmType ?? "x"}-${c.osmId ?? idx}`;
  }, []);

  const loadMoreCandidates = useCallback(async () => {
    if (!searchCtx || searchCtx.exhausted || loadingMore) return;
    setLoadingMore(true);
    try {
      const existing = osmCandidates ?? [];
      const seen = new Set(existing.map((c, i) => candidateKey(c, i)));
      let appended: BoundaryCandidate[] = [];
      let exhausted = false;
      if (searchCtx.source === "osm") {
        const nextLimit = Math.min(50, existing.length + 10);
        const fresh = await fetchOsmCandidates(searchCtx.query, nextLimit);
        appended = fresh.filter((c, i) => !seen.has(candidateKey(c, existing.length + i)));
        if (appended.length === 0 || nextLimit >= 50) exhausted = true;
      } else if (searchCtx.source === "geonames") {
        const fresh = await fetchGeonamesCandidates(searchCtx.query, existing.length, 10);
        appended = fresh.filter((c, i) => !seen.has(candidateKey(c, existing.length + i)));
        if (fresh.length < 10 || appended.length === 0) exhausted = true;
      } else {
        exhausted = true;
      }
      if (appended.length > 0) {
        setOsmCandidates([...existing, ...appended]);
      }
      setSearchCtx({ ...searchCtx, exhausted });
    } catch (e) {
      console.log("[csc] load more error", e);
      setSearchCtx({ ...searchCtx, exhausted: true });
    } finally {
      setLoadingMore(false);
    }
  }, [searchCtx, loadingMore, osmCandidates, candidateKey]);

  const queryFromRow = useCallback((r: RegionRow): string => {
    if (r.level === "country") return r.country;
    if (r.level === "state") return `${r.state}, ${r.country}`;
    if (r.level === "city") return `${r.city}, ${r.state}, ${r.country}`;
    return `${r.suburb}, ${r.city}, ${r.state}, ${r.country}`;
  }, []);

  const doFetch = useCallback(
    async (src: Exclude<BoundarySource, "manual">) => {
      if (!mapRow) return;
      setFetching(src);
      try {
        const q = queryFromRow(mapRow);
        let result: BoundaryShape | null = null;
        if (src === "osm" || src === "google" || src === "geonames") {
          const candidates =
            src === "osm"
              ? await fetchOsmCandidates(q)
              : src === "google"
              ? await fetchGoogleCandidates(q)
              : await fetchGeonamesCandidates(q);
          if (candidates.length === 0) {
            Alert.alert("No boundary found", `${src.toUpperCase()} returned no results for this query.`);
            return;
          }
          if (candidates.length === 1) {
            result = candidates[0].shape;
          } else {
            setOsmCandidates(candidates);
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
    },
    [mapRow, queryFromRow, bboxN, bboxS, bboxE, bboxW]
  );

  const saveBoundary = useCallback(() => {
    if (!mapRow || !boundary) return;
    const r = mapRow;
    const overrideValues: Record<string, string | number | boolean> = {
      country: r.country,
      state: r.state,
      city: r.city,
      suburb: r.suburb,
      boundary: JSON.stringify(boundary),
      boundarySource: boundary.source,
      boundaryUpdatedAt: new Date().toISOString(),
    };
    if (r.entry) {
      const existing = { ...r.entry.values, ...overrideValues };
      updateEntry(STORAGE_KEY, r.entry.id, existing);
    } else {
      addEntry(STORAGE_KEY, overrideValues);
    }
    closeMap();
  }, [mapRow, boundary, addEntry, updateEntry, closeMap]);

  const clearBoundary = useCallback(() => {
    if (!mapRow?.entry) {
      setBoundary(null);
      return;
    }
    const v = { ...mapRow.entry.values };
    delete v.boundary;
    delete v.boundarySource;
    delete v.boundaryUpdatedAt;
    updateEntry(STORAGE_KEY, mapRow.entry.id, v);
    setBoundary(null);
  }, [mapRow, updateEntry]);

  const onDelete = useCallback(
    (r: RegionRow) => {
      if (!guard()) return;
      if (!r.entry) {
        Alert.alert("Built-in entry", "Built-in regions cannot be deleted.");
        return;
      }
      Alert.alert("Delete entry", "This will remove the saved entry. Continue?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => removeEntry(STORAGE_KEY, r.entry!.id),
        },
      ]);
    },
    [removeEntry]
  );

  // Picker options (country/state/city) for the Add form.
  const pickerOptions = useMemo<string[]>(() => {
    if (picker === "country") {
      return worldCountries.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    }
    if (picker === "state") {
      const c = countryByName.get(formCountry);
      if (!c) return [];
      return State.getStatesOfCountry(c.isoCode)
        .map((s) => s.name)
        .sort((a, b) => a.localeCompare(b));
    }
    if (picker === "city") {
      const c = countryByName.get(formCountry);
      if (!c) return [];
      const st = State.getStatesOfCountry(c.isoCode).find((s) => s.name === formState);
      if (!st) return [];
      return City.getCitiesOfState(c.isoCode, st.isoCode)
        .map((x) => x.name)
        .sort((a, b) => a.localeCompare(b));
    }
    return [];
  }, [picker, worldCountries, countryByName, formCountry, formState]);

  const filteredPickerOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerOptions;
    return pickerOptions.filter((o) => o.toLowerCase().includes(q));
  }, [pickerOptions, pickerQuery]);

  const styles = createStyles(Colors);

  const renderRow = ({ item }: { item: RegionRow }) => {
    const Icon =
      item.level === "country"
        ? Globe2
        : item.level === "state"
        ? MapPin
        : item.level === "city"
        ? Building2
        : Home;
    const subtitle =
      item.level === "country"
        ? "Tap to view states"
        : item.level === "state"
        ? "Tap to view cities"
        : item.level === "city"
        ? "Tap to view suburbs"
        : item.entry
        ? `${item.lat?.toFixed?.(4) ?? "—"}, ${item.lng?.toFixed?.(4) ?? "—"}`
        : "";
    const isCustom = !!item.entry;
    const hasBoundary = !!parseBoundary(item.entry?.values?.boundary);
    return (
      <TouchableOpacity
        testID={`row-${item.id}`}
        style={styles.row}
        onPress={() => openRow(item)}
        activeOpacity={item.level === "suburb" ? 1 : 0.7}
        accessibilityRole="button"
      >
        <View style={[styles.rowIcon, isCustom && styles.rowIconCustom]}>
          <Icon size={18} color={isCustom ? Colors.accent : Colors.textSecondary} />
        </View>
        <View style={styles.rowMain}>
          <View style={styles.rowTitleRow}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.level === "country"
                ? item.country
                : item.level === "state"
                ? item.state
                : item.level === "city"
                ? item.city
                : item.suburb}
            </Text>
            {isCustom ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Custom</Text>
              </View>
            ) : null}
            {hasBoundary ? (
              <View style={[styles.badge, styles.badgeMap]}>
                <Text style={styles.badgeText}>Boundary</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={() => openMap(item)}
            style={styles.iconBtn}
            testID={`map-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Set the location on a map"
          >
            <MapIcon size={16} color={hasBoundary ? Colors.accent : Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => openEdit(item)}
            style={styles.iconBtn}
            testID={`edit-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Edit"
          >
            <Pencil size={16} color={isCustom ? Colors.accent : Colors.textSecondary} />
          </TouchableOpacity>
          {isCustom ? (
            <TouchableOpacity
              onPress={() => onDelete(item)}
              style={styles.iconBtn}
              testID={`delete-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <Trash2 size={16} color={Colors.error} />
            </TouchableOpacity>
          ) : null}
          {item.level !== "suburb" ? (
            <ChevronRight size={18} color={Colors.gray[400]} />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          testID="back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText}>Regions</Text>
          <Text style={styles.headerSubtitle}>{totalLabel}</Text>
        </View>
        <TouchableOpacity onPress={openAdd} style={styles.headerBtn} testID="add" accessibilityRole="button" accessibilityLabel="Add">
          <Plus size={22} color={Colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Breadcrumb */}
      {(selCountry || selState || selCity) && (
        <View style={styles.crumbBar}>
          <TouchableOpacity onPress={goBackBreadcrumb} style={styles.crumbBack} accessibilityRole="button">
            <ArrowLeft size={14} color={Colors.textSecondary} />
            <Text style={styles.crumbBackText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.crumb}>
            {selCountry ? (
              <CrumbChip
                label={selCountry}
                onPress={() => {
                  setSelState("");
                  setSelCity("");
                }}
                Colors={Colors}
              />
            ) : null}
            {selState ? (
              <CrumbChip
                label={selState}
                onPress={() => setSelCity("")}
                Colors={Colors}
              />
            ) : null}
            {selCity ? <CrumbChip label={selCity} Colors={Colors} /> : null}
          </View>
        </View>
      )}

      <View style={styles.searchBar}>
        <Search size={16} color={Colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${currentLevel}…`}
          placeholderTextColor={Colors.textSecondary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          testID="search"
          accessibilityLabel="Search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery("")} accessibilityRole="button">
            <X size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Inbox size={28} color={Colors.gray[400]} />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySub}>
              {currentLevel === "suburb"
                ? "Add a suburb for this city to get started."
                : "Try a different search or add a custom entry."}
            </Text>
            <TouchableOpacity onPress={openAdd} style={styles.emptyBtn} accessibilityRole="button">
              <Plus size={14} color={Colors.onAccent} />
              <Text style={styles.emptyBtnText}>Add {currentLevel}</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Add / Edit modal */}
      <Modal
        visible={addOpen}
        animationType="slide"
        transparent
        onRequestClose={closeForm}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <View style={styles.modalBackdrop}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={closeForm}
              activeOpacity={1}
              accessibilityRole="button"
            />
            <View style={[styles.sheet, { maxHeight: "92%" }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {editEntry ? "Edit region" : `Add ${currentLevel}`}
                </Text>
                <TouchableOpacity onPress={closeForm} style={styles.iconBtn} accessibilityRole="button">
                  <X size={20} color={Colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
              >
              <FormField
                label="Country"
                value={formCountry}
                onChangeText={setFormCountry}
                onPick={() => {
                  setPickerQuery("");
                  setPicker("country");
                }}
                placeholder="Select country"
                Colors={Colors}
              />
              <FormField
                label="State"
                value={formState}
                onChangeText={setFormState}
                onPick={
                  formCountry
                    ? () => {
                        setPickerQuery("");
                        setPicker("state");
                      }
                    : undefined
                }
                placeholder={
                  formCountry ? "Select or type state" : "Choose a country first"
                }
                Colors={Colors}
              />
              <FormField
                label="City"
                value={formCity}
                onChangeText={setFormCity}
                onPick={
                  formCountry && formState
                    ? () => {
                        setPickerQuery("");
                        setPicker("city");
                      }
                    : undefined
                }
                placeholder={
                  formState ? "Select or type city" : "Choose a state first"
                }
                Colors={Colors}
              />
              <FormField
                label="Suburb (optional)"
                value={formSuburb}
                onChangeText={setFormSuburb}
                placeholder="e.g. Bangsar"
                Colors={Colors}
              />

              {!formState && !formCity && !formSuburb ? (
                <View style={styles.metaBlock}>
                  <Text style={styles.metaTitle}>Country information</Text>
                  <View style={styles.row2}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Currency name</Text>
                      <TextInput
                        value={formCurrencyName}
                        onChangeText={setFormCurrencyName}
                        placeholder="e.g. MYR"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        accessibilityLabel="Currency name"
                      />
                    </View>
                    <View style={styles.col}>
                      <Text style={styles.label}>Currency symbol</Text>
                      <TextInput
                        value={formCurrencySymbol}
                        onChangeText={setFormCurrencySymbol}
                        placeholder="e.g. RM"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        autoCorrect={false}
                        accessibilityLabel="Currency symbol"
                      />
                    </View>
                  </View>
                  <View style={styles.row2}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Emergency number</Text>
                      <TextInput
                        value={formEmergencyNumber}
                        onChangeText={setFormEmergencyNumber}
                        placeholder="e.g. 999"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        keyboardType="phone-pad"
                        accessibilityLabel="Emergency number"
                      />
                    </View>
                    <View style={styles.col}>
                      <Text style={styles.label}>Calling code</Text>
                      <TextInput
                        value={formCallingCode}
                        onChangeText={setFormCallingCode}
                        placeholder="e.g. +60"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        keyboardType="phone-pad"
                        accessibilityLabel="Calling code"
                      />
                    </View>
                  </View>
                  <View style={styles.row2}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Language code</Text>
                      <TextInput
                        value={formLanguageCode}
                        onChangeText={setFormLanguageCode}
                        placeholder="e.g. en-MY"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel="Language code"
                      />
                    </View>
                    <View style={styles.col}>
                      <Text style={styles.label}>Date format</Text>
                      <TextInput
                        value={formDateFormat}
                        onChangeText={setFormDateFormat}
                        placeholder="e.g. DD/MM/YYYY"
                        placeholderTextColor={Colors.textSecondary}
                        style={styles.input}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        accessibilityLabel="Date format"
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              {!formSuburb ? (
                <View style={styles.field}>
                  <Text style={styles.label}>Time zone</Text>
                  <View style={styles.fieldRow}>
                    <TextInput
                      value={formTimezone}
                      onChangeText={setFormTimezone}
                      placeholder="e.g. Asia/Kuala_Lumpur"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { flex: 1 }]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel="Time zone"
                    />
                    {formCountry && countryByName.get(formCountry)?.timezones?.length ? (
                      <TouchableOpacity
                        onPress={() => {
                          setTzPickerQuery("");
                          setTzPickerOpen(true);
                        }}
                        style={styles.pickBtn}
                        testID="tz-pick"
                        accessibilityRole="button"
                        accessibilityLabel="Choose a time zone"
                      >
                        <ChevronDown size={16} color={Colors.text} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View style={styles.servicesBlock}>
                <View style={styles.servicesHeader}>
                  <Wrench size={14} color={Colors.textSecondary} />
                  <Text style={styles.label}>Services</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.servicesCount}>
                    {Object.values(formServices).filter(Boolean).length}/{services.length} on
                  </Text>
                </View>
                {services.length === 0 ? (
                  <Text style={styles.servicesEmpty}>
                    No services defined yet. Add some in Service Settings.
                  </Text>
                ) : (
                  <View style={styles.servicesList}>
                    {services.map((s) => {
                      const on = !!formServices[s.id];
                      return (
                        <View key={s.id} style={styles.serviceRow} testID={`svc-${s.id}`}>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={styles.serviceName} numberOfLines={1}>
                              {s.name}
                            </Text>
                            {s.description ? (
                              <Text style={styles.serviceDesc} numberOfLines={1}>
                                {s.description}
                              </Text>
                            ) : null}
                          </View>
                          <Switch
                            value={on}
                            onValueChange={(v) =>
                              setFormServices((prev) => ({ ...prev, [s.id]: v }))
                            }
                            trackColor={{ true: Colors.accent, false: Colors.gray[300] }}
                            thumbColor={Colors.secondary}
                            accessibilityLabel={s.name}
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              <View style={styles.serviceRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.serviceName}>Bidding (OfferMe)</Text>
                  <Text style={styles.serviceDesc} numberOfLines={2}>
                    {formBiddingEnabled
                      ? "Riders & drivers can raise/lower the fare in this region."
                      : "Fare is locked to the recommended price \u2014 no +/- in this region."}
                  </Text>
                </View>
                <Switch
                  value={formBiddingEnabled}
                  onValueChange={setFormBiddingEnabled}
                  trackColor={{ true: Colors.accent, false: Colors.gray[300] }}
                  thumbColor={Colors.secondary}
                  testID="bidding-toggle"
                  accessibilityLabel="Bidding (OfferMe)"
                />
              </View>

              <View style={styles.row2}>
                <View style={styles.col}>
                  <Text style={styles.label}>Latitude</Text>
                  <TextInput
                    value={formLat}
                    onChangeText={setFormLat}
                    placeholder="—"
                    placeholderTextColor={Colors.textSecondary}
                    style={styles.input}
                    keyboardType="numbers-and-punctuation"
                    accessibilityLabel="Latitude"
                  />
                </View>
                <View style={styles.col}>
                  <Text style={styles.label}>Longitude</Text>
                  <TextInput
                    value={formLng}
                    onChangeText={setFormLng}
                    placeholder="—"
                    placeholderTextColor={Colors.textSecondary}
                    style={styles.input}
                    keyboardType="numbers-and-punctuation"
                    accessibilityLabel="Longitude"
                  />
                </View>
              </View>

              <TouchableOpacity
                onPress={onSave}
                disabled={saving}
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                testID="save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.onAccent} />
                ) : (
                  <>
                    <Check size={16} color={Colors.onAccent} />
                    <Text style={styles.saveBtnText}>
                      {editEntry ? "Update" : "Save"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Map / Boundary sheet */}
      <Modal
        visible={mapRow !== null}
        animationType="slide"
        transparent
        onRequestClose={closeMap}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={closeMap}
            activeOpacity={1}
            accessibilityRole="button"
          />
          <View style={[styles.sheet, { maxHeight: "92%" }]}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Boundary</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {mapRow ? queryFromRow(mapRow) : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={closeMap} style={styles.iconBtn} accessibilityRole="button">
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.mapBox}>
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
                    (boundary.polygons && boundary.polygons.length > 0
                      ? boundary.polygons
                      : [boundary.coords]
                    ).map((ring, idx) => (
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
                              Alert.alert(
                                "Vertex",
                                `Vertex ${idx + 1} of ${draftPoints.length}`,
                                [
                                  { text: "Cancel", style: "cancel" },
                                  {
                                    text: "Remove",
                                    style: "destructive",
                                    onPress: () => removeVertex(idx),
                                  },
                                ]
                              );
                            }
                          }}
                        >
                          <View style={styles.vertexDot}>
                            <Text style={styles.vertexDotText}>{idx + 1}</Text>
                          </View>
                        </MarkerRN>
                      ))
                    : null}
                </MapViewRN>
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.mapFallback]}>
                  <Layers size={20} color={Colors.textSecondary} />
                  <Text style={styles.mapFallbackText}>
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
                    style={[styles.actionBtn, styles.actionBtnGhost]}
                    testID="draw-start"
                    accessibilityRole="button"
                  >
                    <PenLine size={16} color={Colors.text} />
                    <Text style={styles.actionBtnGhostText}>Draw</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={startEdit}
                    style={[styles.actionBtn, styles.actionBtnGhost, !boundary && { opacity: 0.5 }]}
                    disabled={!boundary}
                    testID="draw-edit"
                    accessibilityRole="button"
                  >
                    <Move size={16} color={Colors.text} />
                    <Text style={styles.actionBtnGhostText}>Edit polygon</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={cancelDraw}
                    style={[styles.actionBtn, styles.actionBtnGhost]}
                    testID="draw-cancel"
                    accessibilityRole="button"
                  >
                    <X size={16} color={Colors.text} />
                    <Text style={styles.actionBtnGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  {drawMode === "draw" ? (
                    <TouchableOpacity
                      onPress={undoVertex}
                      style={[styles.actionBtn, styles.actionBtnGhost, draftPoints.length === 0 && { opacity: 0.5 }]}
                      disabled={draftPoints.length === 0}
                      testID="draw-undo"
                      accessibilityRole="button"
                    >
                      <Undo2 size={16} color={Colors.text} />
                      <Text style={styles.actionBtnGhostText}>Undo</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={commitDraft}
                    style={[styles.actionBtn, draftPoints.length < 3 && { opacity: 0.5 }]}
                    disabled={draftPoints.length < 3}
                    testID="draw-finish"
                    accessibilityRole="button"
                  >
                    <Check size={16} color={Colors.onAccent} />
                    <Text style={styles.saveBtnText}>Finish</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.fetchRow}
            >
              <FetchChip
                label="OSM"
                active={fetching === "osm"}
                disabled={fetching !== null}
                onPress={() => doFetch("osm")}
                Colors={Colors}
              />
              <FetchChip
                label="Google"
                active={fetching === "google"}
                disabled={fetching !== null}
                onPress={() => doFetch("google")}
                Colors={Colors}
              />
              <FetchChip
                label="GeoNames"
                active={fetching === "geonames"}
                disabled={fetching !== null}
                onPress={() => doFetch("geonames")}
                Colors={Colors}
              />
              <FetchChip
                label="BBOX"
                active={fetching === "bbox"}
                disabled={fetching !== null}
                onPress={() => doFetch("bbox")}
                Colors={Colors}
              />
            </ScrollView>

            <View style={styles.bboxGrid}>
              <View style={styles.col}>
                <Text style={styles.label}>North</Text>
                <TextInput
                  value={bboxN}
                  onChangeText={setBboxN}
                  placeholder="—"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.input}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel="North"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>South</Text>
                <TextInput
                  value={bboxS}
                  onChangeText={setBboxS}
                  placeholder="—"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.input}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel="South"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>East</Text>
                <TextInput
                  value={bboxE}
                  onChangeText={setBboxE}
                  placeholder="—"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.input}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel="East"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>West</Text>
                <TextInput
                  value={bboxW}
                  onChangeText={setBboxW}
                  placeholder="—"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.input}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel="West"
                />
              </View>
            </View>

            <View style={styles.mapActions}>
              <TouchableOpacity
                onPress={clearBoundary}
                style={[styles.actionBtn, styles.actionBtnGhost]}
                disabled={!boundary && !mapRow?.entry?.values?.boundary}
                testID="clear-boundary"
                accessibilityRole="button"
              >
                <Eraser size={16} color={Colors.text} />
                <Text style={styles.actionBtnGhostText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveBoundary}
                style={[styles.actionBtn, !boundary && { opacity: 0.5 }]}
                disabled={!boundary}
                testID="save-boundary"
                accessibilityRole="button"
              >
                {fetching ? (
                  <ActivityIndicator color={Colors.onAccent} />
                ) : (
                  <>
                    <Download size={16} color={Colors.onAccent} />
                    <Text style={styles.saveBtnText}>Save override</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* OSM results selector (rendered inside parent Modal so it stacks on iOS) */}
          {osmCandidates !== null && (
            <View style={[StyleSheet.absoluteFill, styles.modalBackdrop]}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                onPress={() => { setOsmCandidates(null); setSearchCtx(null); }}
                activeOpacity={1}
                accessibilityRole="button"
              />
              <View style={[styles.sheet, { maxHeight: "80%" }]}>
                <View style={styles.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>Select {(osmCandidates?.[0]?.shape.source ?? "osm").toUpperCase()} result</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {(osmCandidates?.length ?? 0)} matches found
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { setOsmCandidates(null); setSearchCtx(null); }} style={styles.iconBtn} accessibilityRole="button">
                    <X size={20} color={Colors.text} />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={osmCandidates ?? []}
                  keyExtractor={(item, idx) => `${item.osmType ?? "x"}-${item.osmId ?? idx}-${idx}`}
                  ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                  contentContainerStyle={{ paddingVertical: 8 }}
                  renderItem={({ item }) => {
                    const polyCount = item.shape.polygons?.length ?? 0;
                    const ptCount = item.shape.coords.length;
                    const tag = [item.className, item.type].filter(Boolean).join("/") || "result";
                    return (
                      <TouchableOpacity
                        style={styles.pickerRow}
                        onPress={() => pickOsmCandidate(item)}
                        testID={`osm-candidate-${item.osmId ?? ""}`}
                        accessibilityRole="button"
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.pickerText} numberOfLines={2}>
                            {item.displayName || "(unnamed)"}
                          </Text>
                          <Text style={[styles.rowSub, { marginTop: 4 }]} numberOfLines={1}>
                            {tag} · {polyCount > 0 ? `${polyCount} poly` : "bbox"} · {ptCount} pts
                          </Text>
                        </View>
                        <ChevronRight size={18} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={<Text style={styles.pickerEmpty}>No results</Text>}
                  ListFooterComponent={
                    <View style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
                      {searchCtx?.exhausted ? (
                        <Text style={[styles.rowSub, { textAlign: "center" }]}>0 more results</Text>
                      ) : (
                        <TouchableOpacity
                          onPress={loadMoreCandidates}
                          disabled={loadingMore}
                          style={[styles.actionBtn, styles.actionBtnGhost, { alignSelf: "center" }]}
                          testID="load-more-candidates"
                          accessibilityRole="button"
                        >
                          {loadingMore ? (
                            <ActivityIndicator color={Colors.text} />
                          ) : (
                            <>
                              <Download size={14} color={Colors.text} />
                              <Text style={styles.actionBtnGhostText}>More results</Text>
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

      {/* Timezone picker overlay */}
      <Modal
        visible={tzPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setTzPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setTzPickerOpen(false)}
            activeOpacity={1}
            accessibilityRole="button"
          />
          <View style={[styles.sheet, { maxHeight: "80%" }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select time zone</Text>
              <TouchableOpacity onPress={() => setTzPickerOpen(false)} style={styles.iconBtn} accessibilityRole="button">
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchBar}>
              <Search size={16} color={Colors.textSecondary} />
              <TextInput
                value={tzPickerQuery}
                onChangeText={setTzPickerQuery}
                placeholder="Search time zone…"
                placeholderTextColor={Colors.textSecondary}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Select time zone"
              />
            </View>
            <FlatList
              data={(() => {
                const tzs = countryByName.get(formCountry)?.timezones ?? [];
                const q = tzPickerQuery.trim().toLowerCase();
                return tzs.filter((t) =>
                  !q ||
                  t.zoneName?.toLowerCase().includes(q) ||
                  t.abbreviation?.toLowerCase().includes(q) ||
                  t.tzName?.toLowerCase().includes(q)
                );
              })()}
              keyExtractor={(t, i) => `${t.zoneName ?? "tz"}-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setFormTimezone(item.zoneName);
                    setTzPickerOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerText}>{item.zoneName}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[item.abbreviation, item.gmtOffsetName, item.tzName].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={Colors.gray[400]} />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              ListEmptyComponent={<Text style={styles.pickerEmpty}>No matches.</Text>}
            />
          </View>
        </View>
      </Modal>

      {/* Picker overlay */}
      <Modal
        visible={picker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPicker(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setPicker(null)}
            activeOpacity={1}
            accessibilityRole="button"
          />
          <View style={[styles.sheet, { maxHeight: "80%" }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select {picker}</Text>
              <TouchableOpacity onPress={() => setPicker(null)} style={styles.iconBtn} accessibilityRole="button">
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchBar}>
              <Search size={16} color={Colors.textSecondary} />
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder={`Search ${picker}…`}
                placeholderTextColor={Colors.textSecondary}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Search"
              />
            </View>
            <FlatList
              data={filteredPickerOptions}
              keyExtractor={(s) => s}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    if (picker === "country") {
                      setFormCountry(item);
                      if (item !== formCountry) {
                        setFormState("");
                        setFormCity("");
                      }
                    } else if (picker === "state") {
                      setFormState(item);
                      if (item !== formState) setFormCity("");
                    } else if (picker === "city") {
                      setFormCity(item);
                    }
                    setPicker(null);
                    setPickerQuery("");
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.pickerText}>{item}</Text>
                  <ChevronRight size={16} color={Colors.gray[400]} />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              ListEmptyComponent={
                <Text style={styles.pickerEmpty}>No matches.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FetchChip({
  label,
  active,
  disabled,
  onPress,
  Colors,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  Colors: ReturnType<typeof useColors>;
}) {
  const styles = createStyles(Colors);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && !active && { opacity: 0.6 }]}
      testID={`fetch-${label.toLowerCase()}`}
      accessibilityRole="button"
    >
      {active ? (
        <ActivityIndicator size="small" color={Colors.onAccent} />
      ) : (
        <Download size={14} color={Colors.text} />
      )}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CrumbChip({
  label,
  onPress,
  Colors,
}: {
  label: string;
  onPress?: () => void;
  Colors: ReturnType<typeof useColors>;
}) {
  const styles = createStyles(Colors);
  const Wrapper: React.ComponentType<{ children: React.ReactNode }> = ({ children }) =>
    onPress ? (
      <TouchableOpacity onPress={onPress} style={styles.crumbChip} accessibilityRole="button">
        {children}
      </TouchableOpacity>
    ) : (
      <View style={[styles.crumbChip, { opacity: 0.7 }]}>{children}</View>
    );
  return (
    <Wrapper>
      <Text style={styles.crumbChipText} numberOfLines={1}>
        {label}
      </Text>
    </Wrapper>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  onPick,
  Colors,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  onPick?: () => void;
  Colors: ReturnType<typeof useColors>;
}) {
  const styles = createStyles(Colors);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          style={[styles.input, { flex: 1 }]}
          autoCorrect={false}
          accessibilityLabel={label}
        />
        {onPick ? (
          <TouchableOpacity onPress={onPick} style={styles.pickBtn} accessibilityRole="button" accessibilityLabel="Choose">
            <ChevronDown size={16} color={Colors.text} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (Colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: Colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 12,
    },
    headerBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
    },
    headerTitle: { flex: 1, alignItems: "center" },
    headerTitleText: {
      color: Colors.text,
      fontSize: 17,
      fontWeight: "700" as const,
    },
    headerSubtitle: {
      color: Colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    crumbBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    crumbBack: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: Colors.gray[100],
    },
    crumbBackText: { color: Colors.textSecondary, fontSize: 12 },
    crumb: { flexDirection: "row", flex: 1, gap: 6, flexWrap: "wrap" },
    crumbChip: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: Colors.gray[100],
      maxWidth: 160,
    },
    crumbChipText: { color: Colors.text, fontSize: 12, fontWeight: "600" as const },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: Colors.gray[100],
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    searchInput: { flex: 1, color: Colors.text, fontSize: 15, padding: 0 },
    listContent: { paddingHorizontal: 16, paddingBottom: 80 },
    sep: { height: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: Colors.gray[50],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: Colors.gray[100],
    },
    rowIconCustom: { backgroundColor: `${Colors.accent}15` },
    rowMain: { flex: 1 },
    rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rowTitle: {
      color: Colors.text,
      fontSize: 15,
      fontWeight: "600" as const,
      flexShrink: 1,
    },
    rowSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    iconBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },
    badge: {
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: 6,
      backgroundColor: `${Colors.accent}1A`,
    },
    badgeText: { color: Colors.accent, fontSize: 10, fontWeight: "700" as const },
    badgeMap: { backgroundColor: `${Colors.success ?? Colors.accent}1A` },
    mapBox: {
      height: 260,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: Colors.gray[100],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
    },
    mapFallback: {
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    mapFallbackText: { color: Colors.textSecondary, fontSize: 12 },
    fetchRow: { gap: 8, paddingVertical: 4 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: Colors.gray[100],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
    },
    chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
    chipText: { color: Colors.text, fontSize: 13, fontWeight: "600" as const },
    chipTextActive: { color: Colors.onAccent },
    bboxGrid: { flexDirection: "row", gap: 8 },
    mapActions: { flexDirection: "row", gap: 10, marginTop: 4 },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: Colors.accent,
    },
    actionBtnGhost: {
      backgroundColor: Colors.gray[100],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
    },
    actionBtnGhostText: { color: Colors.text, fontWeight: "700" as const, fontSize: 14 },
    drawRow: { flexDirection: "row", gap: 8 },
    drawHint: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
    },
    drawHintText: { color: "#fff", fontSize: 12, fontWeight: "600" as const },
    vertexDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: Colors.accent,
      borderWidth: 2,
      borderColor: "#fff",
      alignItems: "center",
      justifyContent: "center",
    },
    vertexDotText: { color: Colors.onAccent, fontSize: 10, fontWeight: "700" as const },
    empty: { alignItems: "center", paddingVertical: 60, gap: 8 },
    emptyTitle: {
      color: Colors.text,
      fontSize: 15,
      fontWeight: "700" as const,
      marginTop: 6,
    },
    emptySub: {
      color: Colors.textSecondary,
      fontSize: 13,
      textAlign: "center",
      paddingHorizontal: 32,
    },
    emptyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      backgroundColor: Colors.accent,
      borderRadius: 999,
      marginTop: 12,
    },
    emptyBtnText: {
      color: Colors.onAccent,
      fontWeight: "700" as const,
      fontSize: 13,
    },
    modalRoot: { flex: 1 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: Colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 32,
      gap: 12,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    sheetTitle: {
      color: Colors.text,
      fontSize: 18,
      fontWeight: "700" as const,
    },
    field: { gap: 6 },
    label: {
      color: Colors.textSecondary,
      fontSize: 12,
      fontWeight: "600" as const,
    },
    fieldRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: {
      flex: 1,
      backgroundColor: Colors.gray[100],
      color: Colors.text,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      fontSize: 15,
    },
    pickBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: Colors.gray[100],
    },
    row2: { flexDirection: "row", gap: 12 },
    col: { flex: 1, gap: 6 },
    saveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: Colors.accent,
      marginTop: 8,
    },
    saveBtnText: {
      color: Colors.onAccent,
      fontWeight: "700" as const,
      fontSize: 15,
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 12,
      backgroundColor: Colors.gray[50],
      borderRadius: 10,
    },
    pickerText: { color: Colors.text, fontSize: 15 },
    pickerEmpty: {
      color: Colors.textSecondary,
      textAlign: "center",
      padding: 24,
    },
    servicesBlock: {
      gap: 8,
      paddingTop: 4,
    },
    servicesHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    servicesCount: {
      color: Colors.textSecondary,
      fontSize: 11,
      fontWeight: "600" as const,
    },
    servicesEmpty: {
      color: Colors.textSecondary,
      fontSize: 12,
      fontStyle: "italic" as const,
      paddingVertical: 8,
    },
    servicesList: {
      backgroundColor: Colors.gray[50],
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
      overflow: "hidden",
    },
    serviceRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: Colors.border,
    },
    serviceName: {
      color: Colors.text,
      fontSize: 14,
      fontWeight: "600" as const,
    },
    serviceDesc: {
      color: Colors.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    metaBlock: {
      gap: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: Colors.gray[50],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.border,
    },
    metaTitle: {
      color: Colors.text,
      fontSize: 13,
      fontWeight: "700" as const,
    },
  });
