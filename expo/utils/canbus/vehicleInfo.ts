/**
 * Vehicle Information — the read/write protocol layer behind
 * `app/vehicle-information.tsx`.
 *
 * Where obd.ts covers the handful of mode-01 PIDs the live telemetry loop
 * polls, this module covers everything *else* an ELM327 can be asked for once:
 * which PIDs the car actually implements (mode 01 support bitmasks), its
 * identity (mode 09 — VIN, calibration IDs, ECU name), its fault state
 * (mode 03/07 diagnostic trouble codes and the mode 01 PID 01 readiness
 * monitors), and the small set of things that can legitimately be *written*
 * back (mode 04 clear-codes, adapter configuration, raw commands).
 *
 * Everything here is pure string/number crunching — no transport, no React —
 * so the whole surface is unit-tested in utils/__tests__/vehicleInfo.test.ts.
 */

import { cleanElmResponse, isElmError } from "./obd";

/* ------------------------------------------------------------------ *
 * Frame extraction
 * ------------------------------------------------------------------ */

/** Non-data replies that must never be parsed as hex. */
const NOISE_TOKENS = [
  "SEARCHING",
  "BUSINIT",
  "BUS INIT",
  "NODATA",
  "STOPPED",
  "ERROR",
  "UNABLETOCONNECT",
  "OK",
  "?",
];

function isNoiseLine(line: string): boolean {
  return NOISE_TOKENS.some((t) => line === t || line.startsWith(t));
}

/**
 * Split a raw adapter response into candidate payload hex strings.
 *
 * A short answer is one line per responding ECU. A long one (mode 09, a big
 * DTC list) arrives as an ISO-TP multi-frame block, which the ELM327 prints as
 * a three-digit total-length header followed by `N:` indexed continuation
 * lines:
 *
 *     014
 *     0:490201314A
 *     1:4D3448...
 *
 * The indexed lines are re-joined into one payload; every other line is a
 * candidate in its own right.
 */
export function elmPayloads(raw: string): string[] {
  const indexed: string[] = [];
  const plain: string[] = [];
  for (const line of cleanElmResponse(raw)) {
    if (isNoiseLine(line)) continue;
    const framed = /^([0-9A-F]):([0-9A-F]*)$/.exec(line);
    if (framed) {
      indexed.push(framed[2]);
      continue;
    }
    // A bare three-hex-digit line is the multi-frame length header. Real data
    // frames always carry an even number of hex characters, so this can never
    // discard a payload.
    if (/^[0-9A-F]{3}$/.test(line)) continue;
    if (!/^[0-9A-F]+$/.test(line)) continue;
    plain.push(line);
  }
  const payloads = [...plain];
  if (indexed.length > 0) payloads.push(indexed.join(""));
  return payloads;
}

/** Convert an even-length hex string to bytes, or null if it is malformed. */
export function hexToBytes(hex: string): number[] | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const octet = hex.slice(i, i + 2);
    if (!/^[0-9A-F]{2}$/.test(octet)) return null;
    bytes.push(parseInt(octet, 16));
  }
  return bytes;
}

/**
 * Pull the data bytes that follow a response header out of a raw reply.
 *
 * `header` is the positive-response header including the mode, e.g. "4100" for
 * mode 01 PID 00 or "4902" for mode 09 PID 02. With `byteCount` omitted every
 * remaining byte is returned; with it set the frame must carry at least that
 * many and exactly that many are returned.
 */
