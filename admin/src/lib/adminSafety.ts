/**
 * Guardrails for a tool that writes straight to production.
 *
 * The back office has no staging step and no undo: a change to a status column
 * takes effect for that person immediately. These are the two rules that keep
 * an ordinary afternoon from becoming an incident.
 */

/**
 * Statuses that take something away from the person they are applied to.
 *
 * Approving someone is recoverable by disapproving them; being blocked or
 * marked deleted is not something they can see, ask about, or undo themselves.
 * That asymmetry is the whole reason this list exists.
 */
export const DESTRUCTIVE_STATUSES = new Set([
  "blocked",
  "deleted",
  "rejected",
]);

export function isDestructiveStatus(status: string): boolean {
  return DESTRUCTIVE_STATUSES.has(status.trim().toLowerCase());
}

/**
 * The sentence shown before a destructive change is written.
 *
 * It names the row, because a dropdown in a table row gives no other clue which
 * one is about to change — and a mis-click one row up is the likeliest way this
 * goes wrong.
 */
export function confirmStatusMessage(
  label: string,
  from: string,
  to: string
): string {
  const who = label.trim() || "this record";
  return `Change ${who} from "${from || "unset"}" to "${to}"?\n\nThis takes effect immediately and they are not told.`;
}

/** How long a back office may sit unattended before it locks itself. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Has this session been idle long enough to sign out?
 *
 * Supabase persists the session, so without this an unattended laptop is an
 * open back office for as long as the token lives. Signing out is deliberately
 * the response rather than a soft lock: there is no second factor here to
 * unlock with, so the only honest re-entry is signing in again.
 */
export function isIdleExpired(
  lastActivityAt: number,
  now: number,
  timeoutMs: number = IDLE_TIMEOUT_MS
): boolean {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  // A clock that moved backwards is not evidence of idleness.
  if (now < lastActivityAt) return false;
  return now - lastActivityAt >= timeoutMs;
}
