/**
 * Transport implementations for the mini thermal printer.
 *
 * Three physical links are modelled — Wi-Fi (raw TCP to the ESC/POS port),
 * Bluetooth LE (GATT), and Bluetooth classic / SPP — behind the single
 * {@link PrinterTransport} interface so the caller stays transport-blind. The
 * three native packages are the very ones the OBD side already ships
 * (`react-native-tcp-socket`, `react-native-ble-plx`,
 * `react-native-bluetooth-classic`), loaded through the same guarded module
 * loaders, so nothing new has to be linked to print.
 *
 * The one asymmetry worth stating: `react-native-bluetooth-classic` is
 * autolinked on iOS only (see `expo/react-native.config.js`), so the classic
 * transport is honestly reported iOS-only. On Android the common mini-printer
 * path in this build is Bluetooth **LE**, which is linked on both platforms.
 */

import { PermissionsAndroid, Platform } from "react-native";
import { getAppRuntime } from "@/utils/canbus/appRuntime";
import { getSharedBleManager, isBleNativeLinked, loadBleModule } from "@/utils/canbus/bleModule";
import { isMfiNativeLinked, loadMfiModule } from "@/utils/canbus/mfiModule";
import { isTcpNativeLinked, loadTcpModule } from "@/utils/canbus/tcpModule";
import {
  describePrinterMissingModule,
  describePrinterWebUnsupported,
} from "./availability";
import {
  PRINTER_WIFI_PORT,
  type CreatePrinterTransportOptions,
  type PrinterDeviceInfo,
  type PrinterTransport,
  type PrinterTransportAvailability,
  type PrinterTransportKind,
} from "./types";

/** How long to wait for a socket/GATT/accessory connect before giving up. */
const CONNECT_TIMEOUT_MS = 10_000;
/** How long a BLE scan runs before it concludes the printer is not nearby. */
const SCAN_TIMEOUT_MS = 12_000;
/** BLE characteristics ferry small payloads; ESC/POS is chunked to this size. */
const BLE_CHUNK_BYTES = 180;

// --- tiny ASCII→base64 codec (BLE characteristics ferry base64) ----------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode an ASCII string (bytes ≤ 0x7F) to base64 without a Buffer. */
export function asciiToBase64(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const c0 = input.charCodeAt(i) & 0xff;
    const c1 = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : NaN;
    const c2 = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : NaN;
    out += B64[c0 >> 2];
    out += B64[((c0 & 3) << 4) | (Number.isNaN(c1) ? 0 : c1 >> 4)];
    out += Number.isNaN(c1) ? "=" : B64[((c1 & 15) << 2) | (Number.isNaN(c2) ? 0 : c2 >> 6)];
    out += Number.isNaN(c2) ? "=" : B64[c2 & 63];
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// --- availability --------------------------------------------------------

function wifiAvailability(): { available: boolean; reason?: string; guidance?: string } {
  if (Platform.OS === "web") return describePrinterWebUnsupported("Wi-Fi");
  const mod = loadTcpModule();
  if (typeof mod?.createConnection === "function" && isTcpNativeLinked()) {
    return { available: true };
  }
  return describePrinterMissingModule({
    runtime: getAppRuntime(),
    transport: "Wi-Fi",
    packageName: "react-native-tcp-socket",
  });
}

function bleAvailability(): { available: boolean; reason?: string; guidance?: string } {
  if (Platform.OS === "web") return describePrinterWebUnsupported("Bluetooth LE");
  if (!!loadBleModule()?.BleManager && isBleNativeLinked()) {
    return { available: true };
  }
  return describePrinterMissingModule({
    runtime: getAppRuntime(),
    transport: "Bluetooth LE",
    packageName: "react-native-ble-plx",
  });
}

function classicAvailability(): PrinterTransportAvailability | { available: boolean; reason?: string; guidance?: string } {
  if (Platform.OS === "web") return describePrinterWebUnsupported("Bluetooth (classic)");
  if (Platform.OS === "android") {
    // The classic library is autolinked on iOS only; on Android BLE covers the
    // same printers without it. Say so rather than offering a link that cannot open.
    return {
      available: false,
      reason: "iOS only in this build — use Bluetooth LE or Wi-Fi on Android",
      guidance:
        "Classic Bluetooth (SPP) printing is only wired up on iOS in this build. On Android, connect your mini printer over Bluetooth LE, or over Wi-Fi if it supports it.",
    };
  }
  const mod = loadMfiModule();
  if (typeof mod?.getBondedDevices === "function" && isMfiNativeLinked()) {
    return { available: true };
  }
  return describePrinterMissingModule({
    runtime: getAppRuntime(),
    transport: "Bluetooth (classic)",
    packageName: "react-native-bluetooth-classic",
  });
}

/** Report which printer transports this build/device can actually attempt. */
export function getPrinterTransportAvailability(): PrinterTransportAvailability[] {
  return [
    { kind: "wifi", ...wifiAvailability() },
    { kind: "bluetooth", ...bleAvailability() },
    { kind: "bluetooth-classic", ...classicAvailability() },
  ];
}

export function printerTransportAvailability(
  kind: PrinterTransportKind,
): PrinterTransportAvailability {
  return getPrinterTransportAvailability().find((a) => a.kind === kind) as PrinterTransportAvailability;
}

// --- Android BLE permissions ---------------------------------------------

async function requestBlePermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const apiLevel =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10) || 0;
  const needed: string[] =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const granted: Record<string, string> = await PermissionsAndroid.requestMultiple(
    needed as any,
  );
  const denied = needed.filter((p) => granted[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new Error(
      apiLevel >= 31
        ? "Bluetooth permission denied — allow nearby-device access to reach the printer"
        : "Location permission denied — Android needs it to scan for Bluetooth printers",
    );
  }
}

