import AsyncStorage from "@react-native-async-storage/async-storage";
import { isSupabaseConfigured, supabase } from "@/utils/supabase";

/**
 * Control & monitoring store for the Elife Transfer "Fleet & Ride Management"
 * API integration. Mirrors the persistence approach used by `apiKeysStore`:
 * the authoritative copy lives in Supabase (`app_settings.value` where
 * key = 'elife_api_connection'), secrets are stripped from the local cache,
 * and realtime updates keep every admin screen in sync.
 */

export type ElifeEnvironment = "sandbox" | "production";

export type ElifeConnectionStatus =
  | "unknown"
  | "connected"
  | "error"
  | "disabled";

export interface ElifeActivityEvent {
  id: string;
  /** epoch ms */
  at: number;
  kind: "test" | "config" | "enable" | "disable";
  ok: boolean;
  /** HTTP status when relevant (0 when N/A) */
  status: number;
  message: string;
}

export interface ElifeConnectionConfig {
  enabled: boolean;
  environment: ElifeEnvironment;
  /** API base URL, e.g. https://api.elifetransfer.com */
  baseUrl: string;
  /** OAuth token endpoint (absolute URL). */
  tokenUrl: string;
  /** OAuth client credentials. */
  clientId: string;
  clientSecret: string;
  /** Optional webhook URL Elife calls back to. */
  webhookUrl: string;
  /** Cached health (not authoritative, set after a test). */
  status: ElifeConnectionStatus;
  lastCheckedAt?: number;
  lastError?: string;
  /** Most-recent-first, capped activity log. */
  activity: ElifeActivityEvent[];
}

export const ELIFE_STORAGE_KEY = "admin-settings:elife-connection-v1";
export const ELIFE_REMOTE_KEY = "elife_api_connection";
const ACTIVITY_CAP = 25;

export const DEFAULT_ELIFE_CONFIG: ElifeConnectionConfig = {
  enabled: false,
  environment: "sandbox",
  baseUrl: "https://api.elifetransfer.com",
  tokenUrl: "https://api.elifetransfer.com/oauth/token",
  clientId: "",
  clientSecret: "",
  webhookUrl: "",
  status: "unknown",
  activity: [],
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalize(raw: Partial<ElifeConnectionConfig> | null): ElifeConnectionConfig {
  return {
    ...DEFAULT_ELIFE_CONFIG,
    ...(raw ?? {}),
    activity: Array.isArray(raw?.activity) ? raw!.activity!.slice(0, ACTIVITY_CAP) : [],
  };
}

// ---------------------------------------------------------------------------
// Supabase remote storage
// ---------------------------------------------------------------------------

async function readRemote(): Promise<ElifeConnectionConfig | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ELIFE_REMOTE_KEY)
      .maybeSingle();
    if (error) {
      console.log("[elifeApiStore] readRemote error", error.message);
      return null;
    }
    const raw = (data?.value ?? null) as Partial<ElifeConnectionConfig> | null;
    if (raw && typeof raw === "object") return normalize(raw);
    return null;
  } catch (e) {
    console.log("[elifeApiStore] readRemote exception", e);
    return null;
  }
}

export interface RemoteWriteResult {
  ok: boolean;
  error: string;
  skipped: boolean;
}

async function writeRemote(config: ElifeConnectionConfig): Promise<RemoteWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured in this build.", skipped: true };
  }
  try {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: ELIFE_REMOTE_KEY, value: config }, { onConflict: "key" });
    if (error) {
      console.log("[elifeApiStore] writeRemote error", error.message);
      return { ok: false, error: error.message, skipped: false };
    }
    return { ok: true, error: "", skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[elifeApiStore] writeRemote exception", msg);
    return { ok: false, error: msg, skipped: false };
  }
}

/** Strip the client secret before caching locally. */
function stripSecret(config: ElifeConnectionConfig): ElifeConnectionConfig {
  return { ...config, clientSecret: "" };
}

async function readLocal(): Promise<ElifeConnectionConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(ELIFE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ElifeConnectionConfig>;
    return normalize({ ...parsed, clientSecret: "" });
  } catch (e) {
    console.log("[elifeApiStore] readLocal error", e);
    return null;
  }
}

async function writeLocal(config: ElifeConnectionConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(ELIFE_STORAGE_KEY, JSON.stringify(stripSecret(config)));
  } catch (e) {
    console.log("[elifeApiStore] writeLocal error", e);
  }
}

/**
 * Load the connection config. Secrets come only from Supabase; the local
 * cache is a structure-only offline fallback (clientSecret blank).
 */
export async function loadElifeConfig(): Promise<ElifeConnectionConfig> {
  const remote = await readRemote();
  if (remote) {
    await writeLocal(remote);
    return remote;
  }
  const local = await readLocal();
  return local ?? { ...DEFAULT_ELIFE_CONFIG };
}

