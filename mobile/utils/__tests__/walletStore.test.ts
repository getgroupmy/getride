import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  topUpWallet,
  rechargeCredit,
  chargeRideCommission,
  fetchWalletBalances,
  transferCoins,
  payFromWallet,
  tradeCoins,
  redeemCoinsForFare,
} from "@/utils/walletStore";
import { resolveCommissionRateForRide } from "@/utils/commissionStore";

jest.mock("@/utils/supabase", () => {
  let n = 0;
  return {
    isSupabaseConfigured: true,
    supabase: null,
    uuidv4: () => `test-uuid-${++n}`,
  };
});

jest.mock("@/utils/commissionStore", () => ({
  DEFAULT_COMMISSION_RATE: 0.15,
  resolveCommissionRateForRide: jest.fn(),
}));

jest.mock("@/utils/getCoinStore", () => ({
  fetchGetCoinSettings: jest.fn(async () => ({
    coinsPerCurrency: 2,
    earnCoinsPerCurrency: 1,
    currency: "RM",
    active: true,
    marketEnabled: false,
    maxSwingPct: 50,
    maxSupply: 0,
    source: "local",
  })),
  rideRewardCoins: (fare: number, rate: number) => Math.round(fare * rate * 100) / 100,
}));

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

const mockResolveRate = resolveCommissionRateForRide as jest.MockedFunction<
  typeof resolveCommissionRateForRide
>;

const USER = "user-1";
const MISSING_SCHEMA = {
  message: "Could not find the function public.wallet_topup in the schema cache",
  code: "PGRST202",
};

let sb: SupabaseMock;

beforeEach(async () => {
  await AsyncStorage.clear();
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
  mockResolveRate.mockResolvedValue({
    rate: 0.15,
    level: "master",
    label: "Master rate (admin)",
  });
});

describe("fetchWalletBalances", () => {
  it("reads all three wallets from Supabase", async () => {
    sb.queueResult({
      data: [
        { wallet_type: "get_wallet", balance: "120.5", currency: "RM" },
        { wallet_type: "get_credit", balance: "-3.25", currency: "RM" },
        { wallet_type: "get_coin", balance: "18", currency: "RM" },
      ],
    });
    const balances = await fetchWalletBalances(USER);
    expect(balances).toEqual({
      getWallet: 120.5,
      getCredit: -3.25,
      getCoin: 18,
      currency: "RM",
      source: "supabase",
    });
  });

  it("creates missing wallet rows and defaults their balances to 0", async () => {
    sb.queueResult({ data: [{ wallet_type: "get_wallet", balance: 10, currency: "RM" }] });
    sb.queueResult({ data: null, error: null }); // upsert of the missing rows
    const balances = await fetchWalletBalances(USER);
    expect(balances.getCredit).toBe(0);
    expect(balances.getCoin).toBe(0);
    const upsert = sb.queries[1];
    expect(upsert.table).toBe("wallets");
    expect(upsert.steps[0].method).toBe("upsert");
    expect(upsert.steps[0].args[0]).toEqual([
      { user_id: USER, wallet_type: "get_credit", balance: 0 },
      { user_id: USER, wallet_type: "get_coin", balance: 0 },
    ]);
  });

  it("falls back to the device-local wallet when the tables are missing", async () => {
    await AsyncStorage.setItem(
      `wallet:balances:${USER}`,
      JSON.stringify({ getWallet: 42, getCredit: 7 })
    );
    sb.queueResult({ error: MISSING_SCHEMA });
    const balances = await fetchWalletBalances(USER);
    expect(balances).toEqual({
      getWallet: 42,
      getCredit: 7,
      getCoin: 0,
      currency: "RM",
      source: "local",
    });
  });
});

