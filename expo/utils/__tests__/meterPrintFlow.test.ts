import {
  meterPrintFinishesHire,
  resolveMeterPrintRoute,
} from "@/utils/meterPrintFlow";

describe("resolveMeterPrintRoute", () => {
  it("prints straight to a reachable saved printer", () => {
    expect(
      resolveMeterPrintRoute({ hasSavedPrinter: true, printerAvailable: true }),
    ).toBe("direct");
  });

  it("sends the driver to setup when no printer is saved", () => {
    expect(
      resolveMeterPrintRoute({ hasSavedPrinter: false, printerAvailable: false }),
    ).toBe("setup");
  });

  it("still offers setup when nothing is saved even if a transport exists", () => {
    expect(
      resolveMeterPrintRoute({ hasSavedPrinter: false, printerAvailable: true }),
    ).toBe("setup");
  });

  it("falls back to the OS service for a saved printer this build cannot reach", () => {
    expect(
      resolveMeterPrintRoute({ hasSavedPrinter: true, printerAvailable: false }),
    ).toBe("system");
  });
});

describe("meterPrintFinishesHire", () => {
  it("finishes the hire the console is showing", () => {
    expect(
      meterPrintFinishesHire({ printed: true, tripId: "t1", openHireTripId: "t1" }),
    ).toBe(true);
  });

  it("does not finish anything when the print did not happen", () => {
    expect(
      meterPrintFinishesHire({ printed: false, tripId: "t1", openHireTripId: "t1" }),
    ).toBe(false);
  });

  it("leaves the open hire alone when an older trip is reprinted", () => {
    expect(
      meterPrintFinishesHire({ printed: true, tripId: "t0", openHireTripId: "t1" }),
    ).toBe(false);
  });

  it("does nothing once the meter has already been cleared", () => {
    expect(
      meterPrintFinishesHire({ printed: true, tripId: "t1", openHireTripId: null }),
    ).toBe(false);
  });
});
