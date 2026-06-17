import AsyncStorage from "@react-native-async-storage/async-storage";
import { isSupabaseConfigured, supabase } from "@/utils/supabase";

export interface ApiKeyEntry {
  id: string;
  label: string;
  value: string;
  useCount: number;
  failedCount: number;
  disabled?: boolean;
  lastUsedAt?: number;
  lastFailedAt?: number;
}

export interface ApiServiceDef {
  id: string;
  name: string;
  description?: string;
  keys: ApiKeyEntry[];
}

export interface ApiProviderDef {
  id: string;
  name: string;
  description?: string;
  category?: string;
  services: ApiServiceDef[];
}

export const API_KEYS_STORAGE_KEY = "admin-settings:api-keys-store-v2";

/** Key used in the Supabase `app_settings` table to persist the providers list. */
export const API_KEYS_REMOTE_KEY = "api_providers";

const DEFAULT_PROVIDERS: ApiProviderDef[] = [
  {
    id: "google",
    name: "Google",
    description: "Google Maps Platform services",
    category: "Mapping",
    services: [
      { id: "maps", name: "Maps SDK", description: "Maps SDK, tiles & static maps", keys: [] },
      { id: "places", name: "Places", description: "Place search, autocomplete & details", keys: [] },
      { id: "geocoding", name: "Geocoding", description: "Forward & reverse geocoding", keys: [] },
      { id: "directions", name: "Directions", description: "Routing, ETAs & navigation", keys: [] },
      { id: "distance_matrix", name: "Distance Matrix", description: "Travel time & distance between points", keys: [] },
      { id: "roads", name: "Roads", description: "Snap-to-roads & speed limits", keys: [] },
    ],
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    description: "OSM-based open services",
    category: "Mapping",
    services: [
      { id: "nominatim", name: "Nominatim", description: "Geocoding & boundary lookup", keys: [] },
      { id: "overpass", name: "Overpass API", description: "Custom Overpass server URL", keys: [] },
      { id: "osrm", name: "OSRM Routing", description: "Open Source Routing Machine", keys: [] },
    ],
  },
  {
    id: "mapbox",
    name: "Mapbox",
    description: "Mapbox tiles, geocoding & navigation",
    category: "Mapping",
    services: [
      { id: "tiles", name: "Tiles & Geocoding", description: "Maps & geocoding access token", keys: [] },
      { id: "navigation", name: "Navigation", description: "Turn-by-turn navigation SDK", keys: [] },
    ],
  },
  {
    id: "here",
    name: "HERE",
    description: "HERE maps, routing & traffic",
    category: "Mapping",
    services: [
      { id: "api", name: "HERE API", description: "Maps, geocoding, routing & traffic", keys: [] },
      { id: "app_id", name: "HERE App ID", description: "Legacy HERE App ID", keys: [] },
    ],
  },
  {
    id: "tomtom",
    name: "TomTom",
    description: "TomTom maps, search & traffic",
    category: "Mapping",
    services: [
      { id: "api", name: "TomTom API", description: "Maps, search, routing & traffic", keys: [] },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    description: "Azure & Bing Maps services",
    category: "Mapping",
    services: [
      { id: "azure_maps", name: "Azure Maps", description: "Microsoft Azure Maps services", keys: [] },
      { id: "bing_maps", name: "Bing Maps", description: "Bing Maps tiles, geocoding & routes", keys: [] },
    ],
  },
  {
    id: "apple",
    name: "Apple",
    description: "Apple MapKit JS",
    category: "Mapping",
    services: [
      { id: "mapkit_token", name: "MapKit JS Token", description: "MapKit JS auth token (JWT)", keys: [] },
    ],
  },
  {
    id: "esri",
    name: "Esri",
    description: "ArcGIS basemaps & services",
    category: "Mapping",
    services: [
      { id: "arcgis", name: "ArcGIS API", description: "ArcGIS basemaps, geocoding & routing", keys: [] },
    ],
  },
  {
    id: "tiles",
    name: "Tile Providers",
    description: "Vector & raster tile providers",
    category: "Tiles",
    services: [
      { id: "maptiler", name: "MapTiler", description: "Vector tiles & geocoding", keys: [] },
      { id: "stadia_maps", name: "Stadia Maps", description: "Tiles, geocoding & routing", keys: [] },
      { id: "thunderforest", name: "Thunderforest", description: "OSM-based styled tiles", keys: [] },
    ],
  },
  {
    id: "routing",
    name: "Routing",
    description: "Routing & matrix providers",
    category: "Routing",
    services: [
      { id: "graphhopper", name: "GraphHopper", description: "Routing, matrix & geocoding", keys: [] },
    ],
  },
  {
    id: "geocoding",
    name: "Geocoding",
    description: "Forward & reverse geocoding providers",
    category: "Geocoding",
    services: [
      { id: "locationiq", name: "LocationIQ", description: "Geocoding & maps (Nominatim-based)", keys: [] },
      { id: "opencage", name: "OpenCage", description: "Forward & reverse geocoding", keys: [] },
      { id: "geoapify", name: "Geoapify", description: "Geocoding, places, routing & isolines", keys: [] },
      { id: "positionstack", name: "Positionstack", description: "Forward & reverse geocoding", keys: [] },
      { id: "what3words", name: "what3words", description: "3-word address conversion", keys: [] },
    ],
  },
  {
    id: "geofencing",
    name: "Geofencing",
    description: "Geofencing & tracking",
    category: "Geofencing",
    services: [
      { id: "radar", name: "Radar", description: "Geofencing, geocoding & tracking", keys: [] },
    ],
  },
  {
    id: "places",
    name: "Places",
    description: "Places & venue data",
    category: "Places",
    services: [
      { id: "foursquare", name: "Foursquare", description: "Places search & venue data", keys: [] },
    ],
  },
  {
    id: "google_gemini",
    name: "Google Gemini",
    description: "Google Gemini AI models",
    category: "AI",
    services: [
      { id: "generative_language", name: "Generative Language API", description: "Gemini text, chat & multimodal generation", keys: [] },
      { id: "vision", name: "Vision", description: "Image understanding & OCR via Gemini", keys: [] },
      { id: "embeddings", name: "Embeddings", description: "Text embeddings (text-embedding-004)", keys: [] },
    ],
  },
  {
    id: "ip_geolocation",
    name: "IP Geolocation",
    description: "IP-based geolocation services",
    category: "IP Geolocation",
    services: [
      { id: "ipinfo", name: "IPinfo", description: "IP geolocation lookups", keys: [] },
      { id: "ipgeolocation", name: "ipgeolocation.io", description: "IP-based geolocation service", keys: [] },
    ],
  },
];

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Merge the static default providers/services into a stored list.
 * - Adds any default provider whose `id` is missing from `stored`.
 * - For providers that already exist, adds any default service whose `id`
 *   is missing under that provider.
 * - Never overwrites user-edited names/descriptions/keys/categories.
 * Returns `{ list, changed }` so callers can decide whether to persist back.
 */
export function mergeDefaultProviders(
  stored: ApiProviderDef[]
): { list: ApiProviderDef[]; changed: boolean } {
  let changed = false;
  const byId = new Map<string, ApiProviderDef>();
  stored.forEach((p) => byId.set(p.id, p));

  DEFAULT_PROVIDERS.forEach((def) => {
    const existing = byId.get(def.id);
    if (!existing) {
      byId.set(def.id, {
        ...def,
        services: def.services.map((s) => ({ ...s, keys: [] })),
      });
      changed = true;
      return;
    }
    const svcById = new Map<string, ApiServiceDef>();
    existing.services.forEach((s) => svcById.set(s.id, s));
    let svcChanged = false;
    def.services.forEach((sdef) => {
      if (!svcById.has(sdef.id)) {
        svcById.set(sdef.id, { ...sdef, keys: [] });
        svcChanged = true;
      }
    });
    if (svcChanged) {
      byId.set(def.id, { ...existing, services: Array.from(svcById.values()) });
      changed = true;
    }
  });

  const list = [
    // keep default ordering at the top
    ...DEFAULT_PROVIDERS.map((d) => byId.get(d.id)!).filter(Boolean),
    // followed by any custom providers the user added
    ...stored.filter((p) => !DEFAULT_PROVIDERS.some((d) => d.id === p.id)),
  ];
  return { list, changed };
}

// ---------------------------------------------------------------------------
// Supabase remote storage (single row in `app_settings`, key = API_KEYS_REMOTE_KEY)
// ---------------------------------------------------------------------------

async function readRemote(): Promise<ApiProviderDef[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", API_KEYS_REMOTE_KEY)
      .maybeSingle();
    if (error) {
      console.log("[apiKeysStore] readRemote error", error.message);
      return null;
    }
    const raw = (data?.value ?? null) as unknown;
    if (Array.isArray(raw)) return raw as ApiProviderDef[];
    return null;
  } catch (e) {
    console.log("[apiKeysStore] readRemote exception", e);
    return null;
  }
}

