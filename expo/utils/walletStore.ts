import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { resolveCommissionRateForRide, DEFAULT_COMMISSION_RATE } from "@/utils/commissionStore";
import { fetchGetCoinSettings, rideRewardCoins } from "@/utils/getCoinStore";

/**
 * Wallet store — three wallets per account:
 *  - GET.wallet  (master): usable in both user & partner mode, topped up via
 *    payment methods.
 *  - GET.credit  (partner): pays for in-app services & commissions; recharged
 *    by transferring funds from GET.wallet.
 *  - GET.coin    (user & partner): denominated in GC (Get Coins), not
 *    currency. The GC <-> RM exchange rate is set from Admin -> Settings ->
 *    Get Coin (see utils/getCoinStore.ts).
 *
 * Supabase-backed (tables from migrations/0056_wallets.sql). If those tables
 * haven't been applied to the live database yet, every function degrades to a
 * device-local AsyncStorage wallet so the feature stays usable, and callers
 * receive `source: "local"` to surface a notice.
 */

export type WalletType = "get_wallet" | "get_credit" | "get_coin";

export type WalletSource = "supabase" | "local";

export interface WalletBalances {
  getWallet: number;
  getCredit: number;
  /** GET.coin balance, denominated in GC (not currency). */
  getCoin: number;
  currency: string;
  source: WalletSource;
}

export interface WalletTransaction {
  id: string;
  walletType: WalletType;
  kind: string;
  amount: number;
  balanceAfter: number | null;
  method: string | null;
  note: string | null;
  createdAt: string;
}

export interface WalletActionResult {
  ok: boolean;
  error?: string;
  balances?: WalletBalances;
}

export interface PayResult extends WalletActionResult {
  /** GC redeemed towards this payment (0 when coins weren't used). */
  coinsUsed?: number;
  /** Currency value the redeemed coins covered. */
  coinValue?: number;
  /** Currency amount charged to GET.wallet. */
  walletPaid?: number;
}

const LOCAL_BALANCES_KEY = (userId: string) => `wallet:balances:${userId}`;
const LOCAL_TX_KEY = (userId: string) => `wallet:transactions:${userId}`;
const COMMISSION_GUARD_KEY = (rideKey: string) => `wallet:commission:${rideKey}`;
const COIN_REWARD_GUARD_KEY = (rideKey: string) => `wallet:coinreward:${rideKey}`;
const COIN_REDEEM_GUARD_KEY = (rideKey: string) => `wallet:coinredeem:${rideKey}`;

/**
 * Fallback platform commission rate. The effective rate is resolved per ride
 * from Admin → Settings → Commission Rates (user → suburb → city → state →
 * country → master), falling back to this default.
 */
export const RIDE_COMMISSION_RATE = DEFAULT_COMMISSION_RATE;

interface LocalWalletState {
  getWallet: number;
  getCredit: number;
  getCoin: number;
}

/** True when the error indicates the wallet tables/functions aren't in the DB yet. */
function isMissingSchemaError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? String((err as { message?: string; code?: string }).message ?? "") +
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

/**
 * True when the database rejected the call because the caller isn't the
 * wallet's owner (0066 lockdown: wallet writes require an authenticated
 * Supabase session matching the target user). Legacy local-PIN sessions land
 * here — surface a sign-in prompt instead of a generic failure.
 */
function isPermissionError(err: unknown): boolean {
  const msg = (
    typeof err === "object" && err !== null
      ? String((err as { message?: string; code?: string }).message ?? "") +
        " " +
        String((err as { code?: string }).code ?? "")
      : String(err ?? "")
  ).toLowerCase();
  return (
    msg.includes("not_authorized") ||
    msg.includes("42501") ||
    msg.includes("permission denied") ||
    msg.includes("row-level security")
  );
}

const SIGN_IN_ERROR =
  "Your session can't access the shared wallet. Please sign in again.";

/** UUID shape check — ride keys may also be local/simulated identifiers. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function readLocalBalances(userId: string): Promise<LocalWalletState> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_BALANCES_KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalWalletState>;
      return {
        getWallet: Number(parsed.getWallet ?? 0),
        getCredit: Number(parsed.getCredit ?? 0),
        getCoin: Number(parsed.getCoin ?? 0),
      };
    }
  } catch (e) {
    console.log("[wallet] local balances read failed", e);
  }
  return { getWallet: 0, getCredit: 0, getCoin: 0 };
}

async function writeLocalBalances(userId: string, state: LocalWalletState): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_BALANCES_KEY(userId), JSON.stringify(state));
  } catch (e) {
    console.log("[wallet] local balances write failed", e);
  }
}

async function readLocalTransactions(userId: string): Promise<WalletTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_TX_KEY(userId));
    if (raw) return JSON.parse(raw) as WalletTransaction[];
  } catch (e) {
    console.log("[wallet] local tx read failed", e);
  }
  return [];
}

async function appendLocalTransactions(
  userId: string,
  txs: Omit<WalletTransaction, "id" | "createdAt">[]
): Promise<void> {
  try {
    const existing = await readLocalTransactions(userId);
    const now = new Date().toISOString();
    const rows: WalletTransaction[] = txs.map((t) => ({
      ...t,
      id: uuidv4(),
      createdAt: now,
    }));
    const next = [...rows, ...existing].slice(0, 200);
    await AsyncStorage.setItem(LOCAL_TX_KEY(userId), JSON.stringify(next));
  } catch (e) {
    console.log("[wallet] local tx write failed", e);
  }
}

/**
 * Fetch both wallet balances for a user, creating missing wallet rows.
 * Falls back to device-local balances when the DB schema isn't applied.
 */
