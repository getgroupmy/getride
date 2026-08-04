import {
  buildMeterReceiptHtml,
  buildMeterReceiptText,
} from "@/utils/meterReceipt";
import type { MeterTrip } from "@/utils/meterTripsStore";

const TRIP: MeterTrip = {
  id: "trip-1",
  startedAt: new Date(2026, 7, 4, 11, 20, 0).getTime(),
  endedAt: new Date(2026, 7, 4, 11, 47, 0).getTime(),
  distanceM: 8420,
  elapsedMs: 27 * 60_000,
  waitingMs: 4 * 60_000,
  tariff: "old",
  period: "day",
  fare: 16.65,
  extra: 2.5,
  total: 19.15,
  obdSamples: 1500,
  gpsSamples: 120,
  plate: "VEP 1234",
  driver: "KABEER SINGH",
};

describe("buildMeterReceiptHtml", () => {
  it("prints the totals the passenger is being asked to pay", () => {
    const html = buildMeterReceiptHtml(TRIP);
    expect(html).toContain("RM 19.15");
    expect(html).toContain("RM 16.65");
    expect(html).toContain("RM 2.50");
    expect(html).toContain("8.42 km");
    expect(html).toContain("00:27:00");
    expect(html).toContain("04 AUG 2026");
  });

  it("names the source the fare was measured on", () => {
    expect(buildMeterReceiptHtml(TRIP)).toContain("OBD-II speed");
    expect(
      buildMeterReceiptHtml({ ...TRIP, obdSamples: 0, gpsSamples: 1620 }),
    ).toContain("Fare metered on GPS");
  });

  it("declares the night surcharge on the paper", () => {
    expect(buildMeterReceiptHtml(TRIP)).not.toContain("Night surcharge");
    const night = buildMeterReceiptHtml({ ...TRIP, period: "night" });
    expect(night).toContain("Night surcharge");
    expect(night).toContain("+50%");
  });

  it("omits the extras line when nothing was added by hand", () => {
    expect(buildMeterReceiptHtml({ ...TRIP, extra: 0 })).not.toContain("Extras");
  });

  it("escapes the driver-supplied fields", () => {
    const html = buildMeterReceiptHtml({
      ...TRIP,
      plate: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries the operator branding when it is given", () => {
    const html = buildMeterReceiptHtml(TRIP, {
      title: "GET TAXI METER",
      subtitle: "Licence TX20260001",
    });
    expect(html).toContain("GET TAXI METER");
    expect(html).toContain("Licence TX20260001");
  });
});

describe("buildMeterReceiptText", () => {
  it("carries the same figures as the printed copy", () => {
    const text = buildMeterReceiptText(TRIP);
    expect(text).toContain("Total: RM 19.15");
    expect(text).toContain("Distance: 8.42 km");
    expect(text).toContain("Vehicle VEP 1234");
    expect(text).toContain("Driver KABEER SINGH");
  });
});
