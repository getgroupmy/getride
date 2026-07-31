/**
 * Transport implementations for the CANBus / OBD-II adapter.
 *
 * Four physical links are modelled — Wi-Fi (TCP), Bluetooth LE (GATT),
 * Bluetooth MFi (Apple External Accessory), and USB serial — behind the single
 * {@link CanTransport} interface so the session client stays transport-blind.
 *
 * `react-native-ble-plx` (Bluetooth LE) and `react-native-bluetooth-classic`
 * (Bluetooth MFi) are real dependencies, so both work in any build that ships
 * their native side — in Expo Go, on web, and in a store build made before the
 * dependency shipped, the JS loads but the native module is absent, which the
 * transports report honestly instead of failing mid-connect. The remaining two
 * modules (`react-native-tcp-socket`, a USB-serial driver) are still optional
 * peer deps resolved through a guarded lookup, mirroring the repo's
 * graceful-degradation convention.
 */

import { PermissionsAndroid, Platform } from "react-native";
import { getAppRuntime } from "./appRuntime";
import { describeMissingNativeModule, describeWebUnsupported } from "./availability";
import { isBleNativeLinked, loadBleModule } from "./bleModule";
import {
  describeBleAvailability,
  matchesElmAdvertisement,
  resolveBleProfile,
  type BleServiceLike,
  type ResolvedBleProfile,
} from "./ble";
import {
  accessoryAddress,
  accessoryLabel,
  describeMfiAvailability,
  describeMfiSelectionFailure,
  mfiConnectionOptions,
  pickMfiAccessory,
  type MfiAccessoryLike,
} from "./mfi";
import { isMfiNativeLinked, loadMfiModule } from "./mfiModule";
import {
  BLE_POWER_ON_TIMEOUT_MS,
  BLE_SCAN_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  MFI_DISCOVERY_TIMEOUT_MS,
  WIFI_ADAPTER_HOST,
  WIFI_ADAPTER_PORT,
} from "./config";
import { ELM_CR, ELM_PROMPT } from "./obd";
import type {
  CanDeviceInfo,
  CanTransport,
  CanTransportKind,
  TransportAvailability,
} from "./types";

/**
 * Best-effort optional module lookup that never throws.
 *
 * Metro cannot bundle dynamic `require(name)` calls, so optional native
 * modules are resolved through this static registry instead. Neither ships in
 * Expo Go / this managed build, so the lookup resolves to null and those
 * transports report themselves as unavailable. In a custom dev-client build,
 * swap an entry for a guarded static `require("<module-name>")` to enable it.
 *
 * Bluetooth LE and MFi are deliberately *not* here — their packages are real
 * dependencies loaded through `bleModule.ts` / `mfiModule.ts`, which is what
 * makes them work in a store build rather than only in a bespoke one.
 */
const OPTIONAL_MODULES: Record<string, unknown> = {
  "react-native-tcp-socket": null,
  "react-native-usb-serialport-for-android": null,
};

function optionalRequire(moduleName: string): any | null {
  return (OPTIONAL_MODULES[moduleName] as any) ?? null;
}

/**
 * Bluetooth LE availability: the package is installed, but its native side
 * only exists in a binary prebuilt with the config plugin. Expo Go loads the JS
 * and has no `BlePlx` native module, and a store/TestFlight build made before
 * the dependency was added has neither — every manager call would throw
 * mid-connect, so both are reported up front.
 */
function bleAvailability(): { available: boolean; reason?: string; guidance?: string } {
  return describeBleAvailability({
    moduleInstalled: !!loadBleModule()?.BleManager,
    nativeModuleLinked: isBleNativeLinked(),
    platform: Platform.OS,
    runtime: getAppRuntime(),
  });
}

/**
 * Bluetooth MFi availability, on the same two axes as BLE.
 *
 * The JS half of `react-native-bluetooth-classic` always resolves — it is a
 * real dependency — and exposes `getBondedDevices` whether or not a native
 * module is behind it, so "the package is here" says nothing about whether this
 * binary can reach an accessory. Only the native-module lookup does, and
 * without it every call would reject (or crash) mid-connect.
 */
