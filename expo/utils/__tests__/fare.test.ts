import { calculateFare } from "@/utils/maps";

/**
 * TEKSI Malaysia tariff (see utils/maps.ts):
 *  - "old": RM4.00 flag fall covers the first KM; after that RM0.35 per
 *    200 m or per 36 s, whichever accrues more (units are max'd, not added).
 *  - "new": RM4.00 base + RM1.00/km + RM0.30/min.
 */
describe("calculateFare — old tariff", () => {
  it("charges only the flag fall for the first kilometre", () => {
    expect(calculateFare(0, 0)).toBe(4.0);
    expect(calculateFare(0.5, 3)).toBe(4.0);
    expect(calculateFare(1, 5)).toBe(4.0);
  });

  it("charges the flag fall even for a long-duration sub-km trip (documented behavior)", () => {
    // Duration is ignored entirely while distance <= 1 km.
    expect(calculateFare(0.9, 60)).toBe(4.0);
  });

  it("clamps negative inputs to zero", () => {
    expect(calculateFare(-5, -10)).toBe(4.0);
  });

  it("charges RM0.35 per started 200m beyond the first km when distance dominates", () => {
    // 2 km, no duration: 1000 extra metres → ceil(1000/200) = 5 units.
    expect(calculateFare(2, 0)).toBe(4.0 + 5 * 0.35); // 5.75
    // 1.2 km: 200 extra metres → exactly 1 unit.
    expect(calculateFare(1.2, 0)).toBe(4.35);
    // 1.25 km: 250 extra metres → still rounds up to 2 units.
    expect(calculateFare(1.25, 0)).toBe(4.7);
  });

  it("charges by time units when the trip is slow (time dominates distance)", () => {
    // 2 km in 10 min: extra seconds = 600 * (1 - 1/2) = 300 → ceil(300/36) = 9 units
    // vs 5 distance units → time wins.
    expect(calculateFare(2, 10)).toBe(4.0 + 9 * 0.35); // 7.15
  });

  it("uses distance units when the trip is fast", () => {
    // 3 km in 2 min: 2000 extra metres → 10 units; extra seconds = 120*(2/3)=80 → 3 units.
    expect(calculateFare(3, 2)).toBe(4.0 + 10 * 0.35); // 7.5
  });

  it("applies the surge multiplier to the whole fare", () => {
    expect(calculateFare(2, 0, 2)).toBe(11.5); // (4 + 5*0.35) * 2
    expect(calculateFare(0.5, 0, 2)).toBe(8.0); // flag fall doubled
  });

  it("rounds to 2 decimal places", () => {
    const fare = calculateFare(7.77, 23.4);
    expect(fare).toBeCloseTo(Math.round(fare * 100) / 100, 10);
  });
});

describe("calculateFare — new tariff", () => {
  it("charges base + per-km + per-minute", () => {
    // 4 + 5*1 + 10*0.3 = 12
    expect(calculateFare(5, 10, 1, "new")).toBe(12.0);
  });

  it("charges only the base fare for a zero-length trip", () => {
    expect(calculateFare(0, 0, 1, "new")).toBe(4.0);
  });

  it("applies the multiplier", () => {
    expect(calculateFare(5, 10, 2, "new")).toBe(24.0);
  });

  it("clamps negative inputs to zero", () => {
    expect(calculateFare(-3, -7, 1, "new")).toBe(4.0);
  });

  it("charges fractional distance/duration proportionally", () => {
    // 4 + 2.5 + 0.3*1.5 = 6.95
    expect(calculateFare(2.5, 1.5, 1, "new")).toBe(6.95);
  });
});