describe("topUpWallet", () => {
  it("rejects non-positive amounts without calling the backend", async () => {
    expect(await topUpWallet(USER, 0, "card")).toEqual({
      ok: false,
      error: "Enter an amount greater than 0.",
    });
    expect(await topUpWallet(USER, -5, "card")).toMatchObject({ ok: false });
    expect(sb.rpcCalls).toHaveLength(0);
  });

  it("tops up via the atomic wallet_topup RPC", async () => {
    sb.queueResult({ data: [{ wallet_type: "get_wallet", balance: 50, currency: "RM" }] });
    sb.queueResult({ data: null }); // ensure-rows upsert for get_credit
    const result = await topUpWallet(USER, 50, "card");
    expect(result.ok).toBe(true);
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_topup",
      params: { p_user: USER, p_amount: 50, p_method: "card" },
    });
    expect(result.balances?.getWallet).toBe(50);
  });

  it("surfaces a friendly error when the RPC fails for a non-schema reason", async () => {
    sb.queueRpcResult({ error: { message: "boom" } });
    const result = await topUpWallet(USER, 50, "card");
    expect(result).toEqual({ ok: false, error: "Top up failed. Please try again." });
  });

  it("falls back to the local wallet when the schema is missing", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    const result = await topUpWallet(USER, 30, "card");
    expect(result.ok).toBe(true);
    expect(result.balances).toMatchObject({ getWallet: 30, source: "local" });

    const txRaw = await AsyncStorage.getItem(`wallet:transactions:${USER}`);
    const txs = JSON.parse(txRaw ?? "[]");
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      walletType: "get_wallet",
      kind: "topup",
      amount: 30,
      balanceAfter: 30,
      method: "card",
    });
  });
});

describe("rechargeCredit", () => {
  it("rejects non-positive amounts", async () => {
    expect(await rechargeCredit(USER, 0)).toMatchObject({ ok: false });
  });

  it("maps the insufficient_balance RPC error to a friendly message", async () => {
    sb.queueRpcResult({ error: { message: "P0001: insufficient_balance" } });
    expect(await rechargeCredit(USER, 100)).toEqual({
      ok: false,
      error: "Not enough balance in GET.wallet.",
    });
  });

  it("moves funds from GET.wallet to GET.credit in the local fallback", async () => {
    supabaseModule.isSupabaseConfigured = false;
    await AsyncStorage.setItem(
      `wallet:balances:${USER}`,
      JSON.stringify({ getWallet: 50, getCredit: 0 })
    );
    const result = await rechargeCredit(USER, 30);
    expect(result.ok).toBe(true);
    expect(result.balances).toMatchObject({ getWallet: 20, getCredit: 30, source: "local" });

    const txs = JSON.parse((await AsyncStorage.getItem(`wallet:transactions:${USER}`)) ?? "[]");
    expect(txs.map((t: { kind: string; amount: number }) => [t.kind, t.amount])).toEqual([
      ["recharge_in", 30],
      ["recharge_out", -30],
    ]);
  });

  it("refuses to overdraw GET.wallet locally (must stay non-negative)", async () => {
    supabaseModule.isSupabaseConfigured = false;
    await AsyncStorage.setItem(
      `wallet:balances:${USER}`,
      JSON.stringify({ getWallet: 20, getCredit: 0 })
    );
    expect(await rechargeCredit(USER, 100)).toEqual({
      ok: false,
      error: "Not enough balance in GET.wallet.",
    });
    // Balances untouched.
    const raw = JSON.parse((await AsyncStorage.getItem(`wallet:balances:${USER}`)) ?? "{}");
    expect(raw).toEqual({ getWallet: 20, getCredit: 0 });
  });
});

