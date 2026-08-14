import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  fetchWalletBalances,
  transferCoins,
  type WalletBalances,
} from "@/utils/walletStore";

/**
 * GET.coin transfer approval store (migration 0065).
 *
 * Sending coins is a two-step handshake: the sender confirms a recipient
 * (wallet id, scanned QR or phone number) which creates a *pending*
 * `wallet_transfer_requests` row; the recipient gets a popup naming the
 * sender and the amount and accepts or declines. Coins only move on
 * acceptance. Requests expire after 15 minutes (server-side `expires_at`).
 *
 * Graceful schema degradation: on databases without migration 0065 the
 * request RPC is missing, so `requestCoinTransfer` falls back to the instant
 * `wallet_transfer_coins` transfer (0064 → ledger inserts) and reports
 * `immediate: true` so the UI can skip the waiting-for-approval state.
 */

export type TransferRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired"
  | "failed";

export interface WalletTransferRequest {
  id: string;
  fromUserId: string;
  fromName: string | null;
  toUserId: string;
  toName: string | null;
  coins: number;
  note: string | null;
  status: TransferRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string;
}

export interface RequestTransferResult {
  ok: boolean;
  error?: string;
  /** Pending request id to watch for the recipient's response. */
  requestId?: string;
  /** Recipient display name resolved by the server (null when unknown). */
  recipientName?: string | null;
  coins?: number;
  /**
   * True when the approval flow isn't available (pre-0065 database) and the
   * coins were sent instantly via the legacy transfer instead.
   */
  immediate?: boolean;
  balances?: WalletBalances;
}

export interface RespondTransferResult {
  ok: boolean;
  error?: string;
  /** Resulting request status reported by the server. */
  status?: TransferRequestStatus;
  coins?: number;
  fromName?: string | null;
  toName?: string | null;
  balances?: WalletBalances;
}

/** True when the error indicates the 0065 schema isn't in the DB yet. */
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

function mapRow(row: Record<string, unknown>): WalletTransferRequest {
  return {
    id: String(row.id ?? ""),
    fromUserId: String(row.from_user_id ?? ""),
    fromName: typeof row.from_name === "string" && row.from_name ? row.from_name : null,
    toUserId: String(row.to_user_id ?? ""),
    toName: typeof row.to_name === "string" && row.to_name ? row.to_name : null,
    coins: Number(row.coins ?? 0),
    note: typeof row.note === "string" && row.note ? row.note : null,
    status: (row.status as TransferRequestStatus) ?? "pending",
    createdAt: String(row.created_at ?? ""),
    respondedAt: typeof row.responded_at === "string" ? row.responded_at : null,
    expiresAt: String(row.expires_at ?? ""),
  };
}

/** True when a pending request's expiry timestamp has passed. */
export function isRequestExpired(req: Pick<WalletTransferRequest, "expiresAt">, now = Date.now()): boolean {
  const t = Date.parse(req.expiresAt);
  return Number.isFinite(t) && now > t;
}

/**
 * Step 1 — ask the recipient to approve receiving `coins` GC. Creates a
 * pending request (after a server-side soft balance check) and notifies the
 * recipient. Falls back to the instant transfer on pre-0065 databases.
 */
export async function requestCoinTransfer(input: {
  fromUserId: string;
  /** Recipient account id (e.g. from a scanned getpay:// QR). */
  toUserId?: string;
  /** Recipient phone number — resolved server-side. */
  toPhone?: string;
  coins: number;
  note?: string;
}): Promise<RequestTransferResult> {
  const { fromUserId } = input;
  const coins = Math.round(input.coins * 100) / 100;
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

  try {
    const { data, error } = await supabase.rpc("wallet_request_coin_transfer", {
      p_from: fromUserId,
      p_coins: coins,
      p_to: toUserId ?? null,
      p_to_phone: toPhone ?? null,
      p_note: input.note?.trim() || null,
    });
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      requestId: typeof row.request_id === "string" ? row.request_id : undefined,
      recipientName: typeof row.recipient_name === "string" ? row.recipient_name : null,
      coins,
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
    if (!isMissingSchemaError(e)) {
      console.log("[transfer-requests] request failed", e);
      return { ok: false, error: "Transfer request failed. Please try again." };
    }
    console.log("[transfer-requests] approval schema missing — sending instantly");
  }

  // Pre-0065 database: no approval flow — send instantly like before.
  const legacy = await transferCoins({ fromUserId, toUserId, toPhone, coins, note: input.note });
  if (!legacy.ok) return { ok: false, error: legacy.error };
  return {
    ok: true,
    immediate: true,
    coins: legacy.coins ?? coins,
    recipientName: legacy.recipientName ?? null,
    balances: legacy.balances,
  };
}

/**
 * Step 2 — the recipient accepts or declines a pending request. On accept the
 * coins move atomically server-side. The server reports the resulting status
 * ('accepted' | 'declined' | 'expired' | 'failed') in the response.
 */
