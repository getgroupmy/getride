import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  isSupabaseConfigured,
  SUPABASE_URL_RESOLVED,
  SUPABASE_ANON_KEY_RESOLVED,
} from "@/utils/supabase";

const AUTH_KEY = "@app_auth_state";
const REGISTERED_USERS_KEY = "@registered_users";
/**
 * AsyncStorage key holding the full cached row from public.profiles for the
 * currently signed-in user. Mirrors every selectable column so the app can
 * render profile data offline; refreshed from Supabase whenever a session is
 * available (startup + on demand via refreshProfile).
 */
const PROFILE_CACHE_KEY = "@app_profile_cache";
const AUTH_PASSWORD_RESYNC_KEY = "@auth_password_pending_resync";

const TEST_ACCOUNT = {
  /**
   * Built-in test phone, intentionally EMPTY to disable all test-account
   * special-casing. The previous value ("+60182000004") became a real
   * registered user whose PIN/Auth password live in Supabase like any other
   * account; hard-coding it here hijacked the normal phone+PIN login path and
   * rejected the user's real PIN. Leave empty so every number — including that
   * one — flows through the standard Supabase sign-in.
   */
  phoneNumber: "",
  pin: "111111",
  /**
   * Deterministic Supabase auth credentials used to give the test account a
   * REAL supabase session so RLS-protected writes (profile edits, etc.) sync.
   * Create this user once in Supabase Auth (Dashboard → Authentication → Add
   * user) with email confirmations disabled, or let the app sign it up the
   * first time (requires "Confirm email" to be off in Supabase Auth settings).
   */
  email: "test+60182000004@teksi.local",
  password: "teksi-test-60182000004",
};

/**
 * True only when `phone` matches the built-in test account. Returns false
 * whenever the test phone is disabled (empty), so no real number is ever
 * special-cased. Strips spaces, dashes and parens before comparing.
 */
const isTestAccountNumber = (phone: string): boolean => {
  const testPhone = TEST_ACCOUNT.phoneNumber.replace(/[\s\-\(\)]/g, "").trim();
  if (!testPhone) return false;
  const normalized = (phone ?? "").replace(/[\s\-\(\)]/g, "").trim();
  return normalized === testPhone;
};

interface RegisteredUser {
  phoneNumber: string;
  pin: string;
  firstName?: string;
}

/**
 * Full snapshot of a public.profiles row. Kept loose (all nullable) so we can
 * cache partial fetches and survive schema additions without crashing on read.
 */
export interface ProfileRecord {
  id: string;
  display_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  ic?: string | null;
  address?: string | null;
  profile_image?: string | null;
  avatar_url?: string | null;
  id_image?: string | null;
  nationality?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  referral_code?: string | null;
  pin?: string | null;
  login_pin?: string | null;
  pin_hash?: string | null;
  status?: string | null;
  documents_ok?: boolean | null;
  total_rides?: number | null;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Local-only: timestamp of last successful sync from Supabase. */
  _cachedAt?: string;
}

/** Columns mirrored from public.profiles into the AsyncStorage cache. */
const PROFILE_COLUMNS =
  "id, display_id, name, phone, email, ic, address, profile_image, avatar_url, id_image, nationality, gender, birth_date, referral_code, pin, login_pin, pin_hash, status, documents_ok, total_rides, joined_at, created_at, updated_at";

/** Fallback column list for databases that pre-date migration 0052 (no pin_hash). */
const LEGACY_PROFILE_COLUMNS =
  "id, display_id, name, phone, email, ic, address, profile_image, avatar_url, id_image, nationality, gender, birth_date, referral_code, pin, login_pin, status, documents_ok, total_rides, joined_at, created_at, updated_at";

interface AuthState {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  userId?: string | null;
  profileName?: string | null;
  profileAvatar?: string | null;
  /**
   * The plaintext PIN as last entered/set by the user in this session.
   * The server only stores a bcrypt hash (profiles.pin_hash), so this is
   * populated when the user types their PIN (registerUser / signInWithPin),
   * not from the server. In-memory only — never persisted to AsyncStorage.
   */
  profilePin?: string | null;
  /**
   * Whether the server has a sign-in PIN on record for this user (derived
   * from profiles.pin_hash / legacy pin columns on refreshProfile). Keeps
   * hasPinSet consistent across devices without exposing the PIN itself.
   * null = unknown (profile not fetched yet).
   */
  profileHasPin?: boolean | null;
  /**
   * True only when the current session is backed by a real Supabase auth
   * session (i.e. supabase.auth.getSession() returned a session). When false,
   * the user is signed in via the legacy local PIN / test-account path and
   * any RLS-protected Supabase calls (`auth.uid()`-based policies) will fail.
   */
  isSupabaseSession: boolean;
}

interface SendOtpResult {
  ok: boolean;
  error?: string;
}

interface VerifyOtpResult {
  ok: boolean;
  isNewUser: boolean;
  error?: string;
  userId?: string;
  hasName?: boolean;
  name?: string | null;
}

/**
 * Normalize a phone number to E.164-ish form Supabase expects (e.g. +60182000004).
 * Supabase requires a leading "+" and digits only.
 */
