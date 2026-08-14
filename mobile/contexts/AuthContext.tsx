import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useState } from "react";

import { isSupabaseConfigured, supabase } from "@/utils/supabase";
import { getOrCreateDeviceId } from "@/utils/deviceId";
import { parsePinLockSeconds } from "@/utils/pinLock";
import { resetLaunchSession } from "@/utils/launchSession";

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
}

const EMPTY: AuthState = {
  isAuthenticated: false,
  userId: null,
  phone: null,
  profileName: null,
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

  /** Pull the display name off `profiles` so screens have something to greet. */
  const loadProfileName = useCallback(async (userId: string) => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      const name = (data as { name?: string } | null)?.name ?? null;
      if (name) setAuthState((prev) => ({ ...prev, profileName: name }));
    } catch {
      // A missing profile row is not a failed sign-in — the session stands.
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
      void loadProfileName(id);
    },
    [loadProfileName]
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
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Could not save your PIN." };
    }
  }, []);

  /**
   * Sign in with phone + PIN.
   *
   * The RPC only *checks* the PIN — it does not mint a session — so a correct
   * PIN still needs the OTP path to produce one. Callers use this to decide
   * whether to let the user through to an OTP, and to surface the lockout.
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
      // "already launched" flag.
      resetLaunchSession();
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
