import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  resolveCommissionRate,
  validateCommissionInput,
  fetchCommissionRules,
  saveCommissionRule,
  DEFAULT_COMMISSION_RATE,
  type CommissionRule,
  type CommissionLevel,
} from "@/utils/commissionStore";

jest.mock("@/utils/supabase", () => {
  let n = 0;
  return {
    isSupabaseConfigured: true,
    supabase: null,
    uuidv4: () => `test-uuid-${++n}`,
  };
});

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

let sb: SupabaseMock;

beforeEach(async () => {
  await AsyncStorage.clear();
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
});

let ruleSeq = 0;
function makeRule(overrides: Partial<CommissionRule> = {}): CommissionRule {
  return {
    id: `rule-${++ruleSeq}`,
    level: "master",
    country: null,
    state: null,
    city: null,
    suburb: null,
    userId: null,
    userLabel: null,
    rate: 0.15,
    active: true,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveCommissionRate — priority chain", () => {
  it("falls back to the hardcoded 15% default when no rules exist", async () => {
    const resolved = await resolveCommissionRate({ rules: [] });
    expect(resolved).toEqual({
      rate: DEFAULT_COMMISSION_RATE,
      level: "default",
      label: "Platform default",
    });
    expect(DEFAULT_COMMISSION_RATE).toBe(0.15);
  });

  it("uses the master rate when only a master rule exists", async () => {
    const resolved = await resolveCommissionRate({
      rules: [makeRule({ level: "master", rate: 0.2 })],
      country: "Malaysia",
    });
    expect(resolved.rate).toBe(0.2);
    expect(resolved.level).toBe("master");
  });

  it("ignores inactive rules", async () => {
    const resolved = await resolveCommissionRate({
      rules: [makeRule({ level: "master", rate: 0.2, active: false })],
    });
    expect(resolved.level).toBe("default");
  });

  it("resolves each level in user → suburb → city → state → country → master order", async () => {
    const rules = [
      makeRule({ level: "master", rate: 0.1 }),
      makeRule({ level: "country", country: "Malaysia", rate: 0.11 }),
      makeRule({ level: "state", country: "Malaysia", state: "Selangor", rate: 0.12 }),
      makeRule({
        level: "city",
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
        rate: 0.13,
      }),
      makeRule({
        level: "suburb",
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
        suburb: "Damansara",
        rate: 0.14,
      }),
      makeRule({ level: "user", userId: "partner-9", userLabel: "Bob", rate: 0.05 }),
    ];
    const geo = {
      country: "Malaysia",
      state: "Selangor",
      city: "Petaling Jaya",
      suburb: "Damansara",
    };

    // Full geography + user override → user wins.
    expect((await resolveCommissionRate({ rules, userId: "partner-9", ...geo })).level).toBe(
      "user"
    );
    // Unknown user → suburb wins.
    expect((await resolveCommissionRate({ rules, userId: "someone-else", ...geo })).rate).toBe(
      0.14
    );
    // No suburb → city.
    expect(
      (await resolveCommissionRate({ rules, ...geo, suburb: null })).rate
    ).toBe(0.13);
    // No city/suburb → state.
    expect(
      (await resolveCommissionRate({ rules, country: "Malaysia", state: "Selangor" })).rate
    ).toBe(0.12);
    // Country only → country.
    expect((await resolveCommissionRate({ rules, country: "Malaysia" })).rate).toBe(0.11);
    // No geography at all → master.
    expect((await resolveCommissionRate({ rules })).rate).toBe(0.1);
  });

  it("matches geography case-insensitively", async () => {
    const rules = [
      makeRule({ level: "city", country: "Malaysia", city: "Kuala Lumpur", rate: 0.09 }),
    ];
    const resolved = await resolveCommissionRate({
      rules,
      country: "MALAYSIA",
      city: "kuala lumpur",
    });
    expect(resolved.rate).toBe(0.09);
    expect(resolved.level).toBe("city");
  });

  it("skips a scoped rule whose parent geography contradicts the ride", async () => {
    const rules = [
      makeRule({ level: "master", rate: 0.15 }),
      // A "Damansara" suburb override that belongs to Malaysia…
      makeRule({
        level: "suburb",
        country: "Malaysia",
        state: "Selangor",
        city: "Petaling Jaya",
        suburb: "Damansara",
        rate: 0.05,
      }),
    ];
    // …must not apply to a same-named suburb in another country.
    const resolved = await resolveCommissionRate({
      rules,
      country: "Singapore",
      state: "Singapore",
      city: "Singapore",
      suburb: "Damansara",
    });
    expect(resolved.level).toBe("master");
  });

  it("ignores blank/whitespace user ids and geography", async () => {
    const rules = [makeRule({ level: "user", userId: "u-1", rate: 0.01 })];
    const resolved = await resolveCommissionRate({ rules, userId: "   ", suburb: "  " });
    expect(resolved.level).toBe("default");
  });
});

