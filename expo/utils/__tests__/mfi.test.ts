import {
  accessoryAddress,
  accessoryLabel,
  describeMfiAvailability,
  describeMfiSelectionFailure,
  isLikelyMfiAccessory,
  normalizeAccessoryKey,
  pickMfiAccessory,
} from "@/utils/canbus/mfi";

describe("normalizeAccessoryKey", () => {
  it("compares names and MAC spellings blind to case and separators", () => {
    expect(normalizeAccessoryKey(" OBDLink MX+ ")).toBe("obdlinkmx+");
    expect(normalizeAccessoryKey("00:1D:A5:68:98:8B")).toBe(
      normalizeAccessoryKey("001da568988b"),
    );
    expect(normalizeAccessoryKey("00-1d-a5-68-98-8b")).toBe(
      normalizeAccessoryKey("00:1D:A5:68:98:8B"),
    );
  });

  it("treats missing values as empty", () => {
    expect(normalizeAccessoryKey(null)).toBe("");
    expect(normalizeAccessoryKey(undefined)).toBe("");
    expect(normalizeAccessoryKey("   ")).toBe("");
  });
});

describe("accessoryAddress / accessoryLabel", () => {
  it("prefers the address, falling back to the id", () => {
    expect(accessoryAddress({ address: "AA:BB", id: "x" })).toBe("AA:BB");
    expect(accessoryAddress({ id: "acc-1" })).toBe("acc-1");
    expect(accessoryAddress({})).toBe("");
  });

  it("labels by name, then address, then a generic fallback", () => {
    expect(accessoryLabel({ name: "OBDLink MX+", address: "AA:BB" })).toBe("OBDLink MX+");
    expect(accessoryLabel({ name: "  ", address: "AA:BB" })).toBe("AA:BB");
    expect(accessoryLabel({})).toBe("MFi accessory");
  });
});

describe("isLikelyMfiAccessory", () => {
  it("matches the known OBD-II vendor names", () => {
    expect(isLikelyMfiAccessory({ name: "OBDLink MX+" })).toBe(true);
    expect(isLikelyMfiAccessory({ name: "elm327 v1.5" })).toBe(true);
    expect(isLikelyMfiAccessory({ name: "ScanTool STN2120" })).toBe(true);
  });

  it("ignores unrelated and nameless accessories", () => {
    expect(isLikelyMfiAccessory({ name: "AirPods Pro" })).toBe(false);
    expect(isLikelyMfiAccessory({ address: "AA:BB" })).toBe(false);
    expect(isLikelyMfiAccessory(null)).toBe(false);
  });
});

describe("pickMfiAccessory", () => {
  const obd = { name: "OBDLink MX+", address: "00:1D:A5:68:98:8B" };
  const pods = { name: "AirPods Pro", address: "11:22:33:44:55:66" };

  it("takes the first accessory that looks like a reader when none is named", () => {
    expect(pickMfiAccessory([pods, obd])).toBe(obd);
    expect(pickMfiAccessory([pods])).toBeNull();
    expect(pickMfiAccessory([])).toBeNull();
    expect(pickMfiAccessory(null)).toBeNull();
  });

  it("matches a named accessory on name, address or id", () => {
    expect(pickMfiAccessory([pods, obd], "obdlink mx+")).toBe(obd);
    expect(pickMfiAccessory([pods, obd], "001da568988b")).toBe(obd);
    expect(pickMfiAccessory([{ id: "acc-7", name: "Clone" }], "ACC-7")?.id).toBe("acc-7");
  });

  it("never falls back to another dongle when the named one is absent", () => {
    // Silently linking to a different accessory would stream another car.
    expect(pickMfiAccessory([obd], "Veepeak OBDCheck")).toBeNull();
  });
});

describe("describeMfiSelectionFailure", () => {
  it("distinguishes nothing-paired from nothing-matching", () => {
    expect(describeMfiSelectionFailure([], null)).toMatch(/No MFi accessory is paired/i);
    expect(describeMfiSelectionFailure([{ name: "AirPods" }], null)).toMatch(
      /None of the paired accessories/i,
    );
    expect(describeMfiSelectionFailure([], "OBDLink MX+")).toMatch(/is not paired/i);
    expect(describeMfiSelectionFailure([{ name: "AirPods" }], "OBDLink MX+")).toMatch(
      /was not among the paired accessories/i,
    );
  });
});

describe("describeMfiAvailability", () => {
  const linked = {
    moduleInstalled: true,
    nativeModuleLinked: true,
    runtime: "standalone" as const,
  };

  it("is available only on iOS with the native module linked", () => {
    expect(describeMfiAvailability({ ...linked, platform: "ios" })).toEqual({
      available: true,
    });
  });

  it("points Android and web users at the transports that work there", () => {
    expect(describeMfiAvailability({ ...linked, platform: "android" })).toMatchObject({
      available: false,
      reason: expect.stringMatching(/iOS-only/i),
    });
    expect(describeMfiAvailability({ ...linked, platform: "web" })).toMatchObject({
      available: false,
      reason: expect.stringMatching(/not supported on web/i),
    });
  });

  it("phrases the missing driver for the runtime the driver is in", () => {
    expect(
      describeMfiAvailability({
        moduleInstalled: false,
        nativeModuleLinked: false,
        platform: "ios",
        runtime: "expo-go",
      }),
    ).toMatchObject({
      reason: expect.stringMatching(/development or production build/i),
    });
    expect(
      describeMfiAvailability({
        moduleInstalled: false,
        nativeModuleLinked: false,
        platform: "ios",
        runtime: "standalone",
      }),
    ).toMatchObject({
      reason: expect.stringMatching(/not included in this build/i),
      guidance: expect.stringMatching(/react-native-bluetooth-classic/),
    });
  });
});
