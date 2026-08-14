import {
  buildMeterReceiptHtml,
  buildMeterReceiptText,
} from "@/utils/meterReceipt";
import type { MeterTrip } from "@/utils/meterTripsStore";

const TRIP: MeterTrip = {
  id: "trip-1",
  cardSurcharge: 0,
  startedAt: new Date(2026, 7, 4, 11, 20, 0).getTime(),
  endedAt: new Date(2026, 7, 4, 11, 47, 0).getTime(),
  distanceM: 8420,
  elapsedMs: 27 * 60_000,
  waitingMs: 4 * 60_000,
  tariff: "old",
  period: "day",
  fare: 16.65,
  extra: 2.5,
  pax: 2,
  luggage: 1,
  airport: "none",
  airportSurcharge: 0,
  total: 19.15,
  obdSamples: 1500,
  gpsSamples: 120,
  plate: "VEP 1234",
  driver: "KABEER SINGH",
  pickup: {
    at: new Date(2026, 7, 4, 11, 20, 0).getTime(),
    odometerKm: 128450.6,
    latitude: 3.139,
    longitude: 101.6869,
    place: "KLCC, Kuala Lumpur",
  },
  dropoff: {
    at: new Date(2026, 7, 4, 11, 47, 0).getTime(),
    odometerKm: 128459.1,
    latitude: 3.1285,
    longitude: 101.6768,
    place: "Bangsar, Kuala Lumpur",
  },
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

  it("omits the charges line when nothing was keyed in by hand", () => {
    const html = buildMeterReceiptHtml({ ...TRIP, extra: 0 });
    expect(html).not.toContain("Tolls");
    expect(buildMeterReceiptHtml(TRIP)).toContain("Tolls &amp; charges");
  });

  it("prints what the driver declared at the end of the hire", () => {
    const html = buildMeterReceiptHtml(TRIP);
    expect(html).toContain("Passengers");
    expect(html).toContain("Luggage");
  });

  it("names the airport leg and prints its surcharge on its own line", () => {
    const html = buildMeterReceiptHtml({
      ...TRIP,
      airport: "pickup",
      airportSurcharge: 3,
      total: 22.15,
    });
    expect(html).toContain("Airport pickup");
    expect(html).toContain("Airport surcharge");
    expect(html).toContain("RM 3.00");
    expect(html).toContain("RM 22.15");
  });

  it("says nothing about an airport on a hire that touched none", () => {
    const html = buildMeterReceiptHtml(TRIP);
    expect(html).not.toContain("Airport");
  });

  it("leaves out a declaration the meter never asked for", () => {
    // A record from a build before the end-of-hire form existed.
    const html = buildMeterReceiptHtml({ ...TRIP, pax: null, luggage: null });
    expect(html).not.toContain("Passengers");
    expect(html).not.toContain("Luggage");
  });

  it("prints where the hire ran and what the odometer read at each end", () => {
    const html = buildMeterReceiptHtml(TRIP);
    expect(html).toContain("KLCC, Kuala Lumpur");
    expect(html).toContain("Bangsar, Kuala Lumpur");
    expect(html).toContain("Pickup odometer");
    expect(html).toContain("128 450.6 km");
    expect(html).toContain("Drop-off odometer");
    expect(html).toContain("128 459.1 km");
  });

  it("prints the fix when the geocoder never answered", () => {
    const html = buildMeterReceiptHtml({
      ...TRIP,
      pickup: { ...TRIP.pickup!, place: null },
    });
    expect(html).toContain("3.13900, 101.68690");
  });

  it("leaves out an end the meter never stamped", () => {
    // A record from a build before the ends existed, or a hire whose reader
    // never answered: no line rather than a line full of dashes.
    const html = buildMeterReceiptHtml({ ...TRIP, pickup: null, dropoff: null });
    expect(html).not.toContain("Pickup");
    expect(html).not.toContain("Drop-off");

    const noOdometer = buildMeterReceiptHtml({
      ...TRIP,
      pickup: { ...TRIP.pickup!, odometerKm: null },
    });
    expect(noOdometer).toContain("Pickup</td>");
    expect(noOdometer).not.toContain("Pickup odometer");
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
    expect(text).toContain("Pickup: KLCC, Kuala Lumpur");
    expect(text).toContain("Drop-off: Bangsar, Kuala Lumpur");
    expect(text).toContain("Pickup odometer: 128 450.6 km");
    expect(text).toContain("Drop-off odometer: 128 459.1 km");
  });
});