export async function saveElifeConfig(
  config: ElifeConnectionConfig
): Promise<RemoteWriteResult> {
  const result = await writeRemote(config);
  await writeLocal(config);
  return result;
}

export function subscribeElifeConfig(
  onChange: (config: ElifeConnectionConfig) => void
): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channelName = `app_settings:${ELIFE_REMOTE_KEY}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "app_settings",
        filter: `key=eq.${ELIFE_REMOTE_KEY}`,
      },
      (payload) => {
        try {
          const row = (payload.new ?? payload.old) as { value?: unknown } | null;
          const raw = row?.value as Partial<ElifeConnectionConfig> | undefined;
          if (!raw || typeof raw !== "object") return;
          const cfg = normalize(raw);
          writeLocal(cfg).catch(() => {});
          onChange(cfg);
        } catch (e) {
          console.log("[elifeApiStore] realtime payload error", e);
        }
      }
    )
    .subscribe();

  return () => {
    try {
      supabase?.removeChannel(channel);
    } catch (e) {
      console.log("[elifeApiStore] unsubscribe error", e);
    }
  };
}

function appendActivity(
  config: ElifeConnectionConfig,
  event: Omit<ElifeActivityEvent, "id" | "at">
): ElifeActivityEvent[] {
  const entry: ElifeActivityEvent = { id: genId("evt"), at: Date.now(), ...event };
  return [entry, ...config.activity].slice(0, ACTIVITY_CAP);
}

export interface MutationResult {
  config: ElifeConnectionConfig;
  write: RemoteWriteResult;
}

/** Persist a config patch and log a "config" event. */
export async function updateElifeConfig(
  current: ElifeConnectionConfig,
  patch: Partial<ElifeConnectionConfig>,
  logMessage?: string
): Promise<MutationResult> {
  const merged: ElifeConnectionConfig = { ...current, ...patch };
  const next: ElifeConnectionConfig = logMessage
    ? { ...merged, activity: appendActivity(current, { kind: "config", ok: true, status: 0, message: logMessage }) }
    : merged;
  const write = await saveElifeConfig(next);
  return { config: next, write };
}

/** Toggle the integration on/off, logging the action. */
export async function setElifeEnabled(
  current: ElifeConnectionConfig,
  enabled: boolean
): Promise<MutationResult> {
  const next: ElifeConnectionConfig = {
    ...current,
    enabled,
    status: enabled ? current.status : "disabled",
    activity: appendActivity(current, {
      kind: enabled ? "enable" : "disable",
      ok: true,
      status: 0,
      message: enabled ? "Integration enabled" : "Integration disabled",
    }),
  };
  const write = await saveElifeConfig(next);
  return { config: next, write };
}

export interface TestResult {
  ok: boolean;
  status: number;
  message: string;
  /** Raw response body excerpt for debugging. */
  body?: string;
}

/**
 * Test the connection by requesting an OAuth token using the client
 * credentials grant. Records the outcome to the activity log and updates
 * the cached status. Network/CORS failures surface as ok=false, status=0.
 */
export async function testElifeConnection(
  current: ElifeConnectionConfig
): Promise<{ result: TestResult; mutation: MutationResult }> {
  let result: TestResult;

  if (!current.clientId.trim() || !current.clientSecret.trim()) {
    result = {
      ok: false,
      status: 0,
      message: "Client ID and Client Secret are required.",
    };
  } else if (!current.tokenUrl.trim()) {
    result = { ok: false, status: 0, message: "Token URL is not configured." };
  } else {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(current.tokenUrl.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: current.clientId.trim(),
          client_secret: current.clientSecret.trim(),
        }).toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      const ok = res.ok;
      result = {
        ok,
        status: res.status,
        message: ok
          ? "Access token obtained successfully."
          : `Token request failed (HTTP ${res.status}).`,
        body: text.slice(0, 400),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        ok: false,
        status: 0,
        message: `Could not reach Elife: ${msg}`,
      };
    }
  }

  const next: ElifeConnectionConfig = {
    ...current,
    status: result.ok ? "connected" : "error",
    lastCheckedAt: Date.now(),
    lastError: result.ok ? undefined : result.message,
    activity: appendActivity(current, {
      kind: "test",
      ok: result.ok,
      status: result.status,
      message: result.message,
    }),
  };
  const write = await saveElifeConfig(next);
  return { result, mutation: { config: next, write } };
}

/** Clear the activity log. */
export async function clearElifeActivity(
  current: ElifeConnectionConfig
): Promise<MutationResult> {
  const next: ElifeConnectionConfig = { ...current, activity: [] };
  const write = await saveElifeConfig(next);
  return { config: next, write };
}