describe("validateCommissionInput", () => {
  it("rejects rates outside [0, 1)", () => {
    expect(validateCommissionInput({ level: "master", rate: -0.01 })).toMatch(/Rate/);
    expect(validateCommissionInput({ level: "master", rate: 1 })).toMatch(/Rate/);
    expect(validateCommissionInput({ level: "master", rate: NaN })).toMatch(/Rate/);
    expect(validateCommissionInput({ level: "master", rate: 0 })).toBeNull();
    expect(validateCommissionInput({ level: "master", rate: 0.9999 })).toBeNull();
  });

  it("requires the geographic fields for each level", () => {
    expect(validateCommissionInput({ level: "country", rate: 0.1 })).toBe("Select a country.");
    expect(
      validateCommissionInput({ level: "state", rate: 0.1, country: "Malaysia" })
    ).toBe("Select a state.");
    expect(
      validateCommissionInput({
        level: "city",
        rate: 0.1,
        country: "Malaysia",
        state: "Selangor",
      })
    ).toBe("Enter a city.");
    expect(
      validateCommissionInput({
        level: "suburb",
        rate: 0.1,
        country: "Malaysia",
        state: "Selangor",
        city: "PJ",
      })
    ).toBe("Enter a suburb.");
  });

  it("requires a user for user-level overrides and treats whitespace as empty", () => {
    expect(validateCommissionInput({ level: "user", rate: 0.1 })).toBe("Select a user.");
    expect(validateCommissionInput({ level: "user", rate: 0.1, userId: "  " })).toBe(
      "Select a user."
    );
    expect(
      validateCommissionInput({ level: "user", rate: 0.1, userId: "u-1" })
    ).toBeNull();
  });

  it("accepts a complete input at every level", () => {
    const complete: Record<CommissionLevel, Parameters<typeof validateCommissionInput>[0]> = {
      master: { level: "master", rate: 0.15 },
      country: { level: "country", rate: 0.1, country: "Malaysia" },
      state: { level: "state", rate: 0.1, country: "Malaysia", state: "Selangor" },
      city: { level: "city", rate: 0.1, country: "Malaysia", state: "Selangor", city: "PJ" },
      suburb: {
        level: "suburb",
        rate: 0.1,
        country: "Malaysia",
        state: "Selangor",
        city: "PJ",
        suburb: "Damansara",
      },
      user: { level: "user", rate: 0.1, userId: "u-1" },
    };
    for (const input of Object.values(complete)) {
      expect(validateCommissionInput(input)).toBeNull();
    }
  });
});

describe("fetchCommissionRules — graceful degradation", () => {
  it("maps Supabase rows and reports source 'supabase'", async () => {
    sb.queueResult({
      data: [
        {
          id: "r1",
          level: "city",
          country: "Malaysia",
          state: "Selangor",
          city: "PJ",
          suburb: null,
          user_id: null,
          user_label: null,
          rate: "0.12",
          active: true,
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const result = await fetchCommissionRules();
    expect(result.source).toBe("supabase");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      id: "r1",
      level: "city",
      city: "PJ",
      userId: null,
      rate: 0.12, // numeric strings from PostgREST are coerced
    });
  });

  it("falls back to device-local rules when the table is missing", async () => {
    const localRules = [makeRule({ level: "master", rate: 0.22 })];
    await AsyncStorage.setItem("commission:rules:local", JSON.stringify(localRules));
    sb.queueResult({
      error: { message: 'relation "commission_rates" does not exist', code: "42P01" },
    });
    const result = await fetchCommissionRules();
    expect(result.source).toBe("local");
    expect(result.rules[0].rate).toBe(0.22);
  });

  it("falls back to the last successful cache on transient errors", async () => {
    const cached = [makeRule({ level: "master", rate: 0.18 })];
    await AsyncStorage.setItem("commission:rules:cache", JSON.stringify(cached));
    sb.queueResult({ error: { message: "network timeout" } });
    const result = await fetchCommissionRules();
    expect(result.source).toBe("local");
    expect(result.rules[0].rate).toBe(0.18);
  });

  it("uses local rules when Supabase is not configured", async () => {
    supabaseModule.isSupabaseConfigured = false;
    const result = await fetchCommissionRules();
    expect(result.source).toBe("local");
    expect(result.rules).toEqual([]);
  });
});

describe("saveCommissionRule — local fallback", () => {
  beforeEach(() => {
    supabaseModule.isSupabaseConfigured = false;
  });

  it("rejects invalid input before touching storage", async () => {
    const result = await saveCommissionRule({ level: "country", rate: 0.1 });
    expect(result).toEqual({ ok: false, error: "Select a country." });
  });

  it("keeps a single master row across repeated saves", async () => {
    expect((await saveCommissionRule({ level: "master", rate: 0.2 })).ok).toBe(true);
    expect((await saveCommissionRule({ level: "master", rate: 0.25 })).ok).toBe(true);
    const { rules } = await fetchCommissionRules();
    const masters = rules.filter((r) => r.level === "master");
    expect(masters).toHaveLength(1);
    expect(masters[0].rate).toBe(0.25);
  });

  it("rejects a duplicate override for the same scope (case-insensitive)", async () => {
    const first = await saveCommissionRule({
      level: "city",
      rate: 0.1,
      country: "Malaysia",
      state: "Selangor",
      city: "Petaling Jaya",
    });
    expect(first).toMatchObject({ ok: true, source: "local" });

    const dup = await saveCommissionRule({
      level: "city",
      rate: 0.12,
      country: "malaysia",
      state: "SELANGOR",
      city: "petaling jaya",
    });
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/);
  });
});
