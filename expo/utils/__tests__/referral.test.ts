import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  fetchMyReferrer,
  fetchMyReferralCount,
  applyPendingReferral,
  consumePendingReferralBonuses,
  subscribeReferralBonus,
  syncReferralBonusCredits,
  type ReferralBonusEvent,
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

  it("returns nothing when no bonus is pending", async () => {
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });

  it("announces the referred user's bonus to a live listener", async () => {
    await AsyncStorage.setItem("referral:pending_code", "K3F9A2QX");
    sb.queueRpcResult({
      data: { ok: true, referred_coins: 25, referrer_coins: 10 },
      error: null,
    });

    const received: ReferralBonusEvent[] = [];
    const unsubscribe = subscribeReferralBonus((event) => received.push(event));

    const result = await applyPendingReferral();
    unsubscribe();

    expect(result?.ok).toBe(true);
    expect(result?.referredCoins).toBe(25);
    // The toast is told the exact amount credited, tagged as a welcome bonus.
    expect(received).toEqual([{ coins: 25, kind: "welcome" }]);
    // A delivered event isn't also queued — it shows once, not twice.
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });

  it("queues the bonus when no toast is mounted to receive it", async () => {
    await AsyncStorage.setItem("referral:pending_code", "K3F9A2QX");
    sb.queueRpcResult({
      data: { ok: true, referred_coins: 25, referrer_coins: 10 },
      error: null,
    });

    await applyPendingReferral();

    // Persisted so a toast mounting later (or after a relaunch) still shows it.
    expect(await consumePendingReferralBonuses()).toEqual([
      { coins: 25, kind: "welcome" },
    ]);
    // Consuming clears the queue — it never fires twice.
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });

  it("replays a legacy single-object queue entry as a welcome bonus", async () => {
    await AsyncStorage.setItem("referral:bonus_toast", JSON.stringify({ coins: 15 }));
    expect(await consumePendingReferralBonuses()).toEqual([
      { coins: 15, kind: "welcome" },
    ]);
  });

  it("does not announce a bonus when the referred user earns 0 coins", async () => {
    await AsyncStorage.setItem("referral:pending_code", "K3F9A2QX");
    sb.queueRpcResult({
      data: { ok: true, referred_coins: 0, referrer_coins: 10 },
      error: null,
    });

    const received: ReferralBonusEvent[] = [];
    const unsubscribe = subscribeReferralBonus((event) => received.push(event));
    await applyPendingReferral();
    unsubscribe();

    expect(received).toEqual([]);
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });
});

describe("syncReferralBonusCredits (inviter side)", () => {
  let sb: SupabaseMock;
  const USER = "user-1";
  const WATERMARK_KEY = `referral:bonus_watermark:${USER}`;

  beforeEach(async () => {
    sb = createSupabaseMock();
    supabaseModule.supabase = sb.client;
    supabaseModule.isSupabaseConfigured = true;
    await AsyncStorage.clear();
  });

  it("only records a watermark on the first run, announcing nothing", async () => {
    // Referral credits predating the feature are history — replaying them
    // would fire a burst of toasts on upgrade.
    expect(await syncReferralBonusCredits(USER)).toBe(0);
    expect(sb.queries).toHaveLength(0);
    expect(await AsyncStorage.getItem(WATERMARK_KEY)).toBeTruthy();
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });

  it("announces inviter credits earned since the watermark", async () => {
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    sb.queueResult({
      data: [
        {
          id: "tx-1",
          kind: "referral",
          amount: 10,
          note: "Referral bonus — a friend joined with your link",
          created_at: "2026-07-02T00:00:00Z",
        },
      ],
      error: null,
    } as any);

    expect(await syncReferralBonusCredits(USER)).toBe(1);

    const query = sb.queries[0];
    expect(query.table).toBe("wallet_transactions");
    // Scoped to this account's referral payouts only.
    expect(query.steps.filter((s) => s.method === "eq").map((s) => s.args)).toEqual([
      ["user_id", USER],
      ["kind", "referral"],
    ]);

    expect(await consumePendingReferralBonuses()).toEqual([
      { coins: 10, kind: "referrer" },
    ]);
    // The watermark advances past what was handled.
    expect(await AsyncStorage.getItem(WATERMARK_KEY)).toBe("2026-07-02T00:00:00Z");
  });

  it("skips the user's own welcome credit (applyPendingReferral announces it)", async () => {
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    sb.queueResult({
      data: [
        {
          id: "tx-w",
          kind: "referral",
          amount: 25,
          note: "Welcome bonus — joined with a referral link",
          created_at: "2026-07-02T00:00:00Z",
        },
      ],
      error: null,
    } as any);

    expect(await syncReferralBonusCredits(USER)).toBe(0);
    expect(await consumePendingReferralBonuses()).toEqual([]);
    // Still advanced, so the skipped row isn't rescanned every launch.
    expect(await AsyncStorage.getItem(WATERMARK_KEY)).toBe("2026-07-02T00:00:00Z");
  });

  it("never announces the same credit twice", async () => {
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    const row = {
      id: "tx-1",
      kind: "referral",
      amount: 10,
      note: "Referral bonus — a friend joined with your link",
      created_at: "2026-07-02T00:00:00Z",
    };
    sb.queueResult({ data: [row], error: null } as any);
    expect(await syncReferralBonusCredits(USER)).toBe(1);
    await consumePendingReferralBonuses();

    // A rewound watermark (or an overlapping realtime event) re-delivers the
    // row; the seen-id guard keeps it silent.
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    sb.queueResult({ data: [row], error: null } as any);
    expect(await syncReferralBonusCredits(USER)).toBe(0);
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });

  it("announces each of several credits earned while away", async () => {
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    sb.queueResult({
      data: [
        { id: "tx-1", kind: "referral", amount: 10, note: "Referral bonus — a friend joined with your link", created_at: "2026-07-02T00:00:00Z" },
        { id: "tx-2", kind: "referral", amount: 7.5, note: "Referral bonus — a friend joined with your link", created_at: "2026-07-03T00:00:00Z" },
      ],
      error: null,
    } as any);

    expect(await syncReferralBonusCredits(USER)).toBe(2);
    expect(await consumePendingReferralBonuses()).toEqual([
      { coins: 10, kind: "referrer" },
      { coins: 7.5, kind: "referrer" },
    ]);
    expect(await AsyncStorage.getItem(WATERMARK_KEY)).toBe("2026-07-03T00:00:00Z");
  });

  it("returns 0 without querying when there is no user id", async () => {
    expect(await syncReferralBonusCredits(null)).toBe(0);
    expect(sb.queries).toHaveLength(0);
  });

  it("degrades quietly when the wallet tables are not migrated yet", async () => {
    await AsyncStorage.setItem(WATERMARK_KEY, "2026-07-01T00:00:00Z");
    sb.queueResult({
      data: null,
      error: { message: 'relation "public.wallet_transactions" does not exist', code: "42P01" },
    } as any);
    expect(await syncReferralBonusCredits(USER)).toBe(0);
    expect(await consumePendingReferralBonuses()).toEqual([]);
  });
});
