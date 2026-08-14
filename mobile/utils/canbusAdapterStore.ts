/**
 * Saved OBD-II / CANBus adapters.
 *
 * An OBD-II reader is a physical dongle paired to one phone, so the adapter
 * book is device-local (AsyncStorage) rather than a Supabase table — nothing
 * here needs a migration and it keeps working offline, in line with the
 * graceful-degradation convention used by the other `utils/*Store.ts` modules.
 *
 * The pure helpers (draft normalisation/validation, list mutation, labelling)
 * are exported separately from the async persistence layer so they can be
 * unit-tested without touching storage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuidv4 } from "@/utils/supabase";
import {
  WIFI_ADAPTER_HOST,
  WIFI_ADAPTER_PORT,
} from "@/utils/canbus/config";
import { normalizeAccessoryKey } from "@/utils/canbus/mfi";
import type { CreateTransportOptions } from "@/utils/canbus/transports";
import {
  TRANSPORT_KINDS,
  TRANSPORT_LABEL,
  type CanTransportKind,
} from "@/utils/canbus/types";

export const CANBUS_ADAPTERS_KEY = "@canbus_adapters_v1";
export const CANBUS_SELECTED_ADAPTER_KEY = "@canbus_selected_adapter_v1";

/** An OBD-II reader the driver has added on this device. */
export interface SavedCanAdapter {
  id: string;
  /** Friendly name the driver typed, e.g. "Vgate iCar Pro". */
  name: string;
  transport: CanTransportKind;
  /** Wi-Fi adapters only: the dongle's TCP endpoint. */
  host?: string;
  port?: number;
  /**
   * Bluetooth MFi only: which paired accessory this reader is, by the name it
   * carries in iOS Settings (or its address). Optional — left blank the
   * transport takes the first paired accessory that looks like an OBD-II
   * reader, which is all a driver with one dongle needs.
   */
  accessory?: string;
  /**
   * Bluetooth LE only: the exact peripheral this reader was picked as, from the
   * in-app scan (`react-native-ble-plx` device id — a per-app UUID on iOS, a MAC
   * on Android). When present the transport connects to it directly; when absent
   * (a legacy reader, or "any dongle") it scans and takes the first ELM327 it
   * sees, the behaviour before the scan picker existed.
   */
  deviceId?: string;
  createdAt: string;
  /** Epoch-ms of the last successful link, used to sort the list. */
  lastConnectedAt?: number | null;
}

/** What the "Add adapter" form collects, before validation. */
export interface CanAdapterDraft {
  name?: string;
  transport: CanTransportKind;
  host?: string;
  port?: string | number;
  accessory?: string;
  /** Bluetooth LE: the peripheral id picked from the in-app scan. */
  deviceId?: string;
}

export interface AdapterValidationResult {
  ok: boolean;
  /** User-facing reason the draft was rejected. */
  error?: string;
  /** Present when `ok` — the normalised adapter minus its identity fields. */
  value?: Omit<SavedCanAdapter, "id" | "createdAt">;
}

const HOSTNAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate + normalise an "Add adapter" draft.
 *
 * Wi-Fi dongles need a reachable `host:port` (defaulted to the near-universal
 * ELM327 soft-AP endpoint); MFi accessories may name which paired device they
 * are; Bluetooth LE and USB adapters are discovered by scan, so they only
 * carry a label.
 */
