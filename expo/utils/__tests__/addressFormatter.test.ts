import { formatSmartAddress, formatDisplayAddress } from "@/utils/addressFormatter";

describe("formatSmartAddress", () => {
  it("handles a completely unknown location", () => {
    expect(formatSmartAddress("", "")).toEqual({
      primary: "Unknown Location",
      secondary: "",
    });
  });

  it("uses the name alone when there is no address", () => {
    expect(formatSmartAddress("KLCC", "")).toEqual({ primary: "KLCC", secondary: "" });
  });

  it("keeps a single-part address as the secondary line", () => {
    expect(formatSmartAddress("KLCC", "Kuala Lumpur")).toEqual({
      primary: "KLCC",
      secondary: "Kuala Lumpur",
    });
    expect(formatSmartAddress("", "Kuala Lumpur")).toEqual({
      primary: "Kuala Lumpur",
      secondary: "Kuala Lumpur",
    });
  });

  it("splits a two-part address into primary fallback + secondary", () => {
    expect(formatSmartAddress("", "Jalan Ampang, KL")).toEqual({
      primary: "Jalan Ampang",
      secondary: "KL",
    });
    expect(formatSmartAddress("Suria KLCC", "Jalan Ampang, KL")).toEqual({
      primary: "Suria KLCC",
      secondary: "KL",
    });
  });

  it("uses the first two parts of a long address as the secondary line", () => {
    expect(
      formatSmartAddress("Suria KLCC", "Jalan Ampang, Kuala Lumpur, 50088, Malaysia")
    ).toEqual({
      primary: "Suria KLCC",
      secondary: "Jalan Ampang, Kuala Lumpur",
    });
  });

  it("trims whitespace around address parts", () => {
    expect(formatSmartAddress("", "Jalan Ampang ,  KL")).toEqual({
      primary: "Jalan Ampang",
      secondary: "KL",
    });
  });
});

describe("formatDisplayAddress", () => {
  it("handles a completely unknown location", () => {
    expect(formatDisplayAddress("", "")).toBe("Unknown Location");
  });

  it("returns whichever of name/address is present", () => {
    expect(formatDisplayAddress("KLCC", "")).toBe("KLCC");
    expect(formatDisplayAddress("", "Jalan Ampang, KL")).toBe("Jalan Ampang, KL");
  });

  it("joins name and short addresses directly", () => {
    expect(formatDisplayAddress("KLCC", "Jalan Ampang, KL")).toBe("KLCC, Jalan Ampang, KL");
  });

  it("truncates long addresses to the first two parts", () => {
    expect(
      formatDisplayAddress("KLCC", "Jalan Ampang, Kuala Lumpur, 50088, Malaysia")
    ).toBe("KLCC, Jalan Ampang, Kuala Lumpur");
  });
});