export function extractFrameBytes(
  raw: string,
  header: string,
  byteCount?: number,
): number[] | null {
  if (isElmError(raw)) return null;
  const wanted = header.toUpperCase();
  for (const payload of elmPayloads(raw)) {
    const idx = payload.indexOf(wanted);
    if (idx === -1) continue;
    let dataHex = payload.slice(idx + wanted.length);
    if (byteCount !== undefined) {
      if (dataHex.length < byteCount * 2) continue;
      dataHex = dataHex.slice(0, byteCount * 2);
    } else if (dataHex.length % 2 !== 0) {
      // Trailing half byte — the frame is truncated, drop it.
      dataHex = dataHex.slice(0, dataHex.length - 1);
    }
    const bytes = hexToBytes(dataHex);
    if (bytes) return bytes;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Supported-PID discovery (mode 01, PIDs 00/20/40/…)
 * ------------------------------------------------------------------ */

/**
 * The mode-01 "which PIDs are supported" probes, in order. Each one answers
 * with a 32-bit mask covering the next 32 PIDs; the last bit of each mask says
 * whether it is worth asking the next probe at all.
 */
export const SUPPORT_RANGE_PIDS = [
  "00",
  "20",
  "40",
  "60",
  "80",
  "A0",
  "C0",
  "E0",
] as const;

export interface SupportedRange {
  /** The probe PID this mask answered, e.g. "20". */
  base: string;
  /** Supported PIDs in this range, as two-digit upper-case hex. */
  pids: string[];
  /** True when the mask's last bit says the next range is also supported. */
  nextRangeSupported: boolean;
}

/**
 * Decode a support bitmask response.
 *
 * The four data bytes are a big-endian bit field: the most significant bit of
 * the first byte is `base + 1`, the least significant bit of the last byte is
 * `base + 32` (which doubles as the "next range supported" flag).
 */
export function parseSupportedPids(
  raw: string,
  base: string,
  responseMode = "41",
): SupportedRange | null {
  const key = base.toUpperCase();
  const bytes = extractFrameBytes(raw, responseMode.toUpperCase() + key, 4);
  if (!bytes) return null;
  const start = parseInt(key, 16);
  if (!Number.isFinite(start)) return null;
  const pids: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    const byte = bytes[bit >> 3];
    const isSet = (byte & (0x80 >> (bit & 7))) !== 0;
    if (!isSet) continue;
    const pidNumber = start + bit + 1;
    pids.push(pidNumber.toString(16).toUpperCase().padStart(2, "0"));
  }
  const nextBase = (start + 0x20).toString(16).toUpperCase().padStart(2, "0");
  return {
    base: key,
    pids,
    nextRangeSupported: pids.includes(nextBase),
  };
}

/**
 * Which probe PID to ask next after `base`, or null when the mask said the
 * following range is unsupported (or we ran off the end of the table).
 */
export function nextSupportRange(base: string, range: SupportedRange | null): string | null {
  if (!range?.nextRangeSupported) return null;
  const idx = SUPPORT_RANGE_PIDS.indexOf(base.toUpperCase() as (typeof SUPPORT_RANGE_PIDS)[number]);
  if (idx === -1 || idx + 1 >= SUPPORT_RANGE_PIDS.length) return null;
  return SUPPORT_RANGE_PIDS[idx + 1];
}

/* ------------------------------------------------------------------ *
 * Mode 09 — vehicle identity
 * ------------------------------------------------------------------ */

/** Mode-09 requests the screen makes, in display order. */
export const MODE_09_ITEMS = [
  { pid: "02", key: "vin", label: "VIN", ascii: true },
  { pid: "04", key: "calibrationId", label: "Calibration ID", ascii: true },
  { pid: "06", key: "cvn", label: "Calibration verification number", ascii: false },
  { pid: "0A", key: "ecuName", label: "ECU name", ascii: true },
] as const;

export type Mode09Key = (typeof MODE_09_ITEMS)[number]["key"];

/**
 * Decode a mode-09 ASCII payload (VIN, calibration ID, ECU name).
 *
 * The bytes after the "49 <pid>" header start with a message-count byte on
 * CAN vehicles and go straight into ASCII on the older protocols, so a leading
 * 0x01–0x04 is dropped when the remaining length looks like text. NUL and 0xFF
 * padding is stripped; anything non-printable ends the string.
 */
export function parseMode09Ascii(raw: string, pid: string): string | null {
  const bytes = extractFrameBytes(raw, "49" + pid.toUpperCase());
  if (!bytes || bytes.length === 0) return null;
  // Drop the message-count byte when present. Printable ASCII starts at 0x20,
  // so a leading byte below that can only be the count.
  const body = bytes[0] < 0x20 ? bytes.slice(1) : bytes;
  const text = body
    .filter((b) => b !== 0x00 && b !== 0xff)
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ""))
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

