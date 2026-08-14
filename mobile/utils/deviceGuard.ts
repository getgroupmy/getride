import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { getOrCreateDeviceId } from "@/utils/deviceId";

/**
 * Device-based duplicate-account guard for the sign-up flow.
 *
 * A physical device fingerprint (`device_id`) that already backs several
 * distinct accounts is a strong multi-accounting / fraud signal. The policy is
 * configured and enforced SERVER-SIDE (migration 0072): the effective limit
 * lives in app_settings and `set_login_pin` rejects a new account whose device
 * is over the limit. This module is the client half — a pre-check for friendly
 * UX before the account is finalized, plus admin read/write of the config.
 *
 * The pre-check always FAILS OPEN: if the device id is unknown, Supabase is
 * unreachable, or the RPCs are missing on an older database, registration is
 * allowed. Fraud prevention must never lock a legitimate user out over an
 * infra hiccup — the server remains the authoritative gate regardless.
 */

/** Fallback limit used only when the server config can't be read. */
export const DEFAULT_MAX_ACCOUNTS_PER_DEVICE = 3;

export interface DeviceGuardConfig {
  enabled: boolean;
  maxAccountsPerDevice: number;
  /** Opt-in: block new sign-ups from emulators/simulators (default off). */
  blockEmulators: boolean;
}

export interface DeviceGuardResult {
  /** Whether a new registration is permitted on this device. */
  allowed: boolean;
  /** Distinct other accounts already seen on this device. */
  priorAccounts: number;
  /** Effective limit applied. */
  maxAccounts: number;
  /** Whether the guard is switched on. */
  enabled: boolean;
  /** Whether this device looks like an emulator/simulator. */
  isEmulator: boolean;
  /** Whether the emulator block is switched on. */
  blockEmulators: boolean;
  /** The resolved device fingerprint (null when it couldn't be determined). */
  deviceId: string | null;
  /** True only when the server check actually ran; false means "failed open". */
  checked: boolean;
}

/**
 * Pure policy decision, used as a local fallback when only a raw prior-account
 * count is available. Non-positive / non-finite counts always allow.
 */
export function isRegistrationAllowed(
  priorAccounts: number,
  max: number = DEFAULT_MAX_ACCOUNTS_PER_DEVICE
): boolean {
  if (!Number.isFinite(priorAccounts) || priorAccounts <= 0) return true;
  return priorAccounts < max;
}

/**
 * Parse the server's `DEVICE_LIMIT:<prior>/<max>` error (raised by
 * set_login_pin) into its numbers. Returns null when the message isn't one.
 */
export function parseDeviceLimitError(
  message: string | null | undefined
): { priorAccounts: number; maxAccounts: number } | null {
  if (!message) return null;
  const m = message.match(/DEVICE_LIMIT:(\d+)\/(\d+)/);
  if (!m) return null;
  return { priorAccounts: Number(m[1]), maxAccounts: Number(m[2]) };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "";
}

/** True when a caught error is the server's device-limit rejection. */
export function isDeviceLimitError(err: unknown): boolean {
  return parseDeviceLimitError(errMessage(err)) !== null;
}

/** True when a caught error is the server's emulator-block rejection. */
export function isEmulatorBlockedError(err: unknown): boolean {
  return /EMULATOR_BLOCKED/.test(errMessage(err));
}

/**
 * True when a caught error is ANY of the sign-up guard's hard rejections
 * (device limit or emulator block) — i.e. the account must not be created.
 */
export function isRegistrationBlockedError(err: unknown): boolean {
  return isDeviceLimitError(err) || isEmulatorBlockedError(err);
}

/**
 * Ask the server whether a new registration is allowed on this device.
 * Never throws; failures fail open.
 */
export async function evaluateDeviceRegistration(): Promise<DeviceGuardResult> {
  const deviceId = await getOrCreateDeviceId();
  const open: DeviceGuardResult = {
    allowed: true,
    priorAccounts: 0,
    maxAccounts: DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
    enabled: false,
    isEmulator: false,
    blockEmulators: false,
    deviceId,
    checked: false,
  };
  if (!isSupabaseConfigured || !supabase || !deviceId) return open;

  try {
    const { data, error } = await supabase.rpc("device_registration_status", {
      p_device_id: deviceId,
    });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        return {
          allowed: row.allowed !== false,
          priorAccounts: Number(row.prior_accounts ?? 0) || 0,
          maxAccounts:
            Number(row.max_accounts ?? DEFAULT_MAX_ACCOUNTS_PER_DEVICE) ||
            DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
          enabled: row.enabled !== false,
          isEmulator: row.is_emulator === true,
          blockEmulators: row.block_emulators === true,
          deviceId,
          checked: true,
        };
      }
    }
    if (error) {
      // Pre-0072 database: fall back to the raw count RPC if present.
      const { data: cnt, error: cntErr } = await supabase.rpc(
        "device_prior_account_count",
        { p_device_id: deviceId }
      );
      if (!cntErr) {
        const priorAccounts = Number(cnt ?? 0) || 0;
        return {
          ...open,
          allowed: isRegistrationAllowed(priorAccounts),
          priorAccounts,
          enabled: true,
          checked: true,
        };
      }
      console.log("[deviceGuard] status rpc error", error.message);
    }
  } catch (e) {
    console.log("[deviceGuard] threw", e);
  }
  return open;
}

/** Read the current guard config (admin screen). Falls back to defaults. */
export async function getDeviceGuardConfig(): Promise<DeviceGuardConfig> {
  const fallback: DeviceGuardConfig = {
    enabled: true,
    maxAccountsPerDevice: DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
    blockEmulators: false,
  };
  if (!isSupabaseConfigured || !supabase) return fallback;
  try {
    const { data, error } = await supabase.rpc("device_guard_config");
    if (error || !data) return fallback;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fallback;
    return {
      enabled: row.enabled !== false,
      maxAccountsPerDevice:
        Number(row.max_accounts ?? DEFAULT_MAX_ACCOUNTS_PER_DEVICE) ||
        DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
      blockEmulators: row.block_emulators === true,
    };
  } catch {
    return fallback;
  }
}

/** Persist the guard config (admin only, enforced server-side). */
export async function setDeviceGuardConfig(
  config: DeviceGuardConfig
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "Supabase is not configured." };
  }
  try {
    const { error } = await supabase.rpc("device_guard_set_config", {
      p_enabled: config.enabled,
      p_max_accounts: Math.max(1, Math.round(config.maxAccountsPerDevice)),
      p_block_emulators: config.blockEmulators,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
