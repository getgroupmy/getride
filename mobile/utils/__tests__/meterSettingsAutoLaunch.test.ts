/**
 * The Meter Digital store against a database that predates migration 0084.
 *
 * `auto_launch` is one boolean the meter can perfectly well default, so a
 * project running 0081 without 0084 must not lose its rate cards over it: a read
 * or a write that trips on the missing column is retried without it, and every
 * later call skips it. Also covers the geography the store remembers for the
 * next launch's auto-launch check.
 *
 * Each test loads the store in an isolated module registry, because the
 * "database has no such column" flag is module-level by design — it is meant to
 * last the life of the app, which makes it exactly the thing a second test must
 * not inherit.
 */

import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import { createMeterProfileDraft, type MeterProfile } from "@/utils/meterSettings";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  uuidv4: () => "test-uuid",
}));

type Store = typeof import("@/utils/meterSettingsStore");

/** A store wired to `sb`, with its own copy of the missing-column flag. */
function loadStore(sb: SupabaseMock): Store {
  let store!: Store;
  jest.isolateModules(() => {
    const supa = jest.requireMock("@/utils/supabase") as {
      isSupabaseConfigured: boolean;
      supabase: unknown;
    };
    supa.isSupabaseConfigured = true;
    supa.supabase = sb.client;
    store = require("@/utils/meterSettingsStore") as Store;
  });
  return store;
}

/** The error PostgREST returns for a column the database does not have. */
const missingColumn = {
  message: "column meter_digital_settings.auto_launch does not exist",
  code: "42703",
};

function card(overrides: Partial<MeterProfile> = {}): MeterProfile {
  return { ...createMeterProfileDraft("master"), id: "card-1", ...overrides };
}

/** The columns a recorded select asked for. */
function selectedColumns(query: SupabaseMock["queries"][number]): string {
  const step = query.steps.find((s) => s.method === "select");
  return String(step?.args[0] ?? "");
}

function payload(
  query: SupabaseMock["queries"][number],
  method: string,
): Record<string, unknown> {
  const step = query.steps.find((s) => s.method === method);
  return (step?.args[0] ?? {}) as Record<string, unknown>;
}

describe("reads against a database without auto_launch", () => {
  it("retries without the column instead of losing every rate card", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: null, error: missingColumn });
    sb.queueResult({
      data: [{ id: "row-1", level: "master", flag_fare: "4.00" }],
      error: null,
    });

    const res = await store.fetchMeterProfiles();

    // The cards survive, and the redirect simply defaults to off.
    expect(res.source).toBe("supabase");
    expect(res.profiles).toHaveLength(1);
    expect(res.profiles[0].autoLaunch).toBe(false);
    expect(res.profiles[0].rates.flagFare).toBe(4);

    expect(selectedColumns(sb.queries[0])).toContain("auto_launch");
    expect(selectedColumns(sb.queries[1])).not.toContain("auto_launch");
  });

  it("stops asking for the column once the database has refused it", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: null, error: missingColumn });
    sb.queueResult({ data: [], error: null });
    await store.fetchMeterProfiles();

    sb.queueResult({ data: [], error: null });
    await store.fetchMeterProfiles();

    expect(selectedColumns(sb.queries[2])).not.toContain("auto_launch");
  });

  it("still falls back to the device copy when the whole table is missing", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({
      data: null,
      error: { message: 'relation "meter_digital_settings" does not exist', code: "42P01" },
    });

    const res = await store.fetchMeterProfiles();

    expect(res.source).toBe("local");
    // One attempt only: a missing table is not a missing column.
    expect(sb.queries).toHaveLength(1);
  });
});