export async function fetchWalletBalances(userId: string): Promise<WalletBalances> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("wallets")
        .select("wallet_type, balance, currency")
        .eq("user_id", userId);
      if (error) throw error;

      const rows = (data ?? []) as { wallet_type: string; balance: number; currency: string }[];
      const missing: WalletType[] = (["get_wallet", "get_credit", "get_coin"] as WalletType[]).filter(
        (t) => !rows.some((r) => r.wallet_type === t)
      );
      if (missing.length > 0) {
        const { error: insErr } = await supabase
          .from("wallets")
          .upsert(
            missing.map((t) => ({ user_id: userId, wallet_type: t, balance: 0 })),
            { onConflict: "user_id,wallet_type", ignoreDuplicates: true }
          );
        if (insErr) console.log("[wallet] ensure rows failed", insErr.message);
      }

      const find = (t: WalletType) => rows.find((r) => r.wallet_type === t);
      return {
        getWallet: Number(find("get_wallet")?.balance ?? 0),
        getCredit: Number(find("get_credit")?.balance ?? 0),
        getCoin: Number(find("get_coin")?.balance ?? 0),
        currency: find("get_wallet")?.currency ?? "RM",
        source: "supabase",
      };
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] fetch balances failed", e);
      } else {
        console.log("[wallet] tables missing — using local wallet fallback");
      }
    }
  }
  const local = await readLocalBalances(userId);
  return {
    getWallet: local.getWallet,
    getCredit: local.getCredit,
    getCoin: local.getCoin,
    currency: "RM",
    source: "local",
  };
}

/**
 * Subscribe to realtime wallet changes for a user. Fires `onChange` whenever
 * the user's wallet balances or transactions change in the database, so the
 * UI can refetch and stay live. Returns an unsubscribe function.
 *
 * No-ops (returns a dummy unsubscribe) when Supabase isn't configured — the
 * device-local wallet has no external writers, so polling isn't needed.
 */
export function subscribeWalletRealtime(userId: string, onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase || !userId) return () => {};

  // Debounce: a top-up/commission writes both a wallet row and a transaction
  // row, which arrive as separate events — coalesce them into one refetch.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 250);
  };

  try {
    const channel = supabase
      .channel(`wallet-live-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        notify
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${userId}` },
        notify
      )
      .subscribe((status) => {
        console.log("[wallet] realtime channel status", status);
      });

    return () => {
      if (timer) clearTimeout(timer);
      try {
        supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[wallet] realtime unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[wallet] realtime subscribe failed", e);
    return () => {};
  }
}

/** Fetch latest transactions, newest first. Optionally filter by wallet. */
export async function fetchWalletTransactions(
  userId: string,
  walletType?: WalletType
): Promise<{ transactions: WalletTransaction[]; source: WalletSource }> {
  if (isSupabaseConfigured && supabase) {
    try {
      let query = supabase
        .from("wallet_transactions")
        .select("id, wallet_type, kind, amount, balance_after, method, note, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (walletType) query = query.eq("wallet_type", walletType);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as {
        id: string;
        wallet_type: WalletType;
        kind: string;
        amount: number;
        balance_after: number | null;
        method: string | null;
        note: string | null;
        created_at: string;
      }[];
      return {
        transactions: rows.map((r) => ({
          id: r.id,
          walletType: r.wallet_type,
          kind: r.kind,
          amount: Number(r.amount),
          balanceAfter: r.balance_after === null ? null : Number(r.balance_after),
          method: r.method,
          note: r.note,
          createdAt: r.created_at,
        })),
        source: "supabase",
      };
    } catch (e) {
      if (!isMissingSchemaError(e)) console.log("[wallet] fetch tx failed", e);
    }
  }
  const all = await readLocalTransactions(userId);
  return {
    transactions: walletType ? all.filter((t) => t.walletType === walletType) : all,
    source: "local",
  };
}

/**
 * Top up GET.wallet. Uses the atomic `wallet_topup` RPC; falls back to direct
 * table writes, then to the local wallet when the schema is missing.
 */
export async function topUpWallet(
  userId: string,
  amount: number,
  method: string
): Promise<WalletActionResult> {
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than 0." };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.rpc("wallet_topup", {
        p_user: userId,
        p_amount: amount,
        p_method: method,
      });
      if (error) throw error;
      return { ok: true, balances: await fetchWalletBalances(userId) };
    } catch (e) {
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] topup rpc failed", e);
        return { ok: false, error: "Top up failed. Please try again." };
      }
      console.log("[wallet] topup falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  const next: LocalWalletState = { ...local, getWallet: round2(local.getWallet + amount) };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(userId, [
    {
      walletType: "get_wallet",
      kind: "topup",
      amount,
      balanceAfter: next.getWallet,
      method,
      note: "Top up GET.wallet",
    },
  ]);
  return {
    ok: true,
    balances: {
      getWallet: next.getWallet,
      getCredit: next.getCredit,
      getCoin: next.getCoin,
      currency: "RM",
      source: "local",
    },
  };
}

/**
 * Recharge GET.credit by transferring from GET.wallet. Uses the atomic
 * `wallet_recharge_credit` RPC with local fallback.
 */
