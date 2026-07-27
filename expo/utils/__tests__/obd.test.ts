import {
  OBD_PIDS,
  buildPidCommand,
  cleanElmResponse,
  isElmError,
  isElmSearching,
  parsePidBytes,
  decodePidResponse,
  describeProtocol,
  formatTelemetryValue,
} from "@/utils/canbus/obd";

describe("buildPidCommand", () => {
  it("prefixes mode 01 and upper-cases the PID", () => {
    expect(buildPidCommand(OBD_PIDS.rpm)).toBe("010C");
    expect(buildPidCommand(OBD_PIDS.speed)).toBe("010D");
    expect(buildPidCommand(OBD_PIDS.moduleVoltage)).toBe("0142");
  });
});

describe("cleanElmResponse", () => {
  it("strips prompt, whitespace and blank lines, upper-cases", () => {
    expect(cleanElmResponse("41 0c 1a f8\r>")).toEqual(["410C1AF8"]);
  });

  it("splits multiple frames (multi-ECU responses)", () => {
    expect(cleanElmResponse("410C1AF8\r410C1B00\r>")).toEqual([
      "410C1AF8",
      "410C1B00",
    ]);
  });
});

describe("error / transient detection", () => {
  it("flags NO DATA, CAN ERROR and '?' as errors", () => {
    expect(isElmError("NO DATA\r>")).toBe(true);
    expect(isElmError("CAN ERROR\r>")).toBe(true);
    expect(isElmError("?\r>")).toBe(true);
  });

  it("does not flag a valid frame as an error", () => {
    expect(isElmError("410C1AF8\r>")).toBe(false);
  });

  it("detects the transient SEARCHING state", () => {
    expect(isElmSearching("SEARCHING...\r410D2A\r>")).toBe(true);
    expect(isElmSearching("410D2A\r>")).toBe(false);
  });
});

describe("parsePidBytes", () => {
  it("reads two data bytes for RPM", () => {
    expect(parsePidBytes("410C1AF8\r>", OBD_PIDS.rpm)).toEqual([0x1a, 0xf8]);
  });

  it("reads one data byte for speed and tolerates spaces", () => {
    expect(parsePidBytes("41 0D 3C\r>", OBD_PIDS.speed)).toEqual([0x3c]);
  });

  it("skips a leading SEARCHING... line", () => {
    expect(parsePidBytes("SEARCHING...\r410D3C\r>", OBD_PIDS.speed)).toEqual([
      0x3c,
    ]);
  });

  it("returns null on NO DATA", () => {
    expect(parsePidBytes("NO DATA\r>", OBD_PIDS.rpm)).toBeNull();
  });

  it("returns null when the header does not match the requested PID", () => {
    expect(parsePidBytes("410D3C\r>", OBD_PIDS.rpm)).toBeNull();
  });

  it("returns null when there are too few data bytes", () => {
    expect(parsePidBytes("410C1A\r>", OBD_PIDS.rpm)).toBeNull();
  });
});

describe("decodePidResponse", () => {
  it("decodes RPM: ((A*256)+B)/4", () => {
    // 0x1AF8 = 6904 -> /4 = 1726
    expect(decodePidResponse("410C1AF8\r>", OBD_PIDS.rpm)).toEqual({
      key: "rpm",
      label: "Engine RPM",
      unit: "rpm",
      value: 1726,
    });
  });

  it("decodes speed directly in km/h", () => {
    expect(decodePidResponse("410D3C\r>", OBD_PIDS.speed)?.value).toBe(60);
  });

  it("decodes coolant temp with the -40 offset", () => {
    // 0x5A = 90 -> 90 - 40 = 50
    expect(decodePidResponse("41055A\r>", OBD_PIDS.coolantTemp)?.value).toBe(50);
  });

  it("decodes module voltage in volts", () => {
    // 0x2EE0 = 12000 -> /1000 = 12.0
    expect(decodePidResponse("41422EE0\r>", OBD_PIDS.moduleVoltage)?.value).toBe(
      12,
    );
  });

  it("decodes fuel level as a percentage", () => {
    // 0xFF = 255 -> 100%
    expect(decodePidResponse("412FFF\r>", OBD_PIDS.fuelLevel)?.value).toBe(100);
  });

  it("returns null on an error reply", () => {
    expect(decodePidResponse("NO DATA\r>", OBD_PIDS.rpm)).toBeNull();
  });
});

describe("describeProtocol", () => {
  it("names CAN 11-bit/500k and reports its bitrate", () => {
    expect(describeProtocol("6")).toEqual({
      name: "ISO 15765-4 CAN (11-bit, 500 kbps)",
      bitrateKbps: 500,
    });
  });

  it("strips the automatic 'A' prefix from ATDPN", () => {
    expect(describeProtocol("A6").name).toBe(
      "ISO 15765-4 CAN (11-bit, 500 kbps)",
    );
    expect(describeProtocol("A6").bitrateKbps).toBe(500);
  });

  it("handles unknown / null protocols", () => {
    expect(describeProtocol(null)).toEqual({ name: "Unknown", bitrateKbps: null });
  });
});

describe("formatTelemetryValue", () => {
  it("rounds integers with their unit", () => {
    expect(formatTelemetryValue("rpm", 820.5)).toBe("821 rpm");
    expect(formatTelemetryValue("speed", 60)).toBe("60 km/h");
  });

  it("shows one decimal for voltage", () => {
    expect(formatTelemetryValue("moduleVoltage", 12.34)).toBe("12.3 V");
  });
});
