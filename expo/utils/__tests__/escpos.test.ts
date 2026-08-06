import {
  asciiFold,
  buildMeterReceiptEscpos,
  buildTestPrintEscpos,
  ESCPOS_INIT,
  padRow,
  paperColumns,
  wrapText,
} from "@/utils/printer/escpos";
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
  pax: 2,
  luggage: 1,
  airport: "none",
  airportSurcharge: 0,
  cardSurcharge: 0,
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

/** Every byte an ESC/POS payload emits must be ≤ 0x7F so it travels as ASCII. */
function everyByteIsAscii(doc: string): boolean {
  for (let i = 0; i < doc.length; i += 1) {
    if (doc.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

describe("asciiFold", () => {
  it("transliterates Latin accents to their base letter", () => {
    expect(asciiFold("Petáling Jáya")).toBe("Petaling Jaya");
    expect(asciiFold("café señor")).toBe("cafe senor");
  });

  it("replaces anything it cannot render with a question mark", () => {
    expect(asciiFold("KL 🚕 中文")).toBe("KL ? ??");
  });

  it("keeps newlines and plain ASCII intact", () => {
    expect(asciiFold("A\nB C-1")).toBe("A\nB C-1");
  });
});

describe("wrapText", () => {
  it("wraps on whitespace within the column width", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("hard-splits a token longer than the roll", () => {
    expect(wrapText("ABCDEFGHIJ", 4)).toEqual(["ABCD", "EFGH", "IJ"]);
  });
});

describe("padRow", () => {
  it("spreads label left and value right across the width", () => {
    expect(padRow("Total", "RM 9.00", 20)).toBe("Total        RM 9.00\n");
  });

  it("drops an over-wide value onto right-aligned lines below the label", () => {
    const out = padRow("Pickup", "A Very Long Street Name Indeed Here", 16);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Pickup");
    // Every wrapped value line is right-aligned within the width.
    for (const line of lines.slice(1)) {
      expect(line.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("paperColumns", () => {
  it("maps the two roll widths to their column counts", () => {
    expect(paperColumns("58mm")).toBe(32);
    expect(paperColumns("80mm")).toBe(48);
  });
});

describe("buildMeterReceiptEscpos", () => {
  it("opens with the printer-reset control code", () => {
    expect(buildMeterReceiptEscpos(TRIP).startsWith(ESCPOS_INIT)).toBe(true);
  });

  it("emits only ASCII-safe bytes so any transport can carry it", () => {
    expect(everyByteIsAscii(buildMeterReceiptEscpos(TRIP))).toBe(true);
    // …even with accented place names and a stray emoji in the data.
    const dirty = buildMeterReceiptEscpos({
      ...TRIP,
      pickup: { ...TRIP.pickup!, place: "Café 🚕 Petáling" },
    });
    expect(everyByteIsAscii(dirty)).toBe(true);
    expect(dirty).toContain("Cafe");
  });

  it("prints the figures the passenger is being asked to pay", () => {
    const doc = buildMeterReceiptEscpos(TRIP);
    expect(doc).toContain("RM 19.15");
    expect(doc).toContain("RM 16.65");
    expect(doc).toContain("RM 2.50");
    expect(doc).toContain("8.42 km");
  });

  it("names the source the fare was measured on", () => {
    expect(buildMeterReceiptEscpos(TRIP)).toContain("OBD-II speed");
    expect(
      buildMeterReceiptEscpos({ ...TRIP, obdSamples: 0, gpsSamples: 1620 }),
    ).toContain("Fare metered on GPS");
  });

  it("declares the night surcharge on the paper", () => {
    expect(buildMeterReceiptEscpos(TRIP)).not.toContain("Night surcharge");
    expect(buildMeterReceiptEscpos({ ...TRIP, period: "night" })).toContain("Night surcharge");
  });

  it("carries the operator branding when it is given", () => {
    const doc = buildMeterReceiptEscpos(TRIP, {
      branding: { title: "GET TAXI METER", subtitle: "Licence TX20260001" },
    });
    expect(doc).toContain("GET TAXI METER");
    expect(doc).toContain("Licence TX20260001");
  });

  it("prints the cut command only when asked", () => {
    expect(buildMeterReceiptEscpos(TRIP, { cut: false })).not.toContain("\x1DV\x00");
    expect(buildMeterReceiptEscpos(TRIP, { cut: true })).toContain("\x1DV\x00");
  });

  it("leaves out a declaration the meter never asked for", () => {
    const doc = buildMeterReceiptEscpos({ ...TRIP, pax: null, luggage: null });
    expect(doc).not.toContain("Passengers");
    expect(doc).not.toContain("Luggage");
  });
});

describe("buildTestPrintEscpos", () => {
  it("is a short, ASCII-safe self-test slip", () => {
    const doc = buildTestPrintEscpos({ paperWidth: "80mm" });
    expect(everyByteIsAscii(doc)).toBe(true);
    expect(doc).toContain("Printer test");
    expect(doc).toContain("80mm");
  });
});