describe("transferCoins", () => {
  const RECIPIENT = "0d9c1f2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
  const ALL_WALLETS = (coin: number) => ({
    data: [
      { wallet_type: "get_wallet", balance: 100, currency: "RM" },
      { wallet_type: "get_credit", balance: 0, currency: "RM" },
      { wallet_type: "get_coin", balance: coin, currency: "RM" },
    ],
  });

  it("validates its inputs without calling the backend", async () => {
    expect(await transferCoins({ fromUserId: USER, toUserId: RECIPIENT, coins: 0 })).toEqual({
      ok: false,
      error: "Enter an amount greater than 0.",
    });
    expect(await transferCoins({ fromUserId: USER, coins: 10 })).toEqual({
      ok: false,
      error: "Enter who to send to.",
    });
    expect(await transferCoins({ fromUserId: USER, toUserId: USER, coins: 10 })).toEqual({
      ok: false,
      error: "You can't send coins to yourself.",
    });
    expect(sb.rpcCalls).toHaveLength(0);
  });

  it("sends through the atomic wallet_transfer_coins RPC", async () => {
    sb.queueRpcResult({
      data: { coins: 25, recipient_id: RECIPIENT, recipient_name: "Aisha", balance_after: 75 },
    });
    sb.queueResult(ALL_WALLETS(75));
    const result = await transferCoins({ fromUserId: USER, toUserId: RECIPIENT, coins: 25 });
    expect(result).toMatchObject({ ok: true, coins: 25, recipientName: "Aisha" });
    expect(result.balances?.getCoin).toBe(75);
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_transfer_coins",
      params: { p_from: USER, p_coins: 25, p_to: RECIPIENT, p_to_phone: null, p_note: null },
    });
  });

  it("resolves phone recipients server-side via the RPC", async () => {
    sb.queueRpcResult({
      data: { coins: 5, recipient_id: RECIPIENT, recipient_name: null, balance_after: 45 },
    });
    sb.queueResult(ALL_WALLETS(45));
    const result = await transferCoins({ fromUserId: USER, toPhone: "+60 12-345 6789", coins: 5 });
    expect(result).toMatchObject({ ok: true, coins: 5, recipientName: null });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_transfer_coins",
      params: { p_from: USER, p_coins: 5, p_to: null, p_to_phone: "+60 12-345 6789", p_note: null },
    });
  });

  it("maps the RPC's business errors to friendly messages", async () => {
    sb.queueRpcResult({ error: { message: "P0001: insufficient_coins" } });
    expect(await transferCoins({ fromUserId: USER, toUserId: RECIPIENT, coins: 999 })).toEqual({
      ok: false,
      error: "Not enough GET.coin to send.",
    });
    sb.queueRpcResult({ error: { message: "P0001: recipient_not_found" } });
    expect(await transferCoins({ fromUserId: USER, toPhone: "0123456789", coins: 5 })).toEqual({
      ok: false,
      error: "Recipient not found. Check the number and try again.",
    });
    sb.queueRpcResult({ error: { message: "P0001: self_transfer" } });
    expect(await transferCoins({ fromUserId: USER, toPhone: "0123456789", coins: 5 })).toEqual({
      ok: false,
      error: "You can't send coins to yourself.",
    });
  });

  it("falls back to direct ledger inserts for id recipients on pre-0064 databases", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    sb.queueResult(ALL_WALLETS(50)); // balance check
    sb.queueResult({ data: null }); // ledger insert
    sb.queueResult(ALL_WALLETS(30)); // refreshed balances
    const result = await transferCoins({
      fromUserId: USER,
      toUserId: RECIPIENT,
      coins: 20,
      note: "lunch",
    });
    expect(result).toMatchObject({ ok: true, coins: 20 });
    expect(result.balances?.getCoin).toBe(30);

    const insert = sb.queries[1];
    expect(insert.table).toBe("wallet_transactions");
    expect(insert.steps[0].method).toBe("insert");
    const rows = insert.steps[0].args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      wallet_type: "get_coin",
      kind: "transfer_out",
      amount: -20,
      method: "p2p_transfer",
    });
    expect(rows[1]).toMatchObject({
      user_id: RECIPIENT,
      wallet_type: "get_coin",
      kind: "transfer_in",
      amount: 20,
      method: "p2p_transfer",
    });
  });

  it("refuses to overdraw GET.coin in the fallback path", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    sb.queueResult(ALL_WALLETS(10));
    expect(await transferCoins({ fromUserId: USER, toUserId: RECIPIENT, coins: 20 })).toEqual({
      ok: false,
      error: "Not enough GET.coin to send.",
    });
    // Only the balance read ran — nothing was inserted.
    expect(sb.queries).toHaveLength(1);
  });

  it("cannot fall back for phone recipients (profiles are RLS-protected)", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    const result = await transferCoins({ fromUserId: USER, toPhone: "0123456789", coins: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("QR code");
    expect(sb.queries).toHaveLength(0);
  });

  it("fails cleanly when Supabase isn't configured — no device-local transfer", async () => {
    supabaseModule.isSupabaseConfigured = false;
    const result = await transferCoins({ fromUserId: USER, toUserId: RECIPIENT, coins: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("connection");
    expect(await AsyncStorage.getItem(`wallet:balances:${USER}`)).toBeNull();
  });
});

describe("chargeRideCommission", () => {
  const PARTNER = "partner-1";

  it("validates its inputs", async () => {
    expect(
      await chargeRideCommission({ partnerId: "", fareTotal: 100, rideRequestId: "r1" })
    ).toEqual({ ok: false, error: "Missing partner id." });
    expect(
      await chargeRideCommission({ partnerId: PARTNER, fareTotal: 0, rideRequestId: "r1" })
    ).toEqual({ ok: false, error: "Invalid fare." });
    expect(
      await chargeRideCommission({ partnerId: PARTNER, fareTotal: 100 })
    ).toEqual({ ok: false, error: "Missing ride reference." });
  });

  it("charges through the idempotent RPC and records the guard", async () => {
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 100,
      rideRequestId: "ride-1",
      rate: 0.2,
    });
    expect(result).toMatchObject({ ok: true, amount: 20, rate: 0.2 });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_charge_ride_commission",
      params: { p_ride: "ride-1", p_partner: PARTNER, p_fare: 100, p_rate: 0.2 },
    });
    expect(mockResolveRate).not.toHaveBeenCalled(); // explicit rate wins

    // Second call for the same ride short-circuits on the client-side guard.
    const again = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 100,
      rideRequestId: "ride-1",
      rate: 0.2,
    });
    expect(again).toMatchObject({ ok: true, alreadyCharged: true });
    expect(sb.rpcCalls).toHaveLength(1);
  });

  it("resolves the rate from the commission settings when none is passed", async () => {
    mockResolveRate.mockResolvedValue({ rate: 0.1, level: "city", label: "City: Kuala Lumpur" });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 80,
      rideRequestId: "ride-2",
    });
    expect(mockResolveRate).toHaveBeenCalledWith({ partnerId: PARTNER, rideRequestId: "ride-2" });
    expect(result).toMatchObject({
      ok: true,
      amount: 8,
      rate: 0.1,
      rateLabel: "City: Kuala Lumpur",
    });
  });

  it("charges nothing when the resolved rate is zero", async () => {
    mockResolveRate.mockResolvedValue({ rate: 0, level: "master", label: "Master rate (admin)" });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 100,
      rideRequestId: "ride-3",
    });
    expect(result).toMatchObject({ ok: true, amount: 0 });
    expect(sb.rpcCalls).toHaveLength(0);
  });

  it("lets GET.credit go negative in the local fallback (commission owed)", async () => {
    supabaseModule.isSupabaseConfigured = false;
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 100,
      bookingNo: "BK-77",
      rate: 0.15,
    });
    expect(result).toMatchObject({ ok: true, amount: 15 });

    const balances = JSON.parse(
      (await AsyncStorage.getItem(`wallet:balances:${PARTNER}`)) ?? "{}"
    );
    expect(balances.getCredit).toBe(-15);

    const txs = JSON.parse(
      (await AsyncStorage.getItem(`wallet:transactions:${PARTNER}`)) ?? "[]"
    );
    expect(txs[0]).toMatchObject({ walletType: "get_credit", kind: "commission", amount: -15 });
    expect(txs[0].note).toContain("#BK-77");
  });

  it("falls back to the local wallet when the RPC is missing from the schema", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 40,
      rideRequestId: "ride-4",
      rate: 0.25,
    });
    expect(result).toMatchObject({ ok: true, amount: 10 });
    const balances = JSON.parse(
      (await AsyncStorage.getItem(`wallet:balances:${PARTNER}`)) ?? "{}"
    );
    expect(balances.getCredit).toBe(-10);
  });

  it("reports failure without a local charge when the RPC fails for another reason", async () => {
    sb.queueRpcResult({ error: { message: "boom" } });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 40,
      rideRequestId: "ride-5",
      rate: 0.25,
    });
    expect(result).toMatchObject({ ok: false, error: "Commission charge failed." });
    expect(await AsyncStorage.getItem(`wallet:balances:${PARTNER}`)).toBeNull();
  });

  it("asks the user to sign in when the database rejects the caller (0066 lockdown)", async () => {
    sb.queueRpcResult({ error: { message: "P0001: not_authorized" } });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 40,
      rideRequestId: "ride-6",
      rate: 0.25,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("sign in");
    // No local charge — the account genuinely couldn't be verified.
    expect(await AsyncStorage.getItem(`wallet:balances:${PARTNER}`)).toBeNull();
  });
});

