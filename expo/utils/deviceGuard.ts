import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { getOrCreateDeviceId } from "@/utils/deviceId";

/**
 * Device-based duplicate-account guard for the sign-up flow.
 *
 * A physical device fingerprint (`device_id`) that already backs several
 * distinct accounts is a strong multi-accounting / fraud signal. Before a new
 * account is finalized we ask the server how many OTHER accounts have signed in
 * from this device (via the `device_prior_account_count` SECURITY DEFINER RPC —
 * clients can't read other users' sessions directly under RLS) and block the
 * sign-up once that count reaches the limit.
 *
 * The check always FAILS OPEN: if the device id is unknown, Supabase is
 * unreachable, or the RPC is missing on an older database, registration is
 * allowed. Fraud prevention must never lock a legitimate user out because of
 * an infra hiccup.
 */

/**
 * How many DISTINCT other accounts a single device may already back before a
 * further new sign-up on it is blocked. 3 leaves room for genuine shared
 * devices (a family phone, a hand-me-down) while stopping bulk multi-accounting.
 */
export const MAX_ACCOUNTS_PER_DEVICE = 3;

export interface DeviceGuardResult {
  /** Whether a new registration is permitted on this device. */
  allowed: boolean;
  /** Distinct other accounts already seen on this device. */
  priorAccounts: number;
  /** The resolved device fingerprint (null when it couldn't be determined). */
  deviceId: string | null;
  /** True only when the server check actually ran; false means "failed open". */
  checked: boolean;
}

/**
 * Pure policy decision: given the number of distinct prior accounts on a
 * device, may a new one be created? Non-positive / non-finite counts always
 * allow (nothing to go on).
 */
export function isRegistrationAllowed(
  priorAccounts: number,
  max: number = MAX_ACCOUNTS_PER_DEVICE
): boolean {
  if (!Number.isFinite(priorAccounts) || priorAccounts <= 0) return true;
  return priorAccounts < max;
}

/**
 * Resolve the device fingerprint and ask the server how many other accounts
 * already use it, then apply the policy. Never throws; failures fail open.
 */
export async function evaluateDeviceRegistration(): Promise<DeviceGuardResult> {
  const deviceId = await getOrCreateDeviceId();
  if (!isSupabaseConfigured || !supabase || !deviceId) {
    return { allowed: true, priorAccounts: 0, deviceId, checked: false };
  }
  try {
    const { data, error } = await supabase.rpc("device_prior_account_count", {
      p_device_id: deviceId,
    });
    if (error) {
      // Missing RPC on a pre-0071 database, or a transient error → fail open.
      console.log("[deviceGuard] rpc error", error.message);
      return { allowed: true, priorAccounts: 0, deviceId, checked: false };
    }
    const priorAccounts =
      typeof data === "number" ? data : Number(data ?? 0) || 0;
    return {
      allowed: isRegistrationAllowed(priorAccounts),
      priorAccounts,
      deviceId,
      checked: true,
    };
  } catch (e) {
    console.log("[deviceGuard] threw", e);
    return { allowed: true, priorAccounts: 0, deviceId, checked: false };
  }
}
