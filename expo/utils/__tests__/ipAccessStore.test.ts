import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import { evaluateIp, listIpRules } from "@/utils/ipAccessStore";

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
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
});

describe("evaluateIp", () => {
  it("returns null without querying when the IP is unknown", async () => {
    expect(await evaluateIp(null)).toBeNull();
    expect(sb.queries).toHaveLength(0);
  });

  it("returns null when Supabase is not configured", async () => {
    supabaseModule.isSupabaseConfigured = false;
    expect(await evaluateIp("1.2.3.4")).toBeNull();
  });

  it("matches a whitelisted IP", async () => {
    sb.queueResult({ data: [{ list_type: "whitelist" }] });
    expect(await evaluateIp("1.2.3.4")).toBe("whitelist");
  });

  it("matches a blacklisted IP", async () => {
    sb.queueResult({ data: [{ list_type: "blacklist" }] });
    expect(await evaluateIp("1.2.3.4")).toBe("blacklist");
  });

  it("lets the blacklist win when an IP is (improbably) in both lists", async () => {
    sb.queueResult({ data: [{ list_type: "whitelist" }, { list_type: "blacklist" }] });
    expect(await evaluateIp("1.2.3.4")).toBe("blacklist");
  });

  it("returns null for an unmatched IP", async () => {
    sb.queueResult({ data: [] });
    expect(await evaluateIp("5.6.7.8")).toBeNull();
  });

  it("fails open (null) on query errors — a DB outage must not lock everyone out", async () => {
    sb.queueResult({ error: { message: "boom" } });
    expect(await evaluateIp("1.2.3.4")).toBeNull();
  });
});

describe("listIpRules", () => {
  it("returns rules from Supabase", async () => {
    const rows = [
      {
        id: "r1",
        ip_address: "1.2.3.4",
        list_type: "whitelist",
        label: "Office",
        created_at: null,
        updated_at: null,
      },
    ];
    sb.queueResult({ data: rows });
    expect(await listIpRules()).toEqual(rows);
  });

  it("returns an empty list on errors or when unconfigured", async () => {
    sb.queueResult({ error: { message: "boom" } });
    expect(await listIpRules()).toEqual([]);

    supabaseModule.isSupabaseConfigured = false;
    expect(await listIpRules()).toEqual([]);
  });
});