function mfiAvailability(): { available: boolean; reason?: string; guidance?: string } {
  const mod = loadMfiModule();
  return describeMfiAvailability({
    moduleInstalled: typeof mod?.getBondedDevices === "function",
    nativeModuleLinked: isMfiNativeLinked(),
    platform: Platform.OS,
    runtime: getAppRuntime(),
  });
}

// --- tiny base64 codec (BLE characteristics ferry base64, no Buffer in RN) ---

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

export function base64ToAscii(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = B64.indexOf(clean[i]);
    const e1 = B64.indexOf(clean[i + 1]);
    const e2 = B64.indexOf(clean[i + 2]);
    const e3 = B64.indexOf(clean[i + 3]);
    const c0 = (e0 << 2) | (e1 >> 4);
    out += String.fromCharCode(c0);
    if (e2 !== -1) out += String.fromCharCode(((e1 & 15) << 4) | (e2 >> 2));
    if (e3 !== -1) out += String.fromCharCode(((e2 & 3) << 6) | e3);
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

// --------------------------------- Wi-Fi ---------------------------------

class WifiTransport implements CanTransport {
  readonly kind: CanTransportKind = "wifi";
  device: CanDeviceInfo | null = null;
  private socket: any = null;
  private listeners = new Set<(chunk: string) => void>();

  constructor(
    private host = WIFI_ADAPTER_HOST,
    private port = WIFI_ADAPTER_PORT,
  ) {}

  async connect(): Promise<CanDeviceInfo> {
    const TcpSocket = optionalRequire("react-native-tcp-socket")?.default;
    if (!TcpSocket) throw new Error("react-native-tcp-socket not installed");
    const info: CanDeviceInfo = {
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
        this.socket.on("data", (data: any) => {
          const text = typeof data === "string" ? data : data.toString("utf8");
          this.listeners.forEach((l) => l(text));
        });
        this.socket.on("error", (err: any) => reject(err));
      }),
      CONNECT_TIMEOUT_MS,
      "Wi-Fi connect",
    );
    this.device = info;
    return info;
  }

  async write(data: string): Promise<void> {
    if (!this.socket) throw new Error("not connected");
    this.socket.write(data + ELM_CR);
  }

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.device = null;
    this.listeners.clear();
  }
}

// ------------------------------- Bluetooth -------------------------------

/**
 * Ask for the runtime permissions a BLE scan needs. Android 12+ has dedicated
 * Bluetooth permissions; below that a scan counts as a location fix and needs
 * ACCESS_FINE_LOCATION. iOS handles this through the Info.plist usage string.
 */
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
  const denied = needed.filter(
    (p) => granted[p] !== PermissionsAndroid.RESULTS.GRANTED,
  );
  if (denied.length > 0) {
    throw new Error(
      apiLevel >= 31
        ? "Bluetooth permission denied — allow nearby-device access to use the reader"
        : "Location permission denied — Android needs it to scan for Bluetooth readers",
    );
  }
}

/**
 * Wait for the radio to report `PoweredOn`. iOS reports `Unknown` for a beat
 * after the manager is created, so a bare state check would spuriously fail;
 * the terminal states get their own actionable message instead.
 */
async function waitForBlePoweredOn(manager: any): Promise<void> {
  const state = await manager.state();
  if (state === "PoweredOn") return;
  if (state === "PoweredOff") {
    throw new Error("Bluetooth is turned off — turn it on and try again");
  }
  if (state === "Unsupported") {
    throw new Error("This device has no Bluetooth LE radio");
  }
  if (state === "Unauthorized") {
    throw new Error("Bluetooth access is not allowed for this app");
  }
  let subscription: any = null;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        subscription = manager.onStateChange((next: string) => {
          if (next === "PoweredOn") resolve();
          else if (next === "PoweredOff") {
            reject(new Error("Bluetooth is turned off — turn it on and try again"));
          } else if (next === "Unsupported") {
            reject(new Error("This device has no Bluetooth LE radio"));
          } else if (next === "Unauthorized") {
            reject(new Error("Bluetooth access is not allowed for this app"));
          }
        }, true);
      }),
      BLE_POWER_ON_TIMEOUT_MS,
      "Bluetooth power-on",
    );
  } finally {
    subscription?.remove?.();
  }
}

