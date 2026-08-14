/**
 * `adminSync.upsertPartner` — the write behind Admin → Partner Edit.
 *
 * It used to `.upsert()` unconditionally. Because `partnerToRow` carries no
 * `auth_user_id`, Postgres evaluated the `partners self insert` WITH CHECK
 * against the proposed row (auth_user_id null) even on the conflict-update
 * path, so every admin edit was rejected by RLS — silently, while the screen
 * reported "Saved". An existing row must be UPDATEd, and the caller must be
 * told when the write fails.
 */
import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";
import type { PartnerRecord } from "@/types/admin";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "generated-uuid",
}));

let sb: SupabaseMock;

/** adminSync memoises display_id → uuid, so reload it per test. */
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

const partner = (overrides: Partial<PartnerRecord> = {}): PartnerRecord =>
  ({
    id: "PR-558145",
    name: "Test Partner",
    phone: "60182000004",
    vehicle: "",
    plate: "",
    partnerTypes: ["Delivery", "eHailing", "Teksi"],
    status: "unapproved",
    permit: "none",
    documentsOk: true,
    rating: 0,
    totalRides: 0,
    joinedAt: "2026-01-01",
    ...overrides,
  }) as PartnerRecord;

describe("upsertPartner", () => {
  it("updates an existing row instead of upserting it", async () => {
    const adminSync = loadAdminSync();
    // resolvePartnerSupabaseId lookup, then the write.
    sb.queueResult({ data: { id: "row-uuid" }, error: null });
    sb.queueResult({ data: null, error: null });

    const result = await adminSync.upsertPartner(partner());

    expect(result).toEqual({ ok: true });
    const write = sb.queries[1];
    expect(write.table).toBe("partners");
    expect(findStep(write, "upsert")).toBeUndefined();
    expect(findStep(write, "eq")?.args).toEqual(["id", "row-uuid"]);
    const patch = findStep(write, "update")?.args[0] as Record<string, unknown>;
    expect(patch.partner_types).toEqual(["Delivery", "eHailing", "Teksi"]);
    // The primary key must not be in the SET list, and the back office must
    // never re-own a partner row.
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("auth_user_id");
  });

  it("inserts a brand-new partner", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ data: null, error: null }); // no existing row
    sb.queueResult({ data: null, error: null });

    const result = await adminSync.upsertPartner(partner({ id: "PR-000001" }));

    expect(result).toEqual({ ok: true });
    const write = sb.queries[1];
    const row = findStep(write, "insert")?.args[0] as Record<string, unknown>;
    expect(row.id).toBe("generated-uuid");
    expect(row.display_id).toBe("PR-000001");
  });

  it("reports an RLS rejection rather than resolving as if it saved", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ data: { id: "row-uuid" }, error: null });
    sb.queueResult({
      data: null,
      error: {
        message: 'new row violates row-level security policy for table "partners"',
        code: "42501",
      },
    });

    const result = await adminSync.upsertPartner(partner());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("row-level security");
  });

  it("reports a missing connection instead of silently doing nothing", async () => {
    const adminSync = loadAdminSync();
    const supabaseModule = jest.requireMock("@/utils/supabase") as { supabase: unknown };
    supabaseModule.supabase = null;

    const result = await adminSync.upsertPartner(partner());

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("writes partner_types verbatim so the service-mode modal matches admin", async () => {
    const adminSync = loadAdminSync();
    sb.queueResult({ data: { id: "row-uuid" }, error: null });
    sb.queueResult({ data: null, error: null });

    await adminSync.upsertPartner(partner({ partnerTypes: ["Teksi"] }));

    const patch = findStep(sb.queries[1], "update")?.args[0] as Record<string, unknown>;
    expect(patch.partner_types).toEqual(["Teksi"]);
    expect(patch.partner_type).toBe("Teksi");
  });
});
