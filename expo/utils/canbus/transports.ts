/**
 * Transport implementations for the CANBus / OBD-II adapter.
 *
 * Four physical links are modelled — Wi-Fi (TCP), Bluetooth LE (GATT),
 * Bluetooth MFi (Apple External Accessory), and USB serial — behind the single
 * {@link CanTransport} interface so the session client stays transport-blind.
 *
 * `react-native-tcp-socket` (Wi-Fi), `react-native-ble-plx` (Bluetooth LE) and
 * `react-native-bluetooth-classic` (Bluetooth MFi) are real dependencies, so
 * all three work in any build that ships their native side — in Expo Go, on
 * web, and in a store build made before the dependency shipped, the JS loads
 * but the native module is absent, which the transports report honestly instead
 * of failing mid-connect. Only the USB-serial driver is still an optional peer
 * dep resolved through a guarded lookup, mirroring the repo's
 * graceful-degradation convention.
 */

import { PermissionsAndroid, Platform } from "react-native";
import { getAppRuntime } from "./appRuntime";
import { describeMissingNativeModule } from "./availability";
import { getSharedBleManager, isBleNativeLinked, loadBleModule } from "./bleModule";
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
import { isTcpNativeLinked, loadTcpModule } from "./tcpModule";
import { describeWifiAvailability } from "./wifi";
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
 * modules are resolved through this static registry instead. The USB driver
 * does not ship in this build, so the lookup resolves to null and that
 * transport reports itself as unavailable. In a custom dev-client build, swap
 * the entry for a guarded static `require("<module-name>")` to enable it.
 *
 * Wi-Fi, Bluetooth LE and MFi are deliberately *not* here — their packages are
 * real dependencies loaded through `tcpModule.ts` / `bleModule.ts` /
 * `mfiModule.ts`, which is what makes them work in a store build rather than
 * only in a bespoke one. A `null` entry here is indistinguishable from "no such
 * build exists", which is exactly how Wi-Fi came to tell TestFlight drivers to
 * install a newer build that could never have contained the driver.
 */
const OPTIONAL_MODULES: Record<string, unknown> = {
  "react-native-usb-serialport-for-android": null,
};

function optionalRequire(moduleName: string): any | null {
  return (OPTIONAL_MODULES[moduleName] as any) ?? null;
}

/**
 * Wi-Fi availability, on the same two axes as the Bluetooth transports.
 *
 * `react-native-tcp-socket` is a real dependency, so the JS resolves wherever
 * the bundle runs; only the native-module lookup says whether this binary can
 * actually open a socket. Both are needed before a connect is attempted.
 *
 * `loadTcpModule` returns null unless the native side is linked — the package
 * throws at import time without it (see `tcpModule.ts`) — so `moduleInstalled`
 * reads false in exactly the builds `nativeModuleLinked` already does. The copy
 * is unaffected: `describeWifiAvailability` says the same thing whichever half
 * is missing.
 */