export async function rechargeCredit(
  userId: string,
  amount: number
): Promise<WalletActionResult> {
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than 0." };

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.rpc("wallet_recharge_credit", {
        p_user: userId,
        p_amount: amount,
      });
      if (error) {
        if (String(error.message ?? "").includes("insufficient_balance")) {
          return { ok: false, error: "Not enough balance in GET.wallet." };
        }
        throw error;
      }
      return { ok: true, balances: await fetchWalletBalances(userId) };
    } catch (e) {
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] recharge rpc failed", e);
        return { ok: false, error: "Recharge failed. Please try again." };
      }
      console.log("[wallet] recharge falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  if (local.getWallet < amount) {
    return { ok: false, error: "Not enough balance in GET.wallet." };
  }
  const next: LocalWalletState = {
    ...local,
    getWallet: round2(local.getWallet - amount),
    getCredit: round2(local.getCredit + amount),
  };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(userId, [
    {
      walletType: "get_credit",
      kind: "recharge_in",
      amount,
      balanceAfter: next.getCredit,
      method: null,
      note: "Recharged from GET.wallet",
    },
    {
      walletType: "get_wallet",
      kind: "recharge_out",
      amount: -amount,
      balanceAfter: next.getWallet,
      method: null,
      note: "Recharge GET.credit",
    },
  ]);
  return {
    ok: true,
    balances: {
      getWallet: next.getWallet,
      getCredit: next.getCredit,
      getCoin: next.getCoin,
      currency: "RM",
      source: "local",
    },
  };
}

export interface CoinRedemptionOption {
  /** Redeem GET.coin towards this payment. */
  redeemCoins: boolean;
  /** GC per 1 unit of currency — from Admin → Settings → Get Coin. */
  coinsPerCurrency: number;
}

/**
 * Split a payment between GET.coin and GET.wallet: coins cover as much of the
 * amount as the balance allows, GET.wallet pays the remainder.
 */
export function computeCoinSplit(
  amount: number,
  coinBalance: number,
  coinsPerCurrency: number
): { coinsUsed: number; coinValue: number; walletShare: number } {
  if (!(amount > 0) || !(coinBalance > 0) || !(coinsPerCurrency > 0)) {
    return { coinsUsed: 0, coinValue: 0, walletShare: round2(Math.max(amount, 0)) };
  }
  const maxCoinValue = Math.floor((coinBalance / coinsPerCurrency) * 100) / 100;
  const coinValue = Math.min(maxCoinValue, amount);
  const coinsUsed = round2(coinValue * coinsPerCurrency);
  return { coinsUsed, coinValue, walletShare: round2(amount - coinValue) };
}

/**
 * Pay from GET.wallet by scanning a QR code, optionally redeeming GET.coin
 * first (coins cover what they can, GET.wallet pays the rest). Ledger-driven:
 * inserts negative `redeem` / `payment` transactions and the DB trigger moves
 * the balances. Falls back to the device-local wallet when the schema is
 * missing.
 */
export async function payFromWallet(
  userId: string,
  amount: number,
  note: string,
  coinOption?: CoinRedemptionOption
): Promise<PayResult> {
  if (!userId) return { ok: false, error: "Missing user." };
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than 0." };

  const useCoins = coinOption?.redeemCoins === true && (coinOption?.coinsPerCurrency ?? 0) > 0;

  if (isSupabaseConfigured && supabase) {
    // Preferred: atomic owner-scoped RPC (migration 0066). The coin exchange
    // rate is resolved server-side, so the split can't be tampered with.
    try {
      const { data, error } = await supabase.rpc("wallet_pay", {
        p_user: userId,
        p_amount: amount,
        p_note: note,
        p_method: "qr_scan",
        p_redeem_coins: coinOption?.redeemCoins === true,
      });
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        balances: await fetchWalletBalances(userId),
        coinsUsed: Number(row.coins_used ?? 0),
        coinValue: Number(row.coin_value ?? 0),
        walletPaid: Number(row.wallet_paid ?? 0),
      };
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
      if (msg.includes("insufficient_balance")) {
        return { ok: false, error: "Not enough balance in GET.wallet." };
      }
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] wallet_pay rpc failed", e);
        return { ok: false, error: "Payment failed. Please try again." };
      }
      console.log("[wallet] wallet_pay RPC missing — falling back to ledger inserts");
    }

    // Pre-0066 database: settle with direct ledger inserts (the 0060 trigger
    // moves the balances).
    try {
      const balances = await fetchWalletBalances(userId);
      if (balances.source === "supabase") {
        const split = useCoins
          ? computeCoinSplit(amount, balances.getCoin, coinOption?.coinsPerCurrency ?? 0)
          : { coinsUsed: 0, coinValue: 0, walletShare: amount };
        if (balances.getWallet < split.walletShare) {
          return { ok: false, error: "Not enough balance in GET.wallet." };
        }
        const rows: Record<string, unknown>[] = [];
        if (split.coinsUsed > 0) {
          rows.push({
            user_id: userId,
            wallet_type: "get_coin",
            kind: "redeem",
            amount: -split.coinsUsed,
            method: "qr_scan",
            note: `${note} — paid with coins (RM${split.coinValue.toFixed(2)})`,
          });
        }
        if (split.walletShare > 0) {
          rows.push({
            user_id: userId,
            wallet_type: "get_wallet",
            kind: "payment",
            amount: -split.walletShare,
            method: "qr_scan",
            note,
          });
        }
        if (rows.length > 0) {
          const { error } = await supabase.from("wallet_transactions").insert(rows);
          if (error) throw error;
        }
        return {
          ok: true,
          balances: await fetchWalletBalances(userId),
          coinsUsed: split.coinsUsed,
          coinValue: split.coinValue,
          walletPaid: split.walletShare,
        };
      }
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
      if (msg.includes("check") || msg.includes("balance") || msg.includes("negative")) {
        return { ok: false, error: "Not enough balance in GET.wallet." };
      }
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] payment failed", e);
        return { ok: false, error: "Payment failed. Please try again." };
      }
      console.log("[wallet] payment falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  const split = useCoins
    ? computeCoinSplit(amount, local.getCoin, coinOption?.coinsPerCurrency ?? 0)
    : { coinsUsed: 0, coinValue: 0, walletShare: amount };
  if (local.getWallet < split.walletShare) {
    return { ok: false, error: "Not enough balance in GET.wallet." };
  }
  const next: LocalWalletState = {
    ...local,
    getWallet: round2(local.getWallet - split.walletShare),
    getCoin: round2(local.getCoin - split.coinsUsed),
  };
  await writeLocalBalances(userId, next);
  const txRows: Omit<WalletTransaction, "id" | "createdAt">[] = [];
  if (split.coinsUsed > 0) {
    txRows.push({
      walletType: "get_coin",
      kind: "redeem",
      amount: -split.coinsUsed,
      balanceAfter: next.getCoin,
      method: "qr_scan",
      note: `${note} — paid with coins (RM${split.coinValue.toFixed(2)})`,
    });
  }
  if (split.walletShare > 0) {
    txRows.push({
      walletType: "get_wallet",
      kind: "payment",
      amount: -split.walletShare,
      balanceAfter: next.getWallet,
      method: "qr_scan",
      note,
    });
  }
  await appendLocalTransactions(userId, txRows);
  return {
    ok: true,
    balances: {
      getWallet: next.getWallet,
      getCredit: next.getCredit,
      getCoin: next.getCoin,
      currency: "RM",
      source: "local",
    },
    coinsUsed: split.coinsUsed,
    coinValue: split.coinValue,
    walletPaid: split.walletShare,
  };
}

