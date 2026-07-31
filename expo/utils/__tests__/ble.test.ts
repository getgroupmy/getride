import {
  describeBleAvailability,
  isLikelyElmName,
  matchesElmAdvertisement,
  normalizeUuid,
  resolveBleProfile,
  sameUuid,
  type BleServiceLike,
} from "@/utils/canbus/ble";

const FULL_FFF0 = "0000fff0-0000-1000-8000-00805f9b34fb";

describe("normalizeUuid", () => {
  it("expands 16-bit and 32-bit short forms onto the SIG base UUID", () => {
    expect(normalizeUuid("FFF0")).toBe(FULL_FFF0);
    expect(normalizeUuid("0000FFF0")).toBe(FULL_FFF0);
  });

  it("lower-cases 128-bit UUIDs and tolerates blanks", () => {
    expect(normalizeUuid("0000FFF0-0000-1000-8000-00805F9B34FB")).toBe(FULL_FFF0);
    expect(normalizeUuid("")).toBe("");
    expect(normalizeUuid(null)).toBe("");
  });

  it("treats the spellings as equal, but never two blanks", () => {
    expect(sameUuid("fff0", "0000FFF0-0000-1000-8000-00805F9B34FB")).toBe(true);
    expect(sameUuid("fff0", "fff1")).toBe(false);
    expect(sameUuid("", "")).toBe(false);
  });
});

describe("isLikelyElmName", () => {
  it("matches the known ELM327 dongle name hints, case-insensitively", () => {
    expect(isLikelyElmName("OBDII")).toBe(true);
    expect(isLikelyElmName("Vgate iCar Pro")).toBe(true);
    expect(isLikelyElmName("IOS-Vlink")).toBe(true);
  });

  it("ignores unrelated peripherals", () => {
    expect(isLikelyElmName("Fitbit Charge")).toBe(false);
    expect(isLikelyElmName("")).toBe(false);
    expect(isLikelyElmName(null)).toBe(false);
  });
});

describe("matchesElmAdvertisement", () => {
  it("accepts a matching name or local name", () => {
    expect(matchesElmAdvertisement({ name: "OBDII" })).toBe(true);
    expect(matchesElmAdvertisement({ name: null, localName: "ELM327-BLE" })).toBe(true);
  });

  it("accepts a nameless peripheral advertising a known serial service", () => {
    expect(
      matchesElmAdvertisement({ name: null, serviceUUIDs: ["FFF0"] }),
    ).toBe(true);
    expect(
      matchesElmAdvertisement({
        name: null,
        serviceUUIDs: ["6E400001-B5A3-F393-E0A9-E50E24DCCA9E"],
      }),
    ).toBe(true);
  });

  it("rejects everything else so a busy scan stays quiet", () => {
    expect(matchesElmAdvertisement({ name: "Galaxy Buds", serviceUUIDs: ["180A"] })).toBe(
      false,
    );
    expect(matchesElmAdvertisement({ name: null, serviceUUIDs: [] })).toBe(false);
    expect(matchesElmAdvertisement(null)).toBe(false);
  });
});

describe("resolveBleProfile", () => {
  const fff0: BleServiceLike = {
    uuid: FULL_FFF0,
    characteristics: [
      { uuid: "0000fff1-0000-1000-8000-00805f9b34fb", isNotifiable: true },
      {
        uuid: "0000fff2-0000-1000-8000-00805f9b34fb",
        isWritableWithResponse: true,
      },
    ],
  };

  it("picks the ELM327 FFF0 profile", () => {
    expect(resolveBleProfile([fff0])).toEqual({
      label: "ELM327 (FFF0)",
      serviceUuid: FULL_FFF0,
      writeUuid: "0000fff2-0000-1000-8000-00805f9b34fb",
      notifyUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
      writeWithResponse: true,
    });
  });

  it("handles HM-10 modules where one characteristic does both", () => {
    const resolved = resolveBleProfile([
      {
        uuid: "FFE0",
        characteristics: [
          { uuid: "FFE1", isWritableWithoutResponse: true, isNotifiable: true },
        ],
      },
    ]);
    expect(resolved?.label).toBe("HM-10 serial (FFE0)");
    expect(resolved?.writeUuid).toBe("FFE1");
    expect(resolved?.notifyUuid).toBe("FFE1");
    // Write-without-response only — writing with response would fail on device.
    expect(resolved?.writeWithResponse).toBe(false);
  });

  it("prefers a known profile over an earlier unknown service", () => {
    const resolved = resolveBleProfile([
      {
        uuid: "0000abcd-0000-1000-8000-00805f9b34fb",
        characteristics: [
          { uuid: "0000abce-0000-1000-8000-00805f9b34fb", isWritableWithResponse: true, isNotifiable: true },
        ],
      },
      fff0,
    ]);
    expect(resolved?.label).toBe("ELM327 (FFF0)");
  });

  it("falls back to any writable + notifiable pair on uncatalogued clones", () => {
    const resolved = resolveBleProfile([
      { uuid: "1800", characteristics: [{ uuid: "2a00", isWritableWithResponse: true }] },
      {
        uuid: "0000a002-0000-1000-8000-00805f9b34fb",
        characteristics: [
          { uuid: "0000c304-0000-1000-8000-00805f9b34fb", isNotifiable: true },
          { uuid: "0000c305-0000-1000-8000-00805f9b34fb", isWritableWithoutResponse: true },
        ],
      },
    ]);
    expect(resolved).toEqual({
      label: "Generic serial",
      serviceUuid: "0000a002-0000-1000-8000-00805f9b34fb",
      writeUuid: "0000c305-0000-1000-8000-00805f9b34fb",
      notifyUuid: "0000c304-0000-1000-8000-00805f9b34fb",
      writeWithResponse: false,
    });
  });

  it("returns null when nothing on the peripheral can carry a serial stream", () => {
    expect(resolveBleProfile([])).toBeNull();
    expect(resolveBleProfile(null)).toBeNull();
    expect(
      resolveBleProfile([
        { uuid: "180a", characteristics: [{ uuid: "2a29", isNotifiable: true }] },
      ]),
    ).toBeNull();
  });
});

describe("describeBleAvailability", () => {
  it("is available once the module and its native side are both present", () => {
    expect(
      describeBleAvailability({
        moduleInstalled: true,
        nativeModuleLinked: true,
        platform: "ios",
      }),
    ).toEqual({ available: true });
  });

  it("distinguishes Expo Go from a build without the dependency", () => {
    expect(
      describeBleAvailability({
        moduleInstalled: true,
        nativeModuleLinked: false,
        platform: "android",
      }),
    ).toEqual({
      available: false,
      reason: "needs a development or production build (not available in Expo Go)",
    });
    expect(
      describeBleAvailability({
        moduleInstalled: false,
        nativeModuleLinked: false,
        platform: "android",
      }),
    ).toEqual({ available: false, reason: "react-native-ble-plx not installed" });
  });

  it("reports web as unsupported regardless of what resolved", () => {
    expect(
      describeBleAvailability({
        moduleInstalled: true,
        nativeModuleLinked: true,
        platform: "web",
      }),
    ).toEqual({ available: false, reason: "not supported on web" });
  });
});