async function waitForBlePoweredOn(manager: any): Promise<void> {
  const state = await manager.state();
  if (state === "PoweredOn") return;
  if (state === "PoweredOff") throw new Error("Bluetooth is turned off — turn it on and try again");
  if (state === "Unsupported") throw new Error("This device has no Bluetooth LE radio");
  if (state === "Unauthorized") throw new Error("Bluetooth access is not allowed for this app");
  let subscription: any = null;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        subscription = manager.onStateChange((next: string) => {
          if (next === "PoweredOn") resolve();
          else if (next === "PoweredOff") reject(new Error("Bluetooth is turned off"));
          else if (next === "Unsupported") reject(new Error("This device has no Bluetooth LE radio"));
          else if (next === "Unauthorized") reject(new Error("Bluetooth access is not allowed"));
        }, true);
      }),
      CONNECT_TIMEOUT_MS,
      "Bluetooth power-on",
    );
  } finally {
    subscription?.remove?.();
  }
}

// --------------------------------- Wi-Fi ---------------------------------

class WifiPrinterTransport implements PrinterTransport {
  readonly kind: PrinterTransportKind = "wifi";
  device: PrinterDeviceInfo | null = null;
  private socket: any = null;

  constructor(
    private host: string,
    private port: number,
  ) {}

  async connect(): Promise<PrinterDeviceInfo> {
    try {
      const availability = wifiAvailability();
      if (!availability.available) throw new Error(availability.reason ?? "Wi-Fi is unavailable");
      const TcpSocket = loadTcpModule();
      const info: PrinterDeviceInfo = {
        name: `${this.host}:${this.port}`,
        id: `${this.host}:${this.port}`,
        transport: "wifi",
      };
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.socket = TcpSocket.createConnection(
            { host: this.host, port: this.port },
            () => resolve(),
          );
          this.socket.on("error", (err: any) => reject(err));
        }),
        CONNECT_TIMEOUT_MS,
        "Wi-Fi connect",
      );
      this.device = info;
      return info;
    } catch (error) {
      await this.releaseHardware();
      throw error;
    }
  }

  async write(payload: string): Promise<void> {
    if (!this.socket) throw new Error("not connected");
    await new Promise<void>((resolve, reject) => {
      try {
        // The payload is ASCII (bytes ≤ 0x7F), so the default encoding sends it
        // byte-for-byte. The callback fires once it has been handed to the OS.
        this.socket.write(payload, "ascii", (err?: any) => (err ? reject(err) : resolve()));
      } catch (e) {
        reject(e);
      }
    });
  }

  private async releaseHardware(): Promise<void> {
    try {
      this.socket?.removeAllListeners?.();
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.device = null;
  }

  async disconnect(): Promise<void> {
    await this.releaseHardware();
  }
}

