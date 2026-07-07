import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";

/**
 * Commission rate store — configurable from Admin → Settings → Commission
 * Rates. One master (platform default) rate plus overrides at geographic
 * levels and per-user (partner) level.
 *
 * Resolution priority when charging a ride commission:
 *   user override → suburb → city → state → country → master → 15% default
 *
 * Supabase-backed (`commission_rates`, migrations/0058_commission_rates.sql).
 * When the table isn't in the live database yet, all reads/writes degrade to a
 * device-local AsyncStorage copy so admin edits and rate resolution keep
 * working; the last successful Supabase fetch is also cached for offline
 * resolution at ride-completion time.
 */

export type CommissionLevel = "master" | "country" | "state" | "city" | "suburb" | "user";

export interface CommissionRule {
  id: string;
  level: CommissionLevel;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  userId: string | null;
  userLabel: string | null;
  /** Fraction of the fare, e.g. 0.15 = 15%. */
  rate: number;
  active: boolean;
  updatedAt: string;
}

export type CommissionSource = "supabase" | "local";

export interface CommissionRulesResult {
  rules: CommissionRule[];
  source: CommissionSource;
}

export interface ResolvedCommission {
  rate: number;
  /** Which level of the chain supplied the rate ("default" = hardcoded 15%). */
  level: CommissionLevel | "default";
  /** Human-readable scope, e.g. "Suburb: Bangsar" or "Platform default". */
  label: string;
}

/** Hardcoded platform default when no master row exists anywhere. */
export const DEFAULT_COMMISSION_RATE = 0.15;

/** Priority order, highest first. */
export const COMMISSION_PRIORITY: CommissionLevel[] = [
  "user",
  "suburb",
  "city",
  "state",
  "country",
  "master",
];

const RULES_CACHE_KEY = "commission:rules:cache";
const LOCAL_RULES_KEY = "commission:rules:local";

interface RuleRow {
  id: string;
  level: CommissionLevel;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  user_id: string | null;
  user_label: string | null;
  rate: number;
  active: boolean;
  updated_at: string;
}

function rowToRule(r: RuleRow): CommissionRule {
  return {
    id: r.id,
    level: r.level,
    country: r.country,
    state: r.state,
    city: r.city,
    suburb: r.suburb,
    userId: r.user_id,
    userLabel: r.user_label,
    rate: Number(r.rate),
    active: r.active,
    updatedAt: r.updated_at,
  };
}

/** True when the error indicates the commission table isn't in the DB yet. */
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

async function readStoredRules(key: string): Promise<CommissionRule[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return JSON.parse(raw) as CommissionRule[];
  } catch (e) {
    console.log("[commission] stored rules read failed", key, e);
  }
  return [];
}

async function writeStoredRules(key: string, rules: CommissionRule[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(rules));
  } catch (e) {
    console.log("[commission] stored rules write failed", key, e);
  }
}

/**
 * Fetch all commission rules. Caches the result for offline resolution and
 * falls back to device-local rules when the table isn't applied yet.
 */
export async function fetchCommissionRules(): Promise<CommissionRulesResult> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("commission_rates")
        .select(
          "id, level, country, state, city, suburb, user_id, user_label, rate, active, updated_at"
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rules = ((data ?? []) as RuleRow[]).map(rowToRule);
      await writeStoredRules(RULES_CACHE_KEY, rules);
      return { rules, source: "supabase" };
    } catch (e) {
      if (isMissingSchemaError(e)) {
        console.log("[commission] table missing — using local rules fallback");
        return { rules: await readStoredRules(LOCAL_RULES_KEY), source: "local" };
      }
      console.log("[commission] fetch failed — using cached rules", e);
      return { rules: await readStoredRules(RULES_CACHE_KEY), source: "local" };
    }
  }
  return { rules: await readStoredRules(LOCAL_RULES_KEY), source: "local" };
}

export interface CommissionSaveInput {
  id?: string;
  level: CommissionLevel;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  suburb?: string | null;
  userId?: string | null;
  userLabel?: string | null;
  /** Fraction 0..1 (exclusive of 1). */
  rate: number;
  active?: boolean;
}

export interface CommissionSaveResult {
  ok: boolean;
  error?: string;
  source?: CommissionSource;
}

