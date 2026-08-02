/**
 * Full vehicle interrogation.
 *
 * Walks everything a connected ELM327 can tell us about the car in one pass:
 * the adapter's own identity, which mode-01 PIDs the vehicle implements and
 * their current values, the emissions readiness monitors, the mode-09 identity
 * block (VIN, calibration IDs, ECU name) and all three DTC stores.
 *
 * The scan takes a `send` function rather than a transport, so it is driven by
 * `useCanbus().sendCommand` in the app and by a plain stub in the tests — no
 * hardware, no React. See utils/__tests__/vehicleScan.test.ts.
 */

import {
  PID_CATALOG,
  catalogPid,
  formatCatalogValue,
  formatRawBytes,
  type PidGroup,
} from "./pidCatalog";
import {
  ADAPTER_PROBES,
  DTC_MODES,
  MODE_09_ITEMS,
  SUPPORT_RANGE_PIDS,
  extractFrameBytes,
  nextSupportRange,
  parseAtText,
  parseDtcResponse,
  parseMode09Ascii,
  parseMode09Hex,
  parseMonitorStatusResponse,
  parseSupportedPids,
  type DtcStoreKey,
  type MonitorStatus,
} from "./vehicleInfo";

/** One decoded parameter as the screen renders it. */
export interface VehicleReading {
  /** Mode-01 PID, two hex digits. */
  pid: string;
  label: string;
  /** Formatted for display, e.g. "13.842 V" — never a bare number. */
  value: string;
  group: PidGroup;
  /** False when the PID is supported by the car but absent from the catalog. */
  known: boolean;
}

export interface LabelledValue {
  key: string;
  label: string;
  value: string;
}

export interface VehicleScanReport {
  /** Every mode-01 PID the vehicle reported as implemented. */
  supportedPids: string[];
  /** PIDs that answered, decoded and formatted. */
  readings: VehicleReading[];
  /** PIDs the car claims to support but that did not answer this pass. */
  unreadablePids: string[];
  monitor: MonitorStatus | null;
  identity: LabelledValue[];
  /** Raw VIN string, if the vehicle returned one. */
  vin: string | null;
  dtcs: Partial<Record<DtcStoreKey, string[]>>;
  adapter: LabelledValue[];
  /** Which mode-09 PIDs the vehicle said it implements. */
  supportedMode09: string[];
  finishedAt: number;
}

export interface ScanProgress {
  /** Commands issued so far. */
  done: number;
  /** Best estimate of the total — it grows once the support masks come back. */
  total: number;
  /** What is being read right now, e.g. "Engine coolant temperature". */
  label: string;
}

export interface ScanOptions {
  onProgress?: (progress: ScanProgress) => void;
  /** Return false to abandon the scan at the next step (screen unmounted). */
  shouldContinue?: () => boolean;
}

export type SendCommand = (command: string) => Promise<string>;

/** A fresh, empty report. Must build new arrays — a scan mutates them. */
function emptyReport(): Omit<VehicleScanReport, "finishedAt"> {
  return {
    supportedPids: [],
    readings: [],
    unreadablePids: [],
    monitor: null,
    identity: [],
    vin: null,
    dtcs: {},
    adapter: [],
    supportedMode09: [],
  };
}

/**
 * PIDs that describe the *structure* of the response set rather than a
 * reading: the support bitmasks and the two monitor-status frames, both of
 * which are decoded into their own sections.
 */
const STRUCTURAL_PIDS = new Set<string>([...SUPPORT_RANGE_PIDS, "01", "41"]);

