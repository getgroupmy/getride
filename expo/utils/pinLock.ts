/**
 * PIN lockout helpers for the `verify_pin_for_login` RPC (migration
 * 0052_pin_hashing_and_rate_limiting.sql). After 5 consecutive wrong attempts
 * the RPC raises 'PIN_LOCKED:<seconds-remaining>' until the 15-minute lock
 * expires. Kept as a standalone pure module so it can be unit tested without
 * pulling in the full AuthContext.
 */

/** Default lock window applied when the RPC omits the remaining seconds. */
export const PIN_LOCK_DEFAULT_SECONDS = 15 * 60;

/**
 * Parse the 'PIN_LOCKED:<seconds>' error raised by verify_pin_for_login when
 * too many wrong attempts have locked PIN verification. Returns the remaining
 * lock time in seconds, or null if the message is not a lockout error.
 */
export function parsePinLockSeconds(message: string | undefined | null): number | null {
  const m = /PIN_LOCKED:?(\d+)?/.exec(message ?? "");
  if (!m) return null;
  const secs = m[1] ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(secs) ? secs : PIN_LOCK_DEFAULT_SECONDS;
}

/** Human-readable lockout message, rounding the wait up to whole minutes. */
export function pinLockMessage(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}
