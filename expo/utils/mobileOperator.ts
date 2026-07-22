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