// ------------------------------ Bluetooth LE ------------------------------

class BlePrinterTransport implements PrinterTransport {
  readonly kind: PrinterTransportKind = "bluetooth";
  device: PrinterDeviceInfo | null = null;
  private manager: any = null;
  private peripheral: any = null;
  private serviceUuid: string | null = null;
  private writeUuid: string | null = null;
  private writeWithResponse = false;

  constructor(private nameHint: string) {}

  async connect(): Promise<PrinterDeviceInfo> {
    try {
      const availability = bleAvailability();
      if (!availability.available) throw new Error(availability.reason ?? "Bluetooth is unavailable");
      await requestBlePermissions();
      // The shared app-wide BleManager, not a per-job one. A print job used to
      // spin up its own manager and `destroy()` it on teardown, which
      // invalidated the single native BLE client the OBD-II reader's live
      // session shares — the reader's next command (the pickup odometer read)
      // then hung until it timed out, so a trip that printed a receipt could
      // not start the next hire. See `getSharedBleManager`.
      this.manager = getSharedBleManager();
      if (!this.manager) throw new Error("Bluetooth is unavailable");
      await waitForBlePoweredOn(this.manager);

      const found = await this.scanForPrinter();
      this.peripheral = await this.manager.connectToDevice(found.id, { requestMTU: 247 }).catch(
        () => this.manager.connectToDevice(found.id),
      );
      await this.peripheral.discoverAllServicesAndCharacteristics();
      await this.resolveWriteCharacteristic();
      if (!this.serviceUuid || !this.writeUuid) {
        throw new Error("Connected, but this device exposes no writable characteristic to print to");
      }
      this.device = {
        name: found.name ?? found.localName ?? "Bluetooth printer",
        id: found.id,
        transport: "bluetooth",
      };
      return this.device;
    } catch (error) {
      await this.releaseHardware();
      throw error;
    }
  }

  /** Resolve on the first advertisement whose name matches the saved printer. */
  private async scanForPrinter(): Promise<any> {
    const hint = this.nameHint.trim().toLowerCase();
    try {
      return await withTimeout(
        new Promise<any>((resolve, reject) => {
          this.manager.startDeviceScan(null, { allowDuplicates: false }, (error: any, device: any) => {
            if (error) {
              reject(error);
              return;
            }
            const name = `${device?.name ?? ""} ${device?.localName ?? ""}`.toLowerCase();
            if (hint && name.includes(hint)) resolve(device);
          });
        }),
        SCAN_TIMEOUT_MS,
        "Bluetooth scan",
      );
    } finally {
      try {
        this.manager?.stopDeviceScan?.();
      } catch {
        /* ignore */
      }
    }
  }

  /** Pick a writable characteristic — printers expose one per print service. */
  private async resolveWriteCharacteristic(): Promise<void> {
    const services = await this.peripheral.services();
    for (const service of services) {
      const characteristics = await service.characteristics();
      // Prefer write-without-response (faster for bulk ESC/POS), else with-response.
      const woResp = characteristics.find((c: any) => c.isWritableWithoutResponse);
      const wResp = characteristics.find((c: any) => c.isWritableWithResponse);
      const chosen = woResp ?? wResp;
      if (chosen) {
        this.serviceUuid = service.uuid;
        this.writeUuid = chosen.uuid;
        this.writeWithResponse = !woResp && !!wResp;
        return;
      }
    }
  }