export async function scanVehicle(
  send: SendCommand,
  options: ScanOptions = {},
): Promise<VehicleScanReport> {
  const { onProgress, shouldContinue } = options;
  const report = emptyReport();
  const alive = () => (shouldContinue ? shouldContinue() : true);

  let done = 0;
  // A first guess: adapter probes, a couple of support masks, the monitor
  // frame, the mode-09 block and the three DTC stores. It is revised upward
  // once the support masks say how many parameters there actually are, and
  // clamped so a vehicle with more support ranges than guessed never reports
  // more steps done than exist.
  let total = ADAPTER_PROBES.length + 2 + 1 + MODE_09_ITEMS.length + 1 + DTC_MODES.length;
  const step = (label: string) => {
    done += 1;
    total = Math.max(total, done);
    onProgress?.({ done, total, label });
  };

  /** Send and swallow — one dead PID must never abort the whole scan. */
  const ask = async (command: string): Promise<string | null> => {
    try {
      return await send(command);
    } catch {
      return null;
    }
  };

  // --- 1. The adapter itself -----------------------------------------------
  for (const probe of ADAPTER_PROBES) {
    if (!alive()) return { ...report, finishedAt: Date.now() };
    step(probe.label);
    const raw = await ask(probe.command);
    const text = raw ? parseAtText(raw) : null;
    if (text) {
      report.adapter.push({ key: probe.key, label: probe.label, value: text });
    }
  }

  // --- 2. Which mode-01 PIDs the vehicle implements ------------------------
  let base: string | null = SUPPORT_RANGE_PIDS[0];
  while (base && alive()) {
    step(`Supported parameters ${base}`);
    const raw = await ask("01" + base);
    const range = raw ? parseSupportedPids(raw, base) : null;
    if (!range) break;
    for (const pid of range.pids) {
      if (!report.supportedPids.includes(pid)) report.supportedPids.push(pid);
    }
    base = nextSupportRange(base, range);
  }

  // Now that the supported set is known, the estimate can be honest.
  const readablePids = report.supportedPids.filter((pid) => !STRUCTURAL_PIDS.has(pid));
  total += readablePids.length;
  onProgress?.({ done, total, label: "Reading parameters" });

  // --- 3. Readiness monitors (mode 01 PID 01) ------------------------------
  if (alive()) {
    step("Readiness monitors");
    const raw = await ask("0101");
    report.monitor = raw ? parseMonitorStatusResponse(raw) : null;
  }

  // --- 4. Every supported parameter ----------------------------------------
  for (const pid of readablePids) {
    if (!alive()) return { ...report, finishedAt: Date.now() };
    const known = catalogPid(pid);
    step(known?.label ?? `PID 01${pid}`);
    const raw = await ask("01" + pid);
    if (!raw) {
      report.unreadablePids.push(pid);
      continue;
    }
    const reading = decodeReading(pid, raw);
    if (reading) report.readings.push(reading);
    else report.unreadablePids.push(pid);
  }

  // --- 5. Mode 09 identity --------------------------------------------------
  if (alive()) {
    step("Vehicle identity");
    const raw = await ask("0900");
    const range = raw ? parseSupportedPids(raw, "00", "49") : null;
    report.supportedMode09 = range?.pids ?? [];
  }

  for (const item of MODE_09_ITEMS) {
    if (!alive()) return { ...report, finishedAt: Date.now() };
    // An empty support list means the probe failed, not that nothing is
    // supported — ask anyway rather than silently skipping the VIN.
    const skip =
      report.supportedMode09.length > 0 && !report.supportedMode09.includes(item.pid);
    if (skip) {
      done += 1;
      continue;
    }
    step(item.label);
    const raw = await ask("09" + item.pid);
    if (!raw) continue;
    const value = item.ascii ? parseMode09Ascii(raw, item.pid) : parseMode09Hex(raw, item.pid);
    if (!value) continue;
    report.identity.push({ key: item.key, label: item.label, value });
    if (item.key === "vin") report.vin = value;
  }

  // --- 6. Fault codes -------------------------------------------------------
  for (const store of DTC_MODES) {
    if (!alive()) return { ...report, finishedAt: Date.now() };
    step(store.label);
    const raw = await ask(store.mode);
    if (!raw) continue;
    const codes = parseDtcResponse(raw, store.header);
    if (codes) report.dtcs[store.key] = codes;
  }

  return { ...report, finishedAt: Date.now() };
}

/**
 * Decode one mode-01 reply into a display row.
 *
 * A PID the catalog knows gets its label, unit and engineering value; one it
 * does not gets its raw bytes, because "supported but undocumented here" is
 * still information the reader can genuinely read.
 */
export function decodeReading(pid: string, raw: string): VehicleReading | null {
  const key = pid.toUpperCase();
  const known = PID_CATALOG[key];
  if (known) {
    const bytes = extractFrameBytes(raw, "41" + key, known.bytes);
    if (bytes) {
      const value = formatCatalogValue(known, bytes);
      if (value) {
        return {
          pid: key,
          label: known.label,
          value,
          group: known.group,
          known: true,
        };
      }
    }
    // The catalog expected more bytes than the ECU sent — fall through to the
    // raw rendering rather than dropping the parameter entirely.
  }
  const bytes = extractFrameBytes(raw, "41" + key);
  if (!bytes || bytes.length === 0) return null;
  return {
    pid: key,
    label: known?.label ?? `PID 01${key}`,
    value: formatRawBytes(bytes),
    group: known?.group ?? "other",
    known: false,
  };
}

/** Group readings for rendering, dropping groups with nothing in them. */
export function groupReadings(
  readings: VehicleReading[],
  order: PidGroup[],
): { group: PidGroup; readings: VehicleReading[] }[] {
  return order
    .map((group) => ({ group, readings: readings.filter((r) => r.group === group) }))
    .filter((section) => section.readings.length > 0);
}