/**
 * Result of attempting to persist providers to Supabase. `ok=false` means the
 * write didn't make it to the remote store — callers should surface the
 * `error` string to the user so silent failures (e.g. RLS rejections) don't
 * stay hidden.
 */
export interface RemoteWriteResult {
  ok: boolean;
  /** Empty when ok=true, otherwise a human-readable reason. */
  error: string;
  /** True when Supabase isn't configured at all (writes are skipped on purpose). */
  skipped: boolean;
}

async function writeRemote(providers: ApiProviderDef[]): Promise<RemoteWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured in this build.", skipped: true };
  }
  try {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: API_KEYS_REMOTE_KEY, value: providers }, { onConflict: "key" });
    if (error) {
      console.log("[apiKeysStore] writeRemote error", error.message);
      return { ok: false, error: error.message, skipped: false };
    }
    return { ok: true, error: "", skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[apiKeysStore] writeRemote exception", msg);
    return { ok: false, error: msg, skipped: false };
  }
}

/**
 * Strip secret key `value`s from a provider list before caching locally.
 * We only cache the *structure* (providers / services / key labels & stats)
 * in AsyncStorage so an attacker who decrypts on-device storage cannot
 * recover the actual API keys. Real key values live only in Supabase
 * (protected by RLS) and in memory while the app is running.
 */
