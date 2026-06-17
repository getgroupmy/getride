import AsyncStorage from "@react-native-async-storage/async-storage";
import { isSupabaseConfigured, supabase, uuidv4 } from "@/utils/supabase";

/**
 * Global configuration for which AI provider is used to estimate the route
 * (distance + traffic-aware duration) that drives fare calculation.
 *
 * The selected provider, its keys and the retry policy are stored in a single
 * Supabase `app_settings` row (key = `fare_ai_provider`) so a change made by any
 * admin applies globally to every client. A realtime subscription keeps running
 * apps in sync, and an AsyncStorage cache provides an offline/first-paint
 * fallback.
 *
 * Each provider can hold MULTIPLE API keys. At fare-calc time the keys are tried
 * in order; if one fails it is put into a cooldown (see {@link RetryUnit}) and
 * the next key is used. Per-key usage/pass/fail counters and the response log
 * live in dedicated Supabase tables — see `utils/fareAiStats.ts`.
 */

export type FareAIProvider =
  | "gemini"
  | "grok"
  | "chatgpt"
  | "groq"
  | "claude"
  | "perplexity"
  | "mistral"
  | "deepseek"
  | "cohere"
  | "together"
  | "openrouter"
  | "fireworks";

export const FARE_AI_PROVIDERS: FareAIProvider[] = [
  "gemini",
  "grok",
  "chatgpt",
  "groq",
  "claude",
  "perplexity",
  "mistral",
  "deepseek",
  "cohere",
  "together",
  "openrouter",
  "fireworks",
];

export type RetryUnit = "hour" | "day" | "month";

/** A single API key entry within a provider. */
export interface FareAIKey {
  /** Stable id used as the primary key for stats/cooldown tracking. */
  id: string;
  /** Friendly label shown in the admin UI. */
  label: string;
  /** The secret API key value. */
  key: string;
  /** Disabled keys are skipped entirely. */
  enabled: boolean;
}

export interface FareAIConfig {
  /** Which provider performs the fare route estimate. */
  provider: FareAIProvider;
  /** How long a failed key is skipped before it is retried. */
  retryAfterValue: number;
  retryAfterUnit: RetryUnit;
  /** Model id per provider. */
  models: Record<FareAIProvider, string>;
  /** Ordered list of API keys per provider. */
  keys: Record<FareAIProvider, FareAIKey[]>;
}

export const FARE_AI_REMOTE_KEY = "fare_ai_provider";
const FARE_AI_LOCAL_KEY = "admin-settings:fare-ai-provider-v2";

const DEFAULT_MODELS: Record<FareAIProvider, string> = {
  gemini: "gemini-2.5-flash",
  grok: "grok-3",
  chatgpt: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  claude: "claude-3-5-haiku-latest",
  perplexity: "sonar",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
  cohere: "command-r",
  together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  openrouter: "openai/gpt-4o-mini",
  fireworks: "accounts/fireworks/models/llama-v3p3-70b-instruct",
};

/** Build an empty per-provider key map. */
function emptyKeyMap(): Record<FareAIProvider, FareAIKey[]> {
  const map = {} as Record<FareAIProvider, FareAIKey[]>;
  for (const p of FARE_AI_PROVIDERS) map[p] = [];
  return map;
}

export const DEFAULT_FARE_AI_CONFIG: FareAIConfig = {
  provider: "gemini",
  retryAfterValue: 1,
  retryAfterUnit: "hour",
  models: { ...DEFAULT_MODELS },
  keys: emptyKeyMap(),
};

/** Create a fresh key entry with a stable id. */
export function makeFareAIKey(partial?: Partial<FareAIKey>): FareAIKey {
  return {
    id: partial?.id ?? uuidv4(),
    label: partial?.label ?? "New key",
    key: partial?.key ?? "",
    enabled: partial?.enabled ?? true,
  };
}

