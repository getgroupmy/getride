/**
 * OBD-II / ELM327 protocol layer.
 *
 * Pure, transport-agnostic logic for talking to an ELM327-compatible
 * OBD-II / CAN adapter (the near-universal interface exposed by consumer
 * BLE / WiFi / USB dongles that bridge onto the vehicle CAN bus).
 *
 * Everything here is deterministic string/number crunching so it can be
 * unit-tested without a device — see utils/__tests__/obd.test.ts. The
 * transports (transports.ts) and the session client (canbusClient.ts) build
 * on top of these helpers.
 */

/** Line terminator the ELM327 expects after every command. */
export const ELM_CR = "\r";

/** The prompt character the adapter emits when it is ready for the next command. */
export const ELM_PROMPT = ">";

/**
 * ELM327 initialisation sequence, run once after the socket/characteristic
 * is open. Order matters: reset first, then quiet the output so responses are
 * cheap to parse, then let the adapter auto-detect the CAN protocol.
 *
 *  ATZ    reset
 *  ATE0   echo off (don't parrot our command back)
 *  ATL0   linefeeds off
 *  ATS0   spaces off (compact hex, e.g. "410C1AF8")
 *  ATH0   headers off (we don't need the CAN arbitration id per frame)
 *  ATSP0  set protocol to automatic (adapter probes 6=CAN 11bit/500k etc.)
 */
export const ELM_INIT_COMMANDS: readonly string[] = [
  "ATZ",
  "ATE0",
  "ATL0",
  "ATS0",
  "ATH0",
  "ATSP0",
];

/** Command that asks the adapter which CAN protocol it negotiated. */
export const ELM_DESCRIBE_PROTOCOL = "ATDPN";

/** Human-readable names for the ELM327 "ATDPN" protocol number. */
export const ELM_PROTOCOL_NAMES: Record<string, string> = {
  "0": "Auto",
  "1": "SAE J1850 PWM",
  "2": "SAE J1850 VPW",
  "3": "ISO 9141-2",
  "4": "ISO 14230-4 (KWP 5-baud)",
  "5": "ISO 14230-4 (KWP fast)",
  "6": "ISO 15765-4 CAN (11-bit, 500 kbps)",
  "7": "ISO 15765-4 CAN (29-bit, 500 kbps)",
  "8": "ISO 15765-4 CAN (11-bit, 250 kbps)",
  "9": "ISO 15765-4 CAN (29-bit, 250 kbps)",
  A: "SAE J1939 CAN (29-bit, 250 kbps)",
};

/**
 * Approximate bus bitrate (kbps) for an ELM327 protocol number, used purely
 * to render the "500 kbps · linked" style detail line. Auto-negotiated
 * protocols report their resolved number, so this is best-effort.
 */
export const ELM_PROTOCOL_BITRATE: Record<string, number> = {
  "6": 500,
  "7": 500,
  "8": 250,
  "9": 250,
  A: 250,
};

export function describeProtocol(protocolNumber: string | null): {
  name: string;
  bitrateKbps: number | null;
} {
  if (!protocolNumber) return { name: "Unknown", bitrateKbps: null };
  // ATDPN may prefix "A" (automatic) to the resolved number, e.g. "A6".
  const key = protocolNumber.replace(/^A(?=.)/i, "").toUpperCase();
  return {
    name: ELM_PROTOCOL_NAMES[key] ?? `Protocol ${protocolNumber}`,
    bitrateKbps: ELM_PROTOCOL_BITRATE[key] ?? null,
  };
}

/** OBD-II service/mode 01 = "show current data". */
export const OBD_MODE_CURRENT = "01";

/**
 * A supported OBD-II parameter (PID). `decode` receives the data bytes that
 * follow the "41 <pid>" response header (already parsed to numbers) and
 * returns the engineering value in `unit`.
 */
export interface ObdPid {
  /** Two-hex-digit PID within mode 01, e.g. "0C". */
  pid: string;
  /** Stable machine key used in telemetry objects. */
  key: string;
  label: string;
  unit: string;
  /** Number of data bytes expected after the header. */
  bytes: number;
  decode: (data: number[]) => number;
}