class BleTransport implements CanTransport {
  readonly kind: CanTransportKind = "bluetooth";
  device: CanDeviceInfo | null = null;
  private manager: any = null;
  private peripheral: any = null;
  private sub: any = null;
  private profile: ResolvedBleProfile | null = null;
  private listeners = new Set<(chunk: string) => void>();

  async connect(): Promise<CanDeviceInfo> {
    try {
      return await this.openLink();
    } catch (error) {
      // A half-open link would leave the manager (and possibly a running scan)
      // alive; the caller only ever sees the error, so clean up before it.
      await this.releaseHardware();
      throw error;
    }
  }

  private async openLink(): Promise<CanDeviceInfo> {
    const availability = bleAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? "Bluetooth is unavailable");
    }
    const ble = loadBleModule();
    await requestBlePermissions();
    this.manager = new ble.BleManager();
    await waitForBlePoweredOn(this.manager);

    const found = await this.scanForAdapter();
    this.peripheral = await this.manager.connectToDevice(found.id);
    await this.peripheral.discoverAllServicesAndCharacteristics();
    this.profile = await this.resolveProfile();
    if (!this.profile) {
      throw new Error(
        "Connected, but this device exposes no ELM327 serial characteristic",
      );
    }

    this.sub = this.peripheral.monitorCharacteristicForService(
      this.profile.serviceUuid,
      this.profile.notifyUuid,
      (error: any, characteristic: any) => {
        if (error || !characteristic?.value) return;
        const text = base64ToAscii(characteristic.value);
        this.listeners.forEach((l) => l(text));
      },
    );

    this.device = {
      name: found.name ?? found.localName ?? "OBD adapter",
      id: found.id,
      transport: "bluetooth",
    };
    return this.device;
  }

  /** Resolve on the first advertisement that looks like an ELM327 dongle. */
  private async scanForAdapter(): Promise<any> {
    try {
      return await withTimeout(
        new Promise<any>((resolve, reject) => {
          this.manager.startDeviceScan(
            null,
            { allowDuplicates: false },
            (error: any, device: any) => {
              if (error) {
                reject(error);
                return;
              }
              if (matchesElmAdvertisement(device)) resolve(device);
            },
          );
        }),
        BLE_SCAN_TIMEOUT_MS,
        "Bluetooth scan",
      );
    } finally {
      // Always stop the radio scanning — on the timeout path nothing else will.
      try {
        this.manager?.stopDeviceScan?.();
      } catch {
        /* ignore */
      }
    }
  }

  /** Map the peripheral's discovered GATT tree onto a known serial profile. */
  private async resolveProfile(): Promise<ResolvedBleProfile | null> {
    const services = await this.peripheral.services();
    const described: BleServiceLike[] = await Promise.all(
      services.map(async (service: any) => ({
        uuid: service.uuid,
        characteristics: await service.characteristics(),
      })),
    );
    return resolveBleProfile(described);
  }

  async write(data: string): Promise<void> {
    if (!this.peripheral || !this.profile) throw new Error("not connected");
    const payload = asciiToBase64(data + ELM_CR);
    if (this.profile.writeWithResponse) {
      await this.peripheral.writeCharacteristicWithResponseForService(
        this.profile.serviceUuid,
        this.profile.writeUuid,
        payload,
      );
    } else {
      await this.peripheral.writeCharacteristicWithoutResponseForService(
        this.profile.serviceUuid,
        this.profile.writeUuid,
        payload,
      );
    }
  }

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop the subscription, scan, connection and manager — listeners survive. */
  private async releaseHardware(): Promise<void> {
    try {
      this.sub?.remove?.();
      this.manager?.stopDeviceScan?.();
      await this.peripheral?.cancelConnection?.();
      this.manager?.destroy?.();
    } catch {
      /* ignore */
    }
    this.sub = null;
    this.peripheral = null;
    this.manager = null;
    this.profile = null;
    this.device = null;
  }

  async disconnect(): Promise<void> {
    await this.releaseHardware();
    this.listeners.clear();
  }
}