function normalizeKeyList(raw: unknown): FareAIKey[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const obj = (item ?? {}) as Partial<FareAIKey>;
      if (typeof obj.key !== "string") return null;
      return makeFareAIKey({
        id: typeof obj.id === "string" && obj.id ? obj.id : undefined,
        label: typeof obj.label === "string" ? obj.label : undefined,
        key: obj.key,
        enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
      });
    })
    .filter((k): k is FareAIKey => k !== null);
}

/** Migrate legacy single-key fields (geminiKey, grokModel, ...) if present. */
interface LegacyConfig {
  geminiKey?: string;
  grokKey?: string;
  chatgptKey?: string;
  groqKey?: string;
  geminiModel?: string;
  grokModel?: string;
  chatgptModel?: string;
  groqModel?: string;
}

function normalize(raw: unknown): FareAIConfig {
  const obj = (raw ?? {}) as Partial<FareAIConfig> & LegacyConfig;

  const provider: FareAIProvider = FARE_AI_PROVIDERS.includes(obj.provider as FareAIProvider)
    ? (obj.provider as FareAIProvider)
    : "gemini";

  const retryAfterValue =
    typeof obj.retryAfterValue === "number" && obj.retryAfterValue > 0
      ? Math.floor(obj.retryAfterValue)
      : DEFAULT_FARE_AI_CONFIG.retryAfterValue;
  const retryAfterUnit: RetryUnit =
    obj.retryAfterUnit === "day" || obj.retryAfterUnit === "month" || obj.retryAfterUnit === "hour"
      ? obj.retryAfterUnit
      : DEFAULT_FARE_AI_CONFIG.retryAfterUnit;

  const rawModels = (obj.models ?? {}) as Partial<Record<FareAIProvider, string>>;
  const legacyModels: Partial<Record<FareAIProvider, string | undefined>> = {
    gemini: obj.geminiModel,
    grok: obj.grokModel,
    chatgpt: obj.chatgptModel,
    groq: obj.groqModel,
  };
  const models = {} as Record<FareAIProvider, string>;
  for (const p of FARE_AI_PROVIDERS) {
    const fromNew = typeof rawModels[p] === "string" && rawModels[p]?.trim() ? rawModels[p]! : "";
    const fromLegacy = typeof legacyModels[p] === "string" && legacyModels[p]?.trim() ? legacyModels[p]! : "";
    models[p] = fromNew || fromLegacy || DEFAULT_MODELS[p];
  }

  const rawKeys = (obj.keys ?? {}) as Partial<Record<FareAIProvider, unknown>>;
  const legacyKeys: Partial<Record<FareAIProvider, string | undefined>> = {
    gemini: obj.geminiKey,
    grok: obj.grokKey,
    chatgpt: obj.chatgptKey,
    groq: obj.groqKey,
  };
  const keys = {} as Record<FareAIProvider, FareAIKey[]>;
  for (const p of FARE_AI_PROVIDERS) {
    let list = normalizeKeyList(rawKeys[p]);
    if (list.length === 0 && typeof legacyKeys[p] === "string" && legacyKeys[p]!.trim()) {
      list = [makeFareAIKey({ label: "Key 1", key: legacyKeys[p]!.trim() })];
    }
    keys[p] = list;
  }

  return { provider, retryAfterValue, retryAfterUnit, models, keys };
}

/** Convert the retry policy to milliseconds. */
export function retryPolicyMs(value: number, unit: RetryUnit): number {
  const v = Number.isFinite(value) && value > 0 ? value : 1;
  const hour = 60 * 60 * 1000;
  switch (unit) {
    case "month":
      return v * 30 * 24 * hour;
    case "day":
      return v * 24 * hour;
    case "hour":
    default:
      return v * hour;
  }
}

async function readRemote(): Promise<FareAIConfig | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", FARE_AI_REMOTE_KEY)
      .maybeSingle();
    if (error) {
      console.log("[fareProviderStore] readRemote error", error.message);
      return null;
    }
    if (data?.value == null) return null;
    return normalize(data.value);
  } catch (e) {
    console.log("[fareProviderStore] readRemote exception", e);
    return null;
  }
}

