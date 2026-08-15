/**
 * The app lock.
 *
 * A Supabase session is persisted to storage, so a relaunch is already signed
 * in — which means the 6-digit PIN a user sets during sign-up is not a
 * credential exchange at all. It is a lock on the app itself, and it is the
 * only thing between someone holding an unlocked phone and a signed-in wallet.
 *
 * Verification is server-side (`verify_pin_for_login`, rate limited to 5
 * attempts before a 15 minute lockout). This module holds only the question of
 * whether *this run of the app* has been unlocked yet — deliberately in memory,
 * never persisted: a lock that survives a relaunch in storage is a lock that
 * can be cleared by editing storage.
 */

let unlocked = false;

/** True once the PIN has been accepted in this run of the app. */
export function isUnlocked(): boolean {
  return unlocked;
}

/** Record a successful PIN entry. */
export function markUnlocked(): void {
  unlocked = true;
}

/** Re-lock — on sign-out, or when a different account signs in. */
export function lockApp(): void {
  unlocked = false;
}

export interface LockDecisionInput {
  /** A real Supabase session exists. */
  isAuthenticated: boolean;
  /** The account has a PIN set, so there is something to ask for. */
  hasPin: boolean;
  /** This run of the app has already been unlocked. */
  unlocked: boolean;
}

/**
 * Should the launch be held at the PIN screen?
 *
 * An account with no PIN is not held: it has nothing to verify against, and
 * blocking it would strand the user with no way forward. That is a real gap
 * rather than a safe default — it is why `pin-setup` runs during sign-up.
 */
export function shouldRequirePin(input: LockDecisionInput): boolean {
  if (!input.isAuthenticated) return false;
  if (!input.hasPin) return false;
  return !input.unlocked;
}
