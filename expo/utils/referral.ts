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

// Referral bonus toast -------------------------------------------------------

/**
 * Which side of a referral a bonus credit belongs to. `apply_referral`
 * (migration 0078) credits GET.coin to *both* accounts, so a user can meet a
 * bonus either by joining with someone's code or by having a friend join with
 * theirs.
 */
export type ReferralBonusKind = "welcome" | "referrer";

export interface ReferralBonusEvent {
  /** GET.coin credited to this account. */
  coins: number;
  kind: ReferralBonusKind;
}

type BonusListener = (event: ReferralBonusEvent) => void;

/** Live listeners that show the bonus toast the instant it's earned. */
const bonusListeners = new Set<BonusListener>();

/**
 * Subscribe to referral bonus events. Called by the globally-mounted
 * `ReferralBonusToast`, which pops a toast naming the GET.coin credited.
 * Returns an unsubscribe function.
 */
export function subscribeReferralBonus(listener: BonusListener): () => void {
  bonusListeners.add(listener);
  return () => {
    bonusListeners.delete(listener);
  };
}

/**
 * Announce a newly-earned referral bonus.
 *
 * When a listener is mounted it shows the toast right away and nothing is
 * written to disk. With nothing listening (the bonus landed mid-navigation or
 * the app was relaunched) the event is queued in AsyncStorage instead, and the
 * toast drains the queue when it next mounts. Splitting the two paths means an
 * event is delivered exactly once — never live *and* from the queue.
 */
async function announceReferralBonus(event: ReferralBonusEvent): Promise<void> {
  if (!(event.coins > 0)) return;
  if (bonusListeners.size > 0) {
    let delivered = false;
    bonusListeners.forEach((listener) => {
      try {
        listener(event);
        delivered = true;
      } catch (e) {
        console.log("[referral] bonus listener threw", e);
      }
    });
    if (delivered) return;
  }
  try {
    const queued = await readPendingReferralBonuses();
    queued.push(event);
    await AsyncStorage.setItem(BONUS_TOAST_KEY, JSON.stringify(queued));
  } catch {}
}

/** Parse the persisted queue, tolerating the legacy single-`{coins}` shape. */
async function readPendingReferralBonuses(): Promise<ReferralBonusEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(BONUS_TOAST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    // Pre-queue builds stored a bare object, always a welcome bonus.
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => {
        const r = (row ?? {}) as { coins?: unknown; kind?: unknown };
        const coins = Math.max(Number(r.coins) || 0, 0);
        const kind: ReferralBonusKind = r.kind === "referrer" ? "referrer" : "welcome";
        return { coins, kind };
      })
      .filter((e) => e.coins > 0);
  } catch {
    return [];
  }
}

/**
 * Read and clear every queued bonus. Returns the events to display (possibly
 * empty). Called by the toast on mount to surface bonuses that landed while no
 * listener was mounted; clearing on read means they never show twice.
 */
export async function consumePendingReferralBonuses(): Promise<ReferralBonusEvent[]> {
  const events = await readPendingReferralBonuses();
  try {
    await AsyncStorage.removeItem(BONUS_TOAST_KEY);
  } catch {}
  return events;
}

// Inviter-side bonus detection -----------------------------------------------
//
// The referred user learns about their bonus from `applyPendingReferral` below
// — they're holding the phone when it happens. The *inviter* is not: their
// coins are credited by a friend's signup, whenever that happens. The only
// trace on the client is the `wallet_transactions` row `apply_referral` writes,
// so the inviter's toast is driven off that row — live via realtime while the
// app is open, and via a catch-up query on launch for credits earned offline.

/** `wallet_transactions.kind` used for both sides of a referral payout. */
const REFERRAL_TX_KIND = "referral";

/** Per-account timestamp: referral credits at or before this were handled. */
const BONUS_WATERMARK_KEY = "referral:bonus_watermark";

/** Recently announced transaction ids, so realtime and catch-up don't overlap. */
const BONUS_SEEN_IDS_KEY = "referral:bonus_seen_ids";

const MAX_SEEN_IDS = 50;

/**
 * Classify a referral payout from the note `apply_referral` writes:
 * "Welcome bonus — joined with a referral link" for the new user versus
 * "Referral bonus — a friend joined with your link" for the inviter.
 * Anything unrecognized is treated as an inviter credit — a welcome bonus only
 * ever occurs at signup, where `applyPendingReferral` already announces it.
 */
function classifyReferralNote(note: unknown): ReferralBonusKind {
  return /^\s*welcome\b/i.test(String(note ?? "")) ? "welcome" : "referrer";
}

