import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Platform,
  InteractionManager,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ChevronLeft,
  Search,
  Smartphone,
  MapPin,
  RefreshCcw,
  X,
  Globe,
  Wifi,
  Clock,
  Hash,
  User as UserIcon,
  Download,
  Calendar,
  Map as MapIcon,
  Flame,
  Route as RouteIcon,
  AlertTriangle,
  Users,
  ShieldCheck,
  Minus,
  Plus,
} from "lucide-react-native";
import MapView, { Marker, Polyline, Circle, PROVIDER_DEFAULT } from "react-native-maps";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { computeDeviceLinks } from "@/utils/deviceLinkage";
import { formatPlmn } from "@/utils/mobileOperator";
import {
  getDeviceGuardConfig,
  setDeviceGuardConfig,
  type DeviceGuardConfig,
} from "@/utils/deviceGuard";

interface SessionRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  event_type: string;
  device_id: string | null;
  os_name: string | null;
  os_version: string | null;
  device_brand: string | null;
  device_manufacturer: string | null;
  device_model_name: string | null;
  device_model_id: string | null;
  device_type: string | null;
  is_physical_device: boolean | null;
  network_type: string | null;
  network_operator: string | null;
  network_is_connected: boolean | null;
  network_is_internet_reachable: boolean | null;
  ip_address: string | null;
  public_ip: string | null;
  connection_type: string | null;
  isp_provider: string | null;
  isp_org: string | null;
  ip_city: string | null;
  ip_region: string | null;
  ip_country: string | null;
  iccid: string | null;
  mobile_operator_name: string | null;
  mobile_country_code: string | null;
  mobile_network_code: string | null;
  cellular_generation: string | null;
  app_version: string | null;
  app_build_version: string | null;
  app_id: string | null;
  captured_at: string;
}

interface LocationRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  session_id: string | null;
  device_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  captured_at: string;
}

interface UserSummary {
  key: string;
  user_id: string | null;
  phone: string | null;
  lastSeen: string;
  sessionCount: number;
  lastDevice: string | null;
  lastOs: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastPingAt: string | null;
  lastIsp: string | null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((c) => csvEscape(String(c))).join(",");
  const body = rows
    .map((r) => columns.map((c) => csvEscape(r[c])).join(","))
    .join("\n");
  return header + "\n" + body;
}