describe("payFromWallet", () => {
  const ALL_WALLETS = (wallet: number, coin: number) => ({
    data: [
      { wallet_type: "get_wallet", balance: wallet, currency: "RM" },
      { wallet_type: "get_credit", balance: 0, currency: "RM" },
      { wallet_type: "get_coin", balance: coin, currency: "RM" },
    ],
  });

  it("pays through the owner-scoped wallet_pay RPC", async () => {
    sb.queueRpcResult({ data: { coins_used: 0, coin_value: 0, wallet_paid: 30 } });
    sb.queueResult(ALL_WALLETS(70, 0)); // refreshed balances
    const result = await payFromWallet(USER, 30, "Coffee");
    expect(result).toMatchObject({ ok: true, coinsUsed: 0, coinValue: 0, walletPaid: 30 });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_pay",
      params: {
        p_user: USER,
        p_amount: 30,
        p_note: "Coffee",
        p_method: "qr_scan",
        p_redeem_coins: false,
      },
    });
  });

  it("passes the coin redemption flag through to the RPC", async () => {
    sb.queueRpcResult({ data: { coins_used: 20, coin_value: 10, wallet_paid: 20 } });
    sb.queueResult(ALL_WALLETS(50, 0));
    const result = await payFromWallet(USER, 30, "Groceries", {
      redeemCoins: true,
      coinsPerCurrency: 2,
    });
    expect(result).toMatchObject({ ok: true, coinsUsed: 20, coinValue: 10, walletPaid: 20 });
    expect(sb.rpcCalls[0].params).toMatchObject({ p_redeem_coins: true });
  });

  it("maps insufficient_balance to a friendly message", async () => {
    sb.queueRpcResult({ error: { message: "P0001: insufficient_balance" } });
    expect(await payFromWallet(USER, 500, "TV")).toEqual({
      ok: false,
      error: "Not enough balance in GET.wallet.",
    });
  });

  it("asks the user to sign in when the database rejects the caller", async () => {
    sb.queueRpcResult({ error: { message: "P0001: not_authorized" } });
    const result = await payFromWallet(USER, 30, "Coffee");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("sign in");
  });

  it("falls back to direct ledger inserts on pre-0066 databases", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    sb.queueResult(ALL_WALLETS(100, 0)); // balance check
    sb.queueResult({ data: null }); // ledger insert
    sb.queueResult(ALL_WALLETS(70, 0)); // refreshed balances
    const result = await payFromWallet(USER, 30, "Coffee");
    expect(result).toMatchObject({ ok: true, walletPaid: 30 });

    const insert = sb.queries[1];
    expect(insert.table).toBe("wallet_transactions");
    expect(insert.steps[0].method).toBe("insert");
    const rows = insert.steps[0].args[0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      user_id: USER,
      wallet_type: "get_wallet",
      kind: "payment",
      amount: -30,
    });
  });
});