function stripSecrets(providers: ApiProviderDef[]): ApiProviderDef[] {
  return providers.map((p) => ({
    ...p,
    services: p.services.map((s) => ({
      ...s,
      keys: s.keys.map((k) => ({ ...k, value: "" })),
    })),
  }));
}

async function readLocal(): Promise<ApiProviderDef[] | null> {
  try {
    const raw = await AsyncStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiProviderDef[];
    if (!Array.isArray(parsed)) return null;
    // Defensive: even if an older build wrote secrets here, never return them.
    return stripSecrets(parsed);
  } catch (e) {
    console.log("[apiKeysStore] readLocal error", e);
    return null;
  }
}

async function writeLocal(providers: ApiProviderDef[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      API_KEYS_STORAGE_KEY,
      JSON.stringify(stripSecrets(providers))
    );
  } catch (e) {
    console.log("[apiKeysStore] writeLocal error", e);
  }
}

/** True when the providers list has no real key values (e.g. came from local cache). */
function hasAnyKeyValue(providers: ApiProviderDef[]): boolean {
  return providers.some((p) =>
    p.services.some((s) => s.keys.some((k) => k.value.trim().length > 0))
  );
}

/**
 * Load providers. Order of preference:
 *   1. Supabase (`app_settings.value` where key = 'api_providers')
 *   2. AsyncStorage cache (offline fallback)
 *   3. DEFAULT_PROVIDERS (first run)
 *
 * In every case, the static `DEFAULT_PROVIDERS` are merged in so any new
 * providers/services added to this file appear automatically on next load
 * (without overwriting user edits). If the merge changes anything, or if
 * remote/local stores were out of sync, the result is written back so
 * everyone converges.
 */
/**
 * Load providers. Secret key values come ONLY from Supabase — the local
 * AsyncStorage cache stores structure (providers/services/labels/usage) but
 * never the `value` field, so a device compromise can't leak keys.
 *
 * Resolution order:
 *   1. Supabase remote (authoritative; includes real key values)
 *   2. Local cache (offline fallback; keys appear blank)
 *   3. DEFAULT_PROVIDERS (first run)
 */
export async function loadProviders(): Promise<ApiProviderDef[]> {
  const remote = await readRemote();
  const local = await readLocal();

  const base = remote ?? local ?? DEFAULT_PROVIDERS;
  const { list, changed } = mergeDefaultProviders(base);

  // Always push merge results (with secrets) back to Supabase when we have a remote.
  if (remote && changed) {
    await writeRemote(list);
  } else if (!remote && hasAnyKeyValue(list)) {
    // First-time setup that happens to have key values (shouldn't normally happen) —
    // make sure they reach Supabase rather than living only on device.
    await writeRemote(list);
  } else if (!remote) {
    // No remote row yet — seed Supabase with the (key-less) defaults so the
    // row exists and realtime subscribers work. Failures here are logged
    // but not surfaced (this path runs on every cold start).
    await writeRemote(list);
  }

  // Local cache mirrors structure only.
  if (changed || !local || remote) {
    await writeLocal(list);
  }
  return list;
}

/**
 * Persist providers. Real key values are written to Supabase only; the
 * local AsyncStorage cache is stripped of secrets via `writeLocal`.
 *
 * Returns the Supabase write result so callers can surface a clear error
 * (e.g. RLS rejection) to the user. The local mirror is always written so
 * the UI stays responsive even when Supabase is unreachable.
 */