  async write(payload: string): Promise<void> {
    if (!this.peripheral || !this.serviceUuid || !this.writeUuid) {
      throw new Error("not connected");
    }
    // A BLE characteristic write is small; ESC/POS is streamed in MTU-sized chunks.
    for (let i = 0; i < payload.length; i += BLE_CHUNK_BYTES) {
      const chunk = asciiToBase64(payload.slice(i, i + BLE_CHUNK_BYTES));
      if (this.writeWithResponse) {
        await this.peripheral.writeCharacteristicWithResponseForService(
          this.serviceUuid,
          this.writeUuid,
          chunk,
        );
      } else {
        await this.peripheral.writeCharacteristicWithoutResponseForService(
          this.serviceUuid,
          this.writeUuid,
          chunk,
        );
      }
    }
  }

  private async releaseHardware(): Promise<void> {
    try {
      this.manager?.stopDeviceScan?.();
      // Cancel only this print job's own peripheral. The shared manager is
      // never destroyed here — doing so would tear down the native BLE client
      // the OBD-II reader's live session also holds.
      await this.peripheral?.cancelConnection?.();
    } catch {
      /* ignore */
    }
    this.peripheral = null;
    this.manager = null;
    this.serviceUuid = null;
    this.writeUuid = null;
    this.device = null;
  }

  async disconnect(): Promise<void> {
    await this.releaseHardware();
  }
}

// --------------------------- Bluetooth classic ---------------------------

class ClassicPrinterTransport implements PrinterTransport {
  readonly kind: PrinterTransportKind = "bluetooth-classic";
  device: PrinterDeviceInfo | null = null;
  private module: any = null;
  private connection: any = null;
  private address = "";

  constructor(private preferredAddress?: string | null) {}

  async connect(): Promise<PrinterDeviceInfo> {
    try {
      const availability = classicAvailability();
      if (!availability.available) {
        throw new Error(availability.reason ?? "Bluetooth (classic) is unavailable");
      }
      this.module = loadMfiModule();
      const bonded: any[] = await withTimeout(
        Promise.resolve(this.module.getBondedDevices()),
        CONNECT_TIMEOUT_MS,
        "Bluetooth device lookup",
      );
      const target = this.pickBonded(bonded);
      if (!target) {
        throw new Error(
          this.preferredAddress
            ? `No paired Bluetooth device matches "${this.preferredAddress}". Pair the printer in the system Bluetooth settings first.`
            : "No paired Bluetooth printer found. Pair it in the system Bluetooth settings first.",
        );
      }
      this.address = target.address ?? target.id ?? "";
      this.connection = await withTimeout(
        Promise.resolve(this.module.connectToDevice(this.address, {})),
        CONNECT_TIMEOUT_MS,
        "Bluetooth connect",
      );
      if (!this.connection) throw new Error("Could not open a Bluetooth session with the printer");
      this.device = {
        name: target.name ?? this.address,
        id: this.address,
        transport: "bluetooth-classic",
      };
      return this.device;
    } catch (error) {
      await this.releaseHardware();
      throw error;
    }
  }

  private pickBonded(bonded: any[]): any | null {
    if (!Array.isArray(bonded) || bonded.length === 0) return null;
    const hint = (this.preferredAddress ?? "").trim().toLowerCase();
    if (!hint) return bonded[0];
    return (
      bonded.find(
        (d) =>
          String(d?.address ?? "").toLowerCase() === hint ||
          String(d?.name ?? "").toLowerCase().includes(hint),
      ) ?? null
    );
  }

  async write(payload: string): Promise<void> {
    if (!this.connection && !this.address) throw new Error("not connected");
    // The library base64-encodes the ascii text itself before it reaches native.
    if (typeof this.connection?.write === "function") {
      await this.connection.write(payload, "ascii");
      return;
    }
    await this.module.writeToDevice(this.address, payload, "ascii");
  }

  private async releaseHardware(): Promise<void> {
    try {
      if (this.connection?.disconnect) await this.connection.disconnect();
      else if (this.address) await this.module?.disconnectFromDevice?.(this.address);
    } catch {
      /* ignore */
    }
    this.connection = null;
    this.module = null;
    this.address = "";
    this.device = null;
  }

