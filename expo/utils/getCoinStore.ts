import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/**
 * GET.coin settings store — the GC <-> currency exchange rate configured from
 * Admin -> Settings -> Get Coin.
 *
 * `coinsPerCurrency` is how many GC equal 1 unit of currency (RM):
 *   e.g. 10 => RM1 = 10 GC, so 1 GC = RM0.10.
 *
 * Market pricing (migrations/0063): when `marketEnabled`, the coin's traded
 * value floats around the admin peg, driven by real in-app signals (each
 * individually toggleable): trading volume, commission revenue, completed
 * services, new sign-ups, and new coins minted. `maxSwingPct` clamps the move
 * and `maxSupply` caps total GC in circulation (0 = unlimited).
 *
 * Supabase-backed (`get_coin_settings`, migrations/0061_get_coin.sql). When
 * the table isn't in the live database yet, reads/writes degrade to a
 * device-local AsyncStorage copy; the last successful Supabase fetch is also
 * cached for offline use.
 */

export type GetCoinSource = "supabase" | "local";

export interface GetCoinSettings {
  /** GC per 1 unit of currency (RM). */
  coinsPerCurrency: number;
  /** GC earned per RM1 of completed-ride fare. 0 disables ride rewards. */
  earnCoinsPerCurrency: number;
  /** Market-speculated pricing on/off. */
  marketEnabled: boolean;
  /** Signal toggles — which forces move the market price. */
  signalTrading: boolean;
  signalRevenue: boolean;
  signalServices: boolean;
  signalSignups: boolean;
  signalMinting: boolean;
  /** Max % the market rate may move from the peg (e.g. 50 = ±50%). */
  maxSwingPct: number;
  /** Hard cap on total GC in circulation. 0 = unlimited. */
  maxSupply: number;
  currency: string;
  updatedAt: string | null;
  source: GetCoinSource;
}

/** Neutral default until the admin sets a rate: 1 GC = RM1. */
export const DEFAULT_COINS_PER_CURRENCY = 1;

/** Default clamp on market movement: ±50%. */
export const DEFAULT_MAX_SWING_PCT = 50;

const CACHE_KEY = "getcoin:settings:cache";

/** True when the error indicates the settings table isn't in the DB yet. */
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

/** True when the error indicates a column isn't in the DB yet. */
function isMissingColumnError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? String((err as { message?: string }).message ?? "") +
        " " +
        String((err as { code?: string }).code ?? "")
      : String(err ?? "");
  return msg.includes("42703") || msg.toLowerCase().includes("column");
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultSettings(): GetCoinSettings {
  return {
    coinsPerCurrency: DEFAULT_COINS_PER_CURRENCY,
    earnCoinsPerCurrency: 0,
    marketEnabled: false,
    signalTrading: true,
    signalRevenue: true,
    signalServices: true,
    signalSignups: true,
    signalMinting: true,
    maxSwingPct: DEFAULT_MAX_SWING_PCT,
    maxSupply: 0,
    currency: "RM",
    updatedAt: null,
    source: "local",
  };
}

async function readCached(): Promise<GetCoinSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GetCoinSettings>;
      const rate = Number(parsed.coinsPerCurrency);
      if (Number.isFinite(rate) && rate > 0) {
        const base = defaultSettings();
        return {
          ...base,
          coinsPerCurrency: rate,
          earnCoinsPerCurrency: Math.max(numOr(parsed.earnCoinsPerCurrency, 0), 0),
          marketEnabled: boolOr(parsed.marketEnabled, false),
          signalTrading: boolOr(parsed.signalTrading, true),
          signalRevenue: boolOr(parsed.signalRevenue, true),
          signalServices: boolOr(parsed.signalServices, true),
          signalSignups: boolOr(parsed.signalSignups, true),
          signalMinting: boolOr(parsed.signalMinting, true),
          maxSwingPct: Math.max(numOr(parsed.maxSwingPct, DEFAULT_MAX_SWING_PCT), 0),
          maxSupply: Math.max(numOr(parsed.maxSupply, 0), 0),
          currency: parsed.currency ?? "RM",
          updatedAt: parsed.updatedAt ?? null,
          source: "local",
        };
      }
    }
  } catch (e) {
    console.log("[getcoin] cache read failed", e);
  }
  return null;
}

async function writeCached(settings: GetCoinSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.log("[getcoin] cache write failed", e);
  }
}

/**
 * Fetch the GET.coin settings. Falls back to the cached / default settings
 * when Supabase or the table isn't available.
 */
