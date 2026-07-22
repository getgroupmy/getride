import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { getOrCreateDeviceId } from "@/utils/deviceId";

/**
 * Client wrapper for platform device attestation (Android Play Integrity /
 * iOS App Attest) — the un-forgeable half of the sign-up anti-fraud pipeline.
 *
 * STATUS: no-op until a native attestation module is added to the build.
 * Expo Go / the Rork managed flow can't produce attestation tokens; a custom
 * dev/prod build is required (see docs/device-attestation.md). Until then
 * `attestAndRecord()` reports { available: false } and NEVER blocks anything —
 * attestation only ever tightens fraud checks, it must never break sign-up for
 * a legitimate user on a build that can't attest.
 *
 * When the native module lands, wire it into `requestNativeAttestationToken()`
 * below; the rest of the plumbing (challenge, edge-function call, verdict
 * shape) is already in place.
 */

export type AttestPlatform = "android" | "ios";

export interface AttestationResult {
  /** Whether attestation could even be attempted on this build/platform. */
  available: boolean;
  /** Whether the attempt ran end-to-end (token produced + server verified). */
  attempted: boolean;
  /** Server verdict, when attempted. */
  passed: boolean;
  /** iOS App Attest hardware-backed key id, when available. */
  attestKeyId: string | null;
}

const UNAVAILABLE: AttestationResult = {
  available: false,
  attempted: false,
  passed: false,
  attestKeyId: null,
};

/** True on the platforms that have an attestation API at all. */
export function isAttestablePlatform(
  os: string = Platform.OS
): os is AttestPlatform {
  return os === "android" || os === "ios";
}

/**
 * Produce a native attestation token. Returns null until a native module is
 * wired in — this is the ONE place to add it. Expected shape per platform:
 *   android → { integrity_token }
 *   ios     → { attestation, key_id }
 */
async function requestNativeAttestationToken(
  _challenge: string
): Promise<
  | { platform: AttestPlatform; integrity_token: string }
  | { platform: AttestPlatform; attestation: string; key_id: string }
  | null
> {
  // No native attestation module in this build — see module header.
  return null;
}

/** A fresh per-attempt challenge/nonce the device attests over. */
export function makeChallenge(): string {
  // Non-cryptographic is fine here — the challenge only needs to be unique per
  // attempt; the server binds it into the verified attestation.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Best-effort: attest this device and record the verdict via the `attest-device`
 * edge function. Never throws and never blocks — returns a structured result so
 * callers can tighten checks WHEN a verdict is available, while treating
 * "unavailable" as pass-through.
 */
export async function attestAndRecord(
  userId: string | null
): Promise<AttestationResult> {
  if (!isAttestablePlatform() || !isSupabaseConfigured || !supabase) {
    return UNAVAILABLE;
  }
  try {
    const challenge = makeChallenge();
    const token = await requestNativeAttestationToken(challenge);
    if (!token) return UNAVAILABLE; // native module not present yet

    const deviceId = await getOrCreateDeviceId();
    const { data, error } = await supabase.functions.invoke("attest-device", {
      body: { ...token, challenge, device_id: deviceId, user_id: userId },
    });
    if (error || !data) {
      console.log("[attestation] attest-device error", error?.message);
      return { ...UNAVAILABLE, available: true };
    }
    return {
      available: true,
      attempted: true,
      passed: (data as { passed?: boolean }).passed === true,
      attestKeyId: (data as { attest_key_id?: string | null }).attest_key_id ?? null,
    };
  } catch (e) {
    console.log("[attestation] threw", e);
    return UNAVAILABLE;
  }
}
