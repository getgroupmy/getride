/**
 * EV orders are customer data, so they sync through the owner-scoped
 * `ev_orders` table (migration 0080) rather than `settings_entries`, whose
 * writes are admin-only. Older databases without that table must keep working,
 * which is what the missing-table fallback covers.
 */
import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "test-uuid",
}));

let sb: SupabaseMock;

function loadAdminSync() {
  jest.resetModules();
  const supabaseModule = jest.requireMock("@/utils/supabase") as {
    isSupabaseConfigured: boolean;
    supabase: unknown;
  };
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/utils/adminSync") as typeof import("@/utils/adminSync");
}

const entry = {
  id: "order-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: { status: "pending", total: 180000 },
};

const missingTable = {
  message: "Could not find the table 'public.ev_orders' in the schema cache",
  code: "PGRST205",
};

describe("isMissingTableError", () => {
  it("recognises a table that does not exist yet", () => {
    const adminSync = loadAdminSync();
    expect(adminSync.isMissingTableError(missingTable)).toBe(true);
    expect(adminSync.isMissingTableError({ code: "42P01", message: "" })).toBe(true);
    expect(
      adminSync.isMissingTableError({ message: 'relation "public.ev_orders" does not exist' })
    ).toBe(true);
  });

  it("ignores every other failure", () => {
    const adminSync = loadAdminSync();
    expect(adminSync.isMissingTableError(null)).toBe(false);
    expect(adminSync.isMissingTableError({ message: "permission denied", code: "42501" })).toBe(
      false
    );
    expect(adminSync.isMissingTableError({ message: "duplicate key value" })).toBe(false);
  });
});

describe("ev-orders routing", () => {
  it("is registered as an owner-scoped category", () => {
    const adminSync = loadAdminSync();
    expect(adminSync.OWNER_SCOPED_CATEGORIES).toContain("ev-orders");
    expect(adminSync.CATEGORY_TABLE_MAP["ev-orders"]).toBe("ev_orders");
  });

  it("writes an order to ev_orders, not settings_entries", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ error: null });
    await adminSync.upsertSetting("ev-orders", entry, 0);

    expect(sb.queries).toHaveLength(1);
    expect(sb.queries[0].table).toBe("ev_orders");
    const upsert = findStep(sb.queries[0], "upsert");
    expect(upsert?.args[0]).toEqual({ id: "order-1", values: entry.values, position: 0 });
    // user_id is defaulted server-side from auth.uid() and frozen by trigger.
    expect(upsert?.args[0]).not.toHaveProperty("user_id");
  });

  it("falls back to settings_entries on a database without the table", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ error: missingTable });
    sb.queueResult({ error: null });
    await adminSync.upsertSetting("ev-orders", entry, 2);

    expect(sb.queries.map((q) => q.table)).toEqual(["ev_orders", "settings_entries"]);
    const legacy = findStep(sb.queries[1], "upsert");
    expect(legacy?.args[0]).toEqual({
      id: "order-1",
      category: "ev-orders",
      values: entry.values,
      position: 2,
    });
  });

  it("does not fall back when the write was rejected for another reason", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ error: { message: "permission denied for table ev_orders", code: "42501" } });
    await adminSync.upsertSetting("ev-orders", entry, 0);

    expect(sb.queries.map((q) => q.table)).toEqual(["ev_orders"]);
  });

  it("deletes from ev_orders, falling back the same way", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ error: null });
    await adminSync.deleteSetting("order-1", "ev-orders");
    expect(sb.queries.map((q) => q.table)).toEqual(["ev_orders"]);

    const adminSync2 = loadAdminSync();
    sb.queueResult({ error: missingTable });
    sb.queueResult({ error: null });
    await adminSync2.deleteSetting("order-1", "ev-orders");
    expect(sb.queries.map((q) => q.table)).toEqual(["ev_orders", "settings_entries"]);
  });

  it("reads orders from ev_orders and merges them into the entry map", async () => {
    const adminSync = loadAdminSync();
    // settings_entries (fetchAllSettings) …
    sb.queueResult({ data: [], error: null });
    // … then one queued result per dedicated table, in map order.
    const tables = Object.keys(adminSync.CATEGORY_TABLE_MAP);
    tables.forEach((cat) => {
      sb.queueResult(
        cat === "ev-orders"
          ? {
              data: [
                {
                  id: "order-1",
                  values: { status: "assigned" },
                  position: 0,
                  created_at: entry.createdAt,
                  updated_at: entry.updatedAt,
                },
              ],
              error: null,
            }
          : { data: [], error: null }
      );
    });
    // Kind-mapped categories share the remaining default results.
    const grouped = await adminSync.fetchAllSettings();
    expect(sb.queries.some((q) => q.table === "ev_orders")).toBe(true);
    expect(grouped?.["ev-orders"]).toBeDefined();
  });
});
