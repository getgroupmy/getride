import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  normalizeRoute,
  sanitizeRoutes,
  isRouteAlwaysOn,
  fetchAlwaysOnConfig,
  saveAlwaysOnConfig,
  DEFAULT_ALWAYS_ON_ROUTES,
  ALWAYS_ON_PAGE_CATALOG,
} from "@/utils/alwaysOnStore";

jest.mock("@/utils/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
}));

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

let sb: SupabaseMock;

/**
 * `settings_entries.id` is a uuid column, so the singleton config row must be
 * addressed by a valid UUID. Writing a bare "config" string was rejected by
 * Postgres (22P02) and surfaced as "Save failed" — a bug the chain-recording
 * mock can't catch on its own, hence these explicit shape assertions.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(async () => {
  await AsyncStorage.clear();
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
});

describe("normalizeRoute", () => {
  it("strips a leading slash and query/hash", () => {
    expect(normalizeRoute("/meter-digital")).toBe("meter-digital");
    expect(normalizeRoute("/meter-digital?tab=1")).toBe("meter-digital");
    expect(normalizeRoute("meter-digital#x")).toBe("meter-digital");
  });

  it("keeps only the first segment", () => {
    expect(normalizeRoute("/admin-settings/always-on")).toBe("admin-settings");
  });

  it("maps root to index and blanks to empty", () => {
    expect(normalizeRoute("/")).toBe("index");
    expect(normalizeRoute("")).toBe("");
    expect(normalizeRoute(null)).toBe("");
    expect(normalizeRoute(undefined)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRoute("  navigation  ")).toBe("navigation");
  });
});

describe("sanitizeRoutes", () => {
  it("normalises, de-dupes and drops blanks", () => {
    expect(sanitizeRoutes(["/meter-digital", "meter-digital", "", "  ", "navigation"])).toEqual([
      "meter-digital",
      "navigation",
    ]);
  });

  it("ignores non-string entries and non-arrays", () => {
    expect(sanitizeRoutes([123, null, "ride-running"] as unknown[])).toEqual(["ride-running"]);
    expect(sanitizeRoutes("not-an-array" as unknown)).toEqual([]);
    expect(sanitizeRoutes(undefined)).toEqual([]);
  });
});

describe("isRouteAlwaysOn", () => {
  const routes = ["partner-teksi", "meter-digital"];

  it("matches the active pathname against the enabled set", () => {
    expect(isRouteAlwaysOn("/meter-digital", routes)).toBe(true);
    expect(isRouteAlwaysOn("/partner-teksi?x=1", routes)).toBe(true);
    expect(isRouteAlwaysOn("/index", routes)).toBe(false);
    expect(isRouteAlwaysOn("/wallet", routes)).toBe(false);
  });

  it("is false for empty/blank pathnames", () => {
    expect(isRouteAlwaysOn("", routes)).toBe(false);
    expect(isRouteAlwaysOn(null, routes)).toBe(false);
  });

  it("tolerates un-normalised routes in the enabled set", () => {
    expect(isRouteAlwaysOn("/meter-digital", ["/meter-digital"])).toBe(true);
  });
});

describe("catalog / defaults", () => {
  it("includes the three defaults in the catalog", () => {
    const catalogRoutes = ALWAYS_ON_PAGE_CATALOG.map((p) => p.route);
    for (const r of DEFAULT_ALWAYS_ON_ROUTES) {
      expect(catalogRoutes).toContain(r);
    }
  });

  it("defaults are the driver console pages", () => {
    expect(DEFAULT_ALWAYS_ON_ROUTES).toEqual([
      "partner-teksi",
      "partner-ehailing",
      "meter-digital",
    ]);
  });
});

describe("fetchAlwaysOnConfig", () => {
  it("returns built-in defaults (unconfigured) when no row exists", async () => {
    sb.queueResult({ data: null, error: null });
    const config = await fetchAlwaysOnConfig();
    expect(config.source).toBe("default");
    expect(config.configured).toBe(false);
    expect(config.routes).toEqual(DEFAULT_ALWAYS_ON_ROUTES);
  });

  it("parses a stored JSON routes value from Supabase", async () => {
    sb.queueResult({
      data: {
        id: "config",
        values: { routes: JSON.stringify(["meter-digital", "navigation"]) },
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });
    const config = await fetchAlwaysOnConfig();
    expect(config.source).toBe("supabase");
    expect(config.configured).toBe(true);
    expect(config.routes).toEqual(["meter-digital", "navigation"]);
  });

  it("filters the config row by a valid UUID id (not a bare string)", async () => {
    sb.queueResult({ data: null, error: null });
    await fetchAlwaysOnConfig();
    const query = sb.queries.find((q) => q.table === "settings_entries");
    const idFilter = query?.steps.find((s) => s.method === "eq" && s.args[0] === "id");
    expect(idFilter).toBeDefined();
    expect(idFilter?.args[1]).toMatch(UUID_RE);
  });

  it("respects an explicitly empty configured set", async () => {
    sb.queueResult({
      data: { id: "config", values: { routes: "[]" }, updated_at: null },
      error: null,
    });
    const config = await fetchAlwaysOnConfig();
    expect(config.configured).toBe(true);
    expect(config.routes).toEqual([]);
  });

  it("falls back to defaults when the table is missing", async () => {
    sb.queueResult({
      error: { message: 'relation "settings_entries" does not exist', code: "42P01" },
    });
    const config = await fetchAlwaysOnConfig();
    expect(config.source).toBe("default");
    expect(config.routes).toEqual(DEFAULT_ALWAYS_ON_ROUTES);
  });

  it("uses defaults when Supabase is not configured and no cache exists", async () => {
    supabaseModule.isSupabaseConfigured = false;
    const config = await fetchAlwaysOnConfig();
    expect(config.routes).toEqual(DEFAULT_ALWAYS_ON_ROUTES);
  });
});

describe("saveAlwaysOnConfig", () => {
  it("persists a sanitised route set to Supabase", async () => {
    sb.queueResult({ data: null, error: null });
    const result = await saveAlwaysOnConfig(["/meter-digital", "meter-digital", "navigation"]);
    expect(result.ok).toBe(true);
    expect(result.config?.source).toBe("supabase");
    expect(result.config?.routes).toEqual(["meter-digital", "navigation"]);
    expect(result.config?.configured).toBe(true);
  });

  it("upserts the config row with a valid UUID id (not a bare string)", async () => {
    sb.queueResult({ data: null, error: null });
    await saveAlwaysOnConfig(["meter-digital"]);
    const query = sb.queries.find((q) => q.table === "settings_entries");
    const upsert = findStep(query!, "upsert");
    expect(upsert).toBeDefined();
    const payload = upsert?.args[0] as { id?: string; category?: string };
    expect(payload.category).toBe("always-on-pages");
    expect(payload.id).toMatch(UUID_RE);
  });

  it("saves locally when the table is missing", async () => {
    sb.queueResult({
      error: { message: 'relation "settings_entries" does not exist', code: "42P01" },
    });
    const result = await saveAlwaysOnConfig(["meter-digital"]);
    expect(result.ok).toBe(true);
    expect(result.config?.source).toBe("local");
  });

  it("returns an error on a transient failure", async () => {
    sb.queueResult({ error: { message: "network timeout" } });
    const result = await saveAlwaysOnConfig(["meter-digital"]);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