export async function saveProviders(providers: ApiProviderDef[]): Promise<RemoteWriteResult> {
  const remoteResult = await writeRemote(providers);
  await writeLocal(providers);
  return remoteResult;
}

/**
 * Subscribe to Supabase realtime updates for the providers row. The callback
 * receives the freshly-merged list. Returns an unsubscribe function.
 */
export function subscribeProviders(
  onChange: (providers: ApiProviderDef[]) => void
): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  // Use a unique channel name per call so multiple screens can subscribe at
  // the same time. Re-using the same channel name causes Supabase to return
  // the existing (already-subscribed) channel, and adding another
  // `postgres_changes` listener after `subscribe()` throws.
  const channelName = `app_settings:${API_KEYS_REMOTE_KEY}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "app_settings",
        filter: `key=eq.${API_KEYS_REMOTE_KEY}`,
      },
      (payload) => {
        try {
          const row = (payload.new ?? payload.old) as { value?: unknown } | null;
          const raw = row?.value;
          if (!Array.isArray(raw)) return;
          const { list } = mergeDefaultProviders(raw as ApiProviderDef[]);
          writeLocal(list).catch(() => {});
          onChange(list);
        } catch (e) {
          console.log("[apiKeysStore] realtime payload error", e);
        }
      }
    )
    .subscribe();

  return () => {
    try {
      supabase?.removeChannel(channel);
    } catch (e) {
      console.log("[apiKeysStore] unsubscribe error", e);
    }
  };
}

/** Combined result of a mutation: the new list + the remote write outcome. */
export interface MutationResult {
  list: ApiProviderDef[];
  write: RemoteWriteResult;
}

export async function addProvider(name: string): Promise<MutationResult> {
  const list = await loadProviders();
  const next: ApiProviderDef = {
    id: genId("prov"),
    name: name.trim(),
    services: [],
    category: "Custom",
  };
  const updated = [...list, next];
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function removeProvider(providerId: string): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.filter((p) => p.id !== providerId);
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function addService(providerId: string, name: string, description?: string): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    const svc: ApiServiceDef = { id: genId("svc"), name: name.trim(), description, keys: [] };
    return { ...p, services: [...p.services, svc] };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function removeService(providerId: string, serviceId: string): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    return { ...p, services: p.services.filter((s) => s.id !== serviceId) };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function addKey(providerId: string, serviceId: string, label: string, value: string): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    return {
      ...p,
      services: p.services.map((s) => {
        if (s.id !== serviceId) return s;
        const key: ApiKeyEntry = {
          id: genId("key"),
          label: label.trim() || `Key ${s.keys.length + 1}`,
          value: value.trim(),
          useCount: 0,
          failedCount: 0,
        };
        return { ...s, keys: [...s.keys, key] };
      }),
    };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function updateKey(
  providerId: string,
  serviceId: string,
  keyId: string,
  patch: Partial<ApiKeyEntry>
): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    return {
      ...p,
      services: p.services.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          keys: s.keys.map((k) => (k.id === keyId ? { ...k, ...patch } : k)),
        };
      }),
    };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}

export async function removeKey(providerId: string, serviceId: string, keyId: string): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    return {
      ...p,
      services: p.services.map((s) => {
        if (s.id !== serviceId) return s;
        return { ...s, keys: s.keys.filter((k) => k.id !== keyId) };
      }),
    };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}

/**
 * Pick the next available (non-disabled) key with the lowest failedCount, then lowest useCount.
 * Used by callers that want automatic failover.
 */
export function pickNextKey(service: ApiServiceDef): ApiKeyEntry | null {
  const candidates = service.keys.filter((k) => !k.disabled && k.value.trim().length > 0);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.failedCount !== b.failedCount) return a.failedCount - b.failedCount;
    return a.useCount - b.useCount;
  });
  return sorted[0] ?? null;
}

export async function reportKeyUsage(
  providerId: string,
  serviceId: string,
  keyId: string,
  success: boolean
): Promise<MutationResult> {
  const list = await loadProviders();
  const updated = list.map((p) => {
    if (p.id !== providerId) return p;
    return {
      ...p,
      services: p.services.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          keys: s.keys.map((k) => {
            if (k.id !== keyId) return k;
            if (success) {
              return { ...k, useCount: k.useCount + 1, lastUsedAt: Date.now() };
            }
            return { ...k, failedCount: k.failedCount + 1, lastFailedAt: Date.now() };
          }),
        };
      }),
    };
  });
  const write = await saveProviders(updated);
  return { list: updated, write };
}
