import {
  runWithMappingRotation,
  getMappingKey,
  type MappingCallContext,
} from "@/utils/mappingClient";
import { loadAssignments } from "@/utils/serviceAssignmentsStore";
import { loadProviders, reportKeyUsage, type ApiKeyEntry } from "@/utils/apiKeysStore";

jest.mock("@/utils/serviceAssignmentsStore", () => ({
  loadAssignments: jest.fn(),
}));

jest.mock("@/utils/apiKeysStore", () => ({
  loadProviders: jest.fn(),
  reportKeyUsage: jest.fn().mockResolvedValue(undefined),
}));

const mockLoadAssignments = loadAssignments as jest.Mock;
const mockLoadProviders = loadProviders as jest.Mock;
const mockReportKeyUsage = reportKeyUsage as jest.Mock;

function makeKey(overrides: Partial<ApiKeyEntry> = {}): ApiKeyEntry {
  return {
    id: "key-1",
    label: "Key 1",
    value: "secret-1",
    useCount: 0,
    failedCount: 0,
    ...overrides,
  };
}

function wireProvider(keys: ApiKeyEntry[]) {
  mockLoadAssignments.mockResolvedValue({
    "page-1": { geocoding: { providerId: "google", serviceId: "geocoding" } },
  });
  mockLoadProviders.mockResolvedValue([
    {
      id: "google",
      name: "Google",
      services: [{ id: "geocoding", name: "Geocoding", keys }],
    },
  ]);
}

beforeEach(() => {
  mockLoadAssignments.mockResolvedValue({});
  mockLoadProviders.mockResolvedValue([]);
  mockReportKeyUsage.mockResolvedValue(undefined);
});

describe("runWithMappingRotation", () => {
  it("uses the fallback when no service is assigned to the page", async () => {
    const perform = jest.fn();
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("fb");
    expect(perform).not.toHaveBeenCalled();
  });

  it("invokes a keyless service once with an empty key", async () => {
    wireProvider([]);
    const perform = jest.fn(async (ctx: MappingCallContext) => ({
      ok: true,
      value: `via-${ctx.providerSlug}-${ctx.key}`,
    }));
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("via-google-");
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("falls back when the keyless call fails", async () => {
    wireProvider([]);
    const perform = jest.fn(async () => ({ ok: false as const, value: "bad" }));
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("fb");
  });

  it("rotates to the next key on failure and reports usage for both", async () => {
    wireProvider([
      makeKey({ id: "a", value: "key-a" }),
      makeKey({ id: "b", value: "key-b" }),
    ]);
    const perform = jest.fn(async (ctx: MappingCallContext) =>
      ctx.key === "key-a" ? { ok: false as const, value: "" } : { ok: true, value: "ok-b" }
    );
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("ok-b");
    expect(mockReportKeyUsage.mock.calls).toEqual([
      ["google", "geocoding", "a", false],
      ["google", "geocoding", "b", true],
    ]);
  });

  it("tries keys in health order: fewest failures first, then least used", async () => {
    wireProvider([
      makeKey({ id: "worst", value: "k-worst", failedCount: 3 }),
      makeKey({ id: "busy", value: "k-busy", failedCount: 0, useCount: 10 }),
      makeKey({ id: "best", value: "k-best", failedCount: 0, useCount: 1 }),
    ]);
    const tried: string[] = [];
    const perform = jest.fn(async (ctx: MappingCallContext) => {
      tried.push(ctx.key);
      return { ok: false as const, value: "" };
    });
    await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(tried).toEqual(["k-best", "k-busy", "k-worst"]);
  });

  it("skips disabled and empty keys", async () => {
    wireProvider([
      makeKey({ id: "off", value: "k-off", disabled: true }),
      makeKey({ id: "empty", value: "  " }),
      makeKey({ id: "on", value: "k-on" }),
    ]);
    const perform = jest.fn(async (_ctx: MappingCallContext) => ({ ok: true, value: "done" }));
    await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(perform).toHaveBeenCalledTimes(1);
    expect(perform.mock.calls[0][0].key).toBe("k-on");
  });

  it("returns the last non-ok value when every key fails but produced output", async () => {
    wireProvider([makeKey({ id: "a", value: "key-a" })]);
    const perform = jest.fn(async () => ({ ok: false as const, value: "partial-result" }));
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("partial-result");
  });

  it("falls back when every key throws", async () => {
    wireProvider([
      makeKey({ id: "a", value: "key-a" }),
      makeKey({ id: "b", value: "key-b" }),
    ]);
    const perform = jest.fn(async () => {
      throw new Error("network down");
    });
    const result = await runWithMappingRotation("page-1", "geocoding", perform, async () => "fb");
    expect(result).toBe("fb");
    expect(mockReportKeyUsage.mock.calls).toEqual([
      ["google", "geocoding", "a", false],
      ["google", "geocoding", "b", false],
    ]);
  });
});

describe("getMappingKey", () => {
  it("returns null when nothing is assigned", async () => {
    expect(await getMappingKey("page-1", "geocoding")).toBeNull();
  });

  it("returns the healthiest key with full provider context", async () => {
    wireProvider([
      makeKey({ id: "bad", value: "k-bad", failedCount: 5 }),
      makeKey({ id: "good", value: "k-good", label: "Good key" }),
    ]);
    expect(await getMappingKey("page-1", "geocoding")).toMatchObject({
      providerId: "google",
      serviceId: "geocoding",
      key: "k-good",
      keyId: "good",
      keyLabel: "Good key",
      providerName: "Google",
      serviceName: "Geocoding",
    });
  });

  it("returns null when the assigned service has no usable keys", async () => {
    wireProvider([makeKey({ id: "off", disabled: true })]);
    expect(await getMappingKey("page-1", "geocoding")).toBeNull();
  });
});