export interface CoinRewardResult {
  ok: boolean;
  /** GC awarded (0 when rewards are disabled or already claimed). */
  coins: number;
  error?: string;
}

/**
 * Awards GET.coin ride rewards to the rider after a completed trip, at the
 * admin-configured earn rate (GC per RM1 of fare; 0 disables rewards).
 * Idempotent per ride: the `wallet_award_ride_coins` RPC anchors on
 * `ride_requests.coin_rewarded_at`, and a device-local guard covers the
 * AsyncStorage fallback.
 */
export async function awardRideCoins(input: {
  userId: string;
  /** Final trip total the rider paid. */
  fareTotal: number;
  rideRequestId?: string | null;
  /** Fallback idempotency key when there is no ride request row. */
  rideKey?: string | null;
}): Promise<CoinRewardResult> {
  const { userId, fareTotal, rideRequestId } = input;
  if (!userId) return { ok: false, coins: 0, error: "Missing user." };
  if (!(fareTotal > 0)) return { ok: false, coins: 0, error: "Invalid fare." };

  const settings = await fetchGetCoinSettings();
  const coins = rideRewardCoins(fareTotal, settings.earnCoinsPerCurrency);
  if (!(coins > 0)) {
    console.log("[wallet] ride rewards disabled — nothing to award");
    return { ok: true, coins: 0 };
  }

  const guardKey = rideRequestId ?? input.rideKey ?? null;
  if (!guardKey) return { ok: false, coins: 0, error: "Missing ride reference." };

  try {
    const done = await AsyncStorage.getItem(COIN_REWARD_GUARD_KEY(guardKey));
    if (done) {
      console.log("[wallet] ride coins already awarded", guardKey);
      return { ok: true, coins: 0 };
    }
  } catch (e) {
    console.log("[wallet] coin reward guard read failed", e);
  }
  const markAwarded = async () => {
    try {
      await AsyncStorage.setItem(COIN_REWARD_GUARD_KEY(guardKey), new Date().toISOString());
    } catch (e) {
      console.log("[wallet] coin reward guard write failed", e);
    }
  };

  if (isSupabaseConfigured && supabase && rideRequestId) {
    try {
      const { data, error } = await supabase.rpc("wallet_award_ride_coins", {
        p_ride: rideRequestId,
        p_user: userId,
        p_fare: fareTotal,
      });
      if (error) throw error;
      await markAwarded();
      const awarded = Number(data ?? 0);
      console.log("[wallet] ride coins awarded (supabase)", { rideRequestId, awarded });
      return { ok: true, coins: awarded };
    } catch (e) {
      if (isPermissionError(e)) {
        return { ok: false, coins: 0, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] coin reward rpc failed", e);
        return { ok: false, coins: 0, error: "Reward failed." };
      }
      console.log("[wallet] coin reward falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  const next: LocalWalletState = { ...local, getCoin: round2(local.getCoin + coins) };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(userId, [
    {
      walletType: "get_coin",
      kind: "reward",
      amount: coins,
      balanceAfter: next.getCoin,
      method: null,
      note: `Ride reward — RM${fareTotal.toFixed(2)} trip`,
    },
  ]);
  await markAwarded();
  console.log("[wallet] ride coins awarded (local)", { guardKey, coins });
  return { ok: true, coins };
}

export interface CoinFareRedeemResult {
  ok: boolean;
  /** GC deducted (0 when nothing could be redeemed). */
  coinsUsed: number;
  /** Currency value the redeemed coins covered. */
  coinValue: number;
  error?: string;
}

/**
 * Redeems GET.coin towards a ride fare when the rider enabled the "Use
 * GET.coin" toggle at booking. Coins cover as much of the fare as the balance
 * allows (at the admin exchange rate); the rider pays the remainder with the
 * ride's payment method. Idempotent per ride via a device-local guard.
 */
export async function redeemCoinsForFare(input: {
  userId: string;
  /** Final trip total. */
  fareTotal: number;
  /** Idempotency key — ride request id or a simulated-ride key. */
  rideKey: string;
}): Promise<CoinFareRedeemResult> {
  const { userId, fareTotal, rideKey } = input;
  if (!userId) return { ok: false, coinsUsed: 0, coinValue: 0, error: "Missing user." };
  if (!(fareTotal > 0)) return { ok: false, coinsUsed: 0, coinValue: 0, error: "Invalid fare." };
  if (!rideKey) return { ok: false, coinsUsed: 0, coinValue: 0, error: "Missing ride reference." };

  try {
    const done = await AsyncStorage.getItem(COIN_REDEEM_GUARD_KEY(rideKey));
    if (done) {
      console.log("[wallet] ride coins already redeemed", rideKey);
      return { ok: true, coinsUsed: 0, coinValue: 0 };
    }
  } catch (e) {
    console.log("[wallet] coin redeem guard read failed", e);
  }
  const markRedeemed = async () => {
    try {
      await AsyncStorage.setItem(COIN_REDEEM_GUARD_KEY(rideKey), new Date().toISOString());
    } catch (e) {
      console.log("[wallet] coin redeem guard write failed", e);
    }
  };

  const settings = await fetchGetCoinSettings();
  const rate = settings.coinsPerCurrency;
  if (!(rate > 0)) return { ok: true, coinsUsed: 0, coinValue: 0 };

  if (isSupabaseConfigured && supabase) {
    // Preferred: atomic owner-scoped RPC (migration 0066). Real ride ids also
    // gain server-side idempotency (ride_requests.fare_coins_redeemed_at);
    // simulated rides pass null and rely on the device-local guard.
    try {
      const { data, error } = await supabase.rpc("wallet_redeem_fare_coins", {
        p_user: userId,
        p_fare: fareTotal,
        p_ride: isUuid(rideKey) ? rideKey : null,
      });
      if (error) throw error;
      await markRedeemed();
      const row = (data ?? {}) as Record<string, unknown>;
      const coinsUsed = Number(row.coins_used ?? 0);
      const coinValue = Number(row.coin_value ?? 0);
      console.log("[wallet] ride coins redeemed (rpc)", { rideKey, coins: coinsUsed });
      return { ok: true, coinsUsed, coinValue };
    } catch (e) {
      if (isPermissionError(e)) {
        return { ok: false, coinsUsed: 0, coinValue: 0, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] coin fare redeem rpc failed", e);
        return { ok: false, coinsUsed: 0, coinValue: 0, error: "Coin redemption failed." };
      }
      console.log("[wallet] wallet_redeem_fare_coins RPC missing — falling back to ledger inserts");
    }

    // Pre-0066 database: settle with a direct ledger insert.
    try {
      const balances = await fetchWalletBalances(userId);
      if (balances.source === "supabase") {
        const split = computeCoinSplit(fareTotal, balances.getCoin, rate);
        if (!(split.coinsUsed > 0)) {
          await markRedeemed();
          return { ok: true, coinsUsed: 0, coinValue: 0 };
        }
        const { error } = await supabase.from("wallet_transactions").insert({
          user_id: userId,
          wallet_type: "get_coin",
          kind: "redeem",
          amount: -split.coinsUsed,
          method: "ride_fare",
          note: `Ride fare \u2014 RM${split.coinValue.toFixed(2)} paid with coins`,
        });
        if (error) throw error;
        await markRedeemed();
        console.log("[wallet] ride coins redeemed (supabase)", { rideKey, coins: split.coinsUsed });
        return { ok: true, coinsUsed: split.coinsUsed, coinValue: split.coinValue };
      }
    } catch (e) {
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] coin fare redeem failed", e);
        return { ok: false, coinsUsed: 0, coinValue: 0, error: "Coin redemption failed." };
      }
      console.log("[wallet] coin fare redeem falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  const split = computeCoinSplit(fareTotal, local.getCoin, rate);
  if (!(split.coinsUsed > 0)) {
    await markRedeemed();
    return { ok: true, coinsUsed: 0, coinValue: 0 };
  }
  const next: LocalWalletState = { ...local, getCoin: round2(local.getCoin - split.coinsUsed) };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(userId, [
    {
      walletType: "get_coin",
      kind: "redeem",
      amount: -split.coinsUsed,
      balanceAfter: next.getCoin,
      method: "ride_fare",
      note: `Ride fare \u2014 RM${split.coinValue.toFixed(2)} paid with coins`,
    },
  ]);
  await markRedeemed();
  console.log("[wallet] ride coins redeemed (local)", { rideKey, coins: split.coinsUsed });
  return { ok: true, coinsUsed: split.coinsUsed, coinValue: split.coinValue };
}

export interface TradeCoinsResult extends WalletActionResult {
  /** GC bought or sold. */
  coins?: number;
  /** RM moved in/out of GET.wallet. */
  amountCurrency?: number;
  /** RM value of 1 GC at execution. */
  ratePerGC?: number;
}

/**
 * Trade GET.coin against GET.wallet at the given rate.
 *  - buy : GET.wallet pays `coins × ratePerGC` RM, GET.coin receives the GC
 *          (mints new coins — blocked when the supply cap would be exceeded).
 *  - sell: GET.coin burns the GC, GET.wallet receives the RM.
 * Ledger-driven: inserts transaction rows and the DB trigger moves balances.
 * Falls back to the device-local wallet when the schema is missing.
 */
export async function tradeCoins(input: {
  userId: string;
  direction: "buy" | "sell";
  coins: number;
  /** RM value of 1 GC at execution (market or pegged rate). */
  ratePerGC: number;
  /** Hard cap on circulating GC (0 = unlimited) — enforced on buys. */
  maxSupply?: number;
  /** Current circulating GC, for cap enforcement. */
  circulatingSupply?: number;
}): Promise<TradeCoinsResult> {
  const { userId, direction, ratePerGC } = input;
  const coins = round2(input.coins);
  if (!userId) return { ok: false, error: "Missing user." };
  if (!(coins > 0)) return { ok: false, error: "Enter an amount greater than 0." };
  if (!(ratePerGC > 0)) return { ok: false, error: "Coin rate unavailable. Try again." };

  const amountCurrency = round2(coins * ratePerGC);
  if (!(amountCurrency > 0)) return { ok: false, error: "Amount is too small to trade." };

  const maxSupply = input.maxSupply ?? 0;
  if (direction === "buy" && maxSupply > 0) {
    const circulating = Math.max(input.circulatingSupply ?? 0, 0);
    const remaining = round2(maxSupply - circulating);
    if (remaining <= 0) {
      return { ok: false, error: "Supply cap reached — no more GC can be minted." };
    }
    if (coins > remaining) {
      return { ok: false, error: `Only ${remaining.toLocaleString()} GC left before the supply cap.` };
    }
  }

  const rateNote = `RM${ratePerGC.toFixed(4)}/GC`;

  if (isSupabaseConfigured && supabase) {
    // Preferred: atomic owner-scoped RPC (migration 0066). The server anchors
    // the rate to the admin peg (clamped to the market swing band) and
    // re-enforces the supply cap, so a client can't trade at a made-up price.
    try {
      const { data, error } = await supabase.rpc("wallet_trade_coins", {
        p_user: userId,
        p_direction: direction,
        p_coins: coins,
        p_rate_per_gc: ratePerGC,
      });
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        balances: await fetchWalletBalances(userId),
        coins: Number(row.coins ?? coins),
        amountCurrency: Number(row.amount_currency ?? amountCurrency),
        ratePerGC: Number(row.rate_per_gc ?? ratePerGC),
      };
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
      if (msg.includes("insufficient_balance")) {
        return { ok: false, error: "Not enough balance in GET.wallet." };
      }
      if (msg.includes("insufficient_coins")) {
        return { ok: false, error: "Not enough GET.coin to sell." };
      }
      if (msg.includes("supply_cap_reached")) {
        return { ok: false, error: "Supply cap reached — no more GC can be minted." };
      }
      if (msg.includes("rate_unavailable")) {
        return { ok: false, error: "Coin rate unavailable. Try again." };
      }
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] wallet_trade_coins rpc failed", e);
        return { ok: false, error: "Trade failed. Please try again." };
      }
      console.log("[wallet] wallet_trade_coins RPC missing — falling back to ledger inserts");
    }

    // Pre-0066 database: settle with direct ledger inserts.
    try {
      const balances = await fetchWalletBalances(userId);
      if (balances.source === "supabase") {
        if (direction === "buy" && balances.getWallet < amountCurrency) {
          return { ok: false, error: "Not enough balance in GET.wallet." };
        }
        if (direction === "sell" && balances.getCoin < coins) {
          return { ok: false, error: "Not enough GET.coin to sell." };
        }
        const rows =
          direction === "buy"
            ? [
                {
                  user_id: userId,
                  wallet_type: "get_wallet",
                  kind: "payment",
                  amount: -amountCurrency,
                  method: "coin_trade",
                  note: `Bought ${coins} GC @ ${rateNote}`,
                },
                {
                  user_id: userId,
                  wallet_type: "get_coin",
                  kind: "topup",
                  amount: coins,
                  method: "trade_buy",
                  note: `Bought @ ${rateNote}`,
                },
              ]
            : [
                {
                  user_id: userId,
                  wallet_type: "get_coin",
                  kind: "redeem",
                  amount: -coins,
                  method: "trade_sell",
                  note: `Sold @ ${rateNote}`,
                },
                {
                  user_id: userId,
                  wallet_type: "get_wallet",
                  kind: "topup",
                  amount: amountCurrency,
                  method: "coin_trade",
                  note: `Sold ${coins} GC @ ${rateNote}`,
                },
              ];
        const { error } = await supabase.from("wallet_transactions").insert(rows);
        if (error) throw error;
        return {
          ok: true,
          balances: await fetchWalletBalances(userId),
          coins,
          amountCurrency,
          ratePerGC,
        };
      }
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
      if (msg.includes("check") || msg.includes("balance") || msg.includes("negative")) {
        return {
          ok: false,
          error: direction === "buy" ? "Not enough balance in GET.wallet." : "Not enough GET.coin to sell.",
        };
      }
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] coin trade failed", e);
        return { ok: false, error: "Trade failed. Please try again." };
      }
      console.log("[wallet] coin trade falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  if (direction === "buy" && local.getWallet < amountCurrency) {
    return { ok: false, error: "Not enough balance in GET.wallet." };
  }
  if (direction === "sell" && local.getCoin < coins) {
    return { ok: false, error: "Not enough GET.coin to sell." };
  }
  const next: LocalWalletState =
    direction === "buy"
      ? {
          ...local,
          getWallet: round2(local.getWallet - amountCurrency),
          getCoin: round2(local.getCoin + coins),
        }
      : {
          ...local,
          getWallet: round2(local.getWallet + amountCurrency),
          getCoin: round2(local.getCoin - coins),
        };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(
    userId,
    direction === "buy"
      ? [
          {
            walletType: "get_coin",
            kind: "topup",
            amount: coins,
            balanceAfter: next.getCoin,
            method: "trade_buy",
            note: `Bought @ ${rateNote}`,
          },
          {
            walletType: "get_wallet",
            kind: "payment",
            amount: -amountCurrency,
            balanceAfter: next.getWallet,
            method: "coin_trade",
            note: `Bought ${coins} GC @ ${rateNote}`,
          },
        ]
      : [
          {
            walletType: "get_wallet",
            kind: "topup",
            amount: amountCurrency,
            balanceAfter: next.getWallet,
            method: "coin_trade",
            note: `Sold ${coins} GC @ ${rateNote}`,
          },
          {
            walletType: "get_coin",
            kind: "redeem",
            amount: -coins,
            balanceAfter: next.getCoin,
            method: "trade_sell",
            note: `Sold @ ${rateNote}`,
          },
        ]
  );
  return {
    ok: true,
    balances: {
      getWallet: next.getWallet,
      getCredit: next.getCredit,
      getCoin: next.getCoin,
      currency: "RM",
      source: "local",
    },
    coins,
    amountCurrency,
    ratePerGC,
  };
}