/** Decode a mode-09 payload that is binary rather than text (the CVN). */
export function parseMode09Hex(raw: string, pid: string): string | null {
  const bytes = extractFrameBytes(raw, "49" + pid.toUpperCase());
  if (!bytes || bytes.length === 0) return null;
  const body = bytes[0] <= 0x04 && bytes.length > 4 ? bytes.slice(1) : bytes;
  const hex = body
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ")
    .trim();
  return hex.length > 0 ? hex : null;
}

/** ISO 3779 VIN charset — I, O and Q are excluded to avoid 1/0 confusion. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isLikelyVin(value: string | null): boolean {
  return !!value && VIN_RE.test(value.toUpperCase());
}

/**
 * World Manufacturer Identifier lookup for the makes GET.ride fleets actually
 * run. Best-effort only: an unknown WMI simply yields null rather than a
 * guess, and nothing downstream depends on it.
 */
const WMI_REGIONS: { prefix: string; label: string }[] = [
  { prefix: "PM", label: "Malaysia" },
  { prefix: "PN", label: "Malaysia" },
  { prefix: "PL", label: "Malaysia" },
  { prefix: "MH", label: "Indonesia" },
  { prefix: "MM", label: "Thailand" },
  { prefix: "MR", label: "Thailand" },
  { prefix: "JH", label: "Japan" },
  { prefix: "JM", label: "Japan" },
  { prefix: "JN", label: "Japan" },
  { prefix: "JT", label: "Japan" },
  { prefix: "KM", label: "South Korea" },
  { prefix: "KN", label: "South Korea" },
  { prefix: "LB", label: "China" },
  { prefix: "LS", label: "China" },
  { prefix: "LV", label: "China" },
  { prefix: "WA", label: "Germany" },
  { prefix: "WB", label: "Germany" },
  { prefix: "WD", label: "Germany" },
  { prefix: "WV", label: "Germany" },
  { prefix: "SA", label: "United Kingdom" },
  { prefix: "SB", label: "United Kingdom" },
  { prefix: "VF", label: "France" },
  { prefix: "ZF", label: "Italy" },
  { prefix: "1F", label: "United States" },
  { prefix: "1G", label: "United States" },
  { prefix: "5Y", label: "United States" },
];

/** Model-year code from VIN position 10, per ISO 3779. */
const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

export interface VinDetails {
  vin: string;
  /** Positions 1-3: who built it. */
  wmi: string;
  /** Best-effort assembly region for the WMI, or null when unrecognised. */
  region: string | null;
  /** Positions 4-9. */
  vds: string;
  /** Positions 10-17. */
  vis: string;
  /**
   * Model year decoded from position 10. The code repeats every 30 years, so
   * both candidates are returned oldest-first and the caller shows the newer
   * one unless it is in the future.
   */
  modelYears: number[];
  /** Position 11 — the assembly plant code. */
  plantCode: string;
  /** Positions 12-17 — the serial number. */
  serial: string;
}

/**
 * Break a VIN into its ISO 3779 fields. Returns null for anything that is not
 * a well-formed 17-character VIN — a partial read is never dressed up as one.
 */
export function decodeVin(vin: string | null, now = new Date()): VinDetails | null {
  if (!isLikelyVin(vin)) return null;
  const value = (vin as string).toUpperCase();
  const wmi = value.slice(0, 3);
  const yearIndex = VIN_YEAR_CODES.indexOf(value[9]);
  const modelYears: number[] = [];
  if (yearIndex !== -1) {
    const thisYear = now.getFullYear();
    for (let year = 1980 + yearIndex; year <= thisYear + 1; year += 30) {
      modelYears.push(year);
    }
  }
  return {
    vin: value,
    wmi,
    region: WMI_REGIONS.find((r) => wmi.startsWith(r.prefix))?.label ?? null,
    vds: value.slice(3, 9),
    vis: value.slice(9),
    modelYears,
    plantCode: value[10],
    serial: value.slice(11),
  };
}

/* ------------------------------------------------------------------ *
 * Diagnostic trouble codes (modes 03, 07 and 0A)
 * ------------------------------------------------------------------ */

