/**
 * usePrinter — the driver's saved mini printers, plus one-shot print jobs.
 *
 * A receipt printer is written to and closed (unlike the persistent OBD
 * session), so this hook has no long-lived connection: it holds the saved
 * printer list and transport availability, and exposes `print` / `testPrint`
 * that connect, write one ESC/POS document, and disconnect. Everything native
 * is behind the guarded transport loaders, so the hook is safe to mount on web
 * (where every transport simply reports unavailable).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildMeterReceiptEscpos, buildTestPrintEscpos } from "@/utils/printer/escpos";
import {
  getPrinterTransportAvailability,
  scanForBlePrinters,
  sendToPrinter,
  type DiscoveredPrinter,
} from "@/utils/printer/transports";
import type {
  PrinterDeviceInfo,
  PrinterTransportAvailability,
} from "@/utils/printer/types";
import type { ReceiptBranding } from "@/utils/meterReceipt";
import type { MeterTrip } from "@/utils/meterTripsStore";
import {
  loadPrinters,
  loadSelectedPrinterId,
  markPrinterUsed,
  pickDefaultPrinter,
  printerTransportOptions,
  type SavedPrinter,
} from "@/utils/printerStore";

export interface PrintResult {
  ok: boolean;
  device?: PrinterDeviceInfo;
  error?: string;
}

export interface UsePrinter {
  printers: SavedPrinter[];
  defaultPrinter: SavedPrinter | null;
  availability: PrinterTransportAvailability[];
  loading: boolean;
  printing: boolean;
  /** True while a Bluetooth LE discovery scan is running. */
  scanning: boolean;
  /** Bluetooth LE printers found by the last/ongoing scan (not the OS list). */
  discovered: DiscoveredPrinter[];
  reload: () => Promise<void>;
  /** Print a completed hire's receipt to a saved printer. */
  print: (trip: MeterTrip, opts?: { printerId?: string; branding?: ReceiptBranding }) => Promise<PrintResult>;
  /** Send a short self-test slip to confirm the printer works. */
  testPrint: (opts?: { printerId?: string; branding?: ReceiptBranding }) => Promise<PrintResult>;
  /** Scan for nearby Bluetooth LE printers. Resolves with an error string, if any. */
  scanBle: () => Promise<string | null>;
  /** Clear the discovered list (e.g. when the add sheet closes). */
  clearDiscovered: () => void;
}

export function usePrinter(): UsePrinter {
  const [printers, setPrinters] = useState<SavedPrinter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [printing, setPrinting] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const [discovered, setDiscovered] = useState<DiscoveredPrinter[]>([]);

  const availability = useMemo(() => getPrinterTransportAvailability(), []);

  const reload = useCallback(async () => {
    const [list, selected] = await Promise.all([loadPrinters(), loadSelectedPrinterId()]);
    setPrinters(list);
    setSelectedId(selected);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const defaultPrinter = useMemo(
    () => pickDefaultPrinter(printers, selectedId),
    [printers, selectedId],
  );

  const resolveTarget = useCallback(
    (printerId?: string): SavedPrinter | null => {
      if (printerId) return printers.find((p) => p.id === printerId) ?? null;
      return defaultPrinter;
    },
    [printers, defaultPrinter],
  );

  const runJob = useCallback(
    async (target: SavedPrinter | null, payload: string): Promise<PrintResult> => {
      if (!target) {
        return { ok: false, error: "No printer set up. Add one first." };
      }
      const avail = availability.find((a) => a.kind === target.transport);
      if (!avail?.available) {
        return { ok: false, error: avail?.guidance ?? avail?.reason ?? "This printer transport is unavailable." };
      }
      setPrinting(true);
      try {
        const device = await sendToPrinter(
          target.transport,
          printerTransportOptions(target),
          payload,
        );
        await markPrinterUsed(target.id);
        void reload();
        return { ok: true, device };
      } catch (e: any) {
        return { ok: false, error: e?.message ? String(e.message) : "Could not reach the printer." };
      } finally {
        setPrinting(false);
      }
    },
    [availability, reload],
  );

  const print = useCallback<UsePrinter["print"]>(
    async (trip, opts) => {
      const target = resolveTarget(opts?.printerId);
      const payload = buildMeterReceiptEscpos(trip, {
        paperWidth: target?.paperWidth ?? "58mm",
        branding: opts?.branding,
      });
      return runJob(target, payload);
    },
    [resolveTarget, runJob],
  );

  const testPrint = useCallback<UsePrinter["testPrint"]>(
    async (opts) => {
      const target = resolveTarget(opts?.printerId);
      const payload = buildTestPrintEscpos({
        paperWidth: target?.paperWidth ?? "58mm",
        branding: opts?.branding,
      });
      return runJob(target, payload);
    },
    [resolveTarget, runJob],
  );

  const scanBle = useCallback<UsePrinter["scanBle"]>(async () => {
    setScanning(true);
    setDiscovered([]);
    try {
      const seen = new Map<string, DiscoveredPrinter>();
      await scanForBlePrinters({
        onDevice: (device) => {
          seen.set(device.id, device);
          // Stream results in as they arrive, strongest signal first.
          setDiscovered(
            Array.from(seen.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)),
          );
        },
      });
      return null;
    } catch (e: any) {
      return e?.message ? String(e.message) : "Bluetooth scan failed.";
    } finally {
      setScanning(false);
    }
  }, []);

  const clearDiscovered = useCallback(() => setDiscovered([]), []);

  return {
    printers,
    defaultPrinter,
    availability,
    loading,
    printing,
    scanning,
    discovered,
    reload,
    print,
    testPrint,
    scanBle,
    clearDiscovered,
  };
}