async function readSeenBonusIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(BONUS_SEEN_IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

async function markBonusSeen(id: string): Promise<void> {
  try {
    const seen = await readSeenBonusIds();
    if (seen.includes(id)) return;
    seen.push(id);
    await AsyncStorage.setItem(
      BONUS_SEEN_IDS_KEY,
      JSON.stringify(seen.slice(-MAX_SEEN_IDS))
    );
  } catch {}
}

async function setBonusWatermark(userId: string, at: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${BONUS_WATERMARK_KEY}:${userId}`, at);
  } catch {}
}

/**
 * Announce one `wallet_transactions` row if it's an unseen inviter-side
 * referral credit. Returns true when a toast was raised.
 */
async function announceReferralCreditRow(
  userId: string,
  row: Record<string, unknown> | null | undefined
): Promise<boolean> {
  if (!row) return false;
  const txKind = String(row.kind ?? "");
  // Realtime hands us every wallet row for this user — only referrals qualify.
  if (txKind && txKind !== REFERRAL_TX_KIND) return false;
  const id = String(row.id ?? "");
  const coins = Math.max(Number(row.amount) || 0, 0);
  if (!id || !(coins > 0)) return false;
  // The referred user's own welcome bonus is announced by applyPendingReferral.
  if (classifyReferralNote(row.note) !== "referrer") return false;
  const seen = await readSeenBonusIds();
  if (seen.includes(id)) return false;
  await markBonusSeen(id);
  const createdAt = typeof row.created_at === "string" ? row.created_at : null;
  if (createdAt) await setBonusWatermark(userId, createdAt);
  await announceReferralBonus({ coins, kind: "referrer" });
  return true;
}

/**
 * Catch up on inviter-side referral bonuses credited while the app was closed,
 * announcing each one. Call on launch once a Supabase session is available.
 *
 * The first call for an account only records a watermark and announces
 * nothing: referral credits that predate this check are history, not news, and
 * replaying them would fire a burst of toasts on upgrade. Returns how many
 * bonuses were announced.
 *
 * Degrades silently (returns 0) when Supabase is unavailable or the wallet
 * tables aren't migrated yet, per the store conventions in this codebase.
 */
export async function syncReferralBonusCredits(
  userId: string | null | undefined
): Promise<number> {
  if (!isSupabaseConfigured || !supabase || !userId) return 0;
  const watermarkKey = `${BONUS_WATERMARK_KEY}:${userId}`;
  let watermark: string | null = null;
  try {
    watermark = await AsyncStorage.getItem(watermarkKey);
  } catch {}
  if (!watermark) {
    await setBonusWatermark(userId, new Date().toISOString());
    return 0;
  }
  try {
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, kind, amount, note, created_at")
      .eq("user_id", userId)
      .eq("kind", REFERRAL_TX_KIND)
      .gt("created_at", watermark)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      const msg = String(error.message ?? "");
      // Tables not migrated / RLS — nothing to show rather than an error.
      if (/does not exist|schema cache|relation|permission|PGRST\d+/i.test(msg)) {
        return 0;
      }
      throw error;
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    let announced = 0;
    let newest = watermark;
    for (const row of rows) {
      if (await announceReferralCreditRow(userId, row)) announced += 1;
      const createdAt = typeof row.created_at === "string" ? row.created_at : null;
      if (createdAt && createdAt > newest) newest = createdAt;
    }
    // Advance past rows we deliberately skipped too, so they aren't rescanned.
    if (newest !== watermark) await setBonusWatermark(userId, newest);
    return announced;
  } catch (e) {
    console.log("[referral] syncReferralBonusCredits failed", e);
    return 0;
  }
}

/**
 * Subscribe to inviter-side referral bonuses arriving while the app is open —
 * a friend signing up credits the wallet from the server, with no client action
 * to hang a toast off. `wallet_transactions` is in the realtime publication
 * (migration 0059) and readable by its owner, so the insert is enough.
 * Returns an unsubscribe function.
 */
export function subscribeReferralBonusCredits(
  userId: string | null | undefined
): () => void {
  if (!isSupabaseConfigured || !supabase || !userId) return () => {};
  try {
    const channel = supabase
      .channel(`referral-bonus-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          void announceReferralCreditRow(
            userId,
            payload.new as Record<string, unknown>
          ).catch((e) => console.log("[referral] bonus row announce failed", e));
        }
      )
      .subscribe();
    return () => {
      try {
        void supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[referral] bonus unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[referral] bonus subscribe failed", e);
    return () => {};
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
      await announceReferralBonus({ coins: result.referredCoins, kind: "welcome" });
    }
    return result;
  } catch (e) {
    console.log("[referral] apply failed — keeping pending code for retry", e);
    return null;
  }
}