// ----------------------------- Bluetooth MFi -----------------------------

/**
 * Apple External Accessory (MFi) link to a classic-Bluetooth ELM327.
 *
 * Unlike BLE there is no scan: iOS only ever exposes accessories the driver
 * has already paired in Settings *and* whose protocol string the app declares
 * in `UISupportedExternalAccessoryProtocols`, so connecting is "list the
 * paired accessories, pick ours, open a session".
 *
 * The session's framing and character set come from {@link mfiConnectionOptions},
 * which documents why the stream is delimited on the ELM327 prompt and why the
 * charset has to be a number.
 */
class MfiTransport implements CanTransport {
  readonly kind: CanTransportKind = "mfi";
  device: CanDeviceInfo | null = null;
  private module: any = null;
  private connection: any = null;
  private sub: any = null;
  private address = "";
  private listeners = new Set<(chunk: string) => void>();

  /** Name/address of the paired accessory to use; empty = first match. */
  constructor(private preferredAccessory?: string | null) {}

  async connect(): Promise<CanDeviceInfo> {
    try {
      return await this.openLink();
    } catch (error) {
      // Never leave a half-open accessory session behind — iOS keeps it open
      // until the app closes it, and the next attempt would then be refused.
      await this.releaseHardware();
      throw error;
    }
  }

  private async openLink(): Promise<CanDeviceInfo> {
    const availability = mfiAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? "Bluetooth MFi is unavailable");
    }
    this.module = loadMfiModule();

    const paired: MfiAccessoryLike[] = await withTimeout(
      Promise.resolve(this.module.getBondedDevices()),
      MFI_DISCOVERY_TIMEOUT_MS,
      "MFi accessory lookup",
    );
    const target = pickMfiAccessory(paired, this.preferredAccessory);
    if (!target) {
      throw new Error(describeMfiSelectionFailure(paired, this.preferredAccessory));
    }
    this.address = accessoryAddress(target);
    if (!this.address) {
      throw new Error("The paired accessory reported no address");
    }

    this.connection = await withTimeout(
      Promise.resolve(
        this.module.connectToDevice(this.address, mfiConnectionOptions(ELM_PROMPT)),
      ),
      CONNECT_TIMEOUT_MS,
      "MFi connect",
    );
    if (!this.connection) {
      throw new Error(`Could not open a session with ${accessoryLabel(target)}`);
    }

    this.sub = this.connection.onDataReceived?.((event: any) => {
      const text = typeof event?.data === "string" ? event.data : "";
      if (!text) return;
      // The library strips the delimiter it split on; the client frames
      // responses by it, so put it back.
      this.listeners.forEach((l) => l(text + ELM_PROMPT));
    });

    this.device = {
      name: accessoryLabel(target),
      id: this.address,
      transport: "mfi",
    };
    return this.device;
  }

  async write(data: string): Promise<void> {
    if (!this.connection) throw new Error("not connected");
    const payload = data + ELM_CR;
    // Hand both paths the *plain* command and let the library encode it. Its
    // `writeToDevice` already does `Buffer.from(text, encoding).toString("base64")`
    // before it reaches the native side, so base64-ing first would send the
    // dongle a double-encoded string it can only answer with `?`.
    if (typeof this.connection.write === "function") {
      await this.connection.write(payload, "ascii");
      return;
    }
    await this.module.writeToDevice(this.address, payload, "ascii");
  }

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Close the accessory session — listeners survive, as on the BLE side. */
  private async releaseHardware(): Promise<void> {
    try {
      this.sub?.remove?.();
      if (this.connection?.disconnect) await this.connection.disconnect();
      else if (this.address) await this.module?.disconnectFromDevice?.(this.address);
    } catch {
      /* ignore */
    }
    this.sub = null;
    this.connection = null;
    this.module = null;
    this.address = "";
    this.device = null;
  }

  async disconnect(): Promise<void> {
    await this.releaseHardware();
    this.listeners.clear();
  }
}