/** The PIDs the taxi telematics panel polls. */
export const OBD_PIDS: Record<string, ObdPid> = {
  rpm: {
    pid: "0C",
    key: "rpm",
    label: "Engine RPM",
    unit: "rpm",
    bytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 4,
  },
  speed: {
    pid: "0D",
    key: "speed",
    label: "Vehicle speed",
    unit: "km/h",
    bytes: 1,
    decode: ([a]) => a,
  },
  coolantTemp: {
    pid: "05",
    key: "coolantTemp",
    label: "Coolant temp",
    unit: "°C",
    bytes: 1,
    decode: ([a]) => a - 40,
  },
  engineLoad: {
    pid: "04",
    key: "engineLoad",
    label: "Engine load",
    unit: "%",
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  throttle: {
    pid: "11",
    key: "throttle",
    label: "Throttle",
    unit: "%",
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  fuelLevel: {
    pid: "2F",
    key: "fuelLevel",
    label: "Fuel level",
    unit: "%",
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
  },
  moduleVoltage: {
    pid: "42",
    key: "moduleVoltage",
    label: "Battery / ECU voltage",
    unit: "V",
    bytes: 2,
    decode: ([a, b]) => (a * 256 + b) / 1000,
  },
  intakeTemp: {
    pid: "0F",
    key: "intakeTemp",
    label: "Intake air temp",
    unit: "°C",
    bytes: 1,
    decode: ([a]) => a - 40,
  },
};

/** Build the raw mode-01 request for a PID, e.g. "010C". */
export function buildPidCommand(pid: ObdPid): string {
  return OBD_MODE_CURRENT + pid.pid.toUpperCase();
}

/** Non-data replies the ELM327 can send instead of a hex frame. */
const ELM_ERROR_TOKENS = [
  "NODATA",
  "STOPPED",
  "ERROR",
  "UNABLETOCONNECT",
  "BUSINIT",
  "BUSERROR",
  "CANERROR",
  "BUFFERFULL",
  "?",
];

/** Tokens that mean "still working, not an answer yet". */
const ELM_TRANSIENT_TOKENS = ["SEARCHING", "BUS INIT", "BUSINIT"];

/**
 * Normalise a raw adapter response into upper-cased, whitespace-free lines
 * with the prompt char and echo noise stripped. ELM327 frames are separated
 * by carriage returns; a single read may contain several.
 */
export function cleanElmResponse(raw: string): string[] {
  return raw
    .replace(new RegExp(ELM_PROMPT, "g"), "")
    .split(/[\r\n]+/)
    .map((line) => line.replace(/\s+/g, "").toUpperCase())
    .filter((line) => line.length > 0);
}

export function isElmError(raw: string): boolean {
  const lines = cleanElmResponse(raw);
  if (lines.length === 0) return false;
  return lines.some((line) => ELM_ERROR_TOKENS.includes(line));
}

export function isElmSearching(raw: string): boolean {
  const upper = raw.toUpperCase();
  return ELM_TRANSIENT_TOKENS.some((t) => upper.includes(t));
}

/**
 * Extract the data bytes for a PID out of a raw mode-01 response.
 *
 * With spaces off a valid reply to "010C" looks like "410C1AF8" (optionally
 * preceded by "SEARCHING..." and/or repeated for multiple ECUs). We locate
 * the "41" + pid header and read the expected number of data bytes after it.
 * Returns null when the frame is missing, malformed, or an error/no-data
 * reply.
 */
export function parsePidBytes(raw: string, pid: ObdPid): number[] | null {
  if (isElmError(raw)) return null;
  const header = "41" + pid.pid.toUpperCase();
  for (const line of cleanElmResponse(raw)) {
    if (ELM_ERROR_TOKENS.includes(line) || ELM_TRANSIENT_TOKENS.includes(line)) {
      continue;
    }
    const idx = line.indexOf(header);
    if (idx === -1) continue;
    const dataHex = line.slice(idx + header.length);
    // Need exactly `bytes` * 2 hex chars available.
    if (dataHex.length < pid.bytes * 2) continue;
    const bytes: number[] = [];
    let ok = true;
    for (let i = 0; i < pid.bytes; i++) {
      const octet = dataHex.slice(i * 2, i * 2 + 2);
      if (!/^[0-9A-F]{2}$/.test(octet)) {
        ok = false;
        break;
      }
      bytes.push(parseInt(octet, 16));
    }
    if (ok) return bytes;
  }
  return null;
}

export interface DecodedPid {
  key: string;
  label: string;
  unit: string;
  value: number;
}

/** Parse + decode a raw response into an engineering value, or null. */
export function decodePidResponse(raw: string, pid: ObdPid): DecodedPid | null {
  const bytes = parsePidBytes(raw, pid);
  if (!bytes) return null;
  const value = pid.decode(bytes);
  if (!Number.isFinite(value)) return null;
  return { key: pid.key, label: pid.label, unit: pid.unit, value };
}

/** Live vehicle telemetry keyed by ObdPid.key (values may be absent). */
export type Telemetry = Partial<Record<keyof typeof OBD_PIDS, number>>;

/** Format a single telemetry value for display, e.g. 820.5 rpm -> "821 rpm". */
export function formatTelemetryValue(key: keyof typeof OBD_PIDS, value: number): string {
  const pid = OBD_PIDS[key];
  const rounded =
    pid.unit === "V" ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${pid.unit}`;
}