/** The three DTC stores, with the mode that reads each. */
export const DTC_MODES = [
  {
    mode: "03",
    header: "43",
    key: "stored",
    label: "Stored codes",
    hint: "Confirmed faults — these are what turn the check-engine light on.",
  },
  {
    mode: "07",
    header: "47",
    key: "pending",
    label: "Pending codes",
    hint: "Seen once and not yet confirmed. They clear themselves if the fault does not repeat.",
  },
  {
    mode: "0A",
    header: "4A",
    key: "permanent",
    label: "Permanent codes",
    hint: "Cannot be cleared by a scan tool — the vehicle erases them itself once the repair is verified.",
  },
] as const;

export type DtcStoreKey = (typeof DTC_MODES)[number]["key"];

const DTC_SYSTEM_LETTERS = ["P", "C", "B", "U"] as const;

/**
 * Decode one two-byte DTC into its SAE J2012 code, e.g. [0x01, 0x33] →
 * "P0133". A pair of zero bytes is padding, not a code, and yields null.
 */
export function decodeDtc(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  const system = DTC_SYSTEM_LETTERS[(a >> 6) & 0x03];
  const first = (a >> 4) & 0x03;
  const second = a & 0x0f;
  const third = (b >> 4) & 0x0f;
  const fourth = b & 0x0f;
  return (
    system +
    first.toString(16).toUpperCase() +
    second.toString(16).toUpperCase() +
    third.toString(16).toUpperCase() +
    fourth.toString(16).toUpperCase()
  );
}

/**
 * Parse a DTC list out of a mode 03/07/0A response.
 *
 * CAN vehicles prefix the code pairs with a count byte and older protocols do
 * not, which is unambiguous from the length: count + 2n bytes is odd, 2n bytes
 * alone is even. Returns an empty array when the vehicle reports no codes, and
 * null only when the response could not be parsed at all.
 */
