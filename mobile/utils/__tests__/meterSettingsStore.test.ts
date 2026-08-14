/**
 * The live half of the Meter Digital settings store.
 *
 * The admin editor's Show / Tap switches apply the moment they move, so the
 * write behind them has to be narrow: only the ten panel columns, never the
 * rates sitting half-typed in the same form. These cover that promise, the
 * global row being created by a toggle when it does not exist yet, and the
 * device-local fallback for a database without the table.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  createMeterProfileDraft,
  setMeterPanelAccess,
  type MeterProfile,
} from "@/utils/meterSettings";
import { saveMeterPanelAccess } from "@/utils/meterSettingsStore";

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

function card(overrides: Partial<MeterProfile> = {}): MeterProfile {
  return { ...createMeterProfileDraft("master"), id: "card-1", ...overrides };
}

/** The step of a recorded chain that carried the payload. */
function payload(query: SupabaseMock["queries"][number], method: string): Record<string, unknown> {
  const step = query.steps.find((s) => s.method === method);
  return (step?.args[0] ?? {}) as Record<string, unknown>;
}

describe("saveMeterPanelAccess", () => {
  it("updates only the panel columns of a stored card", async () => {
    const panels = setMeterPanelAccess(card().panels, "printer", { show: false });
    sb.queueResult({ data: null, error: null });

    const res = await saveMeterPanelAccess(card(), panels);

    expect(res).toEqual({ ok: true, source: "supabase", id: "card-1" });
    const [query] = sb.queries;
    expect(query.table).toBe("meter_digital_settings");
    const written = payload(query, "update");
    expect(written).toEqual({
      show_meter: true,
      show_trips: true,
      show_printer: false,
      show_obd: true,
      show_settings: true,
      tap_meter: true,
      tap_trips: true,
      tap_printer: false,
      tap_obd: true,
      tap_settings: true,
    });
    // Nothing about the fare rides along with a panel switch.
    expect(Object.keys(written).some((k) => k.includes("fare") || k.includes("charge"))).toBe(
      false,
    );
    expect(query.steps.some((s) => s.method === "eq" && s.args[0] === "id")).toBe(true);
  });

  it("finds the global row when the editor is on a card with no id yet", async () => {
    sb.queueResult({ data: [{ id: "master-row" }], error: null });
    sb.queueResult({ data: null, error: null });

    const res = await saveMeterPanelAccess(card({ id: "" }), card().panels);

    expect(res.ok).toBe(true);
    expect(res.id).toBe("master-row");
    expect(sb.queries[0].steps.some((s) => s.method === "select")).toBe(true);
    expect(sb.queries[1].steps.some((s) => s.method === "update")).toBe(true);
  });

  it("creates the global row from the card the editor is showing when there is none", async () => {
    sb.queueResult({ data: [], error: null });
    sb.queueResult({ data: [{ id: "new-master" }], error: null });

    const panels = setMeterPanelAccess(card().panels, "settings", { tap: false });
    const res = await saveMeterPanelAccess(card({ id: "" }), panels);

    expect(res.ok).toBe(true);
    expect(res.id).toBe("new-master");
    const inserted = payload(sb.queries[1], "insert");
    expect(inserted.level).toBe("master");
    expect(inserted.tap_settings).toBe(false);
    expect(inserted.show_settings).toBe(true);
    // The row it creates is the built-in tariff, so no fare moves.
    expect(inserted.flag_fare).toBe(4);
  });

  it("refuses an override card that has no row to write to yet", async () => {
    const res = await saveMeterPanelAccess(createMeterProfileDraft("city"), card().panels);

    expect(res.ok).toBe(false);
    expect(res.error).toContain("Create this rate card first");
    expect(sb.queries).toHaveLength(0);
  });

  it("names the admin-only write when RLS refuses it", async () => {
    sb.queueResult({ data: null, error: { message: "row-level security", code: "42501" } });

    const res = await saveMeterPanelAccess(card(), card().panels);

    expect(res.ok).toBe(false);
    expect(res.error).toContain("admin-only");
  });

  it("falls back to the device copy when the table isn't in the database", async () => {
    sb.queueResult({
      data: null,
      error: { message: 'relation "meter_digital_settings" does not exist', code: "42P01" },
    });

    const panels = setMeterPanelAccess(card().panels, "obd", { show: false });
    const res = await saveMeterPanelAccess(card({ id: "" }), panels);

    expect(res).toMatchObject({ ok: true, source: "local" });
    const stored = JSON.parse((await AsyncStorage.getItem("meter:settings:local")) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].panels.obd).toEqual({ show: false, tap: false });
    expect(stored[0].panels.meter).toEqual({ show: true, tap: true });
  });

  it("patches the panels of a device-local card without touching its rates", async () => {
    supabaseModule.isSupabaseConfigured = false;
    const local = card({ id: "local-1", rates: { ...card().rates, perKmCharge: 2.5 } });
    await AsyncStorage.setItem("meter:settings:local", JSON.stringify([local]));

    const panels = setMeterPanelAccess(local.panels, "trips", { show: false });
    const res = await saveMeterPanelAccess({ ...local, rates: { ...local.rates, perKmCharge: 9 } }, panels);

    expect(res).toMatchObject({ ok: true, source: "local", id: "local-1" });
    const stored = JSON.parse((await AsyncStorage.getItem("meter:settings:local")) ?? "[]");
    expect(stored[0].panels.trips).toEqual({ show: false, tap: false });
    // The stored card supplied everything but the panels — a rate the editor
    // was holding is not committed by a panel switch.
    expect(stored[0].rates.perKmCharge).toBe(2.5);
  });
});
