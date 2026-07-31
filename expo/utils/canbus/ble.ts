/**
 * Pure BLE helpers for the ELM327 link.
 *
 * Everything here is native-module-free so it can be unit tested and imported
 * on web: UUID normalisation, deciding whether an advertisement looks like an
 * OBD-II dongle, and picking the serial (write + notify) characteristic pair
 * out of a peripheral's discovered services. `transports.ts` owns the actual
 * `react-native-ble-plx` calls and feeds plain objects in here.
 */

import { BLE_ELM_PROFILES, BLE_NAME_HINTS } from "./config";

/** Suffix of the Bluetooth SIG base UUID that 16/32-bit UUIDs expand into. */
const BLE_BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

/**
 * Generic Access / Generic Attribute / Device Information. Never carry the
 * ELM327 serial stream, so the "any writable characteristic" fallback skips
 * them rather than latching onto a stray control characteristic.
 */
const IGNORED_SERVICE_UUIDS = ["1800", "1801", "180a"].map(expandShortUuid);

function expandShortUuid(short: string): string {
  return `0000${short}${BLE_BASE_UUID_SUFFIX}`;
}

/**
 * Lowercase a UUID and expand the 16/32-bit short forms iOS and Android hand
 * back inconsistently ("FFF0", "0000fff0", the full 128-bit string) so two
 * spellings of the same UUID compare equal.
 */
export function normalizeUuid(uuid?: string | null): string {
  const raw = (uuid ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.length === 4) return expandShortUuid(raw);
  if (raw.length === 8) return `${raw}${BLE_BASE_UUID_SUFFIX}`;
  return raw;
}

export function sameUuid(a?: string | null, b?: string | null): boolean {
  const left = normalizeUuid(a);
  return left.length > 0 && left === normalizeUuid(b);
}

/** True when a peripheral's advertised name looks like an ELM327 dongle. */
export function isLikelyElmName(name?: string | null): boolean {
  const upper = (name ?? "").trim().toUpperCase();
  if (!upper) return false;
  return BLE_NAME_HINTS.some((hint) => upper.includes(hint));
}

/** The slice of a `react-native-ble-plx` Device the scan filter looks at. */
export interface BleAdvertisement {
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
}

/**
 * Scan filter: accept a peripheral whose name matches a known ELM327 hint, or
 * that advertises one of the serial services those dongles use. Nameless
 * peripherals advertising nothing recognisable are ignored — a phone sitting
 * in traffic sees dozens of them.
 */
export function matchesElmAdvertisement(device?: BleAdvertisement | null): boolean {
  if (!device) return false;
  if (isLikelyElmName(device.name) || isLikelyElmName(device.localName)) return true;
  const advertised = (device.serviceUUIDs ?? []).map(normalizeUuid);
  if (advertised.length === 0) return false;
  return BLE_ELM_PROFILES.some((profile) =>
    advertised.includes(normalizeUuid(profile.service)),
  );
}

/** The characteristic flags the profile picker needs. */
export interface BleCharacteristicLike {
  uuid: string;
  isWritableWithResponse?: boolean;
  isWritableWithoutResponse?: boolean;
  isNotifiable?: boolean;
  isIndicatable?: boolean;
}

export interface BleServiceLike {
  uuid: string;
  characteristics: BleCharacteristicLike[];
}

/** A usable serial link found on the peripheral. */
export interface ResolvedBleProfile {
  label: string;
  serviceUuid: string;
  writeUuid: string;
  notifyUuid: string;
  /** False when the characteristic only supports write-without-response. */
  writeWithResponse: boolean;
}

function isWritable(c: BleCharacteristicLike): boolean {
  return !!(c.isWritableWithResponse || c.isWritableWithoutResponse);
}

function isSubscribable(c: BleCharacteristicLike): boolean {
  return !!(c.isNotifiable || c.isIndicatable);
}

/**
 * Choose the write/notify characteristic pair to talk ELM327 over.
 *
 * Known profiles win in {@link BLE_ELM_PROFILES} order; a clone using
 * uncatalogued UUIDs still connects through the generic fallback (the first
 * non-standard service exposing a writable and a subscribable characteristic,
 * which may be the same characteristic on HM-10 style modules).
 */
export function resolveBleProfile(
  services: BleServiceLike[] | null | undefined,
): ResolvedBleProfile | null {
  const list = services ?? [];

  for (const profile of BLE_ELM_PROFILES) {
    const service = list.find((s) => sameUuid(s.uuid, profile.service));
    if (!service) continue;
    const write = service.characteristics?.find(
      (c) => sameUuid(c.uuid, profile.write) && isWritable(c),
    );
    const notify = service.characteristics?.find(
      (c) => sameUuid(c.uuid, profile.notify) && isSubscribable(c),
    );
    if (!write || !notify) continue;
    return {
      label: profile.label,
      serviceUuid: service.uuid,
      writeUuid: write.uuid,
      notifyUuid: notify.uuid,
      writeWithResponse: !!write.isWritableWithResponse,
    };
  }

  for (const service of list) {
    if (IGNORED_SERVICE_UUIDS.includes(normalizeUuid(service.uuid))) continue;
    const write = service.characteristics?.find(isWritable);
    const notify = service.characteristics?.find(isSubscribable);
    if (!write || !notify) continue;
    return {
      label: "Generic serial",
      serviceUuid: service.uuid,
      writeUuid: write.uuid,
      notifyUuid: notify.uuid,
      writeWithResponse: !!write.isWritableWithResponse,
    };
  }

  return null;
}

/** Inputs to {@link describeBleAvailability} — kept plain so it stays pure. */
export interface BleAvailabilityInput {
  /** `react-native-ble-plx` resolved as a JS module. */
  moduleInstalled: boolean;
  /** Its native side is linked into this binary (false in Expo Go). */
  nativeModuleLinked: boolean;
  platform: string;
}

/**
 * Why the Bluetooth transport can (or cannot) be attempted, phrased for the
 * driver rather than for a bundler: the difference between "this build has no
 * BLE at all" and "Bluetooth is there, it just needs a dev build" is the one
 * thing they can act on.
 */
export function describeBleAvailability({
  moduleInstalled,
  nativeModuleLinked,
  platform,
}: BleAvailabilityInput): { available: boolean; reason?: string } {
  if (platform === "web") {
    return { available: false, reason: "not supported on web" };
  }
  if (!moduleInstalled) {
    return { available: false, reason: "react-native-ble-plx not installed" };
  }
  if (!nativeModuleLinked) {
    return {
      available: false,
      reason: "needs a development or production build (not available in Expo Go)",
    };
  }
  return { available: true };
}
