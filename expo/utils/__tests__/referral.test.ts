import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  referralCodeForUser,
  buildReferralMessage,
  fetchMyReferral,
} from "@/utils/referral";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "test-uuid",
}));

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

let sb: SupabaseMock;

beforeEach(() => {
  jest.clearAllMocks();
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
});

describe("referralCodeForUser", () => {
  it("derives a stable 8-char uppercase code from the user id", () => {
    expect(referralCodeForUser("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("A1B2C3D4");
  });

  it("falls back to GETRIDE when the id has no alphanumerics", () => {
    expect(referralCodeForUser("----")).toBe("GETRIDE");
  });
});

describe("buildReferralMessage", () => {
  it("includes the code and the link", () => {
    const msg = buildReferralMessage("K3F9A2QX", "https://get.ride/?ref=K3F9A2QX");
    expect(msg).toContain("K3F9A2QX");
    expect(msg).toContain("https://get.ride/?ref=K3F9A2QX");
  });
});

describe("fetchMyReferral", () => {
  it("returns the inviter name and welcome bonus when the user was referred", async () => {
    sb.queueRpcResult({
      data: {
        referred: true,
        referrer_name: "Aisha",
        referred_coins: 25,
        code: "K3F9A2QX",
      },
      error: null,
    });

    const result = await fetchMyReferral();
    expect(result).toEqual({ referrerName: "Aisha", referredCoins: 25, code: "K3F9A2QX" });
    expect(sb.rpcCalls[0].fn).toBe("get_my_referral");
  });

  it("returns null when the user was never referred", async () => {
    sb.queueRpcResult({ data: { referred: false }, error: null });
    expect(await fetchMyReferral()).toBeNull();
  });

  it("normalizes a missing name and clamps a negative bonus", async () => {
    sb.queueRpcResult({
      data: { referred: true, referrer_name: null, referred_coins: -5 },
      error: null,
    });
    expect(await fetchMyReferral()).toEqual({
      referrerName: "",
      referredCoins: 0,
      code: undefined,
    });
  });

  it("returns null (hides the card) when the RPC is not migrated yet", async () => {
    sb.queueRpcResult({
      data: null,
      error: {
        message: "Could not find the function public.get_my_referral in the schema cache",
        code: "PGRST202",
      },
    });
    expect(await fetchMyReferral()).toBeNull();
  });

  it("returns null when Supabase is unavailable", async () => {
    supabaseModule.isSupabaseConfigured = false;
    supabaseModule.supabase = null;
    expect(await fetchMyReferral()).toBeNull();
  });
});