function normalizeE164(input: string): string {
  const trimmed = (input ?? "").trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

/**
 * Deterministic password derived from the user's PIN. Used to mint a real
 * Supabase auth session via phone+password sign-in when the user logs in
 * with PIN (skipping OTP). The password is synced server-side every time
 * the PIN is set/changed in `registerUser`. Anyone who knows the PIN can
 * obtain a session — same security model as the PIN itself.
 */
function derivePinPassword(pin: string): string {
  return `teksi-pin-v1-${pin}`;
}

/**
 * Parse the 'PIN_LOCKED:<seconds>' error raised by verify_pin_for_login when
 * too many wrong attempts have locked PIN verification. Returns the remaining
 * lock time in seconds, or null if the message is not a lockout error.
 */
function parsePinLockSeconds(message: string | undefined | null): number | null {
  const m = /PIN_LOCKED:?(\d+)?/.exec(message ?? "");
  if (!m) return null;
  const secs = m[1] ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(secs) ? secs : 15 * 60;
}

function pinLockMessage(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

/**
 * Look up the plaintext PIN cached on this device for a phone number (legacy
 * registered-users store). The server no longer stores plaintext PINs, so
 * this local cache is the only recovery source for auth-password re-sync.
 */
async function getLocalPinForPhone(phone: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(REGISTERED_USERS_KEY);
    if (!raw) return null;
    const users = JSON.parse(raw) as RegisteredUser[];
    const target = normalizeE164(phone);
    if (!target) return null;
    const hit = users.find((u) => normalizeE164(u.phoneNumber) === target);
    return hit?.pin && hit.pin.length > 0 ? hit.pin : null;
  } catch (e) {
    console.log("[auth] getLocalPinForPhone failed", e);
    return null;
  }
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    phoneNumber: null,
    userId: null,
    profileName: null,
    profileAvatar: null,
    profilePin: null,
    isSupabaseSession: false,
  });
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetails, setServerDetails] = useState<{
    url: string;
    hasUrl: boolean;
    hasAnonKey: boolean;
    httpStatus?: number;
    errorName?: string;
    errorMessage?: string;
    durationMs?: number;
  } | null>(null);

  const supaEnabled: boolean = isSupabaseConfigured && !!supabase;

  const applySession = useCallback(async (session: Session | null) => {
    if (session?.user) {
      const phone = session.user.phone
        ? `+${session.user.phone.replace(/[^\d]/g, "")}`
        : null;
      // Preserve cached name/avatar/pin so the UI doesn't flash empty values
      // while refreshProfile runs in the background.
      setAuthState((prev) => {
        const same = prev.userId === session.user.id;
        const next: AuthState = {
          isAuthenticated: true,
          phoneNumber: phone ?? prev.phoneNumber ?? null,
          userId: session.user.id,
          profileName: same ? prev.profileName ?? null : prev.profileName ?? null,
          profileAvatar: same ? prev.profileAvatar ?? null : prev.profileAvatar ?? null,
          // Keep the in-memory PIN when the user is unchanged OR when this is
          // the session minted by the PIN login that just cached it
          // (prev.userId is still null at that point).
          profilePin: same || prev.userId == null ? prev.profilePin ?? null : null,
          profileHasPin: same || prev.userId == null ? prev.profileHasPin ?? null : null,
          isSupabaseSession: true,
        };
        AsyncStorage.setItem(
          AUTH_KEY,
          JSON.stringify({ ...next, profilePin: null })
        ).catch((e) => console.log("[auth] persist session failed", e));
        return next;
      });
    } else {
      const next: AuthState = {
        isAuthenticated: false,
        phoneNumber: null,
        userId: null,
        profileName: null,
        profileAvatar: null,
        profilePin: null,
        profileHasPin: null,
        isSupabaseSession: false,
      };
      setAuthState(next);
      try {
        await AsyncStorage.removeItem(AUTH_KEY);
      } catch (e) {
        console.log("[auth] clear session failed", e);
      }
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    const init = async () => {
      // Wrap AsyncStorage reads in a timeout so a locked/corrupt store can't
      // hang the app on the splash screen indefinitely.
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
        Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);

      try {
        const [storedAuth, storedUsers, storedProfile] = await Promise.all([
          withTimeout(AsyncStorage.getItem(AUTH_KEY), 3000),
          withTimeout(AsyncStorage.getItem(REGISTERED_USERS_KEY), 3000),
          withTimeout(AsyncStorage.getItem(PROFILE_CACHE_KEY), 3000),
        ]);

        let cachedProfile: ProfileRecord | null = null;
        if (storedProfile) {
          try {
            cachedProfile = JSON.parse(storedProfile) as ProfileRecord;
            setProfile(cachedProfile);
          } catch {}
        }
        // Seed authState from the cached profile so name/avatar render
        // immediately on boot regardless of which login path the user took.
        if (cachedProfile) {
          const seeded = cachedProfile;
          setAuthState((prev) => ({
            ...prev,
            profileName: prev.profileName ?? seeded.name ?? null,
            profileAvatar:
              prev.profileAvatar ??
              seeded.avatar_url ??
              seeded.profile_image ??
              null,
            userId: prev.userId ?? seeded.id ?? null,
          }));
        }

        if (storedUsers) {
          try {
            setRegisteredUsers(JSON.parse(storedUsers) as RegisteredUser[]);
          } catch {}
        }

        // Apply cached auth state immediately so the app renders without
        // waiting for any network operations.
        if (storedAuth) {
          try {
            const parsed = JSON.parse(storedAuth) as AuthState;
            setAuthState({ ...parsed, isSupabaseSession: false });
          } catch {}
        }
        if (!supaEnabled) {
          setServerReachable(false);
        }
      } catch (e) {
        console.error("[auth] init storage error", e);
      } finally {
        // Always release the loading gate so the splash screen never hangs.
        setIsLoading(false);
      }

      if (supaEnabled && supabase) {
        try {
          // Connectivity probe: health ping runs in the background after the
          // app is already visible. Shows the connection modal when done.
          let online = false;
          const baseUrl = SUPABASE_URL_RESOLVED;
          const hasUrl = !!baseUrl;
          const hasAnonKey = !!SUPABASE_ANON_KEY_RESOLVED;
          let httpStatus: number | undefined;
          let errorName: string | undefined;
          let errorMessage: string | undefined;
          const t0 = Date.now();
          try {
            const url = `${baseUrl}/auth/v1/health`;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(url, {
              signal: ctrl.signal,
              headers: {
                apikey: SUPABASE_ANON_KEY_RESOLVED,
                Authorization: `Bearer ${SUPABASE_ANON_KEY_RESOLVED}`,
              },
            });
            clearTimeout(timer);
            httpStatus = res.status;
            online = res.ok;
            if (!online) {
              try {
                errorMessage = await res.text();
              } catch {}
            }
          } catch (e) {
            console.log("[auth] supabase health ping failed", e);
            online = false;
            if (e instanceof Error) {
              errorName = e.name;
              errorMessage = e.message;
            } else {
              errorMessage = String(e);
            }
          }
          const durationMs = Date.now() - t0;
          setServerReachable(online);
          setServerDetails({
            url: baseUrl,
            hasUrl,
            hasAnonKey,
            httpStatus,
            errorName,
            errorMessage,
            durationMs,
          });
          if (!online) {
            setServerError(
              errorMessage ||
                (httpStatus ? `HTTP ${httpStatus}` : "Unable to reach Supabase")
            );
          } else {
            setServerError(null);
          }
          if (!online) {
            console.log("[auth] server unreachable, falling back to local mode");
            return;
          }
          // Real-time validation: confirm the cached session is still valid
          // server-side AND the matching profile row exists. If anything is
          // off, force the user back through the auth flow.
          const { data: sessionData } = await supabase.auth.getSession();
          const session = sessionData.session ?? null;
          let validated: Session | null = null;
          if (session) {
            try {
              const { data: userData, error: userErr } =
                await supabase.auth.getUser();
              if (userErr || !userData?.user) {
                console.log(
                  "[auth] startup validation: user invalid, signing out",
                  userErr?.message
                );
                await supabase.auth.signOut();
              } else {
                const { data: profile, error: profErr } = await supabase
                  .from("profiles")
                  .select("id")
                  .eq("id", userData.user.id)
                  .maybeSingle();
                if (profErr) {
                  console.log(
                    "[auth] startup validation: profile lookup failed",
                    profErr.message
                  );
                  await supabase.auth.signOut();
                } else if (!profile) {
                  console.log(
                    "[auth] startup validation: no profile row, signing out"
                  );
                  await supabase.auth.signOut();
                } else {
                  validated = session;
                }
              }
            } catch (e) {
              console.log("[auth] startup validation threw", e);
              try {
                await supabase.auth.signOut();
              } catch {}
            }
          }
          await applySession(validated);
          const sub = supabase.auth.onAuthStateChange((_event, nextSession) => {
            console.log("[auth] supabase state change:", _event);
            applySession(nextSession ?? null).catch((e) =>
              console.log("[auth] applySession (state change) failed", e)
            );
          });
          unsub = () => sub.data.subscription.unsubscribe();
        } catch (e) {
          console.error("[auth] init supabase error", e);
        }
      }
    };

    init();
    return () => {
      if (unsub) unsub();
    };
  }, [supaEnabled, applySession]);

  // -------- Legacy local PIN flow (used only when Supabase isn't configured) --------

  const isUserRegistered = (phoneNumber: string): boolean => {
    const normalized = phoneNumber.replace(/[\s\-\(\)]/g, "").trim();
    if (isTestAccountNumber(phoneNumber)) return true;
    return registeredUsers.some(
      (u) => u.phoneNumber.replace(/[\s\-\(\)]/g, "").trim() === normalized
    );
  };

  /**
   * True if a sign-in PIN has already been set for this phone. Prefers the
   * server-synced value from public.profiles.pin (cached in authState) so
   * status is consistent across devices, and falls back to the locally
   * registered users list / built-in test account when offline or before
   * the profile has loaded.
   */
  const hasPinSet = (phoneNumber: string): boolean => {
    const normalized = (phoneNumber ?? "").replace(/[\s\-\(\)]/g, "").trim();
    if (!normalized) return false;
    const authPhone = (authState.phoneNumber ?? "").replace(/[\s\-\(\)]/g, "").trim();
    if (authState.isSupabaseSession && authPhone === normalized) {
      if (authState.profilePin) return true;
      // Server-derived PIN presence (profiles.pin_hash) — authoritative when known.
      if (authState.profileHasPin != null) return authState.profileHasPin;
    }
    if (isTestAccountNumber(phoneNumber)) return true;
    return registeredUsers.some(
      (u) =>
        u.phoneNumber.replace(/[\s\-\(\)]/g, "").trim() === normalized &&
        !!u.pin
    );
  };

  const verifyPin = (phoneNumber: string, pin: string): boolean => {
    const normalized = phoneNumber.replace(/\s/g, "");
    const authPhone = (authState.phoneNumber ?? "").replace(/\s/g, "");
    if (
      authState.isSupabaseSession &&
      authPhone === normalized &&
      authState.profilePin
    ) {
      return pin === authState.profilePin;
    }
    if (isTestAccountNumber(phoneNumber)) {
      return pin === TEST_ACCOUNT.pin;
    }
    const user = registeredUsers.find(
      (u) => u.phoneNumber.replace(/\s/g, "") === normalized
    );
    return user?.pin === pin;
  };

  /**
   * Server-side PIN check via the rate-limited verify_pin_for_login RPC.
   * The server stores only a bcrypt hash (migration 0052), so the local
   * synchronous verifyPin can't confirm the PIN on a fresh device — use this
   * for verification prompts (e.g. change-pin). Falls back to verifyPin when
   * the RPC is unavailable (offline / pre-0052 database / test account).
   */
  const verifyPinRemote = async (
    phoneNumber: string,
    pin: string
  ): Promise<{ ok: boolean; locked?: boolean; error?: string }> => {
    if (supaEnabled && supabase && !isTestAccountNumber(phoneNumber)) {
      try {
        const phone = normalizeE164(phoneNumber);
        const { data: verifiedId, error: rpcErr } = await supabase.rpc(
          "verify_pin_for_login",
          { p_phone: phone, p_pin: pin }
        );
        if (!rpcErr) {
          if (verifiedId) {
            // Cache the confirmed PIN in memory for the rest of the session.
            setAuthState((prev) => ({ ...prev, profilePin: pin, profileHasPin: true }));
            return { ok: true };
          }
          return { ok: false, error: "Incorrect PIN. Please try again." };
        }
        const lockSeconds = parsePinLockSeconds(rpcErr.message);
        if (lockSeconds != null) {
          return { ok: false, locked: true, error: pinLockMessage(lockSeconds) };
        }
        console.log("[auth] verifyPinRemote RPC error — falling back to local check:", rpcErr.message);
      } catch (e) {
        console.log("[auth] verifyPinRemote threw — falling back to local check", e);
      }
    }
    return verifyPin(phoneNumber, pin)
      ? { ok: true }
      : { ok: false, error: "Incorrect PIN. Please try again." };
  };

  const registerUser = async (
    phoneNumber: string,
    pin: string,
    firstName?: string
  ): Promise<{ loginPinSaved: boolean }> => {
    let loginPinSaved = false;
    try {
      const normalized = phoneNumber.replace(/\s/g, "");
      const idx = registeredUsers.findIndex(
        (u) => u.phoneNumber.replace(/\s/g, "") === normalized
      );
      const updated: RegisteredUser[] =
        idx >= 0
          ? registeredUsers.map((u, i) =>
              i === idx ? { phoneNumber, pin, firstName } : u
            )
          : [...registeredUsers, { phoneNumber, pin, firstName }];
      await AsyncStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(updated));
      setRegisteredUsers(updated);

      // Mirror the PIN to the server so it syncs across devices. We try to
      // resolve the user id directly from supabase.auth.getUser() so the write
      // succeeds even when authState.isSupabaseSession hasn't been flipped yet
      // (race during signup → pin-setup) or when authState.userId is stale.
      if (supaEnabled && supabase) {
        try {
          let uid: string | null = authState.userId ?? null;
          try {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) uid = data.user.id;
          } catch (e) {
            console.log("[auth] registerUser getUser threw", e);
          }
          if (uid) {
            // Sync the deterministic auth password derived from the PIN so
            // the PIN-only login screen can mint a real session via
            // signInWithPassword. Requires an active session here (we have
            // one — registerUser runs after OTP verify / while signed in).
            const syncAuthPasswordForPin = async () => {
              try {
                const { error: pwErr } = await supabase!.auth.updateUser({
                  password: derivePinPassword(pin),
                });
                if (pwErr) {
                  // 422 "same_password" means the Auth password is already
                  // set to derivePinPassword(pin) — treat as a successful
                  // sync rather than a real error.
                  if (/same.?password|different.*password/i.test(pwErr.message)) {
                    console.log("[auth] registerUser auth password already in sync (same_password)");
                    AsyncStorage.removeItem(AUTH_PASSWORD_RESYNC_KEY).catch(() => {});
                  } else {
                    console.log("[auth] registerUser sync auth password error", pwErr.message, "— retrying in 800 ms");
                    await new Promise((r) => setTimeout(r, 800));
                    try {
                      const { error: pwErr2 } = await supabase!.auth.updateUser({
                        password: derivePinPassword(pin),
                      });
                      if (!pwErr2 || /same.?password|different.*password/i.test(pwErr2.message ?? "")) {
                        console.log("[auth] registerUser auth password synced on retry");
                        AsyncStorage.removeItem(AUTH_PASSWORD_RESYNC_KEY).catch(() => {});
                      } else {
                        console.log("[auth] registerUser sync auth password retry failed", pwErr2.message);
                        AsyncStorage.setItem(AUTH_PASSWORD_RESYNC_KEY, "true").catch(() => {});
                      }
                    } catch (e2) {
                      console.log("[auth] registerUser updateUser retry threw", e2);
                      AsyncStorage.setItem(AUTH_PASSWORD_RESYNC_KEY, "true").catch(() => {});
                    }
                  }
                } else {
                  console.log("[auth] registerUser auth password synced for pin login");
                  AsyncStorage.removeItem(AUTH_PASSWORD_RESYNC_KEY).catch(() => {});
                }
              } catch (e) {
                console.log("[auth] registerUser updateUser password threw", e);
                AsyncStorage.setItem(AUTH_PASSWORD_RESYNC_KEY, "true").catch(() => {});
              }
            };
            const commitPinState = () => {
              setAuthState((prev) => {
                const next: AuthState = { ...prev, profilePin: pin, profileHasPin: true, userId: uid };
                AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ ...next, profilePin: null })).catch(() => {});
                return next;
              });
            };

            // Preferred path: set_login_pin RPC (migration 0052). The server
            // stores only a bcrypt hash, so the plaintext PIN never lands in
            // the profiles row.
            let rpcSaved = false;
            try {
              const { data: rpcOk, error: rpcErr } = await supabase.rpc("set_login_pin", { p_pin: pin });
              if (!rpcErr && rpcOk === true) {
                rpcSaved = true;
                loginPinSaved = true;
                console.log("[auth] registerUser PIN saved via set_login_pin RPC");
              } else if (rpcErr) {
                console.log("[auth] registerUser set_login_pin RPC failed — falling back to legacy column write:", rpcErr.message);
              }
            } catch (e) {
              console.log("[auth] registerUser set_login_pin RPC threw", e);
            }

            if (rpcSaved) {
              if (firstName && firstName.trim()) {
                const { error: nameErr } = await supabase
                  .from("profiles")
                  .update({ name: firstName.trim() })
                  .eq("id", uid);
                if (nameErr) console.log("[auth] registerUser name update error", nameErr.message);
              }
              await syncAuthPasswordForPin();
              commitPinState();
            } else {
            // Legacy fallback (pre-0052 databases): write the PIN to the
            // pin/login_pin columns directly. On migrated databases a BEFORE
            // trigger hashes these server-side, so plaintext still never
            // persists.
            const update: { pin: string; login_pin: string; name?: string } = {
              pin,
              login_pin: pin,
            };
            if (firstName && firstName.trim()) update.name = firstName.trim();
            console.log("[auth] registerUser writing pin/login_pin for uid", uid);
            let { data: updated, error } = await supabase
              .from("profiles")
              .update(update)
              .eq("id", uid)
              .select("id, pin, login_pin")
              .maybeSingle();

            // Resilience: if the new `login_pin` column hasn't been migrated
            // into the live database yet, the combined update above fails
            // atomically — meaning even `pin` doesn't land. Detect that case
            // and retry without `login_pin` so at least `pin` is captured,
            // and surface a loud log so the operator runs the migration.
            const isSchemaMissing = (msg: string, col: string) =>
              new RegExp(`'${col}' column|column \"?${col}\"?|${col}.*schema cache`, "i").test(msg);
            if (error && isSchemaMissing(error.message, "login_pin") && !isSchemaMissing(error.message, "pin")) {
              console.log(
                "[auth] registerUser login_pin column missing — apply supabase/migrations/0003_profiles_status_idverified_pin_devices.sql. Falling back to pin-only update."
              );
              const fallback: { pin: string; name?: string } = { pin };
              if (firstName && firstName.trim()) fallback.name = firstName.trim();
              const retry = await supabase
                .from("profiles")
                .update(fallback)
                .eq("id", uid)
                .select("id, pin")
                .maybeSingle();
              updated = retry.data
                ? { id: retry.data.id, pin: retry.data.pin, login_pin: null }
                : null;
              error = retry.error;
            }
            // Same resilience for the legacy `pin` column: if it's missing in
            // the live DB (migration 0002 not applied / PostgREST cache stale),
            // retry writing only `login_pin` so the PIN is captured at least
            // in the new column.
            if (error && isSchemaMissing(error.message, "pin")) {
              console.log(
                "[auth] registerUser pin column missing in schema cache — apply supabase/migrations/0002_add_profiles_pin.sql or run `NOTIFY pgrst, 'reload schema'`. Falling back to login_pin-only update."
              );
              const fallback: { login_pin: string; name?: string } = { login_pin: pin };
              if (firstName && firstName.trim()) fallback.name = firstName.trim();
              const retry = await supabase
                .from("profiles")
                .update(fallback)
                .eq("id", uid)
                .select("id, login_pin")
                .maybeSingle();
              updated = retry.data
                ? { id: retry.data.id, pin: null, login_pin: retry.data.login_pin }
                : null;
              error = retry.error;
            }

            if (error) {
              console.log("[auth] registerUser server pin save error", error.message);
            } else if (!updated) {
              // No row matched — the profile row may not exist yet (trigger
              // missed). Insert it so the PIN is captured on first run.
              console.log("[auth] registerUser no profile row for uid, inserting", uid);
              let { error: insertErr } = await supabase
                .from("profiles")
                .insert({ id: uid, ...update });
              if (insertErr && isSchemaMissing(insertErr.message, "login_pin")) {
                const r = await supabase.from("profiles").insert({ id: uid, pin, ...(update.name ? { name: update.name } : {}) });
                insertErr = r.error;
              }
              if (insertErr && isSchemaMissing(insertErr.message, "pin")) {
                const r = await supabase.from("profiles").insert({ id: uid, login_pin: pin, ...(update.name ? { name: update.name } : {}) });
                insertErr = r.error;
              }
              if (insertErr) {
                console.log("[auth] registerUser insert pin error", insertErr.message);
              } else {
                commitPinState();
              }
            } else {
              console.log("[auth] registerUser pin saved", { id: updated.id, hasPin: !!updated.pin, hasLoginPin: !!updated.login_pin });
              if (updated.login_pin === pin) loginPinSaved = true;
              await syncAuthPasswordForPin();
              // Self-healing: if the combined update succeeded but the
              // returned row shows `login_pin` is still null (e.g. PostgREST
              // schema cache hadn't picked up the new column at the time of
              // the write, so it silently dropped that field), force a
              // dedicated UPDATE just for `login_pin` and re-verify.
              if (!updated.login_pin) {
                console.log("[auth] registerUser login_pin missing on row, retrying dedicated update", uid);
                const { data: forced, error: forceErr } = await supabase
                  .from("profiles")
                  .update({ login_pin: pin })
                  .eq("id", uid)
                  .select("id, login_pin")
                  .maybeSingle();
                if (forceErr) {
                  console.log("[auth] registerUser dedicated login_pin update error", forceErr.message);
                } else {
                  console.log("[auth] registerUser dedicated login_pin update result", { id: forced?.id, hasLoginPin: !!forced?.login_pin });
                  if (forced?.login_pin === pin) loginPinSaved = true;
                }
              }
              commitPinState();
            }
            } // end legacy fallback
          } else {
            console.log("[auth] registerUser skipped server pin save — no supabase user id");
          }
        } catch (e) {
          console.log("[auth] registerUser server pin save threw", e);
        }
      }
    } catch (error) {
      console.error("[auth] registerUser error", error);
    }
    return { loginPinSaved };
  };

  const login = async (phoneNumber: string, name?: string) => {
    try {
      const normalized = phoneNumber.replace(/\s/g, "");
      const registered = registeredUsers.find(
        (u) => u.phoneNumber.replace(/\s/g, "") === normalized
      );
      const resolvedName =
        (name && name.trim()) ||
        authState.profileName ||
        registered?.firstName ||
        null;
      const next: AuthState = {
        isAuthenticated: true,
        phoneNumber,
        userId: authState.userId ?? null,
        profileName: resolvedName,
        profileAvatar: authState.profileAvatar ?? null,
        // Legacy/test login is not a real Supabase session.
        isSupabaseSession: authState.isSupabaseSession,
      };
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setAuthState(next);
    } catch (e) {
      console.error("[auth] login error", e);
    }
  };

  /**
   * Sign the local test account into Supabase using its deterministic
   * email/password — sign-in ONLY. We deliberately do NOT sign the user up
   * or upsert a profile row here: the test account must already exist in
   * Supabase (auth user + matching `profiles` row with `phone` set), exactly
   * like any other user. If it doesn't, we return false so the caller can
   * route the user through the registration flow.
   */
  const signInTestAccountToSupabase = useCallback(async (): Promise<boolean> => {
    if (!supaEnabled || !supabase) return false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: TEST_ACCOUNT.email,
        password: TEST_ACCOUNT.password,
      });
      if (error || !data.session) {
        console.log(
          "[auth] test account has no Supabase record yet — registration required",
          error?.message
        );
        return false;
      }
      const userId = data.session.user.id;
      // Verify a matching profile row exists. No row → treat as unregistered.
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, phone")
          .eq("id", userId)
          .maybeSingle();
        if (!profile) {
          console.log("[auth] test account auth exists but no profile row — registration required");
          await supabase.auth.signOut();
          return false;
        }
      } catch (e) {
        console.log("[auth] test profile lookup error", e);
      }
      return true;
    } catch (e) {
      console.log("[auth] signInTestAccountToSupabase threw", e);
      return false;
    }
  }, [supaEnabled]);

  const logout = async () => {
    try {
      if (supaEnabled && supabase) {
        await supabase.auth.signOut();
      }
      await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_CACHE_KEY]);
      setProfile(null);
      setAuthState({ isAuthenticated: false, phoneNumber: null, userId: null, profileName: null, profileAvatar: null, profilePin: null, isSupabaseSession: false });
    } catch (e) {
      console.error("[auth] logout error", e);
    }
  };

  // -------- Supabase phone-OTP flow --------

  const sendOtp = useCallback(
    async (
      phoneNumber: string,
      options?: { shouldCreateUser?: boolean }
    ): Promise<SendOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      // Default to false: only existing users can request a sign-in OTP.
      // Pass shouldCreateUser:true explicitly from the dedicated signup flow.
      const shouldCreateUser = options?.shouldCreateUser ?? false;
      const reqId = Math.random().toString(36).slice(2, 8);
      try {
        console.log(
          `[auth][${reqId}] sendOtp BEGIN phone=${phone} shouldCreateUser=${shouldCreateUser}`
        );
        const t0 = Date.now();
        const { error } = await supabase.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser },
        });
        console.log(`[auth][${reqId}] sendOtp END in ${Date.now() - t0}ms`);
        if (error) {
          console.log(`[auth][${reqId}] sendOtp error summary`, {
            name: error.name,
            status: (error as unknown as { status?: number }).status,
            code: (error as unknown as { code?: string }).code,
            message: error.message,
          });
          try {
            console.log(
              `[auth][${reqId}] sendOtp error raw`,
              JSON.stringify(error, Object.getOwnPropertyNames(error))
            );
          } catch {
            console.log(`[auth][${reqId}] sendOtp error raw (unstringifiable)`, error);
          }
          // Supabase returns this when shouldCreateUser=false and no user exists.
          const msg = /signups? not allowed|user not found|otp_disabled/i.test(
            error.message
          )
            ? "No account found for this number. Please sign up first."
            : error.message;
          return { ok: false, error: msg };
        }
        console.log(`[auth][${reqId}] sendOtp ok`);
        return { ok: true };
      } catch (e) {
        console.log(`[auth][${reqId}] sendOtp threw`, e);
        try {
          console.log(
            `[auth][${reqId}] sendOtp threw raw`,
            JSON.stringify(e, Object.getOwnPropertyNames(e as object))
          );
        } catch {}
        const msg = e instanceof Error ? e.message : "Failed to send code";
        return { ok: false, error: msg };
      }
    },
    [supaEnabled]
  );

  const verifyOtp = useCallback(
    async (
      phoneNumber: string,
      code: string,
      options?: { type?: "sms" | "phone_change" }
    ): Promise<VerifyOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, isNewUser: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      const type = options?.type ?? "sms";
      const reqId = Math.random().toString(36).slice(2, 8);
      try {
        console.log(
          `[auth][${reqId}] verifyOtp BEGIN phone=${phone} type=${type} codeLen=${code?.length ?? 0}`
        );
        const t0 = Date.now();
        const { data, error } = await supabase.auth.verifyOtp({
          phone,
          token: code,
          type,
        });
        console.log(`[auth][${reqId}] verifyOtp END in ${Date.now() - t0}ms`);
        if (error || !data.session) {
          if (error) {
            console.log(`[auth][${reqId}] verifyOtp error summary`, {
              name: error.name,
              status: (error as unknown as { status?: number }).status,
              code: (error as unknown as { code?: string }).code,
              message: error.message,
            });
            try {
              console.log(
                `[auth][${reqId}] verifyOtp error raw`,
                JSON.stringify(error, Object.getOwnPropertyNames(error))
              );
            } catch {
              console.log(
                `[auth][${reqId}] verifyOtp error raw (unstringifiable)`,
                error
              );
            }
          } else {
            console.log(`[auth][${reqId}] verifyOtp no session returned`);
          }
          return {
            ok: false,
            isNewUser: false,
            error: error?.message ?? "Invalid code",
          };
        }
        const userId = data.user?.id ?? data.session.user.id;
        // The DB trigger handle_new_auth_user inserts a profile row on signup.
        // Fetch it so we can decide if the user still needs to enter their name.
        let hasName = false;
        let isNewUser = true;
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id, name, phone")
            .eq("id", userId)
            .maybeSingle();
          if (profile) {
            isNewUser = !profile.name;
            hasName = !!profile.name;
            (data as unknown as { _name?: string })._name = profile.name ?? undefined;
            // Make sure phone column is populated (trigger may have skipped it).
            if (!profile.phone) {
              await supabase
                .from("profiles")
                .update({ phone })
                .eq("id", userId);
            }
          } else {
            await supabase
              .from("profiles")
              .insert({ id: userId, phone })
              .select()
              .maybeSingle();
          }
        } catch (e) {
          console.log("[auth] profile lookup failed", e);
        }
        const resolvedName =
          (data as unknown as { _name?: string })._name ?? null;
        // If a previous registerUser failed to sync the Auth password (e.g. the
        // session expired between OTP and pin-setup), fix it now while we have
        // a fresh session so PIN login works without forcing another OTP round.
        try {
          const pendingResync = await AsyncStorage.getItem(AUTH_PASSWORD_RESYNC_KEY);
          if (pendingResync === "true") {
            const { data: pinRow } = await supabase
              .from("profiles")
              .select("login_pin, pin")
              .eq("id", userId)
              .maybeSingle();
            // The server stores only a bcrypt hash since migration 0052, so
            // recover the plaintext from this device's local cache when the
            // legacy columns are empty.
            const savedPin =
              pinRow?.login_pin || pinRow?.pin || (await getLocalPinForPhone(phone));
            if (savedPin) {
              const { error: pwErr } = await supabase.auth.updateUser({
                password: derivePinPassword(savedPin),
              });
              if (!pwErr || /same.?password|different.*password/i.test(pwErr.message ?? "")) {
                console.log(`[auth][${reqId}] verifyOtp: pending auth password resync completed`);
              } else {
                console.log(`[auth][${reqId}] verifyOtp: pending auth password resync failed`, pwErr.message);
              }
            }
            await AsyncStorage.removeItem(AUTH_PASSWORD_RESYNC_KEY);
          }
        } catch (e) {
          console.log(`[auth][${reqId}] verifyOtp: pending resync check threw`, e);
        }
        console.log(`[auth][${reqId}] verifyOtp ok userId=${userId} isNewUser=${isNewUser}`);
        return { ok: true, isNewUser, hasName, userId, name: resolvedName };
      } catch (e) {
        console.log(`[auth][${reqId}] verifyOtp threw`, e);
        try {
          console.log(
            `[auth][${reqId}] verifyOtp threw raw`,
            JSON.stringify(e, Object.getOwnPropertyNames(e as object))
          );
        } catch {}
        const msg = e instanceof Error ? e.message : "Verification failed";
        return { ok: false, isNewUser: false, error: msg };
      }
    },
    [supaEnabled]
  );

  /**
   * Send a phone-change OTP to a NEW phone number for the currently
   * authenticated user. Uses supabase.auth.updateUser({ phone }) which
   * triggers an SMS to the new number. Verify with verifyOtp(..., { type:
   * "phone_change" }).
   */
  const sendPhoneChangeOtp = useCallback(
    async (newPhoneNumber: string): Promise<SendOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(newPhoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      try {
        console.log("[auth] sending phone-change OTP to", phone);
        const { error } = await supabase.auth.updateUser({ phone });
        if (error) {
          console.log("[auth] sendPhoneChangeOtp error", error.message);
          return { ok: false, error: error.message };
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to send code";
        return { ok: false, error: msg };
      }
    },
    [supaEnabled]
  );

  /**
   * Persist profile updates (e.g. user's first name) into public.profiles.
   * No-op if Supabase isn't configured.
   */
  const updateProfile = useCallback(
    async (patch: { name?: string; firstName?: string; phone?: string }): Promise<boolean> => {
      if (!supaEnabled || !supabase) return false;
      const userId = authState.userId;
      if (!userId) return false;
      // RLS policies require auth.uid() to match; bail early on test/legacy sessions.
      if (!authState.isSupabaseSession) {
        console.log("[auth] updateProfile skipped: not a Supabase session");
        return false;
      }
      const name = patch.name ?? patch.firstName;
      const phone = patch.phone ? normalizeE164(patch.phone) : undefined;
      const update: { name?: string; phone?: string } = {};
      if (name) update.name = name;
      if (phone) update.phone = phone;
      if (Object.keys(update).length === 0) return false;
      try {
        const { error } = await supabase
          .from("profiles")
          .update(update)
          .eq("id", userId);
        if (error) {
          console.log("[auth] updateProfile error", error.message);
          return false;
        }
        setAuthState((prev) => {
          const next: AuthState = {
            ...prev,
            ...(phone ? { phoneNumber: phone } : {}),
            ...(name ? { profileName: name } : {}),
          };
          AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        return true;
      } catch (e) {
        console.log("[auth] updateProfile threw", e);
        return false;
      }
    },
    [supaEnabled, authState.userId, authState.isSupabaseSession]
  );

  /**
   * Forgot-PIN reset. Clears `profiles.pin` server-side so the user is routed
   * to Set PIN, and updates the in-memory `profilePin` so `hasPinSet` flips to
   * false immediately. Requires a real Supabase session (RLS auth.uid() = id).
   */
  const forgotPin = useCallback(async (): Promise<boolean> => {
    const userId = authState.userId;
    const phone = authState.phoneNumber ?? "";
    let serverOk = false;
    if (supaEnabled && supabase && authState.isSupabaseSession && userId) {
      try {
        // Preferred path: clear_login_pin RPC (migration 0052) also clears
        // the bcrypt hash and the failed-attempt counters.
        const { error: rpcErr } = await supabase.rpc("clear_login_pin");
        if (!rpcErr) {
          serverOk = true;
        } else {
          console.log("[auth] forgotPin clear_login_pin RPC failed — falling back to column clear:", rpcErr.message);
          const { error } = await supabase
            .from("profiles")
            .update({ pin: null, login_pin: null })
            .eq("id", userId);
          if (error) {
            console.log("[auth] forgotPin server clear error", error.message);
          } else {
            serverOk = true;
          }
        }
      } catch (e) {
        console.log("[auth] forgotPin threw", e);
      }
    }
    // Also clear the local registered-users cache so the offline path agrees.
    try {
      const normalized = phone.replace(/\s/g, "");
      const updated = registeredUsers.map((u) =>
        u.phoneNumber.replace(/\s/g, "") === normalized ? { ...u, pin: "" } : u
      );
      await AsyncStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(updated));
      setRegisteredUsers(updated);
    } catch (e) {
      console.log("[auth] forgotPin local clear error", e);
    }
    setAuthState((prev) => {
      const next: AuthState = { ...prev, profilePin: null, profileHasPin: false };
      AsyncStorage.setItem(
        AUTH_KEY,
        JSON.stringify({ ...next, profilePin: null })
      ).catch(() => {});
      return next;
    });
    return serverOk || !supaEnabled;
  }, [supaEnabled, authState.userId, authState.isSupabaseSession, authState.phoneNumber, registeredUsers]);

  /**
   * Re-fetch the user's name + avatar from public.profiles. Call after any external
   * update path so shared UI (side sheets, menus) reflects the latest values.
   */
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!supaEnabled || !supabase) return;
    const userId = authState.userId;
    if (!userId) return;
    // No isSupabaseSession gate: legacy/PIN sessions can still hit the anon
    // endpoint to refresh the cached row when RLS allows it. If the read is
    // blocked we just keep the existing cache.
    try {
      let { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", userId)
        .maybeSingle();
      // Databases that pre-date migration 0052 have no pin_hash column —
      // retry with the legacy column list so the refresh still works.
      if (error && /pin_hash/i.test(error.message)) {
        const retry = await supabase
          .from("profiles")
          .select(LEGACY_PROFILE_COLUMNS)
          .eq("id", userId)
          .maybeSingle();
        data = retry.data as unknown as typeof data;
        error = retry.error;
      }
      if (error) {
        console.log("[auth] refreshProfile fetch error", error.message);
        return;
      }
      if (!data) return;
      const record: ProfileRecord = {
        ...(data as ProfileRecord),
        _cachedAt: new Date().toISOString(),
      };
      setProfile(record);
      // Persist the full row to AsyncStorage minus the PIN columns (kept in memory only).
      const { pin: _pin, login_pin: _login_pin, pin_hash: _pin_hash, ...persisted } = record;
      void _pin; void _login_pin; void _pin_hash;
      AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(persisted)).catch(
        () => {}
      );
      setAuthState((prev) => {
        const next: AuthState = {
          ...prev,
          profileName: record.name ?? prev.profileName ?? null,
          profileAvatar:
            record.avatar_url ?? record.profile_image ?? prev.profileAvatar ?? null,
          // Legacy plaintext columns (pre-0052 databases) still mirror the
          // PIN; on hashed databases keep whatever the user typed this session.
          profilePin: record.login_pin ?? record.pin ?? prev.profilePin ?? null,
          // Server-derived "a PIN exists" flag — works with hash-only rows.
          profileHasPin: !!(record.pin_hash || record.login_pin || record.pin),
        };
        AsyncStorage.setItem(
          AUTH_KEY,
          JSON.stringify({ ...next, profilePin: null })
        ).catch(() => {});
        return next;
      });
    } catch (e) {
      console.log("[auth] refreshProfile error", e);
    }
  }, [supaEnabled, authState.userId, authState.isSupabaseSession]);

  useEffect(() => {
    if (authState.userId) {
      refreshProfile();
    }
  }, [authState.userId, authState.isSupabaseSession, refreshProfile]);

  /**
   * Re-syncs the Supabase Auth password with whatever PIN is currently saved
   * in the user's profile row. Called after OTP verification to repair the
   * auth password without requiring the user to go through pin-setup again.
   * Returns true on success, false if no profile PIN exists or updateUser fails.
   */
  const resyncAuthPassword = useCallback(
    async (userId: string): Promise<boolean> => {
      if (!supaEnabled || !supabase) return false;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("login_pin, pin, phone")
          .eq("id", userId)
          .maybeSingle();
        if (error || !data) {
          console.log("[auth] resyncAuthPassword: profile fetch failed", error?.message);
          return false;
        }
        // Legacy plaintext columns first (pre-0052 databases); on hashed
        // databases the server can't return the PIN, so fall back to this
        // device's local cache.
        let existingPin = data.login_pin || data.pin;
        if (!existingPin) {
          const phone = data.phone || authState.phoneNumber || "";
          existingPin = phone ? await getLocalPinForPhone(phone) : null;
        }
        if (!existingPin) {
          console.log("[auth] resyncAuthPassword: no recoverable PIN (server stores a hash and no local cache) — caller should route to pin-setup");
          return false;
        }
        const pinToSync: string = existingPin;
        const tryUpdate = async (): Promise<boolean> => {
          const { error: pwErr } = await supabase!.auth.updateUser({
            password: derivePinPassword(pinToSync),
          });
          if (!pwErr || /same.?password|different.*password/i.test(pwErr.message)) {
            console.log("[auth] resyncAuthPassword: auth password synced from profile PIN");
            return true;
          }
          console.log("[auth] resyncAuthPassword: updateUser failed", pwErr.message);
          return false;
        };
        if (await tryUpdate()) return true;
        await new Promise((r) => setTimeout(r, 1000));
        return tryUpdate();
      } catch (e) {
        console.log("[auth] resyncAuthPassword threw", e);
        return false;
      }
    },
    [supaEnabled, authState.phoneNumber]
  );

  /**
   * Mint a real Supabase auth session from phone + PIN by signing in with
   * the deterministic password mirrored from the PIN. Used by /pin-verify so
   * the user is fully authenticated (RLS-protected reads/writes work) even
   * when OTP was skipped. Returns { ok, needsOtp, error } — `needsOtp:true`
   * means the user pre-dates password-sync and must do a one-time OTP login.
   */
  const signInWithPin = useCallback(
    async (
      phoneNumber: string,
      pin: string
    ): Promise<{
      ok: boolean;
      needsOtp?: boolean;
      profilePinMatched?: boolean;
      error?: string;
    }> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      // Keep the verified PIN in memory (never persisted) so hasPinSet /
      // verifyPin / change-pin work for the rest of the session — the server
      // only stores a bcrypt hash and can't echo the PIN back.
      const cacheVerifiedPin = () => {
        setAuthState((prev) => {
          const next: AuthState = { ...prev, profilePin: pin, profileHasPin: true };
          AsyncStorage.setItem(
            AUTH_KEY,
            JSON.stringify({ ...next, profilePin: null })
          ).catch(() => {});
          return next;
        });
      };
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          phone,
          password: derivePinPassword(pin),
        });
        if (error || !data.session) {
          const msg = error?.message ?? "Sign in failed";
          console.log("[auth] signInWithPin error", msg);
          // Supabase returns "Invalid login credentials" both for a wrong PIN
          // AND for a user whose Auth password has drifted from the PIN saved
          // in their profile (e.g. the PIN was changed without re-syncing the
          // password). In the latter case the user IS typing the correct PIN.
          if (/invalid login credentials/i.test(msg)) {
            // Verify the entered PIN directly against the profile table via a
            // SECURITY DEFINER RPC. This works even before the user has a
            // session (unauthenticated call), so it correctly distinguishes
            // "wrong PIN" from "correct PIN but Auth password out of sync".
            let profilePinMatched = false;
            try {
              const { data: verifiedId, error: rpcErr } = await supabase.rpc(
                "verify_pin_for_login",
                { p_phone: phone, p_pin: pin }
              );
              if (!rpcErr && verifiedId) {
                profilePinMatched = true;
                console.log("[auth] signInWithPin: verify_pin_for_login confirmed PIN matches profile");
              } else if (rpcErr) {
                // Too many wrong attempts — the server has locked PIN
                // verification. Surface the lockout instead of falling back
                // to local checks.
                const lockSeconds = parsePinLockSeconds(rpcErr.message);
                if (lockSeconds != null) {
                  console.log("[auth] signInWithPin: PIN verification locked for", lockSeconds, "s");
                  return { ok: false, error: pinLockMessage(lockSeconds) };
                }
                console.log("[auth] signInWithPin: verify_pin_for_login error", rpcErr.message);
              }
            } catch (e) {
              console.log("[auth] signInWithPin: verify_pin_for_login threw", e);
            }
            // Also accept the in-memory profilePin as a local fallback (e.g.
            // when the RPC is temporarily unavailable).
            if (!profilePinMatched) {
              const savedPin = authState.profilePin;
              if (savedPin && pin === savedPin) {
                profilePinMatched = true;
                console.log("[auth] signInWithPin: entered PIN matches in-memory profilePin");
              }
            }
            // Final fallback: check local registered-users cache. If the PIN
            // matches locally but verify_pin_for_login returned null it means
            // the profile write failed during registerUser — route through OTP
            // so pin-setup re-runs and writes the PIN to Supabase correctly.
            if (!profilePinMatched) {
              const localUser = registeredUsers.find(
                (u) => normalizeE164(u.phoneNumber) === phone
              );
              if (localUser?.pin && localUser.pin === pin) {
                profilePinMatched = true;
                console.log("[auth] signInWithPin: PIN matches local cache — profile write likely failed, routing to OTP+pin-setup");
              }
            }
            if (profilePinMatched) {
              console.log("[auth] signInWithPin: PIN correct but Auth password out of sync — attempting re-sync");
              // Re-sync the Auth password to the PIN so future logins work.
              // updateUser only succeeds when a session already exists (e.g.
              // a re-auth / verifyOnly prompt while the user is signed in).
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData.session) {
                  const { error: pwErr } = await supabase.auth.updateUser({
                    password: derivePinPassword(pin),
                  });
                  if (!pwErr) {
                    console.log("[auth] signInWithPin: Auth password re-synced — retrying sign-in");
                    // Re-try sign-in now that the password is synced.
                    const retry = await supabase.auth.signInWithPassword({
                      phone,
                      password: derivePinPassword(pin),
                    });
                    if (!retry.error && retry.data.session) {
                      cacheVerifiedPin();
                      return { ok: true };
                    }
                    console.log("[auth] signInWithPin: retry after re-sync failed", retry.error?.message);
                  } else if (/same.?password|different.*password/i.test(pwErr.message)) {
                    // 422 same_password: Auth password is already derivePinPassword(pin).
                    // The original signInWithPassword failure was transient — retry now.
                    console.log("[auth] signInWithPin: password already in sync (same_password) — retrying sign-in");
                    const retry = await supabase.auth.signInWithPassword({
                      phone,
                      password: derivePinPassword(pin),
                    });
                    if (!retry.error && retry.data.session) {
                      cacheVerifiedPin();
                      return { ok: true };
                    }
                    console.log("[auth] signInWithPin: retry with correct password still failed", retry.error?.message);
                  } else {
                    console.log("[auth] signInWithPin: password re-sync failed", pwErr.message);
                  }
                }
              } catch (e) {
                console.log("[auth] signInWithPin: re-sync threw", e);
              }
              // No active session to re-sync against — need a one-time OTP to
              // mint a session and re-sync the password. Tell the caller the
              // profile PIN matched so it knows to route to OTP + pin-setup.
              return { ok: false, needsOtp: true, profilePinMatched: true, error: msg };
            }
            // RPC confirmed the PIN is wrong.
            return { ok: false, error: msg };
          }
          return { ok: false, error: msg };
        }
        cacheVerifiedPin();
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sign in failed";
        console.log("[auth] signInWithPin threw", e);
        return { ok: false, error: msg };
      }
    },
    [supaEnabled, authState.profilePin, registeredUsers]
  );

  return {
    authState,
    /**
     * Full cached snapshot of public.profiles for the signed-in user.
     * Populated from AsyncStorage on boot and refreshed from Supabase
     * whenever a real session is available. May be null when logged out
     * or before the first successful sync.
     */
    profile,
    isLoading,
    serverReachable,
    isSupabaseAuth: supaEnabled,
    serverError,
    serverDetails,
    /**
     * True when the current session is a real Supabase auth session and
     * RLS-protected calls will work. False for the local PIN / test account.
     */
    isSupabaseSession: authState.isSupabaseSession,
    // legacy local PIN flow
    login,
    logout,
    isUserRegistered,
    hasPinSet,
    verifyPin,
    /** Async server-backed PIN check (rate limited). Prefer over verifyPin. */
    verifyPinRemote,
    registerUser,
    // supabase phone-OTP flow
    sendOtp,
    verifyOtp,
    sendPhoneChangeOtp,
    updateProfile,
    refreshProfile,
    forgotPin,
    // test account → real supabase session bridge
    signInTestAccountToSupabase,
    /** Phone + PIN → real Supabase session (skips OTP). */
    signInWithPin,
    /** Re-sync Supabase Auth password from the profile PIN after OTP verify. */
    resyncAuthPassword,
    isTestAccountPhone: (phone: string) => isTestAccountNumber(phone),
  };
});