describe("tradeCoins", () => {
  const ALL_WALLETS = (wallet: number, coin: number) => ({
    data: [
      { wallet_type: "get_wallet", balance: wallet, currency: "RM" },
      { wallet_type: "get_credit", balance: 0, currency: "RM" },
      { wallet_type: "get_coin", balance: coin, currency: "RM" },
    ],
  });

  it("buys through the owner-scoped wallet_trade_coins RPC", async () => {
    sb.queueRpcResult({ data: { coins: 10, amount_currency: 5, rate_per_gc: 0.5 } });
    sb.queueResult(ALL_WALLETS(95, 10));
    const result = await tradeCoins({ userId: USER, direction: "buy", coins: 10, ratePerGC: 0.5 });
    expect(result).toMatchObject({ ok: true, coins: 10, amountCurrency: 5, ratePerGC: 0.5 });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_trade_coins",
      params: { p_user: USER, p_direction: "buy", p_coins: 10, p_rate_per_gc: 0.5 },
    });
  });

  it("maps the RPC's business errors to friendly messages", async () => {
    sb.queueRpcResult({ error: { message: "P0001: insufficient_balance" } });
    expect(await tradeCoins({ userId: USER, direction: "buy", coins: 99, ratePerGC: 1 })).toEqual({
      ok: false,
      error: "Not enough balance in GET.wallet.",
    });
    sb.queueRpcResult({ error: { message: "P0001: insufficient_coins" } });
    expect(await tradeCoins({ userId: USER, direction: "sell", coins: 99, ratePerGC: 1 })).toEqual({
      ok: false,
      error: "Not enough GET.coin to sell.",
    });
    sb.queueRpcResult({ error: { message: "P0001: supply_cap_reached" } });
    expect(await tradeCoins({ userId: USER, direction: "buy", coins: 5, ratePerGC: 1 })).toEqual({
      ok: false,
      error: "Supply cap reached — no more GC can be minted.",
    });
  });

  it("falls back to direct ledger inserts on pre-0066 databases", async () => {
    sb.queueRpcResult({ error: MISSING_SCHEMA });
    sb.queueResult(ALL_WALLETS(100, 0)); // balance check
    sb.queueResult({ data: null }); // ledger insert
    sb.queueResult(ALL_WALLETS(90, 10)); // refreshed balances
    const result = await tradeCoins({ userId: USER, direction: "buy", coins: 10, ratePerGC: 1 });
    expect(result).toMatchObject({ ok: true, coins: 10, amountCurrency: 10 });

    const insert = sb.queries[1];
    expect(insert.table).toBe("wallet_transactions");
    const rows = insert.steps[0].args[0] as Record<string, unknown>[];
    expect(rows.map((r) => [r.wallet_type, r.amount])).toEqual([
      ["get_wallet", -10],
      ["get_coin", 10],
    ]);
  });
});

