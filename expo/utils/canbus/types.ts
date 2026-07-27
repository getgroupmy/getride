/** Shared CANBus / OBD adapter types. */

import type { Telemetry } from "./obd";

/** How the phone/tablet is physically linked to the OBD adapter. */
export type CanTransportKind = "wifi" | "bluetooth" | "usb";

export const TRANSPORT_LABEL: Record<CanTransportKind, string> = {
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth",
  usb: "USB",
};

/** Identity of the connected adapter, surfaced in the System Status panel. */
export interface CanDeviceInfo {
  /** Friendly name, e.g. "OBDII" / "Vgate iCar Pro" / "192.168.0.10:35000". */
  name: string;
  /** Stable identifier: BLE peripheral id, MAC, or host:port. */
  id: string;
  transport: CanTransportKind;
}

/** Whether a given transport can even be attempted on this build/device. */
export interface TransportAvailability {
  kind: CanTransportKind;
  /** True when the native module backing this transport is present. */
  available: boolean;
  /** Why it is unavailable (missing native module, unsupported platform…). */
  reason?: string;
}

/**
 * Minimal duplex link to an ELM327 adapter. Implementations wrap a BLE
 * characteristic, a TCP socket, or a USB serial port. The session client
 * (canbusClient.ts) only depends on this interface, so it is transport-blind.
 */
export interface CanTransport {
  readonly kind: CanTransportKind;
  /** Populated once connected. */
  readonly device: CanDeviceInfo | null;
  connect(): Promise<CanDeviceInfo>;
  /** Write a raw command (the client appends the CR terminator). */
  write(data: string): Promise<void>;
  /**
   * Register a listener for inbound bytes. Returns an unsubscribe function.
   * Data arrives as decoded ASCII text (ELM327 speaks ASCII hex).
   */
  onData(listener: (chunk: string) => void): () => void;
  disconnect(): Promise<void>;
}

export type CanConnectionPhase =
  | "idle"
  | "scanning"
  | "connecting"
  | "handshaking"
  | "online"
  | "error";

/** Everything the UI needs to render the CANBus system-status row. */
export interface CanConnectionState {
  phase: CanConnectionPhase;
  device: CanDeviceInfo | null;
  /** Resolved CAN protocol name, e.g. "ISO 15765-4 CAN (11-bit, 500 kbps)". */
  protocol: string | null;
  bitrateKbps: number | null;
  telemetry: Telemetry;
  /** Epoch ms of the last successful telemetry read. */
  lastUpdate: number | null;
  error: string | null;
  /** True when running against the built-in simulator, not real hardware. */
  simulated: boolean;
}
