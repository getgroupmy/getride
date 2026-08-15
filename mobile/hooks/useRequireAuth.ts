import { router } from "expo-router";
import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { isUnlocked, shouldRequirePin } from "@/utils/appLock";

/**
 * Guard a screen that assumes a signed-in, unlocked account.
 *
 * `index` and the launch buffer already redirect, but they are not the only way
 * in: the app declares a URL scheme, so a deep link mounts a route directly
 * without passing through either. Every screen that reads `authState.userId` or
 * touches money needs to answer for itself.
 *
 * RLS is what actually protects the data — this cannot grant access it does not
 * have. What it prevents is a signed-out or locked device rendering a wallet as
 * though it were usable.
 */
export interface RequireAuthResult {
  /** Safe to render the screen's real content. */
  ready: boolean;
}

export function useRequireAuth(): RequireAuthResult {
  const { authState, isLoading } = useAuth();

  const locked = shouldRequirePin({
    isAuthenticated: authState.isAuthenticated,
    hasPin: authState.hasPin,
    unlocked: isUnlocked(),
  });

  useEffect(() => {
    if (isLoading) return;

    if (!authState.isAuthenticated) {
      router.replace("/phone-auth");
      return;
    }
    // Wait for the profile before deciding: `hasPin` is false until it lands,
    // and acting early would wave a locked account straight through.
    if (!authState.profileLoaded) return;
    if (locked) router.replace("/pin-verify");
  }, [isLoading, authState.isAuthenticated, authState.profileLoaded, locked]);

  return {
    ready:
      !isLoading && authState.isAuthenticated && authState.profileLoaded && !locked,
  };
}