describe("redeemCoinsForFare", () => {
  const RIDE_UUID = "5f7a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

  it("redeems through the RPC, passing real ride ids for server-side idempotency", async () => {
    sb.queueRpcResult({ data: { coins_used: 20, coin_value: 10 } });
    const result = await redeemCoinsForFare({ userId: USER, fareTotal: 25, rideKey: RIDE_UUID });
    expect(result).toEqual({ ok: true, coinsUsed: 20, coinValue: 10 });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "wallet_redeem_fare_coins",
      params: { p_user: USER, p_fare: 25, p_ride: RIDE_UUID },
    });
  });

  it("passes p_ride = null for simulated (non-UUID) ride keys", async () => {
    sb.queueRpcResult({ data: { coins_used: 0, coin_value: 0 } });
    const result = await redeemCoinsForFare({ userId: USER, fareTotal: 25, rideKey: "sim-ride-1" });
    expect(result.ok).toBe(true);
    expect(sb.rpcCalls[0].params).toMatchObject({ p_ride: null });
  });

  it("short-circuits on the device-local guard for repeat calls", async () => {
    sb.queueRpcResult({ data: { coins_used: 20, coin_value: 10 } });
    await redeemCoinsForFare({ userId: USER, fareTotal: 25, rideKey: RIDE_UUID });
    const again = await redeemCoinsForFare({ userId: USER, fareTotal: 25, rideKey: RIDE_UUID });
    expect(again).toEqual({ ok: true, coinsUsed: 0, coinValue: 0 });
    expect(sb.rpcCalls).toHaveLength(1);
  });
});
