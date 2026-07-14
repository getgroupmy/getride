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
        return {
          coinsPerCurrency: rate,
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
        .select("coins_per_currency, currency, updated_at")
        .eq("id", "master")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const settings: GetCoinSettings = {
          coinsPerCurrency: Number(data.coins_per_currency) || DEFAULT_COINS_PER_CURRENCY,
          currency: String(data.currency ?? "RM"),
          updatedAt: data.updated_at ?? null,
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

/** Save the GC per currency rate (admin only). */
export async function saveGetCoinRate(coinsPerCurrency: number): Promise<SaveGetCoinResult> {
  if (!(Number.isFinite(coinsPerCurrency) && coinsPerCurrency > 0)) {
    return { ok: false, error: "Enter a rate greater than 0." };
  }

  const settings: GetCoinSettings = {
    coinsPerCurrency,
    currency: "RM",
    updatedAt: new Date().toISOString(),
    source: "local",
  };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase
        .from("get_coin_settings")
        .upsert({ id: "master", coins_per_currency: coinsPerCurrency }, { onConflict: "id" });
      if (error) throw error;
      settings.source = "supabase";
      await writeCached(settings);
      return { ok: true, settings };
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[getcoin] save rate failed", e);
        return { ok: false, error: "Save failed. Please try again." };
      }
      console.log("[getcoin] table missing — saving rate locally");
    }
  }

  await writeCached(settings);
  return { ok: true, settings };
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

/** "125 GC" for whole values, "125.50 GC" otherwise. */
export function formatCoins(coins: number): string {
  const abs = Math.abs(coins);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  return `${whole ? Math.round(abs).toLocaleString() : abs.toFixed(2)} GC`;
}
