import {
  DTC_MODES,
  MODE_09_ITEMS,
  VEHICLE_WRITE_ACTIONS,
  decodeDtc,
  decodeVin,
  describeDtc,
  elmPayloads,
  evaluateWriteAvailability,
  extractFrameBytes,
  findWriteAction,
  hexToBytes,
  isLikelyVin,
  isWriteAcknowledged,
  nextSupportRange,
  parseAtText,
  parseDtcResponse,
  parseMode09Ascii,
  parseMode09Hex,
  parseMonitorStatus,
  parseMonitorStatusResponse,
  parseSupportedPids,
  validateRawCommand,
} from "@/utils/canbus/vehicleInfo";
import {
  PID_CATALOG,
  catalogPid,
  formatCatalogValue,
  formatRawBytes,
} from "@/utils/canbus/pidCatalog";

describe("elmPayloads", () => {
  it("returns one payload per single-frame line", () => {
    expect(elmPayloads("41 00 BE 1F A8 13\r>")).toEqual(["4100BE1FA813"]);
  });

  it("keeps one payload per responding ECU", () => {
    expect(elmPayloads("410C1AF8\r410C1B00\r>")).toEqual(["410C1AF8", "410C1B00"]);
  });

  it("re-joins an ISO-TP multi-frame block and drops its length header", () => {
    const raw = "014\r0:490201314A\r1:4D3448\r>";
    expect(elmPayloads(raw)).toEqual(["490201314A4D3448"]);
  });

  it("drops SEARCHING and other non-hex noise", () => {
    expect(elmPayloads("SEARCHING...\r410D3C\r>")).toEqual(["410D3C"]);
  });
});

describe("hexToBytes", () => {
  it("parses whole bytes", () => {
    expect(hexToBytes("1AF8")).toEqual([0x1a, 0xf8]);
  });

  it("rejects an odd number of digits and non-hex", () => {
    expect(hexToBytes("1AF")).toBeNull();
    expect(hexToBytes("1AZZ")).toBeNull();
    expect(hexToBytes("")).toBeNull();
  });
});

describe("extractFrameBytes", () => {
  it("reads the bytes after a mode-01 header", () => {
    expect(extractFrameBytes("410C1AF8\r>", "410C", 2)).toEqual([0x1a, 0xf8]);
  });

  it("returns every remaining byte when no count is given", () => {
    expect(extractFrameBytes("4902013144\r>", "4902")).toEqual([0x01, 0x31, 0x44]);
  });

  it("rejects a frame that is shorter than the requested byte count", () => {
    expect(extractFrameBytes("410C1A\r>", "410C", 2)).toBeNull();
  });

  it("returns null for an error reply", () => {
    expect(extractFrameBytes("NO DATA\r>", "410C", 2)).toBeNull();
  });
});

describe("parseSupportedPids", () => {
  // BE 1F A8 13 is the mask most petrol cars answer 0100 with.
  const raw = "41 00 BE 1F A8 13\r>";

  it("decodes the bitmask into PID numbers", () => {
    const range = parseSupportedPids(raw, "00");
    expect(range?.base).toBe("00");
    expect(range?.pids).toEqual([
      "01",
      "03",
      "04",
      "05",
      "06",
      "07",
      "0C",
      "0D",
      "0E",
      "0F",
      "10",
      "11",
      "13",
      "15",
      "1C",
      "1F",
      "20",
    ]);
  });

  it("reads the last bit as 'the next range is supported'", () => {
    expect(parseSupportedPids(raw, "00")?.nextRangeSupported).toBe(true);
    expect(parseSupportedPids("4100BE1FA812\r>", "00")?.nextRangeSupported).toBe(false);
  });

  it("offsets PID numbers by the probe's base", () => {
    // Only the very first bit set: base 0x20 + 1 = PID 21.
    expect(parseSupportedPids("412080000000\r>", "20")?.pids).toEqual(["21"]);
  });

  it("reads a mode-09 support mask when told the response mode", () => {
    expect(parseSupportedPids("4900540000 00\r>", "00", "49")?.pids).toEqual([
      "02",
      "04",
      "06",
    ]);
  });

  it("returns null when the frame is missing", () => {
    expect(parseSupportedPids("NO DATA\r>", "00")).toBeNull();
  });
});