export interface TransferCoinsResult extends WalletActionResult {
  /** GC sent. */
  coins?: number;
  /** Recipient display name resolved by the server (null when unknown). */
  recipientName?: string | null;
}

/**
 * Send GET.coin to another account (user or partner) — coins move 1:1 between
 * wallets, nothing is minted or burned. Uses the atomic `wallet_transfer_coins`
 * RPC (migration 0064), which resolves the recipient by account id or phone
 * number server-side (profiles are RLS-protected, so the client can't look
 * other users up itself). On pre-0064 databases it falls back to direct
 * ledger inserts for id-addressed recipients (the 0060 trigger moves both
 * balances). A two-party transfer can't settle on one device, so there is no
 * AsyncStorage fallback — offline sends fail with a clear error instead.
 */
export async function transferCoins(input: {
  fromUserId: string;
  /** Recipient account id (e.g. from a scanned getpay:// QR). */
  toUserId?: string;
  /** Recipient phone number — resolved server-side. */
  toPhone?: string;
  coins: number;
  note?: string;
}): Promise<TransferCoinsResult> {
  const { fromUserId } = input;
  const coins = round2(input.coins);
  const toUserId = input.toUserId?.trim() || undefined;
  const toPhone = input.toPhone?.trim() || undefined;
  if (!fromUserId) return { ok: false, error: "Missing user." };
  if (!(coins > 0)) return { ok: false, error: "Enter an amount greater than 0." };
  if (!toUserId && !toPhone) return { ok: false, error: "Enter who to send to." };
  if (toUserId && toUserId === fromUserId) {
    return { ok: false, error: "You can't send coins to yourself." };
  }

  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Sending coins needs a connection. Try again when you're online." };
  }

  const note = input.note?.trim() || null;

  try {
    const { data, error } = await supabase.rpc("wallet_transfer_coins", {
      p_from: fromUserId,
      p_coins: coins,
      p_to: toUserId ?? null,
      p_to_phone: toPhone ?? null,
      p_note: note,
    });
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      balances: await fetchWalletBalances(fromUserId),
      coins,
      recipientName: typeof row.recipient_name === "string" ? row.recipient_name : null,
    };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e ?? "");
    if (msg.includes("insufficient_coins")) {
      return { ok: false, error: "Not enough GET.coin to send." };
    }
    if (msg.includes("recipient_not_found")) {
      return { ok: false, error: "Recipient not found. Check the number and try again." };
    }
    if (msg.includes("self_transfer")) {
      return { ok: false, error: "You can't send coins to yourself." };
    }
    if (msg.includes("invalid_amount")) {
      return { ok: false, error: "Enter an amount greater than 0." };
    }
    if (isPermissionError(e)) {
      return { ok: false, error: SIGN_IN_ERROR };
    }
    if (!isMissingSchemaError(e)) {
      console.log("[wallet] coin transfer failed", e);
      return { ok: false, error: "Transfer failed. Please try again." };
    }
    console.log("[wallet] transfer RPC missing — falling back to ledger inserts");
  }

  // Pre-0064 database: settle by inserting the two ledger rows directly.
  // Phone recipients can't be resolved client-side (profiles are
  // RLS-protected), so this path needs an account id.
  if (!toUserId) {
    return {
      ok: false,
      error: "Sending by phone number isn't available yet. Ask the recipient to show their wallet QR code instead.",
    };
  }
  try {
    const balances = await fetchWalletBalances(fromUserId);
    if (balances.source !== "supabase") {
      return { ok: false, error: "Sending coins needs a connection. Try again when you're online." };
    }
    if (balances.getCoin < coins) {
      return { ok: false, error: "Not enough GET.coin to send." };
    }
    const suffix = note ? ` — ${note}` : "";
    const { error } = await supabase.from("wallet_transactions").insert([
      {
        user_id: fromUserId,
        wallet_type: "get_coin",
        kind: "transfer_out",
        amount: -coins,
        method: "p2p_transfer",
        note: `Sent to ${toUserId.slice(0, 8)}…${suffix}`,
      },
      {
        user_id: toUserId,
        wallet_type: "get_coin",
        kind: "transfer_in",
        amount: coins,
        method: "p2p_transfer",
        note: `Received GET.coin${suffix}`,
      },
    ]);
    if (error) throw error;
    return { ok: true, balances: await fetchWalletBalances(fromUserId), coins, recipientName: null };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
    if (msg.includes("check") || msg.includes("balance") || msg.includes("negative")) {
      return { ok: false, error: "Not enough GET.coin to send." };
    }
    console.log("[wallet] coin transfer fallback failed", e);
    return { ok: false, error: "Transfer failed. Please try again." };
  }
}

