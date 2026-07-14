import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  requestCoinTransfer,
  respondToTransferRequest,
  cancelTransferRequest,
  fetchPendingIncomingRequests,
  fetchTransferRequest,
  isRequestExpired,
} from "@/utils/transferRequestsStore";
import { transferCoins, fetchWalletBalances } from "@/utils/walletStore";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "test-uuid",
}));

jest.mock("@/utils/walletStore", () => ({
  transferCoins: jest.fn(),
  fetchWalletBalances: jest.fn(),
}));

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

const mockTransferCoins = transferCoins as jest.MockedFunction<typeof transferCoins>;
const mockFetchBalances = fetchWalletBalances as jest.MockedFunction<typeof fetchWalletBalances>;

const SENDER = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const MISSING_SCHEMA = {
  message:
    "Could not find the function public.wallet_request_coin_transfer in the schema cache",
  code: "PGRST202",
};

const BALANCES = {
  getWallet: 10,
  getCredit: 0,
  getCoin: 50,
  currency: "RM",
  source: "supabase" as const,
};

let sb: SupabaseMock;

beforeEach(() => {
  jest.clearAllMocks();
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
  mockFetchBalances.mockResolvedValue(BALANCES);
});

describe("requestCoinTransfer", () => {
  it("rejects bad input without calling the backend", async () => {
    expect(
      await requestCoinTransfer({ fromUserId: SENDER, toUserId: RECIPIENT, coins: 0 })
    ).toEqual({ ok: false, error: "Enter an amount greater than 0." });
    expect(await requestCoinTransfer({ fromUserId: SENDER, coins: 5 })).toEqual({
      ok: false,
      error: "Enter who to send to.",
    });
    expect(
      await requestCoinTransfer({ fromUserId: SENDER, toUserId: SENDER, coins: 5 })
    ).toEqual({ ok: false, error: "You can't send coins to yourself." });
    expect(sb.rpcCalls).toHaveLength(0);
  });

  it("creates a pending request via the wallet_request_coin_transfer RPC", async () => {
    sb.queueRpcResult({
      data: {
        request_id: REQUEST,
        recipient_id: RECIPIENT,
        recipient_name: "Aina",
        coins: 12.5,
        expires_at: "2026-01-01T00:15:00Z",
      },
    });
    const res = await requestCoinTransfer({
      fromUserId: SENDER,
      toPhone: "+60 12-345 6789",
      coins: 12.5,
      note: "lunch",
    });
    expect(res).toEqual({
      ok: true,
      requestId: REQUEST,
      recipientName: "Aina",
      coins: 12.5,
    });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_request_coin_transfer",
      params: {
        p_from: SENDER,
        p_coins: 12.5,
        p_to: null,
        p_to_phone: "+60 12-345 6789",
        p_note: "lunch",
      },
    });
    expect(mockTransferCoins).not.toHaveBeenCalled();
  });

  it("maps server errors to friendly messages", async () => {
    sb.queueRpcResult({ error: { message: "recipient_not_found" } });
    expect(
      (await requestCoinTransfer({ fromUserId: SENDER, toPhone: "0123456789", coins: 5 })).error
    ).toBe("Recipient not found. Check the number and try again.");

    sb.queueRpcResult({ error: { message: "insufficient_coins" } });
    expect(
      (await requestCoinTransfer({ fromUserId: SENDER, toUserId: RECIPIENT, coins: 5 })).error
    ).toBe("Not enough GET.coin to send.");
  });

  it("falls back to the instant transfer on pre-0065 databases", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    mockTransferCoins.mockResolvedValue({
      ok: true,
      coins: 5,
      recipientName: "Aina",
      balances: BALANCES,
    });
    const res = await requestCoinTransfer({
      fromUserId: SENDER,
      toUserId: RECIPIENT,
      coins: 5,
    });
    expect(res.ok).toBe(true);
    expect(res.immediate).toBe(true);
    expect(res.recipientName).toBe("Aina");
    expect(res.requestId).toBeUndefined();
    expect(mockTransferCoins).toHaveBeenCalledWith({
      fromUserId: SENDER,
      toUserId: RECIPIENT,
      toPhone: undefined,
      coins: 5,
      note: undefined,
    });
  });
});