export async function fetchGetCoinSettings(): Promise<GetCoinSettings> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("get_coin_settings")
        .select("*")
        .eq("id", "master")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const row = data as Record<string, unknown>;
        const base = defaultSettings();
        const settings: GetCoinSettings = {
          ...base,
          coinsPerCurrency: numOr(row.coins_per_currency, DEFAULT_COINS_PER_CURRENCY) || DEFAULT_COINS_PER_CURRENCY,
          earnCoinsPerCurrency: Math.max(numOr(row.earn_coins_per_currency, 0), 0),
          marketEnabled: boolOr(row.market_enabled, false),
          signalTrading: boolOr(row.signal_trading, true),
          signalRevenue: boolOr(row.signal_revenue, true),
          signalServices: boolOr(row.signal_services, true),
          signalSignups: boolOr(row.signal_signups, true),
          signalMinting: boolOr(row.signal_minting, true),
          maxSwingPct: Math.max(numOr(row.market_max_swing, DEFAULT_MAX_SWING_PCT), 0),
          maxSupply: Math.max(numOr(row.max_supply, 0), 0),
          currency: String(row.currency ?? "RM"),
          updatedAt: (row.updated_at as string | undefined) ?? null,
          source: "supabase",
        };
        await writeCached(settings);
        return settings;
      }
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[getcoin] fetch settings failed", e);
      } else {
        console.log("[getcoin] table missing — using cached/default rate");
      }
    }
  }
  const cached = await readCached();
  if (cached) return cached;
  return defaultSettings();
}

export interface SaveGetCoinResult {
  ok: boolean;
  error?: string;
  settings?: GetCoinSettings;
}

export interface SaveGetCoinInput {
  coinsPerCurrency: number;
  earnCoinsPerCurrency: number;
  marketEnabled?: boolean;
  signalTrading?: boolean;
  signalRevenue?: boolean;
  signalServices?: boolean;
  signalSignups?: boolean;
  signalMinting?: boolean;
  maxSwingPct?: number;
  maxSupply?: number;
}

/** Save the GET.coin exchange, reward, and market settings (admin only). */
export async function saveGetCoinSettings(input: SaveGetCoinInput): Promise<SaveGetCoinResult> {
  const { coinsPerCurrency, earnCoinsPerCurrency } = input;
  if (!(Number.isFinite(coinsPerCurrency) && coinsPerCurrency > 0)) {
    return { ok: false, error: "Enter a rate greater than 0." };
  }
  if (!(Number.isFinite(earnCoinsPerCurrency) && earnCoinsPerCurrency >= 0)) {
    return { ok: false, error: "Enter a reward rate of 0 or more." };
  }
  const swing = Math.min(Math.max(numOr(input.maxSwingPct, DEFAULT_MAX_SWING_PCT), 0), 95);
  const supply = Math.max(numOr(input.maxSupply, 0), 0);

  const settings: GetCoinSettings = {
    coinsPerCurrency,
    earnCoinsPerCurrency,
    marketEnabled: input.marketEnabled ?? false,
    signalTrading: input.signalTrading ?? true,
    signalRevenue: input.signalRevenue ?? true,
    signalServices: input.signalServices ?? true,
    signalSignups: input.signalSignups ?? true,
    signalMinting: input.signalMinting ?? true,
    maxSwingPct: swing,
    maxSupply: supply,
    currency: "RM",
    updatedAt: new Date().toISOString(),
    source: "local",
  };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase
        .from("get_coin_settings")
        .upsert(
          {
            id: "master",
            coins_per_currency: coinsPerCurrency,
            earn_coins_per_currency: earnCoinsPerCurrency,
            market_enabled: settings.marketEnabled,
            signal_trading: settings.signalTrading,
            signal_revenue: settings.signalRevenue,
            signal_services: settings.signalServices,
            signal_signups: settings.signalSignups,
            signal_minting: settings.signalMinting,
            market_max_swing: swing,
            max_supply: supply,
          },
          { onConflict: "id" }
        );
      if (error) throw error;
      settings.source = "supabase";
      await writeCached(settings);
      return { ok: true, settings };
    } catch (e) {
      if (isMissingColumnError(e)) {
        // Market columns not migrated yet — persist the base rates alone and
        // keep market config device-local.
        try {
          const { error: retryErr } = await supabase
            .from("get_coin_settings")
            .upsert(
              {
                id: "master",
                coins_per_currency: coinsPerCurrency,
                earn_coins_per_currency: earnCoinsPerCurrency,
              },
              { onConflict: "id" }
            );
          if (!retryErr) {
            settings.source = "supabase";
            await writeCached(settings);
            return { ok: true, settings };
          }
          if (isMissingColumnError(retryErr)) {
            const { error: rateErr } = await supabase
              .from("get_coin_settings")
              .upsert({ id: "master", coins_per_currency: coinsPerCurrency }, { onConflict: "id" });
            if (!rateErr) {
              settings.source = "supabase";
              await writeCached(settings);
              return { ok: true, settings };
            }
          }
        } catch (retryE) {
          console.log("[getcoin] save retry failed", retryE);
        }
      }
      if (!isMissingSchemaError(e)) {
        console.log("[getcoin] save settings failed", e);
        return { ok: false, error: "Save failed. Please try again." };
      }
      console.log("[getcoin] table missing — saving settings locally");
    }
  }

  await writeCached(settings);
  return { ok: true, settings };
}

