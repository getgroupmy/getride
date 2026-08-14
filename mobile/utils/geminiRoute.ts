/**
 * AI-based route estimation for fare calculation.
 *
 * Sends an origin/destination pair to the globally-selected AI provider
 * (Gemini, Grok, ChatGPT or Groq — configured by an admin in Settings) and asks
 * it to return the driving time and distance with real-time traffic taken into
 * account. Used as an estimate source for fare calculation.
 *
 * Each provider can hold multiple API keys. They are tried in order; a key that
 * fails (HTTP error, no content, or unparseable response) is recorded as a
 * failure and put into a cooldown (per the admin's retry policy), then the next
 * key is tried. Every attempt — pass or fail — is written to the response log.
 *
 * NOTE: These are language models with search/maps grounding — their traffic
 * figures are estimates, not a deterministic routing-engine output. Treat the
 * result as approximate and fall back to the Google Directions API when null.
 */

import {
  loadFareAIConfig,
  retryPolicyMs,
  type FareAIConfig,
  type FareAIKey,
  type FareAIProvider,
} from "@/utils/fareProviderStore";
import {
  fetchKeyStates,
  isCoolingDown,
  recordResponse,
  recordUsage,
} from "@/utils/fareAiStats";
import { isSupabaseConfigured, supabase } from "@/utils/supabase";

const ENV_GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const ENV_GEMINI_KEY_ID = "env:gemini";

/** A single toll booth/plaza along the route. */
export interface TollBooth {
  /** Stable identifier for list rendering. */
  id?: string;
  /** Name of the toll booth/plaza (if known). */
  name?: string;
  /** Charge for this booth in local currency. */
  charge: number;
  /** Latitude of the booth on the route (if known). */
  latitude?: number;
  /** Longitude of the booth on the route (if known). */
  longitude?: number;
}

export interface RouteEstimate {
  /** Total driving distance in kilometres. */
  distanceKm: number;
  /** Total driving time in minutes (with traffic). */
  durationMin: number;
  /** Short human-readable summary returned by the model. */
  summary?: string;
  /** Provider that produced this estimate. */
  provider?: FareAIProvider;
  /** Number of toll booths/plazas along the route. */
  tollCount?: number;
  /** Per-booth toll details. */
  tolls?: TollBooth[];
  /** Total toll charges along the route in local currency. */
  tollTotal?: number;
}

/** @deprecated Use {@link RouteEstimate}. Kept as an alias for callers. */
export type GeminiRouteEstimate = RouteEstimate;

interface LatLng {
  latitude: number;
  longitude: number;
}

interface CallResult {
  content: string | null;
  httpStatus: number | null;
  error: string | null;
}

function buildPrompt(origin: LatLng, destination: LatLng): string {
  const originStr = `${origin.latitude},${origin.longitude}`;
  const destStr = `${destination.latitude},${destination.longitude}`;
  const userQuery = `${originStr} to ${destStr} realtime minute and distance with traffic`;
  return (
    `You are a driving route estimator with access to real-time traffic and toll road data. ` +
    `For the trip "${userQuery}", estimate the total driving distance, the ` +
    `current driving time including live traffic, and the toll booths/plazas along the route ` +
    `with their individual charges in local currency. ` +
    `Respond with ONLY a compact JSON object, no markdown, no extra text, of the form: ` +
    `{"distance_km": <number>, "duration_min": <number>, "summary": "<short text>", ` +
    `"toll_count": <integer>, "toll_total": <number>, "tolls": [{"name": "<booth name>", "charge": <number>, "lat": <number>, "lng": <number>}]}. ` +
    `distance_km is total kilometres (number). duration_min is total minutes with traffic (integer). ` +
    `toll_count is the number of toll booths/plazas on the route (integer, 0 if none). ` +
    `toll_total is the sum of all toll charges (number, 0 if none). ` +
    `tolls is an array of each real toll booth/plaza that physically exists on this route, in travel order, ` +
    `each with its name, charge, and exact geographic coordinates (lat and lng as decimal degrees) of the booth location. ` +
    `Use real, known toll plaza coordinates; do not invent coordinates. Empty array if none.`
  );
}