// ---------------------------------- USB ----------------------------------

class UsbTransport implements CanTransport {
  readonly kind: CanTransportKind = "usb";
  device: CanDeviceInfo | null = null;
  private port: any = null;
  private listeners = new Set<(chunk: string) => void>();

  async connect(): Promise<CanDeviceInfo> {
    // USB-serial OBD adapters are Android-host only; there is no supported
    // path on iOS. A driver module (e.g. react-native-usb-serialport-for-android)
    // must be installed for this to resolve.
    const usb = optionalRequire("react-native-usb-serialport-for-android");
    if (!usb) throw new Error("USB serial module not installed");
    const devices = await usb.UsbSerialManager.list();
    if (!devices?.length) throw new Error("no USB serial device attached");
    const target = devices[0];
    await usb.UsbSerialManager.tryRequestPermission(target.deviceId);
    this.port = await usb.UsbSerialManager.open(target.deviceId, {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 0,
    });
    this.port.onReceived((event: any) => {
      const text = base64ToAscii(event.data);
      this.listeners.forEach((l) => l(text));
    });
    this.device = {
      name: target.productName ?? `USB ${target.deviceId}`,
      id: String(target.deviceId),
      transport: "usb",
    };
    return this.device;
  }

  async write(data: string): Promise<void> {
    if (!this.port) throw new Error("not connected");
    await this.port.send(asciiToBase64(data + ELM_CR));
  }

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    try {
      await this.port?.close?.();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.device = null;
    this.listeners.clear();
  }
}

// ------------------------------- discovery -------------------------------

/** Report which transports this build/device can actually attempt. */
export function getTransportAvailability(): TransportAvailability[] {
  const runtime = getAppRuntime();
  const hasTcp = !!optionalRequire("react-native-tcp-socket");
  const hasUsb = !!optionalRequire("react-native-usb-serialport-for-android");
  return [
    {
      kind: "wifi",
      ...(Platform.OS === "web"
        ? describeWebUnsupported("Wi-Fi")
        : hasTcp
          ? { available: true }
          : describeMissingNativeModule({
              runtime,
              transport: "Wi-Fi",
              packageName: "react-native-tcp-socket",
            })),
    },
    { kind: "bluetooth", ...bleAvailability() },
    { kind: "mfi", ...mfiAvailability() },
    {
      kind: "usb",
      ...(Platform.OS !== "android"
        ? {
            available: false as const,
            reason:
              Platform.OS === "web"
                ? "not supported on web"
                : "USB host only supported on Android",
            guidance:
              "USB OBD-II readers need Android's USB host mode. On this device, connect the reader over Bluetooth or Wi-Fi instead.",
          }
        : hasUsb
          ? { available: true }
          : describeMissingNativeModule({
              runtime,
              transport: "USB",
              packageName: "react-native-usb-serialport-for-android",
            })),
    },
  ];
}

/**
 * Per-connection overrides for the two transports a driver can pin down.
 *
 * Wi-Fi dongles have an address that varies by clone (some ship on
 * 192.168.0.10:35000, others on 192.168.1.5:35000). MFi accessories are chosen
 * out of the phone's paired list, which may hold more than one, so a saved
 * reader can name the one it means. BLE and USB readers are always found by
 * scan and take no options.
 */
export interface CreateTransportOptions {
  host?: string;
  port?: number;
  /** MFi only: name or address of the paired accessory to link with. */
  accessory?: string;
}

/** Instantiate the transport for a given kind. */
export function createTransport(
  kind: CanTransportKind,
  options?: CreateTransportOptions,
): CanTransport {
  switch (kind) {
    case "wifi":
      return new WifiTransport(
        options?.host || WIFI_ADAPTER_HOST,
        options?.port || WIFI_ADAPTER_PORT,
      );
    case "bluetooth":
      return new BleTransport();
    case "mfi":
      return new MfiTransport(options?.accessory);
    case "usb":
      return new UsbTransport();
  }
}
