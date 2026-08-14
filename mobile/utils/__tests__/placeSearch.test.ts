import { parsePlaceResults, splitDisplayName, searchPlaces } from "@/utils/placeSearch";

describe("splitDisplayName", () => {
  it("takes the first part as the name and the rest as the address", () => {
    expect(splitDisplayName("KLCC, Jalan Ampang, Kuala Lumpur, Malaysia")).toEqual({
      name: "KLCC",
      address: "Jalan Ampang, Kuala Lumpur, Malaysia",
    });
  });

  it("reuses a single part as both name and address", () => {
    expect(splitDisplayName("Putrajaya")).toEqual({
      name: "Putrajaya",
      address: "Putrajaya",
    });
  });

  it("ignores empty segments and surrounding whitespace", () => {
    expect(splitDisplayName("  KLCC ,, Kuala Lumpur ,  ")).toEqual({
      name: "KLCC",
      address: "Kuala Lumpur",
    });
  });

  it("survives an empty string", () => {
    expect(splitDisplayName("")).toEqual({ name: "", address: "" });
  });
});

describe("parsePlaceResults", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    osm_type: "node",
    osm_id: 12345,
    lat: "3.1578",
    lon: "101.7117",
    display_name: "KLCC, Jalan Ampang, Kuala Lumpur",
    ...over,
  });

  it("parses a well-formed row, converting string coordinates", () => {
    expect(parsePlaceResults([row()])).toEqual([
      {
        id: "node:12345",
        name: "KLCC",
        address: "Jalan Ampang, Kuala Lumpur",
        latitude: 3.1578,
        longitude: 101.7117,
      },
    ]);
  });

  it("returns an empty list for a non-array payload", () => {
    expect(parsePlaceResults(null)).toEqual([]);
    expect(parsePlaceResults({ error: "nope" })).toEqual([]);
    expect(parsePlaceResults("[]")).toEqual([]);
  });

  it("drops rows with unusable coordinates rather than inventing a place", () => {
    const bad = [
      row({ lat: "not-a-number" }),
      row({ lon: undefined }),
      row({ lat: "91" }), // out of range
      row({ lon: "181" }),
    ];
    expect(parsePlaceResults(bad)).toEqual([]);
  });

  it("drops a row with no display name, since there is nothing to show", () => {
    expect(parsePlaceResults([row({ display_name: "" })])).toEqual([]);
    expect(parsePlaceResults([row({ display_name: 42 })])).toEqual([]);
  });

  it("falls back to coordinates for the id when osm_id is absent", () => {
    const [only] = parsePlaceResults([row({ osm_id: undefined, osm_type: undefined })]);
    expect(only.id).toBe("3.1578,101.7117");
  });

  it("keeps the good rows when only some are malformed", () => {
    const results = parsePlaceResults([
      row({ osm_id: 1 }),
      row({ lat: "bad", osm_id: 2 }),
      row({ osm_id: 3, display_name: "Sunway, Selangor" }),
    ]);
    expect(results.map((r) => r.id)).toEqual(["node:1", "node:3"]);
    expect(results[1].name).toBe("Sunway");
  });

  it("skips null and primitive entries", () => {
    expect(parsePlaceResults([null, 5, "x", row()])).toHaveLength(1);
  });
});

describe("searchPlaces", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not call the network for a query shorter than two characters", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await searchPlaces("")).toEqual([]);
    expect(await searchPlaces(" a ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns parsed results for a successful response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          osm_type: "node",
          osm_id: 7,
          lat: "3.0",
          lon: "101.0",
          display_name: "Sunway Pyramid, Selangor",
        },
      ],
    }) as unknown as typeof fetch;

    const results = await searchPlaces("sunway");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Sunway Pyramid", latitude: 3, longitude: 101 });
  });

  it("biases the search around the rider when a position is given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPlaces("klcc", { near: { latitude: 3, longitude: 101 } });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("viewbox=");
    expect(decodeURIComponent(url)).toContain("100,4,102,2");
  });

  it("reports no matches instead of throwing when the request fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(searchPlaces("klcc")).resolves.toEqual([]);
  });

  it("reports no matches on a non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => [],
    }) as unknown as typeof fetch;
    await expect(searchPlaces("klcc")).resolves.toEqual([]);
  });
});