const SYSTEM_INSTRUCTION =
  "You return only valid JSON. Never wrap the JSON in markdown fences.";

/** Build the ordered list of candidate keys to try for the active provider. */
function candidateKeys(config: FareAIConfig): FareAIKey[] {
  const list = (config.keys[config.provider] ?? []).filter((k) => k.enabled && k.key.trim());
  if (config.provider === "gemini") {
    const envKey = (ENV_GEMINI_API_KEY ?? "").trim();
    const alreadyHasEnv = list.some((k) => k.key.trim() === envKey);
    if (envKey && !alreadyHasEnv) {
      list.push({ id: ENV_GEMINI_KEY_ID, label: "App built-in key", key: envKey, enabled: true });
    }
  }
  return list;
}

/**
 * Ask the `ai-route-proxy` edge function for the estimate. The proxy holds
 * the provider API keys server-side (the `fare_ai_provider` settings row is
 * hidden from anonymous clients since migration 0066) and runs the same
 * multi-key failover loop this module used to run locally.
 *
 * Returns:
 *   - a RouteEstimate when the proxy produced one,
 *   - null when the proxy ran but every provider key failed / the service is
 *     off (callers fall back to a routing engine — same contract as before),
 *   - undefined when the proxy is unreachable or not deployed, so the caller
 *     falls through to the legacy client-side loop.
 */
async function estimateViaProxy(
  origin: LatLng,
  destination: LatLng
): Promise<RouteEstimate | null | undefined> {
  if (!isSupabaseConfigured || !supabase) return undefined;
  try {
    const { data, error } = await supabase.functions.invoke("ai-route-proxy", {
      body: { origin, destination },
    });
    if (error) {
      console.log("[routeAI] proxy unavailable, using client fallback:", error.message ?? error);
      return undefined;
    }
    const payload = data as {
      ok?: boolean;
      estimate?: {
        distance_km?: number;
        duration_min?: number;
        summary?: string;
        provider?: FareAIProvider;
        toll_count?: number;
        toll_total?: number;
        tolls?: TollBooth[];
      } | null;
      reason?: string;
    } | null;
    if (!payload?.ok) return undefined;
    if (!payload.estimate) {
      console.log("[routeAI] proxy returned no estimate:", payload.reason ?? "unknown");
      return null;
    }
    const est = payload.estimate;
    const distanceKm = Number(est.distance_km);
    const durationMin = Number(est.duration_min);
    if (!(distanceKm > 0) || !(durationMin > 0)) return null;
    return {
      distanceKm,
      durationMin,
      summary: typeof est.summary === "string" ? est.summary : undefined,
      provider: est.provider,
      tollCount: est.toll_count,
      tollTotal: est.toll_total,
      tolls: Array.isArray(est.tolls) ? est.tolls : undefined,
    };
  } catch (e) {
    console.log("[routeAI] proxy call threw, using client fallback:", e);
    return undefined;
  }
}

/**
 * Estimate driving time and distance (with traffic) between two coordinates
 * using the globally-configured AI provider. Prefers the `ai-route-proxy`
 * edge function (keys stay server-side); falls back to the legacy client-side
 * key loop for projects where the function isn't deployed.
 * Returns null on total failure so callers can fall back to a routing engine.
 */