export function normalizeAdapterDraft(
  draft: CanAdapterDraft
): AdapterValidationResult {
  const transport = draft.transport;
  if (!TRANSPORT_KINDS.includes(transport)) {
    return { ok: false, error: "Pick how the reader connects." };
  }

  const name = (draft.name ?? "").trim();
  if (name.length > 60) {
    return { ok: false, error: "Name must be 60 characters or fewer." };
  }

  if (transport === "mfi") {
    const accessory = (draft.accessory ?? "").trim();
    if (accessory.length > 60) {
      return { ok: false, error: "Paired name must be 60 characters or fewer." };
    }
    return {
      ok: true,
      value: {
        name: name || accessory || `${TRANSPORT_LABEL[transport]} OBD-II reader`,
        transport,
        // Omit rather than store "" so the transport's "any reader will do"
        // path is a missing value, not an empty string to guard against.
        ...(accessory ? { accessory } : {}),
        lastConnectedAt: null,
      },
    };
  }

  if (transport === "bluetooth") {
    const deviceId = (draft.deviceId ?? "").trim();
    return {
      ok: true,
      value: {
        name: name || `${TRANSPORT_LABEL[transport]} OBD-II reader`,
        transport,
        // A device picked from the in-app scan pins the exact peripheral.
        // Omit rather than store "" so the "any ELM327 dongle" auto-find path is
        // a missing value, not an empty string to guard against.
        ...(deviceId ? { deviceId } : {}),
        lastConnectedAt: null,
      },
    };
  }

  if (transport !== "wifi") {
    return {
      ok: true,
      value: {
        name: name || `${TRANSPORT_LABEL[transport]} OBD-II reader`,
        transport,
        lastConnectedAt: null,
      },
    };
  }

  const host = String(draft.host ?? "").trim() || WIFI_ADAPTER_HOST;
  if (!HOSTNAME_RE.test(host)) {
    return { ok: false, error: "Enter a valid IP address or hostname." };
  }

  const rawPort = draft.port === undefined || draft.port === "" ? WIFI_ADAPTER_PORT : draft.port;
  const port = typeof rawPort === "number" ? rawPort : Number(String(rawPort).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Port must be a whole number between 1 and 65535." };
  }

  return {
    ok: true,
    value: {
      name: name || `Wi-Fi OBD-II reader`,
      transport,
      host,
      port,
      lastConnectedAt: null,
    },
  };
}

/** Human label for a saved adapter, e.g. "Wi-Fi · 192.168.0.10:35000". */
export function describeAdapter(adapter: SavedCanAdapter): string {
  const label = TRANSPORT_LABEL[adapter.transport];
  if (adapter.transport === "wifi" && adapter.host) {
    return `${label} · ${adapter.host}:${adapter.port ?? WIFI_ADAPTER_PORT}`;
  }
  if (adapter.transport === "mfi") {
    return adapter.accessory
      ? `${label} · ${adapter.accessory}`
      : `${label} · paired accessory`;
  }
  if (adapter.transport === "bluetooth" && adapter.deviceId) {
    return `${label} · selected from scan`;
  }
  return `${label} · discovered by scan`;
}

/**
 * Two entries describe the same physical dongle when they share a transport
 * and — for Wi-Fi — the same endpoint, or — for MFi — the same paired
 * accessory. Bluetooth LE/USB readers are found by scan, so one entry per
 * transport is all the link needs.
 */
function isSameDevice(a: SavedCanAdapter, b: SavedCanAdapter): boolean {
  if (a.id === b.id) return true;
  if (a.transport !== b.transport) return false;
  if (b.transport === "wifi") return a.host === b.host && a.port === b.port;
  if (b.transport === "mfi") {
    return normalizeAccessoryKey(a.accessory) === normalizeAccessoryKey(b.accessory);
  }
  if (b.transport === "bluetooth") {
    const aId = (a.deviceId ?? "").trim().toLowerCase();
    const bId = (b.deviceId ?? "").trim().toLowerCase();
    // A reader pinned to a specific scanned device is keyed on it, so two
    // dongles coexist; a legacy "any ELM327" reader (no id) stays one per phone.
    if (aId || bId) return aId === bId;
    return true;
  }
  return true;
}

/** The existing entry for the same physical dongle, if the list has one. */
export function findSameDevice(
  list: SavedCanAdapter[],
  adapter: SavedCanAdapter
): SavedCanAdapter | null {
  return list.find((a) => isSameDevice(a, adapter)) ?? null;
}

/**
 * Insert or replace an adapter in a list, de-duplicating on the physical
 * device so re-adding the same dongle updates its entry instead of stacking
 * copies. The original id/createdAt survive the update.
 */
export function upsertAdapter(
  list: SavedCanAdapter[],
  adapter: SavedCanAdapter
): SavedCanAdapter[] {
  const existing = findSameDevice(list, adapter);
  if (!existing) return [...list, adapter];
  return list.map((a) =>
    a.id === existing.id
      ? { ...adapter, id: existing.id, createdAt: existing.createdAt }
      : a
  );
}

