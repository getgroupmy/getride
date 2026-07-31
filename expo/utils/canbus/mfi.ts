/**
 * Pure helpers for the Bluetooth MFi (Apple External Accessory) ELM327 link.
 *
 * Native-module-free, like `ble.ts`, so the matching rules can be unit tested
 * and imported on web: accessory-key normalisation, deciding which paired
 * accessory is the driver's OBD-II reader, and the availability copy.
 * `transports.ts` owns the actual `react-native-bluetooth-classic` calls and
 * feeds plain objects in here.
 *
 * MFi is *not* BLE. An MFi dongle is a classic-Bluetooth (SPP) device that
 * carries Apple's authentication coprocessor; iOS exposes it only through the
 * ExternalAccessory framework, only after the driver pairs it in the Settings
 * app, and only when the app declares the accessory's protocol string. That is
 * why it is a transport of its own rather than a flavour of the BLE one.
 */

import {
  describeMissingNativeModule,
  describeWebUnsupported,
  type AppRuntime,
} from "./availability";
import { MFI_NAME_HINTS } from "./config";

/**
 * The slice of a paired accessory the picker looks at. `react-native-bluetooth-
 * classic` hands back `BluetoothDevice` objects with these fields; the extra
 * ones are optional because the iOS and Android sides populate different
 * subsets.
 */
export interface MfiAccessoryLike {
  /** Stable identifier — the MAC on Android, the accessory id on iOS. */
  address?: string | null;
  id?: string | null;
  name?: string | null;
  /** iOS: the External Accessory protocol string the accessory speaks. */
  protocol?: string | null;
}

/**
 * Fold an address/name into a comparable key. Drivers type the accessory name
 * as it appears in iOS Settings, and MAC addresses come back in mixed case
 * with or without separators, so both are compared case- and punctuation-blind.
 */
export function normalizeAccessoryKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s:_-]/g, "");
}

/** The identifier to connect on: the address when present, else the id. */
export function accessoryAddress(accessory: MfiAccessoryLike): string {
  return (accessory.address ?? accessory.id ?? "").trim();
}

/** Display name for a paired accessory, falling back to its address. */
export function accessoryLabel(accessory: MfiAccessoryLike): string {
  const name = (accessory.name ?? "").trim();
  return name || accessoryAddress(accessory) || "MFi accessory";
}

/** True when a paired accessory's name looks like an OBD-II reader. */
export function isLikelyMfiAccessory(accessory?: MfiAccessoryLike | null): boolean {
  const upper = (accessory?.name ?? "").trim().toUpperCase();
  if (!upper) return false;
  return MFI_NAME_HINTS.some((hint) => upper.includes(hint));
}

/**
 * Pick the accessory to link with.
 *
 * When the saved reader names one (drivers with more than one dongle paired,
 * or a clone whose name matches no hint), only that accessory is acceptable —
 * silently linking to a different one would stream another car's telemetry.
 * Otherwise take the first paired accessory that looks like an OBD-II reader.
 */
export function pickMfiAccessory(
  accessories: MfiAccessoryLike[] | null | undefined,
  preferred?: string | null,
): MfiAccessoryLike | null {
  const list = (accessories ?? []).filter(Boolean);
  const wanted = normalizeAccessoryKey(preferred);
  if (wanted) {
    return (
      list.find(
        (a) =>
          normalizeAccessoryKey(a.address) === wanted ||
          normalizeAccessoryKey(a.id) === wanted ||
          normalizeAccessoryKey(a.name) === wanted,
      ) ?? null
    );
  }
  return list.find(isLikelyMfiAccessory) ?? null;
}

/**
 * Why no accessory could be selected, phrased as something the driver can act
 * on. The two cases are genuinely different: a named accessory that is absent
 * means "pair it / fix the name", an empty hint match means "nothing paired
 * here looks like a reader".
 */
export function describeMfiSelectionFailure(
  accessories: MfiAccessoryLike[] | null | undefined,
  preferred?: string | null,
): string {
  const count = (accessories ?? []).length;
  if (preferred?.trim()) {
    return count === 0
      ? `"${preferred.trim()}" is not paired — pair the adapter in iOS Settings → Bluetooth first`
      : `"${preferred.trim()}" was not among the paired accessories — check the name in iOS Settings → Bluetooth`;
  }
  return count === 0
    ? "No MFi accessory is paired — pair the adapter in iOS Settings → Bluetooth first"
    : "None of the paired accessories look like an OBD-II reader — add the reader again with the adapter's exact paired name";
}

/** Inputs to {@link describeMfiAvailability} — kept plain so it stays pure. */
export interface MfiAvailabilityInput {
  /** `react-native-bluetooth-classic` resolved as a JS module. */
  moduleInstalled: boolean;
  /** Its native side is linked into this binary (false in Expo Go). */
  nativeModuleLinked: boolean;
  platform: string;
  /** Expo Go vs. an installed binary — changes what the driver should do. */
  runtime: AppRuntime;
}

/**
 * Why the MFi transport can (or cannot) be attempted.
 *
 * MFi is an Apple programme: on Android the very same classic dongles are
 * reachable over plain SPP with no certification involved, so rather than
 * pretend, this points Android drivers at the transports that do work there.
 */
export function describeMfiAvailability({
  moduleInstalled,
  nativeModuleLinked,
  platform,
  runtime,
}: MfiAvailabilityInput): { available: boolean; reason?: string; guidance?: string } {
  if (platform === "web") return describeWebUnsupported("Bluetooth MFi");
  if (platform !== "ios") {
    return {
      available: false,
      reason: "MFi accessories are iOS-only — use Bluetooth LE or USB here",
      guidance:
        "Apple's External Accessory programme only exists on iOS. On Android the same classic dongles " +
        "are reachable over Bluetooth LE or USB — add the reader with one of those transports instead.",
    };
  }
  if (moduleInstalled && nativeModuleLinked) return { available: true };
  return describeMissingNativeModule({
    runtime,
    transport: "Bluetooth MFi",
    packageName: "react-native-bluetooth-classic",
  });
}