export async function estimateRouteWithAI(
  origin: LatLng,
  destination: LatLng
): Promise<RouteEstimate | null> {
  const proxied = await estimateViaProxy(origin, destination);
  if (proxied !== undefined) return proxied;

  const config = await loadFareAIConfig();
  if (!config.serviceEnabled) {
    console.warn("Route AI estimate skipped: fare AI service is turned off");
    return null;
  }
  const provider = config.provider;
  const model = config.models[provider];

  const candidates = candidateKeys(config);
  if (candidates.length === 0) {
    console.warn(`Route AI estimate skipped: no enabled keys for ${provider}`);
    return null;
  }

  const states = await fetchKeyStates();
  const now = Date.now();
  const available = candidates.filter((k) => !isCoolingDown(states[k.id], now));

  if (available.length === 0) {
    console.warn(
      `Route AI estimate skipped: all ${candidates.length} ${provider} key(s) are cooling down`
    );
    return null;
  }

  const prompt = buildPrompt(origin, destination);
  console.log(
    `Route AI estimate [provider=${provider}] trying ${available.length} key(s) for`,
    `${origin.latitude},${origin.longitude}`,
    "->",
    `${destination.latitude},${destination.longitude}`
  );

  const cooldownMs = retryPolicyMs(config.retryAfterValue, config.retryAfterUnit);

  for (const cand of available) {
    const started = Date.now();
    let result: CallResult;
    try {
      result = await callProvider(provider, prompt, cand.key, model);
    } catch (e) {
      result = { content: null, httpStatus: null, error: e instanceof Error ? e.message : String(e) };
    }
    const latencyMs = Date.now() - started;

    const parsed = result.content ? parseEstimate(result.content) : null;
    const success = !!parsed;
    const errorMsg = success
      ? null
      : result.error ?? (result.content ? "Unparseable response" : "No response content");
    const disabledUntil = success ? null : new Date(Date.now() + cooldownMs).toISOString();

    // Record the attempt + counters (best-effort, non-blocking).
    void recordResponse({
      provider,
      keyId: cand.id,
      keyLabel: cand.label,
      model,
      originLat: origin.latitude,
      originLng: origin.longitude,
      destLat: destination.latitude,
      destLng: destination.longitude,
      success,
      httpStatus: result.httpStatus,
      distanceKm: parsed?.distanceKm ?? null,
      durationMin: parsed?.durationMin ?? null,
      summary: parsed?.summary ?? null,
      tollCount: parsed?.tollCount ?? null,
      tollTotal: parsed?.tollTotal ?? null,
      tolls: parsed?.tolls ?? null,
      error: errorMsg,
      latencyMs,
      rawResponse: result.content,
    });
    void recordUsage({ keyId: cand.id, provider, success, disabledUntil, error: errorMsg });

    if (success && parsed) {
      console.log(
        `Route AI estimate [${provider}/${cand.label}]:`,
        parsed.distanceKm,
        "km,",
        parsed.durationMin,
        "min"
      );
      return { ...parsed, provider };
    }

    console.warn(
      `Route AI estimate [${provider}/${cand.label}] failed (${errorMsg}); cooling down, trying next key`
    );
  }

  console.error(`Route AI estimate [${provider}]: all available keys failed`);
  return null;
}

/**
 * @deprecated Backwards-compatible alias. Now dispatches to the globally
 * selected provider with multi-key failover.
 */
export async function estimateRouteWithGemini(
  origin: LatLng,
  destination: LatLng
): Promise<RouteEstimate | null> {
  return estimateRouteWithAI(origin, destination);
}

// ---------------------------------------------------------------------------
// Provider implementations — each returns a CallResult.
// ---------------------------------------------------------------------------

