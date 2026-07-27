import * as ExpoLinking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/** AsyncStorage key holding a referral code captured from a deep link. */
const PENDING_REF_KEY = "referral:pending_code";

/**
 * AsyncStorage key holding a just-earned referral welcome bonus that still
 * needs to be surfaced to the user as a toast. Persisted (rather than kept
 * in memory only) so the notice survives the navigation from the PIN-setup
 * screen to the home screen — or an app relaunch — that happens right after
 * a fresh sign-up applies the referral.
 */
const BONUS_TOAST_KEY = "referral:bonus_toast";

/**
 * Deterministic, human-friendly referral code derived from the user's id.
 * Strips non-alphanumerics and uppercases so the same user always shares
 * the same code (e.g. "K3F9A2QX").
 */
export function referralCodeForUser(userId: string): string {
  const cleaned = userId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, 8) || "GETRIDE";
}

/**
 * Deep link that opens the app (or web build) with the referral code
 * attached as a `ref` query param, e.g. rork-app:///?ref=K3F9A2QX.
 */
export function buildReferralLink(code: string): string {
  return ExpoLinking.createURL("/", { queryParams: { ref: code } });
}

/**
 * Share-sheet message inviting a friend, including the bonus-coin hook and
 * the deep link.
 */
export function buildReferralMessage(code: string, link: string): string {
  return (
    `Join me on GET.ride! 🚕\n\n` +
    `Sign up with my referral code ${code} and we both earn bonus GET.coin ` +
    `to spend on rides.\n\n${link}`
  );
}

/**
 * Extract the `ref` code from an incoming deep link and stash it so it can
 * be applied after the user finishes signing up. Returns the code when the
 * URL carried one.
 */
export async function capturePendingReferral(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const parsed = ExpoLinking.parse(url);
    const raw = parsed.queryParams?.ref;
    const code = (Array.isArray(raw) ? raw[0] : raw ?? "")
      .toString()
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();
    if (code.length >= 4) {
      await AsyncStorage.setItem(PENDING_REF_KEY, code);
      console.log("[referral] captured pending code from link", code);
      return code;
    }
  } catch (e) {
    console.log("[referral] capture failed", e);
  }
  return null;
}

/** The referral code waiting to be applied on signup, if any. */
export async function getPendingReferralCode(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PENDING_REF_KEY);
  } catch {
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REF_KEY);
  } catch {}
}

// Referral welcome-bonus toast -----------------------------------------------

type BonusListener = (coins: number) => void;

/** Live listeners that show the bonus toast the instant it's earned. */
const bonusListeners = new Set<BonusListener>();

/**
 * Subscribe to referral welcome-bonus events. Called by the globally-mounted
 * `ReferralBonusToast`, which pops a toast naming the GET.coin credited to
 * the new user. Returns an unsubscribe function.
 */
export function subscribeReferralBonus(listener: BonusListener): () => void {
  bonusListeners.add(listener);
  return () => {
    bonusListeners.delete(listener);
  };
}

/**
 * Record a newly-earned welcome bonus and notify any live listeners. Persisted
 * to AsyncStorage so the toast still fires if the app navigates or relaunches
 * before a listener handles it; the listener consumes (clears) the flag when
 * it shows the toast, so the notice appears exactly once.
 */
async function announceReferralBonus(coins: number): Promise<void> {
  if (!(coins > 0)) return;
  try {
    await AsyncStorage.setItem(BONUS_TOAST_KEY, JSON.stringify({ coins }));
  } catch {}
  bonusListeners.forEach((listener) => {
    try {
      listener(coins);
    } catch (e) {
      console.log("[referral] bonus listener threw", e);
    }
  });
}

/**
 * Read and clear any pending welcome-bonus amount. Returns the GC credited,
 * or null when there's nothing to show. Used both on live events (to clear
 * the persisted flag so it isn't shown twice) and on cold start (to surface
 * a bonus that landed while no listener was mounted).
 */
export async function consumePendingReferralBonus(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BONUS_TOAST_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(BONUS_TOAST_KEY);
    const parsed = JSON.parse(raw) as { coins?: unknown };
    const coins = Math.max(Number(parsed?.coins) || 0, 0);
    return coins > 0 ? coins : null;
  } catch {
    return null;
  }
}

export interface MyReferrer {
  /** The inviter's display name, when it's known. */
  name: string | null;
  /** The referral code the user signed up with. */
  code: string | null;
}