async function exportCsv(filename: string, csv: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!dir) {
      Alert.alert("Export failed", "No writable directory available.");
      return;
    }
    const safeDir = dir.endsWith("/") ? dir : dir + "/";
    const uri = safeDir + filename;
    await FileSystem.writeAsStringAsync(uri, csv, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: "text/csv",
        dialogTitle: filename,
        UTI: "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("Saved", `CSV written to ${uri}`);
    }
  } catch (e) {
    console.log("[csv-export] failed", e);
    Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Cap how many session cards are rendered eagerly inside the detail sheet's
 * list header. Sessions are logged on every app launch / relaunch / login, so
 * an active account can accumulate hundreds of rows; mounting them all at once
 * (they live in a non-virtualized header) can freeze the native UI thread. The
 * full history is always available via the CSV export.
 */
const SESSION_RENDER_CAP = 40;

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

export default function AdminSessionHistoryScreen() {
  const router = useRouter();
  const Colors = useColors();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [latestPings, setLatestPings] = useState<LocationRow[]>([]);
  const [query, setQuery] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    sessions: SessionRow[];
    locations: LocationRow[];
  }>({ sessions: [], locations: [] });
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [showDateFilter, setShowDateFilter] = useState<boolean>(false);
  const [trailVisible, setTrailVisible] = useState<boolean>(false);
  const [trailMode, setTrailMode] = useState<"polyline" | "heatmap">("polyline");
  const [trailMapReady, setTrailMapReady] = useState<boolean>(false);
  const [trailPopupVisible, setTrailPopupVisible] = useState<boolean>(false);
  const [trailScope, setTrailScope] = useState<"today" | "yesterday" | "range">("today");
  const [trailTimeMode, setTrailTimeMode] = useState<"all" | "filter">("all");
  const [trailTimeFrom, setTrailTimeFrom] = useState<string>("00:00");
  const [trailTimeTo, setTrailTimeTo] = useState<string>("23:59");
  const [trailRangeFrom, setTrailRangeFrom] = useState<string>("");
  const [trailRangeTo, setTrailRangeTo] = useState<string>("");
  const [trailLoading, setTrailLoading] = useState<boolean>(false);
  const [trailLocations, setTrailLocations] = useState<LocationRow[]>([]);
  // null = not checked yet, true = reachable, false = down/undeployed.
  const [ipLookupHealthy, setIpLookupHealthy] = useState<boolean | null>(null);
  // When on, only accounts flagged for sharing a device are listed.
  const [flaggedOnly, setFlaggedOnly] = useState<boolean>(false);
  // Admin-configurable duplicate-account guard.
  const [showGuardConfig, setShowGuardConfig] = useState<boolean>(false);
  const [guardConfig, setGuardConfig] = useState<DeviceGuardConfig | null>(null);
  const [savingGuard, setSavingGuard] = useState<boolean>(false);

  useEffect(() => {
    if (!trailVisible) {
      setTrailMapReady(false);
      return;
    }
    const handle = InteractionManager.runAfterInteractions(() => {
      setTrailMapReady(true);
    });
    return () => handle.cancel();
  }, [trailVisible]);

  const loadSessions = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setSessions([]);
      setLatestPings([]);
      setLoading(false);
      return;
    }
    try {
      const [sRes, lRes] = await Promise.all([
        supabase
          .from("user_sessions")
          .select("*")
          .order("captured_at", { ascending: false })
          .limit(1000),
        supabase
          .from("user_location_history")
          .select("*")
          .order("captured_at", { ascending: false })
          .limit(5000),
      ]);
      if (sRes.error) {
        console.log("[admin-session-history] load error", sRes.error.message);
        Alert.alert("Failed to load", sRes.error.message);
        setSessions([]);
      } else {
        setSessions((sRes.data ?? []) as SessionRow[]);
      }
      if (lRes.error) {
        console.log("[admin-session-history] loc err", lRes.error.message);
        setLatestPings([]);
      } else {
        setLatestPings((lRes.data ?? []) as LocationRow[]);
      }
    } catch (e) {
      console.log("[admin-session-history] threw", e);
      setSessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Health probe for the `ip-lookup` edge function. The public IP / ISP / geo
  // columns (public_ip, isp_org, ip_city, ip_region, ip_country) are ONLY ever
  // populated by that function; if it isn't deployed those columns stay null on
  // every session forever. We invoke it with a well-known public IP (Google DNS)
  // so a private-network caller can't produce a false negative: a healthy
  // deployment always resolves 8.8.8.8 to a country.
  const checkIpLookupHealth = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase.functions.invoke<{
        ip_country: string | null;
      }>("ip-lookup", { body: { ip: "8.8.8.8" } });
      setIpLookupHealthy(!error && !!data && !!data.ip_country);
    } catch {
      setIpLookupHealthy(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void checkIpLookupHealth();
    void getDeviceGuardConfig().then(setGuardConfig);
  }, [loadSessions, checkIpLookupHealth]);

  const saveGuardConfig = useCallback(
    async (next: DeviceGuardConfig) => {
      const prev = guardConfig;
      setGuardConfig(next); // optimistic
      setSavingGuard(true);
      const res = await setDeviceGuardConfig(next);
      setSavingGuard(false);
      if (!res.ok) {
        setGuardConfig(prev); // revert
        Alert.alert(
          "Couldn't save",
          res.error === "not_authorized"
            ? "You don't have permission to change this setting."
            : res.error ?? "Please try again."
        );
      }
    },
    [guardConfig]
  );

  const latestPingByKey = useMemo(() => {
    const map = new Map<string, LocationRow>();
    // latestPings is already sorted desc by captured_at.
    for (const l of latestPings) {
      const key = l.user_id ?? (l.phone ? `phone:${l.phone}` : null);
      if (!key) continue;
      if (!map.has(key)) map.set(key, l);
    }
    return map;
  }, [latestPings]);

  const userSummaries = useMemo<UserSummary[]>(() => {
    const map = new Map<string, UserSummary>();
    for (const s of sessions) {
      const key = s.user_id ?? (s.phone ? `phone:${s.phone}` : `anon:${s.id}`);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          user_id: s.user_id,
          phone: s.phone,
          lastSeen: s.captured_at,
          sessionCount: 1,
          lastDevice: s.device_model_name,
          lastOs: s.os_name ? `${s.os_name}${s.os_version ? ` ${s.os_version}` : ""}` : null,
          lastLat: null,
          lastLng: null,
          lastPingAt: null,
          lastIsp: s.isp_provider,
        });
      } else {
        existing.sessionCount += 1;
        if (new Date(s.captured_at) > new Date(existing.lastSeen)) {
          existing.lastSeen = s.captured_at;
          existing.lastDevice = s.device_model_name;
          existing.lastOs = s.os_name ? `${s.os_name}${s.os_version ? ` ${s.os_version}` : ""}` : null;
          existing.lastIsp = s.isp_provider;
        }
      }
    }
    // Attach latest ping.
    for (const u of map.values()) {
      const ping = latestPingByKey.get(u.key);
      if (ping) {
        u.lastLat = ping.latitude;
        u.lastLng = ping.longitude;
        u.lastPingAt = ping.captured_at;
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
  }, [sessions, latestPingByKey]);

  // Fraud / duplicate-account signal: which accounts share a physical device
  // (same device_id) with another account. Presence in the map == flagged.
  const deviceLinks = useMemo(
    () => computeDeviceLinks(sessions),
    [sessions]
  );

  // Accounts that have at least one session from a non-physical device
  // (emulator/simulator) — a fake-account signal.
  const emulatorAccounts = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.is_physical_device === false) {
        const key = s.user_id ?? (s.phone ? `phone:${s.phone}` : null);
        if (key) set.add(key);
      }
    }
    return set;
  }, [sessions]);

  // Resolve an account key (user id or "phone:+…") back to a human label.
  const accountLabel = useCallback(
    (key: string): string => {
      const u = userSummaries.find((x) => x.key === key);
      if (u) {
        if (u.phone) return u.phone;
        if (u.user_id) return `uid ${u.user_id.slice(0, 8)}…`;
      }
      return key.startsWith("phone:") ? key.slice("phone:".length) : key;
    },
    [userSummaries]
  );

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = userSummaries;
    if (flaggedOnly) {
      list = list.filter((u) => deviceLinks.has(u.key));
    }
    if (!q) return list;
    return list.filter((u) => {
      return (
        (u.phone ?? "").toLowerCase().includes(q) ||
        (u.user_id ?? "").toLowerCase().includes(q) ||
        (u.lastDevice ?? "").toLowerCase().includes(q) ||
        (u.lastOs ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, userSummaries, flaggedOnly, deviceLinks]);

  const openDetail = useCallback(
    async (u: UserSummary) => {
      setSelectedKey(u.key);
      setDetailLoading(true);
      setDetail({ sessions: [], locations: [] });
      if (!isSupabaseConfigured || !supabase) {
        setDetailLoading(false);
        return;
      }
      try {
        const sessionFilter = supabase.from("user_sessions").select("*");
        const locationFilter = supabase.from("user_location_history").select("*");
        let sessionsQ;
        let locationsQ;
        if (u.user_id) {
          sessionsQ = sessionFilter.eq("user_id", u.user_id);
          locationsQ = locationFilter.eq("user_id", u.user_id);
        } else if (u.phone) {
          sessionsQ = sessionFilter.eq("phone", u.phone);
          locationsQ = locationFilter.eq("phone", u.phone);
        } else {
          setDetailLoading(false);
          return;
        }
        const [sRes, lRes] = await Promise.all([
          sessionsQ.order("captured_at", { ascending: false }).limit(500),
          locationsQ.order("captured_at", { ascending: false }).limit(2000),
        ]);
        if (sRes.error) console.log("[detail] sessions err", sRes.error.message);
        if (lRes.error) console.log("[detail] locations err", lRes.error.message);
        setDetail({
          sessions: (sRes.data ?? []) as SessionRow[],
          locations: (lRes.data ?? []) as LocationRow[],
        });
      } catch (e) {
        console.log("[detail] threw", e);
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  const closeDetail = useCallback(() => {
    setSelectedKey(null);
    setTrailVisible(false);
    setTrailPopupVisible(false);
    setTrailLocations([]);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadSessions();
    void checkIpLookupHealth();
  }, [loadSessions, checkIpLookupHealth]);

  const dateRange = useMemo(() => {
    const from = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
    const to = toDate ? new Date(toDate + "T23:59:59.999").getTime() : null;
    return { from, to };
  }, [fromDate, toDate]);

  const inRange = useCallback(
    (iso: string) => {
      const t = new Date(iso).getTime();
      if (dateRange.from != null && t < dateRange.from) return false;
      if (dateRange.to != null && t > dateRange.to) return false;
      return true;
    },
    [dateRange]
  );

  const selected = useMemo(
    () => userSummaries.find((u) => u.key === selectedKey) ?? null,
    [userSummaries, selectedKey]
  );

  const filteredDetailSessions = useMemo(
    () => detail.sessions.filter((s) => inRange(s.captured_at)),
    [detail.sessions, inRange]
  );
  const filteredDetailLocations = useMemo(
    () => detail.locations.filter((l) => inRange(l.captured_at)),
    [detail.locations, inRange]
  );

  const fetchTrailLocations = useCallback(
    async (startMs: number, endMs: number): Promise<LocationRow[]> => {
      if (!isSupabaseConfigured || !supabase || !selected) return [];
      let q = supabase.from("user_location_history").select("*");
      if (selected.user_id) {
        q = q.eq("user_id", selected.user_id);
      } else if (selected.phone) {
        q = q.eq("phone", selected.phone);
      } else {
        return [];
      }
      const { data, error } = await q
        .gte("captured_at", new Date(startMs).toISOString())
        .lte("captured_at", new Date(endMs).toISOString())
        .order("captured_at", { ascending: false })
        .limit(5000);
      if (error) {
        console.log("[trail] fetch error", error.message);
        Alert.alert("Failed to load trail", error.message);
        return [];
      }
      return (data ?? []) as LocationRow[];
    },
    [selected]
  );

  const applyTrailFilter = useCallback(async () => {
    if (!selected) return;
    let startMs: number;
    let endMs: number;
    if (trailScope === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      startMs = d.getTime();
      endMs = Date.now();
    } else if (trailScope === "yesterday") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      startMs = d.getTime();
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);
      endMs = e.getTime();
    } else {
      if (!trailRangeFrom || !trailRangeTo) {
        Alert.alert("Pick a range", "Choose both a start and end date.");
        return;
      }
      startMs = new Date(trailRangeFrom + "T00:00:00").getTime();
      endMs = new Date(trailRangeTo + "T23:59:59.999").getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
        Alert.alert("Invalid range", "Check the date range values.");
        return;
      }
    }

    setTrailLoading(true);
    const rows = await fetchTrailLocations(startMs, endMs);
    let filtered = rows;
    if (trailTimeMode === "filter") {
      const [fh, fm] = trailTimeFrom.split(":").map((n) => Number(n) || 0);
      const [th, tm] = trailTimeTo.split(":").map((n) => Number(n) || 0);
      const fromMin = fh * 60 + fm;
      const toMin = th * 60 + tm;
      filtered = rows.filter((l) => {
        const d = new Date(l.captured_at);
        const mins = d.getHours() * 60 + d.getMinutes();
        return fromMin <= toMin
          ? mins >= fromMin && mins <= toMin
          : mins >= fromMin || mins <= toMin;
      });
    }
    setTrailLocations(filtered);
    setTrailLoading(false);
    setTrailPopupVisible(false);
    setTrailMode("polyline");
    setTrailVisible(true);
  }, [selected, trailScope, trailRangeFrom, trailRangeTo, trailTimeMode, trailTimeFrom, trailTimeTo, fetchTrailLocations]);

  const exportAllSessions = useCallback(async () => {
    const filtered = sessions.filter((s) => inRange(s.captured_at));
    if (filtered.length === 0) {
      Alert.alert("Nothing to export", "No sessions in the selected range.");
      return;
    }
    const csv = rowsToCsv(filtered as unknown as Record<string, unknown>[], [
      "captured_at",
      "event_type",
      "user_id",
      "phone",
      "device_id",
      "os_name",
      "os_version",
      "device_brand",
      "device_manufacturer",
      "device_model_name",
      "device_model_id",
      "device_type",
      "is_physical_device",
      "network_type",
      "network_operator",
      "network_is_connected",
      "network_is_internet_reachable",
      "ip_address",
      "public_ip",
      "connection_type",
      "isp_provider",
      "isp_org",
      "ip_city",
      "ip_region",
      "ip_country",
      "iccid",
      "mobile_operator_name",
      "mobile_country_code",
      "mobile_network_code",
      "cellular_generation",
      "app_version",
      "app_build_version",
      "app_id",
      "id",
    ]);
    await exportCsv(`sessions-${Date.now()}.csv`, csv);
  }, [sessions, inRange]);

  const exportDetailCsv = useCallback(
    async (kind: "sessions" | "locations") => {
      const phoneTag = selected?.phone?.replace(/[^0-9]/g, "") || "user";
      if (kind === "sessions") {
        if (filteredDetailSessions.length === 0) {
          Alert.alert("Nothing to export", "No sessions in the selected range.");
          return;
        }
        const csv = rowsToCsv(
          filteredDetailSessions as unknown as Record<string, unknown>[],
          [
            "captured_at",
            "event_type",
            "device_id",
            "os_name",
            "os_version",
            "device_brand",
            "device_model_name",
            "device_model_id",
            "network_type",
            "network_operator",
            "ip_address",
            "public_ip",
            "connection_type",
            "isp_provider",
            "isp_org",
            "ip_city",
            "ip_region",
            "ip_country",
            "iccid",
            "mobile_operator_name",
            "mobile_country_code",
            "mobile_network_code",
            "cellular_generation",
            "app_version",
            "app_build_version",
            "id",
          ]
        );
        await exportCsv(`sessions-${phoneTag}-${Date.now()}.csv`, csv);
      } else {
        if (filteredDetailLocations.length === 0) {
          Alert.alert("Nothing to export", "No location pings in the selected range.");
          return;
        }
        const csv = rowsToCsv(
          filteredDetailLocations as unknown as Record<string, unknown>[],
          [
            "captured_at",
            "latitude",
            "longitude",
            "accuracy",
            "altitude",
            "heading",
            "speed",
            "session_id",
            "device_id",
            "id",
          ]
        );
        await exportCsv(`locations-${phoneTag}-${Date.now()}.csv`, csv);
      }
    },
    [filteredDetailSessions, filteredDetailLocations, selected]
  );

  const trailRegion = useMemo(() => {
    if (trailLocations.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const l of trailLocations) {
      if (l.latitude < minLat) minLat = l.latitude;
      if (l.latitude > maxLat) maxLat = l.latitude;
      if (l.longitude < minLng) minLng = l.longitude;
      if (l.longitude > maxLng) maxLng = l.longitude;
    }
    const latitude = (minLat + maxLat) / 2;
    const longitude = (minLng + maxLng) / 2;
    const latitudeDelta = Math.max(0.01, (maxLat - minLat) * 1.4);
    const longitudeDelta = Math.max(0.01, (maxLng - minLng) * 1.4);
    return { latitude, longitude, latitudeDelta, longitudeDelta };
  }, [trailLocations]);

  /** Sample down dense ping arrays for heatmap rendering to keep it smooth. */
  const heatmapPoints = useMemo(() => {
    const max = 80;
    if (trailLocations.length <= max) return trailLocations;
    const stride = Math.ceil(trailLocations.length / max);
    const out: LocationRow[] = [];
    for (let i = 0; i < trailLocations.length; i += stride) {
      out.push(trailLocations[i]);
    }
    return out;
  }, [trailLocations]);

  /** Pre-compute polyline coordinates once (chronological order: oldest → newest). Aggressively capped to keep native map responsive on Android. */
  const polylineCoords = useMemo(() => {
    const max = 400;
    const src = trailLocations;
    const total = src.length;
    if (total < 2) return [] as { latitude: number; longitude: number }[];
    const stride = total > max ? Math.ceil(total / max) : 1;
    const out: { latitude: number; longitude: number }[] = [];
    // src is sorted newest-first; iterate from the end backwards to get oldest-first.
    for (let i = total - 1; i >= 0; i -= stride) {
      out.push({ latitude: src[i].latitude, longitude: src[i].longitude });
    }
    return out;
  }, [trailLocations]);

  const renderUser = ({ item }: { item: UserSummary }) => {
    const initials = (item.phone ?? item.user_id ?? "?")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(-2)
      .toUpperCase();
    return (
      <TouchableOpacity
        onPress={() => openDetail(item)}
        style={[
          styles.userRow,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
        testID={`user-${item.key}`}
      >
        <View style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}>
          <Text style={[styles.avatarText, { color: Colors.accent }]}>{initials || "?"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.userTitle, { color: Colors.text }]} numberOfLines={1}>
            {item.phone ?? "(no phone)"}
          </Text>
          <Text style={[styles.userSub, { color: Colors.textSecondary }]} numberOfLines={1}>
            {item.lastOs ?? "Unknown OS"}
            {item.lastDevice ? ` · ${item.lastDevice}` : ""}
          </Text>
          <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {item.sessionCount} session{item.sessionCount === 1 ? "" : "s"} · last {formatDate(item.lastSeen)}
          </Text>
          {item.lastIsp ? (
            <View style={styles.ispRow}>
              <Wifi color={Colors.accent} size={12} />
              <Text style={[styles.ispText, { color: Colors.accent }]} numberOfLines={1}>
                {item.lastIsp}
              </Text>
            </View>
          ) : null}
          {(() => {
            const link = deviceLinks.get(item.key);
            if (!link) return null;
            const n = link.linkedAccounts.length;
            return (
              <View style={[styles.dupBadge, { backgroundColor: Colors.warning + "22" }]}>
                <Users color={Colors.warning} size={11} />
                <Text style={[styles.dupBadgeText, { color: Colors.warning }]} numberOfLines={1}>
                  Shares device with {n} other account{n === 1 ? "" : "s"}
                </Text>
              </View>
            );
          })()}
          {emulatorAccounts.has(item.key) ? (
            <View style={[styles.dupBadge, { backgroundColor: Colors.error + "22" }]}>
              <AlertTriangle color={Colors.error} size={11} />
              <Text style={[styles.dupBadgeText, { color: Colors.error }]} numberOfLines={1}>
                Emulator / simulator
              </Text>
            </View>
          ) : null}
        </View>
        {item.lastLat != null && item.lastLng != null ? (
          <View
            style={[
              styles.miniMap,
              { borderColor: Colors.border, backgroundColor: Colors.gray[200], pointerEvents: "none" },
            ]}
          >
            {Platform.OS === "web" ? (
              <View style={styles.miniMapWeb}>
                <MapPin color={Colors.accent} size={18} />
                <Text style={[styles.miniMapWebText, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {item.lastLat.toFixed(3)},{item.lastLng.toFixed(3)}
                </Text>
              </View>
            ) : (
              <MapView
                provider={PROVIDER_DEFAULT}
                style={[styles.miniMapInner, { pointerEvents: "none" }]}
                liteMode
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                region={{
                  latitude: item.lastLat,
                  longitude: item.lastLng,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
              >
                <Marker
                  coordinate={{ latitude: item.lastLat, longitude: item.lastLng }}
                  pinColor={Colors.accent}
                />
              </MapView>
            )}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderSessionCard = (s: SessionRow) => (
    <View
      key={s.id}
      style={[
        styles.card,
        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <View style={[styles.eventPill, { backgroundColor: Colors.accent + "20" }]}>
          <Text style={[styles.eventText, { color: Colors.accent }]}>{s.event_type}</Text>
        </View>
        <View style={styles.rowGap6}>
          <Clock color={Colors.textSecondary} size={12} />
          <Text style={[styles.metaText, { color: Colors.textSecondary }]}>
            {formatDate(s.captured_at)}
          </Text>
        </View>
      </View>
      <View style={styles.kvGrid}>
        <KV
          icon={<Smartphone color={Colors.textSecondary} size={14} />}
          label="Device"
          value={`${s.device_brand ?? s.device_manufacturer ?? "?"} ${s.device_model_name ?? ""}`.trim()}
          Colors={Colors}
        />
        <KV
          icon={<Hash color={Colors.textSecondary} size={14} />}
          label="Model ID"
          value={s.device_model_id ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="OS"
          value={`${s.os_name ?? "?"}${s.os_version ? " " + s.os_version : ""}`}
          Colors={Colors}
        />
        <KV
          icon={<Wifi color={Colors.textSecondary} size={14} />}
          label="Network"
          value={`${s.network_type ?? "?"}${s.network_operator ? " · " + s.network_operator : ""}`}
          Colors={Colors}
        />
        <KV
          icon={<Smartphone color={Colors.textSecondary} size={14} />}
          label="Connection"
          value={s.connection_type ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="ISP / Provider"
          value={s.isp_provider ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="ISP Org"
          value={s.isp_org ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="IP Location"
          value={[s.ip_city, s.ip_region, s.ip_country].filter((v) => !!v).join(", ") || "—"}
          Colors={Colors}
        />
        <KV
          icon={<Smartphone color={Colors.textSecondary} size={14} />}
          label="Mobile Operator"
          value={s.mobile_operator_name ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Hash color={Colors.textSecondary} size={14} />}
          label="MCC / MNC"
          value={formatPlmn(s.mobile_country_code, s.mobile_network_code) ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Wifi color={Colors.textSecondary} size={14} />}
          label="SIM Type"
          value={s.cellular_generation ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Hash color={Colors.textSecondary} size={14} />}
          label="SIM Serial (ICCID)"
          value={s.iccid ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="Local IP"
          value={s.ip_address ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Globe color={Colors.textSecondary} size={14} />}
          label="Public IP"
          value={s.public_ip ?? "—"}
          Colors={Colors}
        />
        <KV
          icon={<Hash color={Colors.textSecondary} size={14} />}
          label="App"
          value={`${s.app_version ?? "?"}${s.app_build_version ? " (" + s.app_build_version + ")" : ""}`}
          Colors={Colors}
        />
        <KV
          icon={<Hash color={Colors.textSecondary} size={14} />}
          label="Device ID"
          value={s.device_id ?? "—"}
          Colors={Colors}
        />
      </View>
    </View>
  );

  const renderLocationRow = (l: LocationRow) => (
    <View
      style={[
        styles.locRow,
        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
      ]}
    >
      <MapPin color={Colors.accent} size={16} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.locCoord, { color: Colors.text }]} numberOfLines={1}>
          {l.latitude.toFixed(6)}, {l.longitude.toFixed(6)}
        </Text>
        <Text style={[styles.metaText, { color: Colors.textSecondary }]} numberOfLines={1}>
          {formatDate(l.captured_at)}
          {l.accuracy != null ? ` · ±${Math.round(l.accuracy)}m` : ""}
          {l.speed != null && l.speed >= 0 ? ` · ${l.speed.toFixed(1)} m/s` : ""}
        </Text>
        {l.device_id ? (
          <Text style={[styles.metaText, { color: Colors.textSecondary }]} numberOfLines={1}>
            Device: {l.device_id}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const renderDetailHeader = () => (
    <View>
      {selected?.lastLat != null && selected?.lastLng != null ? (
        <View
          style={[
            styles.detailMap,
            { borderColor: Colors.border, backgroundColor: Colors.gray[200] },
          ]}
        >
          {Platform.OS === "web" ? (
            <View style={styles.detailMapWeb}>
              <MapPin color={Colors.accent} size={28} />
              <Text style={[styles.kvValue, { color: Colors.text }]}>
                {selected.lastLat.toFixed(6)}, {selected.lastLng.toFixed(6)}
              </Text>
              <Text style={[styles.metaText, { color: Colors.textSecondary }]}>
                {selected.lastPingAt ? formatDate(selected.lastPingAt) : ""}
              </Text>
            </View>
          ) : (
            <MapView
              provider={PROVIDER_DEFAULT}
              style={styles.detailMapInner}
              liteMode
              region={{
                latitude: selected.lastLat,
                longitude: selected.lastLng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              <Marker
                coordinate={{ latitude: selected.lastLat, longitude: selected.lastLng }}
                pinColor={Colors.accent}
                title="Last known location"
                description={selected.lastPingAt ? formatDate(selected.lastPingAt) : undefined}
              />
            </MapView>
          )}
        </View>
      ) : null}

      {selected && deviceLinks.get(selected.key) ? (
        <View
          style={[
            styles.dupCard,
            { backgroundColor: Colors.warning + "14", borderColor: Colors.warning + "55" },
          ]}
          testID="dup-detail-card"
        >
          <View style={styles.rowGap6}>
            <Users color={Colors.warning} size={16} />
            <Text style={[styles.dupCardTitle, { color: Colors.text }]}>
              Possible duplicate account
            </Text>
          </View>
          <Text style={[styles.dupCardBody, { color: Colors.textSecondary }]}>
            Shares {deviceLinks.get(selected.key)!.sharedDevices.length} device
            {deviceLinks.get(selected.key)!.sharedDevices.length === 1 ? "" : "s"} with:
          </Text>
          {deviceLinks.get(selected.key)!.linkedAccounts.map((k) => (
            <Text key={k} style={[styles.dupCardAccount, { color: Colors.text }]} numberOfLines={1}>
              • {accountLabel(k)}
            </Text>
          ))}
        </View>
      ) : null}

      {(fromDate || toDate) && (
        <View
          style={[
            styles.rangePill,
            { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" },
          ]}
        >
          <Calendar color={Colors.accent} size={12} />
          <Text style={[styles.rangePillText, { color: Colors.accent }]}>
            {fromDate || "…"} → {toDate || "…"}
          </Text>
        </View>
      )}

      {detail.locations.length > 0 && Platform.OS !== "web" && (
        <TouchableOpacity
          onPress={() => setTrailPopupVisible(true)}
          style={[styles.trailBtn, { backgroundColor: Colors.accent, marginBottom: 14 }]}
          testID="open-trail"
        >
          <MapIcon color="#000000" size={16} />
          <Text style={styles.trailBtnText}>View full trail</Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.sectionTitle, { color: Colors.text }]}>
        Sessions ({filteredDetailSessions.length}
        {filteredDetailSessions.length !== detail.sessions.length
          ? ` of ${detail.sessions.length}`
          : ""}
        )
      </Text>
      {filteredDetailSessions.length === 0 && (
        <Text style={[styles.muted, { color: Colors.textSecondary }]}>No sessions in range.</Text>
      )}
      {filteredDetailSessions.slice(0, SESSION_RENDER_CAP).map(renderSessionCard)}
      {filteredDetailSessions.length > SESSION_RENDER_CAP && (
        <Text style={[styles.muted, { color: Colors.textSecondary, marginBottom: 10 }]}>
          Showing the {SESSION_RENDER_CAP} most recent of {filteredDetailSessions.length} sessions —
          export CSV for the full list.
        </Text>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 18 }]}>
          Location pings ({filteredDetailLocations.length}
          {filteredDetailLocations.length !== detail.locations.length
            ? ` of ${detail.locations.length}`
            : ""}
          )
        </Text>
        <TouchableOpacity
          onPress={() => exportDetailCsv("locations")}
          style={[styles.exportPill, { backgroundColor: Colors.accent + "20" }]}
        >
          <Download color={Colors.accent} size={12} />
          <Text style={[styles.exportPillText, { color: Colors.accent }]}>CSV</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="back"
        >
          <ChevronLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Session & Location History</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {userSummaries.length} user{userSummaries.length === 1 ? "" : "s"}
          </Text>
        </View>
        {deviceLinks.size > 0 && (
          <TouchableOpacity
            onPress={() => setFlaggedOnly((v) => !v)}
            style={[
              styles.iconBtn,
              { backgroundColor: flaggedOnly ? Colors.warning + "26" : Colors.gray[100] },
            ]}
            testID="toggle-flagged"
          >
            <Users color={flaggedOnly ? Colors.warning : Colors.text} size={20} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setShowGuardConfig((v) => !v)}
          style={[
            styles.iconBtn,
            { backgroundColor: showGuardConfig ? Colors.accent + "20" : Colors.gray[100] },
          ]}
          testID="toggle-guard-config"
        >
          <ShieldCheck color={showGuardConfig ? Colors.accent : Colors.text} size={20} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowDateFilter((v) => !v)}
          style={[
            styles.iconBtn,
            {
              backgroundColor:
                showDateFilter || fromDate || toDate ? Colors.accent + "20" : Colors.gray[100],
            },
          ]}
          testID="toggle-date"
        >
          <Calendar color={showDateFilter || fromDate || toDate ? Colors.accent : Colors.text} size={20} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={exportAllSessions}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="export-all"
        >
          <Download color={Colors.text} size={20} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRefresh}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="refresh"
        >
          <RefreshCcw color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      {showDateFilter && (
        <View style={styles.dateFilterRow}>
          <View
            style={[
              styles.dateInputWrap,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>From</Text>
            <TextInput
              value={fromDate}
              onChangeText={setFromDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.dateInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="date-from"
            />
          </View>
          <View
            style={[
              styles.dateInputWrap,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>To</Text>
            <TextInput
              value={toDate}
              onChangeText={setToDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.dateInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="date-to"
            />
          </View>
          {(fromDate || toDate) && (
            <TouchableOpacity
              onPress={() => {
                setFromDate("");
                setToDate("");
              }}
              style={[styles.iconBtn, { backgroundColor: Colors.gray[100], width: 36, height: 36, borderRadius: 18 }]}
              testID="date-clear"
            >
              <X color={Colors.text} size={16} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <View
        style={[
          styles.searchWrap,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
      >
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search phone, user id, device…"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="search"
        />
      </View>

      {showGuardConfig && (
        <View
          style={[
            styles.guardCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
          testID="guard-config"
        >
          <View style={styles.rowGap6}>
            <ShieldCheck color={Colors.accent} size={16} />
            <Text style={[styles.guardTitle, { color: Colors.text }]}>
              Duplicate-account guard
            </Text>
          </View>
          <Text style={[styles.guardHint, { color: Colors.textSecondary }]}>
            Blocks a new sign-up when its device already backs this many other
            accounts. Enforced at registration.
          </Text>

          <View style={styles.guardRow}>
            <Text style={[styles.guardLabel, { color: Colors.text }]}>Enabled</Text>
            <Switch
              value={guardConfig?.enabled ?? true}
              disabled={!guardConfig || savingGuard}
              onValueChange={(v) => {
                if (guardConfig) void saveGuardConfig({ ...guardConfig, enabled: v });
              }}
              testID="guard-enabled"
            />
          </View>

          <View style={styles.guardRow}>
            <Text style={[styles.guardLabel, { color: Colors.text }]}>
              Max accounts / device
            </Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                onPress={() =>
                  guardConfig &&
                  saveGuardConfig({
                    ...guardConfig,
                    maxAccountsPerDevice: Math.max(1, guardConfig.maxAccountsPerDevice - 1),
                  })
                }
                disabled={!guardConfig || savingGuard || (guardConfig?.maxAccountsPerDevice ?? 1) <= 1}
                style={[styles.stepBtn, { backgroundColor: Colors.gray[200], opacity: (guardConfig?.maxAccountsPerDevice ?? 1) <= 1 ? 0.4 : 1 }]}
                testID="guard-dec"
              >
                <Minus color={Colors.text} size={16} />
              </TouchableOpacity>
              <Text style={[styles.stepValue, { color: Colors.text }]} testID="guard-value">
                {guardConfig?.maxAccountsPerDevice ?? "—"}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  guardConfig &&
                  saveGuardConfig({
                    ...guardConfig,
                    maxAccountsPerDevice: Math.min(50, guardConfig.maxAccountsPerDevice + 1),
                  })
                }
                disabled={!guardConfig || savingGuard}
                style={[styles.stepBtn, { backgroundColor: Colors.gray[200] }]}
                testID="guard-inc"
              >
                <Plus color={Colors.text} size={16} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.guardRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.guardLabel, { color: Colors.text }]}>
                Block emulators
              </Text>
              <Text style={[styles.guardHint, { color: Colors.textSecondary }]}>
                Refuse sign-ups from simulators/emulators. Best-effort — a
                modified client can spoof this.
              </Text>
            </View>
            <Switch
              value={guardConfig?.blockEmulators ?? false}
              disabled={!guardConfig || savingGuard}
              onValueChange={(v) => {
                if (guardConfig) void saveGuardConfig({ ...guardConfig, blockEmulators: v });
              }}
              testID="guard-block-emulators"
            />
          </View>
          {savingGuard && (
            <Text style={[styles.guardHint, { color: Colors.textSecondary }]}>Saving…</Text>
          )}
        </View>
      )}

      {ipLookupHealthy === false && (
        <View
          style={[
            styles.warningBanner,
            { backgroundColor: Colors.warning + "18", borderColor: Colors.warning + "55" },
          ]}
          testID="ip-lookup-warning"
        >
          <AlertTriangle color={Colors.warning} size={16} />
          <Text style={[styles.warningText, { color: Colors.text }]}>
            IP geolocation is unavailable — the{" "}
            <Text style={styles.warningMono}>ip-lookup</Text> edge function is not
            reachable, so Public IP, ISP Org and IP Location won&apos;t be recorded
            on new sessions. Deploy it with{" "}
            <Text style={styles.warningMono}>
              supabase functions deploy ip-lookup --no-verify-jwt
            </Text>
            .
          </Text>
        </View>
      )}

      {deviceLinks.size > 0 && (
        <TouchableOpacity
          onPress={() => setFlaggedOnly((v) => !v)}
          activeOpacity={0.7}
          style={[
            styles.warningBanner,
            {
              backgroundColor: Colors.warning + (flaggedOnly ? "28" : "18"),
              borderColor: Colors.warning + "55",
            },
          ]}
          testID="shared-device-banner"
        >
          <Users color={Colors.warning} size={16} />
          <Text style={[styles.warningText, { color: Colors.text }]}>
            {deviceLinks.size} account{deviceLinks.size === 1 ? "" : "s"} sign in from a
            device also used by another account — possible duplicate / multi-account
            activity.{" "}
            <Text style={{ fontWeight: "800", color: Colors.warning }}>
              {flaggedOnly ? "Showing flagged only — tap to show all." : "Tap to show only these."}
            </Text>
          </Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !isSupabaseConfigured ? (
        <View style={styles.center}>
          <Text style={[styles.muted, { color: Colors.textSecondary }]}>Supabase is not configured.</Text>
        </View>
      ) : filteredUsers.length === 0 ? (
        <View style={styles.center}>
          <UserIcon color={Colors.textSecondary} size={28} />
          <Text style={[styles.muted, { color: Colors.textSecondary, marginTop: 8 }]}>
            {flaggedOnly
              ? "No flagged accounts match. Tap the shared-device filter again to show all."
              : query.trim()
              ? "No users match your search."
              : "No session data yet. Sign in on a device to populate the tables."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(u) => u.key}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      <Modal
        visible={selectedKey !== null}
        animationType="slide"
        onRequestClose={() => (trailVisible ? setTrailVisible(false) : closeDetail())}
        presentationStyle={trailVisible ? "fullScreen" : "pageSheet"}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={["top", "bottom"]}>
          {trailVisible ? (
            <>
              <View style={[styles.header, { borderBottomColor: Colors.border }]}>
                <TouchableOpacity
                  onPress={() => setTrailVisible(false)}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="close-trail"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                  <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
                    Location trail
                  </Text>
                  <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {selected?.phone ?? "(no phone)"} · {trailLocations.length} pings
                  </Text>
                </View>
              </View>

              <View style={styles.trailModeRow}>
                <TouchableOpacity
                  onPress={() => setTrailMode("polyline")}
                  style={[
                    styles.trailModeBtn,
                    {
                      backgroundColor: trailMode === "polyline" ? Colors.accent : Colors.gray[100],
                      borderColor: trailMode === "polyline" ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID="trail-polyline"
                >
                  <RouteIcon color={trailMode === "polyline" ? "#000000" : Colors.text} size={14} />
                  <Text
                    style={[
                      styles.trailModeText,
                      { color: trailMode === "polyline" ? "#000000" : Colors.text },
                    ]}
                  >
                    Path
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setTrailMode("heatmap")}
                  style={[
                    styles.trailModeBtn,
                    {
                      backgroundColor: trailMode === "heatmap" ? Colors.accent : Colors.gray[100],
                      borderColor: trailMode === "heatmap" ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID="trail-heatmap"
                >
                  <Flame color={trailMode === "heatmap" ? "#000000" : Colors.text} size={14} />
                  <Text
                    style={[
                      styles.trailModeText,
                      { color: trailMode === "heatmap" ? "#000000" : Colors.text },
                    ]}
                  >
                    Heatmap
                  </Text>
                </TouchableOpacity>
              </View>

              {Platform.OS === "web" ? (
                <View style={styles.center}>
                  <MapPin color={Colors.textSecondary} size={28} />
                  <Text style={[styles.muted, { color: Colors.textSecondary, marginTop: 8 }]}>
                    Trail view is only available on iOS/Android.
                  </Text>
                </View>
              ) : trailRegion ? (
                !trailMapReady ? (
                  <View style={styles.center}>
                    <ActivityIndicator color={Colors.accent} />
                    <Text style={[styles.muted, { color: Colors.textSecondary, marginTop: 8 }]}>
                      Preparing map…
                    </Text>
                  </View>
                ) : (
                <MapView
                  provider={PROVIDER_DEFAULT}
                  style={{ flex: 1 }}
                  initialRegion={trailRegion}
                  loadingEnabled
                  moveOnMarkerPress={false}
                  toolbarEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  {trailMode === "polyline" && polylineCoords.length > 1 && Polyline && (
                    <Polyline
                      coordinates={polylineCoords}
                      strokeColor={Colors.accent}
                      strokeWidth={3}
                    />
                  )}
                  {trailMode === "polyline" && trailLocations.length > 0 && (
                    <>
                      <Marker
                        coordinate={{
                          latitude: trailLocations[trailLocations.length - 1].latitude,
                          longitude: trailLocations[trailLocations.length - 1].longitude,
                        }}
                        pinColor="green"
                        title="Start"
                        description={formatDate(
                          trailLocations[trailLocations.length - 1].captured_at
                        )}
                      />
                      <Marker
                        coordinate={{
                          latitude: trailLocations[0].latitude,
                          longitude: trailLocations[0].longitude,
                        }}
                        pinColor="red"
                        title="End"
                        description={formatDate(trailLocations[0].captured_at)}
                      />
                    </>
                  )}
                  {trailMode === "heatmap" &&
                    Circle &&
                    heatmapPoints.map((l) => (
                      <Circle
                        key={l.id}
                        center={{ latitude: l.latitude, longitude: l.longitude }}
                        radius={80}
                        strokeColor="rgba(239,68,68,0.0)"
                        fillColor="rgba(239,68,68,0.18)"
                      />
                    ))}
                </MapView>
                )
              ) : (
                <View style={styles.center}>
                  <Text style={[styles.muted, { color: Colors.textSecondary }]}>
                    No location pings to display.
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <View style={[styles.header, { borderBottomColor: Colors.border }]}>
                <TouchableOpacity
                  onPress={closeDetail}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="close-detail"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                  <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
                    {selected?.phone ?? "(no phone)"}
                  </Text>
                  <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {selected?.user_id ? `uid ${selected.user_id.slice(0, 8)}…` : "no auth uid"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => exportDetailCsv("sessions")}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="export-detail"
                >
                  <Download color={Colors.text} size={18} />
                </TouchableOpacity>
              </View>

              {detailLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={Colors.accent} />
                </View>
              ) : (
                <FlatList
                  data={filteredDetailLocations}
                  keyExtractor={(l) => l.id}
                  renderItem={({ item }) => renderLocationRow(item)}
                  ListHeaderComponent={renderDetailHeader}
                  ListEmptyComponent={
                    <Text style={[styles.muted, { color: Colors.textSecondary }]}>
                      No location pings in range.
                    </Text>
                  }
                  contentContainerStyle={{ padding: 16 }}
                  initialNumToRender={15}
                  maxToRenderPerBatch={20}
                  windowSize={11}
                  keyboardShouldPersistTaps="handled"
                />
              )}
            </>
          )}

          {trailPopupVisible && (
            <View style={styles.trailPopupOverlay}>
              <View
                style={[
                  styles.trailPopupCard,
                  { backgroundColor: Colors.background, borderColor: Colors.border },
                ]}
              >
                <Text style={[styles.trailPopupTitle, { color: Colors.text }]}>Location trail</Text>
                <Text style={[styles.trailPopupSubtitle, { color: Colors.textSecondary }]}>
                  Choose which pings to pull
                </Text>

                <View style={styles.trailPopupRow}>
                  {(
                    [
                      { key: "today", label: "Today" },
                      { key: "yesterday", label: "Yesterday" },
                      { key: "range", label: "Date range" },
                    ] as const
                  ).map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setTrailScope(opt.key)}
                      style={[
                        styles.trailModeBtn,
                        {
                          flex: 1,
                          justifyContent: "center",
                          backgroundColor: trailScope === opt.key ? Colors.accent : Colors.gray[100],
                          borderColor: trailScope === opt.key ? Colors.accent : Colors.border,
                        },
                      ]}
                      testID={`trail-scope-${opt.key}`}
                    >
                      <Text
                        style={[
                          styles.trailModeText,
                          { color: trailScope === opt.key ? "#000000" : Colors.text },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {trailScope === "range" && (
                  <View style={styles.dateFilterRow}>
                    <View
                      style={[
                        styles.dateInputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>From</Text>
                      <TextInput
                        value={trailRangeFrom}
                        onChangeText={setTrailRangeFrom}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.dateInput, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="trail-range-from"
                      />
                    </View>
                    <View
                      style={[
                        styles.dateInputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>To</Text>
                      <TextInput
                        value={trailRangeTo}
                        onChangeText={setTrailRangeTo}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.dateInput, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="trail-range-to"
                      />
                    </View>
                  </View>
                )}

                <Text style={[styles.trailPopupSubtitle, { color: Colors.textSecondary, marginTop: 16 }]}>
                  Time of day
                </Text>
                <View style={styles.trailPopupRow}>
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "filter", label: "Time filter" },
                    ] as const
                  ).map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setTrailTimeMode(opt.key)}
                      style={[
                        styles.trailModeBtn,
                        {
                          flex: 1,
                          justifyContent: "center",
                          backgroundColor: trailTimeMode === opt.key ? Colors.accent : Colors.gray[100],
                          borderColor: trailTimeMode === opt.key ? Colors.accent : Colors.border,
                        },
                      ]}
                      testID={`trail-timemode-${opt.key}`}
                    >
                      <Text
                        style={[
                          styles.trailModeText,
                          { color: trailTimeMode === opt.key ? "#000000" : Colors.text },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {trailTimeMode === "filter" && (
                  <View style={styles.dateFilterRow}>
                    <View
                      style={[
                        styles.dateInputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>From</Text>
                      <TextInput
                        value={trailTimeFrom}
                        onChangeText={setTrailTimeFrom}
                        placeholder="HH:MM"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.dateInput, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="trail-time-from"
                      />
                    </View>
                    <View
                      style={[
                        styles.dateInputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text style={[styles.dateLabel, { color: Colors.textSecondary }]}>To</Text>
                      <TextInput
                        value={trailTimeTo}
                        onChangeText={setTrailTimeTo}
                        placeholder="HH:MM"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.dateInput, { color: Colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="trail-time-to"
                      />
                    </View>
                  </View>
                )}

                <View style={styles.trailPopupActions}>
                  <TouchableOpacity
                    onPress={() => setTrailPopupVisible(false)}
                    style={[styles.popupBtn, { backgroundColor: Colors.gray[100] }]}
                    disabled={trailLoading}
                    testID="trail-popup-cancel"
                  >
                    <Text style={[styles.popupBtnText, { color: Colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={applyTrailFilter}
                    style={[styles.popupBtn, { backgroundColor: Colors.accent }]}
                    disabled={trailLoading}
                    testID="trail-popup-apply"
                  >
                    {trailLoading ? (
                      <ActivityIndicator color="#000000" size="small" />
                    ) : (
                      <Text style={[styles.popupBtnText, { color: "#000000" }]}>Show trail</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function KV({
  icon,
  label,
  value,
  Colors,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  Colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.kvItem}>
      <View style={styles.rowGap6}>
        {icon}
        <Text style={[styles.kvLabel, { color: Colors.textSecondary }]}>{label}</Text>
      </View>
      <Text style={[styles.kvValue, { color: Colors.text }]} numberOfLines={2}>
        {value || "—"}
      </Text>
    </View>
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
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: "800" as const },
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
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  warningBanner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  warningText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600" as const },
  warningMono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontWeight: "700" as const,
  },
  guardCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  guardTitle: { fontSize: 14, fontWeight: "800" as const },
  guardHint: { fontSize: 11, lineHeight: 15 },
  guardRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 2,
  },
  guardLabel: { fontSize: 13, fontWeight: "600" as const },
  stepper: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stepValue: { fontSize: 16, fontWeight: "800" as const, minWidth: 24, textAlign: "center" as const },
  listContent: { padding: 16 },
  userRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  avatarText: { fontSize: 14, fontWeight: "800" as const },
  userTitle: { fontSize: 15, fontWeight: "700" as const },
  userSub: { fontSize: 12, marginTop: 2 },
  userMeta: { fontSize: 11, marginTop: 2 },
  ispRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 3 },
  ispText: { fontSize: 11, fontWeight: "600" as const, flexShrink: 1 },
  dupBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "flex-start" as const,
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  dupBadgeText: { fontSize: 10, fontWeight: "800" as const, flexShrink: 1 },
  dupCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  dupCardTitle: { fontSize: 14, fontWeight: "800" as const },
  dupCardBody: { fontSize: 12, fontWeight: "600" as const },
  dupCardAccount: { fontSize: 13, fontWeight: "700" as const },
  center: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, padding: 24 },
  muted: { fontSize: 13, textAlign: "center" as const },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const, marginBottom: 10 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 10,
  },
  eventPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  eventText: { fontSize: 11, fontWeight: "800" as const, textTransform: "uppercase" as const },
  rowGap6: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  metaText: { fontSize: 11 },
  kvGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
  },
  kvItem: { flexBasis: "48%" as const, flexGrow: 1 },
  kvLabel: { fontSize: 11, fontWeight: "600" as const },
  kvValue: { fontSize: 13, marginTop: 2, fontWeight: "600" as const },
  locRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  locCoord: { fontSize: 13, fontWeight: "700" as const },
  miniMap: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  miniMapInner: { width: "100%" as const, height: "100%" as const },
  miniMapWeb: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
    paddingHorizontal: 4,
  },
  miniMapWebText: { fontSize: 9, fontWeight: "600" as const },
  detailMap: {
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden" as const,
    marginBottom: 16,
  },
  detailMapInner: { width: "100%" as const, height: "100%" as const },
  detailMapWeb: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  exportPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 18,
  },
  exportPillText: { fontSize: 11, fontWeight: "800" as const, textTransform: "uppercase" as const },
  dateFilterRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  dateInputWrap: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateLabel: { fontSize: 10, fontWeight: "700" as const, textTransform: "uppercase" as const },
  dateInput: { fontSize: 13, paddingVertical: 2, fontWeight: "600" as const },
  trailBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  trailBtnText: { color: "#000000", fontSize: 14, fontWeight: "800" as const },
  trailModeRow: {
    flexDirection: "row" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  trailModeBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  trailModeText: { fontSize: 13, fontWeight: "700" as const },
  rangePill: {
    alignSelf: "flex-start" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 12,
  },
  rangePillText: { fontSize: 11, fontWeight: "700" as const },
  trailPopupOverlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 50,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 20,
  },
  trailPopupCard: {
    width: "100%" as const,
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
  },
  trailPopupTitle: { fontSize: 17, fontWeight: "800" as const },
  trailPopupSubtitle: { fontSize: 12, marginTop: 4, marginBottom: 10 },
  trailPopupRow: {
    flexDirection: "row" as const,
    gap: 8,
  },
  trailPopupActions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 20,
  },
  popupBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  popupBtnText: { fontSize: 14, fontWeight: "800" as const },
});
