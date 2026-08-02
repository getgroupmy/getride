/**
 * Extended OBD-II mode-01 parameter catalog.
 *
 * `OBD_PIDS` (obd.ts) is deliberately small — it is the set the 1 Hz telemetry
 * poll sweeps on every tick, so adding to it slows the taxi meter and the
 * System Status panel down. This catalog is the *other* half: every mode-01
 * parameter the Vehicle Information screen knows how to decode, read once on
 * demand rather than continuously.
 *
 * Everything here is pure lookup/arithmetic so it can be unit-tested without a
 * device — see utils/__tests__/vehicleInfo.test.ts.
 *
 * A vehicle only answers the PIDs it actually implements, and which ones those
 * are is discovered at runtime from the support bitmasks (see
 * `parseSupportedPids` in vehicleInfo.ts). Anything a car reports as supported
 * but that is missing from this catalog is still shown by the screen, as raw
 * bytes — the catalog decides what gets a *label and a unit*, not what gets
 * read.
 */

/** Sections the Vehicle Information screen groups readings under. */
export type PidGroup =
  | "engine"
  | "fuel"
  | "air"
  | "emissions"
  | "electrical"
  | "vehicle"
  | "hybrid"
  | "other";

export const PID_GROUP_LABEL: Record<PidGroup, string> = {
  engine: "Engine",
  fuel: "Fuel system",
  air: "Air & intake",
  emissions: "Emissions",
  electrical: "Electrical",
  vehicle: "Vehicle",
  hybrid: "Hybrid / EV",
  // Supported by the car, but not in this catalog — shown as raw bytes so the
  // screen still reports everything the reader can actually read.
  other: "Other parameters",
};

/** Order the groups render in. */
export const PID_GROUP_ORDER: PidGroup[] = [
  "engine",
  "vehicle",
  "fuel",
  "air",
  "emissions",
  "electrical",
  "hybrid",
  "other",
];

/**
 * One decodable mode-01 parameter.
 *
 * Exactly one of `decode` (engineering number) and `decodeText` (enumerated or
 * bit-field value that has no meaningful number) is set.
 */
export interface CatalogPid {
  /** Two-hex-digit PID within mode 01, e.g. "0C". Always upper case. */
  pid: string;
  label: string;
  /** Display unit, or "" for enumerated/text parameters. */
  unit: string;
  /** Number of data bytes expected after the "41 <pid>" header. */
  bytes: number;
  group: PidGroup;
  /** Decimal places to render for a numeric value. */
  precision?: number;
  decode?: (data: number[]) => number;
  decodeText?: (data: number[]) => string;
}

/** Signed percentage used by the fuel-trim PIDs: -100 % … +99.2 %. */
const trimPercent = ([a]: number[]) => (a - 128) * (100 / 128);

/** Unsigned percentage used by throttle/load/level PIDs: 0 % … 100 %. */
const bytePercent = ([a]: number[]) => (a * 100) / 255;

/** Temperature PIDs share a -40 °C offset. */
const tempC = ([a]: number[]) => a - 40;

const word = (a: number, b: number) => a * 256 + b;

const FUEL_SYSTEM_STATUS: Record<number, string> = {
  0: "Off",
  1: "Open loop — engine not warm",
  2: "Closed loop — using O2 sensor feedback",
  4: "Open loop — load or deceleration",
  8: "Open loop — system fault",
  16: "Closed loop — one O2 sensor faulty",
};

const SECONDARY_AIR_STATUS: Record<number, string> = {
  1: "Upstream",
  2: "Downstream of catalyst",
  4: "From outside atmosphere / off",
  8: "Pump commanded on for diagnostics",
};

const OBD_STANDARDS: Record<number, string> = {
  1: "OBD-II (California ARB)",
  2: "OBD (Federal EPA)",
  3: "OBD and OBD-II",
  4: "OBD-I",
  5: "Not OBD compliant",
  6: "EOBD (Europe)",
  7: "EOBD and OBD-II",
  8: "EOBD and OBD",
  9: "EOBD, OBD and OBD-II",
  10: "JOBD (Japan)",
  11: "JOBD and OBD-II",
  12: "JOBD and EOBD",
  13: "JOBD, EOBD and OBD-II",
  17: "Engine Manufacturer Diagnostics (EMD)",
  18: "EMD Enhanced (EMD+)",
  19: "Heavy Duty OBD (child/partial) (HD OBD-C)",
  20: "Heavy Duty OBD (HD OBD)",
  21: "World Wide Harmonised OBD (WWH OBD)",
  23: "Heavy Duty EOBD stage I without NOx control",
  24: "Heavy Duty EOBD stage I with NOx control",
  25: "Heavy Duty EOBD stage II without NOx control",
  26: "Heavy Duty EOBD stage II with NOx control",
  28: "Brazil OBD phase 1 (OBDBr-1)",
  29: "Brazil OBD phase 2 (OBDBr-2)",
  30: "Korean OBD (KOBD)",
  31: "India OBD I (IOBD I)",
  32: "India OBD II (IOBD II)",
  33: "Heavy Duty EOBD stage VI",
};

