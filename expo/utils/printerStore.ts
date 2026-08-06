/**
 * Saved mini thermal printers.
 *
 * Like the OBD adapter book, a receipt printer is a physical device paired to
 * one phone, so the list is device-local (AsyncStorage) rather than a Supabase
 * table — no migration, works offline, in line with the graceful-degradation
 * convention the other `utils/*Store.ts` modules follow.
 *
 * The pure helpers (draft normalisation/validation, list mutation, labelling)
 * are exported separately from the async persistence layer so they can be
 * unit-tested without touching storage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuidv4 } from "@/utils/supabase";
import type { PaperWidth } from "@/utils/printer/escpos";
import {
  PRINTER_TRANSPORT_KINDS,
  PRINTER_TRANSPORT_LABEL,
  PRINTER_WIFI_PORT,
  type CreatePrinterTransportOptions,
  type PrinterTransportKind,
} from "@/utils/printer/types";

export const PRINTERS_KEY = "@meter_printers_v1";
export const SELECTED_PRINTER_KEY = "@meter_selected_printer_v1";

const PAPER_WIDTHS: PaperWidth[] = ["58mm", "80mm"];

/** A receipt printer the driver has added on this device. */
export interface SavedPrinter {
  id: string;
  /** Friendly name the driver typed, e.g. "MTP-II". */
  name: string;
  transport: PrinterTransportKind;
  /** Wi-Fi printers only: the printer's TCP endpoint. */
  host?: string;
  port?: number;
  /**
   * Bluetooth classic only: the bonded device's address (or the exact name).
   * Bluetooth LE: the name fragment the scan matches on (required, since a BLE
   * printer is found by scanning rather than from a bonded list).
   */
  address?: string;
  paperWidth: PaperWidth;
  createdAt: string;
  /** Epoch-ms of the last successful print, used to sort the list. */
  lastConnectedAt?: number | null;
}

/** What the "Add printer" form collects, before validation. */
export interface PrinterDraft {
  name?: string;
  transport: PrinterTransportKind;
  host?: string;
  port?: string | number;
  address?: string;
  paperWidth?: PaperWidth;
}

export interface PrinterValidationResult {
  ok: boolean;
  error?: string;
  value?: Omit<SavedPrinter, "id" | "createdAt">;
}

const HOSTNAME_RE = /^[A-Za-z0-9._-]+$/;

function normalizePaper(width: PaperWidth | undefined): PaperWidth {
  return width && PAPER_WIDTHS.includes(width) ? width : "58mm";
}

/**
 * Validate + normalise an "Add printer" draft.
 *
 * Wi-Fi printers need a reachable `host:port` (defaulted to the raw ESC/POS
 * port 9100); a Bluetooth LE printer is found by scanning, so it needs a name
 * to match on; a classic printer names the bonded device (or is left blank to
 * take the first paired one).
 */
export function normalizePrinterDraft(draft: PrinterDraft): PrinterValidationResult {
  const transport = draft.transport;
  if (!PRINTER_TRANSPORT_KINDS.includes(transport)) {
    return { ok: false, error: "Pick how the printer connects." };
  }

  const name = (draft.name ?? "").trim();
  if (name.length > 60) {
    return { ok: false, error: "Name must be 60 characters or fewer." };
  }
  const paperWidth = normalizePaper(draft.paperWidth);

  if (transport === "wifi") {
    const host = String(draft.host ?? "").trim();
    if (!host) return { ok: false, error: "Enter the printer's IP address." };
    if (!HOSTNAME_RE.test(host)) {
      return { ok: false, error: "Enter a valid IP address or hostname." };
    }
    const rawPort =
      draft.port === undefined || draft.port === "" ? PRINTER_WIFI_PORT : draft.port;
    const port = typeof rawPort === "number" ? rawPort : Number(String(rawPort).trim());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: "Port must be a whole number between 1 and 65535." };
    }
    return {
      ok: true,
      value: {
        name: name || `Wi-Fi printer`,
        transport,
        host,
        port,
        paperWidth,
        lastConnectedAt: null,
      },
    };
  }

  if (transport === "bluetooth") {
    const address = (draft.address ?? "").trim();
    if (!address) {
      return {
        ok: false,
        error: "Enter the Bluetooth name shown on the printer so it can be found by scan.",
      };
    }
    if (address.length > 60) {
      return { ok: false, error: "Bluetooth name must be 60 characters or fewer." };
    }
    return {
      ok: true,
      value: {
        name: name || address || `Bluetooth LE printer`,
        transport,
        address,
        paperWidth,
        lastConnectedAt: null,
      },
    };
  }

  // bluetooth-classic
  const address = (draft.address ?? "").trim();
  if (address.length > 60) {
    return { ok: false, error: "Paired name must be 60 characters or fewer." };
  }
  return {
    ok: true,
    value: {
      name: name || address || `Bluetooth printer`,
      transport,
      ...(address ? { address } : {}),
      paperWidth,
      lastConnectedAt: null,
    },
  };
}

