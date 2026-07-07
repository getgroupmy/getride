import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";

/**
 * Wallet store — two wallets per account:
 *  - GET.wallet  (master): usable in both user & partner mode, topped up via
 *    payment methods.
 *  - GET.credit  (partner): pays for in-app services & commissions; recharged
 *    by transferring funds from GET.wallet.
 *
 * Supabase-backed (tables from migrations/0056_wallets.sql). If those tables
 * haven't been applied to the live database yet, every function degrades to a
 * device-local AsyncStorage wallet so the feature stays usable, and callers
 * receive `source: "local"` to surface a notice.
 */

export type WalletType = "get_wallet" | "get_credit";

export type WalletSource = "supabase" | "local";

export interface WalletBalances {
  getWallet: number;
  getCredit: number;
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

interface LocalWalletState {
  getWallet: number;
  getCredit: number;
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
      };
    }
  } catch (e) {
    console.log("[wallet] local balances read failed", e);
  }
  return { getWallet: 0, getCredit: 0 };
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
      const missing: WalletType[] = (["get_wallet", "get_credit"] as WalletType[]).filter(
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
  return { getWallet: local.getWallet, getCredit: local.getCredit, currency: "RM", source: "local" };
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
    balances: { getWallet: next.getWallet, getCredit: next.getCredit, currency: "RM", source: "local" },
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
    balances: { getWallet: next.getWallet, getCredit: next.getCredit, currency: "RM", source: "local" },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