/** Save only the GC per currency rate (kept for backwards compatibility). */
export async function saveGetCoinRate(coinsPerCurrency: number): Promise<SaveGetCoinResult> {
  const current = await fetchGetCoinSettings();
  return saveGetCoinSettings({
    ...current,
    coinsPerCurrency,
  });
}

// ============================================================================
// Market pricing
// ============================================================================

/** 30-day in-app economy signals from the `get_coin_market_stats` RPC. */
export interface CoinMarketStats {
  /** GC bought through trading (30d). */
  tradeBuyGc: number;
  /** GC sold through trading (30d). */
  tradeSellGc: number;
  /** RM commission revenue charged to partners (30d). */
  commissionRevenue: number;
  /** Completed services (30d). */
  completedServices: number;
  /** New user + partner sign-ups (30d). */
  newSignups: number;
  /** New GC minted — rewards, grants, purchases (30d). */
  mintedGc: number;
  /** Total GC in circulation right now. */
  circulatingSupply: number;
  source: GetCoinSource;
}

const ZERO_STATS: CoinMarketStats = {
  tradeBuyGc: 0,
  tradeSellGc: 0,
  commissionRevenue: 0,
  completedServices: 0,
  newSignups: 0,
  mintedGc: 0,
  circulatingSupply: 0,
  source: "local",
};

/** Fetch market signals. Degrades to zeros when the RPC isn't migrated. */
export async function fetchCoinMarketStats(): Promise<CoinMarketStats> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc("get_coin_market_stats");
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        tradeBuyGc: Math.max(numOr(row.trade_buy_gc, 0), 0),
        tradeSellGc: Math.max(numOr(row.trade_sell_gc, 0), 0),
        commissionRevenue: Math.max(numOr(row.commission_revenue, 0), 0),
        completedServices: Math.max(numOr(row.completed_services, 0), 0),
        newSignups: Math.max(numOr(row.new_signups, 0), 0),
        mintedGc: Math.max(numOr(row.minted_gc, 0), 0),
        circulatingSupply: Math.max(numOr(row.circulating_supply, 0), 0),
        source: "supabase",
      };
    } catch (e) {
      if (!isMissingSchemaError(e)) console.log("[getcoin] market stats failed", e);
      else console.log("[getcoin] market stats RPC missing — using zero signals");
    }
  }
  return { ...ZERO_STATS };
}

export interface MarketSignalContribution {
  key: string;
  label: string;
  /** Contribution to the price move, in percent (+ pushes price up). */
  pct: number;
}

export interface CoinMarketRate {
  /** Pegged RM value of 1 GC (from the admin exchange rate). */
  baseRatePerGC: number;
  /** Market RM value of 1 GC. */
  ratePerGC: number;
  /** Price multiplier vs the peg (1 = at peg). */
  multiplier: number;
  /** Effective GC per RM1 at the market rate. */
  coinsPerCurrency: number;
  /** % change vs the pegged rate. */
  changePct: number;
  /** Per-signal breakdown of the move (enabled signals only). */
  contributions: MarketSignalContribution[];
}

/** log-scaled 0..1 normalisation for unbounded counters. */
function logNorm(value: number, divisor: number): number {
  return Math.min(Math.log10(1 + Math.max(value, 0)) / divisor, 1);
}

/**
 * Deterministic market price from in-app signals. Demand signals (trading
 * inflow, revenue, services, sign-ups, scarcity) push the price up; supply
 * signals (net selling, fresh minting) push it down. The total move is
 * clamped to ±`maxSwingPct`.
 */
