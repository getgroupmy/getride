/** Shared types for the mini thermal-printer link. */

import type { PaperWidth } from "./escpos";

/**
 * How the phone/tablet is physically linked to the receipt printer.
 *
 * `wifi` is a raw TCP socket to the printer's ESC/POS port (9100 by
 * convention). `bluetooth` is Bluetooth **Low Energy** (GATT) — the newer mini
 * printers. `bluetooth-classic` is Bluetooth **Serial Port Profile** (SPP), the
 * link almost every cheap 58 mm pocket printer uses; on Android it is the
 * bonded-device path, on iOS it is the Apple External Accessory (MFi) path, so
 * the two share one transport the way the OBD side keeps them separate.
 */
export type PrinterTransportKind = "wifi" | "bluetooth" | "bluetooth-classic";

export const PRINTER_TRANSPORT_LABEL: Record<PrinterTransportKind, string> = {
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth LE",
  "bluetooth-classic": "Bluetooth (classic)",
};

/** Every transport kind, in the order the pickers list them. */
export const PRINTER_TRANSPORT_KINDS: PrinterTransportKind[] = [
  "wifi",
  "bluetooth",
  "bluetooth-classic",
];

/** The raw-ESC/POS TCP port virtually every network printer listens on. */
export const PRINTER_WIFI_PORT = 9100;

/** Identity of the connected printer, surfaced in the printer panel. */
export interface PrinterDeviceInfo {
  /** Friendly name, e.g. "MTP-II" / "192.168.0.50:9100". */
  name: string;
  /** Stable identifier: BLE peripheral id, MAC/address, or host:port. */
  id: string;
  transport: PrinterTransportKind;
}

/** Whether a given transport can even be attempted on this build/device. */
export interface PrinterTransportAvailability {
  kind: PrinterTransportKind;
  available: boolean;
  /** Short reason it is unavailable (missing native module, web…). */
  reason?: string;
  /** The longer, driver-facing version for an alert. */
  guidance?: string;
}

/**
 * A one-shot ESC/POS link. Unlike the OBD transport there is no read side —
 * a receipt printer is written to and closed — so the interface is just
 * connect / write bytes / disconnect.
 */
export interface PrinterTransport {
  readonly kind: PrinterTransportKind;
  readonly device: PrinterDeviceInfo | null;
  connect(): Promise<PrinterDeviceInfo>;
  /**
   * Write an ESC/POS document. `payload` is the string produced by
   * `buildMeterReceiptEscpos` — every byte ≤ 0x7F, so it travels as ASCII.
   */
  write(payload: string): Promise<void>;
  disconnect(): Promise<void>;
}

/** Per-connection overrides passed to `createPrinterTransport`. */
export interface CreatePrinterTransportOptions {
  /** Wi-Fi: the printer's TCP endpoint. */
  host?: string;
  port?: number;
  /**
   * Bluetooth classic: the bonded device's address (or the exact name iOS/
   * Android shows). BLE: an optional name fragment to match the peripheral on.
   */
  address?: string;
  /** BLE: name fragment to pick the printer out of the scan. */
  nameHint?: string;
}

export type { PaperWidth };