  async disconnect(): Promise<void> {
    await this.releaseHardware();
  }
}

// ------------------------------ discovery --------------------------------

/** A Bluetooth device found by an app-level scan (not the OS pairing list). */
export interface DiscoveredPrinter {
  id: string;
  name: string;
  /** Signal strength, when the platform reports it — for sorting nearest-first. */
  rssi: number | null;
  transport: "bluetooth" | "bluetooth-classic";
}

/**
 * Scan for Bluetooth **LE** printers and report the named devices found.
 *
 * This is the whole point of doing our own Bluetooth: a BLE mini printer never
 * appears in the phone's system Bluetooth list, so it can only be reached by an
 * in-app scan — exactly what a dedicated POS-printer app does. Unnamed beacons
 * are dropped (a printer always advertises a name), duplicates are collapsed to
 * the strongest sighting, and `onDevice` streams results so the UI can fill in
 * live rather than waiting for the whole window.
 */
export async function scanForBlePrinters(opts?: {
  durationMs?: number;
  onDevice?: (device: DiscoveredPrinter) => void;
}): Promise<DiscoveredPrinter[]> {
  const availability = bleAvailability();
  if (!availability.available) {
    throw new Error(availability.guidance ?? availability.reason ?? "Bluetooth LE is unavailable");
  }
  await requestBlePermissions();
  // Shared manager — an in-app scan must not create (or later destroy) a second
  // native BLE client while the OBD reader / printer sessions may be live.
  const manager = getSharedBleManager();
  if (!manager) throw new Error("Bluetooth LE is unavailable");
  const found = new Map<string, DiscoveredPrinter>();
  try {
    await waitForBlePoweredOn(manager);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, opts?.durationMs ?? SCAN_TIMEOUT_MS);
      manager.startDeviceScan(null, { allowDuplicates: true }, (error: any, device: any) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        const name = device?.name ?? device?.localName;
        if (!name || !device?.id) return;
        const rssi = typeof device.rssi === "number" ? device.rssi : null;
        const prev = found.get(device.id);
        // Keep the strongest sighting of each device across duplicate adverts.
        if (prev && (prev.rssi ?? -999) >= (rssi ?? -999)) return;
        const entry: DiscoveredPrinter = { id: device.id, name, rssi, transport: "bluetooth" };
        found.set(device.id, entry);
        opts?.onDevice?.(entry);
      });
    });
  } finally {
    // Stop this scan only; the shared manager outlives it (see scan above).
    try {
      manager.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }
  return Array.from(found.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
}

// ------------------------------- factory --------------------------------

/** Instantiate the transport for a given kind. */
export function createPrinterTransport(
  kind: PrinterTransportKind,
  options?: CreatePrinterTransportOptions,
): PrinterTransport {
  switch (kind) {
    case "wifi":
      return new WifiPrinterTransport(options?.host || "", options?.port || PRINTER_WIFI_PORT);
    case "bluetooth":
      return new BlePrinterTransport(options?.nameHint || options?.address || "");
    case "bluetooth-classic":
      return new ClassicPrinterTransport(options?.address);
  }
}

/**
 * Connect, write one ESC/POS document, and disconnect — the whole print job.
 *
 * A printer is a fire-and-forget target (unlike the OBD reader's persistent
 * session), so the transport is opened per job and always torn down, even when
 * the write throws.
 */
export async function sendToPrinter(
  kind: PrinterTransportKind,
  options: CreatePrinterTransportOptions | undefined,
  payload: string,
): Promise<PrinterDeviceInfo> {
  const transport = createPrinterTransport(kind, options);
  try {
    const device = await transport.connect();
    await transport.write(payload);
    // Give the printer a beat to flush the last bytes before the link drops —
    // some mini printers truncate the tail if the socket closes immediately.
    await new Promise((r) => setTimeout(r, 400));
    return device;
  } finally {
    await transport.disconnect();
  }
}
