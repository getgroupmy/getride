/**
 * Tiny cross-screen UI flags for the wallet flow.
 *
 * Used by the Scan / Show Code screens to ask the (already mounted) wallet
 * screen to open the Reload popup after dismissing back to it — avoids
 * pushing a duplicate wallet screen onto the navigation stack.
 */

export type WalletReloadReturnPath = "/wallet-scan" | "/wallet-show-code";

let pendingReloadReturnPath: WalletReloadReturnPath | null = null;

/** Ask the wallet screen to open the Reload popup when it next gains focus. */
export function requestWalletReload(returnPath: WalletReloadReturnPath): void {
  pendingReloadReturnPath = returnPath;
}

/** Consume the pending reload request (returns null when none is pending). */
export function consumeWalletReloadRequest(): WalletReloadReturnPath | null {
  const path = pendingReloadReturnPath;
  pendingReloadReturnPath = null;
  return path;
}