function normalizeText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/** Validate that the rule has the fields its level requires. */
export function validateCommissionInput(input: CommissionSaveInput): string | null {
  if (!(input.rate >= 0 && input.rate < 1)) return "Rate must be between 0% and 99.99%.";
  switch (input.level) {
    case "country":
      if (!normalizeText(input.country)) return "Select a country.";
      break;
    case "state":
      if (!normalizeText(input.country)) return "Select a country.";
      if (!normalizeText(input.state)) return "Select a state.";
      break;
    case "city":
      if (!normalizeText(input.country)) return "Select a country.";
      if (!normalizeText(input.state)) return "Select a state.";
      if (!normalizeText(input.city)) return "Enter a city.";
      break;
    case "suburb":
      if (!normalizeText(input.country)) return "Select a country.";
      if (!normalizeText(input.state)) return "Select a state.";
      if (!normalizeText(input.city)) return "Enter a city.";
      if (!normalizeText(input.suburb)) return "Enter a suburb.";
      break;
    case "user":
      if (!normalizeText(input.userId)) return "Select a user.";
      break;
    case "master":
      break;
  }
  return null;
}

/** Create or update a commission rule (master rate is a rule with level 'master'). */
export async function saveCommissionRule(
  input: CommissionSaveInput
): Promise<CommissionSaveResult> {
  const invalid = validateCommissionInput(input);
  if (invalid) return { ok: false, error: invalid };

  const scoped = {
    level: input.level,
    country: input.level === "user" || input.level === "master" ? null : normalizeText(input.country),
    state: ["state", "city", "suburb"].includes(input.level) ? normalizeText(input.state) : null,
    city: ["city", "suburb"].includes(input.level) ? normalizeText(input.city) : null,
    suburb: input.level === "suburb" ? normalizeText(input.suburb) : null,
    user_id: input.level === "user" ? normalizeText(input.userId) : null,
    user_label: input.level === "user" ? normalizeText(input.userLabel) : null,
    rate: Math.round(input.rate * 10000) / 10000,
    active: input.active ?? true,
  };

  if (isSupabaseConfigured && supabase) {
    try {
      if (input.id) {
        const { error } = await supabase
          .from("commission_rates")
          .update(scoped)
          .eq("id", input.id);
        if (error) throw error;
      } else if (input.level === "master") {
        // Single master row: update if one exists, otherwise insert.
        const { data, error: selErr } = await supabase
          .from("commission_rates")
          .select("id")
          .eq("level", "master")
          .limit(1);
        if (selErr) throw selErr;
        const existing = (data ?? [])[0] as { id: string } | undefined;
        if (existing) {
          const { error } = await supabase
            .from("commission_rates")
            .update({ rate: scoped.rate, active: true })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("commission_rates").insert(scoped);
          if (error) throw error;
        }
      } else {
        const { error } = await supabase.from("commission_rates").insert(scoped);
        if (error) {
          if (String(error.code ?? "") === "23505") {
            return { ok: false, error: "An override for this exact scope already exists." };
          }
          throw error;
        }
      }
      return { ok: true, source: "supabase" };
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[commission] save failed", e);
        return { ok: false, error: "Could not save. Please try again." };
      }
      console.log("[commission] save falling back to local rules");
    }
  }

  // Local fallback
  const rules = await readStoredRules(LOCAL_RULES_KEY);
  const now = new Date().toISOString();
  let next: CommissionRule[];
  const asRule = (id: string): CommissionRule => ({
    id,
    level: scoped.level,
    country: scoped.country,
    state: scoped.state,
    city: scoped.city,
    suburb: scoped.suburb,
    userId: scoped.user_id,
    userLabel: scoped.user_label,
    rate: scoped.rate,
    active: scoped.active,
    updatedAt: now,
  });
  if (input.id) {
    next = rules.map((r) => (r.id === input.id ? { ...asRule(r.id) } : r));
  } else if (input.level === "master") {
    const existing = rules.find((r) => r.level === "master");
    next = existing
      ? rules.map((r) => (r.id === existing.id ? asRule(r.id) : r))
      : [asRule(uuidv4()), ...rules];
  } else {
    const duplicate = rules.some(
      (r) =>
        r.level === scoped.level &&
        eqi(r.country, scoped.country) &&
        eqi(r.state, scoped.state) &&
        eqi(r.city, scoped.city) &&
        eqi(r.suburb, scoped.suburb) &&
        (r.userId ?? "") === (scoped.user_id ?? "")
    );
    if (duplicate) return { ok: false, error: "An override for this exact scope already exists." };
    next = [asRule(uuidv4()), ...rules];
  }
  await writeStoredRules(LOCAL_RULES_KEY, next);
  return { ok: true, source: "local" };
}