async function readLocal(): Promise<FareAIConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(FARE_AI_LOCAL_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch (e) {
    console.log("[fareProviderStore] readLocal error", e);
    return null;
  }
}

async function writeLocal(config: FareAIConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(FARE_AI_LOCAL_KEY, JSON.stringify(config));
  } catch (e) {
    console.log("[fareProviderStore] writeLocal error", e);
  }
}

export interface FareAIWriteResult {
  ok: boolean;
  error: string;
  skipped: boolean;
}

async function writeRemote(config: FareAIConfig): Promise<FareAIWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured in this build.", skipped: true };
  }
  try {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: FARE_AI_REMOTE_KEY, value: config }, { onConflict: "key" });
    if (error) {
      console.log("[fareProviderStore] writeRemote error", error.message);
      return { ok: false, error: error.message, skipped: false };
    }
    return { ok: true, error: "", skipped: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[fareProviderStore] writeRemote exception", msg);
    return { ok: false, error: msg, skipped: false };
  }
}

/** In-memory cache so estimators avoid an awaited round-trip on every call. */
let memoryCache: FareAIConfig | null = null;

/**
 * Load the global fare AI config. Order of preference:
 *   1. Supabase remote (authoritative, applies globally)
 *   2. AsyncStorage cache (offline fallback)
 *   3. DEFAULT_FARE_AI_CONFIG
 */
export async function loadFareAIConfig(): Promise<FareAIConfig> {
  const remote = await readRemote();
  if (remote) {
    memoryCache = remote;
    await writeLocal(remote);
    return remote;
  }
  const local = await readLocal();
  const resolved = local ?? DEFAULT_FARE_AI_CONFIG;
  memoryCache = resolved;
  return resolved;
}

/** Synchronous best-effort read of the last-known config (may be stale/null). */
export function getCachedFareAIConfig(): FareAIConfig | null {
  return memoryCache;
}

/** Persist the global fare AI config to Supabase + local cache. */
export async function saveFareAIConfig(config: FareAIConfig): Promise<FareAIWriteResult> {
  const normalized = normalize(config);
  memoryCache = normalized;
  const remote = await writeRemote(normalized);
  await writeLocal(normalized);
  return remote;
}

/**
 * Subscribe to global config changes via Supabase realtime. Returns an
 * unsubscribe function.
 */
export function subscribeFareAIConfig(onChange: (config: FareAIConfig) => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channelName = `app_settings:${FARE_AI_REMOTE_KEY}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "app_settings",
        filter: `key=eq.${FARE_AI_REMOTE_KEY}`,
      },
      (payload) => {
        try {
          const row = (payload.new ?? payload.old) as { value?: unknown } | null;
          if (row?.value == null) return;
          const config = normalize(row.value);
          memoryCache = config;
          writeLocal(config).catch(() => {});
          onChange(config);
        } catch (e) {
          console.log("[fareProviderStore] realtime payload error", e);
        }
      }
    )
    .subscribe();

  return () => {
    try {
      supabase?.removeChannel(channel);
    } catch (e) {
      console.log("[fareProviderStore] unsubscribe error", e);
    }
  };
}

/** Human-readable label for a provider. */
export function providerLabel(provider: FareAIProvider): string {
  switch (provider) {
    case "grok":
      return "Grok (xAI)";
    case "chatgpt":
      return "ChatGPT (OpenAI)";
    case "groq":
      return "Groq";
    case "claude":
      return "Claude (Anthropic)";
    case "perplexity":
      return "Perplexity";
    case "mistral":
      return "Mistral AI";
    case "deepseek":
      return "DeepSeek";
    case "cohere":
      return "Cohere";
    case "together":
      return "Together AI";
    case "openrouter":
      return "OpenRouter";
    case "fireworks":
      return "Fireworks AI";
    case "gemini":
    default:
      return "Gemini (Google)";
  }
}