export function computeMarketRate(
  settings: GetCoinSettings,
  stats: CoinMarketStats
): CoinMarketRate {
  const peg = settings.coinsPerCurrency > 0 ? 1 / settings.coinsPerCurrency : 0;
  const contributions: MarketSignalContribution[] = [];
  let pressure = 0;

  if (settings.marketEnabled && peg > 0) {
    if (settings.signalTrading) {
      const total = stats.tradeBuyGc + stats.tradeSellGc;
      const net = total > 0 ? (stats.tradeBuyGc - stats.tradeSellGc) / (total + 50) : 0;
      const c = 0.35 * net;
      pressure += c;
      contributions.push({ key: "trading", label: "Trading activity", pct: c * 100 });
    }
    if (settings.signalRevenue) {
      const c = 0.25 * logNorm(stats.commissionRevenue, 4);
      pressure += c;
      contributions.push({ key: "revenue", label: "Commission revenue", pct: c * 100 });
    }
    if (settings.signalServices) {
      const c = 0.2 * logNorm(stats.completedServices, 3);
      pressure += c;
      contributions.push({ key: "services", label: "Completed services", pct: c * 100 });
    }
    if (settings.signalSignups) {
      const c = 0.1 * logNorm(stats.newSignups, 2.5);
      pressure += c;
      contributions.push({ key: "signups", label: "New sign-ups", pct: c * 100 });
    }
    if (settings.signalMinting) {
      const c = -0.3 * logNorm(stats.mintedGc, 4);
      pressure += c;
      contributions.push({ key: "minting", label: "New coins minted", pct: c * 100 });
    }
    if (settings.maxSupply > 0 && stats.circulatingSupply > 0) {
      const ratio = Math.min(stats.circulatingSupply / settings.maxSupply, 1);
      const c = 0.3 * ratio * ratio;
      pressure += c;
      contributions.push({ key: "scarcity", label: "Supply scarcity", pct: c * 100 });
    }
  }

  const cap = Math.max(settings.maxSwingPct, 0) / 100;
  const clamped = Math.min(Math.max(pressure, -cap), cap);
  const multiplier = settings.marketEnabled ? 1 + clamped : 1;
  const ratePerGC = Math.round(peg * multiplier * 1e6) / 1e6;

  return {
    baseRatePerGC: peg,
    ratePerGC,
    multiplier,
    coinsPerCurrency: ratePerGC > 0 ? 1 / ratePerGC : settings.coinsPerCurrency,
    changePct: Math.round((multiplier - 1) * 10000) / 100,
    contributions,
  };
}

export interface CoinRatePoint {
  rate: number;
  at: string;
}

/** Latest rate snapshots, oldest first (for the price chart). */
export async function fetchCoinRateHistory(limit = 48): Promise<CoinRatePoint[]> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("get_coin_rate_history")
        .select("rate_per_gc, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as { rate_per_gc: number; recorded_at: string }[];
      return rows
        .map((r) => ({ rate: Number(r.rate_per_gc), at: r.recorded_at }))
        .filter((p) => Number.isFinite(p.rate) && p.rate > 0)
        .reverse();
    } catch (e) {
      if (!isMissingSchemaError(e)) console.log("[getcoin] rate history failed", e);
    }
  }
  return [];
}

/**
 * Record a rate snapshot for the price chart — at most one point per ~15
 * minutes (checked against the latest stored point). Best-effort.
 */
export async function recordCoinRateSnapshot(ratePerGC: number): Promise<void> {
  if (!(ratePerGC > 0) || !isSupabaseConfigured || !supabase) return;
  try {
    const { data } = await supabase
      .from("get_coin_rate_history")
      .select("recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = data ? new Date((data as { recorded_at: string }).recorded_at).getTime() : 0;
    if (Date.now() - last < 15 * 60 * 1000) return;
    await supabase.from("get_coin_rate_history").insert({ rate_per_gc: ratePerGC });
  } catch (e) {
    console.log("[getcoin] rate snapshot skipped", e);
  }
}

// ============================================================================
// Conversions
// ============================================================================

/** Convert a GC amount to its approximate currency (RM) value. */
export function coinsToCurrency(coins: number, coinsPerCurrency: number): number {
  if (!(coinsPerCurrency > 0)) return 0;
  return Math.round((coins / coinsPerCurrency) * 100) / 100;
}

/** Convert a currency (RM) amount to GC. */
export function currencyToCoins(amount: number, coinsPerCurrency: number): number {
  return Math.round(amount * coinsPerCurrency * 100) / 100;
}

/** GC earned for a completed ride at the given earn rate. */
export function rideRewardCoins(fareTotal: number, earnCoinsPerCurrency: number): number {
  if (!(fareTotal > 0) || !(earnCoinsPerCurrency > 0)) return 0;
  return Math.round(fareTotal * earnCoinsPerCurrency * 100) / 100;
}

/** "125 GC" for whole values, "125.50 GC" otherwise. */
export function formatCoins(coins: number): string {
  const abs = Math.abs(coins);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  return `${whole ? Math.round(abs).toLocaleString() : abs.toFixed(2)} GC`;
}