/** Delete a commission override (master row can also be deleted → reverts to 15%). */
export async function deleteCommissionRule(id: string): Promise<CommissionSaveResult> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.from("commission_rates").delete().eq("id", id);
      if (error) throw error;
      return { ok: true, source: "supabase" };
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[commission] delete failed", e);
        return { ok: false, error: "Could not delete. Please try again." };
      }
    }
  }
  const rules = await readStoredRules(LOCAL_RULES_KEY);
  await writeStoredRules(LOCAL_RULES_KEY, rules.filter((r) => r.id !== id));
  return { ok: true, source: "local" };
}

function eqi(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** True when rule's parent scopes don't contradict the ride's known geography. */
function parentsMatch(
  rule: CommissionRule,
  geo: { country?: string | null; state?: string | null; city?: string | null }
): boolean {
  if (rule.country && geo.country && !eqi(rule.country, geo.country)) return false;
  if (rule.state && geo.state && !eqi(rule.state, geo.state)) return false;
  if (rule.city && geo.city && !eqi(rule.city, geo.city)) return false;
  return true;
}

export interface ResolveCommissionInput {
  /** Partner account (auth user id) — checked against user-level overrides. */
  userId?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  suburb?: string | null;
  /** Pre-fetched rules (e.g. for preview in the admin UI). */
  rules?: CommissionRule[];
}

/**
 * Resolve the effective commission rate for a partner + ride geography.
 * Priority: user → suburb → city → state → country → master → 15% default.
 */
export async function resolveCommissionRate(
  input: ResolveCommissionInput
): Promise<ResolvedCommission> {
  const rules = input.rules ?? (await fetchCommissionRules()).rules;
  const active = rules.filter((r) => r.active);
  const geo = { country: input.country, state: input.state, city: input.city };

  const userId = (input.userId ?? "").trim();
  if (userId) {
    const hit = active.find((r) => r.level === "user" && r.userId === userId);
    if (hit) {
      return { rate: hit.rate, level: "user", label: `User: ${hit.userLabel ?? userId}` };
    }
  }

  const suburb = normalizeText(input.suburb);
  if (suburb) {
    const hit = active.find(
      (r) => r.level === "suburb" && eqi(r.suburb, suburb) && parentsMatch(r, geo)
    );
    if (hit) return { rate: hit.rate, level: "suburb", label: `Suburb: ${hit.suburb}` };
  }

  const city = normalizeText(input.city);
  if (city) {
    const hit = active.find(
      (r) => r.level === "city" && eqi(r.city, city) && parentsMatch(r, geo)
    );
    if (hit) return { rate: hit.rate, level: "city", label: `City: ${hit.city}` };
  }

  const state = normalizeText(input.state);
  if (state) {
    const hit = active.find(
      (r) => r.level === "state" && eqi(r.state, state) && parentsMatch(r, geo)
    );
    if (hit) return { rate: hit.rate, level: "state", label: `State: ${hit.state}` };
  }

  const country = normalizeText(input.country);
  if (country) {
    const hit = active.find((r) => r.level === "country" && eqi(r.country, country));
    if (hit) return { rate: hit.rate, level: "country", label: `Country: ${hit.country}` };
  }

  const master = active.find((r) => r.level === "master");
  if (master) return { rate: master.rate, level: "master", label: "Master rate (admin)" };

  return { rate: DEFAULT_COMMISSION_RATE, level: "default", label: "Platform default" };
}

/**
 * Resolve the commission rate for a ride, pulling the ride's stored geography
 * (country/state/city/suburb captured at request time) when available.
 */
export async function resolveCommissionRateForRide(input: {
  partnerId: string;
  rideRequestId?: string | null;
}): Promise<ResolvedCommission> {
  let geo: { country?: string | null; state?: string | null; city?: string | null; suburb?: string | null } = {};
  if (input.rideRequestId && isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("ride_requests")
        .select("country, state, city, suburb")
        .eq("id", input.rideRequestId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        geo = data as { country: string | null; state: string | null; city: string | null; suburb: string | null };
      }
    } catch (e) {
      console.log("[commission] ride geo lookup failed — resolving without geography", e);
    }
  }
  const resolved = await resolveCommissionRate({ userId: input.partnerId, ...geo });
  console.log("[commission] resolved rate", {
    rideRequestId: input.rideRequestId,
    partnerId: input.partnerId,
    geo,
    rate: resolved.rate,
    level: resolved.level,
  });
  return resolved;
}
