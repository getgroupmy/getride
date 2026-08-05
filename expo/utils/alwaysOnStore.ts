import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/**
 * "Always ON" pages store — the set of app pages on which the device screen
 * must never dim or sleep, configured from Admin -> Settings -> Always ON.
 *
 * A taxi driver's console (the Teksi permit screen, the e-hailing queue and the
 * digital meter) has to stay lit for a whole shift, so those three pages are the
 * built-in defaults until an admin picks their own set. The screen-lock itself
 * is applied on-device by `hooks/useAlwaysOn.ts`, which holds an `expo-keep-awake`
 * lock while the active route is one of the enabled pages.
 *
 * Backed by the shared `settings_entries` table (category `always-on-pages`,
 * a single `config` row whose `values.routes` is a JSON array of route names) —
 * public-read so every device can honour it, admin-write like all config. When
 * the row has never been written the defaults apply; once written, an empty set
 * is respected (an admin who disables every page really does let the screen
 * sleep everywhere). Reads/writes degrade to a device-local AsyncStorage copy
 * when Supabase or the table isn't reachable.
 */

export type AlwaysOnSource = "supabase" | "local" | "default";

export const ALWAYS_ON_CATEGORY = "always-on-pages";
const CONFIG_ROW_ID = "config";
const CACHE_KEY = "alwayson:config:cache";

/** Route names (no leading slash) kept always-on until an admin configures a set. */
export const DEFAULT_ALWAYS_ON_ROUTES: string[] = [
  "partner-teksi",
  "partner-ehailing",
  "meter-digital",
];

export interface AlwaysOnPageOption {
  /** Route name as it appears in the URL, without the leading slash. */
  route: string;
  label: string;
  description: string;
}

/**
 * Curated catalog of pages an admin can toggle from the Always ON screen. These
 * are the screens where a driver or rider watches the device for a long stretch
 * without touching it, so an auto-dim is a real hazard or annoyance. Admins can
 * also add any other route by name from the screen, so this list is a starting
 * point, not a limit.
 */
export const ALWAYS_ON_PAGE_CATALOG: AlwaysOnPageOption[] = [
  { route: "partner-teksi", label: "Teksi Driver Permit", description: "Partner Teksi console — Start Pickup / Meter" },
  { route: "partner-ehailing", label: "Partner e-Hailing", description: "Live incoming-request queue for online partners" },
  { route: "meter-digital", label: "Meter Digital", description: "In-app taxi meter, read off a dash mount all shift" },
  { route: "ride-running", label: "Ride Running (Partner)", description: "Partner's active-trip screen with live navigation" },
  { route: "ride-tracking", label: "Ride Tracking (Rider)", description: "Rider watches the driver approach on the map" },
  { route: "ride-confirm", label: "Ride Confirm (Rider)", description: "Rider waits for a partner to accept the request" },
  { route: "navigation", label: "Navigation", description: "Turn-by-turn navigation view" },
  { route: "vehicle-information", label: "Vehicle Information", description: "Live OBD-II vehicle telemetry" },
  { route: "obd2-reader", label: "OBD-II (CANBus) Reader", description: "Pairing / selecting the vehicle reader" },
  { route: "support-call", label: "Support Call", description: "Active in-app support call" },
  { route: "wallet-scan", label: "Wallet Scan", description: "QR payment scanner held up at the counter" },
  { route: "wallet-show-code", label: "Wallet Show Code", description: "Rider's payment QR shown to be scanned" },
];

export interface AlwaysOnConfig {
  /** Route names (no leading slash) on which the screen stays awake. */
  routes: string[];
  /**
   * True once an admin has written a config row. When false the `routes` are the
   * built-in defaults and callers may treat the set as not-yet-customised.
   */
  configured: boolean;
  updatedAt: string | null;
  source: AlwaysOnSource;
}

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/**
 * Normalise a pathname or route name to a bare first segment, e.g.
 * `/meter-digital?x=1` -> `meter-digital`, `partner-ehailing` -> `partner-ehailing`.
 * Returns `index` for the root so the home map can be targeted by name.
 */
