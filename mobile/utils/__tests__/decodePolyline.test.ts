import { decodePolyline } from "@/utils/maps";

describe("decodePolyline", () => {
  // Canonical example from Google's Encoded Polyline Algorithm docs.
  const GOOGLE_EXAMPLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

  it("decodes Google's documented example polyline", () => {
    expect(decodePolyline(GOOGLE_EXAMPLE)).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it("decodes a single-point polyline", () => {
    expect(decodePolyline("_p~iF~ps|U")).toEqual([
      { latitude: 38.5, longitude: -120.2 },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("respects the precision parameter", () => {
    // Same encoded string read at precision 6 yields coordinates 10× smaller.
    const at6 = decodePolyline(GOOGLE_EXAMPLE, 6);
    expect(at6[0].latitude).toBeCloseTo(3.85, 10);
    expect(at6[0].longitude).toBeCloseTo(-12.02, 10);
  });

  it("accumulates deltas so later points depend on earlier ones", () => {
    const points = decodePolyline(GOOGLE_EXAMPLE);
    // Second point = first point + delta; make sure ordering is preserved.
    expect(points[1].latitude).toBeGreaterThan(points[0].latitude);
    expect(points[2].longitude).toBeLessThan(points[1].longitude);
  });
});