describe("respondToTransferRequest", () => {
  it("accepts and refreshes the recipient's balances", async () => {
    sb.queueRpcResult({
      data: { status: "accepted", coins: 12.5, from_name: "Bala", to_name: "Aina" },
    });
    const res = await respondToTransferRequest({
      requestId: REQUEST,
      userId: RECIPIENT,
      accept: true,
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("accepted");
    expect(res.fromName).toBe("Bala");
    expect(res.balances).toEqual(BALANCES);
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_respond_coin_transfer",
      params: { p_request: REQUEST, p_user: RECIPIENT, p_accept: true },
    });
  });

  it("declines without touching balances", async () => {
    sb.queueRpcResult({
      data: { status: "declined", coins: 12.5, from_name: "Bala", to_name: "Aina" },
    });
    const res = await respondToTransferRequest({
      requestId: REQUEST,
      userId: RECIPIENT,
      accept: false,
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("declined");
    expect(mockFetchBalances).not.toHaveBeenCalled();
  });

  it("surfaces expired / failed outcomes as errors", async () => {
    sb.queueRpcResult({ data: { status: "expired", coins: 5 } });
    const expired = await respondToTransferRequest({
      requestId: REQUEST,
      userId: RECIPIENT,
      accept: true,
    });
    expect(expired.ok).toBe(false);
    expect(expired.status).toBe("expired");
    expect(expired.error).toBe("This transfer request has expired.");

    sb.queueRpcResult({ data: { status: "failed", coins: 5 } });
    const failed = await respondToTransferRequest({
      requestId: REQUEST,
      userId: RECIPIENT,
      accept: true,
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe(
      "The sender no longer has enough GET.coin for this transfer."
    );
  });

  it("maps hard RPC errors", async () => {
    sb.queueRpcResult({ error: { message: "request_not_pending" } });
    expect(
      (await respondToTransferRequest({ requestId: REQUEST, userId: RECIPIENT, accept: true }))
        .error
    ).toBe("This transfer request was already handled.");
  });
});

describe("cancelTransferRequest", () => {
  it("cancels via the wallet_cancel_transfer_request RPC", async () => {
    sb.queueRpcResult({ data: true });
    const res = await cancelTransferRequest({ requestId: REQUEST, userId: SENDER });
    expect(res.ok).toBe(true);
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_cancel_transfer_request",
      params: { p_request: REQUEST, p_user: SENDER },
    });
  });
});

describe("fetching", () => {
  const ROW = {
    id: REQUEST,
    from_user_id: SENDER,
    from_name: "Bala",
    to_user_id: RECIPIENT,
    to_name: "Aina",
    coins: "12.50",
    note: null,
    status: "pending",
    created_at: "2026-01-01T00:00:00Z",
    responded_at: null,
    expires_at: "2026-01-01T00:15:00Z",
  };

  it("fetchTransferRequest maps the row to camelCase", async () => {
    sb.queueResult({ data: ROW });
    const req = await fetchTransferRequest(REQUEST);
    expect(req).toEqual({
      id: REQUEST,
      fromUserId: SENDER,
      fromName: "Bala",
      toUserId: RECIPIENT,
      toName: "Aina",
      coins: 12.5,
      note: null,
      status: "pending",
      createdAt: "2026-01-01T00:00:00Z",
      respondedAt: null,
      expiresAt: "2026-01-01T00:15:00Z",
    });
  });

  it("fetchPendingIncomingRequests filters to pending, unexpired, addressed rows", async () => {
    sb.queueResult({ data: [ROW] });
    const reqs = await fetchPendingIncomingRequests(RECIPIENT);
    expect(reqs).toHaveLength(1);
    const query = sb.queries[0];
    expect(query.table).toBe("wallet_transfer_requests");
    const eqs = query.steps.filter((s) => s.method === "eq").map((s) => s.args);
    expect(eqs).toEqual([
      ["to_user_id", RECIPIENT],
      ["status", "pending"],
    ]);
    expect(findStep(query, "gt")?.args[0]).toBe("expires_at");
  });

  it("returns empty results when the table is missing", async () => {
    sb.queueResult({ error: { message: 'relation "wallet_transfer_requests" does not exist', code: "42P01" } });
    expect(await fetchPendingIncomingRequests(RECIPIENT)).toEqual([]);
  });
});

describe("isRequestExpired", () => {
  it("compares against the expiry timestamp", () => {
    const req = { expiresAt: "2026-01-01T00:15:00Z" };
    expect(isRequestExpired(req, Date.parse("2026-01-01T00:14:59Z"))).toBe(false);
    expect(isRequestExpired(req, Date.parse("2026-01-01T00:15:01Z"))).toBe(true);
  });
});
