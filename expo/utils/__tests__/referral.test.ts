import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import { fetchMyReferrer } from "@/utils/referral";

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