describe("writes against a database without auto_launch", () => {
  it("saves the rest of the card rather than failing the save", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: null, error: missingColumn });
    sb.queueResult({ data: null, error: null });

    const res = await store.saveMeterProfile(card({ autoLaunch: true }));

    expect(res).toMatchObject({ ok: true, source: "supabase" });
    expect(payload(sb.queries[0], "update").auto_launch).toBe(true);
    const retried = payload(sb.queries[1], "update");
    expect(retried).not.toHaveProperty("auto_launch");
    // The fare is still written in full — only the unknown column is dropped.
    expect(retried.flag_fare).toBe(4);
  });

  it("creates the global row without the column when a panel toggle makes it", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: [], error: null }); // no master row yet
    sb.queueResult({ data: null, error: missingColumn });
    sb.queueResult({ data: [{ id: "new-master" }], error: null });

    const res = await store.saveMeterPanelAccess(card({ id: "" }), card().panels);

    expect(res).toMatchObject({ ok: true, id: "new-master" });
    expect(payload(sb.queries[2], "insert")).not.toHaveProperty("auto_launch");
  });
});

describe("a database behind by more than one migration", () => {
  /** The 0085 columns, which a project on 0084 has not got either. */
  const missingLeaveColumn = {
    message: "column meter_digital_settings.leave_passenger_action does not exist",
    code: "42703",
  };

  it("drops each refused group in turn rather than giving up on the table", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: null, error: missingColumn });
    sb.queueResult({ data: null, error: missingLeaveColumn });
    sb.queueResult({ data: [{ id: "row-1", level: "master" }], error: null });

    const res = await store.fetchMeterProfiles();

    expect(res.source).toBe("supabase");
    expect(res.profiles).toHaveLength(1);
    // Both defaults are "what the console did before the column existed".
    expect(res.profiles[0].autoLaunch).toBe(false);
    expect(res.profiles[0].leave.passenger).toBe("passenger");

    const third = selectedColumns(sb.queries[2]);
    expect(third).not.toContain("auto_launch");
    expect(third).not.toContain("leave_passenger_action");
    expect(third).toContain("flag_fare");
  });

  it("saves the fare against a database with no leave columns", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({ data: null, error: missingLeaveColumn });
    sb.queueResult({ data: null, error: null });

    const res = await store.saveMeterProfile(
      card({ leave: {
        passenger: "exit",
        ehailing: "app",
        ehailingUrl: null,
        ehailingLabel: null,
        ehailingAppId: null,
        ehailingStores: { ios: null, android: null, huawei: null },
      } }),
    );

    expect(res).toMatchObject({ ok: true, source: "supabase" });
    const retried = payload(sb.queries[1], "update");
    expect(retried).not.toHaveProperty("leave_passenger_action");
    expect(retried).toHaveProperty("auto_launch");
    expect(retried.flag_fare).toBe(4);
  });

  it("never narrows a write over a column that is not droppable", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    sb.queueResult({
      data: null,
      error: { message: "column meter_digital_settings.flag_fare does not exist", code: "42703" },
    });

    const res = await store.saveMeterProfile(card());

    // A fare is not a field the meter may default, so there is no retry: the
    // schema error takes the store's usual path and the card is kept on the
    // device rather than written down without its rate.
    expect(sb.queries).toHaveLength(1);
    expect(res).toMatchObject({ ok: true, source: "local" });
  });
});

describe("the geography remembered for the next launch", () => {
  it("round-trips what the meter resolved", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);

    await store.saveMeterGeo({
      country: "Malaysia",
      state: "Selangor",
      city: "Klang",
      suburb: null,
    });

    expect(await store.readMeterGeo()).toEqual({
      country: "Malaysia",
      state: "Selangor",
      city: "Klang",
      suburb: null,
    });
  });

  it("is null on a device that has never metered, so the global card decides", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);
    expect(await store.readMeterGeo()).toBeNull();
  });

  it("drops blank place names rather than matching a card on empty strings", async () => {
    const sb = createSupabaseMock();
    const store = loadStore(sb);

    await store.saveMeterGeo({
      country: "Malaysia",
      state: "   ",
      city: "",
      suburb: null,
    });

    expect(await store.readMeterGeo()).toEqual({
      country: "Malaysia",
      state: null,
      city: null,
      suburb: null,
    });
  });
});