describe("nextSupportRange", () => {
  it("advances to the next probe when the mask says so", () => {
    expect(nextSupportRange("00", { base: "00", pids: [], nextRangeSupported: true })).toBe(
      "20",
    );
  });

  it("stops when the mask says the next range is unsupported", () => {
    expect(
      nextSupportRange("00", { base: "00", pids: [], nextRangeSupported: false }),
    ).toBeNull();
  });

  it("stops at the end of the probe table", () => {
    expect(
      nextSupportRange("E0", { base: "E0", pids: [], nextRangeSupported: true }),
    ).toBeNull();
  });

  it("stops on a failed probe", () => {
    expect(nextSupportRange("00", null)).toBeNull();
  });
});

describe("mode 09 identity", () => {
  // "1D4GP00R55B123456" across three ISO-TP frames, with the leading 0x01
  // message-count byte CAN vehicles prefix.
  const vinRaw =
    "014\r0:49020131443447\r1:5030305235354231\r2:3233343536\r>";

  it("decodes a multi-frame VIN", () => {
    expect(parseMode09Ascii(vinRaw, "02")).toBe("1D4GP00R55B123456");
  });

  it("decodes a single-frame ASCII reply without a count byte", () => {
    expect(parseMode09Ascii("4904 41 42 43\r>", "04")).toBe("ABC");
  });

  it("strips NUL and 0xFF padding", () => {
    expect(parseMode09Ascii("490A014142430000\r>", "0A")).toBe("ABC");
  });

  it("renders the CVN as hex rather than mangled text", () => {
    expect(parseMode09Hex("4906 01 02 03 04\r>", "06")).toBe("01 02 03 04");
  });

  it("returns null when nothing was answered", () => {
    expect(parseMode09Ascii("NO DATA\r>", "02")).toBeNull();
  });

  it("lists the VIN first so the header can use it", () => {
    expect(MODE_09_ITEMS[0].key).toBe("vin");
  });
});

describe("VIN validation and decoding", () => {
  it("accepts a well-formed VIN and rejects the ambiguous letters", () => {
    expect(isLikelyVin("1D4GP00R55B123456")).toBe(true);
    expect(isLikelyVin("1D4GP00R55B12345I")).toBe(false);
    expect(isLikelyVin("SHORT")).toBe(false);
    expect(isLikelyVin(null)).toBe(false);
  });

  it("splits a VIN into its ISO 3779 fields", () => {
    const details = decodeVin("1D4GP00R55B123456", new Date("2026-08-02T00:00:00Z"));
    expect(details?.wmi).toBe("1D4");
    expect(details?.vds).toBe("GP00R5");
    expect(details?.plantCode).toBe("B");
    expect(details?.serial).toBe("123456");
  });

  it("offers both candidate model years for a repeating year code", () => {
    // Position 10 is "5" → 2005, and the code repeats 30 years later.
    const details = decodeVin("1D4GP00R55B123456", new Date("2026-08-02T00:00:00Z"));
    expect(details?.modelYears).toEqual([2005]);
    // "A" is 1980, 2010 and 2040 — only the years up to next year are offered.
    const older = decodeVin("1D4GP00R5AB123456", new Date("2026-08-02T00:00:00Z"));
    expect(older?.modelYears).toEqual([1980, 2010]);
  });

  it("names the assembly region for a known manufacturer prefix", () => {
    expect(decodeVin("PM2ABC1234D567890")?.region).toBe("Malaysia");
    expect(decodeVin("9XX1234567D567890")?.region).toBeNull();
  });

  it("refuses to decode a partial read", () => {
    expect(decodeVin("1D4GP00R55B")).toBeNull();
    expect(decodeVin(null)).toBeNull();
  });
});

describe("diagnostic trouble codes", () => {
  it("decodes the system letter and digits", () => {
    expect(decodeDtc(0x01, 0x33)).toBe("P0133");
    expect(decodeDtc(0x43, 0x21)).toBe("C0321");
    expect(decodeDtc(0x84, 0x56)).toBe("B0456");
    expect(decodeDtc(0xc1, 0x00)).toBe("U0100");
  });

  it("treats a zero pair as padding, not a code", () => {
    expect(decodeDtc(0x00, 0x00)).toBeNull();
  });

  it("skips the CAN count byte", () => {
    // 43 02 <P0133> <P0420>
    expect(parseDtcResponse("4302013304 20\r>", "43")).toEqual(["P0133", "P0420"]);
  });

  it("reads a non-CAN reply that has no count byte", () => {
    expect(parseDtcResponse("43 01 33 00 00 00 00\r>", "43")).toEqual(["P0133"]);
  });

  it("reports an empty list when the vehicle has no codes", () => {
    expect(parseDtcResponse("4300\r>", "43")).toEqual([]);
    expect(parseDtcResponse("NO DATA\r>", "43")).toEqual([]);
  });

  it("de-duplicates codes reported by more than one ECU", () => {
    expect(parseDtcResponse("43010133\r43010133\r>", "43")).toEqual(["P0133"]);
  });

  it("reads the pending and permanent stores from their own headers", () => {
    expect(parseDtcResponse("4701 0133\r>", "47")).toEqual(["P0133"]);
    expect(parseDtcResponse("4A010133\r>", "4A")).toEqual(["P0133"]);
    expect(DTC_MODES.map((m) => m.mode)).toEqual(["03", "07", "0A"]);
  });

  it("returns null when the reply could not be parsed at all", () => {
    expect(parseDtcResponse("CAN ERROR\r>", "43")).toBeNull();
  });

  it("describes the family a code belongs to without inventing a diagnosis", () => {
    expect(describeDtc("P0133")).toContain("Powertrain");
    expect(describeDtc("P0133")).toContain("generic");
    expect(describeDtc("P1133")).toContain("manufacturer-specific");
    expect(describeDtc("U0100")).toContain("Network");
  });
});