function wifiAvailability(): { available: boolean; reason?: string; guidance?: string } {
  const mod = loadTcpModule();
  return describeWifiAvailability({
    moduleInstalled: typeof mod?.createConnection === "function",
    nativeModuleLinked: isTcpNativeLinked(),
    platform: Platform.OS,
    runtime: getAppRuntime(),
  });
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
    try {
      return await this.openLink();
    } catch (error) {
      // A refused or timed-out connect still leaves a socket object behind with
      // its listeners attached; the caller only sees the error, so the next
      // attempt would stack a second socket on top of a live one.
      await this.releaseHardware();
      throw error;
    }
  }

  private async openLink(): Promise<CanDeviceInfo> {
    const availability = wifiAvailability();
    if (!availability.available) {
      throw new Error(availability.reason ?? "Wi-Fi is unavailable");
    }
    const TcpSocket = loadTcpModule();
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

  /** Tear the socket down — listeners survive, as on the BLE/MFi side. */
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

  /**
   * `deviceId` pins the exact peripheral picked from the in-app scan; `nameHint`
   * matches a saved name when no id is stored. With neither, the scan falls back
   * to the ELM327 advertisement heuristic — the behaviour before the picker.
   */
  constructor(
    private preferredDeviceId?: string | null,
    private nameHint?: string | null,
  ) {}

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
    await requestBlePermissions();
    // The one app-wide BleManager, never a fresh one: a second manager (and the
    // `destroy()` that would tear it down) invalidates the single native BLE
    // client this session shares with the receipt printer — see
    // `getSharedBleManager`.
    this.manager = getSharedBleManager();
    if (!this.manager) throw new Error("Bluetooth is unavailable");
    await waitForBlePoweredOn(this.manager);

    // A saved reader carries the exact peripheral id from its scan — connect to
    // it directly rather than scanning and guessing. Only a legacy reader, or an
    // "any dongle" one, falls through to the ELM327 / name scan.
    const found = this.preferredDeviceId
      ? { id: this.preferredDeviceId, name: this.nameHint ?? null, localName: null }
      : await this.scanForAdapter();
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

  /**
   * Resolve on the first matching advertisement: the saved name fragment when
   * one is stored, otherwise the first device that looks like an ELM327 dongle.
   */
  private async scanForAdapter(): Promise<any> {
    const hint = (this.nameHint ?? "").trim().toLowerCase();
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
              if (hint) {
                const name = `${device?.name ?? ""} ${device?.localName ?? ""}`.toLowerCase();
                if (name.includes(hint)) resolve(device);
              } else if (matchesElmAdvertisement(device)) {
                resolve(device);
              }
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

  /**
   * Drop the subscription, this session's scan and its connection — but never
   * the shared manager. `destroy()` on it would invalidate the one native BLE
   * client the printer also uses; only this transport's own peripheral is
   * cancelled here, which leaves the rest of the app's BLE untouched.
   */
  private async releaseHardware(): Promise<void> {
    try {
      this.sub?.remove?.();
      this.manager?.stopDeviceScan?.();
      await this.peripheral?.cancelConnection?.();
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
  const hasUsb = !!optionalRequire("react-native-usb-serialport-for-android");
  return [
    { kind: "wifi", ...wifiAvailability() },
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

/** A Bluetooth LE device found by an app-level scan of the OBD add sheet. */
export interface DiscoveredBleAdapter {
  id: string;
  name: string;
  /** Signal strength, when reported — used to sort nearest-first. */
  rssi: number | null;
  /** True when the advertisement looks like an ELM327 OBD-II dongle. */
  isElm: boolean;
}

/**
 * Scan for Bluetooth LE devices and report the named ones found, so the driver
 * can pick their reader from a list — mirroring the receipt-printer scan.
 *
 * An ELM327 BLE dongle never appears in the phone's system Bluetooth list, so
 * an in-app scan is the only way to see it. Every named device is returned (a
 * clone with a generic name is still pickable), but the ones whose
 * advertisement looks like an ELM327 sort to the top. Duplicates collapse to
 * the strongest sighting, and `onDevice` streams results as they arrive.
 */
export async function scanForBleAdapters(opts?: {
  durationMs?: number;
  onDevice?: (device: DiscoveredBleAdapter) => void;
}): Promise<DiscoveredBleAdapter[]> {
  const availability = bleAvailability();
  if (!availability.available) {
    throw new Error(availability.guidance ?? availability.reason ?? "Bluetooth LE is unavailable");
  }
  await requestBlePermissions();
  // Shared manager — a scan must not create (or later destroy) a second native
  // BLE client while the reader/printer sessions may be live.
  const manager = getSharedBleManager();
  if (!manager) throw new Error("Bluetooth LE is unavailable");
  const found = new Map<string, DiscoveredBleAdapter>();
  try {
    await waitForBlePoweredOn(manager);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, opts?.durationMs ?? BLE_SCAN_TIMEOUT_MS);
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
        if (prev && (prev.rssi ?? -999) >= (rssi ?? -999)) return;
        const entry: DiscoveredBleAdapter = {
          id: device.id,
          name,
          rssi,
          isElm: matchesElmAdvertisement(device),
        };
        found.set(device.id, entry);
        opts?.onDevice?.(entry);
      });
    });
  } finally {
    // Stop this scan, but never destroy the shared manager — other BLE
    // sessions (the OBD reader, the printer) may be relying on it.
    try {
      manager.stopDeviceScan();
    } catch {
      /* ignore */
    }
  }
  return Array.from(found.values()).sort((a, b) => {
    if (a.isElm !== b.isElm) return a.isElm ? -1 : 1;
    return (b.rssi ?? -999) - (a.rssi ?? -999);
  });
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
  /**
   * Bluetooth LE only: the exact peripheral id to connect to, from the in-app
   * scan. When set the transport skips the scan and links this device directly.
   */
  deviceId?: string;
  /**
   * Bluetooth LE only: a name fragment to match in the scan when no `deviceId`
   * is saved. Absent both, the transport falls back to the ELM327 heuristic.
   */
  nameHint?: string;
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
      return new BleTransport(options?.deviceId, options?.nameHint);
    case "mfi":
      return new MfiTransport(options?.accessory);
    case "usb":
      return new UsbTransport();
  }
}
