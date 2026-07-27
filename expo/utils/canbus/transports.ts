/**
 * Transport implementations for the CANBus / OBD-II adapter.
 *
 * Three physical links are modelled — Wi-Fi (TCP), Bluetooth (BLE), and USB
 * serial — behind the single {@link CanTransport} interface so the session
 * client stays transport-blind.
 *
 * The native modules these wrap (`react-native-tcp-socket`,
 * `react-native-ble-plx`, a USB-serial module) are optional peer deps that
 * only exist in a custom dev-client / production build. Every reference to
 * them goes through a guarded `require`, so the app still compiles and runs
 * (in Expo Go, on web) when they are absent — it simply reports the transport
 * as unavailable, mirroring the repo's graceful-degradation convention.
 */

import { Platform } from "react-native";
import {
  BLE_ELM_NOTIFY_CHAR,
  BLE_ELM_SERVICE,
  BLE_ELM_WRITE_CHAR,
  BLE_NAME_HINTS,
  CONNECT_TIMEOUT_MS,
  WIFI_ADAPTER_HOST,
  WIFI_ADAPTER_PORT,
} from "./config";
import { ELM_CR } from "./obd";
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
 * modules are resolved through this static registry instead. None of them
 * ship in Expo Go / this managed build, so every lookup resolves to null and
 * the transports simply report themselves as unavailable. In a custom
 * dev-client build, swap an entry for a guarded static
 * `require("<module-name>")` to enable that transport.
 */
const OPTIONAL_MODULES: Record<string, unknown> = {
  "react-native-tcp-socket": null,
  "react-native-ble-plx": null,
  "react-native-usb-serialport-for-android": null,
};

function optionalRequire(moduleName: string): any | null {
  return (OPTIONAL_MODULES[moduleName] as any) ?? null;
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

class BleTransport implements CanTransport {
  readonly kind: CanTransportKind = "bluetooth";
  device: CanDeviceInfo | null = null;
  private manager: any = null;
  private peripheral: any = null;
  private sub: any = null;
  private listeners = new Set<(chunk: string) => void>();

  async connect(): Promise<CanDeviceInfo> {
    const ble = optionalRequire("react-native-ble-plx");
    if (!ble?.BleManager) throw new Error("react-native-ble-plx not installed");
    this.manager = new ble.BleManager();

    const found = await withTimeout(
      new Promise<any>((resolve, reject) => {
        this.manager.startDeviceScan(null, null, (error: any, device: any) => {
          if (error) {
            reject(error);
            return;
          }
          const name = (device?.name ?? device?.localName ?? "").toUpperCase();
          if (name && BLE_NAME_HINTS.some((h) => name.includes(h))) {
            this.manager.stopDeviceScan();
            resolve(device);
          }
        });
      }),
      CONNECT_TIMEOUT_MS,
      "BLE scan",
    );

    this.peripheral = await found.connect();
    await this.peripheral.discoverAllServicesAndCharacteristics();

    this.sub = this.peripheral.monitorCharacteristicForService(
      BLE_ELM_SERVICE,
      BLE_ELM_NOTIFY_CHAR,
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

  async write(data: string): Promise<void> {
    if (!this.peripheral) throw new Error("not connected");
    await this.peripheral.writeCharacteristicWithResponseForService(
      BLE_ELM_SERVICE,
      BLE_ELM_WRITE_CHAR,
      asciiToBase64(data + ELM_CR),
    );
  }

  onData(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    try {
      this.sub?.remove?.();
      await this.peripheral?.cancelConnection?.();
      this.manager?.destroy?.();
    } catch {
      /* ignore */
    }
    this.sub = null;
    this.peripheral = null;
    this.manager = null;
    this.device = null;
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
  const hasTcp = !!optionalRequire("react-native-tcp-socket");
  const hasBle = !!optionalRequire("react-native-ble-plx")?.BleManager;
  const hasUsb = !!optionalRequire("react-native-usb-serialport-for-android");
  return [
    {
      kind: "wifi",
      available: hasTcp && Platform.OS !== "web",
      reason: !hasTcp
        ? "react-native-tcp-socket not installed"
        : Platform.OS === "web"
          ? "not supported on web"
          : undefined,
    },
    {
      kind: "bluetooth",
      available: hasBle && Platform.OS !== "web",
      reason: !hasBle
        ? "react-native-ble-plx not installed"
        : Platform.OS === "web"
          ? "not supported on web"
          : undefined,
    },
    {
      kind: "usb",
      available: hasUsb && Platform.OS === "android",
      reason: !hasUsb
        ? "USB serial module not installed"
        : Platform.OS !== "android"
          ? "USB host only supported on Android"
          : undefined,
    },
  ];
}

/** Instantiate the transport for a given kind. */
export function createTransport(kind: CanTransportKind): CanTransport {
  switch (kind) {
    case "wifi":
      return new WifiTransport();
    case "bluetooth":
      return new BleTransport();
    case "usb":
      return new UsbTransport();
  }
}