function callProvider(
  provider: FareAIProvider,
  prompt: string,
  apiKey: string,
  model: string
): Promise<CallResult> {
  switch (provider) {
    case "grok":
      return callOpenAICompatible("https://api.x.ai/v1/chat/completions", apiKey, model, prompt, "Grok");
    case "chatgpt":
      return callOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, prompt, "ChatGPT");
    case "groq":
      return callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, model, prompt, "Groq");
    case "perplexity":
      return callOpenAICompatible("https://api.perplexity.ai/chat/completions", apiKey, model, prompt, "Perplexity");
    case "mistral":
      return callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", apiKey, model, prompt, "Mistral");
    case "deepseek":
      return callOpenAICompatible("https://api.deepseek.com/chat/completions", apiKey, model, prompt, "DeepSeek");
    case "cohere":
      return callOpenAICompatible("https://api.cohere.ai/compatibility/v1/chat/completions", apiKey, model, prompt, "Cohere");
    case "together":
      return callOpenAICompatible("https://api.together.xyz/v1/chat/completions", apiKey, model, prompt, "Together AI");
    case "openrouter":
      return callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, model, prompt, "OpenRouter");
    case "fireworks":
      return callOpenAICompatible("https://api.fireworks.ai/inference/v1/chat/completions", apiKey, model, prompt, "Fireworks");
    case "claude":
      return callAnthropic(prompt, apiKey, model);
    case "gemini":
    default:
      return callGemini(prompt, apiKey, model);
  }
}

async function callGemini(prompt: string, apiKey: string, model: string): Promise<CallResult> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      content: null,
      httpStatus: response.status,
      error: `HTTP ${response.status}: ${errText.substring(0, 200)}`,
    };
  }
  const data = await response.json();
  const content: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return { content: content ?? null, httpStatus: response.status, error: content ? null : "Empty content" };
}

/** Shared OpenAI-compatible chat completions caller (Grok, ChatGPT & Groq). */
async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  label: string
): Promise<CallResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      content: null,
      httpStatus: response.status,
      error: `${label} HTTP ${response.status}: ${errText.substring(0, 200)}`,
    };
  }
  const data = await response.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  return { content: content ?? null, httpStatus: response.status, error: content ? null : "Empty content" };
}

/** Anthropic Claude messages API caller. */
async function callAnthropic(prompt: string, apiKey: string, model: string): Promise<CallResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      system: SYSTEM_INSTRUCTION,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      content: null,
      httpStatus: response.status,
      error: `Claude HTTP ${response.status}: ${errText.substring(0, 200)}`,
    };
  }
  const data = await response.json();
  const content: string | undefined = data?.content?.[0]?.text;
  return { content: content ?? null, httpStatus: response.status, error: content ? null : "Empty content" };
}

/** Extract the JSON estimate from a model text response. */
function parseEstimate(content: string): RouteEstimate | null {
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0]) as {
      distance_km?: number | string;
      duration_min?: number | string;
      summary?: string;
      toll_count?: number | string;
      toll_total?: number | string;
      tolls?: { name?: string; charge?: number | string; lat?: number | string; lng?: number | string }[];
    };

    const distanceKm = Number(obj.distance_km);
    const durationMin = Number(obj.duration_min);

    if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMin)) return null;
    if (distanceKm <= 0 || durationMin <= 0) return null;

    const tolls: TollBooth[] = Array.isArray(obj.tolls)
      ? obj.tolls
          .map((t, i) => {
            const lat = Number(t.lat);
            const lng = Number(t.lng);
            const hasCoords =
              Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
            return {
              id: `toll-${i}`,
              name: typeof t.name === "string" ? t.name : undefined,
              charge: Number(t.charge),
              latitude: hasCoords ? lat : undefined,
              longitude: hasCoords ? lng : undefined,
            };
          })
          .filter((t) => Number.isFinite(t.charge) && t.charge >= 0)
      : [];

    const parsedTollCount = Number(obj.toll_count);
    const tollCount = Number.isFinite(parsedTollCount)
      ? Math.max(0, Math.round(parsedTollCount))
      : tolls.length;

    const parsedTollTotal = Number(obj.toll_total);
    const tollTotal = Number.isFinite(parsedTollTotal)
      ? parseFloat(Math.max(0, parsedTollTotal).toFixed(2))
      : parseFloat(tolls.reduce((sum, t) => sum + t.charge, 0).toFixed(2));

    return {
      distanceKm: parseFloat(distanceKm.toFixed(1)),
      durationMin: Math.ceil(durationMin),
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
      tollCount,
      tollTotal,
      tolls,
    };
  } catch {
    return null;
  }
}
