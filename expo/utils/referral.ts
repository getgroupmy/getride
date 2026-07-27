import * as ExpoLinking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/** AsyncStorage key holding a referral code captured from a deep link. */
const PENDING_REF_KEY = "referral:pending_code";

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

export interface ApplyReferralResult {
  ok: boolean;
  /** GC credited to the new (referred) user. */
  referredCoins: number;
  /** GC credited to the inviter. */
  referrerCoins: number;
  error?: string;
}

/** Who invited the current user, if they signed up with a referral link. */
export interface MyReferral {
  /** Display name of the inviter (may be "" if they never set a name). */
  referrerName: string;
  /** Welcome bonus (GC) the current user earned for joining via the link. */
  referredCoins: number;
  /** The referral code that was applied. */
  code?: string;
}

/**
 * Fetch the current user's own referral — "You were invited by …" plus the
 * welcome bonus — via the `get_my_referral` RPC (migration 0079). Returns null
 * when the user wasn't referred, when Supabase is unavailable, or when the RPC
 * isn't migrated yet (so the wallet simply hides the card on older databases).
 */
export async function fetchMyReferral(): Promise<MyReferral | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_my_referral");
    if (error) {
      const msg = String(error.message ?? "");
      if (/could not find|does not exist|schema cache|PGRST202/i.test(msg)) {
        console.log("[referral] get_my_referral RPC missing — hiding invited card");
        return null;
      }
      throw error;
    }
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.referred !== true) return null;
    return {
      referrerName: typeof row.referrer_name === "string" ? row.referrer_name : "",
      referredCoins: Math.max(Number(row.referred_coins) || 0, 0),
      code: typeof row.code === "string" ? row.code : undefined,
    };
  } catch (e) {
    console.log("[referral] fetchMyReferral failed", e);
    return null;
  }
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
    return result;
  } catch (e) {
    console.log("[referral] apply failed — keeping pending code for retry", e);
    return null;
  }
}
