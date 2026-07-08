import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  topUpWallet,
  rechargeCredit,
  chargeRideCommission,
  fetchWalletBalances,
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
  it("reads both wallets from Supabase", async () => {
    sb.queueResult({
      data: [
        { wallet_type: "get_wallet", balance: "120.5", currency: "RM" },
        { wallet_type: "get_credit", balance: "-3.25", currency: "RM" },
      ],
    });
    const balances = await fetchWalletBalances(USER);
    expect(balances).toEqual({
      getWallet: 120.5,
      getCredit: -3.25,
      currency: "RM",
      source: "supabase",
    });
  });

  it("creates missing wallet rows and defaults their balances to 0", async () => {
    sb.queueResult({ data: [{ wallet_type: "get_wallet", balance: 10, currency: "RM" }] });
    sb.queueResult({ data: null, error: null }); // upsert of the missing get_credit row
    const balances = await fetchWalletBalances(USER);
    expect(balances.getCredit).toBe(0);
    const upsert = sb.queries[1];
    expect(upsert.table).toBe("wallets");
    expect(upsert.steps[0].method).toBe("upsert");
    expect(upsert.steps[0].args[0]).toEqual([
      { user_id: USER, wallet_type: "get_credit", balance: 0 },
    ]);
  });

  it("falls back to the device-local wallet when the tables are missing", async () => {
    await AsyncStorage.setItem(
      `wallet:balances:${USER}`,
      JSON.stringify({ getWallet: 42, getCredit: 7 })
    );
    sb.queueResult({ error: MISSING_SCHEMA });
    const balances = await fetchWalletBalances(USER);
    expect(balances).toEqual({ getWallet: 42, getCredit: 7, currency: "RM", source: "local" });
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
    sb.queueRpcResult({ error: { message: "permission denied" } });
    const result = await chargeRideCommission({
      partnerId: PARTNER,
      fareTotal: 40,
      rideRequestId: "ride-5",
      rate: 0.25,
    });
    expect(result).toMatchObject({ ok: false, error: "Commission charge failed." });
    expect(await AsyncStorage.getItem(`wallet:balances:${PARTNER}`)).toBeNull();
  });
});