describe("readiness monitors", () => {
  // MIL on with 3 codes; misfire/fuel/components supported and complete;
  // catalyst + O2 sensor supported, catalyst incomplete.
  const bytes = [0x83, 0x07, 0x21, 0x01];

  it("reads the MIL flag and the stored-fault count", () => {
    const status = parseMonitorStatus(bytes);
    expect(status?.milOn).toBe(true);
    expect(status?.dtcCount).toBe(3);
  });

  it("marks a continuous monitor complete when its incomplete bit is clear", () => {
    const status = parseMonitorStatus(bytes);
    const misfire = status?.monitors.find((m) => m.key === "misfire");
    expect(misfire).toEqual({
      key: "misfire",
      label: "Misfire",
      supported: true,
      complete: true,
    });
  });

  it("separates supported from complete for the non-continuous monitors", () => {
    const status = parseMonitorStatus(bytes);
    expect(status?.monitors.find((m) => m.key === "catalyst")).toMatchObject({
      supported: true,
      complete: false,
    });
    expect(status?.monitors.find((m) => m.key === "oxygenSensor")).toMatchObject({
      supported: true,
      complete: true,
    });
  });

  it("switches to the diesel monitor set when the compression flag is set", () => {
    const status = parseMonitorStatus([0x00, 0x0f, 0x03, 0x00]);
    expect(status?.compressionIgnition).toBe(true);
    expect(status?.monitors.map((m) => m.key)).toContain("pmFilter");
    expect(status?.monitors.map((m) => m.key)).not.toContain("catalyst");
  });

  it("rejects a truncated frame", () => {
    expect(parseMonitorStatus([0x83, 0x07])).toBeNull();
  });

  it("reads the frame straight out of a raw reply", () => {
    expect(parseMonitorStatusResponse("41 01 83 07 21 01\r>")?.dtcCount).toBe(3);
    expect(parseMonitorStatusResponse("NO DATA\r>")).toBeNull();
  });
});

describe("parseAtText", () => {
  it("keeps the adapter's own spacing and case", () => {
    expect(parseAtText("ELM327 v1.5\r\r>")).toBe("ELM327 v1.5");
    expect(parseAtText("12.5V\r>")).toBe("12.5V");
  });

  it("ignores a bare OK acknowledgement", () => {
    expect(parseAtText("OK\r>")).toBeNull();
  });

  it("does not pass an error token off as a device description", () => {
    expect(parseAtText("NO DATA\r>")).toBeNull();
    expect(parseAtText("?\r>")).toBeNull();
  });
});