export interface CommissionChargeResult {
  ok: boolean;
  /** True when this ride's commission had already been charged earlier. */
  alreadyCharged?: boolean;
  /** Commission amount deducted (or that would be deducted). */
  amount?: number;
  /** Effective rate used for the deduction. */
  rate?: number;
  /** Where the rate came from, e.g. "City: Kuala Lumpur" or "Master rate (admin)". */
  rateLabel?: string;
  error?: string;
}

/**
 * Auto-deducts the platform commission for a completed trip from the
 * partner's GET.credit wallet. Idempotent per ride: the DB function anchors on
 * `ride_requests.commission_charged_at`, and a device-local guard covers the
 * AsyncStorage fallback (and repeated calls before the schema is applied).
 * GET.credit is allowed to go negative — the partner owes the difference.
 *
 * The rate is resolved from Admin → Settings → Commission Rates unless an
 * explicit `rate` is passed: user override → suburb → city → state → country
 * → master → 15% default.
 */
export async function chargeRideCommission(input: {
  partnerId: string;
  /** Final trip total (base fare + tolls + extras). */
  fareTotal: number;
  rideRequestId?: string | null;
  bookingNo?: string | null;
  rate?: number;
}): Promise<CommissionChargeResult> {
  const { partnerId, fareTotal, rideRequestId, bookingNo } = input;
  if (!partnerId) return { ok: false, error: "Missing partner id." };
  if (!(fareTotal > 0)) return { ok: false, error: "Invalid fare." };

  let rate = input.rate ?? 0;
  let rateLabel: string | undefined;
  if (!(input.rate !== undefined && input.rate > 0 && input.rate < 1)) {
    const resolved = await resolveCommissionRateForRide({ partnerId, rideRequestId });
    rate = resolved.rate;
    rateLabel = resolved.label;
  }
  if (!(rate >= 0 && rate < 1)) return { ok: false, error: "Invalid commission rate." };

  const rideKey = rideRequestId ?? bookingNo ?? null;
  if (!rideKey) return { ok: false, error: "Missing ride reference." };

  const amount = round2(fareTotal * rate);
  if (!(amount > 0)) {
    console.log("[wallet] commission rate resolved to 0 — nothing to charge", { rideKey, rateLabel });
    return { ok: true, amount: 0, rate, rateLabel };
  }

  // Client-side idempotency guard (the RPC is also idempotent per ride row).
  try {
    const done = await AsyncStorage.getItem(COMMISSION_GUARD_KEY(rideKey));
    if (done) {
      console.log("[wallet] commission already charged for ride", rideKey);
      return { ok: true, alreadyCharged: true, amount, rate, rateLabel };
    }
  } catch (e) {
    console.log("[wallet] commission guard read failed", e);
  }

  const markCharged = async () => {
    try {
      await AsyncStorage.setItem(COMMISSION_GUARD_KEY(rideKey), new Date().toISOString());
    } catch (e) {
      console.log("[wallet] commission guard write failed", e);
    }
  };

  if (isSupabaseConfigured && supabase && rideRequestId) {
    try {
      const { error } = await supabase.rpc("wallet_charge_ride_commission", {
        p_ride: rideRequestId,
        p_partner: partnerId,
        p_fare: fareTotal,
        p_rate: rate,
      });
      if (error) throw error;
      await markCharged();
      console.log("[wallet] ride commission charged (supabase)", { rideRequestId, amount, rate, rateLabel });
      return { ok: true, amount, rate, rateLabel };
    } catch (e) {
      if (isPermissionError(e)) {
        return { ok: false, error: SIGN_IN_ERROR, amount, rate, rateLabel };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] commission rpc failed", e);
        return { ok: false, error: "Commission charge failed.", amount, rate, rateLabel };
      }
      console.log("[wallet] commission falling back to local wallet");
    }
  }

  // Local fallback — deduct from the device-local GET.credit (may go negative).
  const local = await readLocalBalances(partnerId);
  const next: LocalWalletState = { ...local, getCredit: round2(local.getCredit - amount) };
  await writeLocalBalances(partnerId, next);
  const ratePct = Math.round(rate * 1000) / 10;
  await appendLocalTransactions(partnerId, [
    {
      walletType: "get_credit",
      kind: "commission",
      amount: -amount,
      balanceAfter: next.getCredit,
      method: null,
      note: `Ride commission ${ratePct}% of RM ${fareTotal.toFixed(2)}${bookingNo ? ` — #${bookingNo}` : ""}`,
    },
  ]);
  await markCharged();
  console.log("[wallet] ride commission charged (local)", { rideKey, amount, rate, rateLabel });
  return { ok: true, amount, rate, rateLabel };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
