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
  /** Ordered route geometry (decimal-degree coordinates) the AI based the estimate on. */
  polyline?: LatLng[];
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
  return (
    `You are a driving route estimator with access to real-time traffic and toll road data. ` +
    `Plan the trip from origin ${originStr} to destination ${destStr} by reasoning in this strict order:\n` +
    `STEP 1 — DIRECTION: Determine the single best driving direction/route between origin and destination, ` +
    `choosing the fastest realistic path given current live traffic conditions.\n` +
    `STEP 2 — ROUTE METRICS & GEOMETRY: For that chosen best route, compute the total driving distance and the ` +
    `current driving time including live traffic, and produce the route polyline. The polyline must come 100% from you: ` +
    `an ordered array of [latitude, longitude] decimal-degree points that traces the exact roads of the chosen route ` +
    `from origin to destination, following real road geometry (use 30-120 points so the line accurately hugs the roads, ` +
    `including curves, ramps and interchanges). distance_km and duration_min MUST correspond to this exact polyline.\n` +
    `STEP 3 — TOLLS: Only after the route is fixed, list every real toll booth/plaza that physically lies ON that exact ` +
    `polyline, in travel order, with each booth's name, charge in local currency, and exact decimal-degree coordinates. ` +
    `Every toll coordinate MUST sit on the polyline from STEP 2.\n` +
    `Respond with ONLY a compact JSON object, no markdown, no extra text, of the form: ` +
    `{"distance_km": <number>, "duration_min": <number>, "summary": "<short text>", ` +
    `"route": [[<lat>, <lng>], ...], ` +
    `"toll_count": <integer>, "toll_total": <number>, "tolls": [{"name": "<booth name>", "charge": <number>, "lat": <number>, "lng": <number>}]}. ` +
    `distance_km is total kilometres (number). duration_min is total minutes with traffic (integer). ` +
    `toll_count is the number of toll booths/plazas on the route (integer, 0 if none). ` +
    `toll_total is the sum of all toll charges (number, 0 if none). ` +
    `Use real, known road geometry and toll plaza coordinates; do not invent coordinates. Empty arrays if none.`
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
 * Estimate driving time and distance (with traffic) between two coordinates
 * using the globally-configured AI provider, trying each configured key in turn.
 * Returns null on total failure so callers can fall back to a routing engine.
 */
export async function estimateRouteWithAI(
  origin: LatLng,
  destination: LatLng
): Promise<RouteEstimate | null> {
  const config = await loadFareAIConfig();
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
      route?: ([number | string, number | string] | { lat?: number | string; lng?: number | string })[];
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

    const polyline: LatLng[] = Array.isArray(obj.route)
      ? obj.route
          .map((p) => {
            const lat = Array.isArray(p) ? Number(p[0]) : Number(p?.lat);
            const lng = Array.isArray(p) ? Number(p[1]) : Number(p?.lng);
            return { latitude: lat, longitude: lng };
          })
          .filter(
            (p) =>
              Number.isFinite(p.latitude) &&
              Number.isFinite(p.longitude) &&
              p.latitude !== 0 &&
              p.longitude !== 0
          )
      : [];

    return {
      distanceKm: parseFloat(distanceKm.toFixed(1)),
      durationMin: Math.ceil(durationMin),
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
      tollCount,
      tollTotal,
      tolls,
      polyline: polyline.length >= 2 ? polyline : undefined,
    };
  } catch {
    return null;
  }
}