export function normalizeRoute(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = String(input).trim();
  // A whitespace-only value is not a route; only a real root ("/") is `index`.
  if (!trimmed) return "";
  const seg = trimmed.replace(/^\/+/, "").split(/[?#]/)[0].split("/")[0] ?? "";
  if (seg === "") return "index";
  return seg;
}

/** De-duplicate and normalise a list of route names, dropping blanks. */
export function sanitizeRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of routes) {
    const raw = typeof r === "string" ? r : "";
    const norm = normalizeRoute(raw);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** True when the current pathname/route should keep the screen awake. */
export function isRouteAlwaysOn(
  pathname: string | null | undefined,
  routes: string[]
): boolean {
  const current = normalizeRoute(pathname);
  if (!current) return false;
  return routes.some((r) => normalizeRoute(r) === current);
}

function defaultConfig(): AlwaysOnConfig {
  return {
    routes: [...DEFAULT_ALWAYS_ON_ROUTES],
    configured: false,
    updatedAt: null,
    source: "default",
  };
}

/** Parse a stored `values.routes` (JSON string or array) into a route list. */
function parseStoredRoutes(raw: unknown): string[] {
  if (Array.isArray(raw)) return sanitizeRoutes(raw);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return sanitizeRoutes(parsed);
    } catch {
      // Comma-separated fallback for a hand-edited value.
      return sanitizeRoutes(s.split(","));
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Schema-degradation detection
// ---------------------------------------------------------------------------

function isMissingSchemaError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? String((err as { message?: string }).message ?? "") +
        " " +
        String((err as { code?: string }).code ?? "")
      : String(err ?? "");
  return (
    msg.includes("42P01") ||
    msg.includes("PGRST205") ||
    msg.includes("PGRST202") ||
    msg.toLowerCase().includes("could not find") ||
    msg.toLowerCase().includes("does not exist") ||
    msg.toLowerCase().includes("schema cache")
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function readCached(): Promise<AlwaysOnConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AlwaysOnConfig>;
      if (Array.isArray(parsed.routes)) {
        return {
          routes: sanitizeRoutes(parsed.routes),
          configured: parsed.configured ?? true,
          updatedAt: parsed.updatedAt ?? null,
          source: "local",
        };
      }
    }
  } catch (e) {
    console.log("[alwayson] cache read failed", e);
  }
  return null;
}

async function writeCached(config: AlwaysOnConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch (e) {
    console.log("[alwayson] cache write failed", e);
  }
}

// ---------------------------------------------------------------------------
// Fetch / save
// ---------------------------------------------------------------------------

/**
 * Fetch the Always ON page config. Falls back to the cached copy and then to
 * the built-in defaults when Supabase or the table isn't available.
 */
export async function fetchAlwaysOnConfig(): Promise<AlwaysOnConfig> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("settings_entries")
        .select("id, values, updated_at")
        .eq("category", ALWAYS_ON_CATEGORY)
        .eq("id", CONFIG_ROW_ID)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const row = data as { values?: Record<string, unknown>; updated_at?: string };
        const config: AlwaysOnConfig = {
          routes: parseStoredRoutes(row.values?.routes),
          configured: true,
          updatedAt: row.updated_at ?? null,
          source: "supabase",
        };
        await writeCached(config);
        return config;
      }
      // No row yet — defaults apply, but remember we reached the DB.
      return defaultConfig();
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[alwayson] fetch config failed", e);
      } else {
        console.log("[alwayson] settings table missing — using cached/default set");
      }
    }
  }
  const cached = await readCached();
  if (cached) return cached;
  return defaultConfig();
}

export interface SaveAlwaysOnResult {
  ok: boolean;
  error?: string;
  config?: AlwaysOnConfig;
}

/** Persist the Always ON route set (admin only). */
export async function saveAlwaysOnConfig(routes: string[]): Promise<SaveAlwaysOnResult> {
  const clean = sanitizeRoutes(routes);
  const config: AlwaysOnConfig = {
    routes: clean,
    configured: true,
    updatedAt: new Date().toISOString(),
    source: "local",
  };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.from("settings_entries").upsert(
        {
          id: CONFIG_ROW_ID,
          category: ALWAYS_ON_CATEGORY,
          values: { routes: JSON.stringify(clean) },
          updated_at: config.updatedAt,
        },
        { onConflict: "id" }
      );
      if (error) throw error;
      config.source = "supabase";
      await writeCached(config);
      return { ok: true, config };
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[alwayson] save config failed", e);
        return { ok: false, error: "Save failed. Please try again." };
      }
      console.log("[alwayson] settings table missing — saving config locally");
    }
  }

  await writeCached(config);
  return { ok: true, config };
}

/**
 * Subscribe to remote changes to the Always ON config (admin edits land on
 * every device without a relaunch). Returns an unsubscribe function. No-op when
 * Supabase isn't configured.
 */
export function subscribeAlwaysOnConfig(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const client = supabase;
  try {
    const channel = client
      .channel("always-on-config")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "settings_entries",
          filter: `category=eq.${ALWAYS_ON_CATEGORY}`,
        },
        () => {
          onChange();
        }
      )
      .subscribe();
    return () => {
      try {
        client.removeChannel(channel);
      } catch (e) {
        console.log("[alwayson] unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[alwayson] subscribe failed", e);
    return () => {};
  }
}
