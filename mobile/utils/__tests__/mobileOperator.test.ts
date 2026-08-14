import {
  IOS_CARRIER_PLACEHOLDER,
  IOS_MOBILE_CODE_PLACEHOLDER,
  formatPlmn,
  normalizeCarrierName,
  normalizeMobileCode,
  resolveMobileOperator,
} from "@/utils/mobileOperator";

describe("normalizeCarrierName", () => {
  it("returns a real carrier name unchanged", () => {
    expect(normalizeCarrierName("Maxis")).toBe("Maxis");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCarrierName("  Celcom  ")).toBe("Celcom");
  });

  it("treats null / undefined / empty as no value", () => {
    expect(normalizeCarrierName(null)).toBeNull();
    expect(normalizeCarrierName(undefined)).toBeNull();
    expect(normalizeCarrierName("")).toBeNull();
    expect(normalizeCarrierName("   ")).toBeNull();
  });

  it("treats the iOS 16+ '--' placeholder as no value", () => {
    expect(normalizeCarrierName(IOS_CARRIER_PLACEHOLDER)).toBeNull();
    expect(normalizeCarrierName("--")).toBeNull();
    expect(normalizeCarrierName("  --  ")).toBeNull();
  });
});

describe("normalizeMobileCode", () => {
  it("returns a genuine numeric code unchanged", () => {
    expect(normalizeMobileCode("502")).toBe("502");
    expect(normalizeMobileCode("12")).toBe("12");
    expect(normalizeMobileCode("017")).toBe("017");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeMobileCode("  310  ")).toBe("310");
  });

  it("treats null / undefined / empty as no value", () => {
    expect(normalizeMobileCode(null)).toBeNull();
    expect(normalizeMobileCode(undefined)).toBeNull();
    expect(normalizeMobileCode("")).toBeNull();
    expect(normalizeMobileCode("   ")).toBeNull();
  });

  it("treats the iOS 16+ '65535' placeholder as no value", () => {
    expect(normalizeMobileCode(IOS_MOBILE_CODE_PLACEHOLDER)).toBeNull();
    expect(normalizeMobileCode("65535")).toBeNull();
    expect(normalizeMobileCode("  65535  ")).toBeNull();
  });

  it("drops non-numeric junk", () => {
    expect(normalizeMobileCode("--")).toBeNull();
    expect(normalizeMobileCode("N/A")).toBeNull();
    expect(normalizeMobileCode("50a")).toBeNull();
  });
});

describe("formatPlmn", () => {
  it("joins a genuine MCC and MNC with a dash", () => {
    expect(formatPlmn("502", "12")).toBe("502-12");
  });

  it("returns whichever half is present when the other is missing", () => {
    expect(formatPlmn("502", null)).toBe("502");
    expect(formatPlmn(null, "12")).toBe("12");
  });

  it("returns null when neither is a genuine code", () => {
    expect(formatPlmn(null, undefined)).toBeNull();
    expect(formatPlmn("65535", "65535")).toBeNull();
    expect(formatPlmn("", "")).toBeNull();
  });
});

describe("resolveMobileOperator", () => {
  it("prefers a genuine on-device carrier name over the ISP", () => {
    expect(
      resolveMobileOperator({
        carrierName: "Digi",
        connectionType: "mobile",
        ispProvider: "Some Transit ISP",
        ispOrg: "AS12345",
      })
    ).toBe("Digi");
  });

  it("falls back to the IP-resolved ISP on a cellular connection", () => {
    expect(
      resolveMobileOperator({
        carrierName: "--", // iOS placeholder
        connectionType: "mobile",
        ispProvider: "Celcom Axiata",
        ispOrg: null,
      })
    ).toBe("Celcom Axiata");
  });

  it("uses isp_org when isp_provider is absent on cellular", () => {
    expect(
      resolveMobileOperator({
        carrierName: null,
        connectionType: "mobile",
        ispProvider: null,
        ispOrg: "Maxis Broadband",
      })
    ).toBe("Maxis Broadband");
  });

  it("does NOT fall back to the ISP on wifi (that's the home broadband, not an operator)", () => {
    expect(
      resolveMobileOperator({
        carrierName: null,
        connectionType: "wifi",
        ispProvider: "Home Fibre Co",
        ispOrg: "Home Fibre Co",
      })
    ).toBeNull();
  });

  it("returns null on web when there is no carrier and no cellular ISP", () => {
    expect(
      resolveMobileOperator({
        carrierName: null,
        connectionType: "other",
        ispProvider: "Office WiFi",
        ispOrg: null,
      })
    ).toBeNull();
  });

  it("returns null when cellular but the ISP is also empty", () => {
    expect(
      resolveMobileOperator({
        carrierName: "--",
        connectionType: "mobile",
        ispProvider: "  ",
        ispOrg: null,
      })
    ).toBeNull();
  });
});
