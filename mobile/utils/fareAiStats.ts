import { isSupabaseConfigured, supabase } from "@/utils/supabase";
import type { FareAIProvider } from "@/utils/fareProviderStore";

export interface FareAITollBooth {
  name?: string;
  charge: number;
}

/**
 * Client helpers for the fare-AI tracking tables created in migration 0043:
 *   - `fare_ai_key_states`  per-key usage / pass / fail counters + cooldown
 *   - `fare_ai_responses`   full response log
 *
 * Recording is best-effort and never throws — fare calculation must keep
 * working even if Supabase is unreachable.
 */

export interface FareAIKeyState {
  keyId: string;
  provider: string;
  usageCount: number;
  passCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  lastFailedAt: string | null;
  disabledUntil: string | null;
  lastError: string | null;
}

export interface FareAIResponseRow {
  id: string;
  createdAt: string;
  provider: string;
  keyId: string | null;
  keyLabel: string | null;
  model: string | null;
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  success: boolean;
  httpStatus: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  summary: string | null;
  tollCount: number | null;
  tollTotal: number | null;
  tolls: FareAITollBooth[] | null;
  error: string | null;
  latencyMs: number | null;
  rawResponse: string | null;
}

interface KeyStateRow {
  key_id: string;
  provider: string | null;
  usage_count: number | null;
  pass_count: number | null;
  fail_count: number | null;
  last_used_at: string | null;
  last_success_at: string | null;
  last_failed_at: string | null;
  disabled_until: string | null;
  last_error: string | null;
}

function mapState(row: KeyStateRow): FareAIKeyState {
  return {
    keyId: row.key_id,
    provider: row.provider ?? "",
    usageCount: row.usage_count ?? 0,
    passCount: row.pass_count ?? 0,
    failCount: row.fail_count ?? 0,
    lastUsedAt: row.last_used_at,
    lastSuccessAt: row.last_success_at,
    lastFailedAt: row.last_failed_at,
    disabledUntil: row.disabled_until,
    lastError: row.last_error,
  };
}

/** Fetch all key states, keyed by key id. */
export async function fetchKeyStates(): Promise<Record<string, FareAIKeyState>> {
  if (!isSupabaseConfigured || !supabase) return {};
  try {
    const { data, error } = await supabase
      .from("fare_ai_key_states")
      .select(
        "key_id, provider, usage_count, pass_count, fail_count, last_used_at, last_success_at, last_failed_at, disabled_until, last_error"
      );
    if (error) {
      console.log("[fareAiStats] fetchKeyStates error", error.message);
      return {};
    }
    const out: Record<string, FareAIKeyState> = {};
    for (const row of (data ?? []) as KeyStateRow[]) {
      out[row.key_id] = mapState(row);
    }
    return out;
  } catch (e) {
    console.log("[fareAiStats] fetchKeyStates exception", e);
    return {};
  }
}

/** True when a key is currently in cooldown and should be skipped. */
export function isCoolingDown(state: FareAIKeyState | undefined, now: number = Date.now()): boolean {
  if (!state?.disabledUntil) return false;
  const until = new Date(state.disabledUntil).getTime();
  return Number.isFinite(until) && until > now;
}

export interface RecordUsageArgs {
  keyId: string;
  provider: FareAIProvider;
  success: boolean;
  /** When the key should become available again (ISO) — null on success. */
  disabledUntil: string | null;
  error: string | null;
}

/** Atomically bump counters / set cooldown via the SECURITY DEFINER RPC. */
export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase.rpc("fare_ai_record_usage", {
      p_key_id: args.keyId,
      p_provider: args.provider,
      p_success: args.success,
      p_disabled_until: args.disabledUntil,
      p_error: args.error,
    });
    if (error) console.log("[fareAiStats] recordUsage error", error.message);
  } catch (e) {
    console.log("[fareAiStats] recordUsage exception", e);
  }
}

export interface RecordResponseArgs {
  provider: FareAIProvider;
  keyId: string | null;
  keyLabel: string | null;
  model: string | null;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  success: boolean;
  httpStatus: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  summary: string | null;
  tollCount: number | null;
  tollTotal: number | null;
  tolls: FareAITollBooth[] | null;
  error: string | null;
  latencyMs: number | null;
  rawResponse: string | null;
}

/** Append one attempt to the response log. */
export async function recordResponse(args: RecordResponseArgs): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase.from("fare_ai_responses").insert({
      provider: args.provider,
      key_id: args.keyId,
      key_label: args.keyLabel,
      model: args.model,
      origin_lat: args.originLat,
      origin_lng: args.originLng,
      dest_lat: args.destLat,
      dest_lng: args.destLng,
      success: args.success,
      http_status: args.httpStatus,
      distance_km: args.distanceKm,
      duration_min: args.durationMin,
      summary: args.summary,
      toll_count: args.tollCount,
      toll_total: args.tollTotal,
      tolls: args.tolls ?? null,
      error: args.error,
      latency_ms: args.latencyMs,
      raw_response: args.rawResponse ? args.rawResponse.substring(0, 4000) : null,
    });
    if (error) console.log("[fareAiStats] recordResponse error", error.message);
  } catch (e) {
    console.log("[fareAiStats] recordResponse exception", e);
  }
}

interface ResponseRow {
  id: string;
  created_at: string;
  provider: string | null;
  key_id: string | null;
  key_label: string | null;
  model: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  success: boolean | null;
  http_status: number | null;
  distance_km: number | null;
  duration_min: number | null;
  summary: string | null;
  toll_count: number | null;
  toll_total: number | null;
  tolls: FareAITollBooth[] | null;
  error: string | null;
  latency_ms: number | null;
  raw_response: string | null;
}

/** Fetch the most recent response-log rows for the admin screen. */
export async function fetchRecentResponses(limit: number = 100): Promise<FareAIResponseRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("fare_ai_responses")
      .select(
        "id, created_at, provider, key_id, key_label, model, origin_lat, origin_lng, dest_lat, dest_lng, success, http_status, distance_km, duration_min, summary, toll_count, toll_total, tolls, error, latency_ms, raw_response"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.log("[fareAiStats] fetchRecentResponses error", error.message);
      return [];
    }
    return ((data ?? []) as ResponseRow[]).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      provider: row.provider ?? "",
      keyId: row.key_id,
      keyLabel: row.key_label,
      model: row.model,
      originLat: row.origin_lat,
      originLng: row.origin_lng,
      destLat: row.dest_lat,
      destLng: row.dest_lng,
      success: !!row.success,
      httpStatus: row.http_status,
      distanceKm: row.distance_km,
      durationMin: row.duration_min,
      summary: row.summary,
      tollCount: row.toll_count,
      tollTotal: row.toll_total,
      tolls: Array.isArray(row.tolls) ? row.tolls : null,
      error: row.error,
      latencyMs: row.latency_ms,
      rawResponse: row.raw_response,
    }));
  } catch (e) {
    console.log("[fareAiStats] fetchRecentResponses exception", e);
    return [];
  }
}

/** Delete every row in the response log. Returns true on success. */
export async function clearResponses(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase
      .from("fare_ai_responses")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      console.log("[fareAiStats] clearResponses error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[fareAiStats] clearResponses exception", e);
    return false;
  }
}
