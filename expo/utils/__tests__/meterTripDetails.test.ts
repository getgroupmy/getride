import {
  adjustCharges,
  AIRPORT_SURCHARGE,
  airportSurchargeFor,
  chargesFromText,
  chargesToText,
  clampLuggage,
  clampPax,
  createTripDetailsDraft,
  describeAirportLeg,
  describeMissingTripDetails,
  formatPaxLuggage,
  isAirportLeg,
  isTripDetailsComplete,
  MAX_CHARGES,
  MAX_LUGGAGE,
  MAX_PAX,
  MIN_PAX,
  missingTripDetails,
  normalizeAirport,
  resolveTripDetails,
  sanitizeCharges,
  sanitizeChargesText,
  type MeterTripDetailsDraft,
} from "@/utils/meterTripDetails";
import { EXTRA_STEP } from "@/utils/taxiMeter";

/** A fully declared hire: two passengers, a bag, a toll, off the airport. */
const DECLARED: MeterTripDetailsDraft = {
  pax: 2,
  luggage: 1,
  charges: 5.5,
  airport: "dropoff",
};

describe("createTripDetailsDraft", () => {
  it("asks every question rather than answering any of them itself", () => {
    // The whole point of the declaration is that the driver states it: a
    // defaulted "1 passenger, no bags" would be the meter guessing on paper.
    expect(createTripDetailsDraft()).toEqual({
      pax: null,
      luggage: null,
      charges: 0,
      airport: null,
    });
  });

  it("carries over what the EXTRA keys already had — it is the same money", () => {
    expect(createTripDetailsDraft(4.5).charges).toBe(4.5);
    expect(createTripDetailsDraft(-2).charges).toBe(0);
    expect(createTripDetailsDraft(MAX_CHARGES + 50).charges).toBe(MAX_CHARGES);
  });
});

describe("the counts", () => {
  it("keeps a passenger count inside what a taxi can carry", () => {
    expect(clampPax(3)).toBe(3);
    expect(clampPax(0)).toBe(MIN_PAX);
    expect(clampPax(MAX_PAX + 4)).toBe(MAX_PAX);
    expect(clampPax(2.4)).toBe(2);
  });

  it("treats no luggage as a real answer, not a missing one", () => {
    expect(clampLuggage(0)).toBe(0);
    expect(clampLuggage(-3)).toBe(0);
    expect(clampLuggage(MAX_LUGGAGE + 1)).toBe(MAX_LUGGAGE);
  });

  it("has no answer for something that is not a number", () => {
    expect(clampPax(null)).toBeNull();
    expect(clampPax(undefined)).toBeNull();
    expect(clampPax("2")).toBeNull();
    expect(clampPax(Number.NaN)).toBeNull();
    expect(clampLuggage(null)).toBeNull();
  });
});

describe("the airport leg", () => {
  it("charges the same flat surcharge at either end, once", () => {
    expect(airportSurchargeFor("pickup")).toBe(AIRPORT_SURCHARGE);
    expect(airportSurchargeFor("dropoff")).toBe(AIRPORT_SURCHARGE);
  });

  it("charges nothing for a hire that touched no airport", () => {
    expect(airportSurchargeFor("none")).toBe(0);
    expect(airportSurchargeFor(null)).toBe(0);
    expect(isAirportLeg("none")).toBe(false);
    expect(isAirportLeg("pickup")).toBe(true);
  });

  it("only accepts the three answers there are", () => {
    expect(normalizeAirport("pickup")).toBe("pickup");
    expect(normalizeAirport("none")).toBe("none");
    expect(normalizeAirport("terminal")).toBeNull();
    expect(normalizeAirport(undefined)).toBeNull();
  });

  it("names the leg for the receipt", () => {
    expect(describeAirportLeg("pickup")).toBe("Airport pickup");
    expect(describeAirportLeg("dropoff")).toBe("Airport drop-off");
    expect(describeAirportLeg("none")).toBeNull();
  });
});

