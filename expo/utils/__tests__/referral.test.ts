import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  fetchMyReferrer,
  fetchMyReferralCount,
  applyPendingReferral,
  consumePendingReferralBonus,
  subscribeReferralBonus,
} from "@/utils/referral";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
}));

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

describe("fetchMyReferrer", () => {
  let sb: SupabaseMock;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabaseModule.supabase = sb.client;
    supabaseModule.isSupabaseConfigured = true;
  });

  it("returns the inviter's name and code from the RPC", async () => {
    sb.queueRpcResult({ data: { name: "Aisha", code: "K3F9A2QX", created_at: "2026-01-01" }, error: null });
    const result = await fetchMyReferrer();
    expect(result).toEqual({ name: "Aisha", code: "K3F9A2QX" });
    expect(sb.rpcCalls[0].fn).toBe("get_my_referrer");
  });

  it("normalizes a blank/whitespace inviter name to null", async () => {
    sb.queueRpcResult({ data: { name: "   ", code: "ABCD1234", created_at: null }, error: null });
    const result = await fetchMyReferrer();
    expect(result).toEqual({ name: null, code: "ABCD1234" });
  });

  it("returns null when the user was not referred (null data)", async () => {
    sb.queueRpcResult({ data: null, error: null });
    expect(await fetchMyReferrer()).toBeNull();
  });

  it("returns null (no error) when the RPC is not deployed yet", async () => {
    sb.queueRpcResult({ data: null, error: { message: "Could not find the function public.get_my_referrer", code: "PGRST202" } });
    expect(await fetchMyReferrer()).toBeNull();
  });

  it("returns null when Supabase is not configured", async () => {
    supabaseModule.isSupabaseConfigured = false;
    expect(await fetchMyReferrer()).toBeNull();
    expect(sb.rpcCalls).toHaveLength(0);
  });
});

describe("fetchMyReferralCount", () => {
  let sb: SupabaseMock;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabaseModule.supabase = sb.client;
    supabaseModule.isSupabaseConfigured = true;
  });

  it("counts the caller's own referral rows", async () => {
    sb.queueResult({ data: null, count: 3, error: null } as any);
    const count = await fetchMyReferralCount("user-1");
    expect(count).toBe(3);
    const query = sb.queries[0];
    expect(query.table).toBe("referrals");
    // Scoped to this account as the referrer.
    const eq = query.steps.find((s) => s.method === "eq");
    expect(eq?.args).toEqual(["referrer_user_id", "user-1"]);
  });

  it("returns 0 when the account has no referrals", async () => {
    sb.queueResult({ data: null, count: 0, error: null } as any);
    expect(await fetchMyReferralCount("user-1")).toBe(0);
  });

  it("returns null without querying when there is no user id", async () => {
    expect(await fetchMyReferralCount(null)).toBeNull();
    expect(sb.queries).toHaveLength(0);
  });

  it("returns null when Supabase is not configured", async () => {
    supabaseModule.isSupabaseConfigured = false;
    expect(await fetchMyReferralCount("user-1")).toBeNull();
    expect(sb.queries).toHaveLength(0);
  });

  it("returns null (no throw) when the referrals table is not migrated yet", async () => {
    sb.queueResult({
      data: null,
      error: { message: 'relation "public.referrals" does not exist', code: "42P01" },
    } as any);
    expect(await fetchMyReferralCount("user-1")).toBeNull();
  });
});

describe("referral welcome-bonus toast", () => {
  let sb: SupabaseMock;

  beforeEach(async () => {
    sb = createSupabaseMock();
    supabaseModule.supabase = sb.client;
    supabaseModule.isSupabaseConfigured = true;
    await AsyncStorage.clear();
  });

  it("returns null when no bonus is pending", async () => {
    expect(await consumePendingReferralBonus()).toBeNull();
  });

  it("announces the referred user's bonus on a successful apply", async () => {
    await AsyncStorage.setItem("referral:pending_code", "K3F9A2QX");
    sb.queueRpcResult({
      data: { ok: true, referred_coins: 25, referrer_coins: 10 },
      error: null,
    });

    const received: number[] = [];
    const unsubscribe = subscribeReferralBonus((coins) => received.push(coins));

    const result = await applyPendingReferral();
    unsubscribe();

    expect(result?.ok).toBe(true);
    expect(result?.referredCoins).toBe(25);
    // Live listeners are notified with the credited amount...
    expect(received).toEqual([25]);
    // ...and the amount is persisted so a not-yet-mounted toast can still show it.
    expect(await consumePendingReferralBonus()).toBe(25);
    // Consuming clears the flag — it never fires twice.
    expect(await consumePendingReferralBonus()).toBeNull();
  });

  it("does not announce a bonus when the referred user earns 0 coins", async () => {
    await AsyncStorage.setItem("referral:pending_code", "K3F9A2QX");
    sb.queueRpcResult({
      data: { ok: true, referred_coins: 0, referrer_coins: 10 },
      error: null,
    });

    const received: number[] = [];
    const unsubscribe = subscribeReferralBonus((coins) => received.push(coins));
    await applyPendingReferral();
    unsubscribe();

    expect(received).toEqual([]);
    expect(await consumePendingReferralBonus()).toBeNull();
  });
});
