/**
 * Mobile-operator resolution for session telemetry.
 *
 * The on-device carrier name (`expo-cellular` `getCarrierNameAsync`) is not a
 * reliable source of the mobile network operator:
 *   - on web there is no cellular modem, so it is always null;
 *   - on iOS 16+ Apple deprecated `CTCarrier.carrierName`, which now returns
 *     the fixed placeholder "--" for every app regardless of the real SIM.
 *
 * On a cellular connection the ISP resolved from the device's PUBLIC IP (via
 * the `ip-lookup` edge function) IS the carrier, so we fall back to it. These
 * helpers keep that logic pure and testable.
 */

/** The placeholder iOS 16+ hands back instead of a real carrier name. */
export const IOS_CARRIER_PLACEHOLDER = "--";

/**
 * The placeholder iOS 16+ hands back for the mobile country/network codes after
 * Apple deprecated `CTCarrier.mobileCountryCode` / `mobileNetworkCode` — every
 * app gets "65535" regardless of the real SIM.
 */
export const IOS_MOBILE_CODE_PLACEHOLDER = "65535";

/**
 * Normalize a raw MCC or MNC read from the cellular modem. Trims it, and treats
 * empty strings, the iOS 16+ "65535" placeholder, and any non-numeric junk as
 * "no value" (null) so only genuine numeric codes ever get stored.
 */
export function normalizeMobileCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed === IOS_MOBILE_CODE_PLACEHOLDER) return null;
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Format an MCC + MNC pair into the conventional PLMN "MCC-MNC" display string
 * (e.g. "502-12"). Falls back to whichever half is present, or null when
 * neither is a genuine code.
 */
export function formatPlmn(
  mcc: string | null | undefined,
  mnc: string | null | undefined
): string | null {
  const m = normalizeMobileCode(mcc);
  const n = normalizeMobileCode(mnc);
  if (m && n) return `${m}-${n}`;
  return m ?? n ?? null;
}

/**
 * Normalize a raw on-device carrier name: trims it, and treats empty strings
 * and the iOS "--" placeholder as "no value" (null) so junk never gets stored.
 */
export function normalizeCarrierName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === IOS_CARRIER_PLACEHOLDER) return null;
  return trimmed;
}

/**
 * Resolve the mobile network operator for a session.
 *
 * Prefers a genuine on-device carrier name; when that is unavailable (web, or
 * the iOS placeholder) and the connection is cellular, falls back to the ISP
 * resolved from the public IP. Returns null when neither yields a real value.
 */
export function resolveMobileOperator(args: {
  carrierName: string | null | undefined;
  connectionType: string | null | undefined;
  ispProvider: string | null | undefined;
  ispOrg: string | null | undefined;
}): string | null {
  const carrier = normalizeCarrierName(args.carrierName);
  if (carrier) return carrier;

  if (args.connectionType === "mobile") {
    const isp = (args.ispProvider ?? "").trim() || (args.ispOrg ?? "").trim();
    if (isp) return isp;
  }

  return null;
}