describe("keyed-in charges", () => {
  it("clamps a value to what the meter may charge", () => {
    expect(sanitizeCharges(12.345)).toBe(12.35);
    expect(sanitizeCharges(-1)).toBe(0);
    expect(sanitizeCharges(MAX_CHARGES + 1)).toBe(MAX_CHARGES);
    expect(sanitizeCharges("5")).toBe(0);
  });

  it("keeps a money field to digits, one separator and two decimals", () => {
    expect(sanitizeChargesText("12.50")).toBe("12.50");
    expect(sanitizeChargesText("RM 12x.5a0")).toBe("12.50");
    expect(sanitizeChargesText("1.2.3")).toBe("1.23");
    expect(sanitizeChargesText("3,50")).toBe("3.50");
    expect(sanitizeChargesText("1.239")).toBe("1.23");
  });

  it("does not rewrite what is being typed", () => {
    // Clamping mid-keystroke would turn a driver's "1" into something else the
    // moment the second digit landed; the ceiling is applied on read instead.
    expect(sanitizeChargesText("999")).toBe("999");
    expect(chargesFromText("999")).toBe(MAX_CHARGES);
    // A half-typed figure is still a usable one.
    expect(sanitizeChargesText("12.")).toBe("12.");
    expect(chargesFromText("12.")).toBe(12);
  });

  it("reads an empty or meaningless field as nothing owed", () => {
    expect(chargesFromText("")).toBe(0);
    expect(chargesFromText(".")).toBe(0);
    expect(chargesFromText("abc")).toBe(0);
  });

  it("starts an empty field empty rather than at 0.00", () => {
    expect(chargesToText(0)).toBe("");
    expect(chargesToText(7.5)).toBe("7.50");
  });

  it("steps by the same amount the EXTRA keys do, and stops at both ends", () => {
    expect(adjustCharges(1, 1)).toBe(1 + EXTRA_STEP);
    expect(adjustCharges(0, -1)).toBe(0);
    expect(adjustCharges(MAX_CHARGES, 1)).toBe(MAX_CHARGES);
  });
});

describe("what is still missing", () => {
  it("is nothing once every question has an answer", () => {
    expect(missingTripDetails(DECLARED)).toEqual([]);
    expect(isTripDetailsComplete(DECLARED)).toBe(true);
    expect(describeMissingTripDetails(DECLARED)).toBeNull();
  });

  it("lists the unanswered questions in the order the form asks them", () => {
    expect(missingTripDetails(createTripDetailsDraft())).toEqual([
      "passengers",
      "luggage",
      "airport",
    ]);
    expect(describeMissingTripDetails({ ...DECLARED, airport: null })).toBe(
      "Still to declare: airport",
    );
  });

  it("counts zero charges as declared — nothing owed is an answer", () => {
    expect(isTripDetailsComplete({ ...DECLARED, charges: 0 })).toBe(true);
  });

  it("needs the airport question answered even when the answer is 'neither'", () => {
    expect(isTripDetailsComplete({ ...DECLARED, airport: null })).toBe(false);
    expect(isTripDetailsComplete({ ...DECLARED, airport: "none" })).toBe(true);
  });
});

describe("resolveTripDetails", () => {
  it("freezes the surcharge that was actually applied", () => {
    expect(resolveTripDetails(DECLARED)).toEqual({
      pax: 2,
      luggage: 1,
      charges: 5.5,
      airport: "dropoff",
      airportSurcharge: AIRPORT_SURCHARGE,
    });
  });

  it("charges no surcharge on a hire that touched no airport", () => {
    expect(resolveTripDetails({ ...DECLARED, airport: "none" })?.airportSurcharge).toBe(0);
  });

  it("refuses to freeze a hire that was never fully declared", () => {
    expect(resolveTripDetails({ ...DECLARED, pax: null })).toBeNull();
    expect(resolveTripDetails({ ...DECLARED, luggage: null })).toBeNull();
    expect(resolveTripDetails({ ...DECLARED, airport: null })).toBeNull();
  });

  it("sanitises what it does accept", () => {
    const details = resolveTripDetails({
      pax: MAX_PAX + 3,
      luggage: -2,
      charges: MAX_CHARGES + 10,
      airport: "pickup",
    });
    expect(details).toMatchObject({ pax: MAX_PAX, luggage: 0, charges: MAX_CHARGES });
  });
});

describe("formatPaxLuggage", () => {
  it("reads the way the log row prints it", () => {
    expect(formatPaxLuggage(2, 1)).toBe("2 pax · 1 bag");
    expect(formatPaxLuggage(1, 3)).toBe("1 pax · 3 bags");
    expect(formatPaxLuggage(4, 0)).toBe("4 pax · no luggage");
  });

  it("has no line at all for a record from before the meter asked", () => {
    expect(formatPaxLuggage(null, null)).toBeNull();
    expect(formatPaxLuggage(undefined, undefined)).toBeNull();
  });

  it("prints the half it has rather than a dash for the half it does not", () => {
    expect(formatPaxLuggage(2, null)).toBe("2 pax");
    expect(formatPaxLuggage(null, 2)).toBe("2 bags");
  });
});
