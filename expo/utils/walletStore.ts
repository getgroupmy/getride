import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { resolveCommissionRateForRide, DEFAULT_COMMISSION_RATE } from "@/utils/commissionStore";

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

const LOCAL_BALANCES_KEY = (userId: string) => `wallet:balances:${userId}`;
const LOCAL_TX_KEY = (userId: string) => `wallet:transactions:${userId}`;
const COMMISSION_GUARD_KEY = (rideKey: string) => `wallet:commission:${rideKey}`;

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

/**
 * Pay from GET.wallet by scanning a QR code. Ledger-driven: inserts a negative
 * `payment` transaction and the DB trigger moves the balance. Falls back to
 * the device-local wallet when the schema is missing.
 */
export async function payFromWallet(
  userId: string,
  amount: number,
  note: string
): Promise<WalletActionResult> {
  if (!userId) return { ok: false, error: "Missing user." };
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than 0." };

  if (isSupabaseConfigured && supabase) {
    try {
      const balances = await fetchWalletBalances(userId);
      if (balances.source === "supabase") {
        if (balances.getWallet < amount) {
          return { ok: false, error: "Not enough balance in GET.wallet." };
        }
        const { error } = await supabase.from("wallet_transactions").insert({
          user_id: userId,
          wallet_type: "get_wallet",
          kind: "payment",
          amount: -amount,
          method: "qr_scan",
          note,
        });
        if (error) throw error;
        return { ok: true, balances: await fetchWalletBalances(userId) };
      }
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
      if (msg.includes("check") || msg.includes("balance") || msg.includes("negative")) {
        return { ok: false, error: "Not enough balance in GET.wallet." };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[wallet] payment failed", e);
        return { ok: false, error: "Payment failed. Please try again." };
      }
      console.log("[wallet] payment falling back to local wallet");
    }
  }

  const local = await readLocalBalances(userId);
  if (local.getWallet < amount) {
    return { ok: false, error: "Not enough balance in GET.wallet." };
  }
  const next: LocalWalletState = { ...local, getWallet: round2(local.getWallet - amount) };
  await writeLocalBalances(userId, next);
  await appendLocalTransactions(userId, [
    {
      walletType: "get_wallet",
      kind: "payment",
      amount: -amount,
      balanceAfter: next.getWallet,
      method: "qr_scan",
      note,
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