export function removeAdapter(
  list: SavedCanAdapter[],
  id: string
): SavedCanAdapter[] {
  return list.filter((a) => a.id !== id);
}

/**
 * Resolve which adapter should be used: the explicitly selected one when it
 * still exists, otherwise the most recently connected, otherwise the first.
 */
export function pickDefaultAdapter(
  list: SavedCanAdapter[],
  selectedId?: string | null
): SavedCanAdapter | null {
  if (list.length === 0) return null;
  if (selectedId) {
    const hit = list.find((a) => a.id === selectedId);
    if (hit) return hit;
  }
  const connected = list
    .filter((a) => typeof a.lastConnectedAt === "number")
    .sort((a, b) => (b.lastConnectedAt as number) - (a.lastConnectedAt as number));
  return connected[0] ?? list[0];
}

/** Connection options for `createTransport`, derived from a saved adapter. */
export function adapterTransportOptions(
  adapter: SavedCanAdapter | null | undefined
): CreateTransportOptions | undefined {
  if (!adapter) return undefined;
  if (adapter.transport === "wifi") return { host: adapter.host, port: adapter.port };
  if (adapter.transport === "mfi" && adapter.accessory) {
    return { accessory: adapter.accessory };
  }
  if (adapter.transport === "bluetooth" && adapter.deviceId) {
    return { deviceId: adapter.deviceId, nameHint: adapter.name };
  }
  return undefined;
}

// ----------------------------- persistence -----------------------------

function parseAdapters(raw: string | null): SavedCanAdapter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SavedCanAdapter =>
        !!a && typeof a.id === "string" && typeof a.transport === "string"
    );
  } catch {
    return [];
  }
}

export async function loadCanbusAdapters(): Promise<SavedCanAdapter[]> {
  try {
    return parseAdapters(await AsyncStorage.getItem(CANBUS_ADAPTERS_KEY));
  } catch (e) {
    console.log("[canbus-adapters] load failed", e);
    return [];
  }
}

export async function saveCanbusAdapters(list: SavedCanAdapter[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CANBUS_ADAPTERS_KEY, JSON.stringify(list));
  } catch (e) {
    console.log("[canbus-adapters] save failed", e);
  }
}

export async function loadSelectedAdapterId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CANBUS_SELECTED_ADAPTER_KEY);
  } catch (e) {
    console.log("[canbus-adapters] selection load failed", e);
    return null;
  }
}

export async function setSelectedAdapterId(id: string | null): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(CANBUS_SELECTED_ADAPTER_KEY, id);
    else await AsyncStorage.removeItem(CANBUS_SELECTED_ADAPTER_KEY);
  } catch (e) {
    console.log("[canbus-adapters] selection save failed", e);
  }
}

/** Validate a draft, persist it, and return the updated list. */
export async function addCanbusAdapter(
  draft: CanAdapterDraft
): Promise<{ adapters: SavedCanAdapter[]; adapter?: SavedCanAdapter; error?: string }> {
  const result = normalizeAdapterDraft(draft);
  if (!result.ok || !result.value) {
    return { adapters: await loadCanbusAdapters(), error: result.error };
  }
  const draftAdapter: SavedCanAdapter = {
    ...result.value,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  const current = await loadCanbusAdapters();
  const adapters = upsertAdapter(current, draftAdapter);
  // upsert keeps the existing row's id when this dongle was already added.
  const adapter = findSameDevice(adapters, draftAdapter) ?? draftAdapter;
  await saveCanbusAdapters(adapters);
  await setSelectedAdapterId(adapter.id);
  return { adapters, adapter };
}

export async function deleteCanbusAdapter(id: string): Promise<SavedCanAdapter[]> {
  const adapters = removeAdapter(await loadCanbusAdapters(), id);
  await saveCanbusAdapters(adapters);
  if ((await loadSelectedAdapterId()) === id) {
    await setSelectedAdapterId(adapters[0]?.id ?? null);
  }
  return adapters;
}

/** Stamp a successful link so the adapter sorts to the top next time. */
export async function markAdapterConnected(id: string): Promise<SavedCanAdapter[]> {
  const adapters = (await loadCanbusAdapters()).map((a) =>
    a.id === id ? { ...a, lastConnectedAt: Date.now() } : a
  );
  await saveCanbusAdapters(adapters);
  return adapters;
}