const FUEL_TYPES: Record<number, string> = {
  0: "Not available",
  1: "Petrol",
  2: "Methanol",
  3: "Ethanol",
  4: "Diesel",
  5: "LPG",
  6: "CNG",
  7: "Propane",
  8: "Electric",
  9: "Bifuel — petrol",
  10: "Bifuel — methanol",
  11: "Bifuel — ethanol",
  12: "Bifuel — LPG",
  13: "Bifuel — CNG",
  14: "Bifuel — propane",
  15: "Bifuel — electric",
  16: "Bifuel — electric and combustion",
  17: "Hybrid petrol",
  18: "Hybrid ethanol",
  19: "Hybrid diesel",
  20: "Hybrid electric",
  21: "Hybrid — electric and combustion",
  22: "Hybrid regenerative",
  23: "Bifuel — diesel",
};

function enumLabel(table: Record<number, string>, value: number): string {
  return table[value] ?? `Unknown (0x${value.toString(16).toUpperCase()})`;
}

/** One O2 sensor voltage entry — PIDs 14…1B share a decode. */
function o2Sensor(pid: string, index: number): CatalogPid {
  return {
    pid,
    label: `O2 sensor ${index} voltage`,
    unit: "V",
    bytes: 2,
    group: "emissions",
    precision: 3,
    decode: ([a]) => a / 200,
  };
}

/** One catalyst temperature entry — PIDs 3C…3F share a decode. */
function catalystTemp(pid: string, label: string): CatalogPid {
  return {
    pid,
    label,
    unit: "°C",
    bytes: 2,
    group: "emissions",
    precision: 1,
    decode: ([a, b]) => word(a, b) / 10 - 40,
  };
}

/**
 * Every mode-01 PID this app can decode, keyed by PID.
 *
 * PID 00/20/40/… (the support bitmasks) and PID 01/41 (monitor status) are
 * handled separately in vehicleInfo.ts — they are structure, not readings.
 */