/** Human label for a saved printer, e.g. "Wi-Fi · 192.168.0.50:9100 · 58mm". */
export function describePrinter(printer: SavedPrinter): string {
  const label = PRINTER_TRANSPORT_LABEL[printer.transport];
  const paper = ` · ${printer.paperWidth}`;
  if (printer.transport === "wifi" && printer.host) {
    return `${label} · ${printer.host}:${printer.port ?? PRINTER_WIFI_PORT}${paper}`;
  }
  if (printer.address) return `${label} · ${printer.address}${paper}`;
  if (printer.transport === "bluetooth-classic") {
    return `${label} · paired device${paper}`;
  }
  return `${label}${paper}`;
}

/**
 * Two entries describe the same physical printer when they share a transport
 * and its addressing — a Wi-Fi endpoint, or a Bluetooth address/name.
 */
function isSameDevice(a: SavedPrinter, b: SavedPrinter): boolean {
  if (a.id === b.id) return true;
  if (a.transport !== b.transport) return false;
  if (b.transport === "wifi") return a.host === b.host && a.port === b.port;
  return (a.address ?? "").toLowerCase() === (b.address ?? "").toLowerCase();
}

export function findSamePrinter(list: SavedPrinter[], printer: SavedPrinter): SavedPrinter | null {
  return list.find((p) => isSameDevice(p, printer)) ?? null;
}

/**
 * Insert or replace a printer, de-duplicating on the physical device so
 * re-adding the same printer updates its entry instead of stacking copies.
 */
export function upsertPrinter(list: SavedPrinter[], printer: SavedPrinter): SavedPrinter[] {
  const existing = findSamePrinter(list, printer);
  if (!existing) return [...list, printer];
  return list.map((p) =>
    p.id === existing.id ? { ...printer, id: existing.id, createdAt: existing.createdAt } : p,
  );
}

export function removePrinter(list: SavedPrinter[], id: string): SavedPrinter[] {
  return list.filter((p) => p.id !== id);
}

/**
 * Resolve which printer should be used: the explicitly selected one when it
 * still exists, otherwise the most recently used, otherwise the first.
 */
export function pickDefaultPrinter(
  list: SavedPrinter[],
  selectedId?: string | null,
): SavedPrinter | null {
  if (list.length === 0) return null;
  if (selectedId) {
    const hit = list.find((p) => p.id === selectedId);
    if (hit) return hit;
  }
  const used = list
    .filter((p) => typeof p.lastConnectedAt === "number")
    .sort((a, b) => (b.lastConnectedAt as number) - (a.lastConnectedAt as number));
  return used[0] ?? list[0];
}

/** Connection options for `createPrinterTransport`, from a saved printer. */
export function printerTransportOptions(
  printer: SavedPrinter | null | undefined,
): CreatePrinterTransportOptions | undefined {
  if (!printer) return undefined;
  if (printer.transport === "wifi") return { host: printer.host, port: printer.port };
  if (printer.transport === "bluetooth") return { nameHint: printer.address };
  if (printer.address) return { address: printer.address };
  return undefined;
}

// ----------------------------- persistence -----------------------------

function parsePrinters(raw: string | null): SavedPrinter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is SavedPrinter =>
          !!p && typeof p.id === "string" && typeof p.transport === "string",
      )
      .map((p) => ({ ...p, paperWidth: normalizePaper(p.paperWidth) }));
  } catch {
    return [];
  }
}

export async function loadPrinters(): Promise<SavedPrinter[]> {
  try {
    return parsePrinters(await AsyncStorage.getItem(PRINTERS_KEY));
  } catch (e) {
    console.log("[printers] load failed", e);
    return [];
  }
}

export async function savePrinters(list: SavedPrinter[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PRINTERS_KEY, JSON.stringify(list));
  } catch (e) {
    console.log("[printers] save failed", e);
  }
}

export async function loadSelectedPrinterId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SELECTED_PRINTER_KEY);
  } catch (e) {
    console.log("[printers] selection load failed", e);
    return null;
  }
}

export async function setSelectedPrinterId(id: string | null): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(SELECTED_PRINTER_KEY, id);
    else await AsyncStorage.removeItem(SELECTED_PRINTER_KEY);
  } catch (e) {
    console.log("[printers] selection save failed", e);
  }
}

/** Validate a draft, persist it, select it, and return the updated list. */
export async function addPrinter(
  draft: PrinterDraft,
): Promise<{ printers: SavedPrinter[]; printer?: SavedPrinter; error?: string }> {
  const result = normalizePrinterDraft(draft);
  if (!result.ok || !result.value) {
    return { printers: await loadPrinters(), error: result.error };
  }
  const draftPrinter: SavedPrinter = {
    ...result.value,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  const current = await loadPrinters();
  const printers = upsertPrinter(current, draftPrinter);
  const printer = findSamePrinter(printers, draftPrinter) ?? draftPrinter;
  await savePrinters(printers);
  await setSelectedPrinterId(printer.id);
  return { printers, printer };
}

export async function deletePrinter(id: string): Promise<SavedPrinter[]> {
  const printers = removePrinter(await loadPrinters(), id);
  await savePrinters(printers);
  if ((await loadSelectedPrinterId()) === id) {
    await setSelectedPrinterId(printers[0]?.id ?? null);
  }
  return printers;
}

/** Stamp a successful print so the printer sorts to the top next time. */
export async function markPrinterUsed(id: string): Promise<SavedPrinter[]> {
  const printers = (await loadPrinters()).map((p) =>
    p.id === id ? { ...p, lastConnectedAt: Date.now() } : p,
  );
  await savePrinters(printers);
  return printers;
}