export function parseDtcResponse(raw: string, header: string): string[] | null {
  const bytes = extractFrameBytes(raw, header.toUpperCase());
  if (!bytes) {
    // "NO DATA" is a legitimate answer meaning "nothing stored", not a failure.
    return isElmError(raw) && /NO\s*DATA/i.test(raw) ? [] : null;
  }
  const body = bytes.length % 2 === 1 ? bytes.slice(1) : bytes;
  const codes: string[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    const code = decodeDtc(body[i], body[i + 1]);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Which vehicle system a code's letter refers to. */
const DTC_SYSTEM_NAMES: Record<string, string> = {
  P: "Powertrain",
  C: "Chassis",
  B: "Body",
  U: "Network",
};

/** Fault area for the powertrain code families (the "P0xyz" second digit). */
const POWERTRAIN_AREAS: Record<string, string> = {
  "0": "Fuel and air metering, auxiliary emission controls",
  "1": "Fuel and air metering",
  "2": "Fuel and air metering — injector circuit",
  "3": "Ignition system or misfire",
  "4": "Auxiliary emission controls",
  "5": "Vehicle speed, idle control, auxiliary inputs",
  "6": "Computer output circuit",
  "7": "Transmission",
  "8": "Transmission",
  "9": "Transmission / control module",
};

/**
 * A short, honest description of what a code covers.
 *
 * Full fault text is manufacturer-specific and runs to thousands of entries,
 * so this deliberately describes the *family* the code belongs to rather than
 * inventing a specific diagnosis.
 */
export function describeDtc(code: string): string {
  const value = code.trim().toUpperCase();
  const system = DTC_SYSTEM_NAMES[value[0]] ?? "Unknown system";
  const generic = value[1] === "0" || value[1] === "2";
  const scope = generic ? "generic (SAE)" : "manufacturer-specific";
  if (value[0] === "P") {
    const area = POWERTRAIN_AREAS[value[2]];
    return area ? `${system} — ${area} · ${scope}` : `${system} · ${scope}`;
  }
  return `${system} · ${scope}`;
}

/* ------------------------------------------------------------------ *
 * Readiness monitors (mode 01, PID 01)
 * ------------------------------------------------------------------ */

export interface ReadinessMonitor {
  key: string;
  label: string;
  /** The vehicle implements this monitor. */
  supported: boolean;
  /** The monitor has finished its self-test since the last code clear. */
  complete: boolean;
}

export interface MonitorStatus {
  /** Malfunction indicator lamp — the check-engine light. */
  milOn: boolean;
  /** Number of confirmed emission-related faults stored. */
  dtcCount: number;
  /** True for a diesel (compression ignition) engine. */
  compressionIgnition: boolean;
  monitors: ReadinessMonitor[];
}

const CONTINUOUS_MONITORS = [
  { key: "misfire", label: "Misfire", bit: 0 },
  { key: "fuelSystem", label: "Fuel system", bit: 1 },
  { key: "components", label: "Components", bit: 2 },
] as const;

const SPARK_MONITORS = [
  { key: "catalyst", label: "Catalyst", bit: 0 },
  { key: "heatedCatalyst", label: "Heated catalyst", bit: 1 },
  { key: "evap", label: "Evaporative system", bit: 2 },
  { key: "secondaryAir", label: "Secondary air system", bit: 3 },
  { key: "acRefrigerant", label: "A/C refrigerant", bit: 4 },
  { key: "oxygenSensor", label: "Oxygen sensor", bit: 5 },
  { key: "oxygenSensorHeater", label: "Oxygen sensor heater", bit: 6 },
  { key: "egr", label: "EGR system", bit: 7 },
] as const;

const DIESEL_MONITORS = [
  { key: "nmhcCatalyst", label: "NMHC catalyst", bit: 0 },
  { key: "noxAftertreatment", label: "NOx / SCR aftertreatment", bit: 1 },
  { key: "boostPressure", label: "Boost pressure", bit: 3 },
  { key: "exhaustGasSensor", label: "Exhaust gas sensor", bit: 5 },
  { key: "pmFilter", label: "Particulate filter", bit: 6 },
  { key: "egrVvt", label: "EGR and VVT", bit: 7 },
] as const;

/**
 * Decode the mode-01 PID 01 monitor-status frame.
 *
 * Byte A carries the MIL flag and the stored-fault count; byte B the three
 * continuously-monitored systems plus the spark/compression engine flag; bytes
 * C and D the non-continuous monitors, C saying which exist and D which have
 * *not* finished yet (so "complete" is the inverted bit).
 */
export function parseMonitorStatus(bytes: number[]): MonitorStatus | null {
  if (bytes.length < 4) return null;
  const [a, b, c, d] = bytes;
  const compressionIgnition = (b & 0x08) !== 0;
  const monitors: ReadinessMonitor[] = CONTINUOUS_MONITORS.map((m) => ({
    key: m.key,
    label: m.label,
    supported: (b & (1 << m.bit)) !== 0,
    // The "incomplete" flags for the continuous monitors sit in the high
    // nibble of the same byte, four bits above their support flag.
    complete: (b & (1 << (m.bit + 4))) === 0,
  }));
  const table = compressionIgnition ? DIESEL_MONITORS : SPARK_MONITORS;
  for (const m of table) {
    monitors.push({
      key: m.key,
      label: m.label,
      supported: (c & (1 << m.bit)) !== 0,
      complete: (d & (1 << m.bit)) === 0,
    });
  }
  return {
    milOn: (a & 0x80) !== 0,
    dtcCount: a & 0x7f,
    compressionIgnition,
    monitors,
  };
}

/** Read the monitor-status frame straight out of a raw "0101" response. */
export function parseMonitorStatusResponse(raw: string): MonitorStatus | null {
  const bytes = extractFrameBytes(raw, "4101", 4);
  return bytes ? parseMonitorStatus(bytes) : null;
}

/* ------------------------------------------------------------------ *
 * Adapter identity (AT commands)
 * ------------------------------------------------------------------ */

/** Adapter-level probes shown under "Reader". */
export const ADAPTER_PROBES = [
  { command: "ATI", key: "firmware", label: "Adapter firmware" },
  { command: "AT@1", key: "deviceDescription", label: "Device description" },
  { command: "ATRV", key: "batteryVoltage", label: "Battery voltage (adapter)" },
  { command: "ATDP", key: "protocol", label: "Protocol" },
] as const;

/**
 * Take the first meaningful line out of an AT-command reply.
 *
 * An adapter that does not implement a probe answers with an error token
 * rather than staying silent, so those are rejected — "NO DATA" is not a
 * device description.
 */
export function parseAtText(raw: string): string | null {
  if (isElmError(raw)) return null;
  const lines = cleanElmResponse(raw).filter(
    (line) => line.length > 0 && line !== "OK" && line !== "?",
  );
  if (lines.length === 0) return null;
  // cleanElmResponse upper-cases and strips spaces, which mangles version
  // strings, so re-derive the display text from the original.
  const original = raw
    .replace(/>/g, "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "OK" && line !== "?");
  return original[0] ?? lines[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type VehicleWriteId =
  | "clear-dtc"
  | "reset-adapter"
  | "set-protocol"
  | "raw-command";

export interface VehicleWriteAction {
  id: VehicleWriteId;
  label: string;
  description: string;
  /**
   * Whether the command reaches the car's ECUs or stops at the dongle. Only
   * `vehicle` writes can change how the car behaves, and they are the ones
   * gated on the vehicle being stationary.
   */
  target: "vehicle" | "adapter";
  /** Shown in red and confirmed with a destructive-styled button. */
  destructive: boolean;
  warningTitle: string;
  warningBody: string;
  confirmLabel: string;
}

/**
 * The writes this screen offers.
 *
 * Deliberately short. Generic OBD-II defines exactly one universally
 * implemented write to the vehicle — mode 04, "clear diagnostic information" —
 * and everything else a scan tool appears to "program" is manufacturer-
 * specific and outside what an ELM327 can safely be asked to do. The rest of
 * the list configures the *adapter*, which is harmless but still worth a
 * confirmation because it interrupts the live link.
 */
export const VEHICLE_WRITE_ACTIONS: VehicleWriteAction[] = [
  {
    id: "clear-dtc",
    label: "Clear trouble codes",
    description:
      "Mode 04 — erases stored and pending fault codes, switches the check-engine light off and resets the readiness monitors.",
    target: "vehicle",
    destructive: true,
    warningTitle: "Clear diagnostic trouble codes?",
    warningBody:
      "This writes to your vehicle's ECU. It erases stored and pending fault codes, turns off the check-engine light and resets every readiness monitor to \"not ready\".\n\nThe underlying fault is not repaired — if it is still present the code comes back. Clearing also wipes the emissions readiness data, so the vehicle may fail an inspection until it has completed a full drive cycle.\n\nOnly do this with the engine off and the vehicle stationary.",
    confirmLabel: "Clear codes",
  },
  {
    id: "set-protocol",
    label: "Set CAN protocol",
    description:
      "Pins the adapter to a specific OBD-II protocol instead of auto-detecting it. Useful when a vehicle negotiates the wrong one.",
    target: "adapter",
    destructive: false,
    warningTitle: "Change the adapter protocol?",
    warningBody:
      "This reconfigures the reader, not the vehicle. The live link drops while it re-negotiates, and picking a protocol your vehicle does not speak means no data at all until you set it back to automatic.",
    confirmLabel: "Set protocol",
  },
  {
    id: "reset-adapter",
    label: "Reset reader",
    description:
      "Sends ATZ — a full adapter reset, as if it had been unplugged and plugged back in. Does not touch the vehicle.",
    target: "adapter",
    destructive: false,
    warningTitle: "Reset the reader?",
    warningBody:
      "The adapter restarts and the link drops. Nothing is written to the vehicle. The app reconnects afterwards, which takes a few seconds.",
    confirmLabel: "Reset reader",
  },
  {
    id: "raw-command",
    label: "Send raw command",
    description:
      "Sends a command straight to the adapter. For diagnosing an uncooperative reader, or for vehicle-specific commands you already know.",
    target: "vehicle",
    destructive: true,
    warningTitle: "Send a raw command?",
    warningBody:
      "Raw commands are passed to the adapter, and OBD-II service commands are passed on to your vehicle's ECUs, unchecked.\n\nA mistyped command is usually harmless — the adapter answers \"?\" — but the writing services (04, 08, 2F, 31, 3E and the manufacturer-specific ranges) can change how the vehicle runs, clear data you cannot restore, or leave a module in a diagnostic state until it is power-cycled.\n\nOnly send commands you understand, with the vehicle stationary.",
    confirmLabel: "Send command",
  },
];

export function findWriteAction(id: VehicleWriteId): VehicleWriteAction | null {
  return VEHICLE_WRITE_ACTIONS.find((a) => a.id === id) ?? null;
}

export interface WriteContext {
  /** The session is up (phase "online"). */
  online: boolean;
  /** The link is the built-in simulator rather than a real dongle. */
  simulated: boolean;
  /** Latest vehicle speed in km/h, or null when it is not being reported. */
  speedKmh?: number | null;
  /**
   * Whether the ECU listed mode 04 as available. `undefined` means "not probed
   * yet" and is treated as allowed — mode 04 is mandatory on every OBD-II
   * vehicle, so refusing on a missing probe would block a legitimate write.
   */
  supportsClearDtc?: boolean;
}

export interface WriteAvailability {
  allowed: boolean;
  /** Why the write is blocked — shown in place of the button's subtitle. */
  reason?: string;
}

/**
 * Decide whether a write may be attempted right now.
 *
 * The rules, in the order a driver would hit them: there has to be a link, it
 * has to be a real one (simulated telemetry must never be presented as having
 * written to a car), and a write that reaches the ECUs is refused while the
 * vehicle is moving.
 */
export function evaluateWriteAvailability(
  action: VehicleWriteAction,
  ctx: WriteContext,
): WriteAvailability {
  if (!ctx.online) {
    return { allowed: false, reason: "Connect the OBD-II reader first." };
  }
  if (ctx.simulated) {
    return {
      allowed: false,
      reason: "Demo Mode is virtual data — nothing can be written to a vehicle.",
    };
  }
  if (action.target === "vehicle" && (ctx.speedKmh ?? 0) > 0) {
    return {
      allowed: false,
      reason: "Stop the vehicle before writing to it.",
    };
  }
  if (action.id === "clear-dtc" && ctx.supportsClearDtc === false) {
    return {
      allowed: false,
      reason: "This vehicle did not report mode 04 (clear codes) as supported.",
    };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ *
 * Raw command validation
 * ------------------------------------------------------------------ */

/**
 * OBD-II services that write to, or command, the vehicle rather than just
 * reading from it. Used to escalate the warning on a raw command.
 */
const WRITE_SERVICES = ["04", "08", "2E", "2F", "31", "3E", "85", "87"];

export interface RawCommandCheck {
  ok: boolean;
  /** Normalised command, ready to send (upper case, spaces stripped). */
  command?: string;
  /** Whether it configures the adapter or is forwarded to the vehicle. */
  target?: "adapter" | "vehicle";
  /** True when the command is a vehicle service that can change state. */
  write?: boolean;
  error?: string;
}

/**
 * Validate and normalise a hand-typed command.
 *
 * ELM327 commands are ASCII alphanumerics (`ATSP6`, `0100`, `09 02`); anything
 * else is a typo, and sending it just makes the adapter answer "?". Length is
 * capped well under the ELM327's own line buffer.
 */
export function validateRawCommand(input: string): RawCommandCheck {
  const command = (input ?? "").replace(/\s+/g, "").toUpperCase();
  if (command.length === 0) {
    return { ok: false, error: "Enter a command." };
  }
  if (command.length > 24) {
    return { ok: false, error: "Commands are at most 24 characters." };
  }
  if (!/^[A-Z0-9@]+$/.test(command)) {
    return {
      ok: false,
      error: "Only letters, digits and @ are valid in an ELM327 command.",
    };
  }
  if (command.startsWith("AT") || command.startsWith("ST")) {
    return { ok: true, command, target: "adapter", write: false };
  }
  if (command.length % 2 !== 0) {
    return {
      ok: false,
      error: "An OBD-II request is whole bytes — use an even number of hex digits.",
    };
  }
  if (!/^[0-9A-F]+$/.test(command)) {
    return {
      ok: false,
      error: "An OBD-II request is hexadecimal. Adapter commands start with AT.",
    };
  }
  return {
    ok: true,
    command,
    target: "vehicle",
    write: WRITE_SERVICES.includes(command.slice(0, 2)),
  };
}

/** Did a write command actually succeed? ELM327 answers "OK" or a positive response. */
export function isWriteAcknowledged(raw: string, expectedHeader?: string): boolean {
  if (isElmError(raw)) return false;
  const lines = cleanElmResponse(raw);
  if (lines.length === 0) return false;
  if (lines.includes("OK")) return true;
  if (expectedHeader) {
    return lines.some((line) => line.includes(expectedHeader.toUpperCase()));
  }
  return true;
}
