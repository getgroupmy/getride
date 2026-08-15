import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/utils/supabase";
import { getOrCreateDeviceId } from "@/utils/deviceId";
import { parsePinLockSeconds } from "@/utils/pinLock";
import { resetLaunchSession } from "@/utils/launchSession";
import { lockApp, markUnlocked } from "@/utils/appLock";

/**
 * Authentication for the rebuilt app.
 *
 * One path only: Supabase phone OTP, then a 6-digit PIN for subsequent logins.
 * The legacy app carried a second "local PIN" path that stored users in
 * AsyncStorage and produced a session with no `auth.uid()`. Since migration
 * 0069 every ride, wallet and profile write is RLS-scoped, so that path could
 * not write anything — it is the direct cause of the "sign in required"
 * failures. It is deliberately not carried over.
 *
 * The PIN itself never travels as plaintext beyond the RPCs: `set_login_pin`
 * stores a bcrypt hash (migration 0052) and `verify_pin_for_login` is rate
 * limited server-side (5 wrong attempts → 15 minute lock).
 */

export interface AuthState {
  /** A real Supabase session — RLS-protected calls will work. */
  isAuthenticated: boolean;
  userId: string | null;
  phone: string | null;
  profileName: string | null;
  /** The account has a PIN set, so the app lock has something to ask for. */
  hasPin: boolean;
  /**
   * The profile lookup has finished (successfully or not). The launch must not
   * decide whether to hold at the lock before this is true, or a slow lookup
   * would let an unlocked app through.
   */
  profileLoaded: boolean;
}

const EMPTY: AuthState = {
  isAuthenticated: false,
  userId: null,
  phone: null,
  profileName: null,
  hasPin: false,
  profileLoaded: false,
};

export interface PinResult {
  ok: boolean;
  /** Message fit to show the user. */
  message?: string;
  /** Seconds remaining when the account is rate-limited, else null. */
  lockedForSeconds?: number | null;
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [authState, setAuthState] = useState<AuthState>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Pull the display name and whether a PIN exists.
   *
   * Only the *presence* of `pin_hash` is read — never the hash itself. It is
   * what decides whether the app lock has anything to ask for on relaunch.
   */
  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("name, pin_hash")
        .eq("id", userId)
        .maybeSingle();
      const row = data as { name?: string; pin_hash?: string | null } | null;
      setAuthState((prev) => ({
        ...prev,
        profileName: row?.name ?? prev.profileName,
        hasPin: !!row?.pin_hash,
        profileLoaded: true,
      }));
    } catch {
      // A missing profile row is not a failed sign-in — the session stands.
      // `profileLoaded` still flips, so the launch is never held waiting on a
      // lookup that already failed.
      setAuthState((prev) => ({ ...prev, profileLoaded: true }));
    }
  }, []);

  const applySession = useCallback(
    (session: { user?: { id?: string; phone?: string | null } } | null) => {
      const id = session?.user?.id ?? null;
      if (!id) {
        setAuthState(EMPTY);
        return;
      }
      setAuthState((prev) => ({
        ...prev,
        isAuthenticated: true,
        userId: id,
        phone: session?.user?.phone ?? prev.phone ?? null,
      }));
      void loadProfile(id);
    },
    [loadProfile]
  );

  // Restore any cached session on boot, then track it.
  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }
    const client = supabase;

    void (async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!cancelled) applySession(data.session);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) applySession(session);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [applySession]);

  /** Send the SMS code. `shouldCreateUser` false keeps sign-in from registering. */
  const sendOtp = useCallback(
    async (phone: string, shouldCreateUser: boolean): Promise<PinResult> => {
      if (!supabase) return { ok: false, message: "Server is not configured." };
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser },
      });
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    []
  );

  const verifyOtp = useCallback(
    async (phone: string, code: string): Promise<PinResult> => {
      if (!supabase) return { ok: false, message: "Server is not configured." };
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: "sms",
      });
      if (error || !data.session) {
        return { ok: false, message: error?.message ?? "That code did not work." };
      }
      applySession(data.session);
      return { ok: true };
    },
    [applySession]
  );

  /** Set (or change) the PIN for the signed-in account. */
  const setPin = useCallback(async (pin: string): Promise<PinResult> => {
    if (!supabase) return { ok: false, message: "Server is not configured." };
    try {
      const deviceId = await getOrCreateDeviceId();
      const { data, error } = await supabase.rpc("set_login_pin", {
        p_pin: pin,
        p_device_id: deviceId,
      });
      if (error) return { ok: false, message: error.message };
      if (data !== true) return { ok: false, message: "Could not save your PIN." };
      // The lock now has something to ask for, and choosing the PIN counts as
      // unlocking this run — the user is holding the phone.
      setAuthState((prev) => ({ ...prev, hasPin: true }));
      markUnlocked();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Could not save your PIN." };
    }
  }, []);

  /**
   * Check the PIN — this is the app lock, not a sign-in.
   *
   * The RPC only *verifies*; it does not mint a session. Since Supabase already
   * persists the session across relaunches, the PIN's real job is to stand
   * between someone holding an unlocked phone and a signed-in wallet. It is
   * rate limited server-side, and a lockout is surfaced with the time left
   * rather than as a generic failure.
   */
  const verifyPin = useCallback(
    async (phone: string, pin: string): Promise<PinResult> => {
      if (!supabase) return { ok: false, message: "Server is not configured." };
      const { data, error } = await supabase.rpc("verify_pin_for_login", {
        p_phone: phone,
        p_pin: pin,
      });
      if (error) {
        const locked = parsePinLockSeconds(error.message);
        if (locked != null) {
          const mins = Math.ceil(locked / 60);
          return {
            ok: false,
            lockedForSeconds: locked,
            message: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
          };
        }
        return { ok: false, message: error.message };
      }
      return data === true
        ? { ok: true }
        : { ok: false, message: "That PIN is not right." };
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await supabase?.auth.signOut();
    } finally {
      setAuthState(EMPTY);
      // Otherwise the next account inherits this one's restore target and
      // "already launched" flag — and, worse, its unlocked lock.
      resetLaunchSession();
      lockApp();
    }
  }, []);

  return {
    authState,
    isLoading,
    isSupabaseConfigured,
    sendOtp,
    verifyOtp,
    setPin,
    verifyPin,
    signOut,
  };
});