export async function respondToTransferRequest(input: {
  requestId: string;
  userId: string;
  accept: boolean;
}): Promise<RespondTransferResult> {
  const { requestId, userId, accept } = input;
  if (!requestId || !userId) return { ok: false, error: "Missing request." };
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Responding needs a connection. Try again when you're online." };
  }

  try {
    const { data, error } = await supabase.rpc("wallet_respond_coin_transfer", {
      p_request: requestId,
      p_user: userId,
      p_accept: accept,
    });
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    const status = (typeof row.status === "string" ? row.status : undefined) as
      | TransferRequestStatus
      | undefined;
    const result: RespondTransferResult = {
      ok: status === "accepted" || status === "declined",
      status,
      coins: Number(row.coins ?? 0),
      fromName: typeof row.from_name === "string" ? row.from_name : null,
      toName: typeof row.to_name === "string" ? row.to_name : null,
    };
    if (status === "expired") result.error = "This transfer request has expired.";
    if (status === "failed") {
      result.error = "The sender no longer has enough GET.coin for this transfer.";
    }
    if (status === "accepted") {
      result.balances = await fetchWalletBalances(userId);
    }
    return result;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e ?? "");
    if (msg.includes("request_not_pending")) {
      return { ok: false, error: "This transfer request was already handled." };
    }
    if (msg.includes("request_not_found")) {
      return { ok: false, error: "Transfer request not found." };
    }
    if (msg.includes("not_recipient")) {
      return { ok: false, error: "This transfer request isn't addressed to you." };
    }
    console.log("[transfer-requests] respond failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Sender cancels their own pending request. */
export async function cancelTransferRequest(input: {
  requestId: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { requestId, userId } = input;
  if (!requestId || !userId) return { ok: false, error: "Missing request." };
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Cancelling needs a connection." };
  }
  try {
    const { error } = await supabase.rpc("wallet_cancel_transfer_request", {
      p_request: requestId,
      p_user: userId,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.log("[transfer-requests] cancel failed", e);
    return { ok: false, error: "Couldn't cancel the request." };
  }
}

/** Fetch a single transfer request (sender-side polling fallback). */
export async function fetchTransferRequest(
  requestId: string
): Promise<WalletTransferRequest | null> {
  if (!isSupabaseConfigured || !supabase || !requestId) return null;
  try {
    const { data, error } = await supabase
      .from("wallet_transfer_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as Record<string, unknown>) : null;
  } catch (e) {
    if (!isMissingSchemaError(e)) console.log("[transfer-requests] fetch failed", e);
    return null;
  }
}

/** Pending, unexpired requests addressed to this user, oldest first. */
export async function fetchPendingIncomingRequests(
  userId: string
): Promise<WalletTransferRequest[]> {
  if (!isSupabaseConfigured || !supabase || !userId) return [];
  try {
    const { data, error } = await supabase
      .from("wallet_transfer_requests")
      .select("*")
      .eq("to_user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
  } catch (e) {
    if (!isMissingSchemaError(e)) console.log("[transfer-requests] fetch incoming failed", e);
    return [];
  }
}

/**
 * Recipient-side realtime: fires `onRequest` for each new pending request
 * addressed to `userId`, and `onWithdrawn` when a request the recipient may
 * be looking at is cancelled/expired by the other side. Returns an
 * unsubscribe function; no-ops when Supabase isn't configured.
 */
export function subscribeIncomingTransferRequests(
  userId: string,
  onRequest: (req: WalletTransferRequest) => void,
  onWithdrawn?: (req: WalletTransferRequest) => void
): () => void {
  if (!isSupabaseConfigured || !supabase || !userId) return () => {};
  try {
    const channel = supabase
      .channel(`transfer-req-in-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transfer_requests",
          filter: `to_user_id=eq.${userId}`,
        },
        (payload) => {
          const req = mapRow((payload.new ?? {}) as Record<string, unknown>);
          if (req.status === "pending") onRequest(req);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallet_transfer_requests",
          filter: `to_user_id=eq.${userId}`,
        },
        (payload) => {
          const req = mapRow((payload.new ?? {}) as Record<string, unknown>);
          if (req.status !== "pending") onWithdrawn?.(req);
        }
      )
      .subscribe();
    return () => {
      try {
        supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[transfer-requests] incoming unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[transfer-requests] incoming subscribe failed", e);
    return () => {};
  }
}

/**
 * Sender-side realtime: fires `onUpdate` whenever the watched request row
 * changes (accepted/declined/expired/failed). Returns an unsubscribe function.
 */
export function subscribeTransferRequestUpdates(
  requestId: string,
  onUpdate: (req: WalletTransferRequest) => void
): () => void {
  if (!isSupabaseConfigured || !supabase || !requestId) return () => {};
  try {
    const channel = supabase
      .channel(`transfer-req-watch-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallet_transfer_requests",
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          onUpdate(mapRow((payload.new ?? {}) as Record<string, unknown>));
        }
      )
      .subscribe();
    return () => {
      try {
        supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[transfer-requests] watch unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[transfer-requests] watch subscribe failed", e);
    return () => {};
  }
}
