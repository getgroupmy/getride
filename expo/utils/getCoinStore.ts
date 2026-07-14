import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/**
 * GET.coin settings store — the GC <-> currency exchange rate configured from
 * Admin -> Settings -> Get Coin.
 *
 * `coinsPerCurrency` is how many GC equal 1 unit of currency (RM):
 *   e.g. 10 => RM1 = 10 GC, so 1 GC = RM0.10.
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
  currency: string;
  updatedAt: string | null;
  source: GetCoinSource;
}

/** Neutral default until the admin sets a rate: 1 GC = RM1. */
export const DEFAULT_COINS_PER_CURRENCY = 1;

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

async function readCached(): Promise<GetCoinSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GetCoinSettings>;
      const rate = Number(parsed.coinsPerCurrency);
      if (Number.isFinite(rate) && rate > 0) {
        const earn = Number(parsed.earnCoinsPerCurrency);
        return {
          coinsPerCurrency: rate,
          earnCoinsPerCurrency: Number.isFinite(earn) && earn >= 0 ? earn : 0,
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
 * Fetch the GET.coin exchange rate. Falls back to the cached / default rate
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
        const row = data as {
          coins_per_currency?: number;
          earn_coins_per_currency?: number;
          currency?: string;
          updated_at?: string;
        };
        const earn = Number(row.earn_coins_per_currency);
        const settings: GetCoinSettings = {
          coinsPerCurrency: Number(row.coins_per_currency) || DEFAULT_COINS_PER_CURRENCY,
          earnCoinsPerCurrency: Number.isFinite(earn) && earn >= 0 ? earn : 0,
          currency: String(row.currency ?? "RM"),
          updatedAt: row.updated_at ?? null,
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
  return {
    coinsPerCurrency: DEFAULT_COINS_PER_CURRENCY,
    earnCoinsPerCurrency: 0,
    currency: "RM",
    updatedAt: null,
    source: "local",
  };
}

export interface SaveGetCoinResult {
  ok: boolean;
  error?: string;
  settings?: GetCoinSettings;
}

/** True when the error indicates the earn-rate column isn't in the DB yet. */
function isMissingColumnError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? String((err as { message?: string }).message ?? "") +
        " " +
        String((err as { code?: string }).code ?? "")
      : String(err ?? "");
  return msg.includes("42703") || msg.toLowerCase().includes("column");
}

/** Save the GET.coin exchange + ride-reward rates (admin only). */
export async function saveGetCoinSettings(input: {
  coinsPerCurrency: number;
  earnCoinsPerCurrency: number;
}): Promise<SaveGetCoinResult> {
  const { coinsPerCurrency, earnCoinsPerCurrency } = input;
  if (!(Number.isFinite(coinsPerCurrency) && coinsPerCurrency > 0)) {
    return { ok: false, error: "Enter a rate greater than 0." };
  }
  if (!(Number.isFinite(earnCoinsPerCurrency) && earnCoinsPerCurrency >= 0)) {
    return { ok: false, error: "Enter a reward rate of 0 or more." };
  }

  const settings: GetCoinSettings = {
    coinsPerCurrency,
    earnCoinsPerCurrency,
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
          },
          { onConflict: "id" }
        );
      if (error) throw error;
      settings.source = "supabase";
      await writeCached(settings);
      return { ok: true, settings };
    } catch (e) {
      if (isMissingColumnError(e)) {
        // Earn column not migrated yet — persist the exchange rate alone and
        // keep the earn rate device-local.
        try {
          const { error: retryErr } = await supabase
            .from("get_coin_settings")
            .upsert({ id: "master", coins_per_currency: coinsPerCurrency }, { onConflict: "id" });
          if (!retryErr) {
            settings.source = "supabase";
            await writeCached(settings);
            return { ok: true, settings };
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
    coinsPerCurrency,
    earnCoinsPerCurrency: current.earnCoinsPerCurrency,
  });
}

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