describe("write availability", () => {
  const clear = findWriteAction("clear-dtc")!;
  const reset = findWriteAction("reset-adapter")!;

  it("refuses every write with no link", () => {
    expect(evaluateWriteAvailability(clear, { online: false, simulated: false })).toEqual({
      allowed: false,
      reason: "Connect the OBD-II reader first.",
    });
  });

  it("refuses every write in Demo Mode", () => {
    const result = evaluateWriteAvailability(clear, { online: true, simulated: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Demo Mode");
  });

  it("refuses an ECU write while the vehicle is moving", () => {
    const result = evaluateWriteAvailability(clear, {
      online: true,
      simulated: false,
      speedKmh: 32,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Stop the vehicle");
  });

  it("still allows an adapter-only write while moving", () => {
    expect(
      evaluateWriteAvailability(reset, { online: true, simulated: false, speedKmh: 32 }),
    ).toEqual({ allowed: true });
  });

  it("allows a clear when the vehicle is stationary", () => {
    expect(
      evaluateWriteAvailability(clear, { online: true, simulated: false, speedKmh: 0 }),
    ).toEqual({ allowed: true });
  });

  it("treats an un-probed mode 04 as available but a refused one as blocked", () => {
    expect(
      evaluateWriteAvailability(clear, { online: true, simulated: false }).allowed,
    ).toBe(true);
    expect(
      evaluateWriteAvailability(clear, {
        online: true,
        simulated: false,
        supportsClearDtc: false,
      }).allowed,
    ).toBe(false);
  });

  it("gives every action a warning to show before it runs", () => {
    for (const action of VEHICLE_WRITE_ACTIONS) {
      expect(action.warningTitle.length).toBeGreaterThan(0);
      expect(action.warningBody.length).toBeGreaterThan(0);
      expect(action.confirmLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("validateRawCommand", () => {
  it("normalises spacing and case", () => {
    expect(validateRawCommand(" 01 0c ")).toMatchObject({
      ok: true,
      command: "010C",
      target: "vehicle",
      write: false,
    });
  });

  it("routes AT and ST commands to the adapter", () => {
    expect(validateRawCommand("atrv")).toMatchObject({ ok: true, target: "adapter" });
    expect(validateRawCommand("STDI")).toMatchObject({ ok: true, target: "adapter" });
  });

  it("flags the OBD-II services that write to the vehicle", () => {
    expect(validateRawCommand("04").write).toBe(true);
    expect(validateRawCommand("2F1234").write).toBe(true);
    expect(validateRawCommand("0100").write).toBe(false);
  });

  it("rejects an empty, over-long or non-alphanumeric command", () => {
    expect(validateRawCommand("").ok).toBe(false);
    expect(validateRawCommand("0".repeat(25)).ok).toBe(false);
    expect(validateRawCommand("01;0C").ok).toBe(false);
  });

  it("rejects a half-byte or non-hex vehicle request", () => {
    expect(validateRawCommand("010").ok).toBe(false);
    expect(validateRawCommand("ZZ01").ok).toBe(false);
  });
});

describe("isWriteAcknowledged", () => {
  it("accepts OK and the expected positive response", () => {
    expect(isWriteAcknowledged("OK\r>")).toBe(true);
    expect(isWriteAcknowledged("44\r>", "44")).toBe(true);
  });

  it("rejects an error reply or a mismatched header", () => {
    expect(isWriteAcknowledged("NO DATA\r>")).toBe(false);
    expect(isWriteAcknowledged("7F0412\r>", "44")).toBe(false);
    expect(isWriteAcknowledged("\r>")).toBe(false);
  });
});

describe("PID catalog", () => {
  it("decodes a numeric parameter with its unit and precision", () => {
    expect(formatCatalogValue(PID_CATALOG["42"], [0x36, 0x0a])).toBe("13.834 V");
    expect(formatCatalogValue(PID_CATALOG["05"], [0x7b])).toBe("83 °C");
  });

  it("decodes a signed fuel trim either side of zero", () => {
    expect(formatCatalogValue(PID_CATALOG["06"], [128])).toBe("0.0 %");
    expect(formatCatalogValue(PID_CATALOG["06"], [0])).toBe("-100.0 %");
  });

  it("renders an enumerated parameter as text, without a unit", () => {
    expect(formatCatalogValue(PID_CATALOG["51"], [4])).toBe("Diesel");
    expect(formatCatalogValue(PID_CATALOG["03"], [2, 0])).toContain("Closed loop");
  });

  it("names an unknown enumeration rather than guessing", () => {
    expect(formatCatalogValue(PID_CATALOG["51"], [0xee])).toBe("Unknown (0xEE)");
  });

  it("decodes the four-byte odometer", () => {
    expect(formatCatalogValue(PID_CATALOG.A6, [0x00, 0x01, 0x86, 0xa0])).toBe("10000.0 km");
  });

  it("looks PIDs up case-insensitively", () => {
    expect(catalogPid("a6")).toBe(PID_CATALOG.A6);
    expect(catalogPid("FF")).toBeNull();
  });

  it("renders raw bytes for a PID it does not know", () => {
    expect(formatRawBytes([0x1a, 0xf8, 0x00])).toBe("1A F8 00");
  });

  it("keys every entry by its own PID", () => {
    for (const [key, pid] of Object.entries(PID_CATALOG)) {
      expect(pid.pid).toBe(key);
      expect(pid.bytes).toBeGreaterThan(0);
      expect(!!pid.decode || !!pid.decodeText).toBe(true);
    }
  });
});