/**
 * Look up who invited the signed-in user via the `get_my_referrer` RPC
 * (migration 0079). The `referrals` row is readable by the referred user,
 * but the inviter's `profiles` row is not (self-read RLS), so a
 * SECURITY DEFINER RPC resolves the name server-side.
 *
 * Returns null when the user wasn't referred, the RPC isn't deployed yet,
 * or Supabase is unavailable — callers should simply hide the "Referred"
 * badge in those cases.
 */
export async function fetchMyReferrer(): Promise<MyReferrer | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_my_referrer");
    if (error) {
      const msg = String(error.message ?? "");
      // RPC not migrated yet — treat as "no badge" rather than an error.
      if (/could not find|does not exist|schema cache|PGRST202/i.test(msg)) {
        return null;
      }
      throw error;
    }
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
    const code = typeof row.code === "string" && row.code.trim() ? row.code.trim() : null;
    return { name, code };
  } catch (e) {
    console.log("[referral] fetchMyReferrer failed", e);
    return null;
  }
}

/**
 * Count how many users have successfully signed up using this account's
 * referral code. The `referrals` table records one row per referred user and
 * is readable by the referrer under the "referrals select own" RLS policy
 * (migration 0078), so a `head`/`count` query over the caller's own rows
 * needs no extra RPC.
 *
 * Returns the count (0 or more) when it can be determined, or null when it
 * can't — Supabase unavailable, no authenticated session, the `referrals`
 * table not migrated yet, or a query error — so callers can hide the counter
 * rather than show a misleading zero.
 */
export async function fetchMyReferralCount(
  userId: string | null | undefined
): Promise<number | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  try {
    const { count, error } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", userId);
    if (error) {
      const msg = String(error.message ?? "");
      // Table not migrated yet (or RLS/permission issue) — treat as "unknown"
      // rather than an error so the counter simply hides.
      if (/does not exist|schema cache|relation|permission|PGRST\d+/i.test(msg)) {
        return null;
      }
      throw error;
    }
    return Math.max(Number(count) || 0, 0);
  } catch (e) {
    console.log("[referral] fetchMyReferralCount failed", e);
    return null;
  }
}

export interface ApplyReferralResult {
  ok: boolean;
  /** GC credited to the new (referred) user. */
  referredCoins: number;
  /** GC credited to the inviter. */
  referrerCoins: number;
  error?: string;
}

/**
 * Apply the pending referral code for a freshly signed-up user via the
 * `apply_referral` RPC (migration 0078). Credits bonus GET.coin to both the
 * inviter and the new user server-side. Idempotent: the DB allows one
 * referral per user, and the pending code is cleared on any definitive
 * outcome (success, invalid code, already referred). Best-effort — network
 * failures keep the code stored for a later retry.
 */
export async function applyPendingReferral(): Promise<ApplyReferralResult | null> {
  const code = await getPendingReferralCode();
  if (!code) return null;
  if (!isSupabaseConfigured || !supabase) {
    console.log("[referral] supabase unavailable — keeping pending code");
    return null;
  }
  try {
    const { data, error } = await supabase.rpc("apply_referral", { p_code: code });
    if (error) {
      const msg = String(error.message ?? "");
      // RPC not migrated yet — keep the code so it can apply after migration.
      if (/could not find|does not exist|schema cache|PGRST202/i.test(msg)) {
        console.log("[referral] apply_referral RPC missing — keeping pending code");
        return null;
      }
      throw error;
    }
    const row = (data ?? {}) as Record<string, unknown>;
    const ok = row.ok === true;
    const errCode = typeof row.error === "string" ? row.error : undefined;
    if (ok || errCode === "already_referred" || errCode === "code_not_found" || errCode === "self_referral" || errCode === "invalid_code" || errCode === "disabled") {
      await clearPendingReferral();
    }
    const result: ApplyReferralResult = {
      ok,
      referredCoins: Math.max(Number(row.referred_coins) || 0, 0),
      referrerCoins: Math.max(Number(row.referrer_coins) || 0, 0),
      error: errCode,
    };
    console.log("[referral] apply result", result);
    // Surface the new user's welcome bonus as a toast once they land in the app.
    if (result.ok && result.referredCoins > 0) {
      await announceReferralBonus(result.referredCoins);
    }
    return result;
  } catch (e) {
    console.log("[referral] apply failed — keeping pending code for retry", e);
    return null;
  }
}
