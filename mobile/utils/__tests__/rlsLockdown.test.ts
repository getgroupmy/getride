/**
 * Client-side behavior around the 0069 RLS lockdown:
 *  - permission-denied detection for ride-request writes,
 *  - push-token registration via the owner-scoped RPCs with legacy fallback,
 *  - the support-agent roster via the support_agents RPC with legacy fallback.
 */
import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "test-uuid",
}));

let sb: SupabaseMock;

/**
 * The stores cache "RPC missing in this DB" in module state, so each test
 * loads fresh module instances against a fresh Supabase mock.
 */
function loadModules() {
  jest.resetModules();
  const supabaseModule = jest.requireMock("@/utils/supabase") as {
    isSupabaseConfigured: boolean;
    supabase: unknown;
  };
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const adminSync = require("@/utils/adminSync") as typeof import("@/utils/adminSync");
  const supportStore = require("@/utils/supportStore") as typeof import("@/utils/supportStore");
  const rideRequests =
    require("@/utils/rideRequestsStore") as typeof import("@/utils/rideRequestsStore");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { adminSync, supportStore, rideRequests };
}

const missingFunction = (fn: string) => ({
  message: `Could not find the function public.${fn} in the schema cache`,
  code: "PGRST202",
});

describe("isPermissionDeniedError", () => {
  it("recognises RLS/permission failures", () => {
    const { rideRequests } = loadModules();
    expect(
      rideRequests.isPermissionDeniedError({
        message: 'new row violates row-level security policy for table "ride_requests"',
        code: "42501",
      })
    ).toBe(true);
    expect(
      rideRequests.isPermissionDeniedError({ message: "permission denied for table ride_requests" })
    ).toBe(true);
    expect(rideRequests.isPermissionDeniedError({ message: "rider_immutable" })).toBe(true);
    expect(rideRequests.isPermissionDeniedError({ message: "not_authorized" })).toBe(true);
  });

  it("ignores unrelated errors", () => {
    const { rideRequests } = loadModules();
    expect(
      rideRequests.isPermissionDeniedError(
        new Error("Could not find the 'cancel_reason' column of 'ride_requests'")
      )
    ).toBe(false);
    expect(rideRequests.isPermissionDeniedError({ message: "network request failed" })).toBe(false);
    expect(rideRequests.isPermissionDeniedError(null)).toBe(false);
  });
});

describe("savePushToken", () => {
  it("registers through the owner-scoped RPC", async () => {
    const { adminSync } = loadModules();
    sb.queueRpcResult({ data: null, error: null });
    await adminSync.savePushToken("ExpoTok[abc]", "profile-1", "ios", "iPhone");
    expect(sb.rpcCalls).toEqual([
      {
        fn: "push_register_token",
        params: { p_token: "ExpoTok[abc]", p_platform: "ios", p_device_name: "iPhone" },
      },
    ]);
    expect(sb.queries).toHaveLength(0);
  });

  it("falls back to the legacy upsert when the RPC is missing (pre-0069 DB)", async () => {
    const { adminSync } = loadModules();
    sb.queueRpcResult({ error: missingFunction("push_register_token") });
    sb.queueResult({ data: null, error: null });
    await adminSync.savePushToken("tok", "profile-1", "android", null);

    expect(sb.queries).toHaveLength(1);
    expect(sb.queries[0].table).toBe("push_tokens");
    const upsert = findStep(sb.queries[0], "upsert");
    expect(upsert).toBeDefined();
    expect((upsert!.args[0] as { token: string }).token).toBe("tok");

    // The missing RPC is remembered — later calls go straight to the upsert.
    sb.queueResult({ data: null, error: null });
    await adminSync.savePushToken("tok2", "profile-1", "android", null);
    expect(sb.rpcCalls).toHaveLength(1);
    expect(sb.queries).toHaveLength(2);
  });

  it("does not fall back when the RPC fails for another reason", async () => {
    const { adminSync } = loadModules();
    sb.queueRpcResult({ error: { message: "not_authorized" } });
    await adminSync.savePushToken("tok", null, "ios");
    expect(sb.queries).toHaveLength(0);
  });
});

describe("removePushToken", () => {
  it("unregisters through the RPC, falling back to the legacy delete", async () => {
    const { adminSync } = loadModules();
    sb.queueRpcResult({ data: null, error: null });
    await adminSync.removePushToken("tok");
    expect(sb.rpcCalls).toEqual([{ fn: "push_unregister_token", params: { p_token: "tok" } }]);
    expect(sb.queries).toHaveLength(0);

    sb.queueRpcResult({ error: missingFunction("push_unregister_token") });
    sb.queueResult({ data: null, error: null });
    await adminSync.removePushToken("tok");
    expect(sb.queries).toHaveLength(1);
    expect(findStep(sb.queries[0], "delete")).toBeDefined();
  });
});

describe("fetchSupportAgents", () => {
  it("returns the RPC roster sorted by priority (untagged agents last)", async () => {
    const { supportStore } = loadModules();
    sb.queueRpcResult({
      data: [
        { profile_id: "b", name: "Beta", avatar_url: null, priority: null },
        { profile_id: "a", name: "Alpha", avatar_url: "http://x/a.png", priority: 2 },
        { profile_id: "c", name: "Carol", avatar_url: null, priority: 1 },
      ],
      error: null,
    });
    const agents = await supportStore.fetchSupportAgents();
    expect(agents.map((a) => a.profile_id)).toEqual(["c", "a", "b"]);
    expect(sb.rpcCalls[0].fn).toBe("support_agents");
    expect(sb.queries).toHaveLength(0);
  });

  it("falls back to the legacy admin_access query when the RPC is missing", async () => {
    const { supportStore } = loadModules();
    sb.queueRpcResult({ error: missingFunction("support_agents") });
    sb.queueResult({
      data: [
        {
          profile_id: "p1",
          support: 3,
          page: "support",
          profile: { name: "Dana", phone: null, avatar_url: null, profile_image: null },
        },
      ],
      error: null,
    });
    const agents = await supportStore.fetchSupportAgents();
    expect(agents).toEqual([
      { profile_id: "p1", name: "Dana", avatar_url: null, priority: 3 },
    ]);
    expect(sb.queries[0].table).toBe("admin_access");
  });

  it("returns [] without falling back when the RPC errors for another reason", async () => {
    const { supportStore } = loadModules();
    sb.queueRpcResult({ error: { message: "canceling statement due to timeout" } });
    const agents = await supportStore.fetchSupportAgents();
    expect(agents).toEqual([]);
    expect(sb.queries).toHaveLength(0);
  });
});