export const PID_CATALOG: Record<string, CatalogPid> = {
  "03": {
    pid: "03",
    label: "Fuel system status",
    unit: "",
    bytes: 2,
    group: "fuel",
    decodeText: ([a]) => enumLabel(FUEL_SYSTEM_STATUS, a),
  },
  "04": {
    pid: "04",
    label: "Calculated engine load",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "05": {
    pid: "05",
    label: "Engine coolant temperature",
    unit: "°C",
    bytes: 1,
    group: "engine",
    decode: tempC,
  },
  "06": {
    pid: "06",
    label: "Short term fuel trim — bank 1",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: trimPercent,
  },
  "07": {
    pid: "07",
    label: "Long term fuel trim — bank 1",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: trimPercent,
  },
  "08": {
    pid: "08",
    label: "Short term fuel trim — bank 2",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: trimPercent,
  },
  "09": {
    pid: "09",
    label: "Long term fuel trim — bank 2",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: trimPercent,
  },
  "0A": {
    pid: "0A",
    label: "Fuel pressure",
    unit: "kPa",
    bytes: 1,
    group: "fuel",
    decode: ([a]) => a * 3,
  },
  "0B": {
    pid: "0B",
    label: "Intake manifold pressure",
    unit: "kPa",
    bytes: 1,
    group: "air",
    decode: ([a]) => a,
  },
  "0C": {
    pid: "0C",
    label: "Engine speed",
    unit: "rpm",
    bytes: 2,
    group: "engine",
    decode: ([a, b]) => word(a, b) / 4,
  },
  "0D": {
    pid: "0D",
    label: "Vehicle speed",
    unit: "km/h",
    bytes: 1,
    group: "vehicle",
    decode: ([a]) => a,
  },
  "0E": {
    pid: "0E",
    label: "Timing advance",
    unit: "° before TDC",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: ([a]) => a / 2 - 64,
  },
  "0F": {
    pid: "0F",
    label: "Intake air temperature",
    unit: "°C",
    bytes: 1,
    group: "air",
    decode: tempC,
  },
  "10": {
    pid: "10",
    label: "Mass air flow rate",
    unit: "g/s",
    bytes: 2,
    group: "air",
    precision: 2,
    decode: ([a, b]) => word(a, b) / 100,
  },
  "11": {
    pid: "11",
    label: "Throttle position",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "12": {
    pid: "12",
    label: "Commanded secondary air status",
    unit: "",
    bytes: 1,
    group: "emissions",
    decodeText: ([a]) => enumLabel(SECONDARY_AIR_STATUS, a),
  },
  "14": o2Sensor("14", 1),
  "15": o2Sensor("15", 2),
  "16": o2Sensor("16", 3),
  "17": o2Sensor("17", 4),
  "18": o2Sensor("18", 5),
  "19": o2Sensor("19", 6),
  "1A": o2Sensor("1A", 7),
  "1B": o2Sensor("1B", 8),
  "1C": {
    pid: "1C",
    label: "OBD standard",
    unit: "",
    bytes: 1,
    group: "vehicle",
    decodeText: ([a]) => enumLabel(OBD_STANDARDS, a),
  },
  "1E": {
    pid: "1E",
    label: "Auxiliary input status",
    unit: "",
    bytes: 1,
    group: "vehicle",
    decodeText: ([a]) => ((a & 0x01) === 1 ? "Power take-off active" : "Inactive"),
  },
  "1F": {
    pid: "1F",
    label: "Run time since engine start",
    unit: "s",
    bytes: 2,
    group: "engine",
    decode: ([a, b]) => word(a, b),
  },
  "21": {
    pid: "21",
    label: "Distance travelled with MIL on",
    unit: "km",
    bytes: 2,
    group: "emissions",
    decode: ([a, b]) => word(a, b),
  },
  "22": {
    pid: "22",
    label: "Fuel rail pressure (vs. manifold vacuum)",
    unit: "kPa",
    bytes: 2,
    group: "fuel",
    precision: 1,
    decode: ([a, b]) => word(a, b) * 0.079,
  },
  "23": {
    pid: "23",
    label: "Fuel rail gauge pressure",
    unit: "kPa",
    bytes: 2,
    group: "fuel",
    decode: ([a, b]) => word(a, b) * 10,
  },
  "2C": {
    pid: "2C",
    label: "Commanded EGR",
    unit: "%",
    bytes: 1,
    group: "emissions",
    precision: 1,
    decode: bytePercent,
  },
  "2D": {
    pid: "2D",
    label: "EGR error",
    unit: "%",
    bytes: 1,
    group: "emissions",
    precision: 1,
    decode: trimPercent,
  },
  "2E": {
    pid: "2E",
    label: "Commanded evaporative purge",
    unit: "%",
    bytes: 1,
    group: "emissions",
    precision: 1,
    decode: bytePercent,
  },
  "2F": {
    pid: "2F",
    label: "Fuel tank level",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: bytePercent,
  },
  "30": {
    pid: "30",
    label: "Warm-ups since codes cleared",
    unit: "",
    bytes: 1,
    group: "emissions",
    decode: ([a]) => a,
  },
  "31": {
    pid: "31",
    label: "Distance since codes cleared",
    unit: "km",
    bytes: 2,
    group: "emissions",
    decode: ([a, b]) => word(a, b),
  },
  "32": {
    pid: "32",
    label: "Evap system vapour pressure",
    unit: "Pa",
    bytes: 2,
    group: "emissions",
    precision: 2,
    // Signed 16-bit, quarter-Pa resolution.
    decode: ([a, b]) => {
      const raw = word(a, b);
      return (raw > 0x7fff ? raw - 0x10000 : raw) / 4;
    },
  },
  "33": {
    pid: "33",
    label: "Absolute barometric pressure",
    unit: "kPa",
    bytes: 1,
    group: "air",
    decode: ([a]) => a,
  },
  "3C": catalystTemp("3C", "Catalyst temperature — bank 1, sensor 1"),
  "3D": catalystTemp("3D", "Catalyst temperature — bank 2, sensor 1"),
  "3E": catalystTemp("3E", "Catalyst temperature — bank 1, sensor 2"),
  "3F": catalystTemp("3F", "Catalyst temperature — bank 2, sensor 2"),
  "42": {
    pid: "42",
    label: "Control module voltage",
    unit: "V",
    bytes: 2,
    group: "electrical",
    precision: 3,
    decode: ([a, b]) => word(a, b) / 1000,
  },
  "43": {
    pid: "43",
    label: "Absolute load value",
    unit: "%",
    bytes: 2,
    group: "engine",
    precision: 1,
    decode: ([a, b]) => (word(a, b) * 100) / 255,
  },
  "44": {
    pid: "44",
    label: "Commanded air-fuel equivalence ratio (λ)",
    unit: "",
    bytes: 2,
    group: "fuel",
    precision: 3,
    decode: ([a, b]) => (2 / 65536) * word(a, b),
  },
  "45": {
    pid: "45",
    label: "Relative throttle position",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "46": {
    pid: "46",
    label: "Ambient air temperature",
    unit: "°C",
    bytes: 1,
    group: "air",
    decode: tempC,
  },
  "47": {
    pid: "47",
    label: "Absolute throttle position B",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "48": {
    pid: "48",
    label: "Absolute throttle position C",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "49": {
    pid: "49",
    label: "Accelerator pedal position D",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "4A": {
    pid: "4A",
    label: "Accelerator pedal position E",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "4B": {
    pid: "4B",
    label: "Accelerator pedal position F",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "4C": {
    pid: "4C",
    label: "Commanded throttle actuator",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "4D": {
    pid: "4D",
    label: "Time run with MIL on",
    unit: "min",
    bytes: 2,
    group: "emissions",
    decode: ([a, b]) => word(a, b),
  },
  "4E": {
    pid: "4E",
    label: "Time since codes cleared",
    unit: "min",
    bytes: 2,
    group: "emissions",
    decode: ([a, b]) => word(a, b),
  },
  "51": {
    pid: "51",
    label: "Fuel type",
    unit: "",
    bytes: 1,
    group: "fuel",
    decodeText: ([a]) => enumLabel(FUEL_TYPES, a),
  },
  "52": {
    pid: "52",
    label: "Ethanol fuel content",
    unit: "%",
    bytes: 1,
    group: "fuel",
    precision: 1,
    decode: bytePercent,
  },
  "53": {
    pid: "53",
    label: "Absolute evap system vapour pressure",
    unit: "kPa",
    bytes: 2,
    group: "emissions",
    precision: 3,
    decode: ([a, b]) => word(a, b) / 200,
  },
  "59": {
    pid: "59",
    label: "Fuel rail absolute pressure",
    unit: "kPa",
    bytes: 2,
    group: "fuel",
    decode: ([a, b]) => word(a, b) * 10,
  },
  "5A": {
    pid: "5A",
    label: "Relative accelerator pedal position",
    unit: "%",
    bytes: 1,
    group: "engine",
    precision: 1,
    decode: bytePercent,
  },
  "5B": {
    pid: "5B",
    label: "Hybrid battery pack remaining life",
    unit: "%",
    bytes: 1,
    group: "hybrid",
    precision: 1,
    decode: bytePercent,
  },
  "5C": {
    pid: "5C",
    label: "Engine oil temperature",
    unit: "°C",
    bytes: 1,
    group: "engine",
    decode: tempC,
  },
  "5D": {
    pid: "5D",
    label: "Fuel injection timing",
    unit: "°",
    bytes: 2,
    group: "fuel",
    precision: 2,
    decode: ([a, b]) => word(a, b) / 128 - 210,
  },
  "5E": {
    pid: "5E",
    label: "Engine fuel rate",
    unit: "L/h",
    bytes: 2,
    group: "fuel",
    precision: 2,
    decode: ([a, b]) => word(a, b) / 20,
  },
  "61": {
    pid: "61",
    label: "Driver's demand engine torque",
    unit: "%",
    bytes: 1,
    group: "engine",
    decode: ([a]) => a - 125,
  },
  "62": {
    pid: "62",
    label: "Actual engine torque",
    unit: "%",
    bytes: 1,
    group: "engine",
    decode: ([a]) => a - 125,
  },
  "63": {
    pid: "63",
    label: "Engine reference torque",
    unit: "N·m",
    bytes: 2,
    group: "engine",
    decode: ([a, b]) => word(a, b),
  },
  "9D": {
    pid: "9D",
    label: "Engine fuel rate (mass)",
    unit: "g/s",
    bytes: 4,
    group: "fuel",
    precision: 2,
    decode: ([a, b]) => word(a, b) / 32,
  },
  "9E": {
    pid: "9E",
    label: "Engine exhaust flow rate",
    unit: "kg/h",
    bytes: 2,
    group: "air",
    precision: 1,
    decode: ([a, b]) => word(a, b) / 5,
  },
  A6: {
    pid: "A6",
    label: "Odometer",
    unit: "km",
    bytes: 4,
    group: "vehicle",
    precision: 1,
    decode: ([a, b, c, d]) => (a * 2 ** 24 + b * 2 ** 16 + c * 256 + d) / 10,
  },
};

/** Look a PID up in the catalog, case-insensitively. */
export function catalogPid(pid: string): CatalogPid | null {
  return PID_CATALOG[pid.trim().toUpperCase()] ?? null;
}

/**
 * Render a decoded catalog reading for display, e.g. `13.842 V`, `Petrol`.
 * Enumerated parameters carry no unit, so they render as the bare label.
 */
export function formatCatalogValue(pid: CatalogPid, data: number[]): string | null {
  if (pid.decodeText) {
    const text = pid.decodeText(data);
    return text || null;
  }
  if (!pid.decode) return null;
  const value = pid.decode(data);
  if (!Number.isFinite(value)) return null;
  const rendered = value.toFixed(pid.precision ?? 0);
  return pid.unit ? `${rendered} ${pid.unit}` : rendered;
}

/** Raw fallback rendering for a PID the catalog does not know, e.g. "1A F8". */
export function formatRawBytes(data: number[]): string {
  return data
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}
